import type {
  CriteriaOp,
  ExperimentResult,
  ExperimentSpec,
  Verdict,
  VerdictCheck,
  VerdictDetail,
} from '../shared/types.ts'

/**
 * Deterministic evaluation of criteria against experiment metrics (docs/03-agent-pipeline.md).
 *
 * Rules:
 * exitCode !== 0                → 'failed'
 * any required metric missing   → 'inconclusive'
 * every check passes            → 'match'
 * every check fails             → 'mismatch'
 * some pass, some fail          → 'mismatch' with per-check detail
 *
 * The model is called only afterwards, to write two sentences of explanation (docs/03:108).
 * The explanation is prose; the verdict is arithmetic.
 * The model cannot change the verdict.
 */

export function evaluateCheck(
  metricValue: number | undefined,
  op: CriteriaOp,
  threshold: number,
  tolerance?: number,
): boolean {
  if (metricValue === undefined || Number.isNaN(metricValue) || !Number.isFinite(metricValue)) {
    return false
  }

  switch (op) {
    case 'lt':
      return metricValue < threshold
    case 'lte':
      return metricValue <= threshold
    case 'gt':
      return metricValue > threshold
    case 'gte':
      return metricValue >= threshold
    case 'eq':
      return metricValue === threshold
    case 'neq':
      return metricValue !== threshold
    case 'within': {
      const tol = tolerance ?? 0
      return Math.abs(metricValue - threshold) <= tol
    }
    default:
      return false
  }
}

/**
 * Helper to construct a VerdictCheck object cleanly without duplication.
 */
export function createVerdictCheck(
  metric: string,
  op: CriteriaOp,
  threshold: number,
  tolerance: number | null,
  measured: number | null,
  passed: boolean,
): VerdictCheck {
  return {
    metric,
    op,
    threshold,
    tolerance,
    measured,
    passed,
  }
}

export interface EvaluatedVerdict {
  verdict: Verdict
  detail: VerdictDetail
}

/**
 * Pure deterministic arithmetic evaluation of the experiment criteria.
 * Does not perform any LLM model calls.
 */
export function evaluateExperiment(
  spec: ExperimentSpec,
  result: ExperimentResult,
): EvaluatedVerdict {
  // Defensive: empty criteria checks cannot evaluate to match or mismatch
  if (!spec.criteria?.checks || spec.criteria.checks.length === 0) {
    return {
      verdict: 'inconclusive',
      detail: {
        checks: [],
        explanation: null,
      },
    }
  }

  // 1. Script failed to execute or crashed (non-zero exit code)
  if (result.exitCode !== 0) {
    const checks: VerdictCheck[] = spec.criteria.checks.map((check) =>
      createVerdictCheck(
        check.metric,
        check.op,
        check.value,
        check.tolerance ?? null,
        result.metrics[check.metric] ?? null,
        false,
      ),
    )
    return {
      verdict: 'failed',
      detail: {
        checks,
        explanation: null,
      },
    }
  }

  // 2. Evaluate all checks
  const checks: VerdictCheck[] = []
  let missingRequiredMetric = false

  for (const check of spec.criteria.checks) {
    const measuredVal = result.metrics[check.metric]
    if (measuredVal === undefined || typeof measuredVal !== 'number' || !Number.isFinite(measuredVal)) {
      missingRequiredMetric = true
      checks.push(
        createVerdictCheck(
          check.metric,
          check.op,
          check.value,
          check.tolerance ?? null,
          null,
          false,
        ),
      )
    } else {
      const passed = evaluateCheck(measuredVal, check.op, check.value, check.tolerance)
      checks.push(
        createVerdictCheck(
          check.metric,
          check.op,
          check.value,
          check.tolerance ?? null,
          measuredVal,
          passed,
        ),
      )
    }
  }

  // If any required metric is absent or invalid, verdict is inconclusive
  if (missingRequiredMetric) {
    return {
      verdict: 'inconclusive',
      detail: {
        checks,
        explanation: null,
      },
    }
  }

  // Evaluate pass condition according to criteria.mode
  const passCount = checks.filter((c) => c.passed).length
  const totalCount = checks.length

  let verdict: Verdict
  if (spec.criteria.mode === 'all') {
    verdict = passCount === totalCount ? 'match' : 'mismatch'
  } else {
    // mode === 'any'
    verdict = passCount > 0 ? 'match' : 'mismatch'
  }

  return {
    verdict,
    detail: {
      checks,
      explanation: null,
    },
  }
}
