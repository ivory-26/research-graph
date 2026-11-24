import rawWorkspace from '../../fixtures/workspace.json';

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
  isHero?: boolean;
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
  charStart?: number;
  charEnd?: number;
  chunkNumber?: number;
  sourceTitle?: string;
  targetTitle?: string;
  rationale?: string;
}

export interface StrategyStat {
  id: string;
  name: string;
  taskKind: string;
  preferred?: boolean;
  attempts: number;
  successes: number;
  score: number; // (successes + 1) / (attempts + 2)
  avgLatencyMs: number;
  totalCostUsd: number;
  totalTokens: number;
}

// Single source of truth: all demo workspace data is derived directly from fixtures/workspace.json
export const DEMO_WORKSPACE = rawWorkspace.workspace;
export const DEMO_SOURCES: WorkspaceSource[] = rawWorkspace.sources as unknown as WorkspaceSource[];
export const DEMO_CHUNKS: Record<string, SourceChunk> = rawWorkspace.chunks as unknown as Record<string, SourceChunk>;
export const DEMO_NODES: WorkspaceNode[] = rawWorkspace.nodes as unknown as WorkspaceNode[];
export const DEMO_EDGES: WorkspaceEdge[] = rawWorkspace.edges as unknown as WorkspaceEdge[];
export const DEMO_STRATEGIES: StrategyStat[] = rawWorkspace.strategies as unknown as StrategyStat[];

export const HERO_PYTHON_SCRIPT = `import json
import pathlib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance

# Set deterministic seed
np.random.seed(42)

# 1. Load pinned OpenML breast-w tabular dataset
data_file = pathlib.Path("data/breast-w.csv")
if not data_file.exists():
    data_file = pathlib.Path("./data/breast-w.arff")

if data_file.exists() and data_file.suffix == '.csv':
    df = pd.read_csv(data_file)
    X_real = df.iloc[:, :-1].select_dtypes(include=[np.number]).values
    y = df.iloc[:, -1].astype('category').cat.codes.values
elif data_file.exists() and data_file.suffix == '.arff':
    from scipy.io import arff
    data, meta = arff.loadarff(data_file)
    df = pd.DataFrame(data)
    X_real = df.iloc[:, :-1].select_dtypes(include=[np.number]).values
    y = df.iloc[:, -1].astype('category').cat.codes.values
else:
    raise FileNotFoundError("Pinned breast-w dataset not found at data/breast-w.csv or ./data/breast-w.arff")

n_samples = X_real.shape[0]

# 2. Append three uninformative categorical noise features with varying levels
noise_2 = np.random.choice([0, 1], size=n_samples)
noise_5 = np.random.choice([0, 1, 2, 3, 4], size=n_samples)
noise_20 = np.random.choice(np.arange(20), size=n_samples)  # 20 levels (high cardinality)

feature_names = [f"bio_feat_{i}" for i in range(X_real.shape[1])] + ["noise_2", "noise_5", "noise_20"]
X = np.column_stack([X_real, noise_2, noise_5, noise_20])

# 3. Fit Random Forest
rf = RandomForestClassifier(n_estimators=100, random_state=42)
rf.fit(X, y)

# 4. Compute Impurity (Gini) and Permutation Importances
gini_importances = rf.feature_importances_
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
