import { z } from 'zod'
import type {
  CriteriaOp,
  ExperimentResult,
  ExperimentSpec,
  Verdict,
  VerdictCheck,
  VerdictDetail,
} from '../shared/types'
import { callModel, type CallModelContext, type CallModel } from './model'

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
function createVerdictCheck(
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

export interface EvaluationOutcome {
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
): EvaluationOutcome {
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

const ExplainGapSchema = z.object({
  explanation: z.string(),
})

export interface ExplainGapOptions {
  callModelFn?: CallModel
}

/**
 * Stage 7 complete evaluation: computes deterministic verdict arithmetic first,
 * then invokes callModel with taskKind: 'explain_gap' to generate a two-sentence
 * explanation of the gap (docs/03:108). The explanation can NEVER alter the verdict.
 */
export async function evaluateAndExplainExperiment(
  spec: ExperimentSpec,
  result: ExperimentResult,
  ctx: CallModelContext,
  options: ExplainGapOptions = {},
): Promise<EvaluationOutcome> {
  // Step 1: Deterministic verdict
  const outcome = evaluateExperiment(spec, result)
  const call = options.callModelFn ?? callModel

  // Step 2: Build prompt for explain_gap
  const checksSummary = outcome.detail.checks
    .map(
      (c) =>
        `- ${c.metric}: threshold ${c.op} ${c.threshold}, measured=${c.measured ?? 'missing'} (passed: ${c.passed})`,
    )
    .join('\n')

  const prompt = [
    `You are evaluating a research replication experiment.`,
    `Mode: ${spec.mode}`,
    `Claim Node: ${spec.claimNodeId}`,
    `Verdict: ${outcome.verdict}`,
    `Criteria Checks:`,
    checksSummary,
    `Write exactly two concise sentences explaining the gap between the measured results and the expected criteria (under 400 characters total).`,
  ].join('\n')

  try {
    const response = await call(ExplainGapSchema, prompt, {
      ...ctx,
      taskKind: 'explain_gap',
    })

    const rawExplanation = response.output.explanation
    const explanation =
      typeof rawExplanation === 'string' && rawExplanation.length > 500
        ? rawExplanation.slice(0, 500)
        : rawExplanation

    return {
      verdict: outcome.verdict, // Verdict is locked; model cannot change it
      detail: {
        checks: outcome.detail.checks,
        explanation,
      },
    }
  } catch (err) {
    // If the explanation model call fails, log diagnostic warning and preserve deterministic outcome
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[evaluateAndExplainExperiment] explain_gap model call failed: ${msg}`)
    return outcome
  }
}
