import { describe, expect, it } from 'vitest'
import {
  APPROVAL_POLL_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  STREAM_BUDGET_MS,
} from '../pipeline-transport'
import {
  DEFAULT_PIPELINE_TIMINGS,
  resolveTimings,
} from './timings'

describe('pipeline delivery timings', () => {
  it('uses the mandated budget, heartbeat and approval poll', () => {
    expect(DEFAULT_PIPELINE_TIMINGS.budgetMs).toBe(240_000)
    expect(DEFAULT_PIPELINE_TIMINGS.heartbeatIntervalMs).toBe(15_000)
    expect(DEFAULT_PIPELINE_TIMINGS.approvalPollIntervalMs).toBe(500)

    // And they are literally the #33 primitives, not a second copy.
    expect(DEFAULT_PIPELINE_TIMINGS.budgetMs).toBe(STREAM_BUDGET_MS)
    expect(DEFAULT_PIPELINE_TIMINGS.heartbeatIntervalMs).toBe(
      HEARTBEAT_INTERVAL_MS,
    )
    expect(DEFAULT_PIPELINE_TIMINGS.approvalPollIntervalMs).toBe(
      APPROVAL_POLL_INTERVAL_MS,
    )
  })

  it('leases the execution claim beyond the response budget', () => {
    expect(DEFAULT_PIPELINE_TIMINGS.claimTtlMs).toBeGreaterThan(
      DEFAULT_PIPELINE_TIMINGS.budgetMs,
    )
  })

  it('returns the defaults when no override is supplied', () => {
    expect(resolveTimings(undefined)).toEqual(DEFAULT_PIPELINE_TIMINGS)
  })

  it('merges a partial override', () => {
    const timings = resolveTimings({ budgetMs: 1_000, claimTtlMs: 2_000 })
    expect(timings.budgetMs).toBe(1_000)
    expect(timings.claimTtlMs).toBe(2_000)
    expect(timings.approvalPollIntervalMs).toBe(
      APPROVAL_POLL_INTERVAL_MS,
    )
  })

  it('refuses a claim lease that expires before the budget', () => {
    expect(() =>
      resolveTimings({ budgetMs: 1_000, claimTtlMs: 1_000 }),
    ).toThrow(/claimTtlMs must be greater than budgetMs/)
  })

  it('refuses non-positive values', () => {
    expect(() => resolveTimings({ heartbeatIntervalMs: 0 })).toThrow(
      /heartbeatIntervalMs must be a positive integer/,
    )
  })
})
