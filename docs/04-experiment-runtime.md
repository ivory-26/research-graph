# Experiment runtime

One interface, one adapter, one story.

## The contract

```ts
export type ExperimentSpec = {
  claimNodeId: string;
  mode: 'exact' | 'adapted' | 'conceptual';
  language: 'python';
  image: string;                       // E2B template id
  files: Record<string, string>;       // path → source text
  entrypoint: string;                  // "python main.py"
  datasets: DatasetRef[];
  parameters: Record<string, unknown>;
  criteria: Criteria;
  timeoutSeconds: number;              // ≤ 120
  memoryMb: number;                    // 2048
  cpuCount: number;                    // 1
  network: 'none';                     // structural, not a setting
};

export type DatasetRef = {
  name: string;
  url: string;
  path: string;                        // where it lands inside the sandbox
  sha256: string | null;               // null on first fetch, pinned afterwards
  bytes: number | null;
};

export type Criteria = {
  mode: 'all' | 'any';
  checks: Array<{
    metric: string;
    op: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq' | 'within';
    value: number;
    tolerance?: number;                // used by 'within'
  }>;
};

export type ExperimentResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  metrics: Record<string, number>;
  artifacts: Array<{ path: string; sha256: string; bytes: number; content?: string }>;
  durationMs: number;
  environment: RunEnvironment;
};

export type RunEnvironment = {
  imageDigest: string;
  python: string;
  packages: Record<string, string>;    // name → version, read from the sandbox
  datasets: Array<{ name: string; sha256: string; bytes: number }>;
  seeds: number[];
  startedAt: string;
};

export interface ExperimentRunner {
  run(spec: ExperimentSpec, onStdout: (chunk: string) => void): Promise<ExperimentResult>;
  cancel(sandboxId: string): Promise<void>;
}
```

`network: 'none'` is a literal type, not a boolean. There is no code path that sets it to anything else, so "we forgot to disable networking" is not a bug that can be written.

## What each mode asserts

| Mode | Asserts | Our demo uses it |
|---|---|---|
| `exact` | Same code, data, versions, seed as the paper | Never |
| `adapted` | The paper's method on our own data subset and library versions | Every run |
| `conceptual` | The idea, reimplemented, on a toy setup | Fallback if the hero dataset disappears |

Every run declares one, the UI shows it next to the verdict, and the notebook header repeats it. A `mismatch` verdict on an `adapted` run says nothing about the paper — it says our adaptation did not land where the paper did. The product must never blur that, because blurring it is the exact failure mode the product exists to catch.

## The script contract

Generated code is small and constrained:

```python
# 1. read datasets from ./data/<name>
# 2. do the experiment
# 3. write /output/metrics.json   ← the only thing the evaluator reads
# 4. optionally write figures to /output/
```

```python
import json, pathlib
out = pathlib.Path("/output"); out.mkdir(parents=True, exist_ok=True)
json.dump({"rank_impurity_noise_20": 1, "rank_permutation_noise_20": 29}, open(out / "metrics.json", "w"))
```

No `pip install`. No `subprocess`. No network calls — they would fail anyway. The script may import only libraries present in the image: numpy, pandas, scikit-learn, scipy, matplotlib, imbalanced-learn.

If `metrics.json` is absent or unparseable, the run is `failed` regardless of exit code. A silent success with no metrics is the most dangerous outcome available, so it is treated as a failure.

## Dataset fetch, app-side

```ts
const MAX_BYTES = 50 * 1024 * 1024;

export async function fetchDataset(ref: DatasetRef) {
  const res = await fetch(ref.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`dataset fetch failed: ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new Error('dataset too large');
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  // First run pins the hash. Every later run must match it.
  if (ref.sha256 && ref.sha256 !== sha256) {
    throw new Error('dataset changed upstream — refusing to run against unpinned bytes');
  }
  return { bytes, sha256 };
}
```

The refusal matters. A dataset URL that starts serving different bytes silently changes what "reproduced" means, and a research tool that does not notice is worse than one that fails.

## E2B adapter

```ts
import { Sandbox, CommandExitError } from 'e2b';

export class E2BRunner implements ExperimentRunner {
  async run(spec: ExperimentSpec, onStdout: (c: string) => void): Promise<ExperimentResult> {
    const started = Date.now();
    const sandbox = await Sandbox.create(spec.image, {
      timeoutMs: spec.timeoutSeconds * 1000,
      metadata: { claim: spec.claimNodeId },
      allowInternetAccess: false,
    });

    try {
      // 1. datasets first — the app fetched and hashed them
      for (const ref of spec.datasets) {
        const { bytes, sha256 } = await fetchDataset(ref);
        await sandbox.files.write(ref.path, bytes);
        spec = { ...spec, datasets: spec.datasets.map(d =>
          d.name === ref.name ? { ...d, sha256 } : d) };
      }

      // 2. the code
      for (const [path, source] of Object.entries(spec.files)) {
        await sandbox.files.write(path, source);
      }

      // 3. run
      let proc: { exitCode: number; stdout: string; stderr: string };
      try {
        proc = await sandbox.commands.run(spec.entrypoint, {
          timeoutMs: spec.timeoutSeconds * 1000,
          onStdout,
        });
      } catch (err) {
        if (err instanceof CommandExitError) {
          proc = { exitCode: err.exitCode, stdout: err.stdout, stderr: err.stderr };
        } else {
          throw err;
        }
      }

      const metricsRaw = await sandbox.files.read('/output/metrics.json').catch(() => null);
      const metrics = metricsRaw ? JSON.parse(metricsRaw) : {};

      return {
        exitCode: proc.exitCode,
        stdout: proc.stdout,
        stderr: proc.stderr,
        metrics,
        artifacts: await collectArtifacts(sandbox),
        durationMs: Date.now() - started,
        environment: await readEnvironment(sandbox, spec),
      };
    } finally {
      await sandbox.kill().catch(() => {});
    }
  }

  async cancel(sandboxId: string) {
    await Sandbox.connect(sandboxId).then(s => s.kill());
  }
}
```

Three things this deliberately does not do: mount the host filesystem, pass any secret into the sandbox, or leave the sandbox alive after the run.

## The Docker story

Shipped, documented, never on the demo path:

```dockerfile
FROM python:3.12-slim
RUN pip install --no-cache-dir numpy==2.5.5 pandas==2.3.3 scikit-learn==1.9.1 \
    scipy==1.17.1 matplotlib==3.10.0
WORKDIR /workspace
```

```bash
docker run --rm --network none --cpus=1 --memory=512m --pids-limit=64 \
  --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --user=10001:10001 --tmpfs /tmp:rw,size=64m \
  -v "$PWD/data:/workspace/data:ro" -v "$PWD/out:/output" \
  --entrypoint python researchgraph-python:locked main.py
```

This is the "runs on a laptop CPU" claim, and the README should say plainly that it was verified once, on the author's machine, and that the demo itself used E2B.

## Notebook export

`runArtifacts(kind='notebook')` is an nbformat v4 document built from the frozen spec, not from a model call. Cells:

1. **Markdown** — paper title, DOI, the claim verbatim, the mode, the verdict, and the reported value. This is the reproducibility record.
2. **Code** — `pip install` of the pinned versions from `environment.packages`.
3. **Code** — dataset download and sha256 verification.
4. **Code** — the generated experiment script, verbatim.
5. **Code** — read and display `metrics.json`.
6. **Markdown** — the criteria, and what pass/fail means.

Because the notebook is generated from the same spec the sandbox ran, "open in Colab and it runs" is a claim we can make honestly. Any drift between the notebook and the run would be a bug in one function, not a maintenance problem.

## Failures worth naming

| Failure | Detected by | Run status | Verdict |
|---|---|---|---|
| Script crashes | `exitCode !== 0` | `failed` | `failed` |
| Metrics file missing | `metrics.json` unreadable | `failed` | `failed` |
| Metric present but wrong | criteria evaluation | `succeeded` | `mismatch` |
| Criterion references an absent metric | criteria evaluation | `succeeded` | `inconclusive` |
| Timeout | sandbox kill at `timeoutSeconds` | `timeout` | `failed` |
| Dataset hash changed | `fetchDataset` throws | `failed` (not started) | `failed` |
