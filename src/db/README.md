# Database

Postgres on Neon, accessed through Drizzle. The schema is the executable form of
[docs/02-data-model.md](../../docs/02-data-model.md); if the two disagree, the
document wins and the schema is the bug.

## Files

| Path | What it is |
|---|---|
| `schema.ts` | The 11 app tables, 6 enums, indexes, checks and foreign keys. Stable exports: `workspaces`, `workspaceMembers`, `sources`, `sourceChunks`, `nodes`, `edges`, `experiments`, `runs`, `runArtifacts`, `agentStrategies`, `agentTasks`; the enums `nodeType`, `edgeRelation`, `edgeStatus`, `runMode`, `runStatus`, `verdict`; and `*Row` / `New*` types inferred from each table |
| `client.ts` | `getDb()` — lazy, server-only singleton over a Neon WebSocket `Pool`; `closeDb()`; the `Database` type. Import from server code only |
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
together. Do not edit a migration that has been applied.

## Scope and ownership

`drizzle.config.ts` sets `schemaFilter: ['public']`. Neon Auth owns the
`neon_auth` schema; it is outside our migrations and `db:push` must not inspect
or drop it. Keep all application tables in `public`.

Two rules the database, not code, enforces:

- `edges_have_evidence` — every edge row has an `evidence_chunk_id` or an
  `evidence_run_id` (`CHECK`). Deliberately no bypass.
- `runs.parent_run_id` — self-foreign-key for what-if and repair lineage. It uses
  PostgreSQL's default `NO ACTION`; parent runs are never mutated.

`runs.spec` is a frozen copy of the experiment spec, never a pointer to
`experiments.spec`.

`docs/adr/0011-pgvector-for-retrieval-only.md` notes the HNSW index is not
needed at demo scale. `docs/02-data-model.md` specifies it, so it is created
here; it can be dropped later without touching any column or query contract.
