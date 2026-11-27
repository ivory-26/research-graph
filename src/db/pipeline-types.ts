/**
 * Public result shapes for the pipeline DB layer.
 *
 * Transport code should import from `src/db/pipeline.ts`, which re-exports
 * these types and the functions that produce them.
 */
import type {
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
  PipelineEvent,
} from '../shared/events'
import type { ApprovalState, ExperimentSpec } from '../shared/types'
import type {
  ApprovalGateStatus,
  ExecutionClaimCloseReason,
} from './schema'
import type { PipelineEventInput } from './pipeline-validation'

/** A claim as observed by the database clock. Expiry is not a mutation. */
export type ExecutionClaimView = {
  id: string
  experimentId: string
  workspaceId: string
  claimedAt: Date
  expiresAt: Date
  closedAt: Date | null
  closeReason: ExecutionClaimCloseReason | null
  /** Not closed and not past `expiresAt`. */
  active: boolean
  /** Not closed and past `expiresAt`. Never renewed by a read or reconnect. */
  expired: boolean
}

/**
 * - `claimed`: this call created the one claim. Only this outcome authorizes
 *   a pipeline run to start.
 * - `duplicate`: the same `claimId` already exists. It is the same logical
 *   attempt; it never authorizes a second start.
 * - `already_claimed`: a different `claimId` owns the experiment. It never
 *   authorizes a start, regardless of active/expired/closed.
 */
export type ClaimExecutionStartOutcome =
  | 'claimed'
  | 'duplicate'
  | 'already_claimed'

export type ClaimExecutionStartInput = {
  experimentId: string
  workspaceId: string
  /** Caller-supplied idempotency key (UUID), stable for one logical attempt. */
  claimId: string
  /** Lease length in milliseconds. Expiry is observed, never renewed. */
  ttlMs: number
}

export type ClaimExecutionStartResult = {
  outcome: ClaimExecutionStartOutcome
  claim: ExecutionClaimView
}

export type GetExecutionClaimInput = {
  experimentId: string
  workspaceId: string
}

export type AppendPipelineEventInput = {
  experimentId: string
  workspaceId: string
  event: PipelineEventInput
}

export type ReplayPipelineEventsInput = {
  experimentId: string
  workspaceId: string
  /** Exclusive cursor: only rows with `seq > afterSeq`. Defaults to 0. */
  afterSeq?: number
  /** Page size, 1..1000. Defaults to 500. */
  limit?: number
}

export type ReplayPipelineEventsResult = {
  events: PipelineEvent[]
  /** Highest persisted seq for the experiment; 0 when the log is empty. */
  headSeq: number
  hasMore: boolean
}

export type OpenApprovalGateInput = {
  experimentId: string
  workspaceId: string
  /** The active claim that owns this gate. */
  claimId: string
  /** Opens a subsequent gate for a failed run in the same experiment. */
  repairParentRunId?: string
  /** The exact plan version offered to the human. */
  spec: ExperimentSpec
}

export type ApprovalGateView = {
  id: string
  experimentId: string
  workspaceId: string
  executionClaimId: string
  /** The seq of the persisted `approval.requested` event: the gate identity. */
  gateSeq: number
  status: ApprovalGateStatus
  offeredSpec: ExperimentSpec
  decidedBy: string | null
  decidedAt: Date | null
  /** The seq of the persisted `approval.resolved` event, when decided. */
  decisionEventSeq: number | null
  createdAt: Date
  claim: {
    active: boolean
    expired: boolean
    closedAt: Date | null
    closeReason: ExecutionClaimCloseReason | null
  }
}

export type OpenApprovalGateResult = {
  gate: ApprovalGateView
  event: ApprovalRequestedEvent
  /**
   * `false` when an identical pending gate already existed and was returned.
   * No second event was written in that case.
   */
  created: boolean
}

export type ApprovalDecision = 'approved' | 'rejected'

export type DecideApprovalInput = {
  experimentId: string
  workspaceId: string
  /** Exact gate identity from the `approval.requested` event. */
  gateSeq: number
  decision: ApprovalDecision
  /** Verified actor id supplied by the transport; never inferred here. */
  actorId: string
}

export type DecideApprovalResult = {
  /** `replayed` means an identical decision was already recorded. */
  outcome: 'decided' | 'replayed'
  decision: ApprovalDecision
  gate: ApprovalGateView
  event: ApprovalResolvedEvent
}

export type GetApprovalGateInput = {
  experimentId: string
  workspaceId: string
  /** Optional exact gate; omitted means the latest gate for the experiment. */
  gateSeq?: number
}

/** The cross-request source the SSE handler polls (docs/01-architecture.md). */
export type ExperimentApprovalView = {
  approvalState: ApprovalState
  approvedBy: string | null
  approvedAt: Date | null
}

export type GetExperimentApprovalStateInput = {
  experimentId: string
  workspaceId: string
}
