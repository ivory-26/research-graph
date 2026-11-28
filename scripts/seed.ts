/** Rebuild the recorded workspace through production ingestion and execution. */
import { performance } from 'node:perf_hooks'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

import { and, eq, inArray, sql } from 'drizzle-orm'

import { HERO_EXPERIMENT_SPEC_RUN_A } from '../fixtures/hero-spec.ts'
import type { Database } from '../src/db/client.ts'
import {
  agentTasks,
  edges as edgesTable,
  nodes as nodesTable,
  sourceChunks as sourceChunksTable,
  sources as sourcesTable,
  workspaceMembers,
  workspaces,
} from '../src/db/schema.ts'
import { applySingleLeafChange, branchWhatIf, createDrizzleWhatIfBranchStore } from '../src/server/branch.ts'
import { ingestSourceToGraphForWorkspace } from '../src/server/extract/pipeline.ts'
import { embedChunks, embedQuery } from '../src/server/ingest/embed.ts'
import {
  createDrizzleAgentTaskStore,
  META_API_KEY_ENV,
  type CallModel,
} from '../src/server/model.ts'
import { MODEL_OUTPUT_REPLAY_ENV } from '../src/server/model-replay.ts'
import type { NodeType } from '../src/shared/types.ts'
import { loadLocalAssets, type LocalAsset } from './seed/assets.ts'
import { createSeedCallModel } from './seed/model.ts'
import {
  SEED_ACTOR_ENV,
  SEED_ALLOW_EXISTING_DATA_ENV,
  SEED_WORKSPACE_ID,
  SEED_WORKSPACE_NAME,
  SEED_WORKSPACE_SLUG,
  SeedError,
  assertExtractionRunAttribution,
  extractionRunId,
  extractionRunLabel,
  resolveSeedActor,
  type SeedActor,
  type SeedEdgeCounts,
  type SeedGraphResult,
  type SeedNodeCounts,
  type SeedSourceReport,
} from './seed/contracts.ts'
import { mapAgentTaskQueryRows } from '../src/server/strategies.ts'
import type { AgentTaskRunSummary } from '../src/utils/strategyClient.ts'
import { summarizeAgentTaskRuns } from '../src/utils/strategyClient.ts'
import { resolveHeroClaim } from './seed/hero-claim.ts'
import { openSeedDatabase } from './seed/database.ts'
import { createSeedSession } from './seed/auth.ts'
import {
  ensureRunGraphAnchors,
  RunEdgeError,
  writeRunGraphEdges,
} from './seed/run-edges.ts'
import {
  canonicalJson,
  hashExperimentSpec,
  hashLogicalExperimentSpec,
  logicalSpecCanonicalJson,
  seedRuns,
  SeedRunError,
  type SeedRunLabel,
  type SeedRunsInput,
} from './seed/runs.ts'

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url))

export interface SeedLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

const consoleLogger: SeedLogger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
}

export interface SeedGraphOptions {
  db: Database
  /** Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** Defaults to the repository root derived from this file. */
  repoRoot?: string
  logger?: SeedLogger
  /**
   * The seed's text call wrapper. Defaults to `createSeedCallModel(env)`; the
   * entrypoint creates one wrapper and reuses it for the run half so a live
   * recording accumulates across both phases.
   */
  callModel?: CallModel
}

function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const direct = (error as { code?: unknown }).code
  if (typeof direct === 'string') return direct
  const cause = (error as { cause?: unknown }).cause
  if (typeof cause === 'object' && cause !== null) {
    const nested = (cause as { code?: unknown }).code
    if (typeof nested === 'string') return nested
  }
  return undefined
}

function requireCredentials(env: NodeJS.ProcessEnv): string {
  if (!env.DATABASE_URL?.trim()) {
    throw new SeedError(
      'MISSING_DATABASE_URL',
      'DATABASE_URL is not set. Put the empty database connection string in .env (see src/db/README.md).',
    )
  }

  if (
    !env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() &&
    !env.GEMINI_API_KEY?.trim()
  ) {
    throw new SeedError(
      'MISSING_GEMINI_KEY',
      'Set GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY: the seed runs real embeddings with gemini-embedding-2.',
      'Text calls use Meta Model API; the Gemini key is still required for embeddings.',
    )
  }

  if (
    !env[META_API_KEY_ENV]?.trim() &&
    !env[MODEL_OUTPUT_REPLAY_ENV]?.trim()
  ) {
    throw new SeedError(
      'MISSING_META_API_KEY',
      `Set ${META_API_KEY_ENV}: the seed runs real claim extraction and edge proposal through Meta Model API.`,
      `A replay run may set ${MODEL_OUTPUT_REPLAY_ENV} instead. The Gemini key remains required for embeddings; E2B is needed for Run A/Run B.`,
    )
  }

  return env.DATABASE_URL.trim()
}

async function assertEmptyTarget(
  db: Database,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  let workspaceCount: number
  try {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workspaces)
    workspaceCount = Number(row?.count ?? 0)
  } catch (error) {
    if (pgErrorCode(error) === '42P01') {
      throw new SeedError(
        'SCHEMA_NOT_MIGRATED',
        'The application schema is not present in this database.',
        'Apply the committed migrations to the fresh database first: pnpm db:migrate (or pnpm db:push on a disposable branch).',
      )
    }
    throw error
  }

  const [existing] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.slug, SEED_WORKSPACE_SLUG))
    .limit(1)

  if (existing) {
    throw new SeedError(
      'WORKSPACE_EXISTS',
      `Workspace ${SEED_WORKSPACE_SLUG} already exists (id ${existing.id}).`,
      'The seed never overwrites or resets. Use a fresh database, or drop the target schema manually before rerunning.',
    )
  }

  if (workspaceCount > 0 && env[SEED_ALLOW_EXISTING_DATA_ENV] !== '1') {
    throw new SeedError(
      'DATABASE_NOT_EMPTY',
      `The database already contains ${workspaceCount} workspace row(s).`,
      `The seed expects an empty application schema. Set ${SEED_ALLOW_EXISTING_DATA_ENV}=1 only when intentionally adding the demo workspace to a database with other workspaces.`,
    )
  }
}

async function createSeedWorkspace(
  db: Database,
  actor: SeedActor,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.insert(workspaces).values({
        id: SEED_WORKSPACE_ID,
        name: SEED_WORKSPACE_NAME,
        slug: SEED_WORKSPACE_SLUG,
      })
      await tx.insert(workspaceMembers).values({
        workspaceId: SEED_WORKSPACE_ID,
        userId: actor.userId,
        role: actor.role,
      })
    })
  } catch (error) {
    if (pgErrorCode(error) === '23505') {
      throw new SeedError(
        'WORKSPACE_EXISTS',
        `Workspace ${SEED_WORKSPACE_SLUG} or id ${SEED_WORKSPACE_ID} already exists.`,
        'The seed never overwrites or resets. Use a fresh database.',
      )
    }
    throw error
  }
}

function emptyNodeCounts(): SeedNodeCounts {
  return {
    source: 0,
    claim: 0,
    method: 0,
    dataset: 0,
    result: 0,
    run: 0,
    note: 0,
  }
}

async function ingestAssets(
  db: Database,
  prepared: readonly LocalAsset[],
  logger: SeedLogger,
  embeddingPacingMs: number,
  callModelFn: CallModel,
): Promise<SeedSourceReport[]> {
  const reports: SeedSourceReport[] = []
  const taskStore = createDrizzleAgentTaskStore(db)

  for (const { asset, bytes, sha256 } of prepared) {
    if (reports.length > 0 && embeddingPacingMs > 0) {
      logger.info(
        `Waiting ${embeddingPacingMs} ms before ${asset.key} to respect the embedding quota`,
      )
      await new Promise((resolve) => setTimeout(resolve, embeddingPacingMs))
    }
    const started = Date.now()
    // unpdf transfers the input ArrayBuffer to its worker inside
    // `getDocumentProxy`, which detaches this Buffer. Capture the expected
    // size before ingestion; the production `sources` row is the authority
    // after the call returns.
    const expectedBytes = bytes.length
    const runId = extractionRunId(asset.key, 'single_pass')
    const runLabel = extractionRunLabel(asset.title, 'single_pass')
    logger.info(`Ingesting ${asset.key} (${expectedBytes} bytes, sha256 ${sha256.slice(0, 12)}…)`)

    const outcome = await ingestSourceToGraphForWorkspace({
      db,
      workspaceId: SEED_WORKSPACE_ID,
      source: {
        kind: 'pdf',
        data: bytes,
        title: asset.title,
        url: asset.url,
        doi: asset.doi,
      },
      // The hero claim is in the abstract. `sectioned` deliberately narrows to
      // Methods/Results and can miss it; `single_pass` is the production
      // strategy that covers the first 30,000 characters.
      strategy: 'single_pass',
      runId,
      runLabel,
      embedChunksFn: (chunks, options, deps) => embedChunks(chunks, { ...options, taskStore }, deps),
      embedQueryFn: (query, options, deps) => embedQuery(query, { ...options, taskStore }, deps),
      callModelFn: (schema, prompt, context) => callModelFn(schema, prompt, { ...context, store: taskStore }),
      updateTaskStatusFn: async (id, status, error) => {
        await db.update(agentTasks).set({ status, error: error ?? null }).where(eq(agentTasks.id, id))
      },
    })

    if (
      outcome.source.sha256 !== sha256 ||
      outcome.source.bytes !== expectedBytes
    ) {
      throw new SeedError(
        'ASSET_HASH_MISMATCH',
        `Production ingestion recorded a different fingerprint for ${asset.key}.`,
        `Expected sha256 ${sha256} / ${expectedBytes} bytes; got ${outcome.source.sha256} / ${outcome.source.bytes} bytes.`,
      )
    }

    if (outcome.needsOcr) {
      throw new SeedError(
        'SOURCE_NEEDS_OCR',
        `The production reader marked ${asset.key} as needing OCR.`,
        'The demo requires born-digital text with page anchors; no evidence is fabricated for a scanned source.',
      )
    }

    if (outcome.chunkCount === 0) {
      throw new SeedError(
        'SOURCE_HAS_NO_CHUNKS',
        `Production chunking produced zero chunks for ${asset.key}.`,
        'No chunks means no citable evidence; the seed stops rather than writing an empty source.',
      )
    }

    const createdNodeIds: SeedSourceReport['createdNodeIds'] = {
      source: '',
      claim: [],
      method: [],
      dataset: [],
    }
    for (const node of outcome.createdNodes) {
      if (node.type === 'source') createdNodeIds.source = node.id
      else if (node.type === 'claim') createdNodeIds.claim.push(node.id)
      else if (node.type === 'method') createdNodeIds.method.push(node.id)
      else if (node.type === 'dataset') createdNodeIds.dataset.push(node.id)
    }

    if (!createdNodeIds.source) {
      throw new SeedError(
        'SOURCE_NODE_MISSING',
        `Production ingestion did not persist a source node for ${asset.key}.`,
      )
    }

    const validatedEdges = outcome.edges.acceptedEdges
    const rejectedEdges = outcome.edges.rejectedEdges.length

    const report: SeedSourceReport = {
      key: asset.key,
      title: asset.title,
      doi: asset.doi,
      sourceId: outcome.source.id,
      sha256: outcome.source.sha256,
      bytes: outcome.source.bytes,
      chunkCount: outcome.chunkCount,
      acceptedClaims: outcome.extraction.acceptedClaims.length,
      rejectedClaims: outcome.extraction.rejectedClaims.length,
      methods: outcome.extraction.methods.length,
      datasets: outcome.extraction.datasets.length,
      createdNodeIds,
      proposedEdges: validatedEdges.length + rejectedEdges,
      acceptedStatusEdges: validatedEdges.filter((edge) => edge.status === 'accepted').length,
      suggestedStatusEdges: validatedEdges.filter((edge) => edge.status === 'suggested').length,
      rejectedEdges,
      persisted: outcome.edges.persisted,
    }
    reports.push(report)

    logger.info(
      `  source ${report.sourceId} · ${report.chunkCount} chunks · ` +
        `${report.acceptedClaims} claims accepted / ${report.rejectedClaims} rejected · ` +
        `${report.methods} methods · ${report.datasets} datasets · ` +
        `${report.acceptedStatusEdges} accepted + ${report.suggestedStatusEdges} suggested edges · ` +
        `${Date.now() - started} ms`,
    )
  }

  return reports
}

async function readCounts(
  db: Database,
  reports: readonly SeedSourceReport[],
): Promise<SeedGraphResult['counts']> {
  const [chunkRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sourceChunksTable)
    .innerJoin(sourcesTable, eq(sourceChunksTable.sourceId, sourcesTable.id))
    .where(eq(sourcesTable.workspaceId, SEED_WORKSPACE_ID))

  const nodeRows = await db
    .select({
      type: nodesTable.type,
      count: sql<number>`count(*)::int`,
    })
    .from(nodesTable)
    .where(eq(nodesTable.workspaceId, SEED_WORKSPACE_ID))
    .groupBy(nodesTable.type)

  const nodes = emptyNodeCounts()
  for (const row of nodeRows) {
    nodes[row.type as NodeType] = Number(row.count)
  }

  const edgeRows = await db
    .select({
      status: edgesTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(edgesTable)
    .where(eq(edgesTable.workspaceId, SEED_WORKSPACE_ID))
    .groupBy(edgesTable.status)

  const edges: SeedEdgeCounts = {
    total: 0,
    accepted: 0,
    suggested: 0,
    rejected: 0,
  }
  for (const row of edgeRows) {
    const count = Number(row.count)
    edges[row.status] = count
    edges.total += count
  }

  return {
    sources: reports.length,
    chunks: Number(chunkRow?.count ?? 0),
    nodes,
    edges,
  }
}

/**
 * Reads the persisted `extract_claims` / `propose_edges` rows back and
 * summarizes them per extraction run.
 *
 * This is the same projection the strategy dashboard uses, over the same
 * `input_ref` run attribution the production extractor wrote. The seed does
 * not add a row, a count or a metric here; it only reads what the real calls
 * recorded.
 */
async function readExtractionRuns(db: Database): Promise<AgentTaskRunSummary[]> {
  const rows = await db
    .select({
      id: agentTasks.id,
      taskKind: agentTasks.taskKind,
      status: agentTasks.status,
      inputRef: agentTasks.inputRef,
      latencyMs: agentTasks.latencyMs,
      costUsd: agentTasks.costUsd,
      error: agentTasks.error,
    })
    .from(agentTasks)
    .where(
      and(
        eq(agentTasks.workspaceId, SEED_WORKSPACE_ID),
        inArray(agentTasks.taskKind, ['extract_claims', 'propose_edges']),
      ),
    )

  return summarizeAgentTaskRuns(
    mapAgentTaskQueryRows(rows.map((row) => ({ ...row, strategyName: null }))),
  )
}

/**
 * Run the graph half of the seed and return the handoff object.
 *
 * The caller owns the database handle.
 */
export async function seedWorkspaceGraph(
  options: SeedGraphOptions,
): Promise<SeedGraphResult> {
  const env = options.env ?? process.env
  const repoRoot = options.repoRoot ?? REPO_ROOT
  const logger = options.logger ?? consoleLogger
  const callModelFn = options.callModel ?? createSeedCallModel(env)
  requireCredentials(env)
  const actor = resolveSeedActor(env)

  // Read and validate every asset before the first database write, so a
  // missing/corrupt PDF cannot leave a half-seeded workspace.
  const prepared = loadLocalAssets(repoRoot)

  const pacingRaw = env[SEED_EMBEDDING_PACING_ENV]?.trim()
  const embeddingPacingMs = pacingRaw ? Number(pacingRaw) : 0
  if (
    !Number.isSafeInteger(embeddingPacingMs) ||
    embeddingPacingMs < 0
  ) {
    throw new SeedError(
      'INVALID_EMBEDDING_PACING',
      `${SEED_EMBEDDING_PACING_ENV} must be a non-negative integer number of milliseconds.`,
    )
  }

  const { db } = options
  const startedAt = new Date()
  const startedMs = Date.now()

  await assertEmptyTarget(db, env)
  await createSeedWorkspace(db, actor)

  logger.info(`Workspace ${SEED_WORKSPACE_SLUG} (${SEED_WORKSPACE_ID}) created for actor ${actor.userId}`)

  const sources = await ingestAssets(
    db,
    prepared,
    logger,
    embeddingPacingMs,
    callModelFn,
  )
  const counts = await readCounts(db, sources)
  const extractionRuns = await readExtractionRuns(db)

  // The dashboard's two-run comparison is only honest if at least two actual
  // extraction batches were recorded. Refuse before the run half rather than
  // letting a workspace with a single unattributed batch claim otherwise.
  assertExtractionRunAttribution(extractionRuns)

  for (const run of extractionRuns) {
    logger.info(
      `  extraction run ${run.runId ?? '(unattributed)'} · ` +
        `${run.attempts} tasks · ${run.successes} succeeded / ${run.failures} failed · ` +
        `success ${run.successRate.toFixed(0)}% · ` +
        `avg latency ${run.avgLatencyMs !== null ? `${Math.round(run.avgLatencyMs)} ms` : '—'} · ` +
        `avg cost ${run.avgCostUsd !== null ? `$${run.avgCostUsd.toFixed(6)}` : '—'}`,
    )
  }

  const heroSource = sources.find(
    (source) => source.key === prepared[0]!.asset.key,
  )
  if (!heroSource || heroSource.acceptedClaims === 0) {
    throw new SeedError(
      'HERO_SOURCE_HAS_NO_CLAIMS',
      'The hero source produced no claim that survived verbatim quote validation.',
      'Without an extracted hero claim there is nothing for Run A to attach to; no claim is fabricated.',
    )
  }

  if (counts.nodes.method === 0) {
    throw new SeedError(
      'NO_METHOD_NODES',
      'Production extraction produced no method nodes.',
      'The recorded workspace requires at least one method node; the seed does not invent one.',
    )
  }

  if (counts.edges.accepted === 0) {
    throw new SeedError(
      'NO_ACCEPTED_EDGES',
      'Production edge proposal produced no accepted edge.',
      'The graph requires at least one accepted, evidenced edge; the seed does not write an unevidenced edge.',
    )
  }

  const hero = await resolveHeroClaim(db, SEED_WORKSPACE_ID)
  const heroClaim = hero.selection
  const heroClaimProblem = hero.problem

  if (heroClaimProblem) {
    logger.warn(
      `Hero claim selector [${heroClaimProblem.code}]: ${heroClaimProblem.message}`,
    )
    logger.warn(
      'The graph is seeded, but scripts/seed/runs.ts cannot attach Run A until the selector is resolved.',
    )
  } else if (heroClaim) {
    logger.info(
      `Hero claim ${heroClaim.claimNodeId} (${heroClaim.match}, page ${heroClaim.page})`,
    )
  }

  const finishedAt = new Date()

  return {
    workspaceId: SEED_WORKSPACE_ID,
    workspaceName: SEED_WORKSPACE_NAME,
    workspaceSlug: SEED_WORKSPACE_SLUG,
    actorUserId: actor.userId,
    heroSourceId: heroSource.sourceId,
    sources,
    heroClaim,
    heroClaimProblem,
    counts,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    elapsedMs: Date.now() - startedMs,
  }
}

function formatSeedError(error: SeedError): string {
  const details = error.details ? `\n  ${error.details}` : ''
  return `Seed failed [${error.code}]: ${error.message}${details}`
}

const SEED_APPROVED_SPEC_HASHES_ENV = 'SEED_APPROVED_LOGICAL_SPEC_HASHES'
const SEED_EMBEDDING_PACING_ENV = 'SEED_EMBEDDING_PACING_MS'
const SPEC_HASH_PATTERN = /^[0-9a-f]{64}$/
const SEED_FLAGS = new Set([
  '--graph-only',
  '--non-interactive',
  '--print-approval',
])

const importanceChange = {
  parameterName: 'importance_method',
  runA: 'impurity',
  runB: 'permutation',
}

type ApprovedSpecHashes = Record<SeedRunLabel, string>

type ExactSpecCandidates = {
  runBCandidateSpec: SeedRunsInput['runASpec']
  /** Per-database SHA-256 of the exact spec, including the claim UUID. */
  concreteHashes: ApprovedSpecHashes
  /** Cross-database SHA-256 with the claim UUID tokenised. */
  logicalHashes: ApprovedSpecHashes
}

function malformedApprovedSpecHashes(reason: string): Error {
  return new Error(
    `${SEED_APPROVED_SPEC_HASHES_ENV} is malformed: ${reason}. ` +
      'Expected "run-a=<64 lowercase hex>,run-b=<64 lowercase hex>" with no duplicates.',
  )
}

/**
 * Parse `--non-interactive`'s approval record.
 *
 * The value is a replay of a human review. It names both runs exactly once
 * with a logical SHA-256, where only the per-database claim UUID is replaced
 * by a documented token. That makes one reviewed pair valid for the two
 * independent fresh databases the canonical baseline requires. Anything else
 * refuses before the database is opened: a missing or malformed value must
 * never approve.
 */
function parseApprovedSpecHashes(env: NodeJS.ProcessEnv): ApprovedSpecHashes {
  const raw = env[SEED_APPROVED_SPEC_HASHES_ENV]?.trim()
  if (!raw) {
    throw new Error(
      `--non-interactive requires ${SEED_APPROVED_SPEC_HASHES_ENV}. ` +
        'A human must review both exact specs first, then set ' +
        `${SEED_APPROVED_SPEC_HASHES_ENV}="run-a=<64 lowercase hex>,run-b=<64 lowercase hex>". ` +
        'The hash tokenises only the per-database claim UUID; the seed never approves an unreviewed spec.',
    )
  }

  const parsed = new Map<SeedRunLabel, string>()
  for (const rawEntry of raw.split(',')) {
    const entry = rawEntry.trim()
    if (!entry) {
      throw malformedApprovedSpecHashes('an entry is empty')
    }
    const separator = entry.indexOf('=')
    if (separator <= 0 || separator === entry.length - 1) {
      throw malformedApprovedSpecHashes('each entry must be name=hash')
    }
    const label = entry.slice(0, separator)
    const hash = entry.slice(separator + 1)
    if (label !== 'run-a' && label !== 'run-b') {
      throw malformedApprovedSpecHashes(`unknown run label ${JSON.stringify(label)}`)
    }
    if (parsed.has(label)) {
      throw malformedApprovedSpecHashes(`${label} appears more than once`)
    }
    if (!SPEC_HASH_PATTERN.test(hash)) {
      throw malformedApprovedSpecHashes(`${label} is not 64 lowercase hex characters`)
    }
    parsed.set(label, hash)
  }

  const runA = parsed.get('run-a')
  const runB = parsed.get('run-b')
  if (!runA || !runB) {
    throw malformedApprovedSpecHashes(`${runA ? 'run-b' : 'run-a'} is missing`)
  }
  return { 'run-a': runA, 'run-b': runB }
}

/** Compute both candidates exactly once, shared by both modes. */
function computeExactSpecCandidates(
  runASpec: SeedRunsInput['runASpec'],
): ExactSpecCandidates {
  const runBCandidateSpec = applySingleLeafChange(
    runASpec,
    `parameters.${importanceChange.parameterName}`,
    importanceChange.runB,
  )
  return {
    runBCandidateSpec,
    concreteHashes: {
      'run-a': hashExperimentSpec(runASpec),
      'run-b': hashExperimentSpec(runBCandidateSpec),
    },
    logicalHashes: {
      'run-a': hashLogicalExperimentSpec(runASpec),
      'run-b': hashLogicalExperimentSpec(runBCandidateSpec),
    },
  }
}

/**
 * Print the frozen logical specs and their hashes for human review.
 *
 * The fixture's placeholder claim id is replaced by the same documented token
 * the seed uses, so these hashes are identical on every fresh database. A
 * reviewer approves the pair once; the same pair seeds both baseline
 * databases. This mode touches no database and no credential.
 */
function printApprovalHashes(): void {
  const candidates = computeExactSpecCandidates(HERO_EXPERIMENT_SPEC_RUN_A)
  for (const [label, spec, hash] of [
    ['run-a', HERO_EXPERIMENT_SPEC_RUN_A, candidates.logicalHashes['run-a']],
    ['run-b', candidates.runBCandidateSpec, candidates.logicalHashes['run-b']],
  ] as const) {
    console.log(`
${label} · logical SHA-256 ${hash}
${logicalSpecCanonicalJson(spec)}`)
  }
  console.log(`
Approve both specs above before replaying the review:
  SEED_APPROVED_LOGICAL_SPEC_HASHES="run-a=${candidates.logicalHashes['run-a']},run-b=${candidates.logicalHashes['run-b']}" pnpm seed --non-interactive`)
}

/** Refuse unless the supplied approval record names exactly these specs. */
function assertApprovedHashesMatch(
  approved: ApprovedSpecHashes,
  computed: ApprovedSpecHashes,
): void {
  const mismatched = (['run-a', 'run-b'] as const).filter(
    (label) => approved[label] !== computed[label],
  )
  if (mismatched.length === 0) return

  const detail = mismatched
    .map((label) => `${label}: approved ${approved[label]}, computed ${computed[label]}`)
    .join('; ')
  throw new Error(
    `Non-interactive approval refused: the logical spec hashes do not match ${SEED_APPROVED_SPEC_HASHES_ENV} (${detail}). ` +
      'Review both exact specs again before approving. No experiment was executed.',
  )
}

function printUsage(): void {
  console.log(`Usage: pnpm seed [--graph-only | --non-interactive]

Apply committed migrations to a fresh database and rebuild the recorded
workspace from the three checked-in papers.

Default (interactive):
  Review both exact experiment specs at the terminal; the production
  pipeline then records the approvals and starts the runs.

--non-interactive:
  Run the same complete seed without prompts. This replays a review, it does
  not replace one: a human first reviews both exact specs and their logical
  hashes (printed by the interactive run), then sets:
    SEED_APPROVED_LOGICAL_SPEC_HASHES="run-a=<64 lowercase hex>,run-b=<64 lowercase hex>"
  A logical hash tokenises only the per-database claim UUID, so the same
  reviewed pair seeds two fresh databases and the two-seed baseline stays
  comparable. The entries may be in either order and must not repeat. A
  missing, malformed or mismatched value refuses before any approval. The
  live Neon Auth session is still verified at each gate and must be the same
  account as SEED_ACTOR_USER_ID. This mode needs SEED_AUTH_COOKIE and
  E2B_API_KEY and cannot be combined with --graph-only.

--graph-only:
  Rebuild sources, chunks and the extracted graph only; no experiments are
  approved or run. Set SEED_ACTOR_USER_ID in place of the Auth and E2B
  variables.

--print-approval:
  Print both frozen logical experiment specs and their logical SHA-256 values
  for human review, then exit. Needs no database, model or credentials. Use
  the printed pair with --non-interactive to replay that review on a fresh
  database.

Required environment for the complete seed:
  DATABASE_URL                    fresh application database
  META_API_KEY                    Meta Model API key for every text call
  GOOGLE_GENERATIVE_AI_API_KEY    or GEMINI_API_KEY, for gemini-embedding-2
  E2B_API_KEY                     access to the pinned runtime template
  NEON_AUTH_BASE_URL              workspace account's Neon Auth service
  NEON_AUTH_COOKIE_SECRET         app's Neon Auth cookie secret
  SEED_AUTH_COOKIE                Cookie header from a signed-in workspace account
  SEED_APPROVED_LOGICAL_SPEC_HASHES  --non-interactive only; see above
  SEED_EMBEDDING_PACING_MS        optional pause between sources for free-tier
                                  embedding quota, e.g. 65000

The command never resets data. Use a fresh database for each attempt.`)
}

async function reviewExactSpecs(
  runASpec: SeedRunsInput['runASpec'],
  candidates: ExactSpecCandidates,
): Promise<void> {
  const input = createInterface({ input: process.stdin, output: process.stdout })
  try {
    for (const [label, spec, concreteHash, logicalHash] of [
      ['Run A', runASpec, candidates.concreteHashes['run-a'], candidates.logicalHashes['run-a']],
      ['Run B', candidates.runBCandidateSpec, candidates.concreteHashes['run-b'], candidates.logicalHashes['run-b']],
    ] as const) {
      console.log(`
${label} · exact SHA-256 ${concreteHash}
${label} · logical SHA-256 ${logicalHash} (claim UUID tokenised; reusable across fresh databases)
${canonicalJson(spec)}`)
      const response = await input.question(`Type ${concreteHash} to approve this exact spec: `)
      if (response.trim() !== concreteHash) {
        throw new Error(`${label} was not approved. No experiment was executed.`)
      }
    }
  } finally {
    input.close()
  }
}

export async function main(argv: string[] = []): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage()
    return 0
  }

  const unknownOptions = argv.filter((arg) => !SEED_FLAGS.has(arg))
  if (unknownOptions.length > 0) {
    throw new Error(
      `Unknown seed option${unknownOptions.length === 1 ? '' : 's'}: ${unknownOptions.join(', ')}. ` +
        'See pnpm seed --help.',
    )
  }

  if (argv.includes('--print-approval')) {
    if (argv.length !== 1) {
      throw new Error('--print-approval must be used on its own; it writes nothing.')
    }
    printApprovalHashes()
    return 0
  }

  const graphOnly = argv.includes('--graph-only')
  const nonInteractive = argv.includes('--non-interactive')
  if (graphOnly && nonInteractive) {
    throw new Error(
      '--non-interactive cannot be combined with --graph-only: graph-only mode does not approve or run experiments.',
    )
  }

  const env = { ...process.env }
  // Validate the opt-in approval record before any database handle exists.
  const approvedHashes = nonInteractive ? parseApprovedSpecHashes(env) : null
  const url = requireCredentials(env)
  if (!graphOnly && !nonInteractive && !process.stdin.isTTY) {
    throw new Error(
      'The complete seed needs an interactive terminal to review both exact specs. ' +
        'After a human reviews them, --non-interactive with SEED_APPROVED_LOGICAL_SPEC_HASHES replays that approval.',
    )
  }
  if (!graphOnly && !env.E2B_API_KEY?.trim()) {
    throw new Error('E2B_API_KEY is required for the complete seed.')
  }
  const verifySession = graphOnly ? null : createSeedSession(env)
  const actor = await verifySession?.()
  if (actor) {
    if (env[SEED_ACTOR_ENV]?.trim() && resolveSeedActor(env).userId !== actor.id) {
      throw new Error('The signed-in account does not match SEED_ACTOR_USER_ID.')
    }
    env[SEED_ACTOR_ENV] = actor.id
  }
  resolveSeedActor(env)

  const started = performance.now()
  // One wrapper for both phases: in record mode it accumulates every text call
  // into the same recording, and in replay mode it keys both phases off one file.
  const callModelFn = createSeedCallModel(env)
  const opened = openSeedDatabase(url)
  try {
    await opened.migrate()
    const graph = await seedWorkspaceGraph({
      db: opened.db,
      env,
      callModel: callModelFn,
    })
    if (!verifySession || !actor) {
      console.log(JSON.stringify({ graph }, null, 2))
      return 0
    }
    if (!graph.heroClaim) {
      throw new Error(graph.heroClaimProblem?.message ?? 'The seed could not resolve the hero claim.')
    }

    const runASpec = { ...HERO_EXPERIMENT_SPEC_RUN_A, claimNodeId: graph.heroClaim.claimNodeId }
    const candidates = computeExactSpecCandidates(runASpec)

    // Resolve (or create) the method and dataset anchors before the review and
    // before any E2B spend: a missing or ambiguous anchor must refuse early.
    const anchors = await ensureRunGraphAnchors(opened.db, {
      workspaceId: graph.workspaceId,
      runASpec,
      runBSpec: candidates.runBCandidateSpec,
    })
    console.log(
      `Run anchors: method A ${anchors.method.runA.title} (${anchors.method.runA.origin}), ` +
        `method B ${anchors.method.runB.title} (${anchors.method.runB.origin}), ` +
        `dataset ${anchors.dataset.title} (${anchors.dataset.origin})`,
    )

    let approvalWaitMs = 0
    if (approvedHashes) {
      assertApprovedHashesMatch(approvedHashes, candidates.logicalHashes)
      console.log(
        `Non-interactive approval: both logical spec hashes match ${SEED_APPROVED_SPEC_HASHES_ENV}.`,
      )
    } else {
      const reviewStarted = performance.now()
      await reviewExactSpecs(runASpec, candidates)
      approvalWaitMs = performance.now() - reviewStarted
    }
    const { runBCandidateSpec, concreteHashes } = candidates
    const runs = await seedRuns({
      db: opened.db,
      workspaceId: graph.workspaceId,
      claimNodeId: graph.heroClaim.claimNodeId,
      operatorUserId: actor.id,
      callModel: callModelFn,
      runASpec,
      runBCandidateSpec,
      change: importanceChange,
      whatIf: {
        branch: branchWhatIf,
        store: createDrizzleWhatIfBranchStore(opened.db),
      },
      approve: async ({ label, specSha256, logicalSpecSha256 }) => {
        // Non-interactive mode replays a review of the logical spec, whose
        // only difference from this database's offer is the claim UUID. The
        // decision still records the concrete offered hash.
        const reviewedHash = approvedHashes
          ? approvedHashes[label]
          : concreteHashes[label]
        const offeredHash = approvedHashes ? logicalSpecSha256 : specSha256
        if (reviewedHash !== offeredHash) {
          throw new Error(
            `The ${label} gate offered a different ${approvedHashes ? 'logical ' : ''}spec than the one reviewed.`,
          )
        }
        const verified = await verifySession()
        if (verified.id !== actor.id) {
          throw new Error(
            `The ${label} gate verified ${verified.id}, not the seed operator ${actor.id}.`,
          )
        }
        return { actorId: verified.id, specSha256, decision: 'approved' }
      },
    })
    // Run A is terminal, Run B is terminal, and the what-if lineage is frozen:
    // now the recorded workspace's five run-lineage edges are written. Each
    // edge cites a real run row as its evidence.
    const runEdges = await writeRunGraphEdges(opened.db, {
      workspaceId: graph.workspaceId,
      anchors,
      runs: {
        runA: { runId: runs.runA.runId, runNodeId: runs.runA.runNodeId },
        runB: { runId: runs.runB.runId, runNodeId: runs.runB.runNodeId },
      },
    })
    const elapsedMs = Math.round(performance.now() - started - approvalWaitMs)
    const timing = {
      elapsedMs,
      approvalWaitMs: Math.round(approvalWaitMs),
      wallMs: Math.round(elapsedMs + approvalWaitMs),
      underOneMinute: elapsedMs < 60_000,
    }
    console.log(
      JSON.stringify(
        { graph, runAnchors: anchors, runs, runEdges, timing },
        null,
        2,
      ),
    )
    return 0
  } catch (error) {
    if (
      error instanceof SeedError ||
      error instanceof SeedRunError ||
      error instanceof RunEdgeError
    ) {
      console.error(error instanceof SeedError ? formatSeedError(error) : error.message)
      return 1
    }
    throw error
  } finally {
    await opened.close()
  }
}
