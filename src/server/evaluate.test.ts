import { describe, expect, it } from 'vitest'
import {
  evaluateAndExplainExperiment,
  evaluateCheck,
  evaluateExperiment,
} from './evaluate'
import { HERO_EXPERIMENT_SPEC_RUN_A } from '../../fixtures/hero-spec'
import type { ExperimentResult } from '../shared/types'
import type { AgentTaskInsert, AgentTaskStore, CallModel, CallModelResult } from './model'

class MemoryTaskStore implements AgentTaskStore {
  readonly rows: Array<AgentTaskInsert & { id: string }> = []
  async insert(task: AgentTaskInsert) {
    const id = `task-${this.rows.length + 1}`
    this.rows.push({ ...task, id })
    return { id }
  }
}

function mockResult(overrides: Partial<ExperimentResult> = {}): ExperimentResult {
  return {
    exitCode: 0,
    stdout: 'done',
    stderr: '',
    metrics: {
      rank_impurity_noise_20: 3,
      rank_permutation_noise_20: 7,
    },
    artifacts: [],
    durationMs: 1500,
    environment: {
      imageDigest: 'sha256:test',
      python: '3.12.0',
      packages: { 'scikit-learn': '1.9.1', numpy: '2.5.5', pandas: '2.3.4' },
      datasets: [{ name: 'breast-w', sha256: 'abc', bytes: 100 }],
      seeds: [42],
      startedAt: new Date().toISOString(),
    },
    ...overrides,
  }
}

describe('evaluateCheck', () => {
  it('handles standard arithmetic comparison operators', () => {
    expect(evaluateCheck(2, 'lt', 5)).toBe(true)
    expect(evaluateCheck(5, 'lt', 5)).toBe(false)
    expect(evaluateCheck(5, 'lte', 5)).toBe(true)
    expect(evaluateCheck(6, 'gt', 5)).toBe(true)
    expect(evaluateCheck(5, 'gte', 5)).toBe(true)
    expect(evaluateCheck(5, 'eq', 5)).toBe(true)
    expect(evaluateCheck(4, 'neq', 5)).toBe(true)
  })

  it('rejects null, undefined, and non-finite values cleanly', () => {
    expect(evaluateCheck(undefined, 'lte', 5)).toBe(false)
    expect(evaluateCheck(NaN, 'lte', 5)).toBe(false)
    expect(evaluateCheck(Infinity, 'lte', 5)).toBe(false)
  })

  it('handles within tolerance', () => {
    expect(evaluateCheck(5.02, 'within', 5.0, 0.05)).toBe(true)
    expect(evaluateCheck(5.1, 'within', 5.0, 0.05)).toBe(false)
  })
})

describe('evaluateExperiment', () => {
  it('returns failed when exitCode is non-zero', () => {
    const outcome = evaluateExperiment(HERO_EXPERIMENT_SPEC_RUN_A, mockResult({ exitCode: 1 }))
    expect(outcome.verdict).toBe('failed')
    expect(outcome.detail.checks[0]!.passed).toBe(false)
  })

  it('returns match when all checks pass in mode all', () => {
    const outcome = evaluateExperiment(
      HERO_EXPERIMENT_SPEC_RUN_A,
      mockResult({
        metrics: {
          rank_impurity_noise_20: 3,
          rank_permutation_noise_20: 7,
        },
      }),
    )
    expect(outcome.verdict).toBe('match')
    expect(outcome.detail.checks[0]!.passed).toBe(true)
    expect(outcome.detail.checks[1]!.passed).toBe(true)
  })

  it('returns mismatch when check fails', () => {
    const outcome = evaluateExperiment(
      HERO_EXPERIMENT_SPEC_RUN_A,
      mockResult({
        metrics: {
          rank_impurity_noise_20: 25,
          rank_permutation_noise_20: 7,
        },
      }),
    )
    expect(outcome.verdict).toBe('mismatch')
    expect(outcome.detail.checks[0]!.passed).toBe(false)
  })

  it('returns inconclusive when required metric is missing or non-numeric', () => {
    const missingOutcome = evaluateExperiment(
      HERO_EXPERIMENT_SPEC_RUN_A,
      mockResult({ metrics: { rank_impurity_noise_20: 3 } }), // permutation metric missing
    )
    expect(missingOutcome.verdict).toBe('inconclusive')
    expect(missingOutcome.detail.checks[1]!.measured).toBeNull()

    const nonNumericOutcome = evaluateExperiment(
      HERO_EXPERIMENT_SPEC_RUN_A,
      mockResult({
        metrics: {
          rank_impurity_noise_20: 3,
          rank_permutation_noise_20: null as any,
        },
      }),
    )
    expect(nonNumericOutcome.verdict).toBe('inconclusive')
  })

  it('proves all 4 verdicts are reachable in deterministic code', () => {
    const v1 = evaluateExperiment(HERO_EXPERIMENT_SPEC_RUN_A, mockResult({ exitCode: 137 })).verdict
    const v2 = evaluateExperiment(HERO_EXPERIMENT_SPEC_RUN_A, mockResult({ metrics: {} })).verdict
    const v3 = evaluateExperiment(
      HERO_EXPERIMENT_SPEC_RUN_A,
      mockResult({ metrics: { rank_impurity_noise_20: 1, rank_permutation_noise_20: 6 } }),
    ).verdict
    const v4 = evaluateExperiment(
      HERO_EXPERIMENT_SPEC_RUN_A,
      mockResult({ metrics: { rank_impurity_noise_20: 25, rank_permutation_noise_20: 1 } }),
    ).verdict

    expect(v1).toBe('failed')
    expect(v2).toBe('inconclusive')
    expect(v3).toBe('match')
    expect(v4).toBe('mismatch')
  })
})

describe('evaluateAndExplainExperiment (Stage 7 with explain_gap model call)', () => {
  it('calls model with taskKind: explain_gap and does not allow model to change verdict', async () => {
    const store = new MemoryTaskStore()
    const ctx = {
      workspaceId: 'ws-123',
      taskKind: 'explain_gap' as const,
      store,
    }

    const fakeCallModel: CallModel = async (_schema, prompt, callCtx) => {
      expect(callCtx.taskKind).toBe('explain_gap')
      expect(prompt).toContain('Verdict: mismatch')
      return {
        output: {
          explanation:
            'Gini impurity importance placed the noise feature at rank 25, which failed the threshold of 10. Permutation importance correctly mitigated the bias.',
        },
        attempts: [],
      } as unknown as CallModelResult<any>
    }

    const outcome = await evaluateAndExplainExperiment(
      HERO_EXPERIMENT_SPEC_RUN_A,
      mockResult({
        metrics: {
          rank_impurity_noise_20: 25,
          rank_permutation_noise_20: 7,
        },
      }),
      ctx,
      { callModelFn: fakeCallModel },
    )

    expect(outcome.verdict).toBe('mismatch')
    expect(outcome.detail.explanation).toContain('Gini impurity importance')
  })
})
