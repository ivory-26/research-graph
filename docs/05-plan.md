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

## Workstreams

Not assigned to people — assign on the day, by who is free. The seams are chosen so that any stream can stall for a day without blocking the others.

| Stream | Owns | Talks to |
|---|---|---|
| A. Ingest + extract | `INGEST_SOURCE`, `EXTRACT_CLAIMS`, quote validation, embeddings | writes `sources`, `source_chunks`, `nodes` |
| B. Canvas | React Flow, node cards, evidence panel, graph queries | reads `nodes`, `edges`; writes positions only |
| C. Runtime | `PLAN_EXPERIMENT`, `EXECUTE`, `EVALUATE`, notebook export | writes `experiments`, `runs`, `run_artifacts` |
| D. Demo | seed script, video, deck, deploy | reads everything |

The integration seam — the point where four streams collide — is the write path from a completed run to its `result` node and `produced` edge. One person should own that function, and it should be written on day 5 before the UI needs it.

## The seed script

`pnpm seed` must rebuild the recorded workspace from an empty database in under a minute: three sources, their chunks, the claim and method nodes, the accepted edges, and both runs with their artifacts. Everything in the video is reproducible by running one command, which is also the honest answer to "is this real?".

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

## Rules

1. Nothing merges without being reachable from the demo flow.
2. Every number rendered as measured comes from a `runs` row. No hardcoded metrics, anywhere, including in the seed.
3. The deck is written on day 4 and day 6, not on day 8.
4. If a stream is blocked, its owner writes the seed data or the deck section instead of waiting.
