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
  foreignKey,
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
  uniqueIndex,
  uuid,
  vector,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import type { PipelineEvent, PipelineEventType } from '../shared/events'
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

export const experiments = pgTable(
  'experiments',
  {
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
  },
  (t) => [
    // Redundant on its own (id is already unique), but required so pipeline
    // rows can carry a composite foreign key on (experiment_id, workspace_id).
    // That makes a row whose workspace disagrees with its experiment
    // unrepresentable, rather than a query-scoping convention.
    unique('experiments_id_workspace_id_unique').on(t.id, t.workspaceId),
  ],
)

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
}, (t) => [
  // Repairs stay in one experiment. What-if branches each own a new experiment.
  unique('runs_experiment_parent_unique').on(t.experimentId, t.parentRunId),
])

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
// Pipeline foundation: durable events, execution claims, approval gates
//
// These tables are the cross-request state for docs/01-architecture.md's SSE
// request lifecycle. They deliberately do not create or mutate `runs`: a
// claim is permission to start, not a run, and the DB layer never computes a
// verdict or a stage outcome.
// ---------------------------------------------------------------------------

/** How an execution claim ended. Not a run status. */
export type ExecutionClaimCloseReason = 'completed' | 'failed' | 'cancelled'

/** Mirrors the `ApprovalState` values; a gate is pending until decided. */
export type ApprovalGateStatus = 'pending' | 'approved' | 'rejected'

/**
 * The durable, per-experiment event log behind SSE replay (docs/01, docs/03).
 *
 * `seq` is assigned by `appendPipelineEvent` while holding the experiment row
 * lock, so commit order and sequence order cannot disagree. The event payload
 * is stored whole; the duplicated columns are for ordering and integrity
 * checks. `pipeline_events_event_*` checks make a row whose embedded seq,
 * experiment id or type disagrees with its columns unrepresentable.
 */
export const pipelineEvents = pgTable(
  'pipeline_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    experimentId: uuid('experiment_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    /** Monotonic per experiment, starting at 1. The SSE event id. */
    seq: integer('seq').notNull(),
    type: text('type').$type<PipelineEventType>().notNull(),
    /** The frozen PipelineEvent from src/shared/events.ts, complete. */
    event: jsonb('event').$type<PipelineEvent>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique('pipeline_events_experiment_seq_unique').on(t.experimentId, t.seq),
    index('pipeline_events_experiment_type_idx').on(t.experimentId, t.type),
    foreignKey({
      name: 'pipeline_events_experiment_workspace_fk',
      columns: [t.experimentId, t.workspaceId],
      foreignColumns: [experiments.id, experiments.workspaceId],
    }).onDelete('cascade'),
    check('pipeline_events_seq_positive', sql`${t.seq} > 0`),
    check(
      'pipeline_events_event_seq_matches',
      sql`(${t.event} ->> 'seq')::integer = ${t.seq}`,
    ),
    check(
      'pipeline_events_event_experiment_matches',
      sql`${t.event} ->> 'experimentId' = ${t.experimentId}::text`,
    ),
    check(
      'pipeline_events_event_type_matches',
      sql`${t.event} ->> 'type' = ${t.type}`,
    ),
  ],
)

/**
 * One execution-start lease per experiment, for the whole life of the row.
 *
 * There is deliberately no second claim: a reconnect, a replay after a
 * terminal event, or a reconnect after expiry must observe this row and not
 * start another run. A future explicit retry needs a deliberate API change,
 * not a new `claimId` on this one.
 *
 * `expiresAt` is an observation boundary, not a state transition. An expired
 * claim stays expired until an explicit terminal event closes it; it is never
 * silently renewed.
 */
export const executionClaims = pgTable(
  'execution_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    experimentId: uuid('experiment_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    /**
     * Caller-supplied idempotency key (a UUID). Repeating the same key yields
     * the `duplicate` outcome and never a new start; a different key yields
     * `already_claimed`.
     */
    claimId: uuid('claim_id').notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Set atomically when a terminal pipeline event is appended. */
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closeReason: text('close_reason').$type<ExecutionClaimCloseReason>(),
  },
  (t) => [
    unique('execution_claims_experiment_unique').on(t.experimentId),
    unique('execution_claims_claim_id_unique').on(t.claimId),
    // Referenced by approval_gates' composite FK, which proves the gate
    // belongs to this claim and to the same experiment and workspace.
    unique('execution_claims_id_scope_unique').on(
      t.id,
      t.experimentId,
      t.workspaceId,
    ),
    foreignKey({
      name: 'execution_claims_experiment_workspace_fk',
      columns: [t.experimentId, t.workspaceId],
      foreignColumns: [experiments.id, experiments.workspaceId],
    }).onDelete('cascade'),
    check(
      'execution_claims_expiry_after_claim',
      sql`${t.expiresAt} > ${t.claimedAt}`,
    ),
    check(
      'execution_claims_close_consistent',
      sql`(${t.closedAt} is null and ${t.closeReason} is null) or (${t.closedAt} is not null and ${t.closeReason} is not null)`,
    ),
    check(
      'execution_claims_close_reason_values',
      sql`${t.closeReason} is null or ${t.closeReason} in ('completed', 'failed', 'cancelled')`,
    ),
  ],
)

/**
 * The human gate for one execution claim.
 *
 * `gateSeq` is the seq of the persisted `approval.requested` event, not an
 * independently generated id: the gate identity and the event the approval
 * screen saw are the same fact. `offeredSpec` is the exact plan version that
 * was offered; a decision names `gateSeq` and therefore cannot be applied to a
 * different plan. The composite foreign keys make the gate/event/claim scope
 * mismatch unrepresentable.
 *
 * `experiments.approvalState` / `approvedBy` / `approvedAt` remain the
 * cross-request source the SSE handler polls; this row is the audit record of
 * which gate was decided, by whom, and with which event.
 */
export const approvalGates = pgTable(
  'approval_gates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    experimentId: uuid('experiment_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    executionClaimId: uuid('execution_claim_id').notNull(),
    repairParentRunId: uuid('repair_parent_run_id').references(() => runs.id, {
      onDelete: 'cascade',
    }),
    /** The seq of the `approval.requested` event that opened this gate. */
    gateSeq: integer('gate_seq').notNull(),
    offeredSpec: jsonb('offered_spec').$type<ExperimentSpec>().notNull(),
    status: text('status')
      .$type<ApprovalGateStatus>()
      .notNull()
      .default('pending'),
    /** Verified actor id supplied by the transport; never inferred here. */
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** The seq of the `approval.resolved` event written with the decision. */
    decisionEventSeq: integer('decision_event_seq'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique('approval_gates_experiment_gate_seq_unique').on(
      t.experimentId,
      t.gateSeq,
    ),
    uniqueIndex('approval_gates_initial_claim_unique')
      .on(t.executionClaimId)
      .where(sql`${t.repairParentRunId} is null`),
    unique('approval_gates_claim_repair_parent_unique').on(
      t.executionClaimId,
      t.repairParentRunId,
    ),
    // At most one outstanding gate per experiment, even if a future migration
    // permits more than one claim.
    uniqueIndex('approval_gates_one_pending_per_experiment')
      .on(t.experimentId)
      .where(sql`${t.status} = 'pending'`),
    foreignKey({
      name: 'approval_gates_experiment_workspace_fk',
      columns: [t.experimentId, t.workspaceId],
      foreignColumns: [experiments.id, experiments.workspaceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'approval_gates_claim_scope_fk',
      columns: [t.executionClaimId, t.experimentId, t.workspaceId],
      foreignColumns: [
        executionClaims.id,
        executionClaims.experimentId,
        executionClaims.workspaceId,
      ],
    }).onDelete('cascade'),
    // The gate identity must be a persisted event, and the decision event
    // must be a persisted event of the same experiment.
    foreignKey({
      name: 'approval_gates_gate_event_fk',
      columns: [t.experimentId, t.gateSeq],
      foreignColumns: [pipelineEvents.experimentId, pipelineEvents.seq],
    }).onDelete('cascade'),
    foreignKey({
      name: 'approval_gates_decision_event_fk',
      columns: [t.experimentId, t.decisionEventSeq],
      foreignColumns: [pipelineEvents.experimentId, pipelineEvents.seq],
    }).onDelete('cascade'),
    check(
      'approval_gates_status_values',
      sql`${t.status} in ('pending', 'approved', 'rejected')`,
    ),
    check(
      'approval_gates_decision_consistent',
      sql`(${t.status} = 'pending' and ${t.decidedBy} is null and ${t.decidedAt} is null and ${t.decisionEventSeq} is null) or (${t.status} in ('approved', 'rejected') and ${t.decidedBy} is not null and ${t.decidedAt} is not null and ${t.decisionEventSeq} is not null)`,
    ),
  ],
)

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
    /** ingest | extract_claims | propose_edges | plan_experiment | repair_script | explain_gap | ask_across_sources */
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

export type PipelineEventRow = typeof pipelineEvents.$inferSelect
export type NewPipelineEvent = typeof pipelineEvents.$inferInsert

export type ExecutionClaimRow = typeof executionClaims.$inferSelect
export type NewExecutionClaim = typeof executionClaims.$inferInsert

export type ApprovalGateRow = typeof approvalGates.$inferSelect
export type NewApprovalGate = typeof approvalGates.$inferInsert
