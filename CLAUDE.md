# ResearchGraph

A workspace that turns a paper's claim into a connected, executable and auditable experiment. TypeScript end to end; Python only ever runs inside a sandbox.

## Read first

1. [docs/00-scope.md](./docs/00-scope.md) — what is being built, and what is deliberately not
2. [docs/01-architecture.md](./docs/01-architecture.md) — the trust boundary
3. [docs/02-data-model.md](./docs/02-data-model.md) — schema and the rules enforced in it
4. [docs/03-agent-pipeline.md](./docs/03-agent-pipeline.md) — the eight stages
5. [docs/04-experiment-runtime.md](./docs/04-experiment-runtime.md) — spec, result, adapter
6. [docs/05-plan.md](./docs/05-plan.md) — the deadline and the sequence
7. [GLOSSARY.md](./GLOSSARY.md) — use these words and no others
8. [docs/adr/](./docs/adr/) — why the surprising choices were made

## Invariants

These are not style preferences. Breaking one of them breaks the product's only claim.

- **A reported value is never written over a measured value.** They are separate rows. No code path copies one into the other.
- **An edge cannot exist without evidence.** The database enforces it. Do not add a code path that bypasses the constraint.
- **A quote is verbatim or the claim is rejected.** No fuzzy matching against source text.
- **The verdict is computed by code.** The model may explain a verdict; it may not produce one.
- **Generated Python never runs in the application process**, never sees a secret, and executes with networking disabled.
- **Every run declares its mode.** `exact`, `adapted` or `conceptual`. We only ever produce `adapted`.
- **Every model call writes exactly one `agent_tasks` row**, including failures.
- **No hardcoded metrics anywhere**, including the seed script.

## Stack, pinned

| Thing | Version / note |
|---|---|
| Node | 26.x LTS (AI SDK 7 is ESM-only); `.nvmrc` pins 26.13.1 |
| `@tanstack/react-start` | ≥ 1.168.60 — earlier versions carry CVE-2026-102989 |
| `ai` | 7.x — `ToolLoopAgent`, `tool({ inputSchema })`, `generateText({ output: Output.object() })`. `generateObject` is deprecated |
| `@ai-sdk/react` | 4.x — `useChat({ transport })`, `message.parts`. `handleSubmit` and `api` props no longer exist |
| `@ai-sdk/google` | 4.x — models `gemini-3.8-flash` (default), `gemini-4-hydrogen` (evaluator `explain_gap` only), embeddings `gemini-embedding-2` at 768 dims |
| Drizzle + Neon | pgvector on, HNSW optional at this scale |
| `@xyflow/react` | canvas |
| `unpdf` | PDF text extraction |
| E2B | experiment sandbox |

Much of the AI SDK material online describes v5 or v6 and will not compile. When in doubt, read the installed types, not a tutorial.

`gemini-4-hydrogen` is a deliberate, evaluator-only exception: the Stage 7 `explain_gap` call uses it for the two-sentence explanation, while `evaluateExperiment` computes the verdict before that call and the model cannot change it. Every other text call site uses `gemini-3.8-flash`, and embeddings stay on `gemini-embedding-2`. `DEFAULT_PRICING` costs the evaluator call at the published Standard paid rate ($1.50 input / $7.50 output per million tokens, thinking included at the output rate); that is an accounting estimate, not billing telemetry.

Gemini constrains our schemas: flat or one level of nesting, no recursive `$ref`, and never rely on `minLength` / `maxLength` / `uniqueItems` — they are silently ignored, so validate in Zod after the call.

## Commands

Ingestion, extraction, retrieval, the E2B runner, the deterministic evaluator, the SSE pipeline routes, sign-in/sign-up screens (#16), and the browser→pipeline / graph / strategy API clients are built. The graph write-back (#7), seed (#8), and deploy (#9) are not. Database commands read `DATABASE_URL` from `.env`; see [src/db/README.md](./src/db/README.md).

```bash
pnpm dev             # TanStack Start dev server
pnpm build           # Vite client + SSR, Nitro server bundle
pnpm typecheck
pnpm verify:hero     # Docker-only hero-spec check; needs a running daemon
pnpm db:generate     # after editing src/db/schema.ts: new SQL + snapshot
pnpm db:migrate      # apply committed migrations (empty database included)
pnpm db:push         # disposable branch only: pgvector bootstrap, then push
pnpm db:check        # validate the migration journal and snapshots
pnpm db:studio       # inspect the public schema
pnpm seed            # rebuild the recorded workspace — lands with #8, not on main yet
```

## Layout

```
src/
  routes/            TanStack Start routes (api/auth, api/pipeline, index)
  server/            ingest, extract, retrieval, firecrawl, planner, runner,
                     evaluate, model, auth, pipeline-delivery, pipeline-transport
  db/                schema, migrations, pipeline event/claim/gate queries
  shared/            contracts frozen on day 0 — types, events
  components/        canvas, panels, approval screen (fixture-driven UI)
  data/              demoWorkspace.ts — the recorded fixture the UI renders
fixtures/            workspace.json, hero-spec.ts, papers, extract
docs/                the documents above
```

The UI renders `fixtures/workspace.json` and `fixtures/hero-spec.ts` when no database workspace UUID is active, and reads `/api/graph`, `/api/workspaces`, `/api/strategies`, and `/api/pipeline/:experimentId` when an authenticated workspace/experiment is selected. Do not present fixture values as measured run output.

## Working style

The deadline is 30 November and the deliverable is a five-minute recording. A feature that is not in that recording did not ship. Ask before building anything that is not on the spine in [docs/05-plan.md](./docs/05-plan.md).

Documentation is refreshed manually; there is no CI gate. Before a milestone or after a change to schema, stages, routes, commands, auth or ownership, follow [docs/10-docs-maintenance.md](./docs/10-docs-maintenance.md). Do not state that a fixture value is measured run output.
