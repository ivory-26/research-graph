# Data model

Postgres on Neon, accessed through Drizzle. Fourteen tables are on `main`:

- **the graph** — `workspaces`, `workspace_members`, `sources`, `source_chunks`, `nodes`, `edges`
- **reproduction** — `experiments`, `runs`, `run_artifacts`
- **agents** — `agent_strategies`, `agent_tasks`
- **pipeline foundation** — `pipeline_events`, `execution_claims`, `approval_gates`

The executable form is [`src/db/schema.ts`](../src/db/schema.ts), with generated SQL in [`src/db/migrations/`](../src/db/migrations/) (`0000_initial_schema`, `0001_pipeline_foundation`); exports and connection usage are documented in [`src/db/README.md`](../src/db/README.md). If the code and this document disagree, this document wins and the schema is the bug.

## Enums

```ts
export const nodeType = pgEnum('node_type',
  ['source', 'claim', 'method', 'dataset', 'result', 'run', 'note']);

export const edgeRelation = pgEnum('edge_relation',
  ['supports', 'contradicts', 'cites', 'uses_dataset', 'tests', 'produced', 'derived_from']);

export const edgeStatus = pgEnum('edge_status', ['suggested', 'accepted', 'rejected']);

export const runMode = pgEnum('run_mode', ['exact', 'adapted', 'conceptual']);

export const runStatus = pgEnum('run_status',
  ['queued', 'running', 'succeeded', 'failed', 'timeout', 'cancelled']);

export const verdict = pgEnum('verdict',
  ['match', 'mismatch', 'inconclusive', 'failed']);
```

`exact` exists in the enum and is never used by the current product. It is there so a future exact reproduction is a value change rather than a migration, and so the UI has a word for something we cannot currently do.

## Tables

```ts
// Identity is owned by Neon Auth; we only reference it.
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const workspaceMembers = pgTable('workspace_members', {
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').notNull(),          // Neon Auth user id
  role: text('role').notNull().default('owner'),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })]);

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  kind: text('kind').notNull(),               // paper | web | repo | dataset | note
  title: text('title').notNull(),
  url: text('url'),
  doi: text('doi'),
  sha256: text('sha256').notNull(),
  bytes: integer('bytes').notNull(),
  meta: jsonb('meta').$type<SourceMeta>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sourceChunks = pgTable('source_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'cascade' }).notNull(),
  ordinal: integer('ordinal').notNull(),
  text: text('text').notNull(),
  page: integer('page'),
  charStart: integer('char_start').notNull(),
  charEnd: integer('char_end').notNull(),
  embedding: vector('embedding', { dimensions: 768 }),
}, (t) => [
  index('source_chunks_source_idx').on(t.sourceId, t.ordinal),
  index('source_chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
]);
```

`source_chunks.embedding` is nullable so a partially backfilled or repaired workspace is representable; ingestion still writes chunks and their vectors together, and retrieval filters `embedding is not null`. The HNSW index exists in the schema but, per [ADR 0011](./adr/0011-pgvector-for-retrieval-only.md), retrieval also works as a sequential scan at this scale.

```ts
export const nodes = pgTable('nodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  type: nodeType('type').notNull(),
  title: text('title').notNull(),
  data: jsonb('data').$type<NodeData>().notNull(),
  sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
  positionX: real('position_x').notNull().default(0),
  positionY: real('position_y').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const edges = pgTable('edges', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  sourceNodeId: uuid('source_node_id').references(() => nodes.id, { onDelete: 'cascade' }).notNull(),
  targetNodeId: uuid('target_node_id').references(() => nodes.id, { onDelete: 'cascade' }).notNull(),
  relation: edgeRelation('relation').notNull(),
  evidenceChunkId: uuid('evidence_chunk_id').references(() => sourceChunks.id, { onDelete: 'restrict' }),
  evidenceRunId: uuid('evidence_run_id').references((): AnyPgColumn => runs.id, { onDelete: 'restrict' }), // forward reference to runs
  confidence: real('confidence'),
  status: edgeStatus('status').notNull().default('suggested'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  check('edges_have_evidence',
    sql`${t.evidenceChunkId} is not null or ${t.evidenceRunId} is not null`),
  check('edges_no_self_loop', sql`${t.sourceNodeId} <> ${t.targetNodeId}`),
]);
```

The `edges_have_evidence` constraint is the whole point of the graph. It lives in the database so that no future code path — not a migration, not a backfill script, not a model — can create an assertion without a citation.

## Runs

```ts
export const experiments = pgTable('experiments', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  claimNodeId: uuid('claim_node_id').references(() => nodes.id, { onDelete: 'cascade' }).notNull(),
  spec: jsonb('spec').$type<ExperimentSpec>().notNull(),
  mode: runMode('mode').notNull(),
  approvalState: text('approval_state').notNull().default('pending'), // pending | approved | rejected
  approvedBy: text('approved_by'),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// `experiments` also carries unique (id, workspace_id), so the pipeline tables
// can prove with a composite foreign key that their workspace matches.
export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  experimentId: uuid('experiment_id').references(() => experiments.id, { onDelete: 'cascade' }).notNull(),
  parentRunId: uuid('parent_run_id'),                  // self-reference, set for what-if and repairs
  attempt: integer('attempt').notNull().default(1),
  status: runStatus('status').notNull().default('queued'),
  runner: text('runner').notNull().default('e2b'),
  sandboxId: text('sandbox_id'),
  spec: jsonb('spec').$type<ExperimentSpec>().notNull(),   // frozen at execution time
  parameters: jsonb('parameters').$type<Record<string, unknown>>().notNull(),
  metrics: jsonb('metrics').$type<Record<string, number>>().notNull().default({}),
  environment: jsonb('environment').$type<RunEnvironment>().notNull(),
  verdict: verdict('verdict'),
  verdictDetail: jsonb('verdict_detail').$type<VerdictDetail>(),
  stdout: text('stdout').notNull().default(''),
  stderr: text('stderr').notNull().default(''),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const runArtifacts = pgTable('run_artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'cascade' }).notNull(),
  kind: text('kind').notNull(),                 // figure | table | notebook | log
  path: text('path').notNull(),
  sha256: text('sha256').notNull(),
  bytes: integer('bytes').notNull(),
  content: text('content'),                     // inline for small artifacts; null if external
});
```

`runs.spec` is a **frozen copy**, not a pointer to `experiments.spec`. If the experiment specification is later edited, the historical run still describes what actually executed. This is what makes lineage trustworthy.

## Agents

```ts
export const agentStrategies = pgTable('agent_strategies', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  taskKind: text('task_kind').notNull(),        // ingest | extract_claims | propose_edges | plan_experiment | repair_script | explain_gap | ask_across_sources
  name: text('name').notNull(),                 // single_pass | sectioned | table_first ...
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
}, (t) => [unique().on(t.workspaceId, t.taskKind, t.name)]);

export const agentTasks = pgTable('agent_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  strategyId: uuid('strategy_id').references(() => agentStrategies.id, { onDelete: 'set null' }),
  taskKind: text('task_kind').notNull(),
  model: text('model').notNull(),
  status: text('status').notNull(),             // succeeded | failed | rejected | retried
  inputRef: jsonb('input_ref').$type<Record<string, unknown>>().notNull().default({}),
  output: jsonb('output'),
  error: text('error'),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
  latencyMs: integer('latency_ms'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

Every model call writes exactly one `agent_tasks` row per physical attempt, including failures. The scoring dashboard is designed as a `GROUP BY task_kind, strategy_id` over this table and nothing else — there is no separate score table to drift out of sync. On `main` that query is not wired and the dashboard renders fixture rows.

## Pipeline foundation

Three tables hold the cross-request state behind SSE delivery. They never create or mutate `runs`: a claim is permission to start, not a run.

```ts
export const pipelineEvents = pgTable('pipeline_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  experimentId: uuid('experiment_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  seq: integer('seq').notNull(),                 // monotonic per experiment, the SSE id
  type: text('type').$type<PipelineEventType>().notNull(),
  event: jsonb('event').$type<PipelineEvent>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique('pipeline_events_experiment_seq_unique').on(t.experimentId, t.seq),
  check('pipeline_events_event_seq_matches', sql`(${t.event} ->> 'seq')::integer = ${t.seq}`),
  check('pipeline_events_event_experiment_matches', sql`${t.event} ->> 'experimentId' = ${t.experimentId}::text`),
  check('pipeline_events_event_type_matches', sql`${t.event} ->> 'type' = ${t.type}`),
]);

export const executionClaims = pgTable('execution_claims', {
  id: uuid('id').primaryKey().defaultRandom(),
  experimentId: uuid('experiment_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  claimId: uuid('claim_id').notNull(),           // caller idempotency key
  claimedAt: timestamp('claimed_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closeReason: text('close_reason').$type<'completed' | 'failed' | 'cancelled'>(),
}, (t) => [
  unique('execution_claims_experiment_unique').on(t.experimentId),
  check(
    'execution_claims_close_consistent',
    sql`(${t.closedAt} is null and ${t.closeReason} is null) or (${t.closedAt} is not null and ${t.closeReason} is not null)`,
  ),
]);

export const approvalGates = pgTable('approval_gates', {
  id: uuid('id').primaryKey().defaultRandom(),
  experimentId: uuid('experiment_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  executionClaimId: uuid('execution_claim_id').notNull(),
  gateSeq: integer('gate_seq').notNull(),        // the approval.requested seq
  offeredSpec: jsonb('offered_spec').$type<ExperimentSpec>().notNull(),
  status: text('status').$type<'pending' | 'approved' | 'rejected'>().notNull().default('pending'),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionEventSeq: integer('decision_event_seq'),
}, (t) => [
  unique('approval_gates_experiment_gate_seq_unique').on(t.experimentId, t.gateSeq),
  unique('approval_gates_execution_claim_unique').on(t.executionClaimId),
  uniqueIndex('approval_gates_one_pending_per_experiment')
    .on(t.experimentId).where(sql`${t.status} = 'pending'`),
]);
```

`seq` is assigned while holding the experiment row lock, so commit order and sequence order cannot disagree. The embedded event must agree with the duplicated columns or the row is unrepresentable.

`execution_claims` has **one row per experiment for the life of the experiment**. `claimId` is an idempotency key: repeating it returns `duplicate`; a different key returns `already_claimed`. `expiresAt` is an observation boundary, not a state change; an expired claim stays expired until an explicit terminal event closes it.

`approval_gates` binds the gate to the `approval.requested` event the screen saw (`gateSeq`), the claim scope and the experiment with composite foreign keys. A decision names a `gateSeq`, so it cannot be applied to a different plan. `offeredSpec` is the exact version offered; the executed run uses it rather than re-reading `experiments.spec`. A partial unique index allows at most one pending gate per experiment.

## Node data shapes

```ts
type NodeData =
  | { type: 'claim'; text: string; reported: ReportedValue | null;
      datasetName: string | null; methodName: string | null;
      locator: { page: number; quote: string } }
  | { type: 'method'; summary: string; library: string | null }
  | { type: 'dataset'; name: string; url: string | null; sha256: string | null; rows: number | null }
  | { type: 'result'; metrics: Record<string, number>; runId: string; verdict: Verdict | null }
  | { type: 'run'; runId: string; status: RunStatus; mode: RunMode }
  | { type: 'note'; body: string }
  | { type: 'source'; sourceId: string; kind: string };

type ReportedValue = {
  metric: string;
  value: number | null;            // null when the claim is qualitative
  comparator: 'gt' | 'lt' | 'eq' | null;
  against: number | null;
  quote: string;                   // the sentence that asserts it
};
```

`value: null` is legal and load-bearing. The hero claim in [the scope](./00-scope.md) is qualitative — "noise can outrank informative features" — and the design must not force it into a number.

### Verdict detail

`runs.verdict_detail` stores the arithmetic the verdict came from, plus prose that cannot change it:

```ts
type VerdictCheck = {
  metric: string;
  op: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq' | 'within';
  threshold: number;
  tolerance: number | null;
  measured: number | null;   // null when the metric is absent from the run
  passed: boolean;
};

type VerdictDetail = {
  checks: VerdictCheck[];
  explanation: string | null;  // written by explain_gap after the verdict exists
};
```

## Rules that are enforced, not documented

| Rule | Where |
|---|---|
| An edge has evidence | `CHECK` constraint |
| A claim's reported value is never overwritten by a measurement | separate tables, separate columns |
| A run's specification is immutable once executed | `runs.spec` is a frozen copy |
| A what-if changes exactly one parameter | `src/server/branch.ts` validates the diff; the queued Run B is adopted by #62 |
| Every model call is accounted for | one `agent_tasks` row per physical attempt, success or failure |
| Deleting a source or run cannot silently orphan an edge | `ON DELETE RESTRICT` on `evidence_chunk_id` and `evidence_run_id` |
| One experiment starts at most one execution | unique `execution_claims.experiment_id` |
| A gate can be decided once, and only on the plan offered | unique claim, partial unique pending gate, `gateSeq` + `offeredSpec` |
| An event row cannot disagree with the event it stores | three `CHECK`s on `pipeline_events` |
| A pipeline row cannot belong to a different workspace than its experiment | composite foreign keys on all three pipeline tables |
