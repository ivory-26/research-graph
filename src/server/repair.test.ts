import { describe, expect, it } from 'vitest'
import { HERO_EXPERIMENT_SPEC_RUN_A, HERO_RECORDED_RUN_RESULT } from '../../fixtures/hero-spec'
import type { Database } from '../db/client'
import type { ExperimentResult, ExperimentSpec } from '../shared/types'
import {
  MAX_REPAIR_ATTEMPTS,
  REPAIR_STDERR_TAIL_CHARS,
  createDrizzleRepairRunStore,
  isAutoApprovableRepair,
  repairAndRetryRun,
  executeApprovedRepairCandidate,
  type NewRepairRunRecord,
  type RepairRunRecord,
  type RepairRunStore,
  type RepairRunUpdate,
} from './branch'
import {
  createCallModel,
  type AgentTaskInsert,
  type AgentTaskStore,
  type CallModel,
  type StructuredGenerator,
} from './model'
import {
  createTestDatabase,
  seedWorkspace,
  type TestDatabase,
} from './pipeline-delivery/test-support/pg'
import { SandboxTimeoutError, type ExperimentRunner } from './runner'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip

class MemoryTaskStore implements AgentTaskStore {
  readonly rows: Array<AgentTaskInsert & { id: string }> = []
  async insert(task: AgentTaskInsert) {
    const id = `task-${this.rows.length + 1}`
    this.rows.push({ ...task, id })
    return { id }
  }
}

class MemoryRepairRunStore implements RepairRunStore {
  readonly rows = new Map<string, RepairRunRecord>()
  private seq = 1

  seed(run: RepairRunRecord): void {
    this.rows.set(run.id, structuredClone(run))
  }

  async createRun(input: NewRepairRunRecord): Promise<RepairRunRecord> {
    const id = `run-repair-${this.seq++}`
    const record: RepairRunRecord = {
      id,
      experimentId: input.experimentId,
      parentRunId: input.parentRunId,
      attempt: input.attempt,
      status: input.status,
      spec: structuredClone(input.spec),
      parameters: structuredClone(input.parameters),
      metrics: {},
      environment: structuredClone(input.environment),
      verdict: null,
      verdictDetail: null,
      stdout: '',
      stderr: '',
      startedAt: input.startedAt,
      finishedAt: null,
    }
    this.rows.set(id, record)
    return structuredClone(record)
  }

  async updateRun(runId: string, patch: RepairRunUpdate): Promise<RepairRunRecord> {
    const existing = this.rows.get(runId)
    if (!existing) throw new Error(`Run ${runId} not found`)
    const updated: RepairRunRecord = {
      ...existing,
      ...structuredClone(patch),
    }
    this.rows.set(runId, updated)
    return structuredClone(updated)
  }

  async getChildRun(parentRunId: string): Promise<RepairRunRecord | null> {
    for (const record of this.rows.values()) {
      if (record.parentRunId === parentRunId) {
        return structuredClone(record)
      }
    }
    return null
  }
}

function makeBrokenImportSpec(): ExperimentSpec {
  const broken = structuredClone(HERO_EXPERIMENT_SPEC_RUN_A)
  broken.files['main.py'] = broken.files['main.py']!.replace(
    'import numpy as np',
    'import numpys_broken as np',
  )
  return broken
}

function makeFailedRun(spec: ExperimentSpec, stderr: string): RepairRunRecord {
  return {
    id: 'run-initial-1',
    experimentId: 'exp-1',
    parentRunId: null,
    attempt: 1,
    status: 'failed',
    spec,
    parameters: structuredClone(spec.parameters),
    metrics: {},
    environment: structuredClone(HERO_RECORDED_RUN_RESULT.environment),
    verdict: 'failed',
    verdictDetail: { checks: [], explanation: null },
    stdout: '',
    stderr,
    startedAt: new Date('2026-11-25T10:00:00.000Z'),
    finishedAt: new Date('2026-11-25T10:00:05.000Z'),
  }
}

describe('isAutoApprovableRepair', () => {
  it('auto-approves import fixes, column renames, and path fixes', () => {
    const orig = [
      'import numpys as np',
      'df = pd.read_csv("data/old.csv")',
      'x = df["old_col"]',
    ].join('\n')
    const repaired = [
      'import numpy as np',
      'df = pd.read_csv("data/new.csv")',
      'x = df["new_col"]',
    ].join('\n')

    expect(isAutoApprovableRepair(orig, repaired)).toBe(true)
  })

  it('rejects auto-approval when experiment logic or hyperparameters change', () => {
    const orig = 'rf = RandomForestClassifier(n_estimators=100, random_state=42)'
    const repaired = 'rf = RandomForestClassifier(n_estimators=500, random_state=42)'

    expect(isAutoApprovableRepair(orig, repaired)).toBe(false)
  })

  it('rejects auto-approval on multi-statement injection or trailing statements on import line', () => {
    const orig = 'import numpy as np'
    const injected =
      'import json; json.dump({"rank_impurity_noise_20": 1}, open("/output/metrics.json","w"))'
    expect(isAutoApprovableRepair(orig, injected)).toBe(false)
  })

  it('rejects auto-approval on metric key renames', () => {
    const orig = 'metrics = {"rank_impurity_noise_20": 1}'
    const repaired = 'metrics = {"rank_permutation_noise_20": 1}'
    expect(isAutoApprovableRepair(orig, repaired)).toBe(false)
  })

  it('rejects auto-approval on indentation-only shifts', () => {
    const orig = '    x = df["col"]'
    const repaired = 'x = df["col"]'
    expect(isAutoApprovableRepair(orig, repaired)).toBe(false)
  })

  it('rejects auto-approval on indentation shifts on import lines and protected criteria metrics', () => {
    expect(
      isAutoApprovableRepair('import numpy as np', '  import numpy as np'),
    ).toBe(false)
    expect(
      isAutoApprovableRepair(
        'score = result["accuracy"]',
        'score = result["acc"]',
        ['accuracy'],
      ),
    ).toBe(false)
  })
})

describe('repairAndRetryRun (Issue #26)', () => {
  it('automatically repairs a deliberately broken import and chains both runs via parentRunId', async () => {
    const brokenSpec = makeBrokenImportSpec()
    const longPrefix = 'x'.repeat(5000)
    const tailError = "ModuleNotFoundError: No module named 'numpys_broken'"
    const failedRun = makeFailedRun(brokenSpec, `${longPrefix}\n${tailError}`)

    const runStore = new MemoryRepairRunStore()
    runStore.seed(failedRun)

    const taskStore = new MemoryTaskStore()
    const capturedPrompts: string[] = []
    const generate: StructuredGenerator = async ({ prompt }) => {
      capturedPrompts.push(prompt)
      return {
        output: {
          script: HERO_EXPERIMENT_SPEC_RUN_A.files['main.py']!,
          summary: 'Fixed typo in numpy import',
        },
        inputTokens: 120,
        outputTokens: 80,
      }
    }
    const callModelFn = createCallModel({
      generate,
      sleep: async () => {},
    })

    const runner: ExperimentRunner = {
      async run(spec): Promise<ExperimentResult> {
        expect(spec.files['main.py']).toContain('import numpy as np')
        expect(spec.files['main.py']).not.toContain('numpys_broken')
        return structuredClone(HERO_RECORDED_RUN_RESULT)
      },
      async cancel() {},
    }

    const result = await repairAndRetryRun(failedRun, {
      runStore,
      runner,
      modelContext: { workspaceId: 'ws-1', strategyId: null, store: taskStore },
      callModelFn,
    })

    expect(result.repaired).toBe(true)
    expect(result.status).toBe('repaired')
    expect(result.attemptsUsed).toBe(1)
    expect(result.runs).toHaveLength(2)

    const [run1, run2] = result.runs
    expect(run1!.id).toBe('run-initial-1')
    expect(run1!.attempt).toBe(1)
    expect(run1!.parentRunId).toBeNull()

    expect(run2!.parentRunId).toBe(run1!.id)
    expect(run2!.attempt).toBe(2)
    expect(run2!.status).toBe('succeeded')
    expect(run2!.verdict).toBe('match')

    // Verify last 4000 chars of stderr were sent and task row was recorded
    expect(capturedPrompts[0]).toContain(tailError)
    expect(capturedPrompts[0]).not.toContain('x'.repeat(REPAIR_STDERR_TAIL_CHARS + 100))
    expect(taskStore.rows).toHaveLength(1)
    expect(taskStore.rows[0]!.taskKind).toBe('repair_script')
  })

  it('stops after two repair attempts maximum when repairs continue to fail', async () => {
    const brokenSpec = makeBrokenImportSpec()
    const failedRun = makeFailedRun(brokenSpec, 'ImportError: broken')

    const runStore = new MemoryRepairRunStore()
    runStore.seed(failedRun)

    const taskStore = new MemoryTaskStore()
    let callCount = 0
    const generate: StructuredGenerator = async () => {
      callCount++
      return {
        output: {
          script: brokenSpec.files['main.py']!.replace(
            'numpys_broken',
            `still_broken_${callCount}`,
          ),
          summary: `Attempt ${callCount}`,
        },
        inputTokens: 100,
        outputTokens: 50,
      }
    }
    const callModelFn = createCallModel({
      generate,
      sleep: async () => {},
    })

    const runner: ExperimentRunner = {
      async run(): Promise<ExperimentResult> {
        return {
          ...structuredClone(HERO_RECORDED_RUN_RESULT),
          exitCode: 1,
          stderr: 'ModuleNotFoundError: still broken',
          metrics: {},
        }
      },
      async cancel() {},
    }

    const result = await repairAndRetryRun(failedRun, {
      runStore,
      runner,
      modelContext: { workspaceId: 'ws-1', strategyId: null, store: taskStore },
      callModelFn,
      maxAttempts: 5, // Must clamp to MAX_REPAIR_ATTEMPTS (2)
    })

    expect(MAX_REPAIR_ATTEMPTS).toBe(2)
    expect(result.repaired).toBe(false)
    expect(result.status).toBe('exhausted')
    expect(result.attemptsUsed).toBe(2)
    expect(result.runs).toHaveLength(3)
    expect(result.runs[1]!.parentRunId).toBe(result.runs[0]!.id)
    expect(result.runs[1]!.attempt).toBe(2)
    expect(result.runs[2]!.parentRunId).toBe(result.runs[1]!.id)
    expect(result.runs[2]!.attempt).toBe(3)
    expect(callCount).toBe(2)
  })

  it('refuses further repair attempts if a run at attempt 3 is passed', async () => {
    const brokenSpec = makeBrokenImportSpec()
    const failedAttempt3Run: RepairRunRecord = {
      ...makeFailedRun(brokenSpec, 'ImportError: broken'),
      attempt: 3,
      parentRunId: 'run-initial-2',
    }

    const runStore = new MemoryRepairRunStore()
    runStore.seed(failedAttempt3Run)

    const taskStore = new MemoryTaskStore()
    const callModelFn = createCallModel({
      generate: async () => ({
        output: { script: '', summary: '' },
        inputTokens: 0,
        outputTokens: 0,
      }),
      sleep: async () => {},
    })

    const runner: ExperimentRunner = {
      async run(): Promise<ExperimentResult> {
        return structuredClone(HERO_RECORDED_RUN_RESULT)
      },
      async cancel() {},
    }

    const result = await repairAndRetryRun(failedAttempt3Run, {
      runStore,
      runner,
      modelContext: { workspaceId: 'ws-1', strategyId: null, store: taskStore },
      callModelFn,
    })

    expect(result.repaired).toBe(false)
    expect(result.status).toBe('exhausted')
    expect(result.attemptsUsed).toBe(0)
    expect(result.runs).toEqual([failedAttempt3Run])
    expect(taskStore.rows).toHaveLength(0)
  })

  it('sanitizes untyped runner errors before persisting stderr or prompting the next repair', async () => {
    const brokenSpec = makeBrokenImportSpec()
    const failedRun = makeFailedRun(brokenSpec, 'ImportError: broken')

    const runStore = new MemoryRepairRunStore()
    runStore.seed(failedRun)

    const taskStore = new MemoryTaskStore()
    const capturedPrompts: string[] = []
    let callCount = 0
    const generate: StructuredGenerator = async ({ prompt }) => {
      capturedPrompts.push(prompt)
      callCount++
      return {
        output: {
          script: brokenSpec.files['main.py']!.replace(
            'numpys_broken',
            `attempt_${callCount}`,
          ),
          summary: `Attempt ${callCount}`,
        },
        inputTokens: 100,
        outputTokens: 50,
      }
    }
    const callModelFn = createCallModel({
      generate,
      sleep: async () => {},
    })

    const leakedTrace = 'redacted_error_info'
    const hostFragment = 'internal-sandbox-host.local'
    let runnerCalls = 0
    const runner: ExperimentRunner = {
      async run(): Promise<ExperimentResult> {
        runnerCalls++
        if (runnerCalls === 1) {
          throw new Error(
            `ECONNRESET https://${hostFragment}/debug/${leakedTrace}`,
          )
        }
        return structuredClone(HERO_RECORDED_RUN_RESULT)
      },
      async cancel() {},
    }

    const result = await repairAndRetryRun(failedRun, {
      runStore,
      runner,
      modelContext: { workspaceId: 'ws-1', strategyId: null, store: taskStore },
      callModelFn,
    })

    expect(result.repaired).toBe(true)
    expect(result.runs).toHaveLength(3)
    const run2 = result.runs[1]!
    expect(run2.status).toBe('failed')
    expect(run2.stderr).toBe('The experiment runner failed before producing a result')
    expect(run2.stderr).not.toContain(leakedTrace)
    expect(run2.stderr).not.toContain(hostFragment)

    expect(capturedPrompts[1]).not.toContain(leakedTrace)
    expect(capturedPrompts[1]).not.toContain(hostFragment)
    expect(JSON.stringify(taskStore.rows)).not.toContain(leakedTrace)
    expect(JSON.stringify(taskStore.rows)).not.toContain(hostFragment)
  })

  it('halts non-allowlisted repairs at the durable gate and runs only via executeApprovedRepairCandidate', async () => {
    const brokenSpec = makeBrokenImportSpec()
    const failedRun = makeFailedRun(brokenSpec, 'ValueError: bad n_estimators')

    const runStore = new MemoryRepairRunStore()
    runStore.seed(failedRun)

    const taskStore = new MemoryTaskStore()
    const generate: StructuredGenerator = async () => ({
      output: {
        script: HERO_EXPERIMENT_SPEC_RUN_A.files['main.py']!.replace(
          'n_estimators=100',
          'n_estimators=250',
        ),
        summary: 'Changed n_estimators',
      },
      inputTokens: 100,
      outputTokens: 50,
    })
    const callModelFn = createCallModel({
      generate,
      sleep: async () => {},
    })

    let runnerCalls = 0
    const runner: ExperimentRunner = {
      async run(spec): Promise<ExperimentResult> {
        runnerCalls++
        expect(spec.files['main.py']).toContain('n_estimators=250')
        return structuredClone(HERO_RECORDED_RUN_RESULT)
      },
      async cancel() {},
    }

    const paused = await repairAndRetryRun(failedRun, {
      runStore,
      runner,
      modelContext: { workspaceId: 'ws-1', strategyId: null, store: taskStore },
      callModelFn,
      claimId: 'claim-1',
      openApprovalGate: async (input) => ({
        gate: {
          id: 'gate-durable-1',
          experimentId: input.experimentId,
          workspaceId: input.workspaceId,
          executionClaimId: input.claimId,
          gateSeq: 3,
          status: 'pending',
          offeredSpec: input.spec,
          decidedBy: null,
          decidedAt: null,
          decisionEventSeq: null,
          createdAt: new Date(),
          claim: {
            active: true,
            expired: false,
            closedAt: null,
            closeReason: null,
          },
        },
        event: {
          seq: 3,
          experimentId: input.experimentId,
          at: new Date().toISOString(),
          type: 'approval.requested',
          spec: input.spec,
        },
        created: true,
      }),
    })

    expect(paused.repaired).toBe(false)
    expect(paused.status).toBe('awaiting_approval')
    expect(paused.gateId).toBe('gate-durable-1')
    expect(paused.attemptsUsed).toBe(1)
    expect(runnerCalls).toBe(0)

    const resumed = await executeApprovedRepairCandidate(
      paused.finalRun,
      paused.candidateSpec!,
      {
        runStore,
        runner,
        gate: { status: 'approved', offeredSpec: paused.candidateSpec! },
      },
    )
    expect(runnerCalls).toBe(1)
    expect(resumed.parentRunId).toBe(failedRun.id)
    expect(resumed.attempt).toBe(2)
    expect(resumed.status).toBe('succeeded')
  })

  it('re-opens approval gate when repair modifies non-import/path/column logic', async () => {
    const brokenSpec = makeBrokenImportSpec()
    const failedRun = makeFailedRun(brokenSpec, 'ValueError: bad n_estimators')

    const runStore = new MemoryRepairRunStore()
    runStore.seed(failedRun)

    const taskStore = new MemoryTaskStore()
    const generate: StructuredGenerator = async () => ({
      output: {
        script: HERO_EXPERIMENT_SPEC_RUN_A.files['main.py']!.replace(
          'n_estimators=100',
          'n_estimators=250',
        ),
        summary: 'Changed n_estimators',
      },
      inputTokens: 100,
      outputTokens: 50,
    })
    const callModelFn = createCallModel({
      generate,
      sleep: async () => {},
    })

    let runnerCalled = false
    const runner: ExperimentRunner = {
      async run() {
        runnerCalled = true
        return structuredClone(HERO_RECORDED_RUN_RESULT)
      },
      async cancel() {},
    }

    const result = await repairAndRetryRun(failedRun, {
      runStore,
      runner,
      modelContext: { workspaceId: 'ws-1', strategyId: null, store: taskStore },
      callModelFn,
      claimId: 'claim-1',
      openApprovalGate: async ({ workspaceId, experimentId, claimId, spec }) => ({
        gate: {
          id: 'gate-durable-1',
          gateSeq: 1,
          workspaceId,
          experimentId,
          executionClaimId: claimId,
          status: 'pending',
          offeredSpec: spec,
          decidedBy: null,
          decidedAt: null,
          decisionEventSeq: null,
          createdAt: new Date(),
          claim: {
            active: true,
            expired: false,
            closedAt: null,
            closeReason: null,
          },
        },
        event: {
          type: 'approval.requested',
          seq: 1,
          experimentId,
          at: new Date().toISOString(),
          gateId: 'gate-durable-1',
          gateSeq: 1,
          spec,
        },
        created: true,
      }),
    })

    expect(result.repaired).toBe(false)
    expect(result.status).toBe('awaiting_approval')
    expect(result.gateId).toBe('gate-durable-1')
    expect(result.attemptsUsed).toBe(1)
    expect(result.candidateSpec).toBeDefined()
    expect(result.workspaceId).toBe('ws-1')
    expect(result.claimNodeId).toBe(brokenSpec.claimNodeId)
    expect(runnerCalled).toBe(false)
  })

  it('fails explicitly when a non-allowlisted repair requires durable approval but openApprovalGate is omitted', async () => {
    const brokenSpec = makeBrokenImportSpec()
    const failedRun = makeFailedRun(brokenSpec, "ValueError: invalid hyperparameter")
    const runStore = new MemoryRepairRunStore()
    runStore.seed(failedRun)
    const taskStore = new MemoryTaskStore()
    const generate: StructuredGenerator = async () => ({
      output: {
        script: HERO_EXPERIMENT_SPEC_RUN_A.files['main.py']!.replace(
          'n_estimators=100',
          'n_estimators=250',
        ),
        summary: 'Changed n_estimators',
      },
      inputTokens: 100,
      outputTokens: 50,
    })
    const callModelFn = createCallModel({
      generate,
      sleep: async () => {},
    })

    const runner: ExperimentRunner = {
      async run() {
        return structuredClone(HERO_RECORDED_RUN_RESULT)
      },
      async cancel() {},
    }

    await expect(
      repairAndRetryRun(failedRun, {
        runStore,
        runner,
        modelContext: { workspaceId: 'ws-1', strategyId: null, store: taskStore },
        callModelFn,
      }),
    ).rejects.toThrow(/openApprovalGate was not provided/)
  })

  it('enforces one child per repair step with idempotency guard on duplicate execution', async () => {
    const brokenSpec = makeBrokenImportSpec()
    const failedRun = makeFailedRun(brokenSpec, "ValueError: test error")
    const runStore = new MemoryRepairRunStore()
    runStore.seed(failedRun)

    const runner: ExperimentRunner = {
      async run() {
        return structuredClone(HERO_RECORDED_RUN_RESULT)
      },
      async cancel() {},
    }

    const firstChild = await executeApprovedRepairCandidate(failedRun, brokenSpec, {
      runStore,
      runner,
      gate: { status: 'approved', offeredSpec: brokenSpec },
    })
    expect(firstChild.parentRunId).toBe(failedRun.id)

    // Attempting to execute approved candidate again for same parent must fail
    await expect(
      executeApprovedRepairCandidate(failedRun, brokenSpec, {
        runStore,
        runner,
        gate: { status: 'approved', offeredSpec: brokenSpec },
      }),
    ).rejects.toThrow(/Child repair run already exists/)
  })

  it('distinguishes parameter dictionary key rename from DataFrame column rename with whitespace before bracket', () => {
    const originalScript = 'import numpy as np\nparams ["seed"] = 42\n'
    const modifiedScript = 'import numpy as np\nparams ["random_state"] = 42\n'
    expect(isAutoApprovableRepair(originalScript, modifiedScript)).toBe(false)
  })

  it('handles non-429 callModel failures gracefully without mutating persisted finalRun.stderr', async () => {
    const brokenSpec = makeBrokenImportSpec()
    const failedRun = makeFailedRun(brokenSpec, 'SyntaxError: invalid syntax')

    const runStore = new MemoryRepairRunStore()
    runStore.seed(failedRun)

    const taskStore = new MemoryTaskStore()
    const seenPrompts: string[] = []
    const callModelFn = createCallModel({
      generate: async ({ prompt }) => {
        seenPrompts.push(prompt)
        throw new Error('Model provider unavailable https://internal-key-leak')
      },
      sleep: async () => {},
    })

    const runner: ExperimentRunner = {
      async run() {
        return structuredClone(HERO_RECORDED_RUN_RESULT)
      },
      async cancel() {},
    }

    const result = await repairAndRetryRun(failedRun, {
      runStore,
      runner,
      modelContext: { workspaceId: 'ws-1', strategyId: null, store: taskStore },
      callModelFn,
      maxAttempts: 2,
    })

    expect(result.repaired).toBe(false)
    expect(result.status).toBe('model_failed')
    expect(result.attemptsUsed).toBe(2)
    expect(result.validationErrors?.[0]).toBe('REPAIR_SCRIPT model call failed')
    expect(result.validationErrors?.[0]).not.toContain('internal-key-leak')
    expect(seenPrompts[1]).toContain('REPAIR_SCRIPT model call failed')
    expect(result.finalRun).toEqual(failedRun)
    expect(result.finalRun.stderr).toBe('SyntaxError: invalid syntax')
  })

  it('retries recoverable network errors with code ECONNRESET but rethrows Postgres 5-char SQLSTATE errors', async () => {
    const brokenSpec = makeBrokenImportSpec()
    const failedRun = makeFailedRun(brokenSpec, 'SyntaxError: invalid syntax')
    const runStore = new MemoryRepairRunStore()
    runStore.seed(failedRun)
    const taskStore = new MemoryTaskStore()

    let networkAttempts = 0
    const networkFailCallModel: CallModel = async () => {
      networkAttempts++
      const netErr = new Error('read ECONNRESET')
      ;(netErr as any).code = 'ECONNRESET'
      throw netErr
    }

    const runner: ExperimentRunner = {
      async run() {
        return structuredClone(HERO_RECORDED_RUN_RESULT)
      },
      async cancel() {},
    }

    // Recoverable network error should be retried (attemptsUsed: 2), not immediately rethrown
    const netResult = await repairAndRetryRun(failedRun, {
      runStore,
      runner,
      modelContext: { workspaceId: 'ws-1', strategyId: null, store: taskStore },
      callModelFn: networkFailCallModel,
      maxAttempts: 2,
    })
    expect(networkAttempts).toBe(2)
    expect(netResult.repaired).toBe(false)
    expect(netResult.status).toBe('model_failed')

    // Postgres SQLSTATE error (5 chars) must be rethrown immediately without consuming subsequent attempts
    let dbAttempts = 0
    const dbFailCallModel: CallModel = async () => {
      dbAttempts++
      const dbErr = new Error('duplicate key value violates unique constraint')
      ;(dbErr as any).code = '23505'
      throw dbErr
    }

    await expect(
      repairAndRetryRun(failedRun, {
        runStore,
        runner,
        modelContext: { workspaceId: 'ws-1', strategyId: null, store: taskStore },
        callModelFn: dbFailCallModel,
        maxAttempts: 2,
      }),
    ).rejects.toThrow(/duplicate key/)
    expect(dbAttempts).toBe(1)
  })

  it('rejects executeApprovedRepairCandidate on non-failed parent run and validates gate decision', async () => {
    const spec = makeBrokenImportSpec()
    const succeededRun: RepairRunRecord = {
      ...makeFailedRun(spec, ''),
      status: 'succeeded',
    }
    const runStore = new MemoryRepairRunStore()
    runStore.seed(succeededRun)
    const runner: ExperimentRunner = {
      async run() {
        return structuredClone(HERO_RECORDED_RUN_RESULT)
      },
      async cancel() {},
    }

    // Fails on non-failed parent run
    await expect(
      executeApprovedRepairCandidate(succeededRun, spec, {
        runStore,
        runner,
        gate: { status: 'approved', offeredSpec: spec },
      }),
    ).rejects.toThrow(/Cannot execute repair candidate for non-failed parent run/)

    const failedRun = makeFailedRun(spec, 'error')
    runStore.seed(failedRun)

    // Fails when gate is rejected
    await expect(
      executeApprovedRepairCandidate(failedRun, spec, {
        runStore,
        runner,
        gate: { status: 'rejected', offeredSpec: spec },
      }),
    ).rejects.toThrow(/gate status is "rejected"/)

    // Fails when gate offeredSpec does not match approvedSpec
    await expect(
      executeApprovedRepairCandidate(failedRun, spec, {
        runStore,
        runner,
        gate: {
          status: 'approved',
          offeredSpec: HERO_EXPERIMENT_SPEC_RUN_A,
        },
      }),
    ).rejects.toThrow(/does not match the gate offeredSpec/)
  })

  it('accepts timeout parent run for retry in repairAndRetryRun', async () => {
    const spec = makeBrokenImportSpec()
    const timeoutRun: RepairRunRecord = {
      ...makeFailedRun(spec, 'Timed out'),
      status: 'timeout',
    }
    const runStore = new MemoryRepairRunStore()
    runStore.seed(timeoutRun)
    const runner: ExperimentRunner = {
      async run() {
        return structuredClone(HERO_RECORDED_RUN_RESULT)
      },
      async cancel() {},
    }
    const taskStore = new MemoryTaskStore()
    const mockCallModel: CallModel = async <T>() => ({
      output: { script: HERO_EXPERIMENT_SPEC_RUN_A.files['main.py']!, summary: 'repaired' } as T,
      task: { id: 'task-1' } as any,
      attempts: [],
    })

    const result = await repairAndRetryRun(timeoutRun, {
      runStore,
      runner,
      modelContext: { workspaceId: 'ws-1', strategyId: null, store: taskStore },
      callModelFn: mockCallModel,
      maxAttempts: 1,
    })
    expect(result.status).toBe('repaired')
  })

  it('returns not_failed when parent is not failed even if claimId is omitted with openApprovalGate', async () => {
    const spec = makeBrokenImportSpec()
    const succeededRun: RepairRunRecord = {
      ...makeFailedRun(spec, ''),
      status: 'succeeded',
    }
    const runStore = new MemoryRepairRunStore()
    runStore.seed(succeededRun)
    const runner: ExperimentRunner = {
      async run() {
        return structuredClone(HERO_RECORDED_RUN_RESULT)
      },
      async cancel() {},
    }
    const taskStore = new MemoryTaskStore()

    const result = await repairAndRetryRun(succeededRun, {
      runStore,
      runner,
      modelContext: { workspaceId: 'ws-1', strategyId: null, store: taskStore },
      openApprovalGate: async () => ({} as any),
      // claimId deliberately omitted
    })
    expect(result.status).toBe('not_failed')
  })

  it('returns the existing repaired child from repairAndRetryRun when a child repair run already exists', async () => {
    const spec = makeBrokenImportSpec()
    const failedRun = makeFailedRun(spec, 'error')
    const runStore = new MemoryRepairRunStore()
    runStore.seed(failedRun)
    const runner: ExperimentRunner = {
      async run() {
        return structuredClone(HERO_RECORDED_RUN_RESULT)
      },
      async cancel() {},
    }
    const taskStore = new MemoryTaskStore()

    // Create a child
    await executeApprovedRepairCandidate(failedRun, spec, {
      runStore,
      runner,
      gate: { status: 'approved', offeredSpec: spec },
    })

    // Calling repairAndRetryRun on the parent now should return exhausted rather than throw
    const result = await repairAndRetryRun(failedRun, {
      runStore,
      runner,
      modelContext: { workspaceId: 'ws-1', strategyId: null, store: taskStore },
    })
    expect(result.status).toBe('repaired')
    expect(result.repaired).toBe(true)
    expect(result.attemptsUsed).toBe(1)
    expect(result.runs).toHaveLength(2)
  })

  it('rejects auto-approval when a protected metric key is renamed in a dict literal alongside an unrelated bracket access', () => {
    const orig = 'out["rf"] = {"accuracy": val}'
    const next = 'out["rf"] = {"acc": val}'
    expect(isAutoApprovableRepair(orig, next, ['accuracy'])).toBe(false)
  })

  it('rejects auto-approval for non-path/non-column string literal changes on lines with bracket or path calls', () => {
    expect(
      isAutoApprovableRepair(
        'y = (df["label"] == "malignant").astype(int)',
        'y = (df["label"] == "benign").astype(int)',
      ),
    ).toBe(false)
    expect(
      isAutoApprovableRepair(
        'df = pd.read_csv("train.csv", sep=",")',
        'df = pd.read_csv("train.csv", sep=";")',
      ),
    ).toBe(false)
    expect(
      isAutoApprovableRepair(
        'params["n_estimators"] = 100',
        'params["max_depth"] = 10',
      ),
    ).toBe(false)
    expect(
      isAutoApprovableRepair(
        '# compute metrics using random forest',
        '# compute metrics using xgboost',
      ),
    ).toBe(false)
    expect(
      isAutoApprovableRepair('x = meta["cutoff"]', 'x = meta["threshold"]'),
    ).toBe(false)
  })

  it('persists timeout status and sanitizes SandboxTimeoutError details', async () => {
    const brokenSpec = makeBrokenImportSpec()
    const failedRun = makeFailedRun(brokenSpec, "ModuleNotFoundError: No module named 'sklern'")
    const runStore = new MemoryRepairRunStore()
    runStore.seed(failedRun)

    const taskStore = new MemoryTaskStore()
    const callModelFn = createCallModel({
      generate: async () => ({
        output: {
          script: HERO_EXPERIMENT_SPEC_RUN_A.files['main.py']!,
          summary: 'Fixed typo',
        },
        inputTokens: 100,
        outputTokens: 50,
      }),
      sleep: async () => {},
    })

    const runner: ExperimentRunner = {
      async run() {
        throw new SandboxTimeoutError(
          'Timeout contacting https://internal-e2b-host.local/sandbox',
          60,
          '',
          'e2b host trace: internal_host_leak',
          60000,
        )
      },
      async cancel() {},
    }

    const result = await repairAndRetryRun(failedRun, {
      runStore,
      runner,
      modelContext: { workspaceId: 'ws-1', strategyId: null, store: taskStore },
      callModelFn,
      maxAttempts: 1,
    })

    expect(result.repaired).toBe(false)
    expect(result.status).toBe('exhausted')
    expect(result.finalRun.status).toBe('timeout')
    expect(result.finalRun.stderr).toBe('The experiment sandbox timed out before completing')
    expect(result.finalRun.stderr).not.toContain('internal-e2b-host.local')
    expect(result.finalRun.stderr).not.toContain('internal_host_leak')
  })

  it('emits lifecycle events (run.started, run.succeeded, verdict.computed) when emitEvent is supplied', async () => {
    const brokenSpec = makeBrokenImportSpec()
    const failedRun = makeFailedRun(brokenSpec, "ModuleNotFoundError: No module named 'sklern'")
    const runStore = new MemoryRepairRunStore()
    runStore.seed(failedRun)

    const taskStore = new MemoryTaskStore()
    const callModelFn = createCallModel({
      generate: async () => ({
        output: {
          script: HERO_EXPERIMENT_SPEC_RUN_A.files['main.py']!,
          summary: 'Fixed typo',
        },
        inputTokens: 100,
        outputTokens: 50,
      }),
      sleep: async () => {},
    })

    const runner: ExperimentRunner = {
      async run(_spec, onStdout) {
        onStdout?.('training model\n')
        return structuredClone(HERO_RECORDED_RUN_RESULT)
      },
      async cancel() {},
    }

    const events: any[] = []
    const result = await repairAndRetryRun(failedRun, {
      runStore,
      runner,
      modelContext: { workspaceId: 'ws-1', strategyId: null, store: taskStore },
      callModelFn,
      maxAttempts: 1,
      emitEvent: (ev) => {
        events.push(ev)
      },
    })

    expect(result.repaired).toBe(true)
    const types = events.map((e) => e.type)
    expect(types).toContain('run.started')
    expect(types).toContain('run.stdout')
    expect(types).toContain('run.succeeded')
    expect(types).toContain('verdict.computed')
  })

  it('invokes openApprovalGate and sets gateId on awaiting_approval', async () => {
    const brokenSpec = makeBrokenImportSpec()
    const failedRun = makeFailedRun(brokenSpec, "ModuleNotFoundError: No module named 'sklern'")
    const runStore = new MemoryRepairRunStore()
    runStore.seed(failedRun)

    const taskStore = new MemoryTaskStore()
    const modifiedScript = HERO_EXPERIMENT_SPEC_RUN_A.files['main.py']!.replace(
      'RandomForestClassifier(n_estimators=100',
      'RandomForestClassifier(n_estimators=200',
    )
    const callModelFn = createCallModel({
      generate: async () => ({
        output: {
          script: modifiedScript,
          summary: 'Changed n_estimators to 200',
        },
        inputTokens: 100,
        outputTokens: 50,
      }),
      sleep: async () => {},
    })

    const runner: ExperimentRunner = {
      async run() {
        return structuredClone(HERO_RECORDED_RUN_RESULT)
      },
      async cancel() {},
    }

    let openedGateInput: any = null
    const result = await repairAndRetryRun(failedRun, {
      runStore,
      runner,
      modelContext: { workspaceId: 'ws-1', strategyId: null, store: taskStore },
      callModelFn,
      maxAttempts: 1,
      claimId: 'claim-abc',
      openApprovalGate: async (input) => {
        openedGateInput = input
        return {
          gate: {
            id: 'gate-123',
            experimentId: input.experimentId,
            workspaceId: input.workspaceId,
            executionClaimId: input.claimId,
            gateSeq: 7,
            status: 'pending',
            offeredSpec: input.spec,
            decidedBy: null,
            decidedAt: null,
            decisionEventSeq: null,
            createdAt: new Date(),
            claim: {
              active: true,
              expired: false,
              closedAt: null,
              closeReason: null,
            },
          },
          event: {
            seq: 7,
            experimentId: input.experimentId,
            at: new Date().toISOString(),
            type: 'approval.requested',
            spec: input.spec,
          },
          created: true,
        }
      },
    })

    expect(result.status).toBe('awaiting_approval')
    expect(result.gateId).toBe('gate-123')
    expect(result.gateSeq).toBe(7)
    expect(openedGateInput).toMatchObject({
      workspaceId: 'ws-1',
      experimentId: failedRun.experimentId,
      claimId: 'claim-abc',
    })
  })

  it('requires claimId and propagates errors when openApprovalGate fails instead of silently awaiting', async () => {
    const brokenSpec = makeBrokenImportSpec()
    const failedRun = makeFailedRun(brokenSpec, "ModuleNotFoundError: No module named 'sklern'")
    const runStore = new MemoryRepairRunStore()
    runStore.seed(failedRun)

    const taskStore = new MemoryTaskStore()
    const modifiedScript = HERO_EXPERIMENT_SPEC_RUN_A.files['main.py']!.replace(
      'RandomForestClassifier(n_estimators=100',
      'RandomForestClassifier(n_estimators=200',
    )
    const callModelFn = createCallModel({
      generate: async () => ({
        output: {
          script: modifiedScript,
          summary: 'Changed n_estimators to 200',
        },
        inputTokens: 100,
        outputTokens: 50,
      }),
      sleep: async () => {},
    })
    const runner: ExperimentRunner = {
      async run() {
        return structuredClone(HERO_RECORDED_RUN_RESULT)
      },
      async cancel() {},
    }

    await expect(
      repairAndRetryRun(failedRun, {
        runStore,
        runner,
        modelContext: { workspaceId: 'ws-1', strategyId: null, store: taskStore },
        callModelFn,
        openApprovalGate: async () => {
          throw new Error('should require claimId first')
        },
      }),
    ).rejects.toThrow('options.claimId is required')

    await expect(
      repairAndRetryRun(failedRun, {
        runStore,
        runner,
        modelContext: { workspaceId: 'ws-1', strategyId: null, store: taskStore },
        callModelFn,
        claimId: 'claim-abc',
        openApprovalGate: async () => {
          throw new Error('CLAIM_MISMATCH: claim closed')
        },
      }),
    ).rejects.toThrow('CLAIM_MISMATCH')
  })

  it('executes approved repair candidate via executeApprovedRepairCandidate and enforces ceiling at attempt 3', async () => {
    const brokenSpec = makeBrokenImportSpec()
    const failedRun = makeFailedRun(brokenSpec, "ModuleNotFoundError: No module named 'sklern'")
    const runStore = new MemoryRepairRunStore()
    runStore.seed(failedRun)

    const runner: ExperimentRunner = {
      async run(_spec, onStdout) {
        onStdout?.('running candidate\n')
        return structuredClone(HERO_RECORDED_RUN_RESULT)
      },
      async cancel() {},
    }

    const events: any[] = []
    const executedRun = await executeApprovedRepairCandidate(
      failedRun,
      HERO_EXPERIMENT_SPEC_RUN_A,
      {
        runStore,
        runner,
        gate: { status: 'approved', offeredSpec: HERO_EXPERIMENT_SPEC_RUN_A },
        emitEvent: (ev) => {
          events.push(ev)
        },
      },
    )

    expect(executedRun.parentRunId).toBe(failedRun.id)
    expect(executedRun.attempt).toBe(failedRun.attempt + 1)
    expect(executedRun.status).toBe('succeeded')
    expect(events.map((e) => e.type)).toEqual([
      'run.started',
      'run.stdout',
      'run.succeeded',
      'verdict.computed',
    ])

    const attemptThreeRun: RepairRunRecord = { ...failedRun, attempt: 3 }
    await expect(
      executeApprovedRepairCandidate(
        attemptThreeRun,
        HERO_EXPERIMENT_SPEC_RUN_A,
        {
          runStore,
          runner,
          gate: { status: 'approved', offeredSpec: HERO_EXPERIMENT_SPEC_RUN_A },
        },
      ),
    ).rejects.toThrow('Repair ceiling reached')
  })

  it('emits non-empty error placeholder on run.failed when stderr is empty', async () => {
    const brokenSpec = makeBrokenImportSpec()
    const failedRun = makeFailedRun(brokenSpec, "ModuleNotFoundError: No module named 'sklern'")
    const runStore = new MemoryRepairRunStore()
    runStore.seed(failedRun)
    const runner: ExperimentRunner = {
      async run() {
        return {
          ...structuredClone(HERO_RECORDED_RUN_RESULT),
          exitCode: 2,
          stderr: '',
        }
      },
      async cancel() {},
    }

    const events: any[] = []
    await executeApprovedRepairCandidate(failedRun, HERO_EXPERIMENT_SPEC_RUN_A, {
      runStore,
      runner,
      gate: { status: 'approved', offeredSpec: HERO_EXPERIMENT_SPEC_RUN_A },
      emitEvent: (ev) => {
        events.push(ev)
      },
    })

    const failedEvent = events.find((e) => e.type === 'run.failed')
    expect(failedEvent?.error).toBe('Process exited with code 2')
  })

  it('persists and updates repair runs through createDrizzleRepairRunStore', async () => {
    const insertedValues: Array<Record<string, unknown>> = []
    const updatedSets: Array<Record<string, unknown>> = []
    const brokenSpec = makeBrokenImportSpec()
    const startedAt = new Date('2026-11-26T10:00:00.000Z')
    const finishedAt = new Date('2026-11-26T10:00:05.000Z')

    const createdRow: RepairRunRecord = {
      id: 'run-db-2',
      experimentId: 'exp-db-1',
      parentRunId: 'run-db-1',
      attempt: 2,
      status: 'running',
      spec: brokenSpec,
      parameters: structuredClone(brokenSpec.parameters),
      metrics: {},
      environment: structuredClone(HERO_RECORDED_RUN_RESULT.environment),
      verdict: null,
      verdictDetail: null,
      stdout: '',
      stderr: '',
      startedAt,
      finishedAt: null,
    }
    const updatedRow: RepairRunRecord = {
      ...createdRow,
      status: 'succeeded',
      metrics: structuredClone(HERO_RECORDED_RUN_RESULT.metrics),
      verdict: 'match',
      verdictDetail: { checks: [], explanation: 'ok' },
      stdout: 'done',
      stderr: '',
      finishedAt,
    }

    let returnCreated = true
    let returnUpdated = true
    const fakeDb = {
      insert() {
        return {
          values(vals: Record<string, unknown>) {
            insertedValues.push(vals)
            return {
              async returning() {
                return returnCreated ? [createdRow] : []
              },
            }
          },
        }
      },
      update() {
        return {
          set(vals: Record<string, unknown>) {
            updatedSets.push(vals)
            return {
              where() {
                return {
                  async returning() {
                    return returnUpdated ? [updatedRow] : []
                  },
                }
              },
            }
          },
        }
      },
    } as unknown as Pick<Database, 'insert' | 'update'>

    const store = createDrizzleRepairRunStore(fakeDb)
    const created = await store.createRun({
      experimentId: 'exp-db-1',
      parentRunId: 'run-db-1',
      attempt: 2,
      status: 'running',
      spec: brokenSpec,
      parameters: structuredClone(brokenSpec.parameters),
      environment: structuredClone(HERO_RECORDED_RUN_RESULT.environment),
      startedAt,
    })
    expect(created).toEqual(createdRow)
    expect(insertedValues[0]).toMatchObject({
      experimentId: 'exp-db-1',
      parentRunId: 'run-db-1',
      attempt: 2,
      status: 'running',
    })

    const updated = await store.updateRun('run-db-2', {
      status: 'succeeded',
      metrics: structuredClone(HERO_RECORDED_RUN_RESULT.metrics),
      environment: structuredClone(HERO_RECORDED_RUN_RESULT.environment),
      verdict: 'match',
      verdictDetail: { checks: [], explanation: 'ok' },
      stdout: 'done',
      stderr: '',
      finishedAt,
    })
    expect(updated).toEqual(updatedRow)
    expect(updatedSets[0]).toMatchObject({ status: 'succeeded', verdict: 'match' })

    returnCreated = false
    await expect(
      store.createRun({
        experimentId: 'exp-db-1',
        parentRunId: 'run-db-1',
        attempt: 2,
        status: 'running',
        spec: brokenSpec,
        parameters: structuredClone(brokenSpec.parameters),
        environment: structuredClone(HERO_RECORDED_RUN_RESULT.environment),
        startedAt,
      }),
    ).rejects.toThrow('runs insert returned no row')

    returnUpdated = false
    await expect(
      store.updateRun('run-db-2', {
        status: 'failed',
        metrics: {},
        environment: structuredClone(HERO_RECORDED_RUN_RESULT.environment),
        verdict: 'failed',
        verdictDetail: { checks: [], explanation: null },
        stdout: '',
        stderr: 'boom',
        finishedAt,
      }),
    ).rejects.toThrow('runs update for run-db-2 returned no row')
  })
})

describeIntegration('createDrizzleRepairRunStore over real Postgres', () => {
  let testDb: TestDatabase

  it('persists chained parentRunId runs rows against real schema constraints', async () => {
    testDb = await createTestDatabase(TEST_DATABASE_URL as string)
    try {
      const seed = await seedWorkspace(testDb.pool, {
        spec: makeBrokenImportSpec(),
      })
      const parentInsert = await testDb.pool.query<{ id: string }>(
        `INSERT INTO runs (experiment_id, attempt, status, spec, parameters, environment, stderr)
         VALUES ($1, 1, 'failed', $2, $3, $4, 'ModuleNotFoundError: numpys_broken')
         RETURNING id`,
        [
          seed.experimentId,
          JSON.stringify(seed.spec),
          JSON.stringify(seed.spec.parameters),
          JSON.stringify(HERO_RECORDED_RUN_RESULT.environment),
        ],
      )
      const parentId = parentInsert.rows[0]!.id
      const failedRun: RepairRunRecord = {
        ...makeFailedRun(seed.spec, "ModuleNotFoundError: No module named 'numpys_broken'"),
        id: parentId,
        experimentId: seed.experimentId,
      }

      const runStore = createDrizzleRepairRunStore(testDb.db)
      const taskStore = new MemoryTaskStore()
      const callModelFn = createCallModel({
        generate: async () => ({
          output: {
            script: HERO_EXPERIMENT_SPEC_RUN_A.files['main.py']!,
            summary: 'Fixed typo in numpy import',
          },
          inputTokens: 100,
          outputTokens: 50,
        }),
        sleep: async () => {},
      })
      const runner: ExperimentRunner = {
        async run() {
          return structuredClone(HERO_RECORDED_RUN_RESULT)
        },
        async cancel() {},
      }

      const result = await repairAndRetryRun(failedRun, {
        runStore,
        runner,
        modelContext: {
          workspaceId: seed.workspaceId,
          strategyId: null,
          store: taskStore,
        },
        callModelFn,
      })

      expect(result.repaired).toBe(true)
      expect(result.finalRun.parentRunId).toBe(parentId)
      expect(result.finalRun.attempt).toBe(2)
      expect(result.finalRun.status).toBe('succeeded')
    } finally {
      await testDb.close()
    }
  })
})
