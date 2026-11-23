import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PipelineEvent } from '../../shared/events.ts'
import {
  SSE_HEADERS,
  SSE_HEARTBEAT_FRAME,
  formatSseEvent,
  parseLastEventId,
} from './sse.ts'

const started: PipelineEvent = {
  seq: 1,
  experimentId: 'experiment-1',
  at: '2026-11-23T10:00:00.000Z',
  type: 'pipeline.started',
  mode: 'adapted',
}

test('frames an event with seq as the id and the typed event as the payload', () => {
  const frame = formatSseEvent(started)

  assert.equal(frame, `id: 1\ndata: ${JSON.stringify(started)}\n\n`)

  const lines = frame.slice(0, -2).split('\n')
  assert.equal(lines.length, 2)
  assert.equal(lines[0], 'id: 1')
  assert.deepEqual(JSON.parse(lines[1]!.slice('data: '.length)), started)
})

test('frames a nested payload without dropping fields', () => {
  const event: PipelineEvent = {
    seq: 42,
    experimentId: 'experiment-1',
    at: '2026-11-23T10:00:01.000Z',
    type: 'node.upserted',
    node: {
      id: 'node-1',
      type: 'claim',
      title: 'Impurity importance is biased',
      sourceId: 'source-1',
      data: {
        type: 'claim',
        text: 'Impurity-based importance favours high-cardinality features.',
        reported: null,
        datasetName: null,
        methodName: null,
        locator: { page: 3, quote: 'bias toward predictors with many categories' },
      },
    },
  }

  const payload = JSON.parse(formatSseEvent(event).split('\n')[1]!.slice('data: '.length))
  assert.deepEqual(payload, event)
})

test('keeps newlines inside a payload field out of the protocol', () => {
  const event: PipelineEvent = {
    seq: 9,
    experimentId: 'experiment-1',
    at: '2026-11-23T10:00:02.000Z',
    type: 'run.failed',
    runId: 'run-1',
    error: 'Traceback (most recent call last):\nValueError: bad column',
  }

  const frame = formatSseEvent(event)

  // Exactly the three framing newlines: id line, data line, terminating blank.
  assert.equal((frame.match(/\n/g) ?? []).length, 3)
  assert.deepEqual(JSON.parse(frame.split('\n')[1]!.slice('data: '.length)), event)
})

test('rejects a seq that cannot be an SSE id', () => {
  for (const seq of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => formatSseEvent({ ...started, seq }),
      (error: unknown) => error instanceof TypeError,
      `seq ${String(seq)} should be rejected`,
    )
  }
})

test('parses a valid Last-Event-ID cursor', () => {
  assert.equal(parseLastEventId('0'), 0)
  assert.equal(parseLastEventId('7'), 7)
  assert.equal(parseLastEventId(' 42 '), 42)
  assert.equal(parseLastEventId('007'), 7)
  assert.equal(parseLastEventId(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER)
})

test('returns null for an absent or unusable Last-Event-ID', () => {
  for (const header of [
    null,
    undefined,
    '',
    '   ',
    'abc',
    '-1',
    '+1',
    '1.0',
    '1e3',
    '0x10',
    '12abc',
    '9007199254740992',
  ]) {
    assert.equal(parseLastEventId(header), null, `header ${String(header)} should not parse`)
  }
})

test('the heartbeat frame is a comment, not an event', () => {
  assert.equal(SSE_HEARTBEAT_FRAME, ': heartbeat\n\n')
  assert.ok(!SSE_HEARTBEAT_FRAME.includes('data:'))
  assert.ok(!SSE_HEARTBEAT_FRAME.includes('id:'))
})

test('event-stream headers prevent caching and transformation', () => {
  assert.equal(SSE_HEADERS['content-type'], 'text/event-stream; charset=utf-8')
  assert.match(SSE_HEADERS['cache-control'], /no-cache/)
  assert.match(SSE_HEADERS['cache-control'], /no-transform/)
  assert.equal(SSE_HEADERS['x-accel-buffering'], 'no')
})
