# Plan — 30 November

Ten days, four people part-time, two of them lost to exams on 23 and 26 November. Roughly 70 useful hours.

The plan is ordered so that the demo is *recordable* as early as possible. A feature that is not in the five-minute video did not ship, regardless of how much of it works.

## Sequencing principle

Build the spine first, in the order the recording visits it, and skip anything that is not on the spine until the spine is finished. The spine is:

```
3 PDFs → claims with quotes → graph → plan → approve → run → verdict → what-if → compare
```

If everything else is missing and that spine works, the submission succeeds. If everything else works and the spine does not, it fails.

## Days

| Day | Date | Work | Definition of done |
|---|---|---|---|
| 0 | Fri 20 | Repo scaffold, Neon project, **verify Neon Auth end to end**, E2B hello-world, pin every dependency | A signed-in user exists and a Python snippet has run in a sandbox |
| 1 | Sat 21 | Schema + migrations; `INGEST_SOURCE` for the three demo PDFs; chunks + embeddings stored | Three sources with chunks and embeddings in the database |
| 2 | Sun 22 | `EXTRACT_CLAIMS` with verbatim-quote validation; claim / method / dataset nodes; edge proposal | The hero claim and at least six evidenced edges exist, seeded from a script |
| — | **Mon 23** | **Exam day.** Reserve for deck outline only | — |
| 3 | Tue 24 | Graph API + React Flow canvas; node cards; evidence panel on edge click | The seeded workspace renders and an edge shows its quote |
| 4 | Wed 25 | `PLAN_EXPERIMENT` + spec validation + approval screen | A valid spec is generated for the hero claim and can be approved |
| — | **Thu 26** | **Exam day.** Reserve for nothing | — |
| 5 | Fri 27 | `EXECUTE` via E2B; metrics capture; result nodes; `EVALUATE`; verdict display | Run A produces a verdict on screen without manual steps |
| 6 | Sat 28 | `BRANCH_WHAT_IF` + one-parameter diff; comparison view; retry loop; notebook export; Firecrawl | Run B renders beside Run A with the delta explained |
| 7 | Sun 29 | Scoring dashboard; ask-across-sources; **record the video**; re-record the failure beat | A complete five-minute recording exists, twice over |
| 8 | Mon 30 | Deck, deploy check, submission form | Submitted |

Days 6 and 7 are the compression point. If the spine is late, cut in this order: scoring dashboard → Firecrawl → notebook export → retry loop. Do not cut what-if, and do not cut the comparison view.

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
