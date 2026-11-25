import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Database } from '../db/client'
import { runs } from '../db/schema'
import type {
  ExperimentResult,
  ExperimentSpec,
  RunEnvironment,
  RunStatus,
  Verdict,
  VerdictDetail,
} from '../shared/types'
import { evaluateExperiment } from './evaluate-verdict'
import {
  callModel as productionCallModel,
  type CallModel,
  type CallModelContext,
} from './model'
import { extractEntrypointFile, validateExperimentSpec } from './planner'
import {
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
}

export function createDrizzleRepairRunStore(
  db: Pick<Database, 'insert' | 'update'>,
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
  }
}

function maskQuotedLiterals(line: string): string {
  return line
    .replace(/"([^"\\]|\\.)*"/g, '"__STR__"')
    .replace(/'([^'\\]|\\.)*'/g, "'__STR__'")
}

function isCleanImportStatement(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return true
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
 * - Metric keys (e.g. rank_impurity_noise_20)
 * - Changes to indentation/control flow
 * - General string substitutions or assignments
 */
function isAllowedColumnOrPathChange(origLine: string, nextLine: string): boolean {
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

  // Must only differ in allowed positions (dataset file path or dictionary/dataframe column access)
  const isPathAccess =
    /(?:Path|open|read_csv|read_table|read_parquet|urllib|urlretrieve)\s*\([^)]*["']([^"']+)["'][^)]*\)/
  const isColAccess =
    /(?:\[\s*["']([^"']+)["']\s*\]|\.drop\(.*columns=\s*\[?["']([^"']+)["'])/

  const origIsPath = isPathAccess.test(origTrimmed)
  const nextIsPath = isPathAccess.test(nextTrimmed)
  if (origIsPath && nextIsPath) {
    // Both are path calls; verify code outside quotes is identical
    return maskQuotedLiterals(origTrimmed) === maskQuotedLiterals(nextTrimmed)
  }

  const origIsCol = isColAccess.test(origTrimmed)
  const nextIsCol = isColAccess.test(nextTrimmed)
  if (origIsCol && nextIsCol) {
    // Both are column access expressions; verify structure is identical
    return maskQuotedLiterals(origTrimmed) === maskQuotedLiterals(nextTrimmed)
  }

  return false
}

function isOnlyStringOrImportChange(origLine: string, nextLine: string): boolean {
  if (isCleanImportStatement(origLine) && isCleanImportStatement(nextLine)) {
    return true
  }
  return isAllowedColumnOrPathChange(origLine, nextLine)
}

/**
 * Computes line-level diff hunks using LCS and checks whether every change
 * affects only imports, column names, or paths (string literals).
 * Any other change re-opens the human approval gate (docs/03-agent-pipeline.md:124).
 */
export function isAutoApprovableRepair(
  originalScript: string,
  repairedScript: string,
): boolean {
  const origLines = originalScript.replace(/\r\n/g, '\n').split('\n')
  const nextLines = repairedScript.replace(/\r\n/g, '\n').split('\n')

  if (origLines.join('\n') === nextLines.join('\n')) {
    return false
  }

  const m = origLines.length
  const n = nextLines.length
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
        if (!isOnlyStringOrImportChange(removed[k]!, added[k]!)) {
          return false
        }
      }
    } else {
      for (const line of removed) {
        if (!isCleanImportStatement(line)) return false
      }
      for (const line of added) {
        if (!isCleanImportStatement(line)) return false
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
  const specSummary = {
    claimNodeId: spec.claimNodeId,
    mode: spec.mode,
    entrypoint: spec.entrypoint,
    datasets: spec.datasets.map((d) => ({
      name: d.name,
      path: d.path,
      bytes: d.bytes,
    })),
    parameters: spec.parameters,
    criteria: spec.criteria,
  }

  return [
    'You are repairing a failed Python experiment script.',
    'Return a COMPLETE replacement script (not a diff) that fixes the error while preserving the experiment design.',
    'Constraints:',
    '- No `pip install` or `subprocess` calls.',
    '- Write metrics as JSON to `/output/metrics.json`.',
    '- Read datasets only from their configured paths.',
    '',
    'ExperimentSpec:',
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

export type RepairRetryOptions = {
  runStore: RepairRunStore
  runner: ExperimentRunner
  modelContext: Omit<CallModelContext, 'taskKind'>
  callModelFn?: CallModel
  maxAttempts?: number
  onStdout?: (chunk: string) => void
  onApprovalRequired?: (candidate: {
    attempt: number
    spec: ExperimentSpec
    summary: string
  }) => Promise<boolean>
  now?: () => Date
}

export type RepairRetryResult = {
  repaired: boolean
  status:
    | 'repaired'
    | 'exhausted'
    | 'awaiting_approval'
    | 'validation_failed'
    | 'not_failed'
  attemptsUsed: number
  runs: RepairRunRecord[]
  finalRun: RepairRunRecord
  candidateSpec?: ExperimentSpec
  validationErrors?: string[]
}

/**
 * On a failed run, invokes REPAIR_SCRIPT up to two attempts maximum.
 * Each attempt creates a new `runs` row with `attempt` incremented and `parentRunId` chained.
 */
export async function repairAndRetryRun(
  failedRun: RepairRunRecord,
  options: RepairRetryOptions,
): Promise<RepairRetryResult> {
  if (failedRun.status !== 'failed') {
    return {
      repaired: false,
      status: 'not_failed',
      attemptsUsed: 0,
      runs: [failedRun],
      finalRun: failedRun,
    }
  }

  // The two-attempt ceiling is enforced against the total repair chain (initial run is attempt 1,
  // so repairs are attempts 2 and 3; at attempt >= 3, ceiling is reached).
  const maxAttempts = Math.min(
    Math.max(0, MAX_REPAIR_ATTEMPTS - (failedRun.attempt - 1)),
    options.maxAttempts ?? MAX_REPAIR_ATTEMPTS,
  )

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
  const onStdout = options.onStdout ?? (() => {})

  const chain: RepairRunRecord[] = [failedRun]
  let currentRun = failedRun
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

    const originalScript = currentRun.spec.files[entrypointFile]
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
      currentRun.stderr,
    )

    const modelRes = await call(RepairScriptSchema, prompt, {
      ...options.modelContext,
      taskKind: 'repair_script',
    })

    const repairedScript = modelRes.output.script
    if (!repairedScript || repairedScript.trim().length === 0) {
      return {
        repaired: false,
        status: 'validation_failed',
        attemptsUsed,
        runs: chain,
        finalRun: currentRun,
        validationErrors: ['REPAIR_SCRIPT returned an empty script'],
      }
    }

    const repairedSpec: ExperimentSpec = {
      ...structuredClone(currentRun.spec),
      files: {
        ...structuredClone(currentRun.spec.files),
        [entrypointFile]: repairedScript,
      },
    }

    const validation = validateExperimentSpec(repairedSpec)
    if (!validation.valid) {
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

    const autoApproved = isAutoApprovableRepair(originalScript, repairedScript)
    if (!autoApproved) {
      const approvedByGate = options.onApprovalRequired
        ? await options.onApprovalRequired({
            attempt: currentRun.attempt + 1,
            spec: repairedSpec,
            summary: modelRes.output.summary,
          })
        : false

      if (!approvedByGate) {
        return {
          repaired: false,
          status: 'awaiting_approval',
          attemptsUsed,
          runs: chain,
          finalRun: currentRun,
          candidateSpec: repairedSpec,
        }
      }
    }

    attemptsUsed++
    const startedAt = now()
    const newRun = await options.runStore.createRun({
      experimentId: currentRun.experimentId,
      parentRunId: currentRun.id,
      attempt: currentRun.attempt + 1,
      status: 'running',
      spec: repairedSpec,
      parameters: structuredClone(repairedSpec.parameters),
      environment: initialRepairEnvironment(
        repairedSpec,
        startedAt.toISOString(),
      ),
      startedAt,
    })

    let result: ExperimentResult
    try {
      result = await options.runner.run(repairedSpec, onStdout)
    } catch (err) {
      result = runnerErrorToFailedResult(
        err,
        repairedSpec,
        startedAt.toISOString(),
      )
    }

    const evaluated = evaluateExperiment(repairedSpec, result)
    const runStatus: RunStatus = result.exitCode === 0 ? 'succeeded' : 'failed'

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

    chain.push(updatedRun)
    currentRun = updatedRun

    if (runStatus === 'succeeded') {
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
