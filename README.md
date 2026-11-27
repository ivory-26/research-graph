# ResearchGraph

An AI research workspace that turns a paper's claim into a connected, executable and auditable experiment.

Drop in a paper. The system extracts what it asserts, cites the passage, plans a minimal repro, runs it on a CPU, and tells you how far your result is from theirs — then lets you change one parameter and see what moves.

## Why this is not another research chatbot

The graph is the presentation, not the product. The product is the claim:

- every relationship in the workspace carries the quote that justifies it
- every result is compared against the number the paper reported, under a declared reproduction mode
- the verdict is computed by code, not written by a model

## Status — 27 November 2026

`main` is mid-build toward the 30 November recording. The trustworthy core works at the module level; the browser workstation renders `fixtures/workspace.json` when no database workspace UUID is active, and includes `/sign-in`/`/sign-up`, `pipelineClient.ts`, and guarded `/api/graph`, `/api/workspaces`, and `/api/strategies` routes.

**Working on `main`**

- Drizzle schema and migrations: 14 tables, pgvector, the `edges_have_evidence` check, durable `pipeline_events`, `execution_claims` and `approval_gates`
- Ingestion: coordinate-based PDF reading order, ~800-token chunks with 15% overlap, `gemini-embedding-2` at 768 dimensions, pgvector storage, Firecrawl project pages and repo READMEs
- Extraction: claims with verbatim-quote validation, proposed edges with evidence, and workspace-scoped edge storage
- Retrieval: cross-source passages and "ask across sources" with verified citations
- Runtime: planner validation, the real E2B runner with pinned-package verification, the deterministic evaluator, and a `gemini-4-hydrogen` `explain_gap` explanation that cannot change the verdict
- Delivery: `GET /api/pipeline/:experimentId` SSE, `POST /api/pipeline/:experimentId/approve`, 240 s budget, 15 s heartbeat, cross-request approval polling and Last-Event-ID replay
- Auth: Neon Auth session verification, the same-origin `/api/auth/$` proxy, the workspace-membership guard, `/sign-in` & `/sign-up` screens (#16), and the `/` `beforeLoad` route gate
- UI: the React Flow canvas, evidence panel, approval modal, comparison view, strategy dashboard and notebook export, reading `GET /api/graph` / `GET /api/strategies` / `GET /api/pipeline/:experimentId` when a database workspace/experiment UUID is active and falling back to `fixtures/workspace.json` otherwise
- CI: typecheck, tests and `db:check` on same-repository PRs, plus a read-only OpenCode reviewer that also covers the approved fork (fork checks report `NOT RUN`)

**Not on `main` yet**

- writing a completed run back as result/run nodes and the `produced` edge (#7)
- `pnpm seed` (#8)
- the production deploy (#9)
- what-if branch execution, the repair loop and multi-strategy selection
- server-side notebook generation from `run_artifacts` (the UI builds one from the fixture)

**Verified 27 November 2026:** `pnpm typecheck`, `pnpm db:check` and `pnpm test` pass. The run reports 342 tests passing and 31 skipped: 27 `node:test` transport checks plus Vitest's 315 passed / 31 skipped. The skipped files are the opt-in Postgres/E2B/Gemini integration suites; they run only with `TEST_DATABASE_URL` (and `LIVE_SMOKE=1` for the credentialed smoke). See [docs/09-pipeline-delivery-handoff.md](./docs/09-pipeline-delivery-handoff.md).

| Document | Contents |
|---|---|
| [00-scope](./docs/00-scope.md) | product brief, the demo, non-goals, success criteria |
| [01-architecture](./docs/01-architecture.md) | system shape, trust boundary, what is built |
| [02-data-model](./docs/02-data-model.md) | schema, and the rules the database enforces |
| [03-agent-pipeline](./docs/03-agent-pipeline.md) | the eight stages and which ones exist |
| [04-experiment-runtime](./docs/04-experiment-runtime.md) | spec, result, E2B adapter, notebook export |
| [05-plan](./docs/05-plan.md) | the 30 November plan and what has landed |
| [06-risks](./docs/06-risks.md) | what breaks, and the honest answers |
| [07-workstreams](./docs/07-workstreams.md) | the four-way split and file ownership |
| [08-auth](./docs/08-auth.md) | Neon Auth setup, proxy, workspace guard |
| [09-pipeline-delivery](./docs/09-pipeline-delivery-handoff.md) | SSE delivery, approval path, test and live-run record |
| [10-docs-maintenance](./docs/10-docs-maintenance.md) | the manual refresh process and when each doc must change |
| [GLOSSARY](./GLOSSARY.md) | the vocabulary |
| [ADRs](./docs/adr/) | why the surprising decisions were made |

## Commands

```bash
pnpm dev            # TanStack Start dev server on :3000
pnpm build          # Vite client + SSR
pnpm typecheck      # tsc --noEmit
pnpm test           # node:test transport files, then the Vitest suite
pnpm verify:hero    # Docker-only hero-spec verification; needs a running daemon
pnpm db:generate    # after editing src/db/schema.ts
pnpm db:migrate     # apply committed migrations
pnpm db:push        # disposable branch only: pgvector bootstrap, then push
pnpm db:check       # validate the migration journal and snapshots
pnpm db:studio      # inspect the public schema
```

`pnpm seed` is planned with #8 and is not on `main` yet.

## Stack

TanStack Start 1.169.x · React 19 · TypeScript 7 · Neon Postgres (pgvector) · Drizzle · Vercel AI SDK 7 · Google Gemini (`gemini-3.8-flash`, `gemini-4-hydrogen` for `explain_gap`, `gemini-embedding-2`) · E2B · Firecrawl · `@xyflow/react` 13

Node 26.x, ESM only. `.nvmrc` and `.node-version` pin 26.13.1.

## Experiment runtime

Generated Python experiments execute in an isolated E2B sandbox (`researchgraph-python:locked`, 1 vCPU, 2048 MB RAM, networking disabled at run time). The runner verifies the pinned package versions (`numpy==2.5.5`, `pandas==2.3.3`, `scikit-learn==1.9.1`, `scipy==1.17.1`, `matplotlib==3.10.0`) before accepting a result. The same environment is available through `Dockerfile.template` and the hardening flags in [docs/04](./docs/04-experiment-runtime.md); `pnpm verify:hero` reproduces the hero run through Docker and checks its metrics against `HERO_RECORDED_RUN_RESULT`. The demo path uses E2B.

## Credit

The node/edge vocabulary and the `command_receipts` idea are borrowed from [FOREST](https://github.com/mikamikasuki/FOREST) (Apache-2.0). No code is copied.
