# Architecture

## Shape

```
┌────────────────────────────────────────────────────────────────┐
│ Browser                                                        │
│   React 19 · @xyflow/react canvas · SSE client                 │
└───────────────┬────────────────────────────────────────────────┘
                │ HTTPS
┌───────────────▼────────────────────────────────────────────────┐
│ Vercel — TanStack Start 1.169.x                                │
│   server functions ........ CRUD: sources, nodes, edges, runs  │
│   GET /api/pipeline/:id ... SSE: runs the pipeline, streams    │
│   POST /api/pipeline/:id/approve ... writes approval state     │
└──┬──────────┬─────────────┬──────────────┬─────────────────────┘
   │          │             │              │
   │          │             │              └──────────────┐
   │          │             │                             │
┌──▼───────┐ ┌▼──────────┐ ┌▼─────────────┐  ┌────────────▼─────────┐
│ Neon     │ │ Gemini    │ │ Firecrawl    │  │ OpenML / UCI         │
│ Postgres │ │ flash +   │ │ project      │  │ dataset bytes        │
│ +pgvector│ │ embedding │ │ pages        │  │ (app-side fetch)     │
└──────────┘ └───────────┘ └──────────────┘  └────────────┬─────────┘
                                                           │ upload
                                              ┌────────────▼─────────┐
                                              │ E2B sandbox          │
                                              │ UNTRUSTED            │
                                              │ network: disabled    │
                                              │ python: generated    │
                                              └──────────────────────┘
```

## The one boundary that matters

Everything left of E2B is trusted. The sandbox is not.

Generated Python never runs in the application process, never receives the database URL, the Gemini key, the Firecrawl key or any filesystem path from the host. It receives exactly two things: a set of files we wrote, and a set of datasets we fetched and hashed ourselves. Networking is off at execution time, so a prompt-injected script cannot exfiltrate anything even if it tries.

Dataset bytes are fetched by the **application**, hashed, then uploaded into the sandbox. This is why execution can be network-free without losing the ability to download data — and it means the hash recorded in the run environment is the hash of the bytes that were actually used.

The diagram is the target shape. On `main` the routes under `src/routes/api` are the two pipeline endpoints and the auth proxy; there are no CRUD server functions for sources, nodes, edges or runs, and the browser does not call the pipeline yet.

## Request lifecycle

A pipeline run is one long-lived HTTP response.

1. `GET /api/pipeline/:experimentId` opens an SSE stream and starts the pipeline.
2. Each step writes a row (`agent_tasks`) and emits an event. Events are also persisted, so a reconnect can replay.
3. At the approval gate the stream emits `approval.requested` and the handler begins polling `experiments.approval_state` every 500 ms.
4. The browser shows the approval screen and `POST`s to `/api/pipeline/:id/approve`, which writes exactly one decision (the gate row, the resolved event and `experiments.approval_state`) and never runs a stage.
5. The stream resumes when the row changes.
6. The response ends when the run finishes or the **240-second budget** is exhausted.

Approval state lives in Postgres, not in memory, because the SSE request and the approve request can land on different Vercel instances.

### What the request actually does on `main`

The delivery layer is in `src/server/pipeline-delivery/`. It owns the stream, the claim, the gate and the terminal event; the stage work is the production provider:

| Stage in this request | Behaviour |
|---|---|
| `PLAN_EXPERIMENT` | Loads `experiments.spec` and runs `validateExperimentSpec`. It validates the stored plan; it does not generate one. An invalid stored plan fails before a gate opens. |
| `AWAIT_APPROVAL` | The gate is a row (`approval_gates`) bound to the `approval.requested` seq, the claim and the experiment. The POST commits a decision in its own transaction; the stream replays it with its real seq. |
| `EXECUTE` | Writes the `runs` row with the approved, frozen spec, then calls the real `E2BRunner`. The measured result updates the row and becomes `run.succeeded` / `run.failed`. |
| `EVALUATE` | `evaluateExperiment` computes the verdict first; `explain_gap` on `gemini-4-hydrogen` only writes the explanation. The verdict and checks are persisted and emitted as `verdict.computed`. |

It deliberately does **not** run `INGEST_SOURCE`, `EXTRACT_CLAIMS` or `PROPOSE_EDGES` in this request, and it does **not** write result/run graph nodes or the `produced` edge. Those graph writes are `src/server/pipeline.ts` (#7), which has not landed. The durable run row and event log are the record this layer owns.

A reconnect, a concurrent GET, or a GET after the budget sees the existing `execution_claims` row and becomes a follower; only the claim owner appends a terminal event. Terminal events close the claim. If the terminal append itself fails, the claim expires on its lease and ADR 0003 applies: the run is lost.

### Why 240 seconds

Vercel Hobby caps a function at 300 seconds and streamed time counts against it. A run is seconds; the budget exists to cover a retry cascade. On exhaustion the stream emits `run.timeout` when a run is still active and marks that run `timeout`; with no active run it emits only `pipeline.failed`. The escape hatch, if this ever proves too tight, is moving **only this endpoint** to Neon Functions (15-minute ceiling) — which is cheap precisely because the runner sits behind one interface.

A heartbeat comment is written every 15 seconds so intermediaries do not drop an idle connection.

## Components

| Component | Module on `main` | Responsibility | Must not |
|---|---|---|---|
| ingest | `src/server/ingest/` | PDF reading order, ~800-token chunks, `gemini-embedding-2` at 768 dims, pgvector store | interpret content |
| web ingest | `src/server/firecrawl.ts` | scrape project pages and repo READMEs, then chunk and embed them | trust scraped markup as evidence without a chunk |
| extract | `src/server/extract/claims.ts`, `quote.ts` | one structured call per source; claims, methods, datasets, code URLs | accept a quote that is not verbatim in its chunk |
| connect | `src/server/extract/edges.ts` | typed edges with evidence; `confidence < 0.65` or `contradicts` land as `suggested` | write an edge without a resolvable quote |
| retrieval | `src/server/retrieval.ts` | top-k cross-source passages and "ask across sources" with verified citations | present an unverified citation as grounded |
| plan | `src/server/planner.ts` | validate a stored `ExperimentSpec` against the hard rules | generate a plan; it only validates |
| approve | `src/server/pipeline-delivery/`, `src/db/pipeline-*.ts` | durable gate, same-origin POST, verified actor, one decision | be skippable by the pipeline |
| runner | `src/server/runner.ts` | `run(spec) → result` against E2B, pinned-package verification, dataset hashing | expose host credentials to the sandbox |
| evaluate | `src/server/evaluate.ts`, `evaluate-verdict.ts` | deterministic predicate evaluation; model writes only the explanation | let the model decide the verdict |
| branch | — not built | clone a spec, change one parameter, link lineage | mutate the parent run |
| UI | `src/routes/index.tsx`, `src/components/` | canvas, evidence, approval, comparison, dashboard | be mistaken for a live database client |

The UI on `main` is driven by `fixtures/workspace.json` and `fixtures/hero-spec.ts`. It is the intended design rendered against recorded data, not a client of the API.

## Deployment

Vercel via Nitro's preset (`nitro()` plugin, `vercel deploy`). TanStack Start has no Vercel-specific preset; the documented path is Nitro's. Node 26 LTS (`26.x`), ESM only — AI SDK 7 requires both. Vercel exposes only major versions, so `engines.node` stays `26.x`; `.nvmrc` and `.node-version` pin the latest 26 patch (26.13.1) for local work.

`vercel.json` is committed (`buildCommand: pnpm build`, `installCommand: pnpm install`), but **no production deploy exists yet** (#9). Until it does, the recorded workspace is a local fixture and the deployed-link success criterion in [the scope](./00-scope.md) is unmet.

Pin `@tanstack/react-start` at **≥ 1.168.60**; `main` is on 1.169.7. Anything from 1.143.12 to 1.168.59 carries CVE-2026-102989, a critical reflected XSS in server-function response handling. Never scaffold from an older lockfile.

## Continuous integration

`.github/workflows/pr-review.yml` runs on same-repository PRs and on PRs from the approved fork (`yashhh-23/research-graph`, repository id `1468841894`). It runs `pnpm typecheck`, `pnpm test` and `pnpm db:check`, then asks OpenCode for a read-only review and posts one comment with a `READY` or `FINDINGS` gate.

Fork PRs are reviewed from a checkout of the trusted base branch; the fork's code is never executed, so their checks report `NOT RUN` and the reviewer cannot declare them ready. The workflow file, reviewer instructions and review scripts are restored from the base branch and pinned by sha256 while the base cannot supply them. See [ADR 0012](./adr/0012-fork-pr-review-workflow.md).

## What breaks first

- **E2B quota or cold start** during recording. Mitigation: warm a sandbox before the take; the recording is the artifact, not the live run. A real sandbox run on the pinned template passed on 25 November.
- **Gemini 429** on a burst. Mitigation: sequential calls with backoff; the pipeline is deliberately not parallel. Provider *capacity* errors (`high demand`) are not retried, only rate limits.
- **unpdf column order** on the hero PDF. Mitigation: the coordinate reader and de-hyphenation are covered by tests; the two-column case is asserted.
- **The 300-second ceiling** if a retry cascade stretches. Mitigation: budget counter in the pipeline, not in the UI.
- **The browser-to-pipeline bridge.** The single largest unbuilt piece: the UI still renders fixtures while the endpoint works in isolation. It is the first thing to wire.
