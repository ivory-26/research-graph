import { describe, expect, it } from 'vitest'
import {
  extractEntrypointFile,
  stripPythonComments,
  validateExperimentSpec,
  validateScriptMetricsOutput,
} from './planner'
import { HERO_EXPERIMENT_SPEC_RUN_A } from '../../fixtures/hero-spec'
import type { ExperimentSpec } from '../shared/types'

describe('extractEntrypointFile', () => {
  it('extracts script name from python invocation only', () => {
    expect(extractEntrypointFile('python main.py')).toBe('main.py')
    expect(extractEntrypointFile('python3 run_experiment.py')).toBe('run_experiment.py')
    expect(extractEntrypointFile('main.py')).toBe('main.py')
    // Rejects non-python arbitrary command
    expect(extractEntrypointFile('sh run.sh')).toBeNull()
    expect(extractEntrypointFile('node app.js')).toBeNull()
  })
})

describe('validateScriptMetricsOutput & stripPythonComments', () => {
  it('rejects a script where metrics.json or /output is only in a comment', () => {
    const fakeScript = `
# This comment mentions /output/metrics.json
# and json.dump(metrics, f)
print("Done without writing metrics!")
`
    expect(stripPythonComments(fakeScript)).not.toContain('/output/metrics.json')
    expect(validateScriptMetricsOutput(fakeScript)).toBe(false)
  })

  it('accepts executable code that calls json.dump into /output/metrics.json', () => {
    const validScript = `
import json, pathlib
out = pathlib.Path("/output")
with open(out / "metrics.json", "w") as f:
    json.dump({"accuracy": 0.95}, f)
`
    expect(validateScriptMetricsOutput(validScript)).toBe(true)
  })
})

describe('validateExperimentSpec', () => {
  it('accepts the hand-written hero spec test fixture', () => {
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

  it('rejects script containing pip install in executable code', () => {
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

  it('rejects script that does not write to /output/metrics.json via json.dump', () => {
    const spec: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      files: {
        'main.py': `print('Done!')`,
      },
    }
    const result = validateExperimentSpec(spec)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('Script must write metrics as json.dump to /output/metrics.json'))).toBe(true)
  })

  it('rejects timeoutSeconds exceeding 60 seconds (Issue #23 rule)', () => {
    const spec: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      timeoutSeconds: 61,
    }
    const result = validateExperimentSpec(spec)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('60 seconds'))).toBe(true)
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
})
