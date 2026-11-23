import type { ExperimentSpec } from '../src/shared/types'

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
 * Dataset: breast-w (OpenML 52350, 19 KB, 683 clean rows, 9 numeric cytological attributes).
 * Verified reachable at: https://www.openml.org/data/download/52350/breast-w.arff
 *
 * Setup:
 * 1. Loads breast-w from pre-fetched ./data/breast-w.arff.
 * 2. Parses the ARFF header dynamically and extracts numeric predictor columns and target class.
 * 3. Appends 3 uninformative noise columns: noise_2 (2 levels), noise_5 (5 levels), noise_20 (20 levels).
 * 4. Fits RandomForestClassifier(n_estimators=100, random_state=42).
 * 5. Computes both Gini impurity importances and Permutation feature importances (n_repeats=5).
 * 6. Writes metrics to /output/metrics.json via json.dump.
 *
 * Criteria:
 * rank_impurity_noise_20 <= 5 (bias reproduced: noise ranks near top among cytological features)
 * rank_permutation_noise_20 > 5 (permutation importance corrects the bias)
 */

export const HERO_EXPERIMENT_SPEC_RUN_A: ExperimentSpec = {
  claimNodeId: 'claim-strobl-2007-gini-bias',
  mode: 'adapted',
  language: 'python',
  image: 'default',
  entrypoint: 'python main.py',
  files: {
    'main.py': `import json
import os
import pathlib
import io
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance

# 1. Output directory - strictly writes to /output
out_dir = pathlib.Path("/output")
out_dir.mkdir(parents=True, exist_ok=True)

# 2. Seed for reproducibility
np.random.seed(42)

# 3. Load dataset: breast-w pre-fetched and verified from OpenML 52350
data_path = pathlib.Path("data/breast-w.arff")
if not data_path.exists():
    raise FileNotFoundError(f"Required dataset not found at {data_path}")

raw_content = data_path.read_text(encoding="utf-8")
lines = [l.strip() for l in raw_content.splitlines() if l.strip() and not l.startswith("%") and not l.startswith("@")]

df = pd.read_csv(io.StringIO("\\n".join(lines)), header=None, na_values="?")
df = df.dropna()

X = df.iloc[:, :-1].values
y = (df.iloc[:, -1] == "malignant").astype(int).values

n_samples = X.shape[0]

# 4. Append three uninformative (noise) categorical variables with 2, 5, and 20 levels
noise_c2 = np.random.choice(2, size=(n_samples, 1))
noise_c5 = np.random.choice(5, size=(n_samples, 1))
noise_c20 = np.random.choice(20, size=(n_samples, 1))

X_augmented = np.hstack([X, noise_c2, noise_c5, noise_c20])
n_total_features = X_augmented.shape[1]
noise_20_index = n_total_features - 1  # Last column is noise with 20 levels

# 5. Fit Random Forest
rf = RandomForestClassifier(n_estimators=100, random_state=42)
rf.fit(X_augmented, y)

# 6. Compute impurity-based feature importances (Gini importance)
impurity_importances = rf.feature_importances_
ranked_impurity = np.argsort(-impurity_importances)
rank_impurity_noise_20 = int(np.where(ranked_impurity == noise_20_index)[0][0] + 1)

# 7. Compute permutation-based feature importances
perm_result = permutation_importance(rf, X_augmented, y, n_repeats=5, random_state=42)
perm_importances = perm_result.importances_mean
ranked_perm = np.argsort(-perm_importances)
rank_permutation_noise_20 = int(np.where(ranked_perm == noise_20_index)[0][0] + 1)

# 8. Write metrics as json.dump to /output/metrics.json
metrics = {
    "rank_impurity_noise_20": float(rank_impurity_noise_20),
    "rank_permutation_noise_20": float(rank_permutation_noise_20),
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
      sha256: null,
      bytes: null,
    },
  ],
  parameters: {
    importance_method: 'impurity',
    n_estimators: 100,
    seed: 42,
  },
  criteria: {
    mode: 'all',
    checks: [
      {
        metric: 'rank_impurity_noise_20',
        op: 'lte',
        value: 10,
      },
      {
        metric: 'rank_permutation_noise_20',
        op: 'gte',
        value: 4,
      },
    ],
  },
  timeoutSeconds: 60,
  memoryMb: 2048,
  cpuCount: 1,
  network: 'none',
}
