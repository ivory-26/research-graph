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

The comparison view ships in the UI. The what-if branch that creates Run B (`BRANCH_WHAT_IF`, one changed parameter, `parentRunId` lineage) is built in `src/server/branch.ts`, and EXECUTE adopts the queued run (#62); the comparison view itself still renders the recorded fixture.

## The six beats and what we actually show

| Beat | What the recording shows |
|---|---|
| Collect | Drop the PDF; Firecrawl pulls the project page; the chunk viewer shows page-anchored text |
| Organise | Graph builds itself as claim / method / dataset nodes with typed, evidenced edges |
| Understand | "Ask across sources" retrieves passages from all three papers and cites them |
| Experiment | Approval screen → generated script → sandbox run → result node |
| Learn | What-if child run, comparison, and the strategy table showing which extraction strategy won |
| Share | Notebook export, opened in Colab, plus a workspace JSON export |

### Where the beats stand on 28 November

| Beat | Backend on `main` | UI on `main` |
|---|---|---|
| Collect | PDF reading order, chunking, embeddings and Firecrawl ingestion all work | For a database workspace, the sources page ingests PDFs and web/repo URLs through the workspace-scoped path and the chunk viewer renders the persisted chunks; the demo workspace renders fixture text |
| Organise | Claims and edges are extracted and validated against quotes | Canvas renders the persisted graph for a database workspace and the fixture otherwise |
| Understand | Retrieval API with verified citations works | Ask page answers from fixture chunks |
| Experiment | Planner validation, real E2B runner and deterministic verdict work; SSE delivery mounts | For a database workspace, the experiments page creates the supported plan and the approval modal posts to the live gate; the demo workspace renders the hero fixture |
| Learn | What-if branch execution and queued Run B adoption work (#62); the seed records per-extraction-run task batches; no automated strategy selection yet | Comparison uses the recorded fixture. The dashboard reads live `agent_tasks` for a database workspace, groups rows per extraction run, and shows the unattributed bucket for older tasks. |
| Share | Server-side notebook export is built and persisted in `run_artifacts`, and `GET /api/runs/:runId/artifacts` serves it under workspace membership; there is no server-side workspace JSON artifact | Export modal downloads a live run's persisted notebook and artifacts, exports the live workspace graph JSON from `/api/graph`, and builds the demo notebook client-side from the fixture |

The browser connects to the pipeline and workspace APIs: workspace-scoped ingestion, experiment creation, approval, live graph/experiment/strategy reads, and run artifact downloads. Graph write-back (#7) is landed — `projectRunToGraph` in `src/server/pipeline.ts` is called on every terminal run — and production is live at <https://research-graph-sage.vercel.app> (#9 closed). The seed script (#8) is built. The remaining work for the recording is the recording itself.

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

The browser carries the auth screens (#16), the pipeline SSE and approval client (#20), and guarded `/api/graph`, `/api/workspaces`, `/api/strategies`, `/api/experiments`, `/api/sources` and run-artifact reads. The runner and evaluator satisfy criterion 4 with the hero run's `adapted` mode and arithmetic verdict. Criteria 2 and 3 are met: graph write-back (#7) writes the run/result nodes and the `produced` edge on every terminal run, and production is live at <https://research-graph-sage.vercel.app> (#9 closed). The deployed database is the live E2E workspace built through the product, not a `pnpm seed` replay; a recording that wants the seeded workspace verbatim must run `pnpm seed` against the database it records. The dashboard shows real task counts and per-extraction-run KPIs for a selected database workspace, including failures and an explicit unattributed bucket; the demo workspace still renders fixture rows. Strategy selection remains open.
