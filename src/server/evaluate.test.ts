import { describe, expect, it } from 'vitest'
import { evaluateCheck, evaluateExperiment } from './evaluate'
import { HERO_EXPERIMENT_SPEC_RUN_A } from './planner'
import type { ExperimentResult } from '../shared/types'

function mockResult(overrides: Partial<ExperimentResult> = {}): ExperimentResult {
  return {
    exitCode: 0,
    stdout: 'done',
    stderr: '',
    metrics: {
      rank_impurity_noise_20: 1,
    },
    artifacts: [],
    durationMs: 1500,
    environment: {
      imageDigest: 'sha256:test',
      python: '3.12.0',
      packages: { 'scikit-learn': '1.9.1' },
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
      mockResult({ metrics: { rank_impurity_noise_20: 3 } }),
    )
    expect(outcome.verdict).toBe('match')
    expect(outcome.detail.checks[0]!.passed).toBe(true)
    expect(outcome.detail.checks[0]!.measured).toBe(3)
  })

  it('returns mismatch when check fails', () => {
    const outcome = evaluateExperiment(
      HERO_EXPERIMENT_SPEC_RUN_A,
      mockResult({ metrics: { rank_impurity_noise_20: 12 } }),
    )
    expect(outcome.verdict).toBe('mismatch')
    expect(outcome.detail.checks[0]!.passed).toBe(false)
    expect(outcome.detail.checks[0]!.measured).toBe(12)
  })

  it('returns inconclusive when required metric is missing from metrics', () => {
    const outcome = evaluateExperiment(
      HERO_EXPERIMENT_SPEC_RUN_A,
      mockResult({ metrics: { other_metric: 42 } }),
    )
    expect(outcome.verdict).toBe('inconclusive')
    expect(outcome.detail.checks[0]!.measured).toBeNull()
  })

  it('proves all 4 verdicts are reachable in deterministic code', () => {
    const v1 = evaluateExperiment(HERO_EXPERIMENT_SPEC_RUN_A, mockResult({ exitCode: 137 })).verdict
    const v2 = evaluateExperiment(HERO_EXPERIMENT_SPEC_RUN_A, mockResult({ metrics: {} })).verdict
    const v3 = evaluateExperiment(HERO_EXPERIMENT_SPEC_RUN_A, mockResult({ metrics: { rank_impurity_noise_20: 1 } })).verdict
    const v4 = evaluateExperiment(HERO_EXPERIMENT_SPEC_RUN_A, mockResult({ metrics: { rank_impurity_noise_20: 25 } })).verdict

    expect(v1).toBe('failed')
    expect(v2).toBe('inconclusive')
    expect(v3).toBe('match')
    expect(v4).toBe('mismatch')
  })
})
