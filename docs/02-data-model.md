# Data model

Postgres on Neon, accessed through Drizzle. Six tables carry the product; the rest are supporting.

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
  evidenceRunId: uuid('evidence_run_id'),
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
  taskKind: text('task_kind').notNull(),        // ingest | extract_claims | propose_edges | plan_experiment | repair_script | explain_gap
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

Every model call writes exactly one `agent_tasks` row, including failures. The scoring dashboard is a `GROUP BY task_kind, strategy_id` over this table and nothing else — there is no separate score table to drift out of sync.

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

## Rules that are enforced, not documented

| Rule | Where |
|---|---|
| An edge has evidence | `CHECK` constraint |
| A claim's reported value is never overwritten by a measurement | separate tables, separate columns |
| A run's specification is immutable once executed | `runs.spec` is a frozen copy |
| A what-if changes exactly one parameter | validated in `branch`, compared against `parentRunId` |
| Every model call is accounted for | one `agent_tasks` row per call, success or failure |
| Deleting a source cannot silently orphan an edge | `ON DELETE RESTRICT` on `evidence_chunk_id` |
