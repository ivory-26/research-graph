/**
 * The pipeline DB layer transport code should import.
 *
 * It provides four things and nothing else:
 *
 * 1. Durable, ordered, per-experiment event append/replay (`appendPipelineEvent`,
 *    `replayPipelineEvents`), with a strictly exclusive cursor.
 * 2. One execution-start claim per experiment (`claimExecutionStart`,
 *    `getExecutionClaim`). Only `outcome: 'claimed'` authorizes a start.
 * 3. Exactly-once approval decisions bound to one gate seq and one active
 *    claim (`openApprovalGate`, `decideApproval`).
 * 4. Reads of the cross-request approval source (`getApprovalGate`,
 *    `getExperimentApprovalState`).
 *
 * It does not create `runs`, compute verdicts, run stages, authenticate users,
 * or emit HTTP. Those belong to #7 and the route layer.
 *
 * Example:
 *
 * ```ts
 * const db = getDb()
 * const claim = await claimExecutionStart(db, {
 *   experimentId,
 *   workspaceId,
 *   claimId: crypto.randomUUID(),
 *   ttlMs: 300_000,
 * })
 * if (claim.outcome !== 'claimed') {
 *   // replay events, do not start a run
 * }
 * ```
 */
export {
  appendPipelineEvent,
  replayPipelineEvents,
} from './pipeline-events'

export {
  claimExecutionStart,
  getExecutionClaim,
} from './pipeline-claims'

export {
  decideApproval,
  getApprovalGate,
  getExperimentApprovalState,
  openApprovalGate,
} from './pipeline-approval'

export {
  PIPELINE_DB_ERROR_CODES,
  PIPELINE_EVENT_TYPES,
  PipelineDbError,
  RESERVED_APPEND_EVENT_TYPES,
  TERMINAL_PIPELINE_EVENT_TYPES,
} from './pipeline-validation'

export type {
  PipelineDbErrorCode,
  PipelineEventInput,
  TerminalPipelineEventType,
} from './pipeline-validation'

export type { ApprovalGateStatus, ExecutionClaimCloseReason } from './schema'

export type {
  AppendPipelineEventInput,
  ApprovalDecision,
  ApprovalGateView,
  ClaimExecutionStartInput,
  ClaimExecutionStartOutcome,
  ClaimExecutionStartResult,
  DecideApprovalInput,
  DecideApprovalResult,
  ExecutionClaimView,
  ExperimentApprovalView,
  GetApprovalGateInput,
  GetExecutionClaimInput,
  GetExperimentApprovalStateInput,
  OpenApprovalGateInput,
  OpenApprovalGateResult,
  ReplayPipelineEventsInput,
  ReplayPipelineEventsResult,
} from './pipeline-types'
