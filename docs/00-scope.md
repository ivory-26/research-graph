# Scope

A workspace that turns a paper's claim into a connected, executable and auditable experiment.

The product's one sentence: **it reads a claim, tests it on your laptop's CPU, and shows you exactly how far the test is from the paper.**

The graph is how that story is presented. It is not the product.

## The demo

Everything below is chosen so the recorded five minutes cannot fail for reasons outside our control.

### Sources

| Role | Work | Why |
|---|---|---|
| Hero | Strobl et al., *Bias in random forest variable importance measures*, BMC Bioinformatics 8:25 (2007) | The claim is qualitative and stays true regardless of our measured numbers |
| Support | Strobl et al., *Conditional variable importance for random forests*, BMC Bioinformatics 9:307 (2008) | The proposed fix; gives retrieval something to retrieve |
| Support | Kursa & Rudnicki, *Feature Selection with the Boruta Package*, JSS 36(11) (2010) | An alternative importance-based method, so the graph has a genuine disagreement in it |

All three are born-digital PDFs about feature importance. Cross-source retrieval has real material instead of three unrelated papers.

### The claim

> Impurity-based (Gini) importance is biased toward high-cardinality features: an uninformative feature with many categories can rank above genuinely informative ones. Permutation importance does not show this bias.

This claim has **no headline number** — it is simulation-based. That is deliberate: it forces the product to handle qualitative claims, which numeric-only designs cannot, and it means our reproduction cannot be "wrong by 0.02".

### The experiment

The executable form is `HERO_EXPERIMENT_SPEC_RUN_A` in [`fixtures/hero-spec.ts`](../fixtures/hero-spec.ts).

1. Load `breast-w` from OpenML 52350 (`breast-w.arff`, 19,177 bytes, 683 rows after dropping the 16 rows with missing values; sha256 `cb44e7f6…ee9b`, verified 2026-11-24).
2. Draw the 120-row subsample Strobl's simulation uses and binarise each ordinal cytological feature at 5, keeping the predictors low-cardinality.
3. Append three uninformative categorical columns with 2, 5 and 20 levels.
4. Fit `RandomForestClassifier(n_estimators=100, random_state=42)` on a 70/30 split. Compute the Gini ranks and the test-set permutation ranks (`n_repeats=10`); the script writes the two noise_20 ranks, the two noise_20 importances, and the sample/feature counts to `/output/metrics.json`.
5. Criterion: `rank_impurity_noise_20 <= 5` **and** `rank_permutation_noise_20 > 5`.

Measured in seconds on one CPU core. The last verified run produced `rank_impurity_noise_20 = 4` and `rank_permutation_noise_20 = 11`, so both checks pass. The run was `adapted`, not `exact`.

### The runs

- **Run A** — `importance_method = impurity`. Noise ranks near the top. Verdict: the paper's bias is reproduced.
- **Run B** — what-if child of Run A, `importance_method = permutation`. Noise drops to the bottom. Verdict: the proposed fix holds, and the delta is attributable to exactly one parameter.

The demo's climax is the comparison view of A and B, not the graph.

The comparison view ships in the UI. The what-if branch that creates Run B (`BRANCH_WHAT_IF`, one changed parameter, `parentRunId` lineage) is built in `src/server/branch.ts`; EXECUTE adoption of the queued run is tracked in #62, so the current comparison is still rendered from the recorded fixture.

## The six beats and what we actually show

| Beat | What the recording shows |
|---|---|
| Collect | Drop the PDF; Firecrawl pulls the project page; the chunk viewer shows page-anchored text |
| Organise | Graph builds itself as claim / method / dataset nodes with typed, evidenced edges |
| Understand | "Ask across sources" retrieves passages from all three papers and cites them |
| Experiment | Approval screen → generated script → sandbox run → result node |
| Learn | What-if child run, comparison, and the strategy table showing which extraction strategy won |
| Share | Notebook export, opened in Colab, plus a workspace JSON export |

### Where the beats stand on 25 November

| Beat | Backend on `main` | UI on `main` |
|---|---|---|
| Collect | PDF reading order, chunking, embeddings and Firecrawl ingestion all work | Chunk viewer renders fixture text; upload is a demo interaction |
| Organise | Claims and edges are extracted and validated against quotes | Canvas renders the fixture graph |
| Understand | Retrieval API with verified citations works | Ask page answers from fixture chunks |
| Experiment | Planner validation, real E2B runner and deterministic verdict work; SSE delivery mounts | Approval and experiment pages render from the hero fixture |
| Learn | No branch execution and no strategy selection yet | Comparison and dashboard render recorded values |
| Share | No server-side notebook or workspace export | Both exports are built client-side from the fixture |

The gap that matters for the recording is the bridge: the browser does not yet call the pipeline endpoint or read the database. Graph write-back (#7), the seed script (#8) and the deploy (#9) are the remaining spine work.

## Not building

- Multi-user collaboration beyond workspace membership. No live cursors, no presence, no comments.
- GPU, deep learning, or any experiment that needs more than 2 GB. The executor is scikit-learn on tabular data.
- Arbitrary research domains. Physics, biology and simulation papers can be ingested and read, but only tabular ML can be *run*. The UI must say so rather than fail quietly.
- Running the authors' repository. See [ADR 0001](./adr/0001-generated-script-over-authors-repo.md).
- A general agent framework. See [ADR 0002](./adr/0002-deterministic-pipeline-over-tool-loop.md).
- Offline operation. The pipeline calls Gemini and E2B at run time.

## Success criteria for 30 November

In priority order. Stop at the first one that fails.

1. The five-minute video exists, is watchable, and shows all six beats.
2. The reproduction loop works end to end on the hero claim, twice in a row, without manual intervention.
3. The deployed link loads, signs in, and shows the recorded workspace with its graph intact.
4. Every run in the demo declares its mode and its verdict, and no number shown as measured was typed by hand.
5. The strategy table shows real task counts.

The browser auth screens (#16), pipeline SSE/approval client (#20), and guarded `/api/graph`, `/api/workspaces`, and `/api/strategies` read routes are implemented, while criteria 2 and 3 still await the seed script (#8), graph write-back (#7), and production deploy (#9). Without an active database workspace UUID, the dashboard renders fixture rows.
