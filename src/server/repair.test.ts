import { describe, expect, it } from 'vitest'
import { HERO_EXPERIMENT_SPEC_RUN_A, HERO_RECORDED_RUN_RESULT } from '../../fixtures/hero-spec'
import type { ExperimentResult, ExperimentSpec } from '../shared/types'
import {
  MAX_REPAIR_ATTEMPTS,
  REPAIR_STDERR_TAIL_CHARS,
  isAutoApprovableRepair,
  repairAndRetryRun,
  type NewRepairRunRecord,
  type RepairRunRecord,
  type RepairRunStore,
  type RepairRunUpdate,
} from './branch'
import {
  createCallModel,
  type AgentTaskInsert,
  type AgentTaskStore,
  type StructuredGenerator,
} from './model'
import type { ExperimentRunner } from './runner'

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
    })

    expect(result.repaired).toBe(false)
    expect(result.status).toBe('awaiting_approval')
    expect(result.attemptsUsed).toBe(0)
    expect(result.candidateSpec).toBeDefined()
    expect(runnerCalled).toBe(false)
  })
})
