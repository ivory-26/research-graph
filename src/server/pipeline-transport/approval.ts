import type { ApprovalState } from '../../shared/types.ts'
import { APPROVAL_POLL_INTERVAL_MS } from './constants.ts'

/**
 * One read of the durable approval gate. The handler binds this to the
 * experiment id and to `experiments.approval_state` / `approved_by`; nothing
 * here holds approval state in memory, because the approve request can land on
 * a different instance than the stream.
 */
export type ReadApproval = () => Promise<ApprovalSnapshot>

export type ApprovalSnapshot = {
  state: ApprovalState
  approvedBy: string | null
}

/** The two states that end the gate. A rejection ends the run as cancelled. */
export type ResolvedApproval = {
  state: 'approved' | 'rejected'
  approvedBy: string | null
}

export type SleepUntilNextPoll = (ms: number, signal: AbortSignal | undefined) => Promise<void>

export type WaitForApprovalOptions = {
  /** Aborts the wait; rejection carries `signal.reason`. */
  signal?: AbortSignal
  /** Gap between completed reads. Defaults to the prescribed 500ms. */
  intervalMs?: number
  /** Test seam. Defaults to `abortableSleep`. */
  sleep?: SleepUntilNextPoll
}

/**
 * Polls the durable approval row until it leaves `pending`.
 *
 * Reads are sequential: at most one query is in flight, and the next one
 * starts `intervalMs` after the previous read settles, so a slow database
 * cannot produce overlapping polls. The first read is immediate, which also
 * catches an approval that landed just before the stream reached the gate.
 *
 * Aborting rejects with the signal's reason, including while sleeping between
 * polls. Reader errors propagate: a failed durable read means the stream does
 * not know whether the run was approved, and guessing is worse than failing.
 */
export async function waitForApproval(
  readApproval: ReadApproval,
  options: WaitForApprovalOptions = {},
): Promise<ResolvedApproval> {
  const signal = options.signal
  const intervalMs = options.intervalMs ?? APPROVAL_POLL_INTERVAL_MS
  const sleep = options.sleep ?? abortableSleep

  for (;;) {
    throwIfAborted(signal)
    const snapshot = await readApproval()
    throwIfAborted(signal)

    if (snapshot.state === 'approved' || snapshot.state === 'rejected') {
      return { state: snapshot.state, approvedBy: snapshot.approvedBy }
    }
    // `approval_state` is a text column today, so guard against a value the
    // union does not know rather than polling forever on a typo.
    if (snapshot.state !== 'pending') {
      throw new Error(`unknown approval state: ${String(snapshot.state)}`)
    }

    await sleep(intervalMs, signal)
  }
}

/** setTimeout that rejects as soon as the signal aborts. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason)
  if (!signal) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason
}
