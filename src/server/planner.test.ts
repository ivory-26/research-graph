import { describe, expect, it } from 'vitest'
import {
  HERO_EXPERIMENT_SPEC_RUN_A,
  extractEntrypointFile,
  validateExperimentSpec,
} from './planner'
import type { ExperimentSpec } from '../shared/types'

describe('extractEntrypointFile', () => {
  it('extracts script name from python invocation', () => {
    expect(extractEntrypointFile('python main.py')).toBe('main.py')
    expect(extractEntrypointFile('python3 run_experiment.py')).toBe('run_experiment.py')
    expect(extractEntrypointFile('main.py')).toBe('main.py')
  })
})

describe('validateExperimentSpec', () => {
  it('accepts the hand-written hero spec', () => {
    const result = validateExperimentSpec(HERO_EXPERIMENT_SPEC_RUN_A)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects a spec with mode exact', () => {
    const spec: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      mode: 'exact',
    }
    const result = validateExperimentSpec(spec)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("mode cannot be 'exact'"))).toBe(true)
  })

  it('rejects entrypoint missing from files', () => {
    const spec: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      entrypoint: 'python missing.py',
    }
    const result = validateExperimentSpec(spec)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("references file 'missing.py'"))).toBe(true)
  })

  it('rejects script containing pip install', () => {
    const spec: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      files: {
        'main.py': `import os\nos.system('pip install torch')\nimport json\nwith open('/output/metrics.json', 'w') as f: json.dump({}, f)`,
      },
    }
    const result = validateExperimentSpec(spec)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('pip install'))).toBe(true)
  })

  it('rejects script that does not write to /output/metrics.json', () => {
    const spec: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      files: {
        'main.py': `print('Done!')`,
      },
    }
    const result = validateExperimentSpec(spec)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('/output/metrics.json'))).toBe(true)
  })

  it('rejects unresolvable or invalid dataset URLs', () => {
    const spec: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      datasets: [
        {
          name: 'invalid',
          url: 'ftp://not-allowed.org',
          path: 'data/invalid.csv',
          sha256: null,
          bytes: null,
        },
      ],
    }
    const result = validateExperimentSpec(spec)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('http or https'))).toBe(true)
  })

  it('rejects timeoutSeconds exceeding limit', () => {
    const spec: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      timeoutSeconds: 200,
    }
    const result = validateExperimentSpec(spec)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('120 seconds'))).toBe(true)
  })
})
