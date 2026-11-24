/**
 * Timings for one pipeline delivery stream.
 *
 * The defaults are the product decisions in docs/01-architecture.md (#33):
 * a 240-second response budget, a 15-second heartbeat, and a 500 ms poll of
 * `experiments.approval_state`. They are injectable only so tests can exercise
 * expiry without waiting four minutes; production never overrides them.
 *
 * `claimTtlMs` is the execution-claim lease. It must outlive the response
 * budget, because a decision near the 240-second mark must still find an
 * unexpired claim. The extra minute is the margin.
 */
import {
  APPROVAL_POLL_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  STREAM_BUDGET_MS,
} from '../pipeline-transport'

/** Follower streams poll the durable event log at the same cadence. */
export const EVENT_POLL_INTERVAL_MS = 500

/** The claim must not expire before the stream budget does. */
export const CLAIM_TTL_MARGIN_MS = 60_000

export type PipelineTimings = {
  /** Hard response budget, after which the pipeline fails. */
  budgetMs: number
  /** SSE comment cadence so idle proxies do not drop the connection. */
  heartbeatIntervalMs: number
  /** `experiments.approval_state` poll cadence while waiting at the gate. */
  approvalPollIntervalMs: number
  /** Durable event poll cadence for reconnect/follower streams. */
  eventPollIntervalMs: number
  /** Execution-claim lease length. */
  claimTtlMs: number
}

export const DEFAULT_PIPELINE_TIMINGS: Readonly<PipelineTimings> = {
  budgetMs: STREAM_BUDGET_MS,
  heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  approvalPollIntervalMs: APPROVAL_POLL_INTERVAL_MS,
  eventPollIntervalMs: EVENT_POLL_INTERVAL_MS,
  claimTtlMs: STREAM_BUDGET_MS + CLAIM_TTL_MARGIN_MS,
}

function requirePositiveInteger(value: unknown, name: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new TypeError(`${name} must be a positive integer`)
  }
  return value
}

/** Merges overrides onto the mandated defaults and validates every value. */
export function resolveTimings(
  overrides: Partial<PipelineTimings> | undefined,
): PipelineTimings {
  const merged: PipelineTimings = {
    ...DEFAULT_PIPELINE_TIMINGS,
    ...(overrides ?? {}),
  }

  for (const [name, value] of Object.entries(merged)) {
    requirePositiveInteger(value, name)
  }

  if (merged.claimTtlMs <= merged.budgetMs) {
    throw new TypeError('claimTtlMs must be greater than budgetMs')
  }

  return merged
}
