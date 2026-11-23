import type {
  Criteria,
  CriteriaOp,
  ExperimentResult,
  ExperimentSpec,
  Verdict,
  VerdictCheck,
  VerdictDetail,
} from '../shared/types'

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
 * The model is called only afterwards, to write two sentences of explanation.
 * The model cannot change the verdict.
 */

export function evaluateCheck(
  metricValue: number | undefined,
  op: CriteriaOp,
  threshold: number,
  tolerance?: number,
): boolean {
  if (metricValue === undefined || Number.isNaN(metricValue)) {
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

export interface EvaluationOutcome {
  verdict: Verdict
  detail: VerdictDetail
}

export function evaluateExperiment(
  spec: ExperimentSpec,
  result: ExperimentResult,
): EvaluationOutcome {
  // 1. Script failed to execute or crashed
  if (result.exitCode !== 0) {
    const checks: VerdictCheck[] = spec.criteria.checks.map((check) => ({
      metric: check.metric,
      op: check.op,
      threshold: check.value,
      tolerance: check.tolerance ?? null,
      measured: result.metrics[check.metric] ?? null,
      passed: false,
    }))
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
    if (measuredVal === undefined) {
      missingRequiredMetric = true
      checks.push({
        metric: check.metric,
        op: check.op,
        threshold: check.value,
        tolerance: check.tolerance ?? null,
        measured: null,
        passed: false,
      })
    } else {
      const passed = evaluateCheck(measuredVal, check.op, check.value, check.tolerance)
      checks.push({
        metric: check.metric,
        op: check.op,
        threshold: check.value,
        tolerance: check.tolerance ?? null,
        measured: measuredVal,
        passed,
      })
    }
  }

  // If any required metric is absent from metrics.json, verdict is inconclusive
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
