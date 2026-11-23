/**
 * Transport primitives for `GET /api/pipeline/:experimentId`.
 *
 * The endpoint itself, the pipeline that produces events, and the durable
 * readers this module consumes all live elsewhere; these pieces only know the
 * frozen contracts in src/shared and the timings in docs/01-architecture.md.
 */
export {
  APPROVAL_POLL_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  STREAM_BUDGET_MS,
} from './constants.ts'

export {
  SSE_HEADERS,
  SSE_HEARTBEAT_FRAME,
  formatSseEvent,
  parseLastEventId,
} from './sse.ts'

export { startHeartbeat } from './heartbeat.ts'
export type { HeartbeatOptions } from './heartbeat.ts'

export { abortableSleep, waitForApproval } from './approval.ts'
export type {
  ApprovalSnapshot,
  ReadApproval,
  ResolvedApproval,
  SleepUntilNextPoll,
  WaitForApprovalOptions,
} from './approval.ts'

export { StreamBudgetExceededError, createStreamBudget } from './budget.ts'
export type { StreamBudget } from './budget.ts'
