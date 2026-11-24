import type { ExperimentSpec } from '../shared/types'

/**
 * Pure isomorphic POSIX path normalizer.
 * Replaces node:path.posix so that planner logic remains 100% browser-compatible
 * without externalizing or throwing runtime module errors in client builds.
 */
export function normalizePosixPath(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  const segments = normalized.split('/')
  const stack: string[] = []
  for (const seg of segments) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      stack.pop()
    } else {
      stack.push(seg)
    }
  }
  const prefix = normalized.startsWith('/') ? '/' : ''
  const result = prefix + stack.join('/')
  return result || '.'
}

/**
 * Hard rules that an ExperimentSpec must satisfy, as specified in docs/03-agent-pipeline.md:
 * - mode is present and is not 'exact' (current product only produces 'adapted' or 'conceptual').
 * - Exactly one entrypoint, and it must exist in files (e.g. entrypoint "python main.py" -> "main.py" exists in files).
 * - Every dataset has a valid, resolvable URL (http/https).
 * - The script writes its metrics as json.dump to /output/metrics.json.
 * - Estimated runtime (timeoutSeconds) is under or equal to 60 seconds (or timeoutSeconds <= 120 per spec contract).
 * - No `pip install` inside any script file.
 * - Structural: network is 'none', language is 'python'.
 */

export interface SpecValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Extracts the normalized file path from an entrypoint command string like "python main.py" or "python3 script.py"
 */
export function extractEntrypointFile(entrypoint: string): string | null {
  const parts = entrypoint.trim().split(/\s+/)
  if (parts.length >= 2 && (parts[0] === 'python' || parts[0] === 'python3')) {
    const raw = parts[1] ?? null
    return raw ? normalizePosixPath(raw) : null
  }
  if (parts.length === 1 && parts[0]?.endsWith('.py')) {
    return normalizePosixPath(parts[0])
  }
  const fallback = parts[parts.length - 1] ?? null
  return fallback ? normalizePosixPath(fallback) : null
}

export function validateExperimentSpec(spec: unknown): SpecValidationResult {
  const errors: string[] = []

  if (!spec || typeof spec !== 'object') {
    return { valid: false, errors: ['Spec must be a non-null object'] }
  }

  const s = spec as Partial<ExperimentSpec>

  // 1. claimNodeId
  if (!s.claimNodeId || typeof s.claimNodeId !== 'string') {
    errors.push('claimNodeId must be a non-empty string')
  }

  // 2. mode is present and not 'exact'
  if (!s.mode) {
    errors.push('mode must be present')
  } else if (s.mode === 'exact') {
    errors.push("mode cannot be 'exact' (only 'adapted' or 'conceptual' are supported)")
  } else if (s.mode !== 'adapted' && s.mode !== 'conceptual') {
    errors.push(`invalid mode: '${s.mode}'. Must be 'adapted' or 'conceptual'`)
  }

  // 3. language is 'python'
  if (s.language !== 'python') {
    errors.push("language must be 'python'")
  }

  // 4. network is 'none'
  if (s.network !== 'none') {
    errors.push("network must be 'none'")
  }

  // 5. files
  if (!s.files || typeof s.files !== 'object' || Array.isArray(s.files)) {
    errors.push('files must be a Record<string, string>')
  }

  // 6. entrypoint exists in files (normalized via posix)
  if (!s.entrypoint || typeof s.entrypoint !== 'string') {
    errors.push('entrypoint must be a non-empty string')
  } else if (s.files && typeof s.files === 'object') {
    const entryFile = extractEntrypointFile(s.entrypoint)
    const normalizedFiles = new Set(
      Object.keys(s.files).map((f) => normalizePosixPath(f)),
    )
    if (!entryFile || !normalizedFiles.has(entryFile)) {
      errors.push(`entrypoint '${s.entrypoint}' references file '${entryFile}', which does not exist in files`)
    }
  }

  // 7. No pip install in files, and must write to /output/metrics.json
  if (s.files && typeof s.files === 'object') {
    let hasMetricsOutput = false
    for (const [filename, source] of Object.entries(s.files)) {
      if (typeof source !== 'string') {
        errors.push(`file '${filename}' content must be a string`)
        continue
      }
      if (/pip\s+install/i.test(source)) {
        errors.push(`file '${filename}' contains prohibited 'pip install'. Base image already includes required libraries.`)
      }
      if (source.includes('/output/metrics.json') || (source.includes('metrics.json') && source.includes('/output'))) {
        hasMetricsOutput = true
      }
    }

    if (!hasMetricsOutput) {
      errors.push('Script must write metrics as json.dump to /output/metrics.json')
    }
  }

  // 8. datasets
  if (!Array.isArray(s.datasets)) {
    errors.push('datasets must be an array')
  } else {
    for (let i = 0; i < s.datasets.length; i++) {
      const d = s.datasets[i]
      if (!d || typeof d !== 'object') {
        errors.push(`dataset[${i}] must be an object`)
        continue
      }
      if (!d.name || typeof d.name !== 'string') {
        errors.push(`dataset[${i}].name must be a non-empty string`)
      }
      if (!d.path || typeof d.path !== 'string') {
        errors.push(`dataset[${i}].path must be a non-empty string`)
      }
      if (!d.url || typeof d.url !== 'string') {
        errors.push(`dataset[${i}].url must be a resolvable string`)
      } else {
        try {
          const parsed = new URL(d.url)
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            errors.push(`dataset[${i}].url must use http or https protocol`)
          }
        } catch {
          errors.push(`dataset[${i}].url '${d.url}' is not a valid URL`)
        }
      }
    }
  }

  // 9. timeoutSeconds
  if (typeof s.timeoutSeconds !== 'number' || s.timeoutSeconds <= 0) {
    errors.push('timeoutSeconds must be a positive number')
  } else if (s.timeoutSeconds > 120) {
    errors.push('timeoutSeconds cannot exceed 120 seconds')
  }

  // 10. criteria
  if (!s.criteria || typeof s.criteria !== 'object') {
    errors.push('criteria must be an object')
  } else {
    if (s.criteria.mode !== 'all' && s.criteria.mode !== 'any') {
      errors.push("criteria.mode must be 'all' or 'any'")
    }
    if (!Array.isArray(s.criteria.checks) || s.criteria.checks.length === 0) {
      errors.push('criteria.checks must be a non-empty array')
    } else {
      const validOps = new Set(['lt', 'lte', 'gt', 'gte', 'eq', 'neq', 'within'])
      for (let i = 0; i < s.criteria.checks.length; i++) {
        const c = s.criteria.checks[i]
        if (!c || typeof c !== 'object') {
          errors.push(`criteria.checks[${i}] must be an object`)
          continue
        }
        if (!c.metric || typeof c.metric !== 'string') {
          errors.push(`criteria.checks[${i}].metric must be a non-empty string`)
        }
        if (!validOps.has(c.op)) {
          errors.push(`criteria.checks[${i}].op '${c.op}' is invalid`)
        }
        if (typeof c.value !== 'number' || Number.isNaN(c.value)) {
          errors.push(`criteria.checks[${i}].value must be a valid number`)
        }
        if (c.op === 'within' && (typeof c.tolerance !== 'number' || Number.isNaN(c.tolerance))) {
          errors.push(`criteria.checks[${i}] uses 'within' op but has no numeric tolerance`)
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Hand-written hero spec (Strobl et al. 2007 - Run A: Impurity Importance Bias)
 * Source paper: Strobl et al., "Bias in random forest variable importance measures", BMC Bioinformatics 2007.
 * Tests breast-w dataset with added noise variables.
 * Uses dynamic paths resolved via Python pathlib.Path.
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
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier

# 1. Output directory: dynamic resolution from env or standard default
out_dir = pathlib.Path(os.environ.get("OUTPUT_DIR", "/output"))
out_dir.mkdir(parents=True, exist_ok=True)

# 2. Seed for reproducibility
np.random.seed(42)

# 3. Load dataset dynamically: check env, relative path, or synthetic fallback
data_env = os.environ.get("DATA_PATH")
candidates = [pathlib.Path(data_env)] if data_env else []
candidates.extend([
    pathlib.Path("data") / "breast-w.csv",
    pathlib.Path(__file__).parent / "data" / "breast-w.csv",
])

df = None
for p in candidates:
    if p.exists() and p.is_file():
        try:
            df = pd.read_csv(p)
            break
        except Exception:
            pass

if df is not None:
    X = df.iloc[:, :-1].select_dtypes(include=[np.number]).values
    y = df.iloc[:, -1].astype('category').cat.codes.values
else:
    raise FileNotFoundError("Pinned breast-w dataset not found in expected locations.")

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
importances = rf.feature_importances_
# Rank features: rank 1 is highest importance
ranked_indices = np.argsort(-importances)
ranks = {idx: int(rank + 1) for rank, idx in enumerate(ranked_indices)}

rank_impurity_noise_20 = ranks[noise_20_index]

# 7. Write metrics to /output/metrics.json dynamically
metrics = {
    "rank_impurity_noise_20": float(rank_impurity_noise_20),
    "n_features": float(n_total_features),
    "noise_20_importance": float(importances[noise_20_index]),
}

metrics_file = out_dir / "metrics.json"
with open(metrics_file, "w") as f:
    json.dump(metrics, f, indent=2)

print(f"Computed metrics written to {metrics_file}: {metrics}")
`,
  },
  datasets: [
    {
      name: 'breast-w',
      url: 'https://raw.githubusercontent.com/datasets/breast-cancer/master/data/data.csv',
      path: 'data/breast-w.csv',
      sha256: null,
      bytes: 52350,
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
        value: 5,
      },
    ],
  },
  timeoutSeconds: 60,
  memoryMb: 2048,
  cpuCount: 1,
  network: 'none',
}
