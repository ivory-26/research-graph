/**
 * The five deterministic run-lineage edges for the recorded workspace (#8).
 *
 * `projectRunToGraph` (src/server/pipeline.ts) already writes each run's
 * `(run) --produced--> (result)` edge with the run as evidence. The recorded
 * workspace needs exactly five more edges, all `accepted` with confidence 1,
 * and all evidenced by a terminal run rather than a source chunk:
 *
 *   method(impurity)    --produced-->      run A   evidence run A
 *   method(permutation) --produced-->      run B   evidence run B
 *   dataset             --uses_dataset-->  run A   evidence run A
 *   dataset             --uses_dataset-->  run B   evidence run B
 *   run A               --derived_from-->  run B   evidence run B
 *
 * The run row (`runs.id`) is the evidence; the edge endpoint is the run's
 * graph node written by `projectRunToGraph`. `writeRunGraphEdges` refuses to
 * write unless both run rows belong to the workspace and are terminal, and
 * every endpoint node belongs to the workspace with the expected type.
 *
 * ---------------------------------------------------------------------------
 * Anchor resolution (before execution)
 * ---------------------------------------------------------------------------
 *
 * `ensureRunGraphAnchors` runs before `seedRuns`, so a missing anchor fails
 * before any E2B or model spend. It is workspace-scoped and transactional (the
 * workspace row is locked), so a concurrent caller observes the same nodes
 * instead of creating duplicates.
 *
 * The anchors are the frozen spec's methods and dataset, not model-written
 * extracted titles. Extracted titles vary by provider and run (`Gini
 * importance`, `randomForest (Breiman original with CART, Gini)`, ...), and
 * two papers can produce the same title; selecting one would make two
 * independent seeds disagree. The seed creates `Impurity importance` and
 * `Permutation importance` with `sourceId = null` (reusing an identical
 * spec-derived node on a retry) and the dataset from `runASpec.datasets[0]`,
 * copying its name, url and sha256. The three checked-in papers do not mention
 * `breast-w` (verified by extracting the PDFs). Extracted method/dataset nodes
 * remain in the graph for evidence but are never run anchors. Neither anchor
 * fabricates evidence: the five edges cite the real terminal runs.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'

import type { Database } from '../../src/db/client.ts'
import {
  edges as edgesTable,
  experiments as experimentsTable,
  nodes as nodesTable,
  runs as runsTable,
  workspaces as workspacesTable,
} from '../../src/db/schema.ts'
import type {
  DatasetRef,
  EdgeRelation,
  ExperimentSpec,
  NodeData,
  NodeType,
  RunStatus,
} from '../../src/shared/types.ts'

// ---------------------------------------------------------------------------
// Errors and constants
// ---------------------------------------------------------------------------

export type RunEdgeErrorCode =
  | 'INVALID_INPUT'
  | 'WORKSPACE_NOT_FOUND'
  | 'IMPORTANCE_METHOD_UNSUPPORTED'
  | 'METHOD_ANCHOR_AMBIGUOUS'
  | 'DATASET_SPEC_MISSING'
  | 'DATASET_ANCHOR_AMBIGUOUS'
  | 'EDGE_ENDPOINT_INVALID'
  | 'EDGE_EVIDENCE_RUN_INVALID'

/** A refused anchor or edge write. The message is safe to show to an operator. */
export class RunEdgeError extends Error {
  readonly code: RunEdgeErrorCode
  readonly detail: Record<string, unknown> | undefined

  constructor(
    code: RunEdgeErrorCode,
    message: string,
    options: { cause?: unknown; detail?: Record<string, unknown> } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    )
    this.name = 'RunEdgeError'
    this.code = code
    this.detail = options.detail
  }
}

/** The two `importance_method` values the recorded hero spec can execute. */
export type ImportanceMethodValue = 'impurity' | 'permutation'

export const IMPORTANCE_METHOD_TITLES: Record<ImportanceMethodValue, string> = {
  impurity: 'Impurity importance',
  permutation: 'Permutation importance',
}

/** The summary used only when no extracted method node is available. */
export const SPEC_METHOD_SUMMARY =
  'Importance method selected by the frozen experiment spec.'

/**
 * Statuses that mean a run will never write another measurement, so it can
 * evidence a graph edge. Kept local to this seed module, like `compare.ts`,
 * so the pure helpers stay importable without the server pipeline.
 */
export const TERMINAL_EVIDENCE_RUN_STATUSES = [
  'succeeded',
  'failed',
  'timeout',
  'cancelled',
] as const satisfies readonly RunStatus[]

export function isTerminalEvidenceRunStatus(status: RunStatus): boolean {
  return (TERMINAL_EVIDENCE_RUN_STATUSES as readonly RunStatus[]).includes(
    status,
  )
}

// ---------------------------------------------------------------------------
// Small validation helpers
// ---------------------------------------------------------------------------

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RunEdgeError(
      'INVALID_INPUT',
      `${name} must be a non-empty string`,
    )
  }
  return value
}

/**
 * `importance_method` must be one of the two values the pinned script accepts.
 * Reading it from the frozen spec keeps this module free of a hardcoded
 * `impurity`/`permutation` choice.
 */
export function parseImportanceMethod(
  value: unknown,
  name = 'importance_method',
): ImportanceMethodValue {
  if (typeof value !== 'string') {
    throw new RunEdgeError(
      'IMPORTANCE_METHOD_UNSUPPORTED',
      `${name} must be the string "impurity" or "permutation"`,
      { detail: { value } },
    )
  }

  const normalized = normalizeRunAnchorName(value)
  if (normalized === 'impurity' || normalized === 'permutation') {
    return normalized
  }

  throw new RunEdgeError(
    'IMPORTANCE_METHOD_UNSUPPORTED',
    `${name} is ${JSON.stringify(value)}; the recorded workspace only supports "impurity" and "permutation"`,
    { detail: { value } },
  )
}

function requireImportanceMethod(
  spec: ExperimentSpec,
  label: string,
): ImportanceMethodValue {
  return parseImportanceMethod(
    spec.parameters?.['importance_method'],
    `${label}.parameters.importance_method`,
  )
}

function requirePrimaryDataset(
  spec: ExperimentSpec,
  label: string,
): DatasetRef {
  const ref = spec.datasets?.[0]
  if (
    !ref ||
    typeof ref.name !== 'string' ||
    ref.name.trim() === '' ||
    typeof ref.url !== 'string' ||
    ref.url.trim() === ''
  ) {
    throw new RunEdgeError(
      'DATASET_SPEC_MISSING',
      `${label}.datasets[0] must name a dataset with a non-empty url; the dataset anchor copies those values rather than inventing them`,
    )
  }
  return ref
}

// ---------------------------------------------------------------------------
// Normalisation and pure selection
// ---------------------------------------------------------------------------

/**
 * Case- and punctuation-insensitive name used only for anchor matching.
 *
 * NFKC folds compatibility forms; any run of characters that is not a letter
 * or digit becomes one space. This makes `Impurity-based importance`,
 * `impurity_importance` and `IMPURITY  IMPORTANCE` comparable without any
 * fuzzy or semantic matching.
 */
export function normalizeRunAnchorName(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Extracted-title selectors, retained for a caller that explicitly wants to
 * attach a paper's method node. `ensureRunGraphAnchors` does not use them:
 * model-written titles are not stable across providers or seeds.
 */
export type ExtractedMethodRow = {
  nodeId: string
  title: string
  /** ISO-8601. Rows from one multi-row insert share a timestamp. */
  createdAt: string
}

export type ExtractedDatasetRow = {
  nodeId: string
  title: string
  /** `nodes.data.name` for a dataset node. */
  name: string
  createdAt: string
}

export type ExtractedAnchorChoice = {
  nodeId: string
  title: string
}

/**
 * `selection: null, problem: null` means "nothing matched"; the caller creates
 * the spec-derived anchor. A non-null `problem` means more than one candidate
 * was equally good and the seed must stop.
 */
export type RunAnchorSelection = {
  selection: ExtractedAnchorChoice | null
  problem: RunEdgeProblem | null
}

export type RunEdgeProblem = {
  code: RunEdgeErrorCode
  message: string
  candidates?: Array<{ nodeId: string; title: string; createdAt: string }>
}

const METHOD_MATCHERS: Record<
  ImportanceMethodValue,
  { terms: readonly string[]; exactTitle: string }
> = {
  impurity: {
    terms: ['impurity', 'gini'],
    exactTitle: 'impurity importance',
  },
  permutation: {
    terms: ['permutation'],
    exactTitle: 'permutation importance',
  },
}

type RankedCandidate = ExtractedAnchorChoice & {
  createdAt: string
  rank: number
}

function chooseRankedAnchor(
  candidates: readonly RankedCandidate[],
  ambiguousCode: 'METHOD_ANCHOR_AMBIGUOUS' | 'DATASET_ANCHOR_AMBIGUOUS',
  kind: string,
): RunAnchorSelection {
  if (candidates.length === 0) {
    return { selection: null, problem: null }
  }

  const bestRank = Math.min(...candidates.map((candidate) => candidate.rank))
  const best = candidates
    .filter((candidate) => candidate.rank === bestRank)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.nodeId.localeCompare(right.nodeId),
    )

  const first = best[0]!
  const second = best[1]
  // `createdAt` is the only "earliest" signal. If the earliest is shared, the
  // node ids are arbitrary database UUIDs and choosing one would be a guess.
  if (second && second.createdAt === first.createdAt) {
    return {
      selection: null,
      problem: {
        code: ambiguousCode,
        message: `${best.length} extracted ${kind} nodes rank equally and share created_at ${first.createdAt}; refusing to guess`,
        candidates: best.map(({ nodeId, title, createdAt }) => ({
          nodeId,
          title,
          createdAt,
        })),
      },
    }
  }

  return {
    selection: { nodeId: first.nodeId, title: first.title },
    problem: null,
  }
}

/**
 * Pure selector for an extracted method node. `method` comes from the frozen
 * spec's `parameters.importance_method`, so the selector never hardcodes which
 * run is which.
 */
export function selectExtractedMethodAnchor(
  candidates: readonly ExtractedMethodRow[],
  method: ImportanceMethodValue,
): RunAnchorSelection {
  const matcher = METHOD_MATCHERS[method]
  const exactTitle = normalizeRunAnchorName(matcher.exactTitle)

  const ranked: RankedCandidate[] = []
  for (const candidate of candidates) {
    const normalized = normalizeRunAnchorName(candidate.title)
    if (!normalized) continue
    if (!matcher.terms.some((term) => normalized.includes(term))) continue
    ranked.push({
      nodeId: candidate.nodeId,
      title: candidate.title,
      createdAt: candidate.createdAt,
      rank: normalized === exactTitle ? 0 : 1,
    })
  }

  return chooseRankedAnchor(ranked, 'METHOD_ANCHOR_AMBIGUOUS', 'method')
}

/** Pure selector for an extracted dataset node, matched by normalised name. */
export function selectExtractedDatasetAnchor(
  candidates: readonly ExtractedDatasetRow[],
  expectedName: string,
): RunAnchorSelection {
  const expected = normalizeRunAnchorName(expectedName)
  if (!expected) {
    throw new RunEdgeError(
      'INVALID_INPUT',
      'expectedName must contain at least one letter or digit',
    )
  }

  const ranked: RankedCandidate[] = []
  for (const candidate of candidates) {
    const names = [candidate.name, candidate.title]
      .map(normalizeRunAnchorName)
      .filter((name) => name !== '')
    if (!names.includes(expected)) continue
    ranked.push({
      nodeId: candidate.nodeId,
      title: candidate.title,
      createdAt: candidate.createdAt,
      rank: 0,
    })
  }

  return chooseRankedAnchor(ranked, 'DATASET_ANCHOR_AMBIGUOUS', 'dataset')
}

// ---------------------------------------------------------------------------
// Spec-derived anchor nodes
// ---------------------------------------------------------------------------

export type RunAnchorNodeInsert = {
  workspaceId: string
  type: 'method' | 'dataset'
  title: string
  data: NodeData
  sourceId: null
}

export function importanceMethodTitle(
  method: ImportanceMethodValue,
): string {
  return IMPORTANCE_METHOD_TITLES[method]
}

/**
 * Creates the method node for a spec value with no extracted match. It is
 * deliberately unattributed (`sourceId: null`) and writes no metric: the spec
 * chose the method, the papers did not state this node.
 */
export function buildMethodAnchorNode(
  workspaceId: string,
  method: ImportanceMethodValue,
): RunAnchorNodeInsert {
  const id = requireNonEmptyString(workspaceId, 'workspaceId')
  return {
    workspaceId: id,
    type: 'method',
    title: importanceMethodTitle(method),
    data: {
      type: 'method',
      summary: SPEC_METHOD_SUMMARY,
      library: null,
    },
    sourceId: null,
  }
}

/**
 * Creates the dataset node from the frozen spec's first dataset ref. Name, url
 * and sha256 are copied; `rows` stays null because the spec does not measure
 * it. No paper provenance is claimed.
 */
export function buildDatasetAnchorNode(
  workspaceId: string,
  ref: DatasetRef,
): RunAnchorNodeInsert {
  const id = requireNonEmptyString(workspaceId, 'workspaceId')
  const name = ref?.name
  const url = ref?.url
  if (
    typeof name !== 'string' ||
    name.trim() === '' ||
    typeof url !== 'string' ||
    url.trim() === ''
  ) {
    throw new RunEdgeError(
      'DATASET_SPEC_MISSING',
      'a dataset anchor needs a non-empty name and url from the frozen spec',
    )
  }

  return {
    workspaceId: id,
    type: 'dataset',
    title: name,
    data: {
      type: 'dataset',
      name,
      url,
      sha256: ref.sha256 ?? null,
      rows: null,
    },
    sourceId: null,
  }
}

// ---------------------------------------------------------------------------
// Anchor resolution
// ---------------------------------------------------------------------------

export type RunGraphAnchor = {
  nodeId: string
  title: string
  /** Whether this call found an existing node or created one from the spec. */
  origin: 'extracted' | 'spec'
}

export type RunGraphAnchors = {
  workspaceId: string
  method: { runA: RunGraphAnchor; runB: RunGraphAnchor }
  dataset: RunGraphAnchor
}

export type EnsureRunGraphAnchorsInput = {
  workspaceId: string
  /** Run A's spec, already rebound to the real claim node. */
  runASpec: ExperimentSpec
  /**
   * Run B's pre-execution candidate (Run A with one `parameters.*` leaf
   * changed). Used only for its `importance_method` and dataset ref.
   */
  runBSpec: ExperimentSpec
}

/** The Drizzle handle inside `db.transaction`, so the insert helpers stay typed. */
type SeedTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

function throwAnchorProblem(problem: RunEdgeProblem | null): void {
  if (!problem) return
  throw new RunEdgeError(problem.code, problem.message, {
    detail: problem.candidates ? { candidates: problem.candidates } : {},
  })
}

async function insertMethodAnchor(
  tx: SeedTransaction,
  workspaceId: string,
  method: ImportanceMethodValue,
): Promise<RunGraphAnchor> {
  const [inserted] = await tx
    .insert(nodesTable)
    .values(buildMethodAnchorNode(workspaceId, method))
    .returning({ id: nodesTable.id, title: nodesTable.title })

  if (!inserted) {
    throw new RunEdgeError(
      'INVALID_INPUT',
      `the spec-derived ${method} method node was not inserted`,
    )
  }
  return { nodeId: inserted.id, title: inserted.title, origin: 'spec' }
}

async function insertDatasetAnchor(
  tx: SeedTransaction,
  workspaceId: string,
  ref: DatasetRef,
): Promise<RunGraphAnchor> {
  const [inserted] = await tx
    .insert(nodesTable)
    .values(buildDatasetAnchorNode(workspaceId, ref))
    .returning({ id: nodesTable.id, title: nodesTable.title })

  if (!inserted) {
    throw new RunEdgeError(
      'INVALID_INPUT',
      `the spec-derived dataset node ${ref.name} was not inserted`,
    )
  }
  return { nodeId: inserted.id, title: inserted.title, origin: 'spec' }
}

async function findOrCreateSpecMethodAnchor(
  tx: SeedTransaction,
  workspaceId: string,
  method: ImportanceMethodValue,
): Promise<RunGraphAnchor> {
  const title = importanceMethodTitle(method)
  const [existing] = await tx
    .select({ id: nodesTable.id, title: nodesTable.title })
    .from(nodesTable)
    .where(
      and(
        eq(nodesTable.workspaceId, workspaceId),
        eq(nodesTable.type, 'method'),
        eq(nodesTable.title, title),
        isNull(nodesTable.sourceId),
      ),
    )
    .orderBy(nodesTable.createdAt, nodesTable.id)
    .limit(1)

  if (existing) {
    return { nodeId: existing.id, title: existing.title, origin: 'spec' }
  }
  return insertMethodAnchor(tx, workspaceId, method)
}

async function findOrCreateSpecDatasetAnchor(
  tx: SeedTransaction,
  workspaceId: string,
  ref: DatasetRef,
): Promise<RunGraphAnchor> {
  const expected = normalizeRunAnchorName(ref.name)
  const rows = await tx
    .select({
      id: nodesTable.id,
      title: nodesTable.title,
      data: nodesTable.data,
    })
    .from(nodesTable)
    .where(
      and(
        eq(nodesTable.workspaceId, workspaceId),
        eq(nodesTable.type, 'dataset'),
        isNull(nodesTable.sourceId),
      ),
    )
    .orderBy(nodesTable.createdAt, nodesTable.id)

  const existing = rows.find(
    (row) =>
      row.data.type === 'dataset' &&
      normalizeRunAnchorName(row.data.name) === expected,
  )
  if (existing) {
    return { nodeId: existing.id, title: existing.title, origin: 'spec' }
  }
  return insertDatasetAnchor(tx, workspaceId, ref)
}

/**
 * Resolves the three run-graph anchors before any run executes:
 *
 * - the method node for Run A's `importance_method`;
 * - the method node for Run B's `importance_method`;
 * - the dataset node both runs use.
 *
 * The anchors are the frozen spec's methods and dataset, never model-written
 * extracted titles. Extracted titles vary by provider and run ("Gini
 * importance", "randomForest (... Gini)", ...), and two papers can produce the
 * same title; selecting one would make two independent seeds non-deterministic.
 * The seed therefore creates `Impurity importance` and `Permutation importance`
 * from the spec (reusing an identical spec-derived node on a retry) and the
 * dataset from `runASpec.datasets[0]`. Extracted nodes remain in the graph for
 * evidence but are never run anchors.
 *
 * The whole resolution runs in one transaction with the workspace row locked.
 * Throws `RunEdgeError` for an unsupported importance method, a missing
 * dataset ref, or a missing workspace.
 */
export async function ensureRunGraphAnchors(
  db: Database,
  input: EnsureRunGraphAnchorsInput,
): Promise<RunGraphAnchors> {
  const workspaceId = requireNonEmptyString(input.workspaceId, 'workspaceId')
  const runAMethod = requireImportanceMethod(input.runASpec, 'runASpec')
  const runBMethod = requireImportanceMethod(input.runBSpec, 'runBSpec')
  const datasetRef = requirePrimaryDataset(input.runASpec, 'runASpec')
  const runBDatasetRef = requirePrimaryDataset(input.runBSpec, 'runBSpec')

  if (
    normalizeRunAnchorName(runBDatasetRef.name) !==
    normalizeRunAnchorName(datasetRef.name)
  ) {
    throw new RunEdgeError(
      'INVALID_INPUT',
      'runASpec and runBSpec must name the same dataset: the recorded workspace has one dataset anchor',
      {
        detail: {
          runA: datasetRef.name,
          runB: runBDatasetRef.name,
        },
      },
    )
  }

  return db.transaction(async (tx) => {
    const [workspace] = await tx
      .select({ id: workspacesTable.id })
      .from(workspacesTable)
      .where(eq(workspacesTable.id, workspaceId))
      .for('update')

    if (!workspace) {
      throw new RunEdgeError(
        'WORKSPACE_NOT_FOUND',
        `workspace ${workspaceId} does not exist`,
      )
    }

    const runAAnchor = await findOrCreateSpecMethodAnchor(
      tx,
      workspaceId,
      runAMethod,
    )
    const runBAnchor = await findOrCreateSpecMethodAnchor(
      tx,
      workspaceId,
      runBMethod,
    )
    const datasetAnchor = await findOrCreateSpecDatasetAnchor(
      tx,
      workspaceId,
      datasetRef,
    )

    if (runAMethod === runBMethod || runAAnchor.nodeId === runBAnchor.nodeId) {
      throw new RunEdgeError(
        'INVALID_INPUT',
        'runASpec and runBSpec must name different importance methods: the recorded workspace has one method anchor per run',
      )
    }

    return {
      workspaceId,
      method: { runA: runAAnchor, runB: runBAnchor },
      dataset: datasetAnchor,
    }
  })
}

// ---------------------------------------------------------------------------
// Edge planning and validation
// ---------------------------------------------------------------------------

export type RunGraphRunRefs = {
  runA: { runId: string; runNodeId: string }
  runB: { runId: string; runNodeId: string }
}

export type RunGraphEdgesInput = {
  workspaceId: string
  anchors: RunGraphAnchors
  runs: RunGraphRunRefs
}

/** One row the seed will insert into `edges`. Every edge cites a terminal run. */
export type PlannedRunGraphEdge = {
  workspaceId: string
  sourceNodeId: string
  targetNodeId: string
  relation: EdgeRelation
  evidenceRunId: string
  status: 'accepted'
  confidence: 1
}

/**
 * Builds the exact five-edge plan, in the recorded order. Pure: no database
 * access, so the shape can be asserted in a unit test.
 */
export function planRunGraphEdges(
  input: RunGraphEdgesInput,
): PlannedRunGraphEdge[] {
  const { workspaceId, anchors, runs } = input
  return [
    {
      workspaceId,
      sourceNodeId: anchors.method.runA.nodeId,
      targetNodeId: runs.runA.runNodeId,
      relation: 'produced',
      evidenceRunId: runs.runA.runId,
      status: 'accepted',
      confidence: 1,
    },
    {
      workspaceId,
      sourceNodeId: anchors.method.runB.nodeId,
      targetNodeId: runs.runB.runNodeId,
      relation: 'produced',
      evidenceRunId: runs.runB.runId,
      status: 'accepted',
      confidence: 1,
    },
    {
      workspaceId,
      sourceNodeId: anchors.dataset.nodeId,
      targetNodeId: runs.runA.runNodeId,
      relation: 'uses_dataset',
      evidenceRunId: runs.runA.runId,
      status: 'accepted',
      confidence: 1,
    },
    {
      workspaceId,
      sourceNodeId: anchors.dataset.nodeId,
      targetNodeId: runs.runB.runNodeId,
      relation: 'uses_dataset',
      evidenceRunId: runs.runB.runId,
      status: 'accepted',
      confidence: 1,
    },
    {
      workspaceId,
      sourceNodeId: runs.runA.runNodeId,
      targetNodeId: runs.runB.runNodeId,
      relation: 'derived_from',
      evidenceRunId: runs.runB.runId,
      status: 'accepted',
      confidence: 1,
    },
  ]
}

export type RunGraphEndpointNode = {
  id: string
  workspaceId: string
  type: NodeType
  data: NodeData
}

export type RunGraphEvidenceRun = {
  id: string
  workspaceId: string
  status: RunStatus
}

export type RunGraphEdgeProblem = {
  code: 'EDGE_ENDPOINT_INVALID' | 'EDGE_EVIDENCE_RUN_INVALID'
  message: string
}

type ExpectedEndpoint = {
  label: string
  nodeId: string
  type: NodeType
  runId?: string
}

/**
 * Pure validation of the rows `writeRunGraphEdges` read back. Returns every
 * problem instead of throwing, so a caller can report all of them; the writer
 * converts a non-empty list into `RunEdgeError`.
 */
export function checkRunGraphEdgeInputs(
  input: RunGraphEdgesInput,
  nodeRows: readonly RunGraphEndpointNode[],
  runRows: readonly RunGraphEvidenceRun[],
): RunGraphEdgeProblem[] {
  const problems: RunGraphEdgeProblem[] = []
  const workspaceId = input.workspaceId

  if (input.anchors.workspaceId !== workspaceId) {
    problems.push({
      code: 'EDGE_ENDPOINT_INVALID',
      message: `anchors belong to workspace ${input.anchors.workspaceId}, not ${workspaceId}`,
    })
  }

  const nodeById = new Map(nodeRows.map((row) => [row.id, row]))
  const expectedEndpoints: ExpectedEndpoint[] = [
    {
      label: 'Run A method',
      nodeId: input.anchors.method.runA.nodeId,
      type: 'method',
    },
    {
      label: 'Run B method',
      nodeId: input.anchors.method.runB.nodeId,
      type: 'method',
    },
    {
      label: 'dataset',
      nodeId: input.anchors.dataset.nodeId,
      type: 'dataset',
    },
    {
      label: 'Run A run node',
      nodeId: input.runs.runA.runNodeId,
      type: 'run',
      runId: input.runs.runA.runId,
    },
    {
      label: 'Run B run node',
      nodeId: input.runs.runB.runNodeId,
      type: 'run',
      runId: input.runs.runB.runId,
    },
  ]

  for (const expected of expectedEndpoints) {
    const row = nodeById.get(expected.nodeId)
    if (!row) {
      problems.push({
        code: 'EDGE_ENDPOINT_INVALID',
        message: `${expected.label} node ${expected.nodeId} was not found`,
      })
      continue
    }
    if (row.workspaceId !== workspaceId) {
      problems.push({
        code: 'EDGE_ENDPOINT_INVALID',
        message: `${expected.label} node ${expected.nodeId} belongs to workspace ${row.workspaceId}, not ${workspaceId}`,
      })
      continue
    }
    if (row.type !== expected.type) {
      problems.push({
        code: 'EDGE_ENDPOINT_INVALID',
        message: `${expected.label} node ${expected.nodeId} is ${row.type}, expected ${expected.type}`,
      })
      continue
    }
    if (expected.type === 'run' && expected.runId !== undefined) {
      if (row.data.type !== 'run') {
        problems.push({
          code: 'EDGE_ENDPOINT_INVALID',
          message: `${expected.label} node ${expected.nodeId} does not carry run data`,
        })
      } else if (row.data.runId !== expected.runId) {
        problems.push({
          code: 'EDGE_ENDPOINT_INVALID',
          message: `${expected.label} node ${expected.nodeId} projects run ${row.data.runId}, not evidence run ${expected.runId}`,
        })
      }
    }
  }

  const evidenceRuns = [
    { label: 'Run A', runId: input.runs.runA.runId },
    { label: 'Run B', runId: input.runs.runB.runId },
  ]
  const runById = new Map(runRows.map((row) => [row.id, row]))

  for (const evidence of evidenceRuns) {
    const row = runById.get(evidence.runId)
    if (!row) {
      problems.push({
        code: 'EDGE_EVIDENCE_RUN_INVALID',
        message: `${evidence.label} evidence run ${evidence.runId} was not found`,
      })
      continue
    }
    if (row.workspaceId !== workspaceId) {
      problems.push({
        code: 'EDGE_EVIDENCE_RUN_INVALID',
        message: `${evidence.label} evidence run ${evidence.runId} belongs to workspace ${row.workspaceId}, not ${workspaceId}`,
      })
      continue
    }
    if (!isTerminalEvidenceRunStatus(row.status)) {
      problems.push({
        code: 'EDGE_EVIDENCE_RUN_INVALID',
        message: `${evidence.label} evidence run ${evidence.runId} is ${row.status}, not terminal`,
      })
    }
  }

  if (input.runs.runA.runId === input.runs.runB.runId) {
    problems.push({
      code: 'EDGE_EVIDENCE_RUN_INVALID',
      message: `Run A and Run B must be different run rows, both are ${input.runs.runA.runId}`,
    })
  }
  if (input.runs.runA.runNodeId === input.runs.runB.runNodeId) {
    problems.push({
      code: 'EDGE_ENDPOINT_INVALID',
      message: `Run A and Run B must have different run nodes, both are ${input.runs.runA.runNodeId}`,
    })
  }

  return problems
}

// ---------------------------------------------------------------------------
// Edge write
// ---------------------------------------------------------------------------

export type WrittenRunGraphEdge = PlannedRunGraphEdge & { id: string }

export type WriteRunGraphEdgesResult = {
  workspaceId: string
  edges: WrittenRunGraphEdge[]
}

function edgeIdentity(edge: {
  sourceNodeId: string
  targetNodeId: string
  relation: string
}): string {
  return `${edge.sourceNodeId}\u0000${edge.targetNodeId}\u0000${edge.relation}`
}

/**
 * Writes the five run-lineage edges after both runs are terminal.
 *
 * Before inserting, the function re-reads the evidence runs and endpoint nodes
 * inside the transaction and checks that:
 *
 * - every endpoint node exists and belongs to the workspace;
 * - method anchors are `method` nodes, the dataset anchor is a `dataset` node;
 * - each run node is a `run` node projecting the exact run row it evidences;
 * - both evidence runs belong to the workspace and are terminal.
 *
 * Any violation throws `RunEdgeError` before a row is written. The function
 * writes only `edges`; it never writes a metric, verdict artifact or run row.
 */
export async function writeRunGraphEdges(
  db: Database,
  input: RunGraphEdgesInput,
): Promise<WriteRunGraphEdgesResult> {
  const workspaceId = requireNonEmptyString(input.workspaceId, 'workspaceId')
  requireNonEmptyString(input.runs.runA.runId, 'runs.runA.runId')
  requireNonEmptyString(input.runs.runA.runNodeId, 'runs.runA.runNodeId')
  requireNonEmptyString(input.runs.runB.runId, 'runs.runB.runId')
  requireNonEmptyString(input.runs.runB.runNodeId, 'runs.runB.runNodeId')

  const normalizedInput: RunGraphEdgesInput = {
    ...input,
    workspaceId,
  }
  const runIds = [
    normalizedInput.runs.runA.runId,
    normalizedInput.runs.runB.runId,
  ]
  const nodeIds = [
    ...new Set([
      normalizedInput.anchors.method.runA.nodeId,
      normalizedInput.anchors.method.runB.nodeId,
      normalizedInput.anchors.dataset.nodeId,
      normalizedInput.runs.runA.runNodeId,
      normalizedInput.runs.runB.runNodeId,
    ]),
  ]

  return db.transaction(async (tx) => {
    const [workspace] = await tx
      .select({ id: workspacesTable.id })
      .from(workspacesTable)
      .where(eq(workspacesTable.id, workspaceId))
      .for('update')

    if (!workspace) {
      throw new RunEdgeError(
        'WORKSPACE_NOT_FOUND',
        `workspace ${workspaceId} does not exist`,
      )
    }

    // Deliberately not filtered by workspace: the checker can then say which
    // workspace a wrong endpoint or run belongs to instead of "not found".
    const runRows = await tx
      .select({
        id: runsTable.id,
        workspaceId: experimentsTable.workspaceId,
        status: runsTable.status,
      })
      .from(runsTable)
      .innerJoin(
        experimentsTable,
        eq(experimentsTable.id, runsTable.experimentId),
      )
      .where(inArray(runsTable.id, runIds))

    const nodeRows = await tx
      .select({
        id: nodesTable.id,
        workspaceId: nodesTable.workspaceId,
        type: nodesTable.type,
        data: nodesTable.data,
      })
      .from(nodesTable)
      .where(inArray(nodesTable.id, nodeIds))

    const problems = checkRunGraphEdgeInputs(
      normalizedInput,
      nodeRows,
      runRows,
    )
    if (problems.length > 0) {
      const first = problems[0]!
      throw new RunEdgeError(first.code, first.message, {
        detail: { problems },
      })
    }

    const plan = planRunGraphEdges(normalizedInput)
    const inserted = await tx
      .insert(edgesTable)
      .values(plan)
      .returning({
        id: edgesTable.id,
        sourceNodeId: edgesTable.sourceNodeId,
        targetNodeId: edgesTable.targetNodeId,
        relation: edgesTable.relation,
      })

    const idByIdentity = new Map(
      inserted.map((row) => [edgeIdentity(row), row.id]),
    )
    const edges: WrittenRunGraphEdge[] = plan.map((edge) => {
      const id = idByIdentity.get(edgeIdentity(edge))
      if (!id) {
        throw new RunEdgeError(
          'INVALID_INPUT',
          `the ${edge.relation} edge from ${edge.sourceNodeId} to ${edge.targetNodeId} was not written`,
        )
      }
      return { ...edge, id }
    })

    return { workspaceId, edges }
  })
}
