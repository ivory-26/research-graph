import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  HERO_EXPERIMENT_SPEC_RUN_A,
  HERO_RECORDED_RUN_RESULT,
} from '../../fixtures/hero-spec'
import type { Database } from '../db/client'
import {
  buildNotebookArtifact,
  buildNotebookDocument,
  saveNotebookArtifact,
} from './notebook'
import { ALLOWED_DATASET_DOMAINS, MAX_DATASET_BYTES } from './runner'

/** The notebook's script cells are Python; execute them when an interpreter exists. */
function findPython(): string | null {
  for (const candidate of ['python3', 'python']) {
    if (spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0) {
      return candidate
    }
  }
  return null
}

const PYTHON = findPython()

const HERO_CLAIM = {
  text: 'Gini importance favours high-cardinality features; permutation does not',
  quote:
    'A variable with more categories has a higher probability to be selected in individual splits purely by chance. Consequently, impurity-based variable importance measures (Gini importance) are severely biased towards variables with many categories, even when they carry no actual information about the response.',
  page: 4,
  reported: null,
}

const NbformatCellIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/)

const NbformatV45Schema = z.object({
  nbformat: z.literal(4),
  nbformat_minor: z.literal(5),
  metadata: z.object({
    kernelspec: z.object({
      display_name: z.string(),
      language: z.string(),
      name: z.string(),
    }),
    language_info: z.object({
      name: z.literal('python'),
      version: z.string().optional(),
    }),
  }),
  cells: z.array(
    z.discriminatedUnion('cell_type', [
      z.object({
        cell_type: z.literal('markdown'),
        id: NbformatCellIdSchema,
        metadata: z.record(z.string(), z.unknown()),
        source: z.array(z.string()),
      }),
      z.object({
        cell_type: z.literal('code'),
        id: NbformatCellIdSchema,
        execution_count: z.null(),
        metadata: z.record(z.string(), z.unknown()),
        outputs: z.array(z.unknown()),
        source: z.array(z.string()),
      }),
    ]),
  ),
})

describe('buildNotebookDocument (Issue #28)', () => {
  it('names the supported template so the record does not claim a dataset reproduction', () => {
    const label =
      'Random forest variable importance — fixed adapted breast-w protocol (not the claim\'s original dataset)'
    const nb = buildNotebookDocument({
      spec: HERO_EXPERIMENT_SPEC_RUN_A,
      environment: HERO_RECORDED_RUN_RESULT.environment,
      claim: HERO_CLAIM,
      verdict: 'match',
      templateLabel: label,
    })

    const metadata = nb.cells[0]!.source.join('')
    expect(metadata).toContain(`- **Experiment:** ${label}`)
    expect(metadata.indexOf('- **Mode:**')).toBeLessThan(
      metadata.indexOf('- **Experiment:**'),
    )
    expect(metadata.indexOf('- **Experiment:**')).toBeLessThan(
      metadata.indexOf('- **Verdict:**'),
    )

    // Absent the label, the line is omitted rather than rendered empty.
    const withoutLabel = buildNotebookDocument({
      spec: HERO_EXPERIMENT_SPEC_RUN_A,
      claim: HERO_CLAIM,
      verdict: 'match',
    })
    expect(withoutLabel.cells[0]!.source.join('')).not.toContain('- **Experiment:**')
  })

  it('produces a valid nbformat v4.5 document with all 7 required cells for the hero spec', () => {
    const nb = buildNotebookDocument({
      spec: HERO_EXPERIMENT_SPEC_RUN_A,
      environment: HERO_RECORDED_RUN_RESULT.environment,
      paperTitle:
        'Bias in random forest variable importance measures: Illustrations, sources and a solution',
      doi: '10.1186/1471-2105-8-25',
      claim: HERO_CLAIM,
      verdict: 'match',
    })

    expect(nb.nbformat).toBe(4)
    expect(nb.nbformat_minor).toBe(5)
    expect(nb.metadata.kernelspec.name).toBe('python3')
    expect(nb.metadata.language_info.version).toBe('3.12.16')
    expect(nb.cells).toHaveLength(7)
    const cellIds = nb.cells.map((c) => c.id)
    expect(new Set(cellIds).size).toBe(cellIds.length)
    for (const cell of nb.cells) {
      expect(cell.id).toBeDefined()
      expect(typeof cell.id).toBe('string')
      expect(cell.id.length).toBeGreaterThan(0)
    }

    // Cell 1: Markdown metadata
    const cell1 = nb.cells[0]!
    expect(cell1.id).toBe('cell-1-metadata')
    expect(cell1.cell_type).toBe('markdown')
    const md1 = cell1.source.join('')
    expect(md1).toContain('10.1186/1471-2105-8-25')
    expect(md1).toContain(HERO_CLAIM.quote)
    expect(md1).toContain('`adapted`')
    expect(md1).toContain('`match`')
    expect(md1).toContain('qualitative')

    // Cell 2: Code - pinned pip installs
    const cell2 = nb.cells[1]!
    expect(cell2.id).toBe('cell-2-dependencies')
    expect(cell2.cell_type).toBe('code')
    const pipSrc = cell2.source.join('')
    expect(pipSrc).toContain('!pip install -q')
    expect(pipSrc).toContain('"numpy==2.5.5"')
    expect(pipSrc).toContain('"scikit-learn==1.9.1"')

    // Cell 3: Code - dataset download + sha256 verification
    const cell3 = nb.cells[2]!
    expect(cell3.id).toBe('cell-3-dataset')
    expect(cell3.cell_type).toBe('code')
    const dsSrc = cell3.source.join('')
    expect(dsSrc).toContain(HERO_EXPERIMENT_SPEC_RUN_A.datasets[0]!.url)
    expect(dsSrc).toContain(HERO_EXPERIMENT_SPEC_RUN_A.datasets[0]!.sha256!)
    expect(dsSrc).toContain('ALLOWED_DATASET_DOMAINS')
    expect(dsSrc).toContain('SafeDatasetRedirectHandler')
    expect(dsSrc).toContain('hashlib.sha256')
    expect(dsSrc).toContain('SHA-256 mismatch')

    // Cell 4: Code - frozen parameters for the verbatim script
    const cell4 = nb.cells[3]!
    expect(cell4.id).toBe('cell-4-parameters')
    expect(cell4.cell_type).toBe('code')
    const paramsSrc = cell4.source.join('')
    expect(paramsSrc).toContain('RESEARCHGRAPH_PARAMETERS')
    expect(paramsSrc).toContain(
      JSON.stringify(JSON.stringify(HERO_EXPERIMENT_SPEC_RUN_A.parameters)),
    )

    // Cell 5: Code - verbatim script
    const cell5 = nb.cells[4]!
    expect(cell5.id).toBe('cell-5-script')
    expect(cell5.cell_type).toBe('code')
    expect(cell5.source.join('')).toBe(HERO_EXPERIMENT_SPEC_RUN_A.files['main.py'])

    // Cell 6: Code - metrics display
    const cell6 = nb.cells[5]!
    expect(cell6.id).toBe('cell-6-metrics')
    expect(cell6.cell_type).toBe('code')
    const metricsSrc = cell6.source.join('')
    expect(metricsSrc).toContain('/output/metrics.json')
    expect(metricsSrc).toContain('json.load')

    // Cell 7: Markdown - criteria and pass/fail semantics
    const cell7 = nb.cells[6]!
    expect(cell7.id).toBe('cell-7-criteria')
    expect(cell7.cell_type).toBe('markdown')
    const md6 = cell7.source.join('')
    expect(md6).toContain('rank_impurity_noise_20')
    expect(md6).toContain('rank_permutation_noise_20')
    expect(md6).toContain('match')
    expect(md6).toContain('mismatch')
    expect(md6).toContain('inconclusive')
  })

  it('preserves CRLF line endings in spec scripts verbatim', () => {
    const crlfSpec = structuredClone(HERO_EXPERIMENT_SPEC_RUN_A)
    crlfSpec.files['main.py'] = 'import os\r\nprint("hello")\r\n'

    const nb = buildNotebookDocument({
      spec: crlfSpec,
      environment: HERO_RECORDED_RUN_RESULT.environment,
      claim: HERO_CLAIM,
      verdict: 'match',
    })

    const scriptCell = nb.cells[4]!
    expect(scriptCell.source.join('')).toBe('import os\r\nprint("hello")\r\n')
    expect(scriptCell.source).toEqual(['import os\r\n', 'print("hello")\r\n'])
  })

  it('preserves lone CR line endings without dropping lines or text', () => {
    const crSpec = structuredClone(HERO_EXPERIMENT_SPEC_RUN_A)
    crSpec.files['main.py'] = 'line1\rline2\r'

    const nb = buildNotebookDocument({
      spec: crSpec,
      environment: HERO_RECORDED_RUN_RESULT.environment,
      claim: HERO_CLAIM,
      verdict: 'match',
    })

    const scriptCell = nb.cells[4]!
    expect(scriptCell.source.join('')).toBe('line1\rline2\r')
    expect(scriptCell.source).toEqual(['line1\r', 'line2\r'])
  })

  it('builds a run_artifacts notebook payload with accurate sha256 and byte length', () => {
    const artifact = buildNotebookArtifact({
      spec: HERO_EXPERIMENT_SPEC_RUN_A,
      environment: HERO_RECORDED_RUN_RESULT.environment,
      paperTitle: 'Strobl et al. (2007)',
      doi: '10.1186/1471-2105-8-25',
      claim: {
        ...HERO_CLAIM,
        reported: {
          metric: 'rank_impurity_noise_20',
          value: 2, // distinct from measured value (4) to assert honest separation
          comparator: 'lt',
          against: 5,
          quote: HERO_CLAIM.quote,
        },
      },
      verdict: 'match',
    })

    expect(artifact.kind).toBe('notebook')
    expect(artifact.path).toBe('reproducibility-record.ipynb')
    expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(artifact.bytes).toBe(Buffer.byteLength(artifact.content, 'utf8'))

    const parsed = JSON.parse(artifact.content)
    expect(parsed.nbformat).toBe(4)
    expect(parsed.cells[0].source.join('')).toContain('`rank_impurity_noise_20` = 2 (< 5)')
  })

  it('throws if the entrypoint file is missing from spec.files', () => {
    const brokenSpec = structuredClone(HERO_EXPERIMENT_SPEC_RUN_A)
    delete brokenSpec.files['main.py']

    expect(() =>
      buildNotebookDocument({
        spec: brokenSpec,
        environment: HERO_RECORDED_RUN_RESULT.environment,
        claim: HERO_CLAIM,
      }),
    ).toThrow(/not found in ExperimentSpec\.files/)
  })

  it('supports multi-file specs by generating bounded-id auxiliary write cells before entrypoint', () => {
    const multiFileSpec = structuredClone(HERO_EXPERIMENT_SPEC_RUN_A)
    multiFileSpec.files['utils/helpers.py'] = 'def add(a, b):\n    return a + b\n'
    multiFileSpec.files['extremely/long/nested/path/to/some/deeply/nested/custom_module.py'] = '# module\n'

    const nb = buildNotebookDocument({
      spec: multiFileSpec,
      environment: HERO_RECORDED_RUN_RESULT.environment,
      claim: HERO_CLAIM,
      verdict: 'match',
    })

    // 7 default cells + 2 auxiliary files = 9 cells
    expect(nb.cells).toHaveLength(9)

    const auxCell1 = nb.cells.find((c) => c.id.startsWith('cell-aux-utils_helpers'))
    expect(auxCell1).toBeDefined()
    expect(auxCell1!.cell_type).toBe('code')
    expect(auxCell1!.id.length).toBeLessThanOrEqual(64)
    expect(auxCell1!.source.join('')).toContain('target_path = pathlib.Path("utils/helpers.py")')

    const auxCell2 = nb.cells.find((c) => c.id.startsWith('cell-aux-extremely_long_nested_path'))
    expect(auxCell2).toBeDefined()
    expect(auxCell2!.id.length).toBeLessThanOrEqual(64)
  })

  it('escapes newline-bearing auxiliary file keys so they cannot inject executable lines', () => {
    const evilSpec = structuredClone(HERO_EXPERIMENT_SPEC_RUN_A)
    evilSpec.files['utils/evil.py\nimport os; os.system("echo injected")'] = 'x = 1\n'

    const nb = buildNotebookDocument({
      spec: evilSpec,
      environment: HERO_RECORDED_RUN_RESULT.environment,
      claim: HERO_CLAIM,
      verdict: 'match',
    })

    const auxCell = nb.cells.find((c) => c.id.startsWith('cell-aux-'))
    expect(auxCell).toBeDefined()

    // A newline in the key must not become an executable statement: it is
    // JSON-escaped inside the comment, never emitted as a raw line break.
    const joined = auxCell!.source.join('')
    expect(joined).not.toContain('\nimport os; os.system')
  })

  it('validates against the nbformat v4.5 schema, excludes pip/setuptools/wheel, notes unknown versions, and omits unknown python version', () => {
    const nb = buildNotebookDocument({
      spec: HERO_EXPERIMENT_SPEC_RUN_A,
      environment: {
        python: 'unknown',
        packages: {
          ...HERO_RECORDED_RUN_RESULT.environment.packages,
          pip: '24.3.1',
          setuptools: '75.1.0',
          wheel: '0.44.0',
          mystery_pkg: 'unknown',
        },
      },
      claim: HERO_CLAIM,
      verdict: 'match',
    })

    const parsed = NbformatV45Schema.parse(nb)
    expect(parsed.metadata.language_info.version).toBeUndefined()

    const pipSrc = parsed.cells[1]!.source.join('')
    expect(pipSrc).not.toContain('"pip==')
    expect(pipSrc).not.toContain('"setuptools==')
    expect(pipSrc).not.toContain('"wheel==')
    expect(pipSrc).toContain('# Note: omitted packages with unknown version: mystery_pkg')
    expect(pipSrc).toContain('"numpy==2.5.5"')
  })

  it.skipIf(PYTHON === null)(
    'executes the generated parameter cell and verbatim script for both parameter values',
    () => {
      for (const method of ['impurity', 'permutation'] as const) {
        const spec = structuredClone(HERO_EXPERIMENT_SPEC_RUN_A)
        spec.parameters = { importance_method: method, seed: 42 }
        spec.datasets = []
        spec.files['main.py'] = [
          'import json, os',
          'parameters = json.loads(os.environ["RESEARCHGRAPH_PARAMETERS"])',
          `assert parameters["importance_method"] == ${JSON.stringify(method)}`,
          'assert parameters["seed"] == 42',
          'print(parameters["importance_method"])',
        ].join('\n')

        const nb = buildNotebookDocument({ spec, claim: HERO_CLAIM })
        const parameterCell = nb.cells.find(
          (cell) => cell.id === 'cell-4-parameters',
        )
        const scriptCell = nb.cells.find((cell) => cell.id === 'cell-5-script')
        expect(parameterCell?.cell_type).toBe('code')
        expect(scriptCell?.cell_type).toBe('code')

        const code =
          parameterCell!.source.join('') + '\n' + scriptCell!.source.join('')
        const result = spawnSync(PYTHON!, ['-I', '-c', code], {
          encoding: 'utf8',
        })

        expect(result.status, result.stderr).toBe(0)
        expect(result.stdout.trim()).toBe(method)
      }
    },
  )

  it('builds a specification-preview notebook with no environment (no install cell, 6 cells)', () => {
    const nb = buildNotebookDocument({
      spec: HERO_EXPERIMENT_SPEC_RUN_A,
      claim: HERO_CLAIM,
    })

    // No environment.packages means no install cell: metadata, dataset,
    // parameters, script, metrics, criteria = 6 cells.
    expect(nb.cells).toHaveLength(6)
    expect(nb.cells.map((c) => c.id)).toEqual([
      'cell-1-metadata',
      'cell-3-dataset',
      'cell-4-parameters',
      'cell-5-script',
      'cell-6-metrics',
      'cell-7-criteria',
    ])
    const cellIds = nb.cells.map((c) => c.id)
    expect(new Set(cellIds).size).toBe(cellIds.length)

    // No recorded python version is emitted.
    expect(nb.metadata.language_info.version).toBeUndefined()

    // The metadata cell records this as a preview, not an evaluated run.
    const md1 = nb.cells[0]!.source.join('')
    expect(md1).toContain('not evaluated (specification preview)')

    // The dataset cell (now at index 1) still verifies against the spec's
    // recorded sha256.
    const dsSrc = nb.cells[1]!.source.join('')
    expect(dsSrc).toContain(HERO_EXPERIMENT_SPEC_RUN_A.datasets[0]!.sha256!)
  })

  it('uses recorded dataset sha256 from environment when spec dataset sha256 is unpinned', () => {
    const unpinnedSpec = structuredClone(HERO_EXPERIMENT_SPEC_RUN_A)
    unpinnedSpec.datasets[0]!.sha256 = null

    const nb = buildNotebookDocument({
      spec: unpinnedSpec,
      environment: HERO_RECORDED_RUN_RESULT.environment,
      claim: HERO_CLAIM,
      verdict: 'match',
    })

    const dsSrc = nb.cells[2]!.source.join('')
    expect(dsSrc).toContain(HERO_RECORDED_RUN_RESULT.environment.datasets[0]!.sha256)
  })

  it('installs full pinned packages from environment.packages per docs/04:243 excluding tooling and unknown versions', () => {
    const nb = buildNotebookDocument({
      spec: HERO_EXPERIMENT_SPEC_RUN_A,
      environment: {
        ...HERO_RECORDED_RUN_RESULT.environment,
        packages: {
          ...HERO_RECORDED_RUN_RESULT.environment.packages,
          joblib: '1.4.2',
          threadpoolctl: '3.5.0',
          flask: '3.0.0',
          pip: '24.0',
        },
      },
      claim: HERO_CLAIM,
      verdict: 'match',
    })

    const pipSrc = nb.cells[1]!.source.join('')
    expect(pipSrc).toContain('"numpy==2.5.5"')
    expect(pipSrc).toContain('"pandas==2.3.3"')
    expect(pipSrc).toContain('"scikit-learn==1.9.1"')
    expect(pipSrc).toContain('"scipy==1.17.1"')
    expect(pipSrc).toContain('"joblib==1.4.2"')
    expect(pipSrc).toContain('"threadpoolctl==3.5.0"')
    expect(pipSrc).toContain('"flask==3.0.0"')
    expect(pipSrc).not.toContain('"pip==')
  })

  it('validates subdomain allowlist and SSRF/redirect guards in cell 3 dataset download', () => {
    const nb = buildNotebookDocument({
      spec: HERO_EXPERIMENT_SPEC_RUN_A,
      environment: HERO_RECORDED_RUN_RESULT.environment,
      claim: HERO_CLAIM,
      verdict: 'match',
    })

    const dsSrc = nb.cells[2]!.source.join('')
    expect(dsSrc).toContain('validate_dataset_url')
    expect(dsSrc).toContain('ipaddress.ip_address')
    expect(dsSrc).toContain('host.endswith("." + d)')
    expect(dsSrc).toContain('max_redirects=3')
    expect(dsSrc).toContain(`MAX_DOWNLOAD_BYTES = ${MAX_DATASET_BYTES}`)
    for (const domain of ALLOWED_DATASET_DOMAINS) {
      expect(dsSrc).toContain(`"${domain}"`)
    }
  })

  it('fails loudly in dataset download cell when a dataset has no sha256 in spec or environment', () => {
    const unpinnedSpec = structuredClone(HERO_EXPERIMENT_SPEC_RUN_A)
    unpinnedSpec.datasets = [
      {
        name: 'unpinned-data',
        url: 'https://openml.org/data/test.csv',
        path: 'data/test.csv',
        sha256: null,
        bytes: 1024,
      },
    ]

    const nb = buildNotebookDocument({
      spec: unpinnedSpec,
      environment: { ...HERO_RECORDED_RUN_RESULT.environment, datasets: [] },
      claim: HERO_CLAIM,
      verdict: 'match',
    })

    const dsSrc = nb.cells[2]!.source.join('')
    expect(dsSrc).toContain('raise ValueError(f"Unpinned dataset {ds[\'name\']}: no SHA-256 digest recorded in spec or environment")')
  })

  it('renders reported.against even when reported.comparator is null', () => {
    const nb = buildNotebookDocument({
      spec: HERO_EXPERIMENT_SPEC_RUN_A,
      environment: HERO_RECORDED_RUN_RESULT.environment,
      claim: {
        ...HERO_CLAIM,
        reported: {
          metric: 'rank_impurity_noise_20',
          value: 2,
          comparator: null,
          against: 5,
          quote: HERO_CLAIM.quote,
        },
      },
      verdict: 'match',
    })

    const md1 = nb.cells[0]!.source.join('')
    expect(md1).toContain('`rank_impurity_noise_20` = 2 (against 5)')
  })

  it('persists notebook artifact via saveNotebookArtifact and throws if insert returns no row', async () => {
    const inserted: Array<Record<string, unknown>> = []
    let shouldReturn = true
    const fakeDb = {
      insert() {
        return {
          values(vals: Record<string, unknown>) {
            inserted.push(vals)
            return {
              async returning() {
                return shouldReturn ? [{ id: 'artifact-nb-1' }] : []
              },
            }
          },
        }
      },
    } as unknown as Pick<Database, 'insert'>

    const saved = await saveNotebookArtifact(fakeDb, 'run-1', {
      spec: HERO_EXPERIMENT_SPEC_RUN_A,
      environment: HERO_RECORDED_RUN_RESULT.environment,
      claim: HERO_CLAIM,
      verdict: 'match',
    })

    expect(saved.id).toBe('artifact-nb-1')
    expect(saved.kind).toBe('notebook')
    expect(saved.path).toBe('reproducibility-record.ipynb')
    expect(inserted[0]).toMatchObject({
      runId: 'run-1',
      kind: 'notebook',
      path: 'reproducibility-record.ipynb',
      sha256: saved.sha256,
      bytes: saved.bytes,
    })

    shouldReturn = false
    await expect(
      saveNotebookArtifact(fakeDb, 'run-1', {
        spec: HERO_EXPERIMENT_SPEC_RUN_A,
        environment: HERO_RECORDED_RUN_RESULT.environment,
        claim: HERO_CLAIM,
      }),
    ).rejects.toThrow('run_artifacts insert returned no row')
  })
})
