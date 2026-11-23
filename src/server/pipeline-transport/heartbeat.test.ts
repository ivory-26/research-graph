import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { HEARTBEAT_INTERVAL_MS } from './constants.ts'
import { startHeartbeat } from './heartbeat.ts'
import { SSE_HEARTBEAT_FRAME } from './sse.ts'

test('the prescribed heartbeat interval is 15 seconds', () => {
  assert.equal(HEARTBEAT_INTERVAL_MS, 15_000)
})

test('writes the heartbeat comment every 15 seconds', (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setInterval'] })

  const frames: string[] = []
  const stop = startHeartbeat((frame) => frames.push(frame))

  mock.timers.tick(HEARTBEAT_INTERVAL_MS - 1)
  assert.deepEqual(frames, [])

  mock.timers.tick(1)
  assert.deepEqual(frames, [SSE_HEARTBEAT_FRAME])

  mock.timers.tick(HEARTBEAT_INTERVAL_MS)
  assert.equal(frames.length, 2)

  stop()
  mock.timers.tick(HEARTBEAT_INTERVAL_MS * 4)
  assert.equal(frames.length, 2)
})

test('honours a custom interval and stops idempotently', (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setInterval'] })

  const frames: string[] = []
  const stop = startHeartbeat((frame) => frames.push(frame), { intervalMs: 1_000 })

  mock.timers.tick(1_000)
  assert.equal(frames.length, 1)

  stop()
  stop()
  mock.timers.tick(10_000)
  assert.equal(frames.length, 1)
})
