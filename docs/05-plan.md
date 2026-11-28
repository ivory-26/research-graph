# Plan — 30 November

Seven days, from 23 November to 30 November, four people part-time, one day lost to an exam on 26 November. Roughly 50 useful hours.

Re-baselined on 23 November. The earlier version of this plan assumed a ten-day run starting on the 20th; that start did not happen, so everything moved and the cut list moved up. The per-person sequence lives in [07-workstreams](./07-workstreams.md).

The plan is ordered so that the demo is *recordable* as early as possible. A feature that is not in the five-minute video did not ship, regardless of how much of it works.

## Sequencing principle

Build the spine first, in the order the recording visits it, and skip anything that is not on the spine until the spine is finished. The spine is:

```
3 PDFs → claims with quotes → graph → plan → approve → run → verdict → what-if → compare
```

If everything else is missing and that spine works, the submission succeeds. If everything else works and the spine does not, it fails.

## Days

| Date | Milestone across all four streams |
|---|---|
| **Mon 23** | Contracts frozen — types, events, runner interface, schema, scaffold, workspace fixture. Everything else can start |
| **Tue 24** | Ingestion runs on the three PDFs; canvas renders the fixture; auth works; E2B runs a script |
| **Wed 25** | Claims extracted with quotes; runner returns an `ExperimentResult`; SSE endpoint exists |
| **Thu 26** | *Exam day.* Deck outline only |
| **Fri 27** | **The pipeline is wired end to end.** Run A produces a verdict on screen. This is the pivot |
| **Sat 28** | Run B beside Run A; retry loop; notebook export; dashboard. **Segments recorded** |
| **Sun 29** | Video assembled, deck finished, deploy checked, what the recording exposed gets fixed |
| **Mon 30** | Submitted |

Friday 27 is the compression point. If the pipeline is not wired by end of Friday, cut in this order: scoring dashboard → Firecrawl → notebook export → retry loop. Do not cut what-if, and do not cut the comparison view.

## Landed

The plan above is intent; this table is what is on `main`. Updated as PRs merge.

| Date | Landed | PR |
|---|---|---|
| 23 Nov | TanStack Start scaffold, shared contracts, `ExperimentRunner` interface | [#31](https://github.com/ivory-26/research-graph/pull/31) |
| 23 Nov | Drizzle schema, evidence and self-loop checks, pgvector migration, Neon client | [#32](https://github.com/ivory-26/research-graph/pull/32) |
| 23 Nov | SSE transport primitives: framing and `Last-Event-ID` parsing, 15 s heartbeat, abort-aware 500 ms approval polling, 240 s stream budget | [#33](https://github.com/ivory-26/research-graph/pull/33) |
| 23 Nov | Gemini `callModel` wrapper: sequential queue, bounded 429 backoff, Zod validation, one `agent_tasks` row per physical attempt with latency, tokens and cost | [#34](https://github.com/ivory-26/research-graph/pull/34) |
| 23 Nov | Neon Auth session verification, workspace membership guard and same-origin `/api/auth/$` proxy, with auth docs and a live-branch harness | [#36](https://github.com/ivory-26/research-graph/pull/36) |
| 23 Nov | Pipeline runtime persistence: ordered event log and replay, one execution claim per experiment, and compare-and-set approval gates | [#37](https://github.com/ivory-26/research-graph/pull/37) |
| 23 Nov | Dependency refresh: pnpm 12.23.0, `@xyflow/react` 13.0.3, `unpdf` 2.2.2; declared Node floor raised | [#38](https://github.com/ivory-26/research-graph/pull/38) |
| 23 Nov | Runtime moved to Node 26 LTS (`26.x`); `.nvmrc` and `.node-version` pin 26.13.1 | [#41](https://github.com/ivory-26/research-graph/pull/41) |
| 24 Nov | PDF coordinate reading order and ~800-token chunking (#10) | [#44](https://github.com/ivory-26/research-graph/pull/44) |
| 24 Nov | Batch embeddings on `gemini-embedding-2` and pgvector storage (#11) | [#45](https://github.com/ivory-26/research-graph/pull/45) |
| 24 Nov | `EXTRACT_CLAIMS` with verbatim quote validation (#12) | [#46](https://github.com/ivory-26/research-graph/pull/46) |
| 24 Nov | `PROPOSE_EDGES` with evidence validation (#13) | [#47](https://github.com/ivory-26/research-graph/pull/47) |
| 24 Nov | Cross-source retrieval and "ask across sources" with verified citations (#14) | [#48](https://github.com/ivory-26/research-graph/pull/48) |
| 24 Nov | Firecrawl ingestion for project pages and repo READMEs (#15) | [#49](https://github.com/ivory-26/research-graph/pull/49) |
| 24 Nov | `ExperimentSpec` rework, hero spec, E2B runner and `EVALUATE` (#23, #25); replaces the reverted #40 | [#43](https://github.com/ivory-26/research-graph/pull/43) |
| 24 Nov | UI workstation: canvas, evidence, approval, comparison, dashboard, exports | [#51](https://github.com/ivory-26/research-graph/pull/51) |
| 24 Nov | Pinned-environment verification and the real hero run (#24) | [#54](https://github.com/ivory-26/research-graph/pull/54) |
| 24 Nov | Read-only OpenCode PR reviewer in GitHub Actions | [#50](https://github.com/ivory-26/research-graph/pull/50) |
| 25 Nov | SSE delivery and cross-request approval: both routes mounted, real plan/execute/evaluate provider (#6) | [#52](https://github.com/ivory-26/research-graph/pull/52) |
| 25 Nov | Guard against `NaN` embedding token usage from the AI SDK | [#55](https://github.com/ivory-26/research-graph/pull/55) |
| 25 Nov | Review nits from #44–#49, including workspace isolation in `storeEdges` | [#56](https://github.com/ivory-26/research-graph/pull/56) |
| 25 Nov | Review pull requests from the approved fork without executing fork code | [#60](https://github.com/ivory-26/research-graph/pull/60) |

#33 is transport only and #37 is the persistence layer. #52 mounts them: `GET /api/pipeline/:experimentId`, the route adapters, #4 authorization at the route boundary, the approval write path wired to the verified actor, and the database-backed approval read. What #52 deliberately does not do is #7's graph write-back.

### Added after 25 November (PR #68)

| Piece | Owner issue | Notes |
|---|---|---|
| Sign-in / sign-up screens & route gate | #16 | `src/routes/sign-in.tsx`, `sign-up.tsx`, `index.tsx` `beforeLoad`, `src/utils/authClient.ts` |
| Browser→pipeline SSE & approval client | #20 | `src/utils/pipelineClient.ts`, `ApprovalModal.tsx`, `src/routes/index.tsx` |
| Guarded graph, workspace & strategy routes | #18, #21 | `src/routes/api/graph.ts`, `src/routes/api/workspaces.ts`, `src/routes/api/strategies.ts`, `src/utils/graphClient.ts`, `src/utils/strategyClient.ts`. Canvas framing uses `fitView` with `padding: '20%'` (`'38%'` in memory mode), `minZoom: 0.2`, and `maxZoom: 2.4` (`ResearchCanvas.tsx`). |

### Not on `main` on 27 November

| Gap | Owner issue | Blocks |
|---|---|---|
| Write a completed run back as result/run nodes and the `produced` edge | #7 | the graph beat showing a real result |
| Production deploy | #9 | the deployed-link success criterion |
| Strategy selection | #26 | automated selection remains unbuilt; the repair loop and what-if branch are built as modules, and EXECUTE adoption of Run B is #62 |
| Server-side notebook export | Built into production run evaluation | a notebook generated from a real run |

`pnpm typecheck` and `pnpm db:check` pass. `pnpm test` runs 27 `node:test` transport checks plus the Vitest suites: without `TEST_DATABASE_URL`, 417 app tests and 90 seed tests pass and 64 app tests skip on 27 November. The skipped files are the opt-in Postgres, E2B and Gemini integration suites.

## Workstreams

Not assigned to people — assign on the day, by who is free. The seams are chosen so that any stream can stall for a day without blocking the others.

| Stream | Owns | Talks to |
|---|---|---|
| A. Ingest + extract | `INGEST_SOURCE`, `EXTRACT_CLAIMS`, quote validation, embeddings | writes `sources`, `source_chunks`, `nodes` |
| B. Canvas | React Flow, node cards, evidence panel, graph queries | reads `nodes`, `edges`; writes positions only |
| C. Runtime | `PLAN_EXPERIMENT`, `EXECUTE`, `EVALUATE`, notebook export | writes `experiments`, `runs`, `run_artifacts` |
| D. Demo | seed script, video, deck, deploy | reads everything |

The integration seam — the point where four streams collide — is the write path from a completed run to its `result` node and `produced` edge. One person should own that function (#7, ivory-26). It is still unwritten.

## The seed script

**Built (#8).** `pnpm seed` rebuilds the recorded workspace from an empty database: three sources, their chunks, the claim and method nodes, the accepted edges, and both runs with their artifacts. Everything in the video is reproducible by running one command, which is also the honest answer to "is this real?". The original "under a minute" target is deferred by the recorded amendment on #8: free-tier replay completes within five minutes (3m07s measured), and a billed Gemini embedding key or recorded embeddings is the one-minute follow-up.

The seed is not a mock. It runs the real ingestion and the real pipeline; it just does it ahead of time so the recording does not depend on a live network.

## The recording

Five minutes, one take per section, assembled. Sections are recorded separately so a failure costs thirty seconds rather than the whole video.

| Time | Shot |
|---|---|
| 0:00–0:25 | Problem: a claim in a paper, and no way to know if it holds |
| 0:25–1:05 | Drop the hero PDF; Firecrawl pulls the project page; chunks appear with page anchors |
| 1:05–1:40 | "Ask across sources" — a question answered from all three papers with citations |
| 1:40–2:10 | The graph: claim, method, dataset, and edges that open to their evidence |
| 2:10–2:45 | The plan: generated script on screen, dataset and network policy shown, approve |
| 2:45–3:25 | Run A: noise feature at the top of the impurity ranking — the paper's bias, reproduced |
| 3:25–4:05 | What-if: switch to permutation importance; Run B; the comparison view |
| 4:05–4:35 | Dashboard: strategy success rates and cost; notebook export opened in Colab |
| 4:35–5:00 | What it means: reproducible, traceable, and honest about its mode |

The failure beat is recorded on day 6 or 7 from a **real** error encountered during development, not staged. If no real failure has occurred by day 7, that is itself a finding worth saying out loud in the deck.

Two beats depend on unbuilt work. The plan is the hand-written `HERO_EXPERIMENT_SPEC_RUN_A`, not a model-generated script; the what-if comparison is rendered from the fixture. Either build them or say on camera what they are.

## Rules

1. Nothing merges without being reachable from the demo flow.
2. Every number rendered as measured comes from a `runs` row. No hardcoded metrics, anywhere, including in the seed.
3. The deck is written on day 4 and day 6, not on day 8.
4. If a stream is blocked, its owner writes the seed data or the deck section instead of waiting.
