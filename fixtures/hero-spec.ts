import type { ExperimentResult, ExperimentSpec } from '../src/shared/types'

/**
 * Hand-written hero spec test fixture (docs/00-scope.md:29-37 & Issue #23).
 *
 * Paper: Strobl et al., "Bias in random forest variable importance measures",
 * BMC Bioinformatics 8:25 (2007).
 *
 * Claim: Impurity-based (Gini) importance is biased toward high-cardinality features:
 * an uninformative feature with many categories can rank above genuinely informative ones.
 * Permutation importance does not show this bias.
 *
 * Dataset: breast-w (OpenML 52350, 19 KB, 683 clean rows, 9 ordinal cytological attributes).
 * URL: https://www.openml.org/data/download/52350/breast-w.arff
 *
 * Method / Setup:
 * In Strobl 2007 (Simulation 1), informative predictors have low cardinality (binary categories),
 * and uninformative noise features have varying categories (2, 5, 20 levels).
 * In standard random forests, the 20-category noise feature gets 19 potential split points per sample,
 * allowing it to artificially outrank genuinely informative binary features under Gini importance.
 *
 * 1. Loads breast-w.arff pre-fetched from OpenML 52350.
 * 2. Samples n=120 rows (matching Strobl 2007's empirical simulation size).
 * 3. Binarizes cytological features into low-cardinality predictors (<= 5 vs > 5).
 * 4. Appends 3 uninformative noise variables: noise_2 (2 levels), noise_5 (5 levels), noise_20 (20 levels).
 * 5. Fits RandomForestClassifier(n_estimators=100, random_state=seed).
 * 6. Computes Gini impurity feature importances on the fit model.
 * 7. Computes test-set / out-of-bag Permutation importance (n_repeats=10, random_state=seed).
 * 8. Writes metrics as json.dump to /output/metrics.json.
 *
 * Honest measured values (regression fixture):
 * - rank_impurity_noise_20: 4 (noise_20 ranks in top 4 out of 12, outranking genuinely informative cytological features!)
 * - rank_permutation_noise_20: 11 (noise_20 drops to rank 11, near the bottom, with negative importance -0.019!)
 *
 * Criteria:
 * - rank_impurity_noise_20 <= 5 (paper's bias reproduced: noise ranks near the top)
 * - rank_permutation_noise_20 > 5 (permutation importance eliminates the bias)
 */

export const HERO_EXPERIMENT_SPEC_RUN_A: ExperimentSpec = {
  claimNodeId: 'claim-strobl-2007-gini-bias',
  mode: 'adapted',
  language: 'python',
  image: 'researchgraph-python:locked',
  entrypoint: 'python main.py',
  files: {
    'main.py': `import csv
import json
import os
import pathlib
import io
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.model_selection import train_test_split

parameters = json.loads(os.environ["RESEARCHGRAPH_PARAMETERS"])
method = parameters.get("importance_method")
if method not in ("impurity", "permutation"):
    raise ValueError("importance_method must be impurity or permutation")
seed = int(parameters["seed"])

# 1. Output directory - strictly writes to /output
out_dir = pathlib.Path("/output")
out_dir.mkdir(parents=True, exist_ok=True)

# 2. Seed for reproducibility
np.random.seed(seed)

# 3. Load dataset: breast-w pre-fetched and verified from OpenML 52350
data_path = pathlib.Path("data/breast-w.arff")
if not data_path.exists():
    raise FileNotFoundError(f"Required dataset not found at {data_path}")

raw_content = data_path.read_text(encoding="utf-8")
lines = [l.strip() for l in raw_content.splitlines() if l.strip() and not l.startswith("%") and not l.startswith("@")]

df = pd.read_csv(io.StringIO("\\n".join(lines)), header=None, na_values="?")
df = df.dropna()

X_raw = df.iloc[:, :-1].values
y_raw = (df.iloc[:, -1] == "malignant").astype(int).values

# 4. Strobl 2007 adaptation:
# Subsample n=120 (Strobl 2007 simulation study sample size) and binarize
# ordinal cytological predictors into low-cardinality informative categories.
n_samples = 120
sub_idx = np.random.choice(len(X_raw), size=n_samples, replace=False)
X_low_cardinality = (X_raw[sub_idx] > 5).astype(int)
y = y_raw[sub_idx]

# 5. Append three uninformative (noise) categorical variables with 2, 5, and 20 levels
noise_c2 = np.random.choice(2, size=(n_samples, 1))
noise_c5 = np.random.choice(5, size=(n_samples, 1))
noise_c20 = np.random.choice(20, size=(n_samples, 1))

X_augmented = np.hstack([X_low_cardinality, noise_c2, noise_c5, noise_c20])
n_total_features = X_augmented.shape[1]
noise_20_index = n_total_features - 1  # Last column is noise with 20 levels

# 6. Train/test split (70% train, 30% test) for honest permutation evaluation
X_train, X_test, y_train, y_test = train_test_split(X_augmented, y, test_size=0.3, random_state=seed)

# 7. Fit Random Forest
rf = RandomForestClassifier(n_estimators=int(parameters["n_estimators"]), random_state=seed)
rf.fit(X_train, y_train)

# 8. Compute impurity-based feature importances (Gini importance)
impurity_importances = rf.feature_importances_
ranked_impurity = np.argsort(-impurity_importances)
rank_impurity_noise_20 = int(np.where(ranked_impurity == noise_20_index)[0][0] + 1)

# 9. Compute permutation-based feature importances on test set
perm_result = permutation_importance(rf, X_test, y_test, n_repeats=10, random_state=seed)
perm_importances = perm_result.importances_mean
ranked_perm = np.argsort(-perm_importances)
rank_permutation_noise_20 = int(np.where(ranked_perm == noise_20_index)[0][0] + 1)

# 10. Write the selected ranking and the evaluator's metrics.
if method == "impurity":
    ranking, importances, noise_rank = ranked_impurity, impurity_importances, rank_impurity_noise_20
else:
    ranking, importances, noise_rank = ranked_perm, perm_importances, rank_permutation_noise_20

feature_names = [f"feature_{index + 1}" for index in range(X_raw.shape[1])]
feature_names += ["noise_2", "noise_5", "noise_20"]
with open(out_dir / "importance.csv", "w", newline="") as f:
    writer = csv.writer(f, lineterminator="\\n")
    writer.writerow(["method", "feature", "rank", "importance"])
    for rank, index in enumerate(ranking, start=1):
        writer.writerow([method, feature_names[index], rank, float(importances[index])])

metrics = {
    "rank_impurity_noise_20": float(rank_impurity_noise_20),
    "rank_permutation_noise_20": float(rank_permutation_noise_20),
    "rank_noise_20": float(noise_rank),
    "n_features": float(n_total_features),
    "n_samples": float(n_samples),
    "noise_20_gini_importance": float(impurity_importances[noise_20_index]),
    "noise_20_perm_importance": float(perm_importances[noise_20_index]),
}

with open(out_dir / "metrics.json", "w") as f:
    json.dump(metrics, f, indent=2)

print(f"Computed metrics: {metrics}")
`,
  },
  datasets: [
    {
      name: 'breast-w',
      url: 'https://www.openml.org/data/download/52350/breast-w.arff',
      path: 'data/breast-w.arff',
      sha256: 'cb44e7f62f4a962881147264e5f985eacc13256712e7a4b9d1731ced05f3ee9b',
      bytes: 19177,
    },
  ],
  parameters: {
    importance_method: 'impurity',
    n_estimators: 100,
    seed: 42,
    estimatedRuntimeSeconds: 15,
  },
  criteria: {
    mode: 'all',
    checks: [
      {
        metric: 'rank_impurity_noise_20',
        op: 'lte',
        value: 5,
      },
      {
        metric: 'rank_permutation_noise_20',
        op: 'gt',
        value: 5,
      },
    ],
  },
  timeoutSeconds: 60,
  memoryMb: 2048,
  cpuCount: 1,
  network: 'none',
}

/**
 * Regression test fixture containing reference values from a verified one-off local Docker
 * execution of HERO_EXPERIMENT_SPEC_RUN_A against OpenML 52350 breast-w.arff on the pinned
 * container runtime (researchgraph-python:locked built per Dockerfile.template, run
 * with the hardening flags in docs/04:201-207 per ADR 0005).
 *
 * Scoped strictly to unit testing and regression assertions (evaluate.test.ts, runner.test.ts).
 * Not used as seed data or rendered in the UI as pipeline-measured numbers (docs/05-plan.md:91).
 *
 * Metrics, stdout, python version, and environment packages were directly verified against the
 * container runtime before the parameterised script gained `rank_noise_20`; the recorded stdout
 * therefore predates that metric, while the rank values remain the verification targets that
 * `pnpm verify:hero` re-measures against the current script. Duration is an observed wall-clock
 * execution time (1420ms) and startedAt is an ISO run timestamp. Image digest is recorded as
 * 'unknown' because /etc/image-digest is only written when an image is published to the registry;
 * defaultReadEnvironment falls back to 'unknown' in local execution.
 *
 * Can be reproduced via: pnpm run verify:hero (or node scripts/verify-hero-run.mjs) with Docker active.
 */
export const HERO_RECORDED_RUN_RESULT: ExperimentResult = {
  exitCode: 0,
  stdout:
    "Computed metrics: {'rank_impurity_noise_20': 4.0, 'rank_permutation_noise_20': 11.0, 'n_features': 12.0, 'n_samples': 120.0, 'noise_20_gini_importance': 0.08225325237435398, 'noise_20_perm_importance': -0.01944444444444445}",
  stderr: '',
  metrics: {
    rank_impurity_noise_20: 4,
    rank_permutation_noise_20: 11,
    n_features: 12,
    n_samples: 120,
    noise_20_gini_importance: 0.08225325237435398,
    noise_20_perm_importance: -0.01944444444444445,
  },
  artifacts: [],
  durationMs: 1420,
  environment: {
    imageDigest: 'unknown',
    python: 'Python 3.12.16',
    packages: {
      numpy: '2.5.5',
      pandas: '2.3.3',
      'scikit-learn': '1.9.1',
      scipy: '1.17.1',
      matplotlib: '3.10.0',
    },
    datasets: [
      {
        name: 'breast-w',
        sha256: 'cb44e7f62f4a962881147264e5f985eacc13256712e7a4b9d1731ced05f3ee9b',
        bytes: 19177,
      },
    ],
    seeds: [42],
    startedAt: '2026-11-24T11:54:45.000Z',
  },
}

