/**
 * SSE timing contract shared by the transport and the browser watchdog.
 * The 240-second budget fits under the function ceiling. The 15-second
 * heartbeat keeps intermediaries from dropping idle approval gates.
 */
export const STREAM_BUDGET_MS = 240_000
export const HEARTBEAT_INTERVAL_MS = 15_000
