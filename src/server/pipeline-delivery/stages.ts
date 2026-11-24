/**
 * The stage-provider seam between the SSE transport and the pipeline itself.
 *
 * `src/server/pipeline.ts` (`#7`), `src/server/planner.ts` (`#23`),
 * `src/server/runner.ts` (`#24`) and `src/server/evaluate.ts` (`#25`) do not
 * exist on main today. The delivery transport is written against this narrow
 * port instead of importing any of them:
 *
 * - `plan` runs the stages up to and including PLAN_EXPERIMENT and returns the
 *   exact `ExperimentSpec` to offer at the human gate.
 * - `execute` runs EXECUTE and EVALUATE after an approval and returns the run
 *   it produced (or `null` when the pipeline ended without a run).
 *
 * The controller owns everything else: claims, event appends, the approval
 * gate, polling, the budget and the terminal event. A stage provider emits its
 * own `stage.*`, `agent_task.recorded`, `node.upserted`, `edge.upserted`,
 * `run.*` and `verdict.computed` events through `emit`.
 *
 * There is intentionally no production implementation in this PR. Supplying a
 * fake one would make the endpoint appear to run a pipeline it cannot run.
 */
import type { PipelineEvent } from '../../shared/events'
import type { PipelineEventInput } from '../../db/pipeline-validation'
import type { ExperimentSpec } from '../../shared/types'

/**
 * Appends one event and pushes it to the open stream. Rejects if the stream
 * was cancelled or the experiment already reached a terminal event.
 */
export type PipelineEmit = (
  event: PipelineEventInput,
) => Promise<PipelineEvent>

export type PipelineStageContext = {
  experimentId: string
  workspaceId: string
  /** The verified actor that owns the stream. */
  actorId: string
  /** Aborts on client disconnect or when the 240-second budget expires. */
  signal: AbortSignal
  emit: PipelineEmit
}

export type PipelinePlanResult = {
  /** The plan version put in front of the human. */
  spec: ExperimentSpec
}

export type PipelineExecutionResult = {
  /** `runs.id` for `pipeline.completed`; null if no run was created. */
  runId: string | null
}

export interface PipelineStages {
  plan(context: PipelineStageContext): Promise<PipelinePlanResult>

  execute(
    context: PipelineStageContext,
    spec: ExperimentSpec,
  ): Promise<PipelineExecutionResult>
}
