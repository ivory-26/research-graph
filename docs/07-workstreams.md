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
src/shared/**            ivory-26      contracts — changes need a heads-up in the group chat
src/db/**                ivory-26
src/server/model.ts      ivory-26      the one callModel wrapper
src/server/pipeline.ts   ivory-26      the integration seam
src/server/admin.ts      ivory-26

src/server/ingest/**     CyberCodezilla
src/server/extract/**    CyberCodezilla
src/server/retrieval.ts  CyberCodezilla
src/server/firecrawl.ts  CyberCodezilla

src/server/planner.ts    yashhh-23
src/server/runner.ts     yashhh-23
src/server/evaluate.ts   yashhh-23
src/server/branch.ts     yashhh-23
src/server/notebook.ts   yashhh-23

src/routes/**            frag2win
src/components/**        frag2win
fixtures/**              frag2win
```

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

Until the real pipeline exists, the UI renders `fixtures/workspace.json` and the runtime is exercised with a hand-written `ExperimentSpec`. Nobody is blocked by anybody.

## What you can start today, before anything exists

- **CyberCodezilla** — download the three PDFs, run `unpdf` on them in a scratch script, and confirm the Strobl PDF's column order survives. If it does not, that is a day-one finding and the fallback is hand-authored chunk anchors.
- **frag2win** — author `fixtures/workspace.json` from [02-data-model](./02-data-model.md) and [00-scope](./00-scope.md). It is the most useful single artifact for the UI and it is yours to define.
- **yashhh-23** — run a Python snippet in E2B and confirm the base image has numpy, pandas, scikit-learn and matplotlib at the versions we pin. Hand-write the hero `ExperimentSpec` and get `metrics.json` out of a sandbox.
- **ivory-26** — scaffold, contracts, schema, auth.

## Days

Two exam days are scheduled empty on purpose. Do not plan work into them.

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

One function, one owner:

```ts
// src/server/pipeline.ts — ivory-26
async function onRunComplete(run: RunRow): Promise<void> {
  // writes the result node, the produced edge, and the run node
}
```

Three streams push into it. It is written on Wednesday, before any of them needs it, against the frozen types. If you are working on a stage and need something this function does not provide, say so in the issue rather than editing the file.

## Merge rules

1. `main` is always deployable. If it is not, fixing it is the top priority for whoever broke it.
2. Every PR touches files owned by one person, or says in the description that the owner agreed.
3. No one merges their own PR after Friday. Ask for a one-line review.
4. If your stream is blocked, pick up your demo segment or a deck slide instead of waiting.

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
