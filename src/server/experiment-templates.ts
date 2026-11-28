/**
 * Supported experiment templates for the workspace UI.
 *
 * The product does not generate experiment code yet (`docs/03`: PLAN_EXPERIMENT
 * validates a stored spec, it does not write one). The only supported plan is
 * the hand-written, checked-in hero spec: a tabular random-forest variable
 * importance reproduction on breast-w. This module lets an authorized workspace
 * create an experiment from that exact spec after rebinding the claim node and
 * applying a small, explicitly bounded set of parameter overrides.
 *
 * Nothing here writes a metric, a verdict or a graph edge. It only builds a
 * spec; the planner validates it again before the SSE pipeline opens a gate.
 */
import { HERO_EXPERIMENT_SPEC_RUN_A } from '../../fixtures/hero-spec'
import type { Criteria, ExperimentSpec, NodeData } from '../shared/types'
import { validateExperimentSpec } from './planner'

export type SupportedExperimentTemplateId = 'rf-variable-importance'

export interface SupportedExperimentTemplate {
  id: SupportedExperimentTemplateId
  name: string
  description: string
  claimHint: string
  dataset: string
  method: string
  mode: 'adapted'
  parameters: {
    importance_method: {
      label: string
      options: Array<{ value: 'impurity' | 'permutation'; label: string }>
      defaultValue: 'impurity' | 'permutation'
    }
    n_estimators: { label: string; min: number; max: number; defaultValue: number }
    seed: { label: string; min: number; max: number; defaultValue: number }
  }
}

export const SUPPORTED_EXPERIMENT_TEMPLATE: SupportedExperimentTemplate = {
  id: 'rf-variable-importance',
  name: 'Random forest variable importance',
  description:
    'Tests whether impurity-based importance ranks a high-cardinality noise feature among the top predictors, and whether permutation importance removes that bias.',
  claimHint:
    'Choose a claim about random-forest feature importance. The claim stays attached to this exact measured run.',
  dataset: 'breast-w + 3 noise columns (OpenML 52350)',
  method: 'RandomForestClassifier · scikit-learn',
  mode: 'adapted',
  parameters: {
    importance_method: {
      label: 'Importance method',
      options: [
        { value: 'impurity', label: 'Impurity (Gini) importance' },
        { value: 'permutation', label: 'Permutation importance' },
      ],
      defaultValue: 'impurity',
    },
    n_estimators: {
      label: 'Estimators',
      min: 10,
      max: 500,
      defaultValue: Number(HERO_EXPERIMENT_SPEC_RUN_A.parameters.n_estimators),
    },
    seed: {
      label: 'Random seed',
      min: 0,
      max: 2_147_483_647,
      defaultValue: Number(HERO_EXPERIMENT_SPEC_RUN_A.parameters.seed),
    },
  },
}

export const SUPPORTED_EXPERIMENT_TEMPLATE_IDS: readonly SupportedExperimentTemplateId[] = [
  SUPPORTED_EXPERIMENT_TEMPLATE.id,
]

/**
 * One-line label for records that must not imply the run reproduced the
 * claim's own dataset: the verdict comes from this fixed adapted template.
 */
export const SUPPORTED_EXPERIMENT_TEMPLATE_LABEL =
  `${SUPPORTED_EXPERIMENT_TEMPLATE.name} — fixed adapted breast-w protocol (not the claim's original dataset)`

export function isSupportedExperimentTemplateId(
  value: unknown,
): value is SupportedExperimentTemplateId {
  return (
    typeof value === 'string' &&
    (SUPPORTED_EXPERIMENT_TEMPLATE_IDS as readonly string[]).includes(value)
  )
}

/** One check's identity, independent of object key order. */
function criteriaCheckKey(check: Criteria['checks'][number]): string {
  return JSON.stringify([
    check.metric,
    check.op,
    check.value,
    check.tolerance ?? null,
  ])
}

/**
 * Structural criteria comparison.
 *
 * `experiments.spec` is jsonb, and PostgreSQL returns jsonb object keys in its
 * own order (for a check: `op`, `value`, `metric`), so stringifying a stored
 * spec can never equal the fixture's string. Compare the fields instead, and
 * ignore the order of the checks themselves, which jsonb does preserve but no
 * rule depends on.
 */
function sameCriteria(actual: Criteria, expected: Criteria): boolean {
  if (actual.mode !== expected.mode) return false
  if (actual.checks.length !== expected.checks.length) return false

  const expectedKeys = expected.checks.map(criteriaCheckKey).sort()
  return actual.checks
    .map(criteriaCheckKey)
    .sort()
    .every((key, index) => key === expectedKeys[index])
}

/**
 * Identifies a stored spec as the one supported template by its fixed parts
 * (image, entrypoint, script, dataset bytes/hash and criteria). The claim and
 * the bounded parameter overrides are deliberately ignored. Returns null for a
 * spec that is not this template, so a future custom experiment is never
 * mislabelled as the random-forest test.
 */
export function identifyExperimentTemplate(
  spec: ExperimentSpec,
): { id: SupportedExperimentTemplateId; name: string } | null {
  const fixed = HERO_EXPERIMENT_SPEC_RUN_A
  const fixedDataset = fixed.datasets[0]
  const dataset = spec.datasets[0]
  const matchingCriteria = sameCriteria(spec.criteria, fixed.criteria)

  if (
    spec.image === fixed.image &&
    spec.entrypoint === fixed.entrypoint &&
    spec.files['main.py'] === fixed.files['main.py'] &&
    dataset?.url === fixedDataset?.url &&
    dataset?.sha256 === fixedDataset?.sha256 &&
    dataset?.bytes === fixedDataset?.bytes &&
    matchingCriteria
  ) {
    return {
      id: SUPPORTED_EXPERIMENT_TEMPLATE.id,
      name: SUPPORTED_EXPERIMENT_TEMPLATE.name,
    }
  }

  return null
}

/** The template fields carried by an experiment response. */
export function experimentTemplateFields(
  spec: ExperimentSpec,
): { templateId: SupportedExperimentTemplateId | null; templateName: string | null } {
  const identified = identifyExperimentTemplate(spec)
  return {
    templateId: identified?.id ?? null,
    templateName: identified?.name ?? null,
  }
}

export interface ClaimTemplateCompatibilityInput {
  title?: string | null
  data?: NodeData | null
}

export type ClaimTemplateCompatibility =
  | { compatible: true }
  | { compatible: false; reason: string }

/**
 * Claims the one supported template can honestly test: statements about
 * random-forest variable/feature importance (impurity, permutation, Gini, RF).
 * The template rebinds the claim but keeps the fixed breast-w script and
 * criteria, so an unrelated claim would otherwise receive a random-forest
 * verdict it never asked for.
 */
const CLAIM_TOPIC_PATTERN =
  /random\s*forest|variable\s+importance|feature\s+importance|permutation\s+importance|gini|impurity|\brf\b/i

export function assessClaimTemplateCompatibility(
  input: ClaimTemplateCompatibilityInput,
): ClaimTemplateCompatibility {
  const claim = input.data?.type === 'claim' ? input.data : null
  const haystack = [
    input.title,
    claim?.text,
    claim?.methodName,
    claim?.datasetName,
  ]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n')

  if (CLAIM_TOPIC_PATTERN.test(haystack)) {
    return { compatible: true }
  }

  return {
    compatible: false,
    reason:
      'The supported template tests random-forest variable importance on the adapted breast-w protocol, so it only accepts claims about random-forest feature importance. Choose a claim that mentions random forest, variable importance, permutation importance, Gini or impurity.',
  }
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface BuildSupportedExperimentSpecInput {
  claimNodeId: string
  templateId: SupportedExperimentTemplateId
  parameters?: Record<string, unknown>
}

export interface BuildSupportedExperimentSpecResult {
  spec: ExperimentSpec | null
  errors: string[]
}

const ALLOWED_PARAMETER_KEYS = new Set(['importance_method', 'n_estimators', 'seed'])

/**
 * Builds the one supported spec for a claim.
 *
 * Unknown parameter keys are rejected rather than ignored: silently dropping a
 * caller's override would make the approval screen describe a plan the caller
 * did not ask for. Every override is bounded here and the finished spec is then
 * validated by the same planner the pipeline uses.
 */
export function buildSupportedExperimentSpec(
  input: BuildSupportedExperimentSpecInput,
): BuildSupportedExperimentSpecResult {
  const errors: string[] = []

  const claimNodeId = typeof input.claimNodeId === 'string' ? input.claimNodeId.trim() : ''
  if (!UUID_REGEX.test(claimNodeId)) {
    errors.push('claimNodeId must be a workspace claim node UUID')
  }

  if (!isSupportedExperimentTemplateId(input.templateId)) {
    errors.push(`unsupported experiment template: ${String(input.templateId)}`)
  }

  const overrides = input.parameters ?? {}
  if (typeof overrides !== 'object' || Array.isArray(overrides)) {
    errors.push('parameters must be an object')
  } else {
    for (const key of Object.keys(overrides)) {
      if (!ALLOWED_PARAMETER_KEYS.has(key)) {
        errors.push(`unsupported parameter: ${key}`)
      }
    }
  }

  const parameters: Record<string, unknown> = { ...HERO_EXPERIMENT_SPEC_RUN_A.parameters }

  const importanceMethod = overrides.importance_method
  if (importanceMethod !== undefined) {
    if (importanceMethod !== 'impurity' && importanceMethod !== 'permutation') {
      errors.push('importance_method must be "impurity" or "permutation"')
    } else {
      parameters.importance_method = importanceMethod
    }
  }

  const nEstimators = overrides.n_estimators
  if (nEstimators !== undefined) {
    const bounds = SUPPORTED_EXPERIMENT_TEMPLATE.parameters.n_estimators
    if (
      typeof nEstimators !== 'number' ||
      !Number.isInteger(nEstimators) ||
      nEstimators < bounds.min ||
      nEstimators > bounds.max
    ) {
      errors.push(
        `n_estimators must be an integer between ${bounds.min} and ${bounds.max}`,
      )
    } else {
      parameters.n_estimators = nEstimators
    }
  }

  const seed = overrides.seed
  if (seed !== undefined) {
    const bounds = SUPPORTED_EXPERIMENT_TEMPLATE.parameters.seed
    if (
      typeof seed !== 'number' ||
      !Number.isInteger(seed) ||
      seed < bounds.min ||
      seed > bounds.max
    ) {
      errors.push(`seed must be an integer between ${bounds.min} and ${bounds.max}`)
    } else {
      parameters.seed = seed
    }
  }

  if (errors.length > 0) {
    return { spec: null, errors }
  }

  const spec: ExperimentSpec = {
    ...HERO_EXPERIMENT_SPEC_RUN_A,
    claimNodeId,
    files: { ...HERO_EXPERIMENT_SPEC_RUN_A.files },
    datasets: HERO_EXPERIMENT_SPEC_RUN_A.datasets.map((dataset) => ({ ...dataset })),
    criteria: {
      ...HERO_EXPERIMENT_SPEC_RUN_A.criteria,
      checks: HERO_EXPERIMENT_SPEC_RUN_A.criteria.checks.map((check) => ({ ...check })),
    },
    parameters,
  }

  const validation = validateExperimentSpec(spec)
  if (!validation.valid) {
    return { spec: null, errors: validation.errors }
  }

  return { spec, errors: [] }
}

/**
 * A serialisable view of the supported plan for the experiments page. It
 * deliberately omits `files`: the approval screen shows the exact script from
 * the persisted gate, not a second copy rendered by a list endpoint.
 */
export function supportedExperimentTemplateSummary() {
  return {
    ...SUPPORTED_EXPERIMENT_TEMPLATE,
    mode: HERO_EXPERIMENT_SPEC_RUN_A.mode,
    timeoutSeconds: HERO_EXPERIMENT_SPEC_RUN_A.timeoutSeconds,
    memoryMb: HERO_EXPERIMENT_SPEC_RUN_A.memoryMb,
    cpuCount: HERO_EXPERIMENT_SPEC_RUN_A.cpuCount,
    network: HERO_EXPERIMENT_SPEC_RUN_A.network,
    criteria: HERO_EXPERIMENT_SPEC_RUN_A.criteria,
    datasets: HERO_EXPERIMENT_SPEC_RUN_A.datasets.map((dataset) => ({
      name: dataset.name,
      url: dataset.url,
      bytes: dataset.bytes,
      sha256: dataset.sha256,
    })),
  }
}
