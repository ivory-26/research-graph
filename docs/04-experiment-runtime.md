# Experiment runtime

One interface, one adapter, one story.

## What exists on `main`

| Piece | State |
|---|---|
| `ExperimentSpec`, `DatasetRef`, `Criteria`, `ExperimentResult`, `RunEnvironment` | Frozen in `src/shared/types.ts` |
| `ExperimentRunner` interface | `src/server/runner.ts` |
| E2B adapter | Built, with pinned-package verification and dataset pre-fetch |
| Deterministic verdict | Built (`src/server/evaluate-verdict.ts`) |
| `explain_gap` explanation | Built (`src/server/evaluate.ts`, `gemini-4-hydrogen`) |
| Local Docker path | Built as `Dockerfile.template`; verified by `pnpm verify:hero` |
| Server-side notebook generation | Successful pipeline runs store an nbformat 4.5 notebook in `run_artifacts` |
| What-if branch | Built in `src/server/branch.ts`; EXECUTE adopts the queued Run B (#62) |

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
  memoryMb: number;                    // 2048 (template-defined fixed runtime allocation)
  cpuCount: number;                    // 1 (up to template max)
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

No `pip install`. No `subprocess`. No network calls — they would fail anyway. The script may import only libraries present in the image: numpy, pandas, scikit-learn, scipy, matplotlib.

If `metrics.json` is absent or unparseable, the run is `failed` regardless of exit code. A silent success with no metrics is the most dangerous outcome available, so it is treated as a failure.

## Dataset fetch, app-side

```ts
const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_DATASET_DOMAINS = [
  'openml.org', 'www.openml.org', 'archive.ics.uci.edu',
  'github.com', 'raw.githubusercontent.com', 'gist.githubusercontent.com', 'huggingface.co',
];

export async function fetchDataset(ref: DatasetRef) {
  // 1. validate the URL: http(s), host on the allowlist, no loopback,
  //    private-range or link-local address (SSRF protection)
  // 2. follow at most three redirects manually, validating every hop
  // 3. stream the body under a hard 50 MB cap
  // 4. hash the bytes
  // 5. if ref.sha256 is already pinned and differs, throw
}
```

The refusal matters. A dataset URL that starts serving different bytes silently changes what "reproduced" means, and a research tool that does not notice is worse than one that fails.

`DatasetRef.path` is sanitised before anything is written: absolute paths and `..` traversal are rejected, so a model-authored spec cannot write outside the sandbox workspace.

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

      // Strict contract: absent, unparseable or non-numeric metrics fail the run.
      const metricsRaw = await sandbox.files.read('/output/metrics.json').catch(() => null);
      if (metricsRaw === null) throw new MetricsExtractionError('metrics.json missing');
      const metrics = validateMetricsPayload(JSON.parse(metricsRaw));

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

The shipped adapter (`src/server/runner.ts`) adds four things the sketch omits:

- **Datasets are fetched before the sandbox exists.** The whole spec's bytes are resolved and hashed app-side first, so a refused dataset never creates a sandbox.
- **The pinned environment is verified after the run.** `pip list` is compared with `PINNED_IMAGE_PACKAGES`; a missing or mismatched package raises `PackageVerificationError`, which preserves stdout, stderr, metrics and environment rather than discarding them.
- **`cpuCount` is not passed to `Sandbox.create`.** The pinned template bakes 1 vCPU / 2048 MB; passing a count asks E2B to resize and fails on a team without resizable templates. The requested values stay in sandbox metadata for audit.
- **Live sandboxes are tracked and disposed of.** `cancel`/`getActiveSandboxes` let the pipeline's abort or budget signal kill every live sandbox; the runner also kills the sandbox in `finally`, logs a failed kill with the sandbox id, and the pipeline sweeps again when the run settles so a sandbox created during the abort is still disposed. The E2B `timeoutMs` is the final backstop. `runs.sandbox_id` records the sandbox that was used.

`readEnvironment` records the real Python version and `pip list`, and reads `/etc/image-digest` if it exists. The published template does not write that file, so `imageDigest` is `unknown` on E2B today; the template id and build id are the durable identity.

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

This is the "runs on a laptop CPU" claim. `Dockerfile.template` is the built image; `pnpm verify:hero` requires a running Docker daemon, fetches the dataset and checks its pinned sha256, runs the container with the flags above, validates `/output/metrics.json` through `evaluateExperiment`, and compares stdout, Python version and installed packages with `HERO_RECORDED_RUN_RESULT`. That recorded run produced `rank_impurity_noise_20 = 4` and `rank_permutation_noise_20 = 11`. The demo itself used E2B.

## Notebook export

Production saves the notebook after persisting the verdict for every successful run, including a successful repaired run (each repair candidate is its own `runs` row). `ExportModal.tsx` reads the persisted artifact through `GET /api/runs/:runId/artifacts` when a live run id is supplied, and otherwise builds a demonstration notebook from the fixture in explicit demo mode. The persisted artifact records a specific run's frozen spec and environment.

`runArtifacts(kind='notebook')` is an nbformat v4 document built from the frozen spec, not from a model call. Cells:

1. **Markdown** — paper title, DOI, the claim verbatim, the mode, the verdict, and the reported value. This is the reproducibility record.
2. **Code** — `pip install` of the pinned versions from `environment.packages`.
3. **Code** — dataset download and sha256 verification.
4. **Code** — the generated experiment script, verbatim.
5. **Code** — read and display `metrics.json`.
6. **Markdown** — the criteria, and what pass/fail means.

Because the notebook is generated from the same spec the sandbox ran, "open in Colab and it runs" is a claim we can make honestly. Any drift between the notebook and the run would be a bug in one function, not a maintenance problem.

Artifacts are read back through one authorized endpoint:

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/runs/:runId/artifacts` | JSON manifest: run status, attempt, `parentRunId` (set for a repaired run), measured metrics, verdict, and artifact metadata |
| `GET` | `/api/runs/:runId/artifacts?artifact=<id>` | The artifact bytes with a download filename |
| `GET` | `/api/runs/:runId/artifacts?artifact=notebook` | The run's reproducibility notebook |

The route proves the signed-in actor and workspace membership before returning a row; a run id from another workspace is refused. `run_artifacts.content` has no encoding column, so the reader accepts the bytes only when they reproduce the recorded `sha256` and byte count, trying the two encodings the writers use (canonical base64 for runner output, UTF-8 for the notebook). A mismatch is an integrity error, not a different file.

## Failures worth naming

| Failure | Detected by | Run status | Verdict |
|---|---|---|---|
| Script crashes | `exitCode !== 0` | `failed` | `failed` |
| Metrics file missing | `metrics.json` unreadable | `failed` | `failed` |
| Metric present but wrong | criteria evaluation | `succeeded` | `mismatch` |
| Criterion references an absent metric | criteria evaluation | `succeeded` | `inconclusive` |
| Timeout | sandbox kill at `timeoutSeconds` | `timeout` | `failed` |
| Dataset hash changed | `fetchDataset` throws | `failed` (not started) | `failed` |
| Dataset host not allowed, or a private/loopback address | `validateDatasetUrl` | `failed` (not started) | `failed` |
| Dataset larger than 50 MB | size cap while streaming | `failed` (not started) | `failed` |
| Sandbox path is absolute or escapes the workspace | `sanitizeSandboxPath` | `failed` (not started) | `failed` |
| Pinned package missing or wrong version | environment verification after the run | `failed` | `failed` |
| 240 s stream budget expires while a run is active | transport signal | `timeout` | `failed` |

Which of these enter the bounded repair loop is deliberate. A non-zero exit, a
missing or invalid `metrics.json`, and a sandbox timeout are script-caused:
`isRepairableRunnerFailure` routes them to `REPAIR_SCRIPT`, and each executed
candidate is its own `runs` row. A pinned-package mismatch and an untyped
runner/provider failure are not: rewriting the script cannot fix an environment
or an SDK outage, so the pipeline stops instead of burning both attempts.
