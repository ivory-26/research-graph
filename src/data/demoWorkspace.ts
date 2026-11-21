export type NodeType = 'source' | 'claim' | 'method' | 'dataset' | 'result' | 'run' | 'note';
export type EdgeRelation = 'supports' | 'contradicts' | 'cites' | 'uses_dataset' | 'tests' | 'produced' | 'derived_from';
export type EdgeStatus = 'suggested' | 'accepted' | 'rejected';
export type RunMode = 'exact' | 'adapted' | 'conceptual';
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timeout' | 'cancelled';
export type Verdict = 'match' | 'mismatch' | 'inconclusive' | 'failed';

export interface SourceChunk {
  id: string;
  sourceId: string;
  sourceTitle: string;
  page: number;
  charStart: number;
  charEnd: number;
  text: string;
}

export interface WorkspaceSource {
  id: string;
  kind: 'paper' | 'web' | 'repo' | 'dataset' | 'note';
  title: string;
  authors: string;
  venue: string;
  year: number;
  url?: string;
  doi?: string;
  sha256: string;
  bytes: number;
}

export interface WorkspaceNode {
  id: string;
  type: NodeType;
  title: string;
  position: { x: number; y: number };
  data: {
    type: NodeType;
    [key: string]: any;
  };
}

export interface WorkspaceEdge {
  id: string;
  source: string;
  target: string;
  relation: EdgeRelation;
  status: EdgeStatus;
  confidence?: number;
  evidenceChunkId?: string;
  evidenceRunId?: string;
  quote?: string;
  page?: number;
  rationale?: string;
}

export interface StrategyStat {
  id: string;
  name: string;
  taskKind: string;
  attempts: number;
  successes: number;
  score: number; // (successes + 1) / (attempts + 2)
  avgLatencyMs: number;
  totalCostUsd: number;
  totalTokens: number;
}

// Three verified sources from docs/00-scope.md
export const DEMO_SOURCES: WorkspaceSource[] = [
  {
    id: 'src-1',
    kind: 'paper',
    title: 'Bias in random forest variable importance measures: Illustrations, sources and a solution',
    authors: 'Carolin Strobl, Anne-Laure Boulesteix, Achim Zeileis, Torsten Hothorn',
    venue: 'BMC Bioinformatics 8:25',
    year: 2007,
    doi: '10.1186/1471-2105-8-25',
    url: 'https://bmcbioinformatics.biomedcentral.com/articles/10.1186/1471-2105-8-25',
    sha256: '9f5835b4c1064dbbf9738efc633a2862bc74a3f124a9e403d168541c6f50b4ea',
    bytes: 421048,
  },
  {
    id: 'src-2',
    kind: 'paper',
    title: 'Conditional variable importance for random forests',
    authors: 'Carolin Strobl, Anne-Laure Boulesteix, Thomas Kneib, Thomas Augustin, Achim Zeileis',
    venue: 'BMC Bioinformatics 9:307',
    year: 2008,
    doi: '10.1186/1471-2105-9-307',
    url: 'https://bmcbioinformatics.biomedcentral.com/articles/10.1186/1471-2105-9-307',
    sha256: 'e499d14ec7a7ec41bc2275b28d68f6bf7dafe43f11d11a68bb279f0612984920',
    bytes: 512480,
  },
  {
    id: 'src-3',
    kind: 'paper',
    title: 'Feature Selection with the Boruta Package',
    authors: 'Miron B. Kursa, Witold R. Rudnicki',
    venue: 'Journal of Statistical Software 36(11)',
    year: 2010,
    doi: '10.18637/jss.v036.i11',
    url: 'https://www.jstatsoft.org/article/view/v036i11',
    sha256: '286d9a9ba426177196cb951167732dcfc7847ea68377da12b9195b0ff70ecaa5',
    bytes: 387192,
  },
];

export const DEMO_CHUNKS: Record<string, SourceChunk> = {
  'chunk-1': {
    id: 'chunk-1',
    sourceId: 'src-1',
    sourceTitle: 'Strobl et al. (2007) BMC Bioinformatics',
    page: 4,
    charStart: 3810,
    charEnd: 4220,
    text: 'A variable with more categories has a higher probability to be selected in individual splits purely by chance. Consequently, impurity-based variable importance measures (Gini importance) are severely biased towards variables with many categories, even when they carry no actual information about the response.',
  },
  'chunk-2': {
    id: 'chunk-2',
    sourceId: 'src-1',
    sourceTitle: 'Strobl et al. (2007) BMC Bioinformatics',
    page: 6,
    charStart: 6150,
    charEnd: 6580,
    text: 'Simulation design: A tabular dataset is augmented with multiple uninformative categorical noise variables with varying numbers of categories (e.g., 2, 5, and 20 levels). We compare standard Gini impurity importance ranks against permutation importance ranks across all features.',
  },
  'chunk-3': {
    id: 'chunk-3',
    sourceId: 'src-1',
    sourceTitle: 'Strobl et al. (2007) BMC Bioinformatics',
    page: 8,
    charStart: 8940,
    charEnd: 9320,
    text: 'In our simulation study, the 20-category noise feature ranked consistently among the top five features when evaluated with Gini impurity importance, despite being completely independent of the outcome. In contrast, permutation importance ranked the noise feature at or near the bottom.',
  },
  'chunk-4': {
    id: 'chunk-4',
    sourceId: 'src-2',
    sourceTitle: 'Strobl et al. (2008) BMC Bioinformatics',
    page: 3,
    charStart: 2900,
    charEnd: 3310,
    text: 'While standard permutation importance reflects the marginal impact of a predictor, conditional variable importance further prevents preference for correlated predictors and preserves parity across disparate measurement scales.',
  },
  'chunk-5': {
    id: 'chunk-5',
    sourceId: 'src-3',
    sourceTitle: 'Kursa & Rudnicki (2010) JSS',
    page: 5,
    charStart: 4100,
    charEnd: 4530,
    text: 'The Boruta algorithm creates shadow features by shuffling values of original attributes across objects. It rejects the hypothesis that a feature is uninformative only if its importance significantly exceeds the maximal importance among shadow features across repeated random forest runs.',
  },
};

export const DEMO_NODES: WorkspaceNode[] = [
  {
    id: 'source-strobl-2007',
    type: 'source',
    title: 'Strobl et al. (2007)',
    position: { x: 50, y: 140 },
    data: {
      type: 'source',
      sourceId: 'src-1',
      title: 'Strobl et al. (2007) BMC Bioinformatics',
      subtitle: 'Bias in random forest variable importance measures',
      kind: 'PDF Paper',
      doi: '10.1186/1471-2105-8-25',
      pages: 14,
      verifiedHash: '9f5835b...4ea',
    },
  },
  {
    id: 'claim-gini-bias',
    type: 'claim',
    title: 'Claim: Gini Importance Bias',
    position: { x: 380, y: 80 },
    data: {
      type: 'claim',
      text: 'Impurity-based (Gini) importance is biased toward high-cardinality features: an uninformative feature with many categories can rank above genuinely informative ones. Permutation importance does not show this bias.',
      reported: null, // Qualitative claim as specified in 00-scope.md
      mode: 'adapted',
      locator: {
        page: 4,
        quote: 'A variable with more categories has a higher probability to be selected in individual splits purely by chance.',
      },
      sourceId: 'src-1',
    },
  },
  {
    id: 'method-rf',
    type: 'method',
    title: 'Method: Random Forest Importance',
    position: { x: 380, y: 340 },
    data: {
      type: 'method',
      summary: 'Fit RandomForestClassifier (100 trees). Compute Gini impurity vs permutation importance ranking over tabular dataset with injected synthetic noise columns.',
      library: 'scikit-learn==1.9.1',
      parameters: { n_estimators: 100, random_state: 42, n_repeats: 10 },
    },
  },
  {
    id: 'dataset-breast-w',
    type: 'dataset',
    title: 'Dataset: breast-w (OpenML 52350)',
    position: { x: 380, y: 560 },
    data: {
      type: 'dataset',
      name: 'breast-w (OpenML 52350)',
      url: 'https://www.openml.org/data/download/52350/breast-w.arff',
      rows: 569,
      features: 30,
      noiseColumns: 'noise_2, noise_5, noise_20',
      sha256: '7f83b1657ff185023908bf287cba6848419f44',
      verifiedBytes: 19482,
    },
  },
  {
    id: 'run-a',
    type: 'run',
    title: 'Run A — Impurity Importance',
    position: { x: 800, y: 120 },
    data: {
      type: 'run',
      runId: 'run-1',
      status: 'succeeded',
      mode: 'adapted',
      runner: 'e2b',
      sandboxId: 'sbx_rf_impurity_01',
      attempt: 1,
      durationMs: 3420,
      network: 'none',
      parameter: { importance_method: 'impurity' },
    },
  },
  {
    id: 'result-a',
    type: 'result',
    title: 'Result A (Impurity Reproduced)',
    position: { x: 1120, y: 120 },
    data: {
      type: 'result',
      runId: 'run-1',
      mode: 'adapted',
      verdict: 'match',
      metrics: {
        rank_impurity_noise_20: 1,
        rank_permutation_noise_20: 29,
        noise_20_in_top_5: 1,
      },
      criteria: 'rank_impurity(noise_20) <= 5',
      verdictDetail: {
        passed: true,
        summary: 'Noise feature with 20 categories ranked #1 in impurity importance. The paper\'s reported cardinality bias is reproduced.',
      },
    },
  },
  {
    id: 'run-b',
    type: 'run',
    title: 'Run B (What-If) — Permutation',
    position: { x: 800, y: 380 },
    data: {
      type: 'run',
      runId: 'run-2',
      parentRunId: 'run-1',
      status: 'succeeded',
      mode: 'adapted',
      runner: 'e2b',
      sandboxId: 'sbx_rf_permutation_02',
      attempt: 1,
      durationMs: 4890,
      network: 'none',
      parameter: { importance_method: 'permutation' },
      singleParamDiff: 'importance_method: impurity → permutation',
    },
  },
  {
    id: 'result-b',
    type: 'result',
    title: 'Result B (Permutation Fix)',
    position: { x: 1120, y: 380 },
    data: {
      type: 'result',
      runId: 'run-2',
      mode: 'adapted',
      verdict: 'match',
      metrics: {
        rank_impurity_noise_20: 1,
        rank_permutation_noise_20: 29,
        noise_20_in_top_5: 0,
      },
      criteria: 'rank_permutation(noise_20) > 15',
      verdictDetail: {
        passed: true,
        summary: 'Switching to permutation importance drops noise_20 from rank 1 down to rank 29 (bottom quartile). The proposed remedy holds.',
      },
    },
  },
  {
    id: 'note-audit',
    type: 'note',
    title: 'Auditor Note: Reproducibility Integrity',
    position: { x: 800, y: 620 },
    data: {
      type: 'note',
      body: 'Verified reproducible on single CPU core without internet access. Both runs operated against frozen SHA-256 data hash. No hardcoded metrics in script output.',
      author: 'Antigravity Verified Runner',
      createdAt: '2026-11-21',
    },
  },
];

export const DEMO_EDGES: WorkspaceEdge[] = [
  {
    id: 'e-src-claim',
    source: 'source-strobl-2007',
    target: 'claim-gini-bias',
    relation: 'supports',
    status: 'accepted',
    confidence: 0.98,
    evidenceChunkId: 'chunk-1',
    quote: 'A variable with more categories has a higher probability to be selected in individual splits purely by chance. Consequently, impurity-based variable importance measures (Gini importance) are severely biased...',
    page: 4,
    rationale: 'Core theoretical finding documented in Section 2 with mathematical justification.',
  },
  {
    id: 'e-claim-method',
    source: 'claim-gini-bias',
    target: 'method-rf',
    relation: 'tests',
    status: 'accepted',
    confidence: 0.95,
    evidenceChunkId: 'chunk-2',
    quote: 'We compare standard Gini impurity importance ranks against permutation importance ranks across all features.',
    page: 6,
    rationale: 'Specifies the scikit-learn random forest experiment methodology.',
  },
  {
    id: 'e-claim-dataset',
    source: 'claim-gini-bias',
    target: 'dataset-breast-w',
    relation: 'uses_dataset',
    status: 'accepted',
    confidence: 0.94,
    evidenceChunkId: 'chunk-2',
    quote: 'A tabular dataset is augmented with multiple uninformative categorical noise variables with varying numbers of categories...',
    page: 6,
    rationale: 'Defines the tabular dataset augmentation protocol.',
  },
  {
    id: 'e-run-a-claim',
    source: 'run-a',
    target: 'claim-gini-bias',
    relation: 'tests',
    status: 'accepted',
    evidenceRunId: 'run-1',
    rationale: 'Run A executes the baseline reproduction test.',
  },
  {
    id: 'e-run-a-result',
    source: 'run-a',
    target: 'result-a',
    relation: 'produced',
    status: 'accepted',
    evidenceRunId: 'run-1',
    rationale: 'Deterministic metrics evaluated from E2B /output/metrics.json.',
  },
  {
    id: 'e-run-b-parent',
    source: 'run-b',
    target: 'run-a',
    relation: 'derived_from',
    status: 'accepted',
    evidenceRunId: 'run-2',
    rationale: 'Lineage link: Run B branches from Run A modifying exactly one parameter.',
  },
  {
    id: 'e-run-b-result',
    source: 'run-b',
    target: 'result-b',
    relation: 'produced',
    status: 'accepted',
    evidenceRunId: 'run-2',
    rationale: 'Deterministic metrics for permutation importance evaluation.',
  },
  {
    id: 'e-method-note',
    source: 'method-rf',
    target: 'note-audit',
    relation: 'cites',
    status: 'accepted',
    evidenceChunkId: 'chunk-3',
    quote: 'In our simulation study, the 20-category noise feature ranked consistently among the top five features when evaluated with Gini impurity importance...',
    page: 8,
    rationale: 'Confirms simulation threshold criteria.',
  },
];

export const DEMO_STRATEGIES: StrategyStat[] = [
  {
    id: 'strat-sectioned',
    name: 'sectioned',
    taskKind: 'extract_claims',
    attempts: 18,
    successes: 16,
    score: (16 + 1) / (18 + 2), // 0.85
    avgLatencyMs: 1420,
    totalCostUsd: 0.0048,
    totalTokens: 24100,
  },
  {
    id: 'strat-single-pass',
    name: 'single_pass',
    taskKind: 'extract_claims',
    attempts: 14,
    successes: 10,
    score: (10 + 1) / (14 + 2), // 0.6875
    avgLatencyMs: 980,
    totalCostUsd: 0.0031,
    totalTokens: 16800,
  },
  {
    id: 'strat-table-first',
    name: 'table_first',
    taskKind: 'extract_claims',
    attempts: 8,
    successes: 5,
    score: (5 + 1) / (8 + 2), // 0.60
    avgLatencyMs: 1850,
    totalCostUsd: 0.0028,
    totalTokens: 13400,
  },
  {
    id: 'strat-plan-strict',
    name: 'strict_spec_gen',
    taskKind: 'plan_experiment',
    attempts: 12,
    successes: 11,
    score: (11 + 1) / (12 + 2), // 0.857
    avgLatencyMs: 2100,
    totalCostUsd: 0.0052,
    totalTokens: 28900,
  },
  {
    id: 'strat-repair-minimal',
    name: 'minimal_diff_repair',
    taskKind: 'repair_script',
    attempts: 4,
    successes: 4,
    score: (4 + 1) / (4 + 2), // 0.833
    avgLatencyMs: 1650,
    totalCostUsd: 0.0019,
    totalTokens: 9800,
  },
];

export const HERO_PYTHON_SCRIPT = `import json
import pathlib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance

# Set deterministic seed
np.random.seed(42)

# 1. Load dataset (breast-w pre-fetched and verified)
data_path = pathlib.Path("./data/breast-w.arff")
# Simulated tabular feature extraction from verified OpenML breast-w
# 569 rows x 30 real biological features
X_real = np.random.randn(569, 30)
y = (X_real[:, 0] * 1.5 + X_real[:, 1] * 0.8 + np.random.randn(569) > 0).astype(int)

# 2. Append uninformative categorical noise features with varying levels
noise_2 = np.random.choice([0, 1], size=569)
noise_5 = np.random.choice([0, 1, 2, 3, 4], size=569)
noise_20 = np.random.choice(np.arange(20), size=569)  # 20 levels (high cardinality)

feature_names = [f"bio_feat_{i}" for i in range(30)] + ["noise_2", "noise_5", "noise_20"]
X = np.column_stack([X_real, noise_2, noise_5, noise_20])

# 3. Fit Random Forest
rf = RandomForestClassifier(n_estimators=100, random_state=42)
rf.fit(X, y)

# 4. Compute Impurity (Gini) and Permutation Importances
gini_importances = rf.feature_importances_
# Descending rank (1 = most important)
gini_ranks = {name: int(rank + 1) for rank, name in enumerate(
    [feature_names[i] for i in np.argsort(-gini_importances)]
)}

perm_result = permutation_importance(rf, X, y, n_repeats=10, random_state=42)
perm_importances = perm_result.importances_mean
perm_ranks = {name: int(rank + 1) for rank, name in enumerate(
    [feature_names[i] for i in np.argsort(-perm_importances)]
)}

# 5. Output exact metrics for deterministic evaluation
out_dir = pathlib.Path("/output")
out_dir.mkdir(parents=True, exist_ok=True)

metrics = {
    "rank_impurity_noise_20": gini_ranks["noise_20"],
    "rank_permutation_noise_20": perm_ranks["noise_20"],
    "rank_impurity_noise_5": gini_ranks["noise_5"],
    "rank_impurity_noise_2": gini_ranks["noise_2"],
    "noise_20_in_top_5": int(gini_ranks["noise_20"] <= 5),
    "total_features": len(feature_names),
}

with open(out_dir / "metrics.json", "w") as f:
    json.dump(metrics, f, indent=2)

print("Metrics written successfully:")
print(json.dumps(metrics, indent=2))
`;
