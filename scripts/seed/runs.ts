/**
 * Seed run orchestration for issue #8.
 *
 * This module owns exactly one slice of the recorded workspace: the real
 * reproduction runs. It creates the experiment rows, claims execution through
 * the production claim service, opens and decides the production approval
 * gates, runs the production EXECUTE/EVALUATE stages, verifies the measured
 * result, and captures a logical baseline that can be compared across two
 * independent live seeds on separate fresh databases.
 *
 * What is real here:
 *
 * - `claimExecutionStart`, `openApprovalGate` and `decideApproval` from
 *   `src/db/pipeline.ts` — the same durable gate the SSE transport uses.
 * - `createProductionPipelineStages(...).plan/execute` — real planner
 *   validation, real E2B runner, real deterministic verdict, real
 *   `explain_gap`, real `projectRunToGraph`.
 * - `branchWhatIf(...)` from `src/server/branch.ts` (issue #27 / PR #66) when
 *   the integration supplies it. The boundary below is structurally identical
 *   to #66's signature, so the entrypoint can pass the real function and store
 *   directly.
 * - The run row is the only source of measured metrics and artifacts. This
 *   module never writes a metric, a verdict or an artifact; it reads them back
 *   and fails when they are absent, inconsistent or unverifiable.
 *
 * What is deliberately not here:
 *
 * - Workspace, source, chunk, claim/method/dataset node and evidence-edge
 *   construction. The ingestion side of the seed owns that.
 * - Graph edges other than the run→result projection written by
 *   `projectRunToGraph`. `scripts/seed.ts` writes the method/dataset → run
 *   and run A → run B `derived_from` edges from the returned run ids through
 *   `scripts/seed/run-edges.ts`, after both runs are terminal.
 * - Any DB reset. The seed requires a fresh database; this module refuses a
 *   workspace that already has experiments.
 *
 * ---------------------------------------------------------------------------
 * External prerequisites (#8 integration, owner-coordinated)
 * ---------------------------------------------------------------------------
 *
 * Run B must have a genuinely different measured output from Run A, while
 * remaining exactly one changed spec leaf (`parameters.<name>`). The pinned
 * hero script currently computes both rankings unconditionally and the E2B
 * runner does not expose `spec.parameters` to the script, so on `main` the
 * what-if branch would execute identical code and produce identical metrics.
 * The seed fails with `RUNS_NOT_DISTINCT` rather than recording that as a
 * comparison. Two owner changes unblock it:
 *
 * 1. `fixtures/hero-spec.ts` (`@frag2win`): `main.py` reads
 *    `os.environ["RESEARCHGRAPH_PARAMETERS"]`, requires `importance_method` to
 *    be `impurity` or `permutation`, writes the selected rank as a numeric
 *    metric, and writes a deterministic CSV artifact to `/output/`. The
 *    existing criteria stay unchanged so the spec diff remains one leaf.
 * 2. `src/server/runner.ts` (`@yashhh-23`): pass
 *    `envs: { RESEARCHGRAPH_PARAMETERS: JSON.stringify(updatedSpec.parameters) }`
 *    to `sandbox.commands.run`. E2B accepts an env map, so no shell
 *    interpolation is involved.
 *
 * The what-if service (`src/server/branch.ts`, PR #66) is not merged yet.
 * Until it lands, the entrypoint cannot supply `whatIf`, and this module fails
 * before writing anything (`WHAT_IF_UNAVAILABLE`). That is a prerequisite
 * state, not a verification failure. #62 is already integrated on this branch
 * (PR #70): production EXECUTE adopts the queued child run, so the real
 * executor reports `adoptsQueuedRun: true`. A custom executor must state that
 * capability explicitly; without it the module fails before writing anything
 * (`QUEUED_RUN_ADOPTION_UNAVAILABLE`) rather than create an unlinked run.
 * Contract violations from a supplied service, missing lineage, identical
 * metrics, unverifiable artifacts and baseline mismatches are reported
 * separately as verification failures.
 *
 * ---------------------------------------------------------------------------
 * Approval
 * ---------------------------------------------------------------------------
 *
 * There is no built-in approver. The entrypoint supplies a
 * `SeedRunApprovalPort` that presents the exact persisted `offeredSpec` and
 * its concrete per-database SHA-256, and returns the decision with the
 * verified Neon Auth actor id and the hash it actually reviewed. This module
 * then records the decision through `decideApproval` — it never invents an
 * actor or writes `experiments.approval_state` directly. A port may itself
 * wait for the real approval POST; `decideApproval` then returns `replayed`
 * and is verified. The alternative CLI wiring must obtain a verified Neon Auth
 * session through the existing auth path and return that user id; neither
 * wiring may synthesize an actor. Session acquisition and the browser/poll
 * loop belong to the seed entrypoint, not this module.
 *
 * Both specs can be reviewed before timing. Run B's candidate is Run A's spec
 * with one `parameters.<name>` leaf changed; the entrypoint computes it with
 * #66's exported pure helper (`applySingleLeafChange`) and passes it as
 * `runBCandidateSpec`. This module checks the candidate against the change and
 * later requires the real `branchWhatIf` result to hash-match it. The approval
 * port can therefore be a hash-keyed manifest collected before any execution,
 * while the durable decision still names each real gate.
 *
 * ---------------------------------------------------------------------------
 * Baseline identity
 * ---------------------------------------------------------------------------
 *
 * `spec.claimNodeId` is a UUID minted by each fresh graph seed, so the
 * concrete spec hash of two identical seeds differs. Approval uses the
 * concrete hash (that is the exact spec a person reviewed in that database),
 * but the captured baseline uses a logical hash with the claim UUID replaced
 * by `SEED_LOGICAL_CLAIM_TOKEN`. Everything else in the spec — files,
 * datasets, criteria, parameters, mode — still participates in the hash.
 */
import { createHash } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'

import type { Database } from '../../src/db/client'
import {
  appendPipelineEvent,
  claimExecutionStart,
  decideApproval,
  getApprovalGate,
  openApprovalGate,
  PipelineDbError,
  type PipelineEventInput,
} from '../../src/db/pipeline'
import type {
  ApprovalDecision,
  ApprovalGateView,
} from '../../src/db/pipeline-types'
import {
  approvalGates,
  edges,
  executionClaims,
  experiments,
  nodes,
  pipelineEvents,
  runArtifacts,
  runs,
  workspaceMembers,
  type ExperimentRow,
  type RunRow,
} from '../../src/db/schema'
import type { branchWhatIf, ParentRunSnapshot, WhatIfBranchStore } from '../../src/server/branch'
import { evaluateExperiment } from '../../src/server/evaluate-verdict'
import {
  PipelineStageError,
  type PipelineEmit,
  type PipelineExecutionResult,
  type PipelinePlanResult,
  type PipelineStageContext,
} from '../../src/server/pipeline-delivery/stages'
import { PINNED_IMAGE_PACKAGES } from '../../src/server/runner'
import type {
  ApprovalState,
  ExperimentSpec,
  Mode,
  NodeData,
  NodeType,
  RunEnvironment,
  RunStatus,
  Verdict,
  VerdictCheck,
} from '../../src/shared/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Matches the production SSE stream budget in docs/01-architecture.md. */
export const SEED_RUN_BUDGET_MS = 240_000

/**
 * The claim lease covers the human approval review plus the execution. It is
 * deliberately much longer than the execution budget: a person reading two
 * exact specs must not lose the gate to a sandbox-sized deadline. The
 * execution itself still gets its own `SEED_RUN_BUDGET_MS`.
 */
export const SEED_CLAIM_TTL_MS = 60 * 60_000

export const SEED_BASELINE_SCHEMA_VERSION = 1

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Prerequisite codes (`WHAT_IF_UNAVAILABLE`, `QUEUED_RUN_ADOPTION_UNAVAILABLE`)
 * are detected before any write and mean an owner integration is missing.
 * Every other code is a verification failure: the seed ran, but what it read
 * back is not the recorded workspace this issue promises.
 */
export type SeedRunErrorCode =
  | 'INVALID_INPUT'
  | 'WORKSPACE_NOT_FRESH'
  | 'APPROVER_NOT_WORKSPACE_MEMBER'
  | 'APPROVER_NOT_OPERATOR'
  | 'APPROVAL_SPEC_MISMATCH'
  | 'APPROVAL_REJECTED'
  | 'CLAIM_NOT_ACQUIRED'
  | 'PLAN_SPEC_MISMATCH'
  | 'REPAIR_APPROVAL_UNAVAILABLE'
  | 'PIPELINE_STAGE_FAILED'
  | 'PIPELINE_DB_FAILED'
  | 'RUN_NOT_CREATED'
  | 'RUN_ABORTED'
  | 'RUN_NOT_FOUND'
  | 'RUN_NOT_SUCCEEDED'
  | 'RUN_APPROVAL_MISMATCH'
  | 'RUN_SPEC_MISMATCH'
  | 'RUN_METRICS_INVALID'
  | 'RUN_VERDICT_MISMATCH'
  | 'RUN_ENVIRONMENT_MISMATCH'
  | 'RUN_ARTIFACTS_MISSING'
  | 'RUN_ARTIFACT_HASH_MISMATCH'
  | 'RUN_PROJECTION_MISMATCH'
  | 'RUN_LINEAGE_MISMATCH'
  | 'RUNS_NOT_DISTINCT'
  | 'WHAT_IF_UNAVAILABLE'
  | 'QUEUED_RUN_ADOPTION_UNAVAILABLE'
  | 'WHAT_IF_CONTRACT_VIOLATION'
  | 'BASELINE_SHAPE_MISMATCH'
  | 'BASELINE_MISMATCH'

export class SeedRunError extends Error {
  readonly code: SeedRunErrorCode
  readonly detail: Record<string, unknown> | undefined

  constructor(
    code: SeedRunErrorCode,
    message: string,
    options: { cause?: unknown; detail?: Record<string, unknown> } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    )
    this.name = 'SeedRunError'
    this.code = code
    this.detail = options.detail
  }
}

// ---------------------------------------------------------------------------
// Executor boundary
// ---------------------------------------------------------------------------

/**
 * The production stage methods this module drives, plus the explicit #62
 * capability. The flag is not inferred: after EXECUTE learns to adopt a
 * pre-created queued run, the entrypoint sets it truthfully. A stale `true`
 * cannot fabricate lineage — the post-execution checks still require the
 * adopted run id and `parentRunId`.
 */
export type SeedRunExecutor = {
  plan(context: PipelineStageContext): Promise<PipelinePlanResult>
  execute(
    context: PipelineStageContext,
    spec: ExperimentSpec,
  ): Promise<PipelineExecutionResult>
  adoptsQueuedRun: boolean
}

export type SeedRunExecutorOverride = {
  plan?: SeedRunExecutor['plan']
  execute?: SeedRunExecutor['execute']
  adoptsQueuedRun?: boolean
}

// ---------------------------------------------------------------------------
// Approval boundary
// ---------------------------------------------------------------------------

export type SeedRunLabel = 'run-a' | 'run-b'

/** The one parameter the what-if changes. Values are JSON-safe. */
export type SeedWhatIfParameter = {
  /** Leaf name under `spec.parameters`, e.g. `importance_method`. */
  parameterName: string
  /** The value present in Run A's spec. */
  runA: unknown
  /** The value the branch must put in Run B's spec. */
  runB: unknown
}

export type SeedSpecApprovalRequest = {
  label: SeedRunLabel
  experimentId: string
  workspaceId: string
  /** The persisted `approval.requested` seq, i.e. the gate identity. */
  gateSeq: number
  /** The exact spec read back from `approval_gates.offered_spec`. */
  offeredSpec: ExperimentSpec
  /**
   * SHA-256 of `canonicalJson(offeredSpec)`, lowercase hex. This is the
   * per-database identity and the hash the decision must echo.
   */
  specSha256: string
  /**
   * The same spec with the per-database claim UUID replaced by a token. Show
   * this alongside `specSha256` when comparing what was reviewed across two
   * fresh databases; the decision still binds to `specSha256`.
   */
  logicalSpecSha256: string
  /** Run B's pre-created queued run id; null for Run A. */
  runId: string | null
}

export type SeedSpecApprovalDecision = {
  decision: ApprovalDecision
  /** Verified Neon Auth user id. Must equal the seed's `operatorUserId`. */
  actorId: string
  /** The spec hash the operator actually reviewed; must equal the request's. */
  specSha256: string
}

export type SeedRunApprovalPort = (
  request: SeedSpecApprovalRequest,
) => Promise<SeedSpecApprovalDecision>

// ---------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------

export type SeedRunsInput = {
  db: Database
  workspaceId: string
  /** UUID of the real claim node the ingestion side created. */
  claimNodeId: string
  /** Verified Neon Auth id of the workspace account reviewing both gates. */
  operatorUserId: string
  /** The hero spec with `claimNodeId` rebound to the database node. */
  runASpec: ExperimentSpec
  /** The single what-if leaf. */
  change: SeedWhatIfParameter
  /**
   * Run B's spec computed before any execution, for the "review both exact
   * specs before timing" workflow. The entrypoint derives it with #66's
   * exported pure helper (`applySingleLeafChange`) or any equivalent
   * one-leaf transform. When supplied, the real branch must produce exactly
   * this spec; when omitted, the branch's own output is verified instead.
   */
  runBCandidateSpec?: ExperimentSpec
  approve: SeedRunApprovalPort
  /**
   * The real `branchWhatIf` and `createDrizzleWhatIfBranchStore` (PR #66).
   * Required: issue #8's recorded workspace contains both runs.
   */
  whatIf?: {
    branch: typeof branchWhatIf
    store: WhatIfBranchStore
  }
  /** Defaults to the real production stage provider. */
  executor?: SeedRunExecutorOverride
  /** Defaults to true: the recorded runs carry verifiable artifacts. */
  requireArtifacts?: boolean
  /** Defaults to true: inline artifact bytes must match their hash. */
  requireArtifactContent?: boolean
  /** Per-experiment execution budget. Defaults to 240 s. */
  budgetMs?: number
  /** Claim lease. Defaults to budget + 60 s. */
  claimTtlMs?: number
  signal?: AbortSignal
  /** Test seam for the execution-claim idempotency key. */
  randomUUID?: () => string
}

export type SeedGateRecord = {
  experimentId: string
  gateSeq: number
  state: 'approved' | 'rejected'
  /** Concrete per-database hash of the offered spec. */
  offeredSpecSha256: string
  /** Cross-database hash of the same spec (claim UUID tokenised). */
  offeredLogicalSpecSha256: string
  decidedBy: string | null
}

export type SeedRunRecord = {
  label: SeedRunLabel
  experimentId: string
  runId: string
  status: RunStatus
  verdict: Verdict
  metrics: Record<string, number>
  /** Concrete per-database hash of the executed spec. */
  specSha256: string
  /** Cross-database hash of the executed spec (claim UUID tokenised). */
  logicalSpecSha256: string
  parentRunId: string | null
  artifactCount: number
  /** Graph nodes written by `projectRunToGraph` for this run. */
  runNodeId: string
  resultNodeId: string
}

export type SeedRunsResult = {
  runA: SeedRunRecord
  runB: SeedRunRecord
  approval: { runA: SeedGateRecord; runB: SeedGateRecord }
  baseline: SeedRunBaseline
}

// ---------------------------------------------------------------------------
// Canonical JSON and hashing
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const child = value[key]
      if (child !== undefined) sorted[key] = sortJsonValue(child)
    }
    return sorted
  }
  return value
}

/**
 * Stable JSON used for hashing, comparisons and baseline snapshots. Object key
 * order is not part of a plan or a measurement, so it must not change a hash.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

/** SHA-256 of the canonical spec JSON, lowercase hex. */
export function hashExperimentSpec(spec: ExperimentSpec): string {
  return createHash('sha256').update(canonicalJson(spec), 'utf8').digest('hex')
}

/**
 * Logical stand-in for the per-database claim node UUID. Two fresh graph seeds
 * mint different claim ids; the run baseline must still compare.
 */
export const SEED_LOGICAL_CLAIM_TOKEN = 'claim:recorded'

/** Canonical spec JSON with the concrete claim UUID replaced by a token. */
export function logicalSpecCanonicalJson(spec: ExperimentSpec): string {
  const copy = JSON.parse(JSON.stringify(spec)) as ExperimentSpec
  copy.claimNodeId = SEED_LOGICAL_CLAIM_TOKEN
  return canonicalJson(copy)
}

/**
 * Cross-database spec identity. Use this for the canonical baseline; use
 * `hashExperimentSpec` for the exact spec a person approved in one database.
 */
export function hashLogicalExperimentSpec(spec: ExperimentSpec): string {
  return createHash('sha256')
    .update(logicalSpecCanonicalJson(spec), 'utf8')
    .digest('hex')
}

// ---------------------------------------------------------------------------
// Spec diffs (verification only; #66 owns mutation)
// ---------------------------------------------------------------------------

export type SeedLeafDiff = { path: string; before: unknown; after: unknown }

/**
 * Reports every leaf that differs between two JSON values, using dotted paths.
 * Arrays are compared positionally; a length change is one diff at the array
 * path. This is a read-only check: it never mutates or repairs a spec.
 */
export function collectSpecLeafDiffs(
  before: unknown,
  after: unknown,
  path = '',
): SeedLeafDiff[] {
  if (canonicalJson(before) === canonicalJson(after)) return []

  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) {
      return [{ path: path || '$', before, after }]
    }
    return before.flatMap((item, index) =>
      collectSpecLeafDiffs(
        item,
        after[index],
        path === '' ? String(index) : `${path}.${index}`,
      ),
    )
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    return [...keys]
      .sort()
      .flatMap((key) =>
        collectSpecLeafDiffs(
          before[key],
          after[key],
          path === '' ? key : `${path}.${key}`,
        ),
      )
  }

  return [{ path: path || '$', before, after }]
}

// ---------------------------------------------------------------------------
// Artifact verification
// ---------------------------------------------------------------------------

export type ArtifactContentCheck = {
  valid: boolean
  encoding: 'base64' | 'utf8'
  sha256: string
  bytes: number
}

/**
 * Verifies stored artifact bytes against the row's `sha256` and `bytes`.
 *
 * The E2B runner stores base64-encoded bytes in `ExperimentResult.artifacts`;
 * a text artifact writer may store UTF-8. Both are accepted, in that order,
 * but only when both the digest and the byte count match. Artifacts with
 * `content: null` cannot be checked this way and are rejected by the seed
 * unless the caller explicitly allows unverifiable external artifacts.
 */
export function verifyArtifactContent(
  content: string,
  expectedSha256: string,
  expectedBytes: number,
): ArtifactContentCheck {
  const isCanonicalBase64 =
    content.length > 0 &&
    content.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(content)

  if (isCanonicalBase64) {
    const bytes = Buffer.from(content, 'base64')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 === expectedSha256 && bytes.byteLength === expectedBytes) {
      return { valid: true, encoding: 'base64', sha256, bytes: bytes.byteLength }
    }
  }

  const bytes = Buffer.from(content, 'utf8')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return {
    valid: sha256 === expectedSha256 && bytes.byteLength === expectedBytes,
    encoding: 'utf8',
    sha256,
    bytes: bytes.byteLength,
  }
}

// ---------------------------------------------------------------------------
// Baseline snapshot types
// ---------------------------------------------------------------------------

export type SeedRunProjectionSnapshot = {
  runNode: { title: string; status: RunStatus; mode: Mode } | null
  resultNode: {
    title: string
    metrics: Record<string, number>
    verdict: Verdict | null
  } | null
  producedEdge: { status: string; evidenceIsRun: boolean } | null
}

export type SeedArtifactSnapshot = {
  kind: string
  path: string
  sha256: string
  bytes: number
  /** Hash of the inline bytes, or null when the artifact is external. */
  contentSha256: string | null
  contentEncoding: 'base64' | 'utf8' | null
}

export type SeedBaselineRun = {
  label: SeedRunLabel
  parentLabel: SeedRunLabel | null
  attempt: number
  status: RunStatus
  runner: string
  mode: Mode
  /** Cross-database hash: the per-DB claim UUID is replaced by a token. */
  logicalSpecSha256: string
  parametersCanonical: string
  metrics: Record<string, number>
  verdict: Verdict
  verdictChecks: VerdictCheck[]
  /** Prose is model output and cannot be part of a deterministic baseline. */
  explanationPresent: boolean
  environment: {
    imageDigest: string
    python: string
    packages: Record<string, string>
    datasets: Array<{ name: string; sha256: string; bytes: number }>
    seeds: number[]
  }
  artifacts: SeedArtifactSnapshot[]
  projection: SeedRunProjectionSnapshot
  approval: {
    state: ApprovalState
    /** Logical hash; the concrete per-DB hash is in `SeedGateRecord`. */
    offeredLogicalSpecSha256: string
    decidedBy: string | null
    decisionEventRecorded: boolean
  }
  claimCloseReason: 'completed' | 'failed' | 'cancelled' | null
  /** Ordered durable event types only; seq and timestamps are excluded. */
  eventTypes: string[]
}

export type SeedRunBaseline = {
  schemaVersion: typeof SEED_BASELINE_SCHEMA_VERSION
  runs: SeedBaselineRun[]
}

export type SeedBaselineDifference = {
  path: string
  left: unknown
  right: unknown
}

export type SeedBaselineComparison = {
  equal: boolean
  differences: SeedBaselineDifference[]
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

type GraphNodeRow = {
  id: string
  type: NodeType
  title: string
  data: NodeData
}

export type VerifiedSeedRun = {
  run: RunRow
  experiment: ExperimentRow
  artifacts: SeedArtifactSnapshot[]
  projection: SeedRunProjectionSnapshot
  /** Graph node ids, for the entrypoint's method/dataset/lineage edges. */
  nodeIds: { runNodeId: string; resultNodeId: string }
}

function asRunNode(row: GraphNodeRow) {
  return row.data.type === 'run' ? row.data : null
}

function asResultNode(row: GraphNodeRow) {
  return row.data.type === 'result' ? row.data : null
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type VerifySeedRunInput = {
  db: Database
  workspaceId: string
  runId: string
  expectedSpec?: ExperimentSpec
  expectedParentRunId?: string | null
  requireArtifacts?: boolean
  requireArtifactContent?: boolean
}

/**
 * Reads one terminal run back from the database and proves that every claim
 * the seed will make about it is true:
 *
 * - the frozen `runs.spec` is the approved experiment spec;
 * - the run succeeded and its measured metrics are finite and cover every
 *   criterion;
 * - the stored verdict is exactly what `evaluateExperiment` computes from the
 *   measured metrics (the model's prose is not consulted);
 * - the pinned Python packages and the pinned dataset hashes/bytes are the
 *   ones the spec declared;
 * - every artifact's inline bytes hash to its recorded sha256 and byte count;
 * - the run→result projection exists, is accepted, carries the run as
 *   evidence, and repeats the authoritative metrics and verdict.
 *
 * Throws `SeedRunError` on the first violation. It never repairs or writes.
 */
export async function verifySeedRun(
  input: VerifySeedRunInput,
): Promise<VerifiedSeedRun> {
  const requireArtifacts = input.requireArtifacts ?? true
  const requireArtifactContent = input.requireArtifactContent ?? true

  const [joined] = await input.db
    .select({ run: runs, experiment: experiments })
    .from(runs)
    .innerJoin(experiments, eq(experiments.id, runs.experimentId))
    .where(
      and(
        eq(runs.id, input.runId),
        eq(experiments.workspaceId, input.workspaceId),
      ),
    )
    .limit(1)

  if (!joined) {
    throw new SeedRunError(
      'RUN_NOT_FOUND',
      `run ${input.runId} does not exist in workspace ${input.workspaceId}`,
    )
  }

  const { run, experiment } = joined
  const runSpecHash = hashExperimentSpec(run.spec)
  const experimentSpecHash = hashExperimentSpec(experiment.spec)

  if (runSpecHash !== experimentSpecHash) {
    throw new SeedRunError(
      'RUN_SPEC_MISMATCH',
      `run ${run.id} did not execute the experiment's frozen spec`,
      { detail: { runSpecHash, experimentSpecHash } },
    )
  }

  if (input.expectedSpec && hashExperimentSpec(input.expectedSpec) !== runSpecHash) {
    throw new SeedRunError(
      'RUN_SPEC_MISMATCH',
      `run ${run.id} executed a spec other than the approved one`,
      {
        detail: {
          runSpecHash,
          expectedSpecHash: hashExperimentSpec(input.expectedSpec),
        },
      },
    )
  }

  const parentRunId = run.parentRunId ?? null
  if (
    input.expectedParentRunId !== undefined &&
    parentRunId !== input.expectedParentRunId
  ) {
    throw new SeedRunError(
      'RUN_LINEAGE_MISMATCH',
      `run ${run.id} has parentRunId ${parentRunId}, expected ${input.expectedParentRunId}`,
    )
  }

  // Production EXECUTE itself does not check the gate; the seed must not treat
  // a run as recorded evidence unless a human-approved experiment produced it.
  if (
    experiment.approvalState !== 'approved' ||
    experiment.approvedBy === null
  ) {
    throw new SeedRunError(
      'RUN_APPROVAL_MISMATCH',
      `run ${run.id} belongs to an experiment that is ${experiment.approvalState}, not approved by a recorded actor`,
    )
  }

  if (run.status !== 'succeeded') {
    throw new SeedRunError(
      'RUN_NOT_SUCCEEDED',
      `run ${run.id} is ${run.status}; the recorded workspace requires a succeeded run`,
      {
        detail: {
          status: run.status,
          stderrTail: run.stderr.slice(-400),
        },
      },
    )
  }

  const metricEntries = Object.entries(run.metrics)
  if (metricEntries.length === 0) {
    throw new SeedRunError(
      'RUN_METRICS_INVALID',
      `run ${run.id} wrote no metrics`,
    )
  }
  for (const [metric, value] of metricEntries) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new SeedRunError(
        'RUN_METRICS_INVALID',
        `run ${run.id} metric "${metric}" is not a finite number`,
      )
    }
  }
  for (const check of run.spec.criteria.checks) {
    if (!(check.metric in run.metrics)) {
      throw new SeedRunError(
        'RUN_METRICS_INVALID',
        `run ${run.id} is missing criterion metric "${check.metric}"`,
      )
    }
  }

  if (!run.verdict || !run.verdictDetail) {
    throw new SeedRunError(
      'RUN_VERDICT_MISMATCH',
      `run ${run.id} has no stored verdict or verdict detail`,
    )
  }

  const recomputed = evaluateExperiment(run.spec, {
    exitCode: 0,
    stdout: run.stdout,
    stderr: run.stderr,
    metrics: run.metrics,
    artifacts: [],
    durationMs: 0,
    environment: run.environment,
  })

  if (recomputed.verdict !== run.verdict) {
    throw new SeedRunError(
      'RUN_VERDICT_MISMATCH',
      `run ${run.id} stored verdict ${run.verdict}, but the criteria compute ${recomputed.verdict}`,
    )
  }
  if (
    canonicalJson(recomputed.detail.checks) !==
    canonicalJson(run.verdictDetail.checks)
  ) {
    throw new SeedRunError(
      'RUN_VERDICT_MISMATCH',
      `run ${run.id} verdict detail does not match the deterministic evaluation`,
    )
  }

  for (const [name, version] of Object.entries(PINNED_IMAGE_PACKAGES)) {
    const measured = run.environment.packages[name.toLowerCase()]
    if (measured !== version) {
      throw new SeedRunError(
        'RUN_ENVIRONMENT_MISMATCH',
        `run ${run.id} reports ${name}=${measured ?? 'missing'}, expected ${version}`,
      )
    }
  }
  if (run.environment.packages['__pip_error__'] !== undefined) {
    throw new SeedRunError(
      'RUN_ENVIRONMENT_MISMATCH',
      `run ${run.id} could not read the pinned package list`,
    )
  }

  for (const ref of run.spec.datasets) {
    if (!ref.sha256 || ref.bytes === null) {
      throw new SeedRunError(
        'RUN_ENVIRONMENT_MISMATCH',
        `dataset "${ref.name}" is not pinned in the approved spec`,
      )
    }
    const measured = run.environment.datasets.find(
      (dataset) => dataset.name === ref.name,
    )
    if (
      !measured ||
      measured.sha256 !== ref.sha256 ||
      measured.bytes !== ref.bytes
    ) {
      throw new SeedRunError(
        'RUN_ENVIRONMENT_MISMATCH',
        `run ${run.id} did not record the pinned hash and size for dataset "${ref.name}"`,
        {
          detail: {
            expected: { sha256: ref.sha256, bytes: ref.bytes },
            measured: measured ?? null,
          },
        },
      )
    }
  }

  const artifactRows = await input.db
    .select()
    .from(runArtifacts)
    .where(eq(runArtifacts.runId, run.id))
    .orderBy(asc(runArtifacts.path), asc(runArtifacts.id))

  if (requireArtifacts && artifactRows.length === 0) {
    throw new SeedRunError(
      'RUN_ARTIFACTS_MISSING',
      `run ${run.id} has no run_artifacts rows`,
    )
  }

  const artifacts: SeedArtifactSnapshot[] = artifactRows.map((artifact) => {
    if (
      artifact.path.trim() === '' ||
      artifact.kind.trim() === '' ||
      artifact.sha256.trim() === '' ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 0
    ) {
      throw new SeedRunError(
        'RUN_ARTIFACT_HASH_MISMATCH',
        `run ${run.id} has an artifact row with missing path, kind, hash or size`,
        { detail: { artifactId: artifact.id } },
      )
    }

    if (artifact.content === null) {
      if (requireArtifactContent) {
        throw new SeedRunError(
          'RUN_ARTIFACT_HASH_MISMATCH',
          `artifact ${artifact.path} for run ${run.id} has no inline bytes to verify`,
        )
      }
      return {
        kind: artifact.kind,
        path: artifact.path,
        sha256: artifact.sha256,
        bytes: artifact.bytes,
        contentSha256: null,
        contentEncoding: null,
      }
    }

    const check = verifyArtifactContent(
      artifact.content,
      artifact.sha256,
      artifact.bytes,
    )
    if (!check.valid) {
      throw new SeedRunError(
        'RUN_ARTIFACT_HASH_MISMATCH',
        `artifact ${artifact.path} for run ${run.id} does not hash to its recorded sha256/bytes`,
      )
    }

    return {
      kind: artifact.kind,
      path: artifact.path,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
      contentSha256: check.sha256,
      contentEncoding: check.encoding,
    }
  })

  const graphNodes: GraphNodeRow[] = await input.db
    .select({
      id: nodes.id,
      type: nodes.type,
      title: nodes.title,
      data: nodes.data,
    })
    .from(nodes)
    .where(
      and(
        eq(nodes.workspaceId, input.workspaceId),
        inArray(nodes.type, ['run', 'result']),
      ),
    )

  const runNodeRow = graphNodes.find((row) => {
    const data = asRunNode(row)
    return data !== null && data.runId === run.id
  })
  const resultNodeRow = graphNodes.find((row) => {
    const data = asResultNode(row)
    return data !== null && data.runId === run.id
  })

  if (!runNodeRow || !resultNodeRow) {
    throw new SeedRunError(
      'RUN_PROJECTION_MISMATCH',
      `run ${run.id} is not projected into the graph with both a run and a result node`,
    )
  }

  const runData = asRunNode(runNodeRow)
  const resultData = asResultNode(resultNodeRow)
  if (!runData || !resultData) {
    throw new SeedRunError(
      'RUN_PROJECTION_MISMATCH',
      `run ${run.id} projection has a node with the wrong type`,
    )
  }
  if (runData.status !== run.status || runData.mode !== run.spec.mode) {
    throw new SeedRunError(
      'RUN_PROJECTION_MISMATCH',
      `run ${run.id} node data disagrees with the run row`,
    )
  }
  if (
    canonicalJson(resultData.metrics) !== canonicalJson(run.metrics) ||
    resultData.verdict !== run.verdict
  ) {
    throw new SeedRunError(
      'RUN_PROJECTION_MISMATCH',
      `result node for run ${run.id} disagrees with the run row`,
    )
  }

  const [producedEdge] = await input.db
    .select({
      status: edges.status,
      evidenceRunId: edges.evidenceRunId,
    })
    .from(edges)
    .where(
      and(
        eq(edges.workspaceId, input.workspaceId),
        eq(edges.sourceNodeId, runNodeRow.id),
        eq(edges.targetNodeId, resultNodeRow.id),
        eq(edges.relation, 'produced'),
      ),
    )
    .limit(1)

  if (
    !producedEdge ||
    producedEdge.status !== 'accepted' ||
    producedEdge.evidenceRunId !== run.id
  ) {
    throw new SeedRunError(
      'RUN_PROJECTION_MISMATCH',
      `run ${run.id} has no accepted produced edge carrying the run as evidence`,
    )
  }

  return {
    run,
    experiment,
    artifacts,
    nodeIds: {
      runNodeId: runNodeRow.id,
      resultNodeId: resultNodeRow.id,
    },
    projection: {
      runNode: {
        title: runNodeRow.title,
        status: runData.status,
        mode: runData.mode,
      },
      resultNode: {
        title: resultNodeRow.title,
        metrics: resultData.metrics,
        verdict: resultData.verdict,
      },
      producedEdge: {
        status: producedEdge.status,
        evidenceIsRun: producedEdge.evidenceRunId === run.id,
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Baseline capture and comparison
// ---------------------------------------------------------------------------

function requireGate(
  gateRows: Array<typeof approvalGates.$inferSelect>,
  experimentId: string,
): typeof approvalGates.$inferSelect {
  const rows = gateRows.filter((gate) => gate.experimentId === experimentId)
  if (rows.length !== 1) {
    throw new SeedRunError(
      'BASELINE_SHAPE_MISMATCH',
      `experiment ${experimentId} has ${rows.length} approval gates; the recorded workspace has exactly one`,
    )
  }
  const gate = rows[0]!
  if (gate.status !== 'approved') {
    throw new SeedRunError(
      'BASELINE_SHAPE_MISMATCH',
      `experiment ${experimentId} gate is ${gate.status}, not approved`,
    )
  }
  return gate
}

function requireClaim(
  claimRows: Array<typeof executionClaims.$inferSelect>,
  experimentId: string,
): typeof executionClaims.$inferSelect {
  const rows = claimRows.filter(
    (claim) => claim.experimentId === experimentId,
  )
  if (rows.length !== 1) {
    throw new SeedRunError(
      'BASELINE_SHAPE_MISMATCH',
      `experiment ${experimentId} has ${rows.length} execution claims; the recorded workspace has exactly one`,
    )
  }
  return rows[0]!
}

function requireEventTypes(
  allEvents: Array<{ experimentId: string; type: string }>,
  experimentId: string,
): string[] {
  const types = allEvents
    .filter((event) => event.experimentId === experimentId)
    .map((event) => event.type)

  if (types.length === 0) {
    throw new SeedRunError(
      'BASELINE_SHAPE_MISMATCH',
      `experiment ${experimentId} has no durable pipeline events`,
    )
  }
  if (types[0] !== 'pipeline.started') {
    throw new SeedRunError(
      'BASELINE_SHAPE_MISMATCH',
      `experiment ${experimentId} event log does not start with pipeline.started`,
    )
  }
  if (types[types.length - 1] !== 'pipeline.completed') {
    throw new SeedRunError(
      'BASELINE_SHAPE_MISMATCH',
      `experiment ${experimentId} event log does not end with pipeline.completed`,
    )
  }
  for (const required of ['approval.requested', 'approval.resolved']) {
    if (!types.includes(required)) {
      throw new SeedRunError(
        'BASELINE_SHAPE_MISMATCH',
        `experiment ${experimentId} event log is missing ${required}`,
      )
    }
  }
  return types
}

function toBaselineRun(
  verified: VerifiedSeedRun,
  label: SeedRunLabel,
  parentLabel: SeedRunLabel | null,
  gate: typeof approvalGates.$inferSelect,
  claim: typeof executionClaims.$inferSelect,
  eventTypes: string[],
): SeedBaselineRun {
  const { run } = verified
  if (!run.verdict || !run.verdictDetail) {
    throw new SeedRunError(
      'RUN_VERDICT_MISMATCH',
      `run ${run.id} has no stored verdict`,
    )
  }

  return {
    label,
    parentLabel,
    attempt: run.attempt,
    status: run.status,
    runner: run.runner,
    mode: run.spec.mode,
    logicalSpecSha256: hashLogicalExperimentSpec(run.spec),
    parametersCanonical: canonicalJson(run.spec.parameters),
    metrics: run.metrics,
    verdict: run.verdict,
    verdictChecks: run.verdictDetail.checks,
    explanationPresent:
      typeof run.verdictDetail.explanation === 'string' &&
      run.verdictDetail.explanation.length > 0,
    environment: {
      imageDigest: run.environment.imageDigest,
      python: run.environment.python,
      packages: run.environment.packages,
      datasets: run.environment.datasets,
      seeds: run.environment.seeds,
    },
    artifacts: verified.artifacts,
    projection: verified.projection,
    approval: {
      state: gate.status,
      offeredLogicalSpecSha256: hashLogicalExperimentSpec(gate.offeredSpec),
      decidedBy: gate.decidedBy,
      decisionEventRecorded: gate.decisionEventSeq !== null,
    },
    claimCloseReason: claim.closeReason,
    eventTypes,
  }
}

export type CaptureSeedRunBaselineOptions = {
  workspaceId: string
  requireArtifacts?: boolean
  requireArtifactContent?: boolean
}

/**
 * Captures the logical, ID-free baseline of the two recorded runs.
 *
 * The baseline is what a second live seed on a separate fresh database must
 * reproduce exactly: spec hashes, canonical parameters, measured metrics,
 * deterministic verdict checks, pinned environment and dataset hashes,
 * artifact hashes, run/result projection data, gate offered-spec hashes and
 * decisions, claim closure and event-type order. Database-generated UUIDs,
 * timestamps, durations, stdout and model prose are excluded by design.
 *
 * The function refuses anything other than the recorded shape: one root run
 * and one what-if child whose specs differ by exactly one `parameters.*` leaf.
 */
export async function captureSeedRunBaseline(
  db: Database,
  options: CaptureSeedRunBaselineOptions,
): Promise<SeedRunBaseline> {
  const requireArtifacts = options.requireArtifacts ?? true
  const requireArtifactContent = options.requireArtifactContent ?? true

  const experimentRows = await db
    .select()
    .from(experiments)
    .where(eq(experiments.workspaceId, options.workspaceId))
    .orderBy(asc(experiments.createdAt), asc(experiments.id))

  if (experimentRows.length !== 2) {
    throw new SeedRunError(
      'BASELINE_SHAPE_MISMATCH',
      `workspace ${options.workspaceId} has ${experimentRows.length} experiments; the recorded workspace has exactly two`,
    )
  }

  const runRows = await db
    .select({ run: runs, experiment: experiments })
    .from(runs)
    .innerJoin(experiments, eq(experiments.id, runs.experimentId))
    .where(eq(experiments.workspaceId, options.workspaceId))
    .orderBy(asc(runs.createdAt), asc(runs.id))

  if (runRows.length !== 2) {
    throw new SeedRunError(
      'BASELINE_SHAPE_MISMATCH',
      `workspace ${options.workspaceId} has ${runRows.length} runs; the recorded workspace has exactly two`,
    )
  }

  const root = runRows.find((row) => row.run.parentRunId === null)
  const child = runRows.find(
    (row) => row.run.parentRunId !== null && row.run.parentRunId === root?.run.id,
  )

  if (!root || !child) {
    throw new SeedRunError(
      'BASELINE_SHAPE_MISMATCH',
      'the recorded workspace must contain one root run and one child run chained by parentRunId',
    )
  }

  const rootVerified = await verifySeedRun({
    db,
    workspaceId: options.workspaceId,
    runId: root.run.id,
    expectedParentRunId: null,
    requireArtifacts,
    requireArtifactContent,
  })
  const childVerified = await verifySeedRun({
    db,
    workspaceId: options.workspaceId,
    runId: child.run.id,
    expectedParentRunId: root.run.id,
    requireArtifacts,
    requireArtifactContent,
  })

  const diffs = collectSpecLeafDiffs(
    rootVerified.run.spec,
    childVerified.run.spec,
  )
  if (diffs.length !== 1 || !diffs[0]!.path.startsWith('parameters.')) {
    throw new SeedRunError(
      'BASELINE_SHAPE_MISMATCH',
      'the what-if child spec must differ from its parent by exactly one parameters.* leaf',
      { detail: { diffs } },
    )
  }

  const experimentIds = experimentRows.map((experiment) => experiment.id)
  const gateRows = await db
    .select()
    .from(approvalGates)
    .where(
      and(
        eq(approvalGates.workspaceId, options.workspaceId),
        inArray(approvalGates.experimentId, experimentIds),
      ),
    )
  const claimRows = await db
    .select()
    .from(executionClaims)
    .where(
      and(
        eq(executionClaims.workspaceId, options.workspaceId),
        inArray(executionClaims.experimentId, experimentIds),
      ),
    )
  const eventRows = await db
    .select({
      experimentId: pipelineEvents.experimentId,
      type: pipelineEvents.type,
      seq: pipelineEvents.seq,
    })
    .from(pipelineEvents)
    .where(
      and(
        eq(pipelineEvents.workspaceId, options.workspaceId),
        inArray(pipelineEvents.experimentId, experimentIds),
      ),
    )
    .orderBy(asc(pipelineEvents.experimentId), asc(pipelineEvents.seq))

  const rootGate = requireGate(gateRows, rootVerified.experiment.id)
  const childGate = requireGate(gateRows, childVerified.experiment.id)
  const rootClaim = requireClaim(claimRows, rootVerified.experiment.id)
  const childClaim = requireClaim(claimRows, childVerified.experiment.id)

  // The gate decision is bound to the exact offered plan. A run whose frozen
  // spec is not that plan must never become the recorded evidence.
  if (
    hashExperimentSpec(rootGate.offeredSpec) !==
      hashExperimentSpec(rootVerified.run.spec) ||
    hashExperimentSpec(childGate.offeredSpec) !==
      hashExperimentSpec(childVerified.run.spec)
  ) {
    throw new SeedRunError(
      'BASELINE_SHAPE_MISMATCH',
      'an approval gate offered a different spec than the run that executed',
    )
  }

  if (rootClaim.closeReason !== 'completed') {
    throw new SeedRunError(
      'BASELINE_SHAPE_MISMATCH',
      `root experiment claim closed as ${rootClaim.closeReason ?? 'open'}, not completed`,
    )
  }
  if (childClaim.closeReason !== 'completed') {
    throw new SeedRunError(
      'BASELINE_SHAPE_MISMATCH',
      `child experiment claim closed as ${childClaim.closeReason ?? 'open'}, not completed`,
    )
  }

  return {
    schemaVersion: SEED_BASELINE_SCHEMA_VERSION,
    runs: [
      toBaselineRun(
        rootVerified,
        'run-a',
        null,
        rootGate,
        rootClaim,
        requireEventTypes(eventRows, rootVerified.experiment.id),
      ),
      toBaselineRun(
        childVerified,
        'run-b',
        'run-a',
        childGate,
        childClaim,
        requireEventTypes(eventRows, childVerified.experiment.id),
      ),
    ],
  }
}

function collectJsonDifferences(
  left: unknown,
  right: unknown,
  path: string,
  differences: SeedBaselineDifference[],
): void {
  if (canonicalJson(left) === canonicalJson(right)) return

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      differences.push({ path, left, right })
    }
    const length = Math.min(left.length, right.length)
    for (let index = 0; index < length; index += 1) {
      collectJsonDifferences(
        left[index],
        right[index],
        `${path}[${index}]`,
        differences,
      )
    }
    return
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of [...keys].sort()) {
      collectJsonDifferences(
        left[key],
        right[key],
        `${path}.${key}`,
        differences,
      )
    }
    return
  }

  differences.push({ path, left, right })
}

/**
 * Compares two captured baselines leaf by leaf. Equal logical workspaces give
 * an empty difference list regardless of database UUIDs, timestamps or prose.
 */
export function compareSeedRunBaselines(
  left: SeedRunBaseline,
  right: SeedRunBaseline,
): SeedBaselineComparison {
  const differences: SeedBaselineDifference[] = []
  collectJsonDifferences(left, right, '$', differences)
  return { equal: differences.length === 0, differences }
}

/** Throws `SeedRunError('BASELINE_MISMATCH')` with the first 25 differences. */
export function assertSeedRunBaselinesMatch(
  left: SeedRunBaseline,
  right: SeedRunBaseline,
): void {
  const comparison = compareSeedRunBaselines(left, right)
  if (comparison.equal) return

  throw new SeedRunError(
    'BASELINE_MISMATCH',
    `the two live seeds differ in ${comparison.differences.length} place(s)`,
    { detail: { differences: comparison.differences.slice(0, 25) } },
  )
}

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SeedRunError('INVALID_INPUT', `${name} must be a non-empty string`)
  }
  return value
}

async function assertWorkspaceMember(
  db: Database,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const [member] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1)

  if (!member) {
    throw new SeedRunError(
      'APPROVER_NOT_WORKSPACE_MEMBER',
      `user ${userId} is not a member of workspace ${workspaceId}`,
    )
  }
}

/**
 * Builds the real seed executor: production PLAN/EXECUTE plus the #62
 * queued-run adoption capability. The import is lazy so pure verification
 * helpers stay importable without constructing the E2B and Gemini SDKs.
 */
export async function createProductionSeedExecutor(
  db: Database,
): Promise<SeedRunExecutor> {
  const { createProductionPipelineStages } = await import(
    '../../src/server/pipeline-delivery/production-stages'
  )
  const stages = createProductionPipelineStages({ db })
  return {
    plan: (context) => stages.plan(context),
    execute: (context, spec) => stages.execute(context, spec),
    // The production EXECUTE on this branch includes #62: it adopts a queued
    // attempt-1 child run with a parent instead of inserting an unlinked row.
    adoptsQueuedRun: true,
  }
}

async function resolveExecutor(
  db: Database,
  override: SeedRunExecutorOverride | undefined,
): Promise<SeedRunExecutor> {
  if (!override?.plan || !override.execute) {
    const base = await createProductionSeedExecutor(db)
    return {
      plan: override?.plan ?? base.plan,
      execute: override?.execute ?? base.execute,
      // Omitting `execute` keeps the production implementation, including its
      // adoption capability. A replaced `execute` must state the capability.
      adoptsQueuedRun:
        override?.adoptsQueuedRun ??
        (override?.execute === undefined ? true : false),
    }
  }

  return {
    plan: override.plan,
    execute: override.execute,
    adoptsQueuedRun: override.adoptsQueuedRun ?? false,
  }
}

function withExecutionBudget(
  external: AbortSignal | undefined,
  budgetMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(budgetMs)
  return external ? AbortSignal.any([external, timeout]) : timeout
}

/** A signal that only fires when the caller aborts the whole seed. */
function externalSignal(input: SeedRunsInput): AbortSignal {
  return input.signal ?? new AbortController().signal
}

function stageFailureMessage(error: unknown): string {
  if (error instanceof PipelineStageError) return error.safeMessage
  if (error instanceof SeedRunError) return error.message
  return 'The experiment pipeline did not complete'
}

// ---------------------------------------------------------------------------
// seedRuns
// ---------------------------------------------------------------------------

type ExecuteRunParams = {
  label: SeedRunLabel
  experimentId: string
  expectedSpec: ExperimentSpec
  expectedRunId: string | null
  expectedParentRunId: string | null
  requireArtifacts: boolean
  requireArtifactContent: boolean
}

type ExecuteRunResult = {
  record: SeedRunRecord
  gate: SeedGateRecord
  verified: VerifiedSeedRun
}

/**
 * Rebuilds the two recorded reproduction runs from an empty database.
 *
 * The call is intentionally strict:
 *
 * - a workspace with existing experiments is refused (`WORKSPACE_NOT_FRESH`);
 * - the real what-if service and the #62 queued-run adoption capability are
 *   required before any write, because issue #8's workspace has both runs;
 * - both gates are decided through the production approval service by the
 *   caller-supplied verified operator;
 * - no metric, verdict, artifact or lineage value is written by this module;
 *   everything is read back and verified;
 * - a mismatch throws. There is no partial-success return.
 *
 * The returned `baseline` covers the run slice only. The entrypoint composes
 * it with the ingestion/graph slice to compare two fresh live seeds.
 */
export async function seedRuns(input: SeedRunsInput): Promise<SeedRunsResult> {
  const workspaceId = requireString(input.workspaceId, 'workspaceId')
  const claimNodeId = requireString(input.claimNodeId, 'claimNodeId')
  const operatorUserId = requireString(
    input.operatorUserId,
    'operatorUserId',
  )
  const changeParameterName = requireString(
    input.change?.parameterName,
    'change.parameterName',
  )
  const expectedChangePath = `parameters.${changeParameterName}`
  const requireArtifacts = input.requireArtifacts ?? true
  const requireArtifactContent = input.requireArtifactContent ?? true
  const budgetMs = input.budgetMs ?? SEED_RUN_BUDGET_MS
  const claimTtlMs = input.claimTtlMs ?? SEED_CLAIM_TTL_MS

  if (!Number.isSafeInteger(budgetMs) || budgetMs <= 0) {
    throw new SeedRunError(
      'INVALID_INPUT',
      'budgetMs must be a positive integer',
    )
  }
  if (!Number.isSafeInteger(claimTtlMs) || claimTtlMs <= budgetMs) {
    throw new SeedRunError(
      'INVALID_INPUT',
      'claimTtlMs must be a positive integer greater than budgetMs',
    )
  }
  if (typeof input.approve !== 'function') {
    throw new SeedRunError(
      'INVALID_INPUT',
      'approve must be a SeedRunApprovalPort; there is no built-in approver',
    )
  }
  if (!input.whatIf) {
    throw new SeedRunError(
      'WHAT_IF_UNAVAILABLE',
      'the real what-if branch service (src/server/branch.ts, PR #66) is required: the recorded workspace contains Run A and Run B',
    )
  }

  const executor = await resolveExecutor(input.db, input.executor)
  if (!executor.adoptsQueuedRun) {
    throw new SeedRunError(
      'QUEUED_RUN_ADOPTION_UNAVAILABLE',
      'production EXECUTE does not yet adopt the queued what-if run (issue #62); refusing to create a child run without lineage',
    )
  }

  if (input.runASpec.claimNodeId !== claimNodeId) {
    throw new SeedRunError(
      'INVALID_INPUT',
      'runASpec.claimNodeId must be rebound to the workspace claim node',
      {
        detail: {
          specClaimNodeId: input.runASpec.claimNodeId,
          claimNodeId,
        },
      },
    )
  }
  if (
    canonicalJson(input.runASpec.parameters?.[changeParameterName]) !==
    canonicalJson(input.change.runA)
  ) {
    throw new SeedRunError(
      'INVALID_INPUT',
      `runASpec.parameters.${changeParameterName} must equal change.runA`,
    )
  }

  // A candidate supplied for pre-execution review must be exactly the one-leaf
  // transform it claims to be. The real branch is checked against it later.
  if (input.runBCandidateSpec) {
    if (input.runBCandidateSpec.claimNodeId !== claimNodeId) {
      throw new SeedRunError(
        'INVALID_INPUT',
        'runBCandidateSpec.claimNodeId must be rebound to the workspace claim node',
      )
    }
    const candidateDiffs = collectSpecLeafDiffs(
      input.runASpec,
      input.runBCandidateSpec,
    )
    if (
      candidateDiffs.length !== 1 ||
      candidateDiffs[0]!.path !== expectedChangePath ||
      canonicalJson(candidateDiffs[0]!.before) !==
        canonicalJson(input.change.runA) ||
      canonicalJson(candidateDiffs[0]!.after) !==
        canonicalJson(input.change.runB)
    ) {
      throw new SeedRunError(
        'INVALID_INPUT',
        `runBCandidateSpec must differ from runASpec only at ${expectedChangePath}`,
        { detail: { diffs: candidateDiffs } },
      )
    }
  }

  await assertWorkspaceMember(input.db, workspaceId, operatorUserId)

  const [claimNode] = await input.db
    .select({ id: nodes.id })
    .from(nodes)
    .where(
      and(
        eq(nodes.id, claimNodeId),
        eq(nodes.workspaceId, workspaceId),
        eq(nodes.type, 'claim'),
      ),
    )
    .limit(1)
  if (!claimNode) {
    throw new SeedRunError(
      'INVALID_INPUT',
      `claim node ${claimNodeId} does not exist in workspace ${workspaceId}`,
    )
  }

  const [existingExperiment] = await input.db
    .select({ id: experiments.id })
    .from(experiments)
    .where(eq(experiments.workspaceId, workspaceId))
    .limit(1)
  if (existingExperiment) {
    throw new SeedRunError(
      'WORKSPACE_NOT_FRESH',
      `workspace ${workspaceId} already has experiments; the seed requires a fresh database`,
    )
  }

  const randomUUID = input.randomUUID ?? (() => crypto.randomUUID())
  const baseSignal = externalSignal(input)

  const runExperiment = async (
    params: ExecuteRunParams,
  ): Promise<ExecuteRunResult> => {
    const claimId = randomUUID()
    let pipelineStarted = false

    const emit: PipelineEmit = async (event: PipelineEventInput) =>
      appendPipelineEvent(input.db, {
        experimentId: params.experimentId,
        workspaceId,
        event,
      })

    // Plan validation is local and gets only the caller's cancellation
    // signal. The sandbox-sized budget starts at EXECUTE, after the human has
    // finished reviewing the offered spec.
    const context: PipelineStageContext = {
      experimentId: params.experimentId,
      workspaceId,
      actorId: operatorUserId,
      signal: baseSignal,
      emit,
      // A successful hero run never repairs. If the production pipeline does
      // propose a repair that needs a durable decision, this seed has no
      // operator in the execution loop to approve it: fail closed instead of
      // inventing an approval.
      repairApproval: {
        claimId,
        open: (gateInput) => openApprovalGate(input.db, gateInput),
        async wait(gateSeq) {
          const gate = await getApprovalGate(input.db, {
            experimentId: params.experimentId,
            workspaceId,
            gateSeq,
          })
          if (!gate) {
            throw new SeedRunError(
              'REPAIR_APPROVAL_UNAVAILABLE',
              `the pipeline requested repair gate ${gateSeq}, but it could not be found`,
            )
          }
          if (gate.status === 'pending') {
            throw new SeedRunError(
              'REPAIR_APPROVAL_UNAVAILABLE',
              `the pipeline requested a decision on repair gate ${gateSeq}; the seed does not approve repairs and will not fabricate one`,
            )
          }
          return gate
        },
      },
    }

    try {
      const claim = await claimExecutionStart(input.db, {
        experimentId: params.experimentId,
        workspaceId,
        claimId,
        ttlMs: claimTtlMs,
      })
      if (claim.outcome !== 'claimed') {
        throw new SeedRunError(
          'CLAIM_NOT_ACQUIRED',
          `experiment ${params.experimentId} was not claimable (${claim.outcome})`,
        )
      }

      await appendPipelineEvent(input.db, {
        experimentId: params.experimentId,
        workspaceId,
        event: { type: 'pipeline.started', mode: params.expectedSpec.mode },
      })
      pipelineStarted = true

      const plan = await executor.plan(context)
      const plannedHash = hashExperimentSpec(plan.spec)
      const expectedHash = hashExperimentSpec(params.expectedSpec)
      if (plannedHash !== expectedHash) {
        throw new SeedRunError(
          'PLAN_SPEC_MISMATCH',
          `${params.label} PLAN_EXPERIMENT produced a spec other than the approved one`,
          { detail: { plannedHash, expectedHash } },
        )
      }

      const opened = await openApprovalGate(input.db, {
        experimentId: params.experimentId,
        workspaceId,
        claimId,
        spec: plan.spec,
      })
      const gate: ApprovalGateView = opened.gate
      const gateSpecHash = hashExperimentSpec(gate.offeredSpec)

      const approvalRequest: SeedSpecApprovalRequest = {
        label: params.label,
        experimentId: params.experimentId,
        workspaceId,
        gateSeq: gate.gateSeq,
        offeredSpec: gate.offeredSpec,
        specSha256: gateSpecHash,
        logicalSpecSha256: hashLogicalExperimentSpec(gate.offeredSpec),
        runId: params.expectedRunId,
      }

      const decision = await input.approve(approvalRequest)
      if (
        !decision ||
        (decision.decision !== 'approved' && decision.decision !== 'rejected')
      ) {
        throw new SeedRunError(
          'INVALID_INPUT',
          `${params.label} approval port returned no valid decision`,
        )
      }
      if (decision.actorId !== operatorUserId) {
        throw new SeedRunError(
          'APPROVER_NOT_OPERATOR',
          `${params.label} was decided by ${decision.actorId}, not the verified operator ${operatorUserId}`,
        )
      }
      if (decision.specSha256 !== gateSpecHash) {
        throw new SeedRunError(
          'APPROVAL_SPEC_MISMATCH',
          `${params.label} approval names a different spec hash than the gate offered`,
          {
            detail: {
              reviewed: decision.specSha256,
              offered: gateSpecHash,
            },
          },
        )
      }
      await assertWorkspaceMember(
        input.db,
        workspaceId,
        decision.actorId,
      )

      const recorded = await decideApproval(input.db, {
        experimentId: params.experimentId,
        workspaceId,
        gateSeq: gate.gateSeq,
        decision: decision.decision,
        actorId: decision.actorId,
      })
      if (recorded.gate.status !== decision.decision) {
        throw new SeedRunError(
          'APPROVAL_SPEC_MISMATCH',
          `${params.label} gate status ${recorded.gate.status} disagrees with the recorded decision`,
        )
      }

      if (decision.decision === 'rejected') {
        await appendPipelineEvent(input.db, {
          experimentId: params.experimentId,
          workspaceId,
          event: { type: 'pipeline.cancelled', reason: 'rejected' },
        })
        throw new SeedRunError(
          'APPROVAL_REJECTED',
          `${params.label} was rejected at gate ${gate.gateSeq}; no run was executed`,
        )
      }

      if (baseSignal.aborted) {
        throw new SeedRunError(
          'RUN_ABORTED',
          `${params.label} was aborted before execution`,
        )
      }
      const execution = await executor.execute(
        { ...context, signal: withExecutionBudget(baseSignal, budgetMs) },
        gate.offeredSpec,
      )
      if (!execution.runId) {
        throw new SeedRunError(
          'RUN_NOT_CREATED',
          `${params.label} EXECUTE completed without a run`,
        )
      }
      if (
        params.expectedRunId !== null &&
        execution.runId !== params.expectedRunId
      ) {
        throw new SeedRunError(
          'RUN_LINEAGE_MISMATCH',
          `${params.label} execute created run ${execution.runId} instead of adopting queued run ${params.expectedRunId}`,
        )
      }

      const verified = await verifySeedRun({
        db: input.db,
        workspaceId,
        runId: execution.runId,
        expectedSpec: gate.offeredSpec,
        expectedParentRunId: params.expectedParentRunId,
        requireArtifacts,
        requireArtifactContent,
      })

      await appendPipelineEvent(input.db, {
        experimentId: params.experimentId,
        workspaceId,
        event: { type: 'pipeline.completed', runId: execution.runId },
      })

      const verdict = verified.run.verdict
      if (!verdict) {
        throw new SeedRunError(
          'RUN_VERDICT_MISMATCH',
          `run ${execution.runId} has no verdict after evaluation`,
        )
      }

      return {
        record: {
          label: params.label,
          experimentId: params.experimentId,
          runId: execution.runId,
          status: verified.run.status,
          verdict,
          metrics: verified.run.metrics,
          specSha256: hashExperimentSpec(verified.run.spec),
          logicalSpecSha256: hashLogicalExperimentSpec(verified.run.spec),
          parentRunId: verified.run.parentRunId ?? null,
          artifactCount: verified.artifacts.length,
          runNodeId: verified.nodeIds.runNodeId,
          resultNodeId: verified.nodeIds.resultNodeId,
        },
        gate: {
          experimentId: params.experimentId,
          gateSeq: gate.gateSeq,
          state: decision.decision,
          offeredSpecSha256: gateSpecHash,
          offeredLogicalSpecSha256: hashLogicalExperimentSpec(
            gate.offeredSpec,
          ),
          decidedBy: decision.actorId,
        },
        verified,
      }
    } catch (error) {
      if (pipelineStarted) {
        try {
          await appendPipelineEvent(input.db, {
            experimentId: params.experimentId,
            workspaceId,
            event: {
              type: 'pipeline.failed',
              error: 'The seed pipeline did not complete',
            },
          })
        } catch {
          // A terminal event (for example the rejection's pipeline.cancelled)
          // already closed the experiment; the original error is the result.
        }
      }

      if (error instanceof SeedRunError) throw error
      if (error instanceof PipelineDbError) {
        throw new SeedRunError(
          'PIPELINE_DB_FAILED',
          `The pipeline database step failed for ${params.label}: ${error.code}`,
          { cause: error },
        )
      }
      if (error instanceof PipelineStageError) {
        throw new SeedRunError(
          'PIPELINE_STAGE_FAILED',
          stageFailureMessage(error),
          { cause: error },
        )
      }
      throw new SeedRunError(
        'PIPELINE_STAGE_FAILED',
        `The pipeline stage failed for ${params.label}`,
        { cause: error },
      )
    }
  }

  // Run A: the real plan → gate → execute → evaluate sequence.
  const inserted = await input.db
    .insert(experiments)
    .values({
      workspaceId,
      claimNodeId,
      spec: input.runASpec,
      mode: input.runASpec.mode,
      approvalState: 'pending',
    })
    .returning({ id: experiments.id })

  const experimentA = inserted[0]
  if (!experimentA) {
    throw new SeedRunError(
      'PIPELINE_DB_FAILED',
      'the Run A experiment row was not inserted',
    )
  }

  const runA = await runExperiment({
    label: 'run-a',
    experimentId: experimentA.id,
    expectedSpec: input.runASpec,
    expectedRunId: null,
    expectedParentRunId: null,
    requireArtifacts,
    requireArtifactContent,
  })

  // Run B: the real what-if service creates the child experiment and queued
  // run; production EXECUTE must adopt that exact row (#62).
  const parentSnapshot: ParentRunSnapshot = {
    id: runA.verified.run.id,
    experimentId: runA.verified.experiment.id,
    workspaceId,
    claimNodeId,
    status: runA.verified.run.status,
    spec: runA.verified.run.spec,
  }

  const branched = await input.whatIf.branch(
    parentSnapshot,
    {
      parameterName: changeParameterName,
      value: input.change.runB,
    },
    { store: input.whatIf.store },
  )

  if (
    branched.experiment.workspaceId !== workspaceId ||
    branched.experiment.claimNodeId !== claimNodeId ||
    branched.experiment.approvalState !== 'pending'
  ) {
    throw new SeedRunError(
      'WHAT_IF_CONTRACT_VIOLATION',
      'the what-if service returned an experiment outside this workspace, claim node or pending approval state',
    )
  }
  if (
    branched.run.experimentId !== branched.experiment.id ||
    branched.run.parentRunId !== runA.verified.run.id ||
    branched.run.status !== 'queued' ||
    branched.run.attempt !== 1
  ) {
    throw new SeedRunError(
      'WHAT_IF_CONTRACT_VIOLATION',
      'the what-if service did not return attempt 1, queued, chained to Run A',
    )
  }
  if (
    hashExperimentSpec(branched.experiment.spec) !==
    hashExperimentSpec(branched.run.spec)
  ) {
    throw new SeedRunError(
      'WHAT_IF_CONTRACT_VIOLATION',
      'the queued child run did not freeze the branched experiment spec',
    )
  }

  const branchDiffs = collectSpecLeafDiffs(
    runA.verified.run.spec,
    branched.experiment.spec,
  )
  if (
    branchDiffs.length !== 1 ||
    branchDiffs[0]!.path !== expectedChangePath ||
    canonicalJson(branchDiffs[0]!.before) !==
      canonicalJson(input.change.runA) ||
    canonicalJson(branchDiffs[0]!.after) !== canonicalJson(input.change.runB)
  ) {
    throw new SeedRunError(
      'WHAT_IF_CONTRACT_VIOLATION',
      `the what-if spec diff is not exactly ${expectedChangePath}: ${JSON.stringify(input.change.runA)} -> ${JSON.stringify(input.change.runB)}`,
      { detail: { diffs: branchDiffs } },
    )
  }

  // The human reviewed a concrete candidate before timing. The real service
  // must have produced that exact spec, not merely something with the same
  // one-leaf shape.
  if (
    input.runBCandidateSpec &&
    hashExperimentSpec(input.runBCandidateSpec) !==
      hashExperimentSpec(branched.experiment.spec)
  ) {
    throw new SeedRunError(
      'WHAT_IF_CONTRACT_VIOLATION',
      'the what-if service produced a spec other than the pre-reviewed Run B candidate',
      {
        detail: {
          reviewed: hashExperimentSpec(input.runBCandidateSpec),
          branched: hashExperimentSpec(branched.experiment.spec),
        },
      },
    )
  }

  const runB = await runExperiment({
    label: 'run-b',
    experimentId: branched.experiment.id,
    expectedSpec: branched.experiment.spec,
    expectedRunId: branched.run.id,
    expectedParentRunId: runA.verified.run.id,
    requireArtifacts,
    requireArtifactContent,
  })

  if (
    canonicalJson(runA.record.metrics) === canonicalJson(runB.record.metrics)
  ) {
    throw new SeedRunError(
      'RUNS_NOT_DISTINCT',
      `Run B produced exactly the same metrics as Run A; ${expectedChangePath} is not consumed by the pinned script`,
      {
        detail: {
          metrics: runA.record.metrics,
          hint:
            'fixtures/hero-spec.ts must read RESEARCHGRAPH_PARAMETERS and src/server/runner.ts must expose spec.parameters to the sandbox',
        },
      },
    )
  }

  const baseline = await captureSeedRunBaseline(input.db, {
    workspaceId,
    requireArtifacts,
    requireArtifactContent,
  })

  return {
    runA: runA.record,
    runB: runB.record,
    approval: { runA: runA.gate, runB: runB.gate },
    baseline,
  }
}
