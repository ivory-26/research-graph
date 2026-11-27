import { posix } from 'node:path'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Database } from '../db/client'
import type { OpenApprovalGateInput, OpenApprovalGateResult } from '../db/pipeline-types'
import { runs, type ApprovalGateStatus } from '../db/schema'
import type {
  ExperimentResult,
  ExperimentSpec,
  RunEnvironment,
  RunStatus,
  Verdict,
  VerdictDetail,
} from '../shared/types'
import type {
  RunFailedEvent,
  RunStartedEvent,
  RunStdoutEvent,
  RunSucceededEvent,
  VerdictComputedEvent,
} from '../shared/events'
import { evaluateExperiment } from './evaluate-verdict'
import {
  callModel as productionCallModel,
  type CallModel,
  type CallModelContext,
} from './model'
import { extractEntrypointFile, validateExperimentSpec } from './planner'
import {
  MetricsExtractionError,
  PackageVerificationError,
  SandboxTimeoutError,
  runnerErrorToFailedResult,
  type ExperimentRunner,
} from './runner'

export const MAX_REPAIR_ATTEMPTS = 2
export const REPAIR_STDERR_TAIL_CHARS = 4000

export const RepairScriptSchema = z.object({
  script: z.string(),
  summary: z.string(),
})

export type RepairScriptOutput = z.infer<typeof RepairScriptSchema>

export type RepairRunRecord = {
  id: string
  experimentId: string
  parentRunId: string | null
  attempt: number
  status: RunStatus
  spec: ExperimentSpec
  parameters: Record<string, unknown>
  metrics: Record<string, number>
  environment: RunEnvironment
  verdict: Verdict | null
  verdictDetail: VerdictDetail | null
  stdout: string
  stderr: string
  startedAt: Date | null
  finishedAt: Date | null
}

export type NewRepairRunRecord = {
  experimentId: string
  parentRunId: string
  attempt: number
  status: RunStatus
  spec: ExperimentSpec
  parameters: Record<string, unknown>
  environment: RunEnvironment
  startedAt: Date
}

export type RepairRunUpdate = {
  status: RunStatus
  metrics: Record<string, number>
  environment: RunEnvironment
  verdict: Verdict
  verdictDetail: VerdictDetail
  stdout: string
  stderr: string
  finishedAt: Date
}

export interface RepairRunStore {
  createRun(input: NewRepairRunRecord): Promise<RepairRunRecord>
  updateRun(runId: string, patch: RepairRunUpdate): Promise<RepairRunRecord>
  getChildRun?(parentRunId: string): Promise<RepairRunRecord | null>
}

export function createDrizzleRepairRunStore(
  db: Pick<Database, 'insert' | 'update'> & { query?: any },
): RepairRunStore {
  return {
    async createRun(input: NewRepairRunRecord): Promise<RepairRunRecord> {
      const [row] = await db
        .insert(runs)
        .values({
          experimentId: input.experimentId,
          parentRunId: input.parentRunId,
          attempt: input.attempt,
          status: input.status,
          spec: input.spec,
          parameters: input.parameters,
          environment: input.environment,
          startedAt: input.startedAt,
        })
        .returning()

      if (!row) {
        throw new Error('runs insert returned no row')
      }
      return row
    },

    async updateRun(
      runId: string,
      patch: RepairRunUpdate,
    ): Promise<RepairRunRecord> {
      const [row] = await db
        .update(runs)
        .set({
          status: patch.status,
          metrics: patch.metrics,
          environment: patch.environment,
          verdict: patch.verdict,
          verdictDetail: patch.verdictDetail,
          stdout: patch.stdout,
          stderr: patch.stderr,
          finishedAt: patch.finishedAt,
        })
        .where(eq(runs.id, runId))
        .returning()

      if (!row) {
        throw new Error(`runs update for ${runId} returned no row`)
      }
      return row
    },

    async getChildRun(parentRunId: string): Promise<RepairRunRecord | null> {
      if (!('query' in db) || !db.query?.runs?.findFirst) {
        throw new Error(
          'createDrizzleRepairRunStore requires db.query.runs.findFirst to enforce one-child-per-parent idempotency',
        )
      }
      const row = await db.query.runs.findFirst({
        where: (runsTable: any, { eq: eqOp }: any) => eqOp(runsTable.parentRunId, parentRunId),
      })
      return row ? (row as RepairRunRecord) : null
    },
  }
}

function isBlankOrComment(line: string): boolean {
  const trimmed = line.trim()
  return trimmed === '' || trimmed.startsWith('#')
}

function isCleanImportStatement(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return false
  // Reject multiple statements on one line (semicolons) or trailing comments/code that might disguise execution
  if (trimmed.includes(';')) return false
  // Strictly validate single clean import or from ... import ... statements
  // e.g. "import numpy as np", "from sklearn.ensemble import RandomForestClassifier"
  const importRegex = /^import\s+[a-zA-Z0-9_\.]+(\s+as\s+[a-zA-Z0-9_]+)?(,\s*[a-zA-Z0-9_\.]+(\s+as\s+[a-zA-Z0-9_]+)?)*$/
  const fromImportRegex = /^from\s+[a-zA-Z0-9_\.]+\s+import\s+([a-zA-Z0-9_]+(\s+as\s+[a-zA-Z0-9_]+)?(,\s*[a-zA-Z0-9_]+(\s+as\s+[a-zA-Z0-9_]+)?)*|\*)$/
  return importRegex.test(trimmed) || fromImportRegex.test(trimmed)
}

/**
 * Checks if a line difference is an allowed column name indexing or dataset path literal change.
 * Allows:
 * - column access: obj['col'] or obj["col"]
 * - path literals in dataset loading: Path("..."), open("...", ...) or read_csv("...")
 * Disallows:
 * - Metric keys (e.g. rank_impurity_noise_20 or any key in spec.criteria)
 * - Changes to indentation/control flow
 * - General string substitutions or assignments
 */
function maskPathLiterals(line: string): string {
  return line.replace(
    /((?:Path|open|read_csv|read_table|read_parquet|urlretrieve)\s*\(\s*)(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
    '$1__PATH__',
  )
}

/**
 * Masks string literals inside DataFrame column access (`df["col"]`, `.drop(columns="col")`).
 * Non-column dict receivers (`params`, `config`, `meta`, `metrics`, etc.) are excluded so key
 * renames on non-DataFrame dictionaries are routed through the approval gate.
 *
 * Known limitation: regex-based inspection cannot infer Python runtime types, so any bracketed
 * string literal on an unlisted receiver identifier (for example `d["x"]` -> `d["y"]`) is
 * still treated as a DataFrame column rename and auto-approved.
 */
function maskColumnLiterals(line: string): string {
  if (
    /\b(?:params|parameters|config|hyperparams|kwargs|options|args|meta|metadata|settings|env|labels|classes|metrics|scores|results|counts|totals|mapping|lookup|cache|state|context|out|output|summary)\s*\[/.test(
      line,
    )
  ) {
    return line
  }
  return line
    .replace(
      /(\[\s*)(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')(\s*\])/g,
      '$1__COL__$2',
    )
    .replace(
      /(\.drop\([^)]*columns\s*=\s*\[?\s*)(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
      '$1__COL__',
    )
}

function isAllowedColumnOrPathChange(
  origLine: string,
  nextLine: string,
  protectedMetricKeys: readonly string[] = [],
): boolean {
  // Indentation must match exactly
  const origIndent = origLine.match(/^\s*/)?.[0] || ''
  const nextIndent = nextLine.match(/^\s*/)?.[0] || ''
  if (origIndent !== nextIndent) return false

  const origTrimmed = origLine.trim()
  const nextTrimmed = nextLine.trim()

  // Disallow any changes on lines containing metrics.json, metric keys, or criteria
  if (
    /metrics\.json|rank_|impurity|permutation|criteria|verdict/i.test(origTrimmed) ||
    /metrics\.json|rank_|impurity|permutation|criteria|verdict/i.test(nextTrimmed)
  ) {
    return false
  }

  if (protectedMetricKeys.length > 0) {
    const stringLiteralRegex =
      /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g
    for (const line of [origTrimmed, nextTrimmed]) {
      stringLiteralRegex.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = stringLiteralRegex.exec(line)) !== null) {
        const literal = match[1] ?? match[2] ?? ''
        if (protectedMetricKeys.includes(literal)) {
          return false
        }
      }
    }
  }

  // Must only differ in allowed positions (dataset file path argument or bracket/drop column access)
  const maskedOrigPath = maskPathLiterals(origTrimmed)
  const maskedNextPath = maskPathLiterals(nextTrimmed)
  if (
    maskedOrigPath !== origTrimmed &&
    maskedNextPath !== nextTrimmed &&
    maskedOrigPath === maskedNextPath
  ) {
    return true
  }

  const maskedOrigCol = maskColumnLiterals(origTrimmed)
  const maskedNextCol = maskColumnLiterals(nextTrimmed)
  if (
    maskedOrigCol !== origTrimmed &&
    maskedNextCol !== nextTrimmed &&
    maskedOrigCol === maskedNextCol
  ) {
    return true
  }

  return false
}

function isOnlyStringOrImportChange(
  origLine: string,
  nextLine: string,
  protectedMetricKeys: readonly string[] = [],
): boolean {
  if (isBlankOrComment(origLine) && isBlankOrComment(nextLine)) {
    // Only allow identical comments / blank lines; comment modifications require the approval gate
    return origLine.trim() === nextLine.trim()
  }
  if (isCleanImportStatement(origLine) && isCleanImportStatement(nextLine)) {
    const origIndent = origLine.match(/^\s*/)?.[0] || ''
    const nextIndent = nextLine.match(/^\s*/)?.[0] || ''
    return origIndent === nextIndent
  }
  return isAllowedColumnOrPathChange(origLine, nextLine, protectedMetricKeys)
}

/**
 * Computes line-level diff hunks using LCS and checks whether every change
 * affects only imports, column names, or paths (string literals).
 * Any other change re-opens the human approval gate (docs/03-agent-pipeline.md:152).
 */
/** Maximum line count per script evaluated for automated auto-approval diffing. */
export const MAX_AUTO_APPROVE_LCS_LINES = 500
/** Maximum dynamic-programming matrix cells allocated for automated auto-approval diffing. */
export const MAX_AUTO_APPROVE_LCS_CELLS = 250_000

export function isAutoApprovableRepair(
  originalScript: string,
  repairedScript: string,
  protectedMetricKeys: readonly string[] = [],
): boolean {
  const origLines = originalScript.replace(/\r\n/g, '\n').split('\n')
  const nextLines = repairedScript.replace(/\r\n/g, '\n').split('\n')

  if (origLines.join('\n') === nextLines.join('\n')) {
    return false
  }

  const m = origLines.length
  const n = nextLines.length

  // Cap LCS allocation to prevent untrusted model output from allocating
  // excessive memory in the host process (docs/03-agent-pipeline.md:152).
  // Scripts with >500 lines or >250,000 cells fail closed to manual approval.
  if (
    m > MAX_AUTO_APPROVE_LCS_LINES ||
    n > MAX_AUTO_APPROVE_LCS_LINES ||
    m * n > MAX_AUTO_APPROVE_LCS_CELLS
  ) {
    return false
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  )

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (origLines[i] === nextLines[j]) {
        dp[i]![j] = 1 + dp[i + 1]![j + 1]!
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
      }
    }
  }

  let i = 0
  let j = 0
  while (i < m || j < n) {
    if (i < m && j < n && origLines[i] === nextLines[j]) {
      i++
      j++
      continue
    }

    const removed: string[] = []
    const added: string[] = []

    while (
      (i < m || j < n) &&
      !(i < m && j < n && origLines[i] === nextLines[j])
    ) {
      if (i < m && (j >= n || dp[i + 1]![j]! >= dp[i]![j + 1]!)) {
        removed.push(origLines[i]!)
        i++
      } else if (j < n) {
        added.push(nextLines[j]!)
        j++
      }
    }

    if (removed.length === added.length) {
      for (let k = 0; k < removed.length; k++) {
        if (
          !isOnlyStringOrImportChange(
            removed[k]!,
            added[k]!,
            protectedMetricKeys,
          )
        ) {
          return false
        }
      }
    } else {
      for (const line of removed) {
        if (!isCleanImportStatement(line) && !isBlankOrComment(line)) {
          return false
        }
      }
      for (const line of added) {
        if (!isCleanImportStatement(line) && !isBlankOrComment(line)) {
          return false
        }
      }
    }
  }

  return true
}

export function buildRepairPrompt(
  script: string,
  spec: ExperimentSpec,
  stderr: string,
): string {
  const tailStderr = stderr.slice(-REPAIR_STDERR_TAIL_CHARS)
  const entrypointFile = extractEntrypointFile(spec.entrypoint)
  const auxiliaryFiles = Object.fromEntries(
    Object.entries(spec.files).filter(
      ([path]) => posix.normalize(path) !== entrypointFile,
    ),
  )
  const specSummary = {
    claimNodeId: spec.claimNodeId,
    mode: spec.mode,
    language: spec.language,
    image: spec.image,
    entrypoint: spec.entrypoint,
    auxiliaryFiles,
    datasets: spec.datasets,
    parameters: spec.parameters,
    criteria: spec.criteria,
    timeoutSeconds: spec.timeoutSeconds,
    memoryMb: spec.memoryMb,
    cpuCount: spec.cpuCount,
    network: spec.network,
  }

  return [
    'You are repairing a failed Python experiment script.',
    'Return a COMPLETE replacement script (not a diff) that fixes the error while preserving the experiment design.',
    'Constraints:',
    '- No `pip install` or `subprocess` calls.',
    '- Write metrics as JSON to `/output/metrics.json`.',
    '- Read datasets only from their configured paths.',
    '',
    'ExperimentSpec (entrypoint filtered from auxiliaryFiles):',
    JSON.stringify(specSummary, null, 2),
    '',
    'Current script:',
    '```python',
    script,
    '```',
    '',
    `Last ${REPAIR_STDERR_TAIL_CHARS} characters of stderr:`,
    '```',
    tailStderr,
    '```',
  ].join('\n')
}

/**
 * Local copy of `initialEnvironment` from `src/server/pipeline-delivery/production-stages.ts:92-105`
 * (kept local per `docs/07-workstreams.md` file ownership; unify if a shared helper is extracted).
 */
function initialRepairEnvironment(
  spec: ExperimentSpec,
  startedAt: string,
): RunEnvironment {
  return {
    imageDigest: 'unknown',
    python: 'unknown',
    packages: {},
    datasets: [],
    seeds:
      typeof spec.parameters.seed === 'number' ? [spec.parameters.seed] : [],
    startedAt,
  }
}

const NODE_ERRNO_CODES = new Set([
  'EPIPE', 'EBUSY', 'EPERM', 'ELOOP', 'EROFS', 'EXDEV', 'ENXIO',
  'EFBIG', 'ENOSPC', 'ESPIPE', 'EMLINK', 'EFAULT', 'ENODEV',
  'EISDIR', 'ENOTDIR', 'EINVAL', 'EMFILE', 'ENFILE', 'ENOTTY', 'EAGAIN',
  'EEXIST', 'ENOMEM', 'EBADF', 'E2BIG', 'ECHILD', 'EDOM', 'ENODATA',
  'ENOPROTOOPT', 'EPROTONOSUPPORT', 'ESOCKTNOSUPPORT', 'EPFNOSUPPORT',
])

function isDeepEqual(a: any, b: any): boolean {
  if (a === b) return true
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false
    if (!isDeepEqual(a[key], b[key])) return false
  }
  return true
}

function isPersistenceError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  if (err.constructor && /postgres|drizzle|neon/i.test(err.constructor.name)) return true
  if (err instanceof Error) {
    if (
      /agent_tasks|relation ".*"|syntax error at or near|violates.*constraint|duplicate key value|current transaction is aborted|insert or update on table/i.test(
        err.message,
      )
    ) {
      return true
    }
  }
  if ('code' in err && typeof (err as any).code === 'string') {
    const code = (err as any).code
    // 5-character Postgres SQLSTATE codes (e.g. '23505', '42P01'). Every real
    // SQLSTATE contains at least one digit, so requiring one cleanly separates
    // them from all-letter Node errno codes without maintaining an exhaustive list.
    if (/^(?=.*\d)[0-9A-Z]{5}$/.test(code) && !NODE_ERRNO_CODES.has(code)) return true
  }
  return false
}

export type RepairPipelineEvent =
  | Omit<RunStartedEvent, 'seq'>
  | Omit<RunStdoutEvent, 'seq'>
  | Omit<RunSucceededEvent, 'seq'>
  | Omit<RunFailedEvent, 'seq'>
  | Omit<VerdictComputedEvent, 'seq'>

export type RepairRetryOptions = {
  runStore: RepairRunStore
  runner: ExperimentRunner
  modelContext: Omit<CallModelContext, 'taskKind'>
  maxAttempts?: number
  callModelFn?: CallModel
  onStdout?: (chunk: string) => void
  /** Active execution claim id required when `openApprovalGate` is provided. */
  claimId?: string
  /** Durable gate opener matching `openApprovalGate(db, input)` (`src/db/pipeline-approval.ts:55`). */
  openApprovalGate?: (input: OpenApprovalGateInput) => Promise<OpenApprovalGateResult>
  /** Optional lifecycle event sink; `seq` allocation is left to the caller's experiment event log. */
  emitEvent?: (event: RepairPipelineEvent) => Promise<void> | void
  now?: () => Date
}

export type RepairRetryResult = {
  repaired: boolean
  status:
    | 'repaired'
    | 'exhausted'
    | 'awaiting_approval'
    | 'validation_failed'
    | 'model_failed'
    | 'not_failed'
  /** Number of repair attempts spent (including model call failures that consumed an attempt before run creation). */
  attemptsUsed: number
  runs: RepairRunRecord[]
  finalRun: RepairRunRecord
  candidateSpec?: ExperimentSpec
  workspaceId?: string
  claimNodeId?: string
  gateId?: string
  gateSeq?: number
  validationErrors?: string[]
}

/**
 * Local copy of `failedResultFromRunnerError` from
 * `src/server/pipeline-delivery/production-stages.ts:113-136` (same file-ownership boundary).
 * Diverges intentionally on `SandboxTimeoutError`: the repair path records a generic message
 * and keys `runs.status = 'timeout'` per `docs/04-experiment-runtime.md:259`, whereas EXECUTE
 * currently maps sandbox timeouts to `'failed'`.
 */
function sanitizeRunnerError(
  err: unknown,
  spec: ExperimentSpec,
  startedAt: string,
): ExperimentResult {
  if (
    err instanceof SandboxTimeoutError ||
    (err instanceof Error && err.name === 'SandboxTimeoutError')
  ) {
    const timeoutErr = err as SandboxTimeoutError
    console.error('[repairAndRetryRun] sandbox timed out', err)
    return {
      exitCode: 124,
      stdout: timeoutErr.stdout ?? '',
      stderr: 'The experiment sandbox timed out before completing',
      metrics: {},
      artifacts: [],
      durationMs: timeoutErr.durationMs ?? 0,
      environment: timeoutErr.environment ?? initialRepairEnvironment(spec, startedAt),
    }
  }

  const typed =
    err instanceof PackageVerificationError ||
    err instanceof MetricsExtractionError ||
    (err instanceof Error &&
      ['PackageVerificationError', 'MetricsExtractionError'].includes(err.name))

  if (typed) {
    if (
      err instanceof PackageVerificationError ||
      err instanceof MetricsExtractionError
    ) {
      return runnerErrorToFailedResult(err, spec, startedAt)
    }
    const isPkg = (err as Error).name === 'PackageVerificationError'
    return {
      exitCode: 1,
      stdout: (err as any).stdout ?? '',
      stderr: isPkg
        ? 'Runtime environment package verification failed'
        : 'Failed to extract metrics from experiment execution',
      metrics: {},
      artifacts: [],
      durationMs: (err as any).durationMs ?? 0,
      environment: initialRepairEnvironment(spec, startedAt),
    }
  }

  console.error('[repairAndRetryRun] experiment runner failed', err)
  return {
    exitCode: 1,
    stdout: '',
    stderr: 'The experiment runner failed before producing a result',
    metrics: {},
    artifacts: [],
    durationMs: 0,
    environment: initialRepairEnvironment(spec, startedAt),
  }
}

function remainingRepairAttempts(
  currentAttempt: number,
  requestedMax?: number,
): number {
  return Math.min(
    Math.max(0, MAX_REPAIR_ATTEMPTS - (currentAttempt - 1)),
    requestedMax ?? MAX_REPAIR_ATTEMPTS,
  )
}

/**
 * On a failed run, invokes REPAIR_SCRIPT up to two attempts maximum.
 * Each attempt creates a new `runs` row with `attempt` incremented and `parentRunId` chained.
 *
 * Tracking issue #63 (https://github.com/ivory-26/research-graph/issues/63) tracks wiring this
 * into the EXECUTE stage in `src/server/pipeline-delivery/production-stages.ts:307-343`
 * for docs/05-plan.md:74 ("Repair loop and multi-strategy selection | —", owned by ivory-26).
 */
export async function repairAndRetryRun(
  failedRun: RepairRunRecord,
  options: RepairRetryOptions,
): Promise<RepairRetryResult> {
  if (failedRun.status !== 'failed' && failedRun.status !== 'timeout') {
    return {
      repaired: false,
      status: 'not_failed',
      attemptsUsed: 0,
      runs: [failedRun],
      finalRun: failedRun,
    }
  }

  if (options.openApprovalGate && !options.claimId) {
    throw new Error('options.claimId is required when options.openApprovalGate is provided')
  }

  if (options.runStore?.getChildRun) {
    const existingChild = await options.runStore.getChildRun(failedRun.id)
    if (existingChild) {
      const childSucceeded = existingChild.status === 'succeeded'
      return {
        repaired: childSucceeded,
        status: childSucceeded ? 'repaired' : 'exhausted',
        attemptsUsed: existingChild.attempt - failedRun.attempt,
        runs: [failedRun, existingChild],
        finalRun: existingChild,
      }
    }
  }

  // The two-attempt ceiling is enforced against the total repair chain (initial run is attempt 1,
  // so repairs are attempts 2 and 3; at attempt >= 3, ceiling is reached).
  const maxAttempts = remainingRepairAttempts(failedRun.attempt, options.maxAttempts)

  if (maxAttempts <= 0) {
    return {
      repaired: false,
      status: 'exhausted',
      attemptsUsed: 0,
      runs: [failedRun],
      finalRun: failedRun,
    }
  }
  const call = options.callModelFn ?? productionCallModel
  const now = options.now ?? (() => new Date())

  const chain: RepairRunRecord[] = [failedRun]
  let currentRun = failedRun
  // Keep prompt-only failure notes out of `currentRun.stderr` so `finalRun` always
  // reflects an unmodified persisted `runs` row.
  let promptStderr = failedRun.stderr
  let attemptsUsed = 0

  for (let i = 0; i < maxAttempts; i++) {
    const entrypointFile = extractEntrypointFile(currentRun.spec.entrypoint)
    if (!entrypointFile) {
      return {
        repaired: false,
        status: 'validation_failed',
        attemptsUsed,
        runs: chain,
        finalRun: currentRun,
        validationErrors: [`Invalid entrypoint: ${currentRun.spec.entrypoint}`],
      }
    }

    const normalizedEntrypoint = posix.normalize(entrypointFile)
    const entrypointKey =
      Object.keys(currentRun.spec.files).find(
        (key) => posix.normalize(key) === normalizedEntrypoint,
      ) ?? entrypointFile
    const originalScript = currentRun.spec.files[entrypointKey]
    if (typeof originalScript !== 'string') {
      return {
        repaired: false,
        status: 'validation_failed',
        attemptsUsed,
        runs: chain,
        finalRun: currentRun,
        validationErrors: [
          `Entrypoint file "${entrypointFile}" not found in spec.files`,
        ],
      }
    }

    const prompt = buildRepairPrompt(
      originalScript,
      currentRun.spec,
      promptStderr,
    )

    let modelRes: { output: RepairScriptOutput }
    try {
      modelRes = await call(RepairScriptSchema, prompt, {
        ...options.modelContext,
        taskKind: 'repair_script',
        inputRef: {
          experimentId: currentRun.experimentId,
          runId: currentRun.id,
        },
      })
    } catch (err) {
      console.error('[repairAndRetryRun] REPAIR_SCRIPT callModel failed', err)
      // Persistence failures (e.g. database errors recording agent_tasks) must surface immediately
      // rather than issuing repeated physical model calls without an audit trail (docs/03-agent-pipeline.md:154).
      if (isPersistenceError(err)) {
        throw err
      }

      attemptsUsed = i + 1
      const sanitizedMsg = 'REPAIR_SCRIPT model call failed'
      if (i + 1 < maxAttempts) {
        promptStderr = `${promptStderr}\n${sanitizedMsg}`
        continue
      }
      return {
        repaired: false,
        status: 'model_failed',
        attemptsUsed,
        runs: chain,
        finalRun: currentRun,
        validationErrors: [sanitizedMsg],
      }
    }
    attemptsUsed = i + 1

    const repairedScript = modelRes.output.script
    if (!repairedScript || repairedScript.trim().length === 0) {
      if (i + 1 < maxAttempts) {
        promptStderr = `${promptStderr}\nREPAIR_SCRIPT returned an empty script`
        continue
      }
      return {
        repaired: false,
        status: 'validation_failed',
        attemptsUsed,
        runs: chain,
        finalRun: currentRun,
        validationErrors: ['REPAIR_SCRIPT returned an empty script'],
      }
    }

    if (
      repairedScript.replace(/\r\n/g, '\n') ===
      originalScript.replace(/\r\n/g, '\n')
    ) {
      if (i + 1 < maxAttempts) {
        promptStderr = `${promptStderr}\nREPAIR_SCRIPT returned an unchanged script`
        continue
      }
      return {
        repaired: false,
        status: 'validation_failed',
        attemptsUsed,
        runs: chain,
        finalRun: currentRun,
        validationErrors: ['REPAIR_SCRIPT returned an unchanged script'],
      }
    }

    const repairedSpec: ExperimentSpec = {
      ...structuredClone(currentRun.spec),
      files: {
        ...structuredClone(currentRun.spec.files),
        [entrypointKey]: repairedScript,
      },
    }

    const validation = validateExperimentSpec(repairedSpec)
    if (!validation.valid) {
      if (i + 1 < maxAttempts) {
        promptStderr = `${promptStderr}\nValidation failed: ${validation.errors.join('; ')}`
        continue
      }
      return {
        repaired: false,
        status: 'validation_failed',
        attemptsUsed,
        runs: chain,
        finalRun: currentRun,
        candidateSpec: repairedSpec,
        validationErrors: validation.errors,
      }
    }

    const protectedMetricKeys = currentRun.spec.criteria.checks.map(
      (c) => c.metric,
    )
    const autoApproved = isAutoApprovableRepair(
      originalScript,
      repairedScript,
      protectedMetricKeys,
    )
    if (!autoApproved) {
      // Non-allowlisted changes must never execute via an in-memory callback alone;
      // pause at the durable approval gate and resume via `executeApprovedRepairCandidate`.
      // Note: Under production EXECUTE, an experiment begins with approvalState = 'approved'.
      // Re-opening an approval gate on a failed repair run requires the approval state transition
      // or repair gate support tracked in follow-up issue #63 (docs/05-plan.md:74, owned by ivory-26).
      if (!options.openApprovalGate) {
        throw new Error(
          'Non-allowlisted repair requires durable approval gate, but openApprovalGate was not provided',
        )
      }

      const gateRes = await options.openApprovalGate({
        workspaceId: options.modelContext.workspaceId,
        experimentId: currentRun.experimentId,
        claimId: options.claimId!,
        spec: repairedSpec,
      })

      return {
        repaired: false,
        status: 'awaiting_approval',
        attemptsUsed,
        runs: chain,
        finalRun: currentRun,
        candidateSpec: repairedSpec,
        workspaceId: options.modelContext.workspaceId,
        claimNodeId: repairedSpec.claimNodeId,
        gateId: gateRes.gate.id,
        gateSeq: gateRes.gate.gateSeq,
      }
    }

    const updatedRun = await executeChainedRepairRun(
      currentRun,
      repairedSpec,
      {
        runStore: options.runStore,
        runner: options.runner,
        emitEvent: options.emitEvent,
        onStdout: options.onStdout,
        now,
      },
    )

    chain.push(updatedRun)
    currentRun = updatedRun
    promptStderr = updatedRun.stderr

    if (updatedRun.status === 'succeeded') {
      return {
        repaired: true,
        status: 'repaired',
        attemptsUsed,
        runs: chain,
        finalRun: updatedRun,
      }
    }
  }

  return {
    repaired: false,
    status: 'exhausted',
    attemptsUsed,
    runs: chain,
    finalRun: currentRun,
  }
}

export type ExecuteChainedRepairRunOptions = {
  runStore: RepairRunStore
  runner: ExperimentRunner
  emitEvent?: (event: RepairPipelineEvent) => Promise<void> | void
  onStdout?: (chunk: string) => void
  now?: () => Date
}

export type ExecuteApprovedRepairCandidateOptions =
  ExecuteChainedRepairRunOptions & {
    /**
     * The verified durable gate decision. Required (not opt-in) so a non-allowlisted
     * repair can never execute as if approved when the caller omits it. `offeredSpec`
     * is required and must structurally equal `approvedSpec`; a missing gate or
     * `offeredSpec` is treated as a rejection, never a default-approve.
     */
    gate: {
      status: ApprovalGateStatus
      offeredSpec: ExperimentSpec
    }
  }

async function executeChainedRepairRun(
  parentRun: RepairRunRecord,
  spec: ExperimentSpec,
  options: ExecuteChainedRepairRunOptions,
): Promise<RepairRunRecord> {
  const now = options.now ?? (() => new Date())
  const startedAt = now()

  const emit = async (
    event:
      | Omit<RunStartedEvent, 'seq' | 'experimentId' | 'at'>
      | Omit<RunStdoutEvent, 'seq' | 'experimentId' | 'at'>
      | Omit<RunSucceededEvent, 'seq' | 'experimentId' | 'at'>
      | Omit<RunFailedEvent, 'seq' | 'experimentId' | 'at'>
      | Omit<VerdictComputedEvent, 'seq' | 'experimentId' | 'at'>,
  ) => {
    if (!options.emitEvent) return
    try {
      await options.emitEvent({
        ...event,
        experimentId: parentRun.experimentId,
        at: now().toISOString(),
      } as RepairPipelineEvent)
    } catch (err) {
      console.error('[executeChainedRepairRun] emitEvent failed', err)
    }
  }

  if (options.runStore.getChildRun) {
    const existing = await options.runStore.getChildRun(parentRun.id)
    if (existing) {
      throw new Error(
        `Child repair run already exists for parent run "${parentRun.id}" (idempotency guard)`,
      )
    }
  }

  const newRun = await options.runStore.createRun({
    experimentId: parentRun.experimentId,
    parentRunId: parentRun.id,
    attempt: parentRun.attempt + 1,
    status: 'running',
    spec,
    parameters: structuredClone(spec.parameters),
    environment: initialRepairEnvironment(spec, startedAt.toISOString()),
    startedAt,
  })

  await emit({
    type: 'run.started',
    runId: newRun.id,
    attempt: newRun.attempt,
    sandboxId: null,
  })

  const pendingStdoutEmits: Promise<void>[] = []
  let isKilledTimeout = false
  let result: ExperimentResult
  try {
    result = await options.runner.run(spec, (chunk) => {
      options.onStdout?.(chunk)
      if (options.emitEvent) {
        pendingStdoutEmits.push(
          emit({
            type: 'run.stdout',
            runId: newRun.id,
            chunk,
          }).catch((err) => {
            console.error('[executeChainedRepairRun] emitEvent stdout failed', err)
          }),
        )
      }
    })
  } catch (err) {
    if (
      err instanceof SandboxTimeoutError ||
      (err instanceof Error && err.name === 'SandboxTimeoutError')
    ) {
      isKilledTimeout = true
    }
    result = sanitizeRunnerError(err, spec, startedAt.toISOString())
  }

  await Promise.all(pendingStdoutEmits)

  const evaluated = evaluateExperiment(spec, result)
  const runStatus: RunStatus =
    result.exitCode === 0
      ? 'succeeded'
      : isKilledTimeout
        ? 'timeout'
        : 'failed'

  const updatedRun = await options.runStore.updateRun(newRun.id, {
    status: runStatus,
    metrics: result.metrics,
    environment: result.environment,
    verdict: evaluated.verdict,
    verdictDetail: evaluated.detail,
    stdout: result.stdout,
    stderr: result.stderr,
    finishedAt: now(),
  })

  if (runStatus === 'succeeded') {
    await emit({
      type: 'run.succeeded',
      runId: newRun.id,
      result,
    })
  } else {
    // Sandbox timeouts emit run.failed rather than run.timeout (reserved for 240s stream budget exhaustion)
    await emit({
      type: 'run.failed',
      runId: newRun.id,
      error: updatedRun.stderr || `Process exited with code ${result.exitCode}`,
    })
  }

  if (evaluated.verdict && evaluated.detail) {
    await emit({
      type: 'verdict.computed',
      runId: newRun.id,
      verdict: evaluated.verdict,
      detail: evaluated.detail,
    })
  }

  return updatedRun
}

/**
 * Resumes and executes an approved repair candidate spec once human approval
 * has been resolved (docs/03-agent-pipeline.md:112-124).
 * Requires the verified durable gate decision (`options.gate`): the caller passes the
 * recorded `ApprovalGateView`, whose `status` must be `'approved'` and whose `offeredSpec`
 * must structurally equal `approvedSpec`. A missing gate or `offeredSpec` is a rejection,
 * never a default-approve. Enforces the two-attempt repair ceiling against the run chain,
 * re-validates the spec, creates the next chained `runs` row with incremented attempt and
 * `parentRunId`, executes via runner, evaluates verdict by code, emits lifecycle events,
 * and updates the run record.
 */
export async function executeApprovedRepairCandidate(
  parentRun: RepairRunRecord,
  approvedSpec: ExperimentSpec,
  options: ExecuteApprovedRepairCandidateOptions,
): Promise<RepairRunRecord> {
  if (parentRun.status !== 'failed' && parentRun.status !== 'timeout') {
    throw new Error(
      `Cannot execute repair candidate for non-failed parent run "${parentRun.id}" (status: "${parentRun.status}")`,
    )
  }

  if (options.gate.status !== 'approved') {
    throw new Error(
      `Cannot execute repair candidate: gate status is "${options.gate.status}", expected "approved"`,
    )
  }
  if (!isDeepEqual(options.gate.offeredSpec, approvedSpec)) {
    throw new Error(
      'Approved repair spec does not match the gate offeredSpec',
    )
  }

  if (remainingRepairAttempts(parentRun.attempt) <= 0) {
    throw new Error(
      `Repair ceiling reached: cannot execute approved candidate beyond ${MAX_REPAIR_ATTEMPTS} repair attempts (current attempt ${parentRun.attempt})`,
    )
  }

  const validation = validateExperimentSpec(approvedSpec)
  if (!validation.valid) {
    throw new Error(
      `Approved repair candidate failed spec validation: ${validation.errors.join('; ')}`,
    )
  }

  return executeChainedRepairRun(parentRun, approvedSpec, options)
}
