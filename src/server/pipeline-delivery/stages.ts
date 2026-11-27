/**
 * The stage-provider seam between the SSE transport and the pipeline itself.
 *
 * The real provider is `./production-stages`; it builds on
 * `src/server/planner.ts`, `src/server/runner.ts` and
 * `src/server/evaluate.ts` while the delivery transport stays written against
 * this narrow port:
 *
 * - `plan` produces the exact `ExperimentSpec` to offer at the human gate. For
 *   the current provider that is the persisted plan, validated by the planner.
 * - `execute` runs EXECUTE and EVALUATE after an approval and returns the run
 *   it produced (or `null` when the pipeline ended without a run).
 *
 * The controller owns everything else: claims, event appends, the approval
 * gate, polling, the budget and the terminal event. A stage provider emits its
 * own `stage.*`, `agent_task.recorded`, `node.upserted`, `edge.upserted`,
 * `run.*` and `verdict.computed` events through `emit`.
 *
 * A provider must emit `stage.*` only for work it actually performs. A stored
 * plan is not a reason to replay INGEST_SOURCE: that stage happened before the
 * experiment row existed.
 */
import type { ApprovalGateView, OpenApprovalGateInput, OpenApprovalGateResult } from '../../db/pipeline'
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
  /**
   * Aborts on client disconnect or when the 240-second budget expires. A
   * provider should use it to stop work and release resources. It is not the
   * transport's only guarantee: the stream also enforces the deadline itself,
   * closes, and writes the terminal event even when a stage ignores this
   * signal. After expiry `emit` rejects, so a late stage cannot append.
   */
  signal: AbortSignal
  emit: PipelineEmit
  repairApproval: {
    claimId: string
    open(input: OpenApprovalGateInput): Promise<OpenApprovalGateResult>
    wait(gateSeq: number): Promise<ApprovalGateView>
  }
}

export type PipelinePlanResult = {
  /** The plan version put in front of the human. */
  spec: ExperimentSpec
}

export type PipelineExecutionResult = {
  /** `runs.id` for `pipeline.completed`; null if no run was created. */
  runId: string | null
  repairRejected?: true
}

export interface PipelineStages {
  plan(context: PipelineStageContext): Promise<PipelinePlanResult>

  execute(
    context: PipelineStageContext,
    spec: ExperimentSpec,
  ): Promise<PipelineExecutionResult>
}

/**
 * A stage refusal whose message is safe to persist and stream.
 *
 * `Error.message` is not: it can carry a provider response, a connection
 * string or a request id, and `pipeline.failed.error` is both stored durably
 * and sent to the browser. A provider that wants a specific sentence on the
 * wire supplies `safeMessage` and keeps the detail in the server log.
 */
export class PipelineStageError extends Error {
  readonly safeMessage: string

  constructor(detail: string, safeMessage: string) {
    super(detail)
    this.name = 'PipelineStageError'
    this.safeMessage = safeMessage
  }
}
