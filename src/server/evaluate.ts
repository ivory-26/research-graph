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
import {
  evaluateCheck,
  createVerdictCheck,
  type EvaluatedVerdict,
  evaluateExperiment,
} from './evaluate-verdict'

export {
  evaluateCheck,
  createVerdictCheck,
  type EvaluatedVerdict,
  evaluateExperiment,
}

const ExplainGapSchema = z.object({
  explanation: z.string(),
})

/**
 * The text model pinned for this evaluator's `explain_gap` explanation (#6).
 * Every other call site keeps `DEFAULT_MODEL_ID`; embeddings stay on
 * `gemini-embedding-2`. `gemini-4-hydrogen` has no entry in `DEFAULT_PRICING`,
 * so the wrapper records `cost_usd` as null (unknown) rather than guessing.
 */
export const EXPLAIN_GAP_MODEL_ID = 'gemini-4-hydrogen'

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
): Promise<EvaluatedVerdict> {
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
      modelId: EXPLAIN_GAP_MODEL_ID,
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
