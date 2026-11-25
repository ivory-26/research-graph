/**
 * Test-only SSE consumer.
 *
 * Pumps a `Response` body, parses `id:`/`data:` frames and heartbeat comments,
 * and lets a test await a specific event while the stream is still open (which
 * is how the approval POST is exercised as an independently committed write).
 */
import type { PipelineEvent } from '../../../shared/events'

type EventWaiter = {
  predicate: (event: PipelineEvent) => boolean
  resolve: (event: PipelineEvent) => void
  reject: (error: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

type CloseWaiter = {
  resolve: () => void
  reject: (error: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

export type SseConsumer = {
  readonly events: PipelineEvent[]
  readonly comments: string[]
  isClosed(): boolean
  waitFor(
    predicate: (event: PipelineEvent) => boolean,
    timeoutMs?: number,
  ): Promise<PipelineEvent>
  waitForClose(timeoutMs?: number): Promise<void>
  cancel(): Promise<void>
}

export function consumeSse(response: Response): SseConsumer {
  const body = response.body
  if (!body) throw new Error('SSE response has no body')

  const reader = body.getReader()
  const decoder = new TextDecoder()

  const events: PipelineEvent[] = []
  const comments: string[] = []
  const eventWaiters = new Set<EventWaiter>()
  const closeWaiters = new Set<CloseWaiter>()

  let buffer = ''
  let closed = false
  let readError: unknown = null

  const settle = (): void => {
    for (const waiter of [...eventWaiters]) {
      const match = events.find(waiter.predicate)
      if (match) {
        clearTimeout(waiter.timer)
        eventWaiters.delete(waiter)
        waiter.resolve(match)
      }
    }

    if (closed) {
      for (const waiter of [...closeWaiters]) {
        clearTimeout(waiter.timer)
        closeWaiters.delete(waiter)
        if (readError !== null) waiter.reject(readError)
        else waiter.resolve()
      }
    }
  }

  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let boundary = buffer.indexOf('\n\n')
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          boundary = buffer.indexOf('\n\n')
          if (!frame) continue

          const lines = frame.split('\n')
          const commentLines = lines.filter((line) => line.startsWith(':'))
          const dataLines = lines.filter((line) => line.startsWith('data:'))

          if (dataLines.length === 0) {
            for (const line of commentLines) {
              comments.push(line.slice(1).trim())
            }
            continue
          }

          const data = dataLines
            .map((line) => line.slice(5).trimStart())
            .join('\n')
          events.push(JSON.parse(data) as PipelineEvent)
          settle()
        }
      }
    } catch (error) {
      readError = error
    } finally {
      closed = true
      settle()
    }
  })()

  return {
    events,
    comments,

    isClosed() {
      return closed
    },

    waitFor(predicate, timeoutMs = 5_000) {
      const existing = events.find(predicate)
      if (existing) return Promise.resolve(existing)
      if (closed) {
        return Promise.reject(
          readError ?? new Error('SSE stream closed before the expected event'),
        )
      }

      return new Promise<PipelineEvent>((resolve, reject) => {
        const waiter: EventWaiter = {
          predicate,
          resolve,
          reject,
          timer: setTimeout(() => {
            eventWaiters.delete(waiter)
            reject(new Error('timed out waiting for an SSE event'))
          }, timeoutMs),
        }
        eventWaiters.add(waiter)
      })
    },

    waitForClose(timeoutMs = 5_000) {
      if (closed) {
        return readError !== null
          ? Promise.reject(readError)
          : Promise.resolve()
      }

      return new Promise<void>((resolve, reject) => {
        const waiter: CloseWaiter = {
          resolve,
          reject,
          timer: setTimeout(() => {
            closeWaiters.delete(waiter)
            reject(new Error('timed out waiting for the SSE stream to close'))
          }, timeoutMs),
        }
        closeWaiters.add(waiter)
      })
    },

    cancel() {
      return reader.cancel()
    },
  }
}
