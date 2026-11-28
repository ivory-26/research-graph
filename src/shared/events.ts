/**
 * The event union the pipeline SSE stream emits.
 *
 * Events are ordered per experiment by `seq` and persisted so a reconnect can
 * replay from Last-Event-ID. Idle connections receive SSE comments
 * (`: heartbeat`) every 15 seconds; comments are not events and are not in this
 * union.
 */
import type {
  AgentTaskStatus,
  ApprovalState,
  ExperimentResult,
  ExperimentSpec,
  GraphEdge,
  GraphNode,
  Mode,
  TaskKind,
  Verdict,
  VerdictDetail,
} from './types'

/** The fixed order from docs/03-agent-pipeline.md. */
export const PIPELINE_STAGES = [
  'INGEST_SOURCE',
  'EXTRACT_CLAIMS',
  'PROPOSE_EDGES',
  'PLAN_EXPERIMENT',
  'AWAIT_APPROVAL',
  'EXECUTE',
  'EVALUATE',
  'BRANCH_WHAT_IF',
] as const

export type PipelineStage = (typeof PIPELINE_STAGES)[number]

export type StageStatus = 'succeeded' | 'failed' | 'cancelled'

export type PipelineEventBase = {
  /** Monotonic per experiment; the SSE event id, used by Last-Event-ID. */
  seq: number
  experimentId: string
  /** ISO 8601 timestamp. */
  at: string
}

export type PipelineStartedEvent = PipelineEventBase & {
  type: 'pipeline.started'
  mode: Mode
}

export type StageStartedEvent = PipelineEventBase & {
  type: 'stage.started'
  stage: PipelineStage
}

export type StageFinishedEvent = PipelineEventBase & {
  type: 'stage.finished'
  stage: PipelineStage
  status: StageStatus
  /** null for deterministic stages that do not record an agent task. */
  taskId: string | null
  error: string | null
}

/**
 * One row was written to `agent_tasks`. Emitted for failures too: every model
 * call is accounted for, success or failure.
 */
export type AgentTaskRecordedEvent = PipelineEventBase & {
  type: 'agent_task.recorded'
  task: {
    id: string
    taskKind: TaskKind
    strategyId: string | null
    model: string
    status: AgentTaskStatus
    promptTokens: number | null
    completionTokens: number | null
    costUsd: number | null
    latencyMs: number | null
    error: string | null
  }
}

/** Upsert rather than create, because result/run nodes change after creation. */
export type NodeUpsertedEvent = PipelineEventBase & {
  type: 'node.upserted'
  node: GraphNode
}

/** Upsert rather than create, because an edge's status can change after review. */
export type EdgeUpsertedEvent = PipelineEventBase & {
  type: 'edge.upserted'
  edge: GraphEdge
}

export type ApprovalRequestedEvent = PipelineEventBase & {
  type: 'approval.requested'
  spec: ExperimentSpec
  /**
   * Present only for a repaired-script gate. The initial plan gate omits it.
   * Additive: older persisted events and clients simply have no repair context.
   */
  repair?: {
    /** The failed/timed-out run the candidate was chained from. */
    parentRunId: string
    /** The attempt number the candidate will run as (`parent.attempt + 1`). */
    attempt?: number
  }
}

export type ApprovalResolvedEvent = PipelineEventBase & {
  type: 'approval.resolved'
  state: Extract<ApprovalState, 'approved' | 'rejected'>
  approvedBy: string | null
}

export type RunStartedEvent = PipelineEventBase & {
  type: 'run.started'
  runId: string
  attempt: number
  sandboxId: string | null
}

/** Transient stream output. `runs.stdout` remains the durable record. */
export type RunStdoutEvent = PipelineEventBase & {
  type: 'run.stdout'
  runId: string
  chunk: string
}

export type RunSucceededEvent = PipelineEventBase & {
  type: 'run.succeeded'
  runId: string
  result: ExperimentResult
}

export type RunFailedEvent = PipelineEventBase & {
  type: 'run.failed'
  runId: string
  error: string
}

/** Emitted when the 240-second stream budget is exhausted. */
export type RunTimeoutEvent = PipelineEventBase & {
  type: 'run.timeout'
  runId: string
  budgetMs: number
}

export type VerdictComputedEvent = PipelineEventBase & {
  type: 'verdict.computed'
  runId: string
  verdict: Verdict
  detail: VerdictDetail
}

export type PipelineCompletedEvent = PipelineEventBase & {
  type: 'pipeline.completed'
  /** null when the pipeline ended before anything executed. */
  runId: string | null
}

export type PipelineFailedEvent = PipelineEventBase & {
  type: 'pipeline.failed'
  error: string
}

/** A rejection at the approval gate ends the pipeline as cancelled. */
export type PipelineCancelledEvent = PipelineEventBase & {
  type: 'pipeline.cancelled'
  reason: 'rejected'
}

export type PipelineEvent =
  | PipelineStartedEvent
  | StageStartedEvent
  | StageFinishedEvent
  | AgentTaskRecordedEvent
  | NodeUpsertedEvent
  | EdgeUpsertedEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | RunStartedEvent
  | RunStdoutEvent
  | RunSucceededEvent
  | RunFailedEvent
  | RunTimeoutEvent
  | VerdictComputedEvent
  | PipelineCompletedEvent
  | PipelineFailedEvent
  | PipelineCancelledEvent

export type PipelineEventType = PipelineEvent['type']
