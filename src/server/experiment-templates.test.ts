import { describe, expect, it } from 'vitest'

import { HERO_EXPERIMENT_SPEC_RUN_A } from '../../fixtures/hero-spec'
import type { ExperimentSpec, NodeData } from '../shared/types'
import {
  assessClaimTemplateCompatibility,
  buildSupportedExperimentSpec,
  experimentTemplateFields,
  identifyExperimentTemplate,
  isSupportedExperimentTemplateId,
  SUPPORTED_EXPERIMENT_TEMPLATE,
  SUPPORTED_EXPERIMENT_TEMPLATE_LABEL,
  supportedExperimentTemplateSummary,
} from './experiment-templates'

const CLAIM_ID = '11111111-2222-4333-8444-555555555555'

function claimData(overrides: {
  text?: string
  methodName?: string | null
  datasetName?: string | null
} = {}): NodeData {
  return {
    type: 'claim',
    text: overrides.text ?? 'A statement about the study.',
    reported: null,
    datasetName: overrides.datasetName ?? null,
    methodName: overrides.methodName ?? null,
    locator: { page: 1, quote: 'A statement about the study.' },
  }
}

describe('supported experiment template', () => {
  it('builds the hero tabular spec for a workspace claim and validates it', () => {
    const result = buildSupportedExperimentSpec({
      claimNodeId: CLAIM_ID,
      templateId: 'rf-variable-importance',
    })

    expect(result.errors).toEqual([])
    expect(result.spec).not.toBeNull()
    expect(result.spec?.claimNodeId).toBe(CLAIM_ID)
    expect(result.spec?.mode).toBe('adapted')
    expect(result.spec?.network).toBe('none')
    expect(result.spec?.image).toBe(HERO_EXPERIMENT_SPEC_RUN_A.image)
    expect(result.spec?.parameters.importance_method).toBe('impurity')
    expect(result.spec?.parameters.n_estimators).toBe(100)
  })

  it('applies only the bounded parameter overrides', () => {
    const result = buildSupportedExperimentSpec({
      claimNodeId: CLAIM_ID,
      templateId: 'rf-variable-importance',
      parameters: {
        importance_method: 'permutation',
        n_estimators: 250,
        seed: 7,
      },
    })

    expect(result.errors).toEqual([])
    expect(result.spec?.parameters.importance_method).toBe('permutation')
    expect(result.spec?.parameters.n_estimators).toBe(250)
    expect(result.spec?.parameters.seed).toBe(7)
  })

  it('returns a deep copy so a caller cannot mutate the checked-in hero spec', () => {
    const result = buildSupportedExperimentSpec({
      claimNodeId: CLAIM_ID,
      templateId: 'rf-variable-importance',
    })

    expect(result.spec).not.toBeNull()
    result.spec!.parameters.importance_method = 'permutation'
    result.spec!.criteria.checks[0]!.value = -1

    expect(HERO_EXPERIMENT_SPEC_RUN_A.parameters.importance_method).toBe('impurity')
    expect(HERO_EXPERIMENT_SPEC_RUN_A.criteria.checks[0]!.value).toBe(5)
  })

  it('rejects unknown templates, parameters and out-of-bounds values', () => {
    const unknownTemplate = buildSupportedExperimentSpec({
      claimNodeId: CLAIM_ID,
      templateId: 'arbitrary-shell' as never,
    })
    expect(unknownTemplate.spec).toBeNull()
    expect(unknownTemplate.errors.join(' ')).toContain('unsupported experiment template')

    const unknownParameter = buildSupportedExperimentSpec({
      claimNodeId: CLAIM_ID,
      templateId: 'rf-variable-importance',
      parameters: { command: 'rm -rf /' },
    })
    expect(unknownParameter.spec).toBeNull()
    expect(unknownParameter.errors.join(' ')).toContain('unsupported parameter')

    const invalidMethod = buildSupportedExperimentSpec({
      claimNodeId: CLAIM_ID,
      templateId: 'rf-variable-importance',
      parameters: { importance_method: 'shap' },
    })
    expect(invalidMethod.spec).toBeNull()
    expect(invalidMethod.errors.join(' ')).toContain('importance_method')

    const tooManyEstimators = buildSupportedExperimentSpec({
      claimNodeId: CLAIM_ID,
      templateId: 'rf-variable-importance',
      parameters: { n_estimators: 5 },
    })
    expect(tooManyEstimators.spec).toBeNull()

    const fractionalSeed = buildSupportedExperimentSpec({
      claimNodeId: CLAIM_ID,
      templateId: 'rf-variable-importance',
      parameters: { seed: 1.5 },
    })
    expect(fractionalSeed.spec).toBeNull()
  })

  it('rejects a non-UUID claim node', () => {
    const result = buildSupportedExperimentSpec({
      claimNodeId: 'claim-strobl-2007-gini-bias',
      templateId: 'rf-variable-importance',
    })
    expect(result.spec).toBeNull()
    expect(result.errors.join(' ')).toContain('UUID')
  })

  it('exposes one supported template id and a summary without the script', () => {
    expect(isSupportedExperimentTemplateId(SUPPORTED_EXPERIMENT_TEMPLATE.id)).toBe(true)
    expect(isSupportedExperimentTemplateId('anything-else')).toBe(false)

    const summary = supportedExperimentTemplateSummary()
    expect(summary.id).toBe('rf-variable-importance')
    expect(summary.mode).toBe('adapted')
    expect(summary.network).toBe('none')
    expect('files' in summary).toBe(false)
    expect(summary.criteria.checks).toHaveLength(2)
    expect(summary.datasets[0]?.name).toBe('breast-w')

    // The notebook and experiment list use this to say the run is a template
    // test, not a reproduction of the claim's dataset.
    expect(SUPPORTED_EXPERIMENT_TEMPLATE_LABEL).toContain('fixed adapted breast-w protocol')
    expect(SUPPORTED_EXPERIMENT_TEMPLATE_LABEL).toContain(
      "not the claim's original dataset",
    )
  })
})

describe('claim/template compatibility', () => {
  it('accepts claims that name random-forest variable or feature importance', () => {
    for (const input of [
      { title: 'Gini importance favours high-cardinality features', data: claimData() },
      { title: 'The authors find a bias', data: claimData({ methodName: 'Random Forest' }) },
      { title: 'The authors find a bias', data: claimData({ datasetName: 'permutation importance benchmark' }) },
      {
        title: 'The authors find a bias',
        data: claimData({ text: 'Impurity-based importance ranks noise highly.' }),
      },
      { title: 'RF importances are biased', data: claimData() },
    ]) {
      expect(
        assessClaimTemplateCompatibility(input),
        JSON.stringify(input),
      ).toEqual({ compatible: true })
    }
  })

  it('rejects an unrelated claim with a reason that names the supported topic', () => {
    const result = assessClaimTemplateCompatibility({
      title: 'Transformers outperform LSTMs on translation',
      data: claimData({
        text: 'The transformer reaches 28.4 BLEU, beating the LSTM baseline.',
        methodName: 'Transformer',
        datasetName: 'WMT 2014',
      }),
    })

    expect(result.compatible).toBe(false)
    if (result.compatible) throw new Error('expected an incompatible claim')
    expect(result.reason).toContain('random-forest variable importance')
    expect(result.reason).toContain('adapted breast-w protocol')
  })

  it('rejects a missing claim node and reads non-claim data as title only', () => {
    expect(assessClaimTemplateCompatibility({ title: 'A study of tables' })).toMatchObject({
      compatible: false,
    })
    expect(
      assessClaimTemplateCompatibility({
        title: 'Feature importance in the appendix',
        data: { type: 'note', body: 'unrelated' },
      }),
    ).toMatchObject({ compatible: true })
  })
})

describe('identifyExperimentTemplate', () => {
  it('identifies the supported spec by its fixed parts', () => {
    expect(identifyExperimentTemplate(HERO_EXPERIMENT_SPEC_RUN_A)).toEqual({
      id: SUPPORTED_EXPERIMENT_TEMPLATE.id,
      name: SUPPORTED_EXPERIMENT_TEMPLATE.name,
    })
    expect(experimentTemplateFields(HERO_EXPERIMENT_SPEC_RUN_A)).toEqual({
      templateId: SUPPORTED_EXPERIMENT_TEMPLATE.id,
      templateName: SUPPORTED_EXPERIMENT_TEMPLATE.name,
    })
  })

  it('identifies a persisted spec whose jsonb criteria reorder keys and checks', () => {
    // `experiments.spec` is jsonb: PostgreSQL returns each check as
    // `{ op, value, metric }`, so a stored supported spec never stringifies
    // like the fixture. Reverse the checks too, since order must not matter.
    const stored: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      criteria: {
        mode: HERO_EXPERIMENT_SPEC_RUN_A.criteria.mode,
        checks: [...HERO_EXPERIMENT_SPEC_RUN_A.criteria.checks]
          .reverse()
          .map((check) => ({ op: check.op, value: check.value, metric: check.metric })),
      },
    }

    expect(JSON.stringify(stored.criteria)).not.toBe(
      JSON.stringify(HERO_EXPERIMENT_SPEC_RUN_A.criteria),
    )
    expect(identifyExperimentTemplate(stored)).toEqual({
      id: 'rf-variable-importance',
      name: SUPPORTED_EXPERIMENT_TEMPLATE.name,
    })
    expect(experimentTemplateFields(stored)).toEqual({
      templateId: 'rf-variable-importance',
      templateName: SUPPORTED_EXPERIMENT_TEMPLATE.name,
    })
  })

  it('does not label a spec whose criteria differ from the template', () => {
    const changedValue: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      criteria: {
        mode: 'all',
        checks: [{ metric: 'rank_impurity_noise_20', op: 'lte', value: 4 }],
      },
    }
    expect(identifyExperimentTemplate(changedValue)).toBeNull()

    const changedMode: ExperimentSpec = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      criteria: { ...HERO_EXPERIMENT_SPEC_RUN_A.criteria, mode: 'any' },
    }
    expect(identifyExperimentTemplate(changedMode)).toBeNull()
  })

  it('does not label a spec whose script differs from the template', () => {
    const custom = {
      ...HERO_EXPERIMENT_SPEC_RUN_A,
      files: { 'main.py': 'print("custom")\n' },
    }
    expect(identifyExperimentTemplate(custom)).toBeNull()
    expect(experimentTemplateFields(custom)).toEqual({
      templateId: null,
      templateName: null,
    })
  })
})
