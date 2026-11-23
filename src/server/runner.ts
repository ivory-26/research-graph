import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { Sandbox, CommandExitError } from 'e2b'
import type {
  DatasetRef,
  ExperimentResult,
  ExperimentSpec,
  RunEnvironment,
} from '../shared/types'

export interface ExperimentRunner {
  run(
    spec: ExperimentSpec,
    onStdout: (chunk: string) => void,
  ): Promise<ExperimentResult>

  cancel(sandboxId: string): Promise<void>
}

export const MAX_DATASET_BYTES = 50 * 1024 * 1024

/**
 * Standard paths inside the sandbox container environment (docs/04-experiment-runtime.md).
 * The sandbox contract strictly specifies `/output/metrics.json`.
 */
export const SANDBOX_OUTPUT_DIR = '/output'
export const SANDBOX_METRICS_PATH = '/output/metrics.json'

/**
 * Pinned libraries expected in the locked Python runtime environment (docs/04-experiment-runtime.md:196).
 */
export const PINNED_IMAGE_PACKAGES: Record<string, string> = {
  numpy: '2.5.5',
  pandas: '2.3.4',
  'scikit-learn': '1.9.1',
}

/**
 * Typed error indicating that /output/metrics.json was missing or unparseable.
 *docs/04-experiment-runtime.md:98:
 * "If metrics.json is absent or unparseable, the run is failed regardless of exit code.
 *  A silent success with no metrics is the most dangerous outcome available, so it is treated as a failure."
 */
export class MetricsExtractionError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(message)
    this.name = 'MetricsExtractionError'
  }
}

export interface FetchedDataset {
  bytes: Buffer
  sha256: string
}

/**
 * App-side dataset fetcher as specified in docs/04-experiment-runtime.md.
 * Fetches dataset bytes outside the sandbox, hashes with sha256, and verifies
 * against ref.sha256 if previously pinned.
 */
export async function fetchDataset(
  ref: DatasetRef,
  fetchFn: typeof fetch = fetch,
): Promise<FetchedDataset> {
  const res = await fetchFn(ref.url, { redirect: 'follow' })
  if (!res.ok) {
    throw new Error(`dataset fetch failed: ${res.status}`)
  }
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.byteLength > MAX_DATASET_BYTES) {
    throw new Error('dataset too large')
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  // First run pins the hash. Every later run must match it.
  if (ref.sha256 && ref.sha256 !== sha256) {
    throw new Error('dataset changed upstream — refusing to run against unpinned bytes')
  }
  return { bytes, sha256 }
}

export type SandboxFileCollector = (
  sandbox: Sandbox,
) => Promise<Array<{ path: string; sha256: string; bytes: number; content?: string }>>

export type EnvironmentReader = (
  sandbox: Sandbox,
  spec: ExperimentSpec,
) => Promise<RunEnvironment>

export async function defaultCollectArtifacts(
  sandbox: Sandbox,
): Promise<Array<{ path: string; sha256: string; bytes: number; content?: string }>> {
  const artifacts: Array<{ path: string; sha256: string; bytes: number; content?: string }> = []
  try {
    const files = await sandbox.files.list(SANDBOX_OUTPUT_DIR)
    for (const f of files) {
      if (f.name === 'metrics.json') continue
      try {
        const fullPath = posix.join(SANDBOX_OUTPUT_DIR, f.name)
        const content = await sandbox.files.read(fullPath)
        const bytes = Buffer.from(content)
        const sha256 = createHash('sha256').update(bytes).digest('hex')
        artifacts.push({
          path: fullPath,
          sha256,
          bytes: bytes.byteLength,
          content,
        })
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // /output might not exist if script didn't create it
  }
  return artifacts
}

/**
 * Validates that an object contains only finite numeric metric values.
 * Returns null if the parsed data is not a plain object or contains non-numeric values.
 */
export function validateMetricsPayload(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const entries: [string, number][] = []
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      return null
    }
    entries.push([key, val])
  }
  return Object.fromEntries(entries)
}

/**
 * Validates discovered packages against required versions and warns/flags missing ones.
 */
export function verifyEnvironmentPackages(
  discovered: Record<string, string>,
  expected: Record<string, string> = PINNED_IMAGE_PACKAGES,
): { valid: boolean; missing: string[]; mismatched: string[] } {
  const missing: string[] = []
  const mismatched: string[] = []
  for (const [name, version] of Object.entries(expected)) {
    const key = name.toLowerCase()
    if (!(key in discovered)) {
      missing.push(name)
    } else if (discovered[key] !== version) {
      mismatched.push(`${name}: expected ${version}, found ${discovered[key]}`)
    }
  }
  return {
    valid: missing.length === 0 && mismatched.length === 0,
    missing,
    mismatched,
  }
}

export async function defaultReadEnvironment(
  sandbox: Sandbox,
  spec: ExperimentSpec,
): Promise<RunEnvironment> {
  let python = 'unknown'
  let imageDigest = spec.image
  const packages: Record<string, string> = {}

  try {
    const pyVer = await sandbox.commands.run('python --version')
    python = pyVer.stdout.trim() || pyVer.stderr.trim()
  } catch {
    // Keep unknown
  }

  // Read image digest from container environment if available
  try {
    const digestProc = await sandbox.commands.run(
      'cat /etc/image-digest 2>/dev/null || cat /etc/docker-image-digest 2>/dev/null || echo ""',
    )
    const found = digestProc.stdout.trim()
    if (found) {
      imageDigest = found
    }
  } catch {
    // Fall back to spec.image
  }

  try {
    const pipList = await sandbox.commands.run('pip list --format=json')
    const parsed = JSON.parse(pipList.stdout) as Array<{ name: string; version: string }>
    for (const item of parsed) {
      packages[item.name.toLowerCase()] = item.version
    }
  } catch {
    // Ignore pip list error
  }

  const datasets = spec.datasets
    .filter((d): d is DatasetRef & { sha256: string; bytes: number } => Boolean(d.sha256 && d.bytes != null))
    .map((d) => ({
      name: d.name,
      sha256: d.sha256,
      bytes: d.bytes,
    }))

  return {
    imageDigest,
    python,
    packages,
    datasets,
    seeds: typeof spec.parameters.seed === 'number' ? [spec.parameters.seed] : [],
    startedAt: new Date().toISOString(),
  }
}

export interface E2BRunnerOptions {
  sandboxFactory?: (
    template: string,
    opts: { timeoutMs: number; metadata: Record<string, string>; allowInternetAccess: boolean },
  ) => Promise<Sandbox>
  datasetFetcher?: (ref: DatasetRef) => Promise<FetchedDataset>
  collectArtifacts?: SandboxFileCollector
  readEnvironment?: EnvironmentReader
  verifyPackages?: boolean
}

export class E2BRunner implements ExperimentRunner {
  private activeSandboxes = new Map<string, Sandbox>()

  constructor(private readonly options: E2BRunnerOptions = {}) {}

  getActiveSandboxes(): ReadonlyMap<string, Sandbox> {
    return this.activeSandboxes
  }

  async run(
    spec: ExperimentSpec,
    onStdout: (chunk: string) => void = () => {},
  ): Promise<ExperimentResult> {
    const started = Date.now()
    const fetcher = this.options.datasetFetcher ?? fetchDataset
    const collector = this.options.collectArtifacts ?? defaultCollectArtifacts
    const envReader = this.options.readEnvironment ?? defaultReadEnvironment

    // Pre-fetch all datasets app-side before launching or interacting with sandbox
    const resolvedDatasets: Array<{ ref: DatasetRef; bytes: Buffer; sha256: string }> = []
    for (const ref of spec.datasets) {
      const fetched = await fetcher(ref)
      resolvedDatasets.push({ ref, bytes: fetched.bytes, sha256: fetched.sha256 })
    }

    const updatedDatasets: DatasetRef[] = resolvedDatasets.map(({ ref, bytes, sha256 }) => ({
      ...ref,
      sha256,
      bytes: bytes.byteLength,
    }))

    const updatedSpec: ExperimentSpec = {
      ...spec,
      datasets: updatedDatasets,
    }

    const createSandbox =
      this.options.sandboxFactory ??
      ((template, opts) =>
        Sandbox.create(template, {
          timeoutMs: opts.timeoutMs,
          metadata: opts.metadata,
          allowInternetAccess: opts.allowInternetAccess,
        }))

    const sandbox = await createSandbox(updatedSpec.image, {
      timeoutMs: updatedSpec.timeoutSeconds * 1000,
      metadata: { claim: updatedSpec.claimNodeId },
      allowInternetAccess: false,
    })

    const sandboxId = sandbox.sandboxId
    if (sandboxId) {
      this.activeSandboxes.set(sandboxId, sandbox)
    }

    try {
      // 1. Upload pre-fetched datasets (normalized posix destination path)
      for (const { ref, bytes } of resolvedDatasets) {
        const destPath = posix.normalize(ref.path.replace(/\\/g, '/'))
        await sandbox.files.write(destPath, bytes)
      }

      // 2. Upload source files (normalized posix destination path)
      for (const [filePath, source] of Object.entries(updatedSpec.files)) {
        const destPath = posix.normalize(filePath.replace(/\\/g, '/'))
        await sandbox.files.write(destPath, source)
      }

      // 3. Run execution
      let proc: { exitCode: number; stdout: string; stderr: string }
      try {
        proc = await sandbox.commands.run(updatedSpec.entrypoint, {
          timeoutMs: updatedSpec.timeoutSeconds * 1000,
          onStdout,
        })
      } catch (err) {
        if (err instanceof CommandExitError) {
          proc = { exitCode: err.exitCode, stdout: err.stdout, stderr: err.stderr }
        } else {
          throw err
        }
      }

      // 4. Read /output/metrics.json (strict contract per docs/04:98)
      const metricsRaw = await sandbox.files.read(SANDBOX_METRICS_PATH).catch(() => null)
      if (metricsRaw === null) {
        throw new MetricsExtractionError(
          `Execution completed (exit code ${proc.exitCode}), but ${SANDBOX_METRICS_PATH} was not created.`,
          proc.exitCode,
          proc.stdout,
          proc.stderr,
        )
      }

      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(metricsRaw)
      } catch {
        throw new MetricsExtractionError(
          `Execution completed (exit code ${proc.exitCode}), but ${SANDBOX_METRICS_PATH} contains unparseable JSON.`,
          proc.exitCode,
          proc.stdout,
          proc.stderr,
        )
      }

      const validatedMetrics = validateMetricsPayload(parsedJson)
      if (validatedMetrics === null) {
        throw new MetricsExtractionError(
          `Execution completed (exit code ${proc.exitCode}), but ${SANDBOX_METRICS_PATH} does not contain valid numeric metrics.`,
          proc.exitCode,
          proc.stdout,
          proc.stderr,
        )
      }

      const artifacts = await collector(sandbox)
      const environment = await envReader(sandbox, updatedSpec)

      // Verify pinned packages if requested
      if (this.options.verifyPackages) {
        const pkgVerification = verifyEnvironmentPackages(environment.packages)
        if (!pkgVerification.valid) {
          const detail = [...pkgVerification.missing, ...pkgVerification.mismatched].join(', ')
          throw new Error(`Sandbox environment failed package verification: ${detail}`)
        }
      }

      return {
        exitCode: proc.exitCode,
        stdout: proc.stdout,
        stderr: proc.stderr,
        metrics: validatedMetrics,
        artifacts,
        durationMs: Date.now() - started,
        environment,
      }
    } finally {
      if (sandboxId) {
        this.activeSandboxes.delete(sandboxId)
      }
      await sandbox.kill().catch(() => {})
    }
  }

  async cancel(sandboxId: string): Promise<void> {
    const existing = this.activeSandboxes.get(sandboxId)
    if (existing) {
      this.activeSandboxes.delete(sandboxId)
      await existing.kill().catch(() => {})
      return
    }
    await Sandbox.connect(sandboxId).then((s) => s.kill()).catch(() => {})
  }
}
