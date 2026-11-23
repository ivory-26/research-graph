import { HEARTBEAT_INTERVAL_MS } from './constants.ts'
import { SSE_HEARTBEAT_FRAME } from './sse.ts'

export type HeartbeatOptions = {
  intervalMs?: number
}

/**
 * Writes the heartbeat comment every `intervalMs` (15s by default) until the
 * returned stop function is called. The caller owns the stream and must stop
 * the heartbeat before closing it.
 */
export function startHeartbeat(
  write: (frame: string) => void,
  options: HeartbeatOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? HEARTBEAT_INTERVAL_MS
  const timer = setInterval(() => write(SSE_HEARTBEAT_FRAME), intervalMs)
  return () => clearInterval(timer)
}
