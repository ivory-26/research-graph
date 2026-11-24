import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { Sandbox, CommandExitError } from 'e2b'
import type {
  DatasetRef,
  ExperimentResult,
  ExperimentSpec,
  RunEnvironment,
} from '../shared/types'

export const MAX_DATASET_BYTES = 50 * 1024 * 1024

/**
 * Standard paths inside the sandbox container environment.
 * Uses posix path normalization to ensure valid container paths across all host OS platforms.
 */
export const SANDBOX_OUTPUT_DIR = '/output'
export const SANDBOX_METRICS_FILE = 'metrics.json'
export const SANDBOX_METRICS_PATH = posix.join(SANDBOX_OUTPUT_DIR, SANDBOX_METRICS_FILE)

export interface ExperimentRunner {
  run(
    spec: ExperimentSpec,
    onStdout: (chunk: string) => void,
  ): Promise<ExperimentResult>

  cancel(sandboxId: string): Promise<void>
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
  outputDir?: string,
) => Promise<Array<{ path: string; sha256: string; bytes: number; content?: string }>>

export type EnvironmentReader = (
  sandbox: Sandbox,
  spec: ExperimentSpec,
) => Promise<RunEnvironment>

export async function defaultCollectArtifacts(
  sandbox: Sandbox,
  outputDir: string = SANDBOX_OUTPUT_DIR,
): Promise<Array<{ path: string; sha256: string; bytes: number; content?: string }>> {
  const artifacts: Array<{ path: string; sha256: string; bytes: number; content?: string }> = []
  try {
    const files = await sandbox.files.list(outputDir)
    for (const f of files) {
      if (f.name === SANDBOX_METRICS_FILE) continue
      try {
        const fullPath = posix.join(outputDir, f.name)
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
    // outputDir might not exist if script didn't create it
  }
  return artifacts
}

export async function defaultReadEnvironment(
  sandbox: Sandbox,
  spec: ExperimentSpec,
): Promise<RunEnvironment> {
  let python = 'unknown'
  const packages: Record<string, string> = {}

  try {
    const pyVer = await sandbox.commands.run('python --version')
    python = pyVer.stdout.trim() || pyVer.stderr.trim()
  } catch {
    // Keep unknown
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
    imageDigest: spec.image,
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
  outputDir?: string
  metricsPath?: string
}

export class E2BRunner implements ExperimentRunner {
  private activeSandboxes = new Set<string>()

  constructor(private readonly options: E2BRunnerOptions = {}) {}

  async run(
    spec: ExperimentSpec,
    onStdout: (chunk: string) => void = () => {},
  ): Promise<ExperimentResult> {
    const started = Date.now()
    const fetcher = this.options.datasetFetcher ?? fetchDataset
    const outputDir = this.options.outputDir ?? SANDBOX_OUTPUT_DIR
    const metricsPath = this.options.metricsPath ?? posix.join(outputDir, SANDBOX_METRICS_FILE)
    const collector = this.options.collectArtifacts ?? ((sb) => defaultCollectArtifacts(sb, outputDir))
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
      this.activeSandboxes.add(sandboxId)
    }

    try {
      // 1. Upload pre-fetched datasets (normalizing path with posix)
      for (const { ref, bytes } of resolvedDatasets) {
        const destPath = posix.normalize(ref.path)
        await sandbox.files.write(destPath, bytes)
      }

      // 2. Upload source files (normalizing paths with posix)
      for (const [filePath, source] of Object.entries(updatedSpec.files)) {
        const destPath = posix.normalize(filePath)
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

      // 4. Read metrics file from configured / normalized metricsPath
      const metricsRaw = await sandbox.files.read(metricsPath).catch(() => null)
      let metrics: Record<string, number> = {}
      if (metricsRaw) {
        try {
          metrics = JSON.parse(metricsRaw)
        } catch {
          metrics = {}
        }
      }

      const artifacts = await collector(sandbox, outputDir)
      const environment = await envReader(sandbox, updatedSpec)

      return {
        exitCode: proc.exitCode,
        stdout: proc.stdout,
        stderr: proc.stderr,
        metrics,
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
    this.activeSandboxes.delete(sandboxId)
    await Sandbox.connect(sandboxId).then((s) => s.kill()).catch(() => {})
  }
}
