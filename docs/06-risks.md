# Risks

Ordered by how likely they are to cost the submission, not by how interesting they are.

| # | Risk | Likelihood | Impact | Mitigation | Fallback |
|---|---|---|---|---|---|
| 1 | Neon Auth does not work as documented | Medium | High | Verify on day 0 before any UI exists | Clerk, one day of work |
| 2 | Gemini free-tier 429 during recording | Medium | High | Sequential calls only; backoff with jitter; warm the pipeline before the take | Recorded segments; re-run the failing section |
| 3 | E2B unavailable at record time | Low | High | Warm a sandbox before recording; each section recorded separately | Local Docker run captured as a screen recording, labelled as such |
| 4 | `unpdf` mangles two-column order in the hero PDF | Medium | Medium | Check on day 1 | Hand-authored chunk anchors for the three demo sources; still real text, just pre-split |
| 5 | Pipeline exceeds the 240s budget after retries | Low | Medium | Budget counter in the pipeline; two-attempt ceiling | Move only the SSE endpoint to Neon Functions |
| 6 | Deck written on the last night | High | High | Deck outline on 23 Nov, half-built by 26 Nov | Ship a shorter deck; the video carries the submission |
| 7 | Generic retry loop behaves differently on camera | High | Medium | Record the failure section separately, several takes | Use the real failure observed during development as the only failure shown |
| 8 | Exam days (23, 26) collapse momentum | Certain | Medium | Those days are scheduled empty on purpose | Cut in the order given in [the plan](./05-plan.md) |
| 9 | Neon free tier: 1 GB storage, 100 CU-hours | Low | Medium | Three PDFs and a few hundred chunks are kilobytes | Prune chunks from the two supporting sources |
| 10 | GitHub search fails to find the authors' code | Medium | Low | OpenAlex exposes no repository field, so this is a search step by design | The claim and dataset are sufficient; code links are optional |
| 11 | A judge asks for a live run and one is attempted | Medium | High | Do not offer one. The video is the artifact | Pre-warmed sandbox and a rehearsed 90-second path |
| 12 | Four part-time people with no fixed split collide on the run→node seam | High | Medium | One owner for that function, written on day 5 | Freeze the interface and stub it |

## Predictable questions, and the answers we should give

Write these into the deck. Each of them is true, and each is better said first than extracted under questioning.

**"Did you run the authors' code?"**
No. We implemented their method from the paper and ran it on the dataset they named. Every run is labelled `adapted`, not `exact`. Running their repository is the obvious next step and is exactly what our runner interface exists for.

**"Is this a real agent?"**
The model makes the judgement at each step; the system decides which step is next. That is deliberate — it makes the demo reproducible. Strategy selection is real and driven by verified outcomes, not a simulation.

**"How is this different from FOREST?"**
FOREST is broader and further along. We are narrower and we make one claim they do not: every edge carries its evidence, and every result is compared against the reported value under an explicitly declared reproduction mode. We borrowed their edge vocabulary and said so.

**"Does it work on papers outside ML?"**
It ingests and reads them. It cannot execute them. The UI says so rather than failing quietly.

**"What stops it from making things up?"**
Three things: a claim whose quote is not verbatim in the source is rejected, an edge cannot be written without evidence because the database refuses it, and the verdict is computed by code before any model is asked to explain it.

**"What about your own scoreboard — is it real?"**
Every number on it is a `GROUP BY` over recorded task rows. There are about forty of them. That is the honest scale of a ten-day build.

## What would make this fail badly

Not a missing feature. The failure mode that actually loses a hackathon is a demo that *looks* finished and is caught overclaiming — a measured number that turns out to be hardcoded, a "reproduction" that never ran, a learning curve that was drawn by hand. Every decision in these docs trades breadth for not being caught in that position.
