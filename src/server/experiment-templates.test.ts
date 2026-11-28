import { describe, expect, it } from 'vitest'

import { HERO_EXPERIMENT_SPEC_RUN_A } from '../../fixtures/hero-spec'
import {
  buildSupportedExperimentSpec,
  isSupportedExperimentTemplateId,
  SUPPORTED_EXPERIMENT_TEMPLATE,
  supportedExperimentTemplateSummary,
} from './experiment-templates'

const CLAIM_ID = '11111111-2222-4333-8444-555555555555'

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
  })
})
