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

The UI still renders `fixtures/workspace.json`; the runtime is exercised with `HERO_EXPERIMENT_SPEC_RUN_A`. Nobody is blocked by anybody.

## What each stream can pick up now

- **CyberCodezilla** — wire `ingestPdf`/`ingestWebSource` → `extractClaims` → `proposeEdges` into one workspace-scoped call path, and add the `sectioned` and `table_first` strategies behind the existing interface.
- **frag2win** — wire the remaining canvas panels to the live graph and strategy routes; the approval modal now POSTs to the real gate and the browser reads live data when a database workspace is active. Keep every fixture value labelled as recorded when no database workspace is selected.
- **yashhh-23** — surface the persisted notebook in the UI and generate it from `run_artifacts` rather than the fixture.
- **ivory-26** — #7 graph write-back, #9 deploy; #8 seed and #16 sign-in screens are built.

## Where each stream stands — 27 November

| Stream | Landed | Open |
|---|---|---|
| Foundation & Integration (ivory-26) | scaffold, schema, auth server, transport, pipeline persistence, SSE delivery, CI reviewer, seed (#8), sign-in screens (#16), browser→pipeline bridge (#20), guarded graph/workspace/strategy reads (#18, #21) | #7 graph write-back, #9 deploy |
| Ingestion & Extraction (CyberCodezilla) | PDF reading order, chunking, embeddings, claim extraction, edge proposal, retrieval, Firecrawl | `sectioned` and `table_first` strategies; live end-to-end ingestion from the UI |
| Canvas & UI (frag2win) | canvas, evidence, approval, comparison, dashboard, exports; live graph, strategy and pipeline reads when a database workspace or experiment is active | starting a real run from the UI, writing run results back to the canvas (#7) |
| Runtime & Evaluation (yashhh-23) | planner validation, E2B runner, pinned-environment verification, hero run, deterministic verdict, what-if branch module and queued-run adoption (#62), repair loop, server-side notebook | strategy selection, plan generation |

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

One function, one owner — **not written yet** (#7):

```ts
// src/server/pipeline.ts — ivory-26
async function onRunComplete(run: RunRow): Promise<void> {
  // writes the result node, the produced edge, and the run node
}
```

Today a completed run writes `runs` and emits durable events, but no result/run node and no `produced` edge. Three streams will push into this function; it should be written against the frozen types before the UI needs it. If you are working on a stage and need something it does not provide, say so in the issue rather than editing the file.

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
