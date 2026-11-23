/**
 * Timings mandated by docs/01-architecture.md for the pipeline SSE endpoint.
 *
 * These are product decisions, not tuning knobs: the 240-second budget keeps
 * the response under Vercel Hobby's 300-second function ceiling, and the 15s
 * heartbeat keeps intermediaries from dropping an idle approval gate.
 */
export const STREAM_BUDGET_MS = 240_000

export const HEARTBEAT_INTERVAL_MS = 15_000

/** docs/01-architecture.md: the stream polls `experiments.approval_state`. */
export const APPROVAL_POLL_INTERVAL_MS = 500
