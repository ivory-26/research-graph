import type { PipelineEvent } from '../../shared/events.ts'

/**
 * The SSE wire format for the pipeline stream.
 *
 * Each persisted `PipelineEvent` is framed with `event.seq` as the SSE id and
 * the whole event as JSON in `data:` (src/shared/events.ts). The discriminant
 * stays in the payload; no `event:` field is emitted, so a plain
 * `EventSource.onmessage` receives every event and the frozen union remains the
 * single source of truth for the type.
 */

/** A comment, not an event: no id and no data, so clients ignore it. */
export const SSE_HEARTBEAT_FRAME = ': heartbeat\n\n'

export const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  // no-transform stops proxies from compressing or buffering the stream.
  'cache-control': 'no-cache, no-transform',
  // nginx-flavoured intermediaries honour this; Vercel ignores it.
  'x-accel-buffering': 'no',
} as const

/**
 * Frames one event. `seq` is the reconnect cursor: browsers send it back as
 * `Last-Event-ID` when EventSource retries.
 */
export function formatSseEvent(event: PipelineEvent): string {
  assertValidSeq(event.seq)
  // JSON.stringify never emits a raw newline, so the payload stays on one
  // `data:` line even when a field contains "\n".
  return `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`
}

/**
 * Parses a `Last-Event-ID` header into the seq the stream should resume after.
 *
 * Returns null when the header is absent, blank, or not a decimal integer, so
 * the caller decides whether an unusable cursor means "replay from the start"
 * or "start at the head". Ids are assigned by `formatSseEvent`, so anything
 * else is a client bug, not a cursor to guess at.
 */
export function parseLastEventId(header: string | null | undefined): number | null {
  if (header == null) return null
  const value = header.trim()
  if (!/^\d+$/.test(value)) return null
  const seq = Number(value)
  return Number.isSafeInteger(seq) ? seq : null
}

function assertValidSeq(seq: number): void {
  if (!Number.isSafeInteger(seq) || seq < 0) {
    throw new TypeError(`pipeline event seq must be a non-negative safe integer, got ${String(seq)}`)
  }
}
