# Risks

Ordered by how likely they are to cost the submission, not by how interesting they are.

Status as of 25 November. Rows marked **verified** have been exercised against the real service; they stay in the table because the recording depends on the service again.

| # | Risk | Likelihood | Impact | Mitigation | Fallback |
|---|---|---|---|---|---|
| 1 | **The browser never reaches the pipeline** | High | High | This is the largest unbuilt bridge: the endpoint works, the UI renders fixtures | Record the backend and the UI separately, and say so |
| 2 | **No deploy on 30 November** | High | High | `vercel.json` exists; #9 is unstarted | A local recording and a repository link; say plainly that no hosted link exists |
| 3 | **No seed script** | High | High | #8 is unstarted; the fixture is currently the recorded workspace | Keep the fixture and label it as a recording aid, not a seed |
| 4 | **Deck written on the last night** | High | High | The deck is not on `main` | Ship a shorter deck; the video carries the submission |
| 5 | The failure beat has no real failure to show | High | Medium | The repair loop is unbuilt; a failed sandbox or provider error must supply the material | Say out loud that the failure beat is the missing repair loop |
| 6 | Text-provider 429/503 during recording | Medium | High | Sequential calls only; 429/503 backoff with jitter; warm the pipeline before the take | Recorded segments; re-run the failing section |
| 7 | Four part-time people collide on the run→node seam | High | Medium | One owner; the seam (#7) is still unwritten | Freeze the interface and stub it |
| 8 | A judge asks for a live run and one is attempted | Medium | High | Do not offer one. The video is the artifact | Pre-warmed sandbox and a rehearsed 90-second path |
| 9 | Text-provider capacity (`high demand`) | Medium | Medium | Bounded 429/503 retries; a failed explanation is recorded and the verdict still completes | Record without the explanation, or retake the segment |
| 10 | E2B unavailable at record time | Low — **verified** on 25 Nov | High | Warm a sandbox before recording; each section recorded separately | Local Docker run captured separately and labelled |
| 11 | Neon Auth does not work as documented | Low — **verified** | High | Session, membership and proxy paths pass the local harness and a live-branch check | Clerk, one day of work |
| 12 | `unpdf` mangles two-column order in the hero PDF | Low — the coordinate reader and de-hyphenation are tested | Medium | The two-column case is asserted, not assumed | Hand-authored chunk anchors for the three demo sources |
| 13 | Pipeline exceeds the 240 s budget after retries | Low | Medium | Budget counter in the pipeline; cancellation reaches the live sandbox | Move only the SSE endpoint to Neon Functions |
| 14 | Neon free tier: 1 GB storage, 100 CU-hours | Low | Medium | Three PDFs and a few hundred chunks are kilobytes | Prune chunks from the two supporting sources |
| 15 | GitHub search fails to find the authors' code | Medium | Low | Code links are optional by design | The claim, dataset and method are sufficient |
| 16 | Fork PRs are reviewed without running their checks | Certain | Low | The reviewer reads the fork diff against the trusted base and marks checks `NOT RUN` | Run the fork's checks locally before merging |

## Predictable questions, and the answers we should give

Write these into the deck. Each answer should be true when it is said, including the caveats.

**"Did you run the authors' code?"**
No. We implemented their method from the paper and ran it on the dataset they named. Every run is labelled `adapted`, not `exact`. Running their repository is the obvious next step and is exactly what our runner interface exists for.

**"Is this a real agent?"**
The model makes the judgement at each step; the system decides which step is next. That is deliberate — it makes the demo reproducible. Automated strategy selection is designed and its tables exist, but nothing picks a strategy yet; do not claim it is running.

**"How is this different from FOREST?"**
FOREST is broader and further along. We are narrower and we make one claim they do not: every edge carries its evidence, and every result is compared against the reported value under an explicitly declared reproduction mode. We borrowed their edge vocabulary and said so.

**"Does it work on papers outside ML?"**
The ingest path can read them. Execution is limited to tabular ML, and the current UI does not yet enforce that distinction, so the answer today is "it can read them; it cannot run them".

**"What stops it from making things up?"**
Three things: a claim whose quote is not verbatim in the source is rejected, an edge cannot be written without evidence because the database refuses it, and the verdict is computed by code before any model is asked to explain it.

**"What about your own scoreboard — is it real?"**
The design is a `GROUP BY` over `agent_tasks` and nothing else. On `main` that `GROUP BY` is not wired: the dashboard renders recorded fixture rows, and strategy selection is unbuilt. The honest answer today is "the table is the design; the data behind this screen is a fixture", not "these are live counts".

**"Is what I see on screen coming from the database?"**
Not yet. The pipeline endpoint, runner, evaluator and retrieval API work server-side; the browser is a fixture-driven workstation. The bridge is the open work.

## What would make this fail badly

Not a missing feature. The failure mode that actually loses a hackathon is a demo that *looks* finished and is caught overclaiming — a measured number that turns out to be hardcoded, a "reproduction" that never ran, a learning curve that was drawn by hand. Every decision in these docs trades breadth for not being caught in that position.
