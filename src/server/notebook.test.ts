import { describe, expect, it } from 'vitest'
import {
  HERO_EXPERIMENT_SPEC_RUN_A,
  HERO_RECORDED_RUN_RESULT,
} from '../../fixtures/hero-spec'
import { buildNotebookArtifact, buildNotebookDocument } from './notebook'

const HERO_CLAIM = {
  text: 'Gini impurity importance is biased toward high-cardinality variables, whereas permutation importance does not show this bias.',
  quote:
    'Random forest variable importance measures based on Gini impurity are biased in favor of variables with many categories.',
  page: 1,
  reported: null,
}

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

    // Cell 1: Markdown metadata
    const cell1 = nb.cells[0]!
    expect(cell1.cell_type).toBe('markdown')
    const md1 = cell1.source.join('')
    expect(md1).toContain('10.1186/1471-2105-8-25')
    expect(md1).toContain(HERO_CLAIM.quote)
    expect(md1).toContain('`adapted`')
    expect(md1).toContain('`match`')
    expect(md1).toContain('qualitative')

    // Cell 2: Code - pinned pip installs
    const cell2 = nb.cells[1]!
    expect(cell2.cell_type).toBe('code')
    const pipSrc = cell2.source.join('')
    expect(pipSrc).toContain('!pip install -q')
    expect(pipSrc).toContain('"numpy==2.5.5"')
    expect(pipSrc).toContain('"scikit-learn==1.9.1"')

    // Cell 3: Code - dataset download + sha256 verification
    const cell3 = nb.cells[2]!
    expect(cell3.cell_type).toBe('code')
    const dsSrc = cell3.source.join('')
    expect(dsSrc).toContain(HERO_EXPERIMENT_SPEC_RUN_A.datasets[0]!.url)
    expect(dsSrc).toContain(HERO_EXPERIMENT_SPEC_RUN_A.datasets[0]!.sha256!)
    expect(dsSrc).toContain('hashlib.sha256')
    expect(dsSrc).toContain('SHA-256 mismatch')

    // Cell 4: Code - verbatim script
    const cell4 = nb.cells[3]!
    expect(cell4.cell_type).toBe('code')
    expect(cell4.source.join('')).toBe(HERO_EXPERIMENT_SPEC_RUN_A.files['main.py'])

    // Cell 5: Code - metrics display
    const cell5 = nb.cells[4]!
    expect(cell5.cell_type).toBe('code')
    const metricsSrc = cell5.source.join('')
    expect(metricsSrc).toContain('/output/metrics.json')
    expect(metricsSrc).toContain('json.load')

    // Cell 6: Markdown - criteria and pass/fail semantics
    const cell6 = nb.cells[5]!
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
          value: 4,
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
    expect(parsed.cells[0].source.join('')).toContain('`rank_impurity_noise_20` = 4')
  })

  it('throws if the entrypoint file is missing from spec.files', () => {
    const brokenSpec = structuredClone(HERO_EXPERIMENT_SPEC_RUN_A)
    delete brokenSpec.files['main.py']

    expect(() =>
      buildNotebookDocument({
        spec: brokenSpec,
        claim: HERO_CLAIM,
      }),
    ).toThrow(/not found in ExperimentSpec\.files/)
  })
})
