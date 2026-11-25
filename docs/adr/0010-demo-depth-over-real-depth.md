# Seven features at demo depth, one feature at real depth

Auth, cross-source retrieval, Firecrawl ingestion, notebook export, the scoring dashboard, failure recovery and agent learning all ship. Only the reproduction loop — ingest, extract, plan, approve, execute, compare, branch — is built to withstand scrutiny.

The submission is a five-minute recording, and the problem statement's rubric walks six stages in order. A missing stage reads as an incomplete answer; a shallow stage does not. But a reproduction loop that breaks on camera destroys the only claim the product actually makes, so depth is concentrated there.

## Consequences

- Several features will be visibly thin under questioning. The plan must include an explicit answer for each ("Firecrawl handles project pages only; arXiv PDFs go through the local parser") rather than hoping nobody asks.
- Nothing in the thin tier may be faked in a way that contradicts the real tier. The dashboard shows real counts from real task rows, even if there are only forty of them.
- Anything that cannot reach demo depth by 27 November is cut, not half-built.

## Update — 25 November 2026

The depth distribution is inverted from the intent so far. The reproduction loop's server side (ingest, extract, plan validation, execute, evaluate) is the deepest work on `main`; the thin tier is thinner than planned: the dashboard, what-if and learning surfaces are fixtures, and failure recovery is unbuilt. The honest position for the recording is that the loop works at the module level and the UI demonstrates the intended experience; do not claim the thin features are live.
