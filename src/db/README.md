# Database

Postgres on Neon, accessed through Drizzle. The schema is the executable form of
[docs/02-data-model.md](../../docs/02-data-model.md); if the two disagree, the
document wins and the schema is the bug.

## Files

| Path | What it is |
|---|---|
| `schema.ts` | The 14 app tables, 6 enums, indexes, checks and foreign keys. Stable exports: `workspaces`, `workspaceMembers`, `sources`, `sourceChunks`, `nodes`, `edges`, `experiments`, `runs`, `runArtifacts`, `agentStrategies`, `agentTasks`, `pipelineEvents`, `executionClaims`, `approvalGates`; the enums `nodeType`, `edgeRelation`, `edgeStatus`, `runMode`, `runStatus`, `verdict`; and `*Row` / `New*` types inferred from each table |
| `client.ts` | `getDb()` — lazy, server-only singleton over a Neon WebSocket `Pool`; `closeDb()`; the `Database` type. Import from server code only |
| `pipeline.ts` | The public pipeline DB API: `appendPipelineEvent`, `replayPipelineEvents`, `claimExecutionStart`, `getExecutionClaim`, `openApprovalGate`, `decideApproval`, `getApprovalGate`, `getExperimentApprovalState`, plus `PipelineDbError` and the result types |
| `pipeline-events.ts` | Durable ordered append and exclusive-cursor replay |
| `pipeline-claims.ts` | The one execution-start claim per experiment |
| `pipeline-approval.ts` | Gate opening and exactly-once decisions |
| `pipeline-validation.ts` | Runtime validation of the frozen event and spec contracts, and the error codes |
| `pipeline-internals.ts` | Experiment row lock, locked event append, claim/gate read helpers |
| `pipeline-types.ts` | Public result shapes for the functions above |
| `bootstrap.mjs` | Enables pgvector before `drizzle-kit push` (push does not emit `CREATE EXTENSION`) |
| `migrations/` | Committed SQL plus `meta/_journal.json` and snapshots. The SQL is generated, then the extension line is added by hand — see below |

## Connecting

`DATABASE_URL` is the only required secret. Put it in `.env` at the repo root;
both the app and `drizzle-kit` read that file. Never commit it.

```bash
# Neon console → Connection string. Use the direct (non-pooler) host for
# migrations; the application may use the pooled host.
DATABASE_URL=postgresql://...
```

`getDb()` is server-only (`createServerOnlyFn`) and lazy: importing the module
opens nothing. The first call creates the pool. Use the WebSocket driver for
interactive transactions needed by graph writes:

```ts
import { getDb } from '../db/client'

const db = getDb()
await db.transaction(async (tx) => {
  // e.g. node + edge + chunk writes in one transaction
})
```

`closeDb()` releases the pool and is idempotent; call it from scripts and tests.

## Pipeline foundation

The SSE request lifecycle in [docs/01-architecture.md](../../docs/01-architecture.md)
splits across requests: the stream, the approve `POST`, and a reconnect can
land on different instances. Three additive tables carry that state, and
`src/db/pipeline.ts` is the only module transport code needs.

### Tables

| Table | Purpose |
|---|---|
| `pipeline_events` | One durable row per `PipelineEvent`. `seq` is monotonic per experiment starting at 1; `(experiment_id, seq)` is unique. The complete frozen event is stored in `event`, and checks prove its embedded `seq`, `experimentId` and `type` agree with the columns |
| `execution_claims` | Exactly one row per experiment. `claim_id` is the caller's idempotency key; `expires_at` is an observation boundary; `closed_at` / `close_reason` are set when a terminal event is appended |
| `approval_gates` | One row per execution claim. `gate_seq` is the seq of the persisted `approval.requested` event — the gate identity and the event the approval screen saw are the same fact. `offered_spec` is the exact plan version. A partial unique index allows at most one pending gate per experiment |

Workspace isolation is structural, not a query convention: the new tables
carry `(experiment_id, workspace_id)` (and, for gates, the claim's full scope)
as composite foreign keys, so a row whose workspace disagrees with its
experiment or claim cannot exist.

### Contract for the transport

- **Start.** `claimExecutionStart` returns `claimed`, `duplicate`, or
  `already_claimed`. Only `claimed` authorizes starting a run. A reconnect —
  after completion, after expiry, or while the first request is still running —
  always gets `duplicate` or `already_claimed` and must not start another run.
  An expired claim is reported as expired; it is never renewed. An explicit
  retry is a separate product decision, not a new `claimId` passed here.
- **Append.** `appendPipelineEvent` assigns `seq` and `at` while holding the
  experiment row lock. Concurrent appends for one experiment therefore commit
  in seq order, with no duplicates or committed gaps. The caller supplies the
  event without `seq`, `experimentId` or `at`; supplying them is rejected.
  `approval.requested` and `approval.resolved` are reserved for the gate and
  decision functions.
- **Replay.** `replayPipelineEvents` returns `seq > afterSeq`, ordered, with a
  page limit and `hasMore`. That is Last-Event-ID semantics. A cursor beyond
  the persisted head is rejected rather than silently returning nothing.
- **Gate.** `openApprovalGate` writes the `approval.requested` event, the gate
  row and the offered spec in one transaction. Repeating it with the same claim
  and the same spec returns the same gate and event without a second write.
- **Decide.** `decideApproval` is scoped to the workspace, the exact
  `gateSeq`, and the active unexpired claim. It writes the gate decision, the
  `approval.resolved` event, and `experiments.approval_state` /
  `approved_by` / `approved_at` in one transaction. Concurrent opposite
  decisions serialize; one wins, the other gets `GATE_ALREADY_DECIDED`.
  Repeating the identical decision with the identical actor returns `replayed`
  and writes nothing.
- **Terminal.** Appending `pipeline.completed`, `pipeline.failed` or
  `pipeline.cancelled` closes the claim and blocks every later append for that
  experiment. A stale stream cannot publish after a terminal transition.
- **Read.** `getApprovalGate` and `getExperimentApprovalState` are the read
  side; `experiments.approval_state` remains the cross-request source the SSE
  handler polls.

This layer does not create `runs`, compute a verdict, run a stage, or
authenticate anyone. `actorId` is recorded exactly as the transport supplies
it; verification belongs to the route layer.

## Commands

```bash
pnpm db:push       # disposable branch: enables pgvector, then drizzle-kit push
pnpm db:generate   # after editing schema.ts: new SQL + snapshot in migrations/
pnpm db:migrate    # apply committed migrations (repeatable path, empty DB included)
pnpm db:check      # validate the migration journal/snapshots, no database needed
pnpm db:studio     # inspect the public schema
```

Use `db:migrate` for databases tracked by migrations. Use `db:push` on a
separate disposable branch because push does not record migration history.
`db:push` runs `bootstrap.mjs` first because
`drizzle-kit push` creates the `vector(768)` column and HNSW index but never
`CREATE EXTENSION vector`; on a fresh Neon database that ordering would fail.
`0000_initial_schema.sql` starts with the same extension statement, so
`db:migrate` also works against an empty database.

The SQL files are append-only. To change the schema, edit `schema.ts`, run
`pnpm db:generate`, review the new SQL, and commit the SQL, snapshot and journal
together. Do not edit a migration that has been applied. The one exception is
ordering: `0001_pipeline_foundation.sql` moves the generated
`experiments_id_workspace_id_unique` statement ahead of the composite foreign
keys that reference it, because drizzle-kit emitted it last. The migration had
not been applied when the lines moved; the snapshot is untouched.

## Scope and ownership

`drizzle.config.ts` sets `schemaFilter: ['public']`. Neon Auth owns the
`neon_auth` schema; it is outside our migrations and `db:push` must not inspect
or drop it. Keep all application tables in `public`.

Rules the database, not code, enforces:

- `edges_have_evidence` — every edge row has an `evidence_chunk_id` or an
  `evidence_run_id` (`CHECK`). Deliberately no bypass.
- `runs.parent_run_id` — self-foreign-key for what-if and repair lineage. It uses
  PostgreSQL's default `NO ACTION`; parent runs are never mutated.
- `execution_claims_experiment_unique` — at most one execution-start claim per
  experiment, for the life of the experiment.
- `approval_gates_one_pending_per_experiment` — at most one outstanding gate.
- `pipeline_events_event_*` and `approval_gates_*_fk` — an event's embedded
  identity must match its columns, a gate's identity must be a persisted event,
  and a gate cannot point at a claim or workspace other than its own.

`runs.spec` is a frozen copy of the experiment spec, never a pointer to
`experiments.spec`.

`docs/adr/0011-pgvector-for-retrieval-only.md` notes the HNSW index is not
needed at demo scale. `docs/02-data-model.md` specifies it, so it is created
here; it can be dropped later without touching any column or query contract.
