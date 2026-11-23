/**
 * The workspace schema from docs/02-data-model.md.
 *
 * Two rules here are not formatting preferences:
 *
 * - `edges_have_evidence` is a database CHECK, so no code path can create an
 *   assertion without a citation (docs/adr/0007-edges-require-evidence.md).
 * - `runs.spec` is a frozen copy of `experiments.spec`, so a historical run
 *   keeps describing what actually executed (docs/02-data-model.md).
 *
 * Column names and nullability follow the document exactly. JSON payloads are
 * typed with the frozen contracts in src/shared/types.ts.
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
  vector,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import type {
  AgentTaskStatus,
  ApprovalState,
  EdgeRelation,
  EdgeStatus,
  ExperimentSpec,
  Mode,
  NodeData,
  NodeType,
  RunEnvironment,
  RunStatus,
  SourceMeta,
  TaskKind,
  Verdict,
  VerdictDetail,
} from '../shared/types'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

const nodeTypeValues = [
  'source',
  'claim',
  'method',
  'dataset',
  'result',
  'run',
  'note',
] as const satisfies readonly NodeType[]

const edgeRelationValues = [
  'supports',
  'contradicts',
  'cites',
  'uses_dataset',
  'tests',
  'produced',
  'derived_from',
] as const satisfies readonly EdgeRelation[]

const edgeStatusValues = [
  'suggested',
  'accepted',
  'rejected',
] as const satisfies readonly EdgeStatus[]

// `exact` is never produced by the current product. It exists so a future
// exact reproduction is a value change rather than a migration.
const runModeValues = [
  'exact',
  'adapted',
  'conceptual',
] as const satisfies readonly Mode[]

const runStatusValues = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'timeout',
  'cancelled',
] as const satisfies readonly RunStatus[]

const verdictValues = [
  'match',
  'mismatch',
  'inconclusive',
  'failed',
] as const satisfies readonly Verdict[]

export const nodeType = pgEnum('node_type', nodeTypeValues)
export const edgeRelation = pgEnum('edge_relation', edgeRelationValues)
export const edgeStatus = pgEnum('edge_status', edgeStatusValues)
export const runMode = pgEnum('run_mode', runModeValues)
export const runStatus = pgEnum('run_status', runStatusValues)
export const verdict = pgEnum('verdict', verdictValues)

// ---------------------------------------------------------------------------
// Identity and workspaces
// ---------------------------------------------------------------------------

/** Identity is owned by Neon Auth (docs/adr/0008-neon-auth.md); we reference it. */
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    /** Neon Auth user id. */
    userId: text('user_id').notNull(),
    role: text('role').notNull().default('owner'),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
)

// ---------------------------------------------------------------------------
// Sources and evidence
// ---------------------------------------------------------------------------

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .references(() => workspaces.id, { onDelete: 'cascade' })
    .notNull(),
  /** paper | web | repo | dataset | note */
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  url: text('url'),
  doi: text('doi'),
  sha256: text('sha256').notNull(),
  bytes: integer('bytes').notNull(),
  meta: jsonb('meta').$type<SourceMeta>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const sourceChunks = pgTable(
  'source_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .references(() => sources.id, { onDelete: 'cascade' })
      .notNull(),
    ordinal: integer('ordinal').notNull(),
    text: text('text').notNull(),
    page: integer('page'),
    charStart: integer('char_start').notNull(),
    charEnd: integer('char_end').notNull(),
    /** gemini-embedding-2, 768 dimensions. Nullable until embedding succeeds. */
    embedding: vector('embedding', { dimensions: 768 }),
  },
  (t) => [
    index('source_chunks_source_idx').on(t.sourceId, t.ordinal),
    index('source_chunks_embedding_idx').using(
      'hnsw',
      t.embedding.op('vector_cosine_ops'),
    ),
  ],
)

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

export const nodes = pgTable('nodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .references(() => workspaces.id, { onDelete: 'cascade' })
    .notNull(),
  type: nodeType('type').notNull(),
  title: text('title').notNull(),
  data: jsonb('data').$type<NodeData>().notNull(),
  sourceId: uuid('source_id').references(() => sources.id, {
    onDelete: 'set null',
  }),
  positionX: real('position_x').notNull().default(0),
  positionY: real('position_y').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const edges = pgTable(
  'edges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    sourceNodeId: uuid('source_node_id')
      .references(() => nodes.id, { onDelete: 'cascade' })
      .notNull(),
    targetNodeId: uuid('target_node_id')
      .references(() => nodes.id, { onDelete: 'cascade' })
      .notNull(),
    relation: edgeRelation('relation').notNull(),
    evidenceChunkId: uuid('evidence_chunk_id').references(
      () => sourceChunks.id,
      { onDelete: 'restrict' },
    ),
    // Forward reference: `runs` is declared below, as in the data model doc.
    evidenceRunId: uuid('evidence_run_id').references(
      (): AnyPgColumn => runs.id,
      { onDelete: 'restrict' },
    ),
    confidence: real('confidence'),
    status: edgeStatus('status').notNull().default('suggested'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    // The whole point of the graph: an edge row cannot exist without a
    // citation, and the database enforces it rather than a code path.
    check(
      'edges_have_evidence',
      sql`${t.evidenceChunkId} is not null or ${t.evidenceRunId} is not null`,
    ),
    check('edges_no_self_loop', sql`${t.sourceNodeId} <> ${t.targetNodeId}`),
  ],
)

// ---------------------------------------------------------------------------
// Experiments and runs
// ---------------------------------------------------------------------------

export const experiments = pgTable('experiments', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .references(() => workspaces.id, { onDelete: 'cascade' })
    .notNull(),
  claimNodeId: uuid('claim_node_id')
    .references(() => nodes.id, { onDelete: 'cascade' })
    .notNull(),
  spec: jsonb('spec').$type<ExperimentSpec>().notNull(),
  mode: runMode('mode').notNull(),
  /** pending | approved | rejected */
  approvalState: text('approval_state')
    .$type<ApprovalState>()
    .notNull()
    .default('pending'),
  approvedBy: text('approved_by'),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  experimentId: uuid('experiment_id')
    .references(() => experiments.id, { onDelete: 'cascade' })
    .notNull(),
  /** Self-reference, set for what-if and repair runs. Default NO ACTION. */
  parentRunId: uuid('parent_run_id').references((): AnyPgColumn => runs.id),
  attempt: integer('attempt').notNull().default(1),
  status: runStatus('status').notNull().default('queued'),
  runner: text('runner').notNull().default('e2b'),
  sandboxId: text('sandbox_id'),
  /** Frozen at execution time; never a pointer to experiments.spec. */
  spec: jsonb('spec').$type<ExperimentSpec>().notNull(),
  parameters: jsonb('parameters').$type<Record<string, unknown>>().notNull(),
  metrics: jsonb('metrics')
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  environment: jsonb('environment').$type<RunEnvironment>().notNull(),
  verdict: verdict('verdict'),
  verdictDetail: jsonb('verdict_detail').$type<VerdictDetail>(),
  stdout: text('stdout').notNull().default(''),
  stderr: text('stderr').notNull().default(''),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const runArtifacts = pgTable('run_artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .references(() => runs.id, { onDelete: 'cascade' })
    .notNull(),
  /** figure | table | notebook | log */
  kind: text('kind').notNull(),
  path: text('path').notNull(),
  sha256: text('sha256').notNull(),
  bytes: integer('bytes').notNull(),
  /** Inline for small artifacts; null if external. */
  content: text('content'),
})

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const agentStrategies = pgTable(
  'agent_strategies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    /** ingest | extract_claims | propose_edges | plan_experiment | repair_script | explain_gap */
    taskKind: text('task_kind').$type<TaskKind>().notNull(),
    /** single_pass | sectioned | table_first ... */
    name: text('name').notNull(),
    config: jsonb('config')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => [unique().on(t.workspaceId, t.taskKind, t.name)],
)

/**
 * Every model call writes exactly one row here, including failures. The
 * scoring dashboard is a GROUP BY over this table and nothing else.
 */
export const agentTasks = pgTable('agent_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .references(() => workspaces.id, { onDelete: 'cascade' })
    .notNull(),
  strategyId: uuid('strategy_id').references(() => agentStrategies.id, {
    onDelete: 'set null',
  }),
  taskKind: text('task_kind').$type<TaskKind>().notNull(),
  model: text('model').notNull(),
  /** succeeded | failed | rejected | retried */
  status: text('status').$type<AgentTaskStatus>().notNull(),
  inputRef: jsonb('input_ref')
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  output: jsonb('output'),
  error: text('error'),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
  latencyMs: integer('latency_ms'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Inferred row types
// ---------------------------------------------------------------------------

export type WorkspaceRow = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert

export type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert

export type SourceRow = typeof sources.$inferSelect
export type NewSource = typeof sources.$inferInsert

export type SourceChunkRow = typeof sourceChunks.$inferSelect
export type NewSourceChunk = typeof sourceChunks.$inferInsert

export type NodeRow = typeof nodes.$inferSelect
export type NewNode = typeof nodes.$inferInsert

export type EdgeRow = typeof edges.$inferSelect
export type NewEdge = typeof edges.$inferInsert

export type ExperimentRow = typeof experiments.$inferSelect
export type NewExperiment = typeof experiments.$inferInsert

export type RunRow = typeof runs.$inferSelect
export type NewRun = typeof runs.$inferInsert

export type RunArtifactRow = typeof runArtifacts.$inferSelect
export type NewRunArtifact = typeof runArtifacts.$inferInsert

export type AgentStrategyRow = typeof agentStrategies.$inferSelect
export type NewAgentStrategy = typeof agentStrategies.$inferInsert

export type AgentTaskRow = typeof agentTasks.$inferSelect
export type NewAgentTask = typeof agentTasks.$inferInsert
