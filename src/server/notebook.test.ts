import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  HERO_EXPERIMENT_SPEC_RUN_A,
  HERO_RECORDED_RUN_RESULT,
} from '../../fixtures/hero-spec'
import { buildNotebookArtifact, buildNotebookDocument } from './notebook'

const HERO_CLAIM = {
  text: 'Gini importance favours high-cardinality features; permutation does not',
  quote:
    'A variable with more categories has a higher probability to be selected in individual splits purely by chance. Consequently, impurity-based variable importance measures (Gini importance) are severely biased towards variables with many categories, even when they carry no actual information about the response.',
  page: 4,
  reported: null,
}

const NbformatCellIdSchema = z.string().regex(/^[a-zA-Z0-9-_]{1,64}$/)

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
  it('produces a valid nbformat v4.5 document with all 6 required cells for the hero spec', () => {
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
    expect(nb.cells).toHaveLength(6)
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
    expect(dsSrc).toContain('hashlib.sha256')
    expect(dsSrc).toContain('SHA-256 mismatch')

    // Cell 4: Code - verbatim script
    const cell4 = nb.cells[3]!
    expect(cell4.id).toBe('cell-4-script')
    expect(cell4.cell_type).toBe('code')
    expect(cell4.source.join('')).toBe(HERO_EXPERIMENT_SPEC_RUN_A.files['main.py'])

    // Cell 5: Code - metrics display
    const cell5 = nb.cells[4]!
    expect(cell5.id).toBe('cell-5-metrics')
    expect(cell5.cell_type).toBe('code')
    const metricsSrc = cell5.source.join('')
    expect(metricsSrc).toContain('/output/metrics.json')
    expect(metricsSrc).toContain('json.load')

    // Cell 6: Markdown - criteria and pass/fail semantics
    const cell6 = nb.cells[5]!
    expect(cell6.id).toBe('cell-6-criteria')
    expect(cell6.cell_type).toBe('markdown')
    const md6 = cell6.source.join('')
    expect(md6).toContain('rank_impurity_noise_20')
    expect(md6).toContain('rank_permutation_noise_20')
    expect(md6).toContain('match')
    expect(md6).toContain('mismatch')
    expect(md6).toContain('inconclusive')
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

    // 6 default cells + 2 auxiliary files = 8 cells
    expect(nb.cells).toHaveLength(8)

    const auxCell1 = nb.cells.find((c) => c.id.startsWith('cell-aux-utils_helpers'))
    expect(auxCell1).toBeDefined()
    expect(auxCell1!.cell_type).toBe('code')
    expect(auxCell1!.id.length).toBeLessThanOrEqual(64)
    expect(auxCell1!.source.join('')).toContain('target_path = pathlib.Path("utils/helpers.py")')

    const auxCell2 = nb.cells.find((c) => c.id.startsWith('cell-aux-extremely_long_nested_path'))
    expect(auxCell2).toBeDefined()
    expect(auxCell2!.id.length).toBeLessThanOrEqual(64)
  })

  it('validates against the nbformat v4.5 schema, excludes pip/setuptools/wheel, and omits unknown python version', () => {
    const nb = buildNotebookDocument({
      spec: HERO_EXPERIMENT_SPEC_RUN_A,
      environment: {
        python: 'unknown',
        packages: {
          ...HERO_RECORDED_RUN_RESULT.environment.packages,
          pip: '24.3.1',
          setuptools: '75.1.0',
          wheel: '0.44.0',
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
    expect(pipSrc).toContain('"numpy==2.5.5"')
  })
})
