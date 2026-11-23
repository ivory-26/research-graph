import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import {
  abortableSleep,
  waitForApproval,
  type ApprovalSnapshot,
} from './approval.ts'
import { APPROVAL_POLL_INTERVAL_MS } from './constants.ts'

const pending: ApprovalSnapshot = { state: 'pending', approvedBy: null }
const approved: ApprovalSnapshot = { state: 'approved', approvedBy: 'user-1' }
const rejected: ApprovalSnapshot = { state: 'rejected', approvedBy: 'user-2' }

test('the prescribed approval poll cadence is 500ms', () => {
  assert.equal(APPROVAL_POLL_INTERVAL_MS, 500)
})

test('reads immediately, then every 500ms, until the durable row is approved', async () => {
  // The resolution comes from a different request; the poller only sees it
  // through the supplied durable reader, never through shared memory.
  const order: string[] = []
  let reads = 0

  const result = await waitForApproval(
    async () => {
      order.push('read')
      reads += 1
      return reads < 3 ? pending : approved
    },
    {
      sleep: async (ms) => {
        order.push(`sleep:${ms}`)
      },
    },
  )

  assert.deepEqual(result, { state: 'approved', approvedBy: 'user-1' })
  assert.equal(reads, 3)
  assert.deepEqual(order, ['read', 'sleep:500', 'read', 'sleep:500', 'read'])
})

test('observes a rejection committed after polling starts', async () => {
  // One durable row, mutated between polls as if by a different request.
  const durableRow: ApprovalSnapshot = { state: 'pending', approvedBy: null }
  let reads = 0

  const result = await waitForApproval(
    async () => {
      reads += 1
      if (reads === 2) {
        durableRow.state = 'rejected'
        durableRow.approvedBy = 'user-2'
      }
      return { ...durableRow }
    },
    { sleep: async () => {} },
  )

  assert.deepEqual(result, { state: 'rejected', approvedBy: 'user-2' })
  assert.equal(reads, 2)
})

test('returns a rejection so the pipeline can end the run as cancelled', async () => {
  const result = await waitForApproval(async () => rejected, {
    sleep: async () => {
      throw new Error('a resolved gate must not sleep')
    },
  })

  assert.deepEqual(result, { state: 'rejected', approvedBy: 'user-2' })
})

test('honours a custom poll interval', async () => {
  const delays: number[] = []
  let reads = 0

  await waitForApproval(
    async () => {
      reads += 1
      return reads === 1 ? pending : approved
    },
    {
      intervalMs: 50,
      sleep: async (ms) => {
        delays.push(ms)
      },
    },
  )

  assert.deepEqual(delays, [50])
})

test('rejects immediately when the signal is already aborted', async () => {
  const controller = new AbortController()
  const reason = new Error('client disconnected')
  controller.abort(reason)
  let read = false

  await assert.rejects(
    waitForApproval(
      async () => {
        read = true
        return approved
      },
      { signal: controller.signal },
    ),
    (error: unknown) => error === reason,
  )
  assert.equal(read, false)
})

test('rejects with the abort reason while sleeping, before another read', async () => {
  const controller = new AbortController()
  const reason = new Error('budget exhausted')
  let reads = 0

  await assert.rejects(
    waitForApproval(
      async () => {
        reads += 1
        return pending
      },
      {
        signal: controller.signal,
        sleep: async () => {
          controller.abort(reason)
        },
      },
    ),
    (error: unknown) => error === reason,
  )

  assert.equal(reads, 1)
})

test('rejects with the abort reason when the signal aborts during a read', async () => {
  const controller = new AbortController()
  const reason = new Error('stream cancelled')
  let resolveRead: ((snapshot: ApprovalSnapshot) => void) | undefined

  const waiting = waitForApproval(
    () =>
      new Promise<ApprovalSnapshot>((resolve) => {
        resolveRead = resolve
      }),
    {
      signal: controller.signal,
      sleep: async () => {
        throw new Error('an aborted gate must not sleep')
      },
    },
  )

  controller.abort(reason)
  resolveRead!(pending)

  await assert.rejects(waiting, (error: unknown) => error === reason)
})

test('propagates a reader failure instead of polling past it', async () => {
  const failure = new Error('database unavailable')
  let sleeps = 0

  await assert.rejects(
    waitForApproval(
      async () => {
        throw failure
      },
      {
        sleep: async () => {
          sleeps += 1
        },
      },
    ),
    (error: unknown) => error === failure,
  )
  assert.equal(sleeps, 0)
})

test('fails fast on an approval state the union does not know', async () => {
  const bogus = { state: 'approve', approvedBy: null } as unknown as ApprovalSnapshot

  await assert.rejects(waitForApproval(async () => bogus), /unknown approval state: approve/)
})

test('abortableSleep resolves after the delay', async (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout'] })

  let resolved = false
  const sleeping = abortableSleep(500).then(() => {
    resolved = true
  })

  mock.timers.tick(499)
  assert.equal(resolved, false)

  mock.timers.tick(1)
  await sleeping
  assert.equal(resolved, true)
})

test('abortableSleep rejects with the abort reason and clears its timer', async (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout'] })

  const controller = new AbortController()
  const reason = new Error('disconnected')
  const sleeping = abortableSleep(60_000, controller.signal)

  controller.abort(reason)
  await assert.rejects(sleeping, (error: unknown) => error === reason)

  // The cleared timer must not fire after the rejection.
  mock.timers.tick(60_000)
})

test('abortableSleep rejects immediately when the signal is already aborted', async () => {
  const controller = new AbortController()
  const reason = new Error('already gone')
  controller.abort(reason)

  await assert.rejects(abortableSleep(1_000, controller.signal), (error: unknown) => error === reason)
})
