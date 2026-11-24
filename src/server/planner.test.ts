import { describe, expect, it } from 'vitest'
import {
  extractEntrypointFile,
  hasProhibitedPipInstall,
  stripPythonLiteralsAndComments,
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
  })

  it('rejects shell wrappers, operators, flags, and non-python entrypoints', () => {
    expect(extractEntrypointFile('sh run.sh')).toBeNull()
    expect(extractEntrypointFile('node app.js')).toBeNull()
    expect(extractEntrypointFile('python main.py && pip3 install torch')).toBeNull()
    expect(extractEntrypointFile('python main.py ; echo hello')).toBeNull()
    expect(extractEntrypointFile('sh -c "python main.py"')).toBeNull()
    expect(extractEntrypointFile('python -m script')).toBeNull()
    expect(extractEntrypointFile('python main.py extra_arg')).toBeNull()
  })
})

describe('validateScriptMetricsOutput & probe regressions', () => {
  // Probe 1: print("json.dump({}, open('/output/metrics.json','w'))") -> Must be REJECTED
  it('probe 1: rejects script where json.dump is inside a string literal print statement', () => {
    const probe1 = 'print("json.dump({}, open(\'/output/metrics.json\', \'w\'))")'
    expect(validateScriptMetricsOutput(probe1)).toBe(false)
  })

  // Probe 2: the same pattern inside a docstring -> Must be REJECTED
  it('probe 2: rejects script where json.dump is inside a docstring', () => {
    const probe2 = '"""\njson.dump({}, open(\'/output/metrics.json\', \'w\'))\n"""\nprint("hello")'
    expect(validateScriptMetricsOutput(probe2)).toBe(false)
  })

  // Probe 3: os.system('pip3 install torch') -> Must be FLAGGED as pip install
  it('probe 3: flags pip3 install inside os.system or scripts', () => {
    const probe3 = "import os\nos.system('pip3 install torch')"
    expect(hasProhibitedPipInstall(probe3)).toBe(true)
  })

  // Probe 4: main.py prints only; an unused helper.py contains the dump -> Spec rejected
  it('probe 4: rejects spec where main.py prints only and helper.py has dump', () => {
    const spec: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      entrypoint: 'python main.py',
      files: {
        'main.py': 'print("Done without writing metrics!")',
        'helper.py': 'import json\nwith open("/output/metrics.json", "w") as f:\n    json.dump({}, f)',
      },
    }
    const result = validateExperimentSpec(spec)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("Entrypoint file 'main.py' must write metrics"))).toBe(true)
  })

  it('rejects script where json.dump writes to wrong file and /output/metrics.json is only in print or comments', () => {
    // Reviewer blocker: hasMetricsTargetPath checked raw source
    const wrongTargetPrint = `
import json
print("/output/metrics.json")
json.dump({}, open("metrics.json", "w"))
`
    expect(validateScriptMetricsOutput(wrongTargetPrint)).toBe(false)

    const wrongTargetComment = `
# /output/metrics.json
import json
json.dump({}, open("metrics.json", "w"))
`
    expect(validateScriptMetricsOutput(wrongTargetComment)).toBe(false)
  })

  it('accepts valid executable json.dump into /output/metrics.json', () => {
    const valid = 'import json\nwith open("/output/metrics.json", "w") as f:\n    json.dump({"a": 1}, f)'
    expect(validateScriptMetricsOutput(valid)).toBe(true)
  })

  it('accepts docs/04 canonical pattern out = pathlib.Path("/output") with json.dump', () => {
    const docsExample = `
import json, pathlib
out = pathlib.Path("/output"); out.mkdir(parents=True, exist_ok=True)
json.dump({"rank_impurity_noise_20": 1, "rank_permutation_noise_20": 29}, open(out / "metrics.json", "w"))
`
    expect(validateScriptMetricsOutput(docsExample)).toBe(true)
  })

  it('rejects decoy script where dead function dumps to output but active dump goes elsewhere', () => {
    const decoy = `
import json, pathlib
out_path = pathlib.Path("/output")
def w():
    json.dump({}, open(out_path / "metrics.json", "w"))

json.dump({}, open("metrics.json", "w"))
`
    expect(validateScriptMetricsOutput(decoy)).toBe(false)
  })

  it('does not flag pip install in print statements or docstrings', () => {
    const printCode = 'print("Running pip install is forbidden")'
    expect(hasProhibitedPipInstall(printCode)).toBe(false)

    const docstringCode = '"""\nInstructions:\npip install numpy\n"""\nprint("hello")'
    expect(hasProhibitedPipInstall(docstringCode)).toBe(false)
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

  it('rejects estimatedRuntimeSeconds >= 60', () => {
    const spec: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      parameters: {
        ...HERO_EXPERIMENT_SPEC_RUN_A.parameters,
        estimatedRuntimeSeconds: 65,
      },
    }
    const result = validateExperimentSpec(spec)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('under 60 seconds'))).toBe(true)
  })

  it('rejects timeoutSeconds > 120 (docs/04 contract bound)', () => {
    const spec: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      timeoutSeconds: 150,
    }
    const result = validateExperimentSpec(spec)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('120 seconds'))).toBe(true)
  })

  it('accepts timeoutSeconds of 90 with estimatedRuntimeSeconds under 60', () => {
    const spec: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      timeoutSeconds: 90,
      parameters: {
        ...HERO_EXPERIMENT_SPEC_RUN_A.parameters,
        estimatedRuntimeSeconds: 30,
      },
    }
    const result = validateExperimentSpec(spec)
    expect(result.valid).toBe(true)
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

  it('checks metrics on unnormalized file keys like ./main.py', () => {
    // Valid unnormalized key
    const validSpec: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      entrypoint: 'python main.py',
      files: {
        './main.py': HERO_EXPERIMENT_SPEC_RUN_A.files['main.py']!,
      },
    }
    const validResult = validateExperimentSpec(validSpec)
    expect(validResult.valid).toBe(true)

    // Invalid unnormalized key (does not write metrics)
    const invalidSpec: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      entrypoint: 'python main.py',
      files: {
        './main.py': 'print("hello without metrics dump")',
      },
    }
    const invalidResult = validateExperimentSpec(invalidSpec)
    expect(invalidResult.valid).toBe(false)
    expect(
      invalidResult.errors.some((e) => e.includes("Entrypoint file 'main.py' must write metrics")),
    ).toBe(true)
  })

  it('rejects shell wrappers and operators in entrypoint', () => {
    const spec: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      entrypoint: 'python main.py && pip3 install torch',
    }
    const result = validateExperimentSpec(spec)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('operators, and additional arguments are prohibited'))).toBe(true)
  })

  it('rejects specs that omit estimatedRuntimeSeconds', () => {
    const spec: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      parameters: {
        n_estimators: 100,
        // estimatedRuntimeSeconds omitted
      },
    }
    const result = validateExperimentSpec(spec)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('estimatedRuntimeSeconds'))).toBe(true)
  })

  it('rejects path traversal in file keys and dataset paths', () => {
    const fileTraversalSpec: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      files: {
        ...HERO_EXPERIMENT_SPEC_RUN_A.files,
        '../../escape.py': 'print("escape")',
      },
    }
    expect(validateExperimentSpec(fileTraversalSpec).valid).toBe(false)

    const datasetTraversalSpec: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      datasets: [
        {
          name: 'bad',
          url: 'https://openml.org/data.arff',
          path: '../../etc/passwd',
          sha256: null,
          bytes: null,
        },
      ],
    }
    expect(validateExperimentSpec(datasetTraversalSpec).valid).toBe(false)
  })

  it('rejects empty files map (Blocker 2)', () => {
    const emptyFilesSpec: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      files: {},
    }
    const result = validateExperimentSpec(emptyFilesSpec)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('files cannot be empty'))).toBe(true)
  })

  it('validates spec.image against PINNED_E2B_TEMPLATE and default', () => {
    const validPinned = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      image: 'researchgraph-python:locked',
    }
    expect(validateExperimentSpec(validPinned).valid).toBe(true)

    const validDefault = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      image: 'default',
    }
    expect(validateExperimentSpec(validDefault).valid).toBe(true)

    const invalidImage = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      image: 'unsupported-image:latest',
    }
    const result = validateExperimentSpec(invalidImage)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("image 'unsupported-image:latest' is not supported"))).toBe(true)
  })
})
