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

1. Load `breast-w` (OpenML 52350, 19 KB, 569 rows, 30 features, verified reachable 2026-11-20).
2. Append three uninformative categorical columns with 2, 5 and 20 levels.
3. Fit a random forest. Report impurity importance ranks and permutation importance ranks for every column.
4. Criterion: `rank_impurity(noise_20) <= 5` **and** `rank_permutation(noise_20) > 5`.

Measured in seconds on one CPU core.

### The runs

- **Run A** — `importance_method = impurity`. Noise ranks near the top. Verdict: the paper's bias is reproduced.
- **Run B** — what-if child of Run A, `importance_method = permutation`. Noise drops to the bottom. Verdict: the proposed fix holds, and the delta is attributable to exactly one parameter.

The demo's climax is the comparison view of A and B, not the graph.

## The six beats and what we actually show

| Beat | What the recording shows |
|---|---|
| Collect | Drop the PDF; Firecrawl pulls the project page; the chunk viewer shows page-anchored text |
| Organise | Graph builds itself as claim / method / dataset nodes with typed, evidenced edges |
| Understand | "Ask across sources" retrieves passages from all three papers and cites them |
| Experiment | Approval screen → generated script → sandbox run → result node |
| Learn | What-if child run, comparison, and the strategy table showing which extraction strategy won |
| Share | Notebook export, opened in Colab, plus a workspace JSON export |

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
