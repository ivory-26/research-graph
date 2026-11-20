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

## Request lifecycle

A pipeline run is one long-lived HTTP response.

1. `GET /api/pipeline/:experimentId` opens an SSE stream and starts the pipeline.
2. Each step writes a row (`agent_tasks`) and emits an event. Events are also persisted, so a reconnect can replay.
3. At the approval gate the stream emits `approval.requested` and the handler begins polling `experiments.approval_state` every 500 ms.
4. The browser shows the approval screen and `POST`s to `/api/pipeline/:id/approve`, which only updates that row.
5. The stream resumes when the row changes.
6. The response ends when the run finishes or the **240-second budget** is exhausted.

Approval state lives in Postgres, not in memory, because the SSE request and the approve request can land on different Vercel instances.

### Why 240 seconds

Vercel Hobby caps a function at 300 seconds and streamed time counts against it. A run is seconds; the budget exists to cover a retry cascade. On exhaustion the stream emits `run.timeout` and the run is marked failed. The escape hatch, if this ever proves too tight, is moving **only this endpoint** to Neon Functions (15-minute ceiling) — which is cheap precisely because the runner sits behind one interface.

A heartbeat comment is written every 15 seconds so intermediaries do not drop an idle connection.

## Components

| Component | Responsibility | Must not |
|---|---|---|
| `sources` | ingest PDFs (unpdf), web pages (Firecrawl), chunk, embed | interpret content |
| `extract` | one structured call per source → claims, methods, datasets, code URLs | invent a locator that is not verbatim in the chunk |
| `connect` | propose typed edges with evidence | write an edge without a resolvable quote |
| `plan` | claim + method → `ExperimentSpec` | execute anything |
| `approve` | human gate | be skippable by the pipeline |
| `runner` | `run(spec) → result` against E2B | expose host credentials to the sandbox |
| `evaluate` | deterministic predicate evaluation; model writes only the explanation | let the model decide the verdict |
| `branch` | clone a spec, change one parameter, link lineage | mutate the parent run |

## Deployment

Vercel via Nitro's preset (`nitro()` plugin, `vercel deploy`). TanStack Start has no Vercel-specific preset; the documented path is Nitro's. Node 22+, ESM only — AI SDK 7 requires both.

Pin `@tanstack/react-start` at **≥ 1.168.60**. Anything from 1.143.12 to 1.168.59 carries CVE-2026-102989, a critical reflected XSS in server-function response handling. Never scaffold from an older lockfile.

## What breaks first

- **E2B quota or cold start** during recording. Mitigation: warm a sandbox before the take; the recording is the artifact, not the live run.
- **Gemini 429** on a burst. Mitigation: sequential calls with backoff; the pipeline is deliberately not parallel.
- **unpdf column order** on the hero PDF. Mitigation: verify on day one; fall back to manual chunk anchors for the three demo sources.
- **The 300-second ceiling** if a retry cascade stretches. Mitigation: budget counter in the pipeline, not in the UI.
