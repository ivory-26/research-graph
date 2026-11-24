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
 * Pinned E2B template id or default image.
 */
export const PINNED_E2B_TEMPLATE = 'researchgraph-python:locked'

/**
 * Pinned libraries expected in the locked Python runtime environment (docs/04-experiment-runtime.md:196).
 * Note: PyPI pandas released 2.2.3 -> 2.3.0 -> 3.0.0; the image builder pins 2.3.3 or matching release.
 */
export const PINNED_IMAGE_PACKAGES: Record<string, string> = {
  numpy: '2.5.5',
  pandas: '2.3.3',
  'scikit-learn': '1.9.1',
  scipy: '1.17.1',
  matplotlib: '3.10.0',
}

/**
 * Typed error indicating that /output/metrics.json was missing, unparseable, or invalid.
 * docs/04-experiment-runtime.md:98:
 * "If metrics.json is absent or unparseable, the run is failed regardless of exit code.
 *  A silent success with no metrics is the most dangerous outcome available, so it is treated as a failure."
 */
export class MetricsExtractionError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly stdout: string,
    public readonly stderr: string,
    public readonly durationMs: number = 0,
    public readonly environment?: RunEnvironment,
  ) {
    super(message)
    this.name = 'MetricsExtractionError'
  }
}

/**
 * Typed error indicating a sandbox timeout.
 * docs/04:232: "Timeout -> sandbox kill at timeoutSeconds -> run status timeout -> verdict failed"
 */
export class SandboxTimeoutError extends Error {
  constructor(
    message: string,
    public readonly timeoutSeconds: number,
    public readonly stdout: string = '',
    public readonly stderr: string = '',
    public readonly durationMs: number = 0,
    public readonly environment?: RunEnvironment,
  ) {
    super(message)
    this.name = 'SandboxTimeoutError'
  }
}

/**
 * Maps a thrown runner error into a failed ExperimentResult so pipelines can
 * reliably persist the failed run with exit code, stdout/stderr, and environment.
 */
export function runnerErrorToFailedResult(
  err: unknown,
  fallbackSpec: ExperimentSpec,
  startedAt: string = new Date().toISOString(),
): ExperimentResult {
  if (err instanceof MetricsExtractionError) {
    return {
      exitCode: err.exitCode || 1,
      stdout: err.stdout,
      stderr: err.stderr ? `${err.stderr}\n${err.message}` : err.message,
      metrics: {},
      artifacts: [],
      durationMs: err.durationMs,
      environment:
        err.environment ?? {
          imageDigest: fallbackSpec.image,
          python: 'unknown',
          packages: {},
          datasets: [],
          seeds: typeof fallbackSpec.parameters.seed === 'number' ? [fallbackSpec.parameters.seed] : [],
          startedAt,
        },
    }
  }

  if (err instanceof SandboxTimeoutError) {
    return {
      exitCode: 124, // Standard timeout exit code
      stdout: err.stdout,
      stderr: err.stderr ? `${err.stderr}\n${err.message}` : err.message,
      metrics: {},
      artifacts: [],
      durationMs: err.durationMs,
      environment:
        err.environment ?? {
          imageDigest: fallbackSpec.image,
          python: 'unknown',
          packages: {},
          datasets: [],
          seeds: typeof fallbackSpec.parameters.seed === 'number' ? [fallbackSpec.parameters.seed] : [],
          startedAt,
        },
    }
  }

  const message = err instanceof Error ? err.message : String(err)
  return {
    exitCode: 1,
    stdout: '',
    stderr: `Runner failed: ${message}`,
    metrics: {},
    artifacts: [],
    durationMs: 0,
    environment: {
      imageDigest: fallbackSpec.image,
      python: 'unknown',
      packages: {},
      datasets: [],
      seeds: typeof fallbackSpec.parameters.seed === 'number' ? [fallbackSpec.parameters.seed] : [],
      startedAt,
    },
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
export const ALLOWED_DATASET_DOMAINS = [
  'openml.org',
  'www.openml.org',
  'archive.ics.uci.edu',
  'github.com',
  'raw.githubusercontent.com',
  'gist.githubusercontent.com',
  'huggingface.co',
]

/**
 * Validates a dataset URL to prevent SSRF against loopback, private ranges, link-local,
 * and untrusted domains.
 */
export function validateDatasetUrl(urlStr: string): URL {
  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    throw new Error(`Invalid dataset URL: ${urlStr}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Dataset URL protocol must be http or https, got '${parsed.protocol}'`)
  }

  const hostname = parsed.hostname.toLowerCase()

  // Block localhost and internal names
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error(`Dataset URL host '${hostname}' is disallowed (SSRF protection)`)
  }

  // Block IPv4 private/loopback/link-local ranges
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4Match) {
    const [_, a, b, c, d] = ipv4Match.map(Number) as [number, number, number, number, number]
    if (
      a === 0 || // 0.0.0.0/8
      a === 127 || // 127.0.0.0/8 (loopback)
      a === 10 || // 10.0.0.0/8 (private)
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 (private)
      (a === 192 && b === 168) || // 192.168.0.0/16 (private)
      (a === 169 && b === 254) // 169.254.0.0/16 (link-local / cloud metadata)
    ) {
      throw new Error(
        `Dataset URL IP '${hostname}' is a forbidden private/link-local/loopback address (SSRF protection)`,
      )
    }
  }

  // Block IPv6 loopback / unique local / link-local
  if (
    hostname === '::1' ||
    hostname.startsWith('fe80:') ||
    hostname.startsWith('fc00:') ||
    hostname.startsWith('fd00:') ||
    hostname.startsWith('[::1]')
  ) {
    throw new Error(`Dataset URL IPv6 '${hostname}' is forbidden (SSRF protection)`)
  }

  // Allowlist check: Must be in trusted domains
  const isAllowedHost = ALLOWED_DATASET_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  )
  if (!isAllowedHost) {
    throw new Error(
      `Dataset host '${hostname}' is not in the allowed dataset domains list (openml.org, uci.edu, github.com, huggingface.co)`,
    )
  }

  return parsed
}

/**
 * Sanitizes destination paths inside the sandbox workspace, strictly forbidding
 * directory traversal ('..') and absolute paths.
 */
export function sanitizeSandboxPath(filePath: string): string {
  const normalized = posix.normalize(filePath.replace(/\\/g, '/')).replace(/^\/+/, '')
  if (normalized.startsWith('../') || normalized === '..' || posix.isAbsolute(filePath)) {
    throw new Error(
      `Invalid sandbox path '${filePath}': path traversal and absolute paths outside workspace are forbidden`,
    )
  }
  return normalized
}

/**
 * App-side dataset fetcher as specified in docs/04-experiment-runtime.md.
 * Fetches dataset bytes outside the sandbox, hashes with sha256, and verifies
 * against ref.sha256 if previously pinned. Includes SSRF protection, redirect
 * capping, and body streaming with memory limit cap.
 */
export async function fetchDataset(
  ref: DatasetRef,
  fetchFn: typeof fetch = fetch,
  maxRedirects: number = 3,
): Promise<FetchedDataset> {
  let currentUrl = ref.url
  let redirectsLeft = maxRedirects
  let res: Response | null = null

  while (redirectsLeft >= 0) {
    validateDatasetUrl(currentUrl)

    // Manual redirect handling for security & redirect capping
    res = await fetchFn(currentUrl, { redirect: 'manual' })

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location')
      if (!location) {
        throw new Error(`Redirect status ${res.status} with missing Location header`)
      }
      currentUrl = new URL(location, currentUrl).href
      redirectsLeft--
      if (redirectsLeft < 0) {
        throw new Error('Too many redirects while fetching dataset')
      }
      continue
    }

    break
  }

  if (!res || !res.ok) {
    throw new Error(`dataset fetch failed: ${res?.status ?? 'unknown'}`)
  }

  // Pre-check Content-Length header before buffering
  const contentLengthHeader = res.headers.get('content-length')
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10)
    if (contentLength > MAX_DATASET_BYTES) {
      throw new Error('dataset too large')
    }
  }

  // Stream with strict size cap
  const chunks: Buffer[] = []
  let totalBytes = 0

  if (res.body && typeof (res.body as any).getReader === 'function') {
    const reader = (res.body as any).getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          const chunkBuf = Buffer.from(value)
          totalBytes += chunkBuf.byteLength
          if (totalBytes > MAX_DATASET_BYTES) {
            await reader.cancel().catch(() => {})
            throw new Error('dataset too large')
          }
          chunks.push(chunkBuf)
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'dataset too large') {
        throw err
      }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.byteLength > MAX_DATASET_BYTES) {
        throw new Error('dataset too large')
      }
      chunks.length = 0
      chunks.push(buf)
    }
  } else {
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_DATASET_BYTES) {
      throw new Error('dataset too large')
    }
    chunks.push(buf)
  }

  const bytes = Buffer.concat(chunks)
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
  startedAt: string,
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
        // Read with { format: 'bytes' } so binary files (plots, numpy arrays) are not corrupted by UTF-8 decoding
        const rawBytes = await sandbox.files.read(fullPath, { format: 'bytes' })
        const buffer = Buffer.from(rawBytes)
        const sha256 = createHash('sha256').update(buffer).digest('hex')
        artifacts.push({
          path: fullPath,
          sha256,
          bytes: buffer.byteLength,
          content: buffer.toString('base64'),
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
 * Validates discovered packages against required versions.
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
  startedAt: string,
): Promise<RunEnvironment> {
  let python = 'unknown'
  let imageDigest = 'sha256:unknown'
  const packages: Record<string, string> = {}

  try {
    const pyVer = await sandbox.commands.run('python --version')
    python = pyVer.stdout.trim() || pyVer.stderr.trim()
  } catch {
    python = 'unknown'
  }

  // Read actual container digest
  try {
    const digestProc = await sandbox.commands.run(
      'cat /etc/image-digest 2>/dev/null || cat /etc/docker-image-digest 2>/dev/null || echo ""',
    )
    const found = digestProc.stdout.trim()
    if (found) {
      imageDigest = found
    } else if (spec.image.startsWith('sha256:')) {
      imageDigest = spec.image
    } else {
      imageDigest = `sha256:${createHash('sha256').update(spec.image).digest('hex').slice(0, 16)}`
    }
  } catch {
    imageDigest = `sha256:${createHash('sha256').update(spec.image).digest('hex').slice(0, 16)}`
  }

  // Explicitly capture pip list and do not swallow failures silently
  try {
    const pipList = await sandbox.commands.run('pip list --format=json')
    const parsed = JSON.parse(pipList.stdout) as Array<{ name: string; version: string }>
    for (const item of parsed) {
      packages[item.name.toLowerCase()] = item.version
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    packages['__pip_error__'] = msg
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
    startedAt, // Accurately reflects run start timestamp
  }
}

export interface E2BRunnerOptions {
  sandboxFactory?: (
    template: string,
    opts: {
      timeoutMs: number
      metadata: Record<string, string>
      allowInternetAccess: boolean
      cpuCount?: number
    },
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
    const startedAt = new Date().toISOString()
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
          cpuCount: opts.cpuCount,
        }))

    const sandbox = await createSandbox(updatedSpec.image, {
      timeoutMs: updatedSpec.timeoutSeconds * 1000,
      metadata: {
        claim: updatedSpec.claimNodeId,
        memoryMb: String(updatedSpec.memoryMb),
        cpuCount: String(updatedSpec.cpuCount),
      },
      allowInternetAccess: false,
      cpuCount: updatedSpec.cpuCount,
    })

    const sandboxId = sandbox.sandboxId
    if (sandboxId) {
      this.activeSandboxes.set(sandboxId, sandbox)
    }

    try {
      // 1. Upload pre-fetched datasets (normalized posix destination path)
      for (const { ref, bytes } of resolvedDatasets) {
        const destPath = sanitizeSandboxPath(ref.path)
        await sandbox.files.write(destPath, bytes)
      }

      // 2. Upload source files (normalized posix destination path)
      for (const [filePath, source] of Object.entries(updatedSpec.files)) {
        const destPath = sanitizeSandboxPath(filePath)
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
          // Check for sandbox timeout
          const errString = String(err).toLowerCase()
          if (errString.includes('timeout') || errString.includes('deadline')) {
            const environment = await envReader(sandbox, updatedSpec, startedAt).catch(() => undefined)
            throw new SandboxTimeoutError(
              `Execution timed out after ${updatedSpec.timeoutSeconds} seconds`,
              updatedSpec.timeoutSeconds,
              '',
              String(err),
              Date.now() - started,
              environment,
            )
          }
          throw err
        }
      }

      const durationMs = Date.now() - started
      const environment = await envReader(sandbox, updatedSpec, startedAt)

      // 4. Read /output/metrics.json (strict contract per docs/04:98)
      const metricsRaw = await sandbox.files.read(SANDBOX_METRICS_PATH).catch(() => null)
      if (metricsRaw === null) {
        throw new MetricsExtractionError(
          `Execution completed (exit code ${proc.exitCode}), but ${SANDBOX_METRICS_PATH} was not created.`,
          proc.exitCode,
          proc.stdout,
          proc.stderr,
          durationMs,
          environment,
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
          durationMs,
          environment,
        )
      }

      const validatedMetrics = validateMetricsPayload(parsedJson)
      if (validatedMetrics === null) {
        throw new MetricsExtractionError(
          `Execution completed (exit code ${proc.exitCode}), but ${SANDBOX_METRICS_PATH} does not contain valid numeric metrics.`,
          proc.exitCode,
          proc.stdout,
          proc.stderr,
          durationMs,
          environment,
        )
      }

      const artifacts = await collector(sandbox)

      // Verify pinned packages by default or when explicitly enabled
      const shouldVerify = this.options.verifyPackages ?? true
      if (shouldVerify) {
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
        durationMs,
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
