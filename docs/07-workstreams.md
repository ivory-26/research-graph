# Workstreams

Four people, seven days, one deadline. The split exists so that nobody waits for anybody.

## The split

| Owner | GitHub | Stream | Owns |
|---|---|---|---|
| Sahil | `ivory-26` | **Foundation & Integration** | repo, DB, auth, contracts, SSE pipeline, deploy, seed, deck, video |
| — | `CyberCodezilla` | **Ingestion & Extraction** | PDF → text, chunks, embeddings, claim extraction, edges, retrieval, Firecrawl |
| — | `frag2win` | **Canvas & UI** | app shell, React Flow, node cards, evidence panel, approval, comparison, dashboard |
| — | `yashhh-23` | **Runtime & Evaluation** | planner, E2B adapter, metrics, verdict, retry, what-if, notebook export |

## File ownership

Two people never edit the same file. This is the whole trick.

```
src/shared/**                       ivory-26   contracts — heads-up before a change
src/db/**                           ivory-26   schema, migrations, pipeline DB API
src/server/model.ts                 ivory-26   the one callModel wrapper
src/server/auth.ts                  ivory-26
src/server/auth.server.ts           ivory-26
src/server/auth/**                  ivory-26
src/server/pipeline-delivery/**     ivory-26   SSE delivery, approval path, stages
src/server/pipeline-transport/**    ivory-26   framing, heartbeat, budget, approval poll
src/routes/api/**                   ivory-26   route adapters
scripts/ .github/ docs/             ivory-26

src/server/ingest/**                CyberCodezilla
src/server/extract/**               CyberCodezilla
src/server/retrieval.ts             CyberCodezilla
src/server/firecrawl.ts             CyberCodezilla

src/server/planner.ts               yashhh-23
src/server/runner.ts                yashhh-23
src/server/evaluate.ts              yashhh-23
src/server/evaluate-verdict.ts      yashhh-23

src/routes/index.tsx, __root.tsx    frag2win
src/components/**                   frag2win
src/data/**                         frag2win
fixtures/**                         frag2win
```

Planned files with an owner but no file yet:

| File | Owner | Issue |
|---|---|---|
| `src/server/notebook.ts` — server-side notebook | yashhh-23 | #28 |
| `scripts/seed*` — workspace rebuild | ivory-26 | #8 |

Enforced in `.github/CODEOWNERS`. If you need a change in someone else's file, ask them; do not open a parallel edit.

## The contracts that unblock everyone

These land on **day 0** and are then frozen. Everyone codes against them from day 1.

| File | Contains |
|---|---|
| `src/shared/types.ts` | `NodeType`, `NodeData`, `EdgeRelation`, `ExperimentSpec`, `Criteria`, `ExperimentResult`, `Mode`, `Verdict` |
| `src/shared/events.ts` | the `PipelineEvent` union the SSE stream emits |
| `src/server/runner.ts` | `interface ExperimentRunner` (declared by ivory-26, implemented by yashhh-23) |
| `src/server/model.ts` | `callModel<T>(schema, prompt, ctx)` signature (body by ivory-26) |
| `fixtures/workspace.json` | a complete fake workspace — sources, nodes, edges, two runs |

The demo workspace renders `fixtures/workspace.json`. Database workspaces load the graph and strategy dashboard from the workspace APIs, and the approval screen follows the selected experiment's pipeline stream. The runtime is exercised with `HERO_EXPERIMENT_SPEC_RUN_A`.

## What each stream can pick up now

- **CyberCodezilla** — the workspace-scoped path (`ingestSourceToGraphForWorkspace`, `POST /api/sources`) and the `sectioned` and `table_first` strategies are built; the sources page still ingests with the default `single_pass`, so accepting a strategy on the route and surfacing the choice is the next piece.
- **frag2win** — the canvas, overview, experiments and strategy pages read live data when a database workspace is active, and the approval modal POSTs to the real gate. What remains is starting Run B (what-if) from the UI and a live comparison view; the comparison still renders the recorded fixture. Keep every fixture value labelled as recorded when no database workspace is selected.
- **yashhh-23** — the export modal surfaces the persisted notebook from `run_artifacts`; automated strategy selection (#26) and plan generation are what remains.
- **ivory-26** — #7 graph write-back and #9 deploy are landed; #8 seed and #16 sign-in screens are built. The remaining step is redeploying `main` after this branch merges.

## Where each stream stands — 28 November

| Stream | Landed | Open |
|---|---|---|
| Foundation & Integration (ivory-26) | scaffold, schema, auth server, transport, pipeline persistence, SSE delivery, CI reviewer, seed (#8), sign-in screens (#16), browser→pipeline bridge (#20), guarded graph and workspace reads (#18), guarded strategy dashboard reads (related to #22), graph write-back (#7), deploy (#9) | redeploying `main` after the merge that carries this branch |
| Ingestion & Extraction (CyberCodezilla) | PDF reading order, chunking, embeddings, claim extraction, edge proposal, retrieval, Firecrawl, the workspace-scoped ingestion→graph path (`ingestSourceToGraphForWorkspace`, `POST /api/sources`), `sectioned` and `table_first` strategies | surfacing an extraction-strategy choice in the sources page |
| Canvas & UI (frag2win) | canvas, evidence, approval, fixture run comparison (#21), dashboard, exports, live graph, strategy and pipeline reads, experiment creation and live run approval when a database workspace or experiment is active, run results written back to the canvas (#7) | starting Run B (what-if) from the UI; a live comparison view (the comparison still renders the recorded fixture) |
| Runtime & Evaluation (yashhh-23) | planner validation, E2B runner, pinned-environment verification, hero run, deterministic verdict, what-if branch module and queued-run adoption (#62), repair loop, server-side notebook, persisted notebook surfaced in the export modal | strategy selection, plan generation |

## The original day-by-day

Two exam days were scheduled empty on purpose. The table is the plan as written on 23 November, not a completion record; [05-plan](./05-plan.md#landed) is the completion record.

| Date | ivory-26 | CyberCodezilla | frag2win | yashhh-23 |
|---|---|---|---|---|
| **Mon 23** | scaffold, contracts, schema | unpdf spike on 3 PDFs | write the workspace fixture | E2B spike, hero spec |
| **Tue 24** | Neon Auth, deploy, `callModel` | chunk + embed + store | shell, routing, canvas from fixture | spec validation |
| **Wed 25** | SSE endpoint, approval polling | `EXTRACT_CLAIMS` v1 | node cards, evidence panel | E2B adapter → `ExperimentResult` |
| **Thu 26** | *exam* — deck outline only | *exam* — nothing | *exam* — nothing | *exam* — nothing |
| **Fri 27** | **wire the pipeline end to end** | quote validation, `PROPOSE_EDGES` | approval screen, comparison view | `EVALUATE`, verdict, retry loop |
| **Sat 28** | seed script, integration fixes | retrieval API, Firecrawl | dashboard, polish | what-if branch, notebook export |
| **Sun 29** | assemble video, deck, deploy check | record segment, fixes | record segment, fixes | record segment, fixes |
| **Mon 30** | submit | on call | on call | on call |

Friday is the pivot. If the pipeline is not wired on Friday, Saturday becomes integration and something from the cut list goes.

## The integration seam

One function, one owner — **landed** (#7):

```ts
// src/server/pipeline.ts — ivory-26
export async function projectRunToGraph(
  db: Database,
  runId: string,
): Promise<RunGraphProjection>
```

The production stage provider calls it on every terminal run; it writes the run and result nodes and the `produced` edge, idempotently per run id. The canvas and the overview/export reads consume what it writes. If you are working on a stage and need something it does not provide, say so in the issue rather than editing the file.

## Merge rules

1. `main` is always typecheck-clean and test-clean. If it is not, fixing it is the top priority for whoever broke it.
2. Every PR touches files owned by one person, or says in the description that the owner agreed.
3. No one merges their own PR after Friday. Ask for a one-line review.
4. Every PR gets an automated read-only review comment with a `READY` or `FINDINGS` gate. A `READY` gate is not a human approval, and a workflow change always needs a human.
5. If your stream is blocked, pick up your demo segment or a deck slide instead of waiting.

## Video segments

Five minutes total, recorded separately by each owner on Saturday 28th, assembled by Sahil on the 29th.

| Segment | Owner | What is on screen |
|---|---|---|
| Ingest + ask across sources | CyberCodezilla | drop the PDF, chunks appear, a question answered with citations |
| Graph + evidence | frag2win | the canvas, an edge opened to its quote |
| Plan + approve + run | yashhh-23 | the script, the approval screen, the sandbox output, the verdict |
| What-if + dashboard + notebook | frag2win + yashhh-23 | Run B beside Run A, the strategy table, Colab |
| Problem, close, narration | ivory-26 | voiceover throughout, the opening and the last thirty seconds |

Record three takes minimum. A segment that needs a fourth take gets simplified instead.
