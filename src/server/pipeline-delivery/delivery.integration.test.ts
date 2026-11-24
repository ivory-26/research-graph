/**
 * App-layer integration tests for the pipeline delivery handlers.
 *
 * These run the real `Request -> Response` handlers against a real Postgres
 * database (the committed migrations in `src/db/migrations`, real constraints,
 * real transactions). The stage provider is a disclosed test fixture because
 * the runtime workstream (#23/#24/#25) is not on main. The approval is written
 * by a separate handler call, which is the cross-request case #6 exists for.
 *
 * Skipped unless `TEST_DATABASE_URL` is set. The URL names a *server*; the
 * harness creates a uniquely named, disposable database on it, migrates only
 * that database, and drops only that database. The database named in the URL
 * is never migrated or truncated. See `test-support/pg.ts` for the checks and
 * the local pgvector command.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'
import type { PipelineEvent } from '../../shared/events'
import {
  createPipelineHandlers,
  type PipelineHandlerDeps,
} from './handlers'
import { createDrizzlePipelineData } from './data'
import type { PipelineTimings } from './timings'
import {
  createFixtureStages,
  type FixtureStages,
} from './test-support/fixture-stages'
import {
  createTestDatabase,
  seedWorkspace,
  type SeededWorkspace,
  type TestDatabase,
} from './test-support/pg'
import {
  consumeSse,
  type SseConsumer,
} from './test-support/sse'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip

const ORIGIN = 'http://localhost'

const FAST_TIMINGS: Partial<PipelineTimings> = {
  budgetMs: 5_000,
  heartbeatIntervalMs: 1_000,
  approvalPollIntervalMs: 20,
  eventPollIntervalMs: 20,
  claimTtlMs: 10_000,
}

describeIntegration('pipeline delivery over real Postgres', () => {
  let testDb: TestDatabase
  let seed: SeededWorkspace
  const consumers: SseConsumer[] = []

  beforeAll(async () => {
    testDb = await createTestDatabase(TEST_DATABASE_URL as string)
  })

  afterAll(async () => {
    await testDb.close()
  })

  beforeEach(async () => {
    await testDb.reset()
    seed = await seedWorkspace(testDb.pool)
  })

  afterEach(async () => {
    for (const consumer of consumers.splice(0)) {
      await consumer.cancel().catch(() => undefined)
    }
  })

  function consume(response: Response): SseConsumer {
    const consumer = consumeSse(response)
    consumers.push(consumer)
    return consumer
  }

  function streamRequest(
    experimentId: string,
    headers: Record<string, string> = {},
  ): Request {
    return new Request(`${ORIGIN}/api/pipeline/${experimentId}`, {
      method: 'GET',
      headers: { origin: ORIGIN, ...headers },
    })
  }

  function approveRequest(
    experimentId: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Request {
    return new Request(
      `${ORIGIN}/api/pipeline/${experimentId}/approve`,
      {
        method: 'POST',
        headers: {
          origin: ORIGIN,
          'content-type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(body),
      },
    )
  }

  type HandlerOptions = {
    fixture: FixtureStages
    actor?: (request: Request) => Promise<{ id: string } | null>
    timings?: Partial<PipelineTimings>
  }

  function handlersFor(options: HandlerOptions) {
    const deps: PipelineHandlerDeps = {
      data: createDrizzlePipelineData(testDb.db),
      readActor:
        options.actor ??
        (async () => ({ id: seed.memberId })),
      stages: options.fixture.stages,
      timings: options.timings ?? FAST_TIMINGS,
    }
    return createPipelineHandlers(deps)
  }

  async function countEvents(
    experimentId: string,
    type: string,
  ): Promise<number> {
    const result = await testDb.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM pipeline_events
        WHERE experiment_id = $1 AND type = $2`,
      [experimentId, type],
    )
    return Number(result.rows[0]?.count ?? 0)
  }

  async function getClaim(experimentId: string) {
    const result = await testDb.pool.query<{
      closed_at: Date | null
      close_reason: string | null
    }>(
      `SELECT closed_at, close_reason
         FROM execution_claims
        WHERE experiment_id = $1`,
      [experimentId],
    )
    return result.rows[0] ?? null
  }

  async function getGate(experimentId: string) {
    const result = await testDb.pool.query<{
      gate_seq: number
      status: string
      decided_by: string | null
      decision_event_seq: number | null
    }>(
      `SELECT gate_seq, status, decided_by, decision_event_seq
         FROM approval_gates
        WHERE experiment_id = $1`,
      [experimentId],
    )
    return result.rows[0] ?? null
  }

  async function getExperiment(experimentId: string) {
    const result = await testDb.pool.query<{
      approval_state: string
      approved_by: string | null
    }>(
      `SELECT approval_state, approved_by
         FROM experiments
        WHERE id = $1`,
      [experimentId],
    )
    return result.rows[0] ?? null
  }

  it('survives an approval posted by a different request and executes exactly once', async () => {
    const fixture = createFixtureStages({ spec: seed.spec })
    const handlers = handlersFor({ fixture })

    const response = await handlers.stream(
      streamRequest(seed.experimentId),
      { experimentId: seed.experimentId },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const sse = consume(response)
    const requested = await sse.waitFor(
      (event) => event.type === 'approval.requested',
    )
    expect(fixture.executeCalls).toBe(0)

    // A separate request, committed in its own transaction.
    const approved = await handlers.approve(
      approveRequest(seed.experimentId, {
        gateSeq: requested.seq,
        decision: 'approved',
      }),
      { experimentId: seed.experimentId },
    )
    expect(approved.status).toBe(200)
    const approvedBody = (await approved.json()) as Record<string, unknown>
    expect(approvedBody).toMatchObject({
      outcome: 'decided',
      decision: 'approved',
      gateSeq: requested.seq,
      approvedBy: seed.memberId,
    })

    const completed = (await sse.waitFor(
      (event) => event.type === 'pipeline.completed',
    )) as Extract<PipelineEvent, { type: 'pipeline.completed' }>
    await sse.waitForClose()

    expect(completed.runId).toBe('run-fixture-1')
    const resolved = sse.events.find(
      (event) => event.type === 'approval.resolved',
    )
    expect(resolved).toMatchObject({
      state: 'approved',
      approvedBy: seed.memberId,
    })
    expect(sse.events.some((event) => event.type === 'run.started')).toBe(true)
    expect(fixture.executeCalls).toBe(1)

    expect(await getExperiment(seed.experimentId)).toMatchObject({
      approval_state: 'approved',
      approved_by: seed.memberId,
    })
    expect(await getGate(seed.experimentId)).toMatchObject({
      status: 'approved',
      decided_by: seed.memberId,
    })
    expect(await getClaim(seed.experimentId)).toMatchObject({
      close_reason: 'completed',
    })
  })

  it('ends a rejected approval as cancelled and never executes', async () => {
    const fixture = createFixtureStages({ spec: seed.spec })
    const handlers = handlersFor({ fixture })

    const sse = consume(
      await handlers.stream(streamRequest(seed.experimentId), {
        experimentId: seed.experimentId,
      }),
    )
    const requested = await sse.waitFor(
      (event) => event.type === 'approval.requested',
    )

    const rejected = await handlers.approve(
      approveRequest(seed.experimentId, {
        gateSeq: requested.seq,
        decision: 'rejected',
      }),
      { experimentId: seed.experimentId },
    )
    expect(rejected.status).toBe(200)

    const cancelled = (await sse.waitFor(
      (event) => event.type === 'pipeline.cancelled',
    )) as Extract<PipelineEvent, { type: 'pipeline.cancelled' }>
    await sse.waitForClose()

    expect(cancelled.reason).toBe('rejected')
    expect(fixture.executeCalls).toBe(0)
    expect(sse.events.some((event) => event.type === 'run.started')).toBe(false)

    expect(await getGate(seed.experimentId)).toMatchObject({
      status: 'rejected',
      decided_by: seed.memberId,
    })
    expect(await getExperiment(seed.experimentId)).toMatchObject({
      approval_state: 'rejected',
    })
    expect(await getClaim(seed.experimentId)).toMatchObject({
      close_reason: 'cancelled',
    })
  })

  it('creates one claim for concurrent GETs and never restarts on reconnect', async () => {
    const fixture = createFixtureStages({ spec: seed.spec })
    const handlers = handlersFor({ fixture })

    const [firstResponse, secondResponse] = await Promise.all([
      handlers.stream(streamRequest(seed.experimentId), {
        experimentId: seed.experimentId,
      }),
      handlers.stream(streamRequest(seed.experimentId), {
        experimentId: seed.experimentId,
      }),
    ])

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)

    const first = consume(firstResponse)
    const second = consume(secondResponse)

    await first.waitFor((event) => event.type === 'approval.requested')
    await second.waitFor((event) => event.type === 'approval.requested')

    expect(fixture.planCalls).toBe(1)
    expect(await countEvents(seed.experimentId, 'pipeline.started')).toBe(1)

    // A reconnect replays strictly after the supplied id and starts nothing.
    const reconnectResponse = await handlers.stream(
      streamRequest(seed.experimentId, { 'last-event-id': '1' }),
      { experimentId: seed.experimentId },
    )
    expect(reconnectResponse.status).toBe(200)
    const reconnect = consume(reconnectResponse)

    const firstReplayed = await reconnect.waitFor(() => true)
    expect(firstReplayed.seq).toBe(2)
    expect(
      reconnect.events.some((event) => event.type === 'pipeline.started'),
    ).toBe(false)

    expect(fixture.planCalls).toBe(1)
    expect(await countEvents(seed.experimentId, 'pipeline.started')).toBe(1)
  })

  it('requires a signed-in workspace member on both handlers', async () => {
    const fixture = createFixtureStages({ spec: seed.spec })

    const anonymous = handlersFor({
      fixture,
      actor: async () => null,
    })
    const anonymousGet = await anonymous.stream(
      streamRequest(seed.experimentId),
      { experimentId: seed.experimentId },
    )
    expect(anonymousGet.status).toBe(401)
    const anonymousPost = await anonymous.approve(
      approveRequest(seed.experimentId, {
        gateSeq: 1,
        decision: 'approved',
      }),
      { experimentId: seed.experimentId },
    )
    expect(anonymousPost.status).toBe(401)

    const stranger = handlersFor({
      fixture,
      actor: async () => ({ id: seed.strangerId }),
    })
    const strangerGet = await stranger.stream(
      streamRequest(seed.experimentId),
      { experimentId: seed.experimentId },
    )
    expect(strangerGet.status).toBe(403)
    const strangerPost = await stranger.approve(
      approveRequest(seed.experimentId, {
        gateSeq: 1,
        decision: 'approved',
      }),
      { experimentId: seed.experimentId },
    )
    expect(strangerPost.status).toBe(403)

    // Membership in a different workspace grants nothing.
    const outsider = handlersFor({
      fixture,
      actor: async () => ({ id: seed.outsiderId }),
    })
    const outsiderGet = await outsider.stream(
      streamRequest(seed.experimentId),
      { experimentId: seed.experimentId },
    )
    expect(outsiderGet.status).toBe(403)
    const outsiderPost = await outsider.approve(
      approveRequest(seed.experimentId, {
        gateSeq: 1,
        decision: 'approved',
      }),
      { experimentId: seed.experimentId },
    )
    expect(outsiderPost.status).toBe(403)

    // Denial happened before any durable write.
    expect(await countEvents(seed.experimentId, 'pipeline.started')).toBe(0)
    expect(await getClaim(seed.experimentId)).toBeNull()
  })

  it('rejects cross-origin requests and requires Origin on the approval POST', async () => {
    const fixture = createFixtureStages({ spec: seed.spec })
    const handlers = handlersFor({ fixture })

    const crossOrigin = await handlers.stream(
      new Request(`${ORIGIN}/api/pipeline/${seed.experimentId}`, {
        headers: { origin: 'https://evil.example' },
      }),
      { experimentId: seed.experimentId },
    )
    expect(crossOrigin.status).toBe(403)

    const noOrigin = await handlers.approve(
      new Request(
        `${ORIGIN}/api/pipeline/${seed.experimentId}/approve`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ gateSeq: 1, decision: 'approved' }),
        },
      ),
      { experimentId: seed.experimentId },
    )
    expect(noOrigin.status).toBe(403)

    expect(await countEvents(seed.experimentId, 'pipeline.started')).toBe(0)
  })

  it('binds a decision to the gate seq and the verified actor', async () => {
    const fixture = createFixtureStages({ spec: seed.spec })
    const handlers = handlersFor({ fixture })

    const sse = consume(
      await handlers.stream(streamRequest(seed.experimentId), {
        experimentId: seed.experimentId,
      }),
    )
    const requested = await sse.waitFor(
      (event) => event.type === 'approval.requested',
    )

    const wrongGate = await handlers.approve(
      approveRequest(seed.experimentId, {
        gateSeq: requested.seq + 99,
        decision: 'approved',
      }),
      { experimentId: seed.experimentId },
    )
    expect(wrongGate.status).toBe(404)

    const decided = await handlers.approve(
      approveRequest(seed.experimentId, {
        gateSeq: requested.seq,
        decision: 'approved',
      }),
      { experimentId: seed.experimentId },
    )
    expect(decided.status).toBe(200)

    const replayed = await handlers.approve(
      approveRequest(seed.experimentId, {
        gateSeq: requested.seq,
        decision: 'approved',
      }),
      { experimentId: seed.experimentId },
    )
    expect(replayed.status).toBe(200)
    expect((await replayed.json()) as Record<string, unknown>).toMatchObject({
      outcome: 'replayed',
    })

    const conflicting = await handlers.approve(
      approveRequest(seed.experimentId, {
        gateSeq: requested.seq,
        decision: 'rejected',
      }),
      { experimentId: seed.experimentId },
    )
    expect(conflicting.status).toBe(409)

    await sse.waitFor((event) => event.type === 'pipeline.completed')
    await sse.waitForClose()

    expect(await getGate(seed.experimentId)).toMatchObject({
      gate_seq: requested.seq,
      status: 'approved',
      decided_by: seed.memberId,
      decision_event_seq: requested.seq + 1,
    })
    expect(fixture.executeCalls).toBe(1)
  })

  it('ends the stream at the budget with a terminal failure and heartbeats', async () => {
    const fixture = createFixtureStages({ spec: seed.spec })
    const handlers = handlersFor({
      fixture,
      timings: {
        budgetMs: 400,
        heartbeatIntervalMs: 40,
        approvalPollIntervalMs: 20,
        eventPollIntervalMs: 20,
        claimTtlMs: 5_000,
      },
    })

    const startedAt = Date.now()
    const sse = consume(
      await handlers.stream(streamRequest(seed.experimentId), {
        experimentId: seed.experimentId,
      }),
    )

    await sse.waitFor((event) => event.type === 'approval.requested')

    const failed = (await sse.waitFor(
      (event) => event.type === 'pipeline.failed',
      5_000,
    )) as Extract<PipelineEvent, { type: 'pipeline.failed' }>
    await sse.waitForClose(5_000)

    expect(failed.error).toMatch(/budget/i)
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(
      sse.comments.some((comment) => comment.includes('heartbeat')),
    ).toBe(true)
    expect(fixture.executeCalls).toBe(0)

    expect(await getClaim(seed.experimentId)).toMatchObject({
      close_reason: 'failed',
    })
  })

  it('validates the approval body before touching the gate', async () => {
    const fixture = createFixtureStages({ spec: seed.spec })
    const handlers = handlersFor({ fixture })

    const wrongType = await handlers.approve(
      new Request(
        `${ORIGIN}/api/pipeline/${seed.experimentId}/approve`,
        {
          method: 'POST',
          headers: { origin: ORIGIN, 'content-type': 'text/plain' },
          body: 'not json',
        },
      ),
      { experimentId: seed.experimentId },
    )
    expect(wrongType.status).toBe(415)

    const badJson = await handlers.approve(
      new Request(
        `${ORIGIN}/api/pipeline/${seed.experimentId}/approve`,
        {
          method: 'POST',
          headers: { origin: ORIGIN, 'content-type': 'application/json' },
          body: '{',
        },
      ),
      { experimentId: seed.experimentId },
    )
    expect(badJson.status).toBe(400)

    const badDecision = await handlers.approve(
      approveRequest(seed.experimentId, {
        gateSeq: 1,
        decision: 'maybe',
      }),
      { experimentId: seed.experimentId },
    )
    expect(badDecision.status).toBe(400)

    const badGateSeq = await handlers.approve(
      approveRequest(seed.experimentId, {
        gateSeq: 0,
        decision: 'approved',
      }),
      { experimentId: seed.experimentId },
    )
    expect(badGateSeq.status).toBe(400)

    expect(await countEvents(seed.experimentId, 'pipeline.started')).toBe(0)
  })

  it('emits run.timeout then a terminal failure when the budget expires during EXECUTE', async () => {
    const fixture = createFixtureStages({
      spec: seed.spec,
      duringExecute: (context) =>
        new Promise<void>((_resolve, reject) => {
          if (context.signal.aborted) {
            reject(context.signal.reason)
            return
          }
          context.signal.addEventListener(
            'abort',
            () => reject(context.signal.reason),
            { once: true },
          )
        }),
    })

    const handlers = handlersFor({
      fixture,
      timings: {
        budgetMs: 800,
        heartbeatIntervalMs: 80,
        approvalPollIntervalMs: 20,
        eventPollIntervalMs: 20,
        claimTtlMs: 5_000,
      },
    })

    const sse = consume(
      await handlers.stream(streamRequest(seed.experimentId), {
        experimentId: seed.experimentId,
      }),
    )
    const requested = await sse.waitFor(
      (event) => event.type === 'approval.requested',
    )

    await handlers.approve(
      approveRequest(seed.experimentId, {
        gateSeq: requested.seq,
        decision: 'approved',
      }),
      { experimentId: seed.experimentId },
    )

    const timedOut = (await sse.waitFor(
      (event) => event.type === 'run.timeout',
      5_000,
    )) as Extract<PipelineEvent, { type: 'run.timeout' }>
    expect(timedOut.runId).toBe('run-fixture-1')
    expect(timedOut.budgetMs).toBe(800)

    const failed = (await sse.waitFor(
      (event) => event.type === 'pipeline.failed',
      5_000,
    )) as Extract<PipelineEvent, { type: 'pipeline.failed' }>
    expect(failed.error).toMatch(/budget/i)

    await sse.waitForClose(5_000)
    expect(fixture.executeCalls).toBe(1)
    expect(await getClaim(seed.experimentId)).toMatchObject({
      close_reason: 'failed',
    })
  })

  it('stops streaming at the budget even when plan ignores the abort signal', async () => {
    let releasePlan: () => void = () => undefined
    const planGate = new Promise<void>((resolve) => {
      releasePlan = resolve
    })

    const fixture = createFixtureStages({
      spec: seed.spec,
      cooperative: false,
      // Never settles until the test releases it, and never looks at `signal`.
      duringPlan: () => planGate,
    })
    const handlers = handlersFor({
      fixture,
      timings: {
        budgetMs: 500,
        heartbeatIntervalMs: 50,
        approvalPollIntervalMs: 20,
        eventPollIntervalMs: 20,
        claimTtlMs: 5_000,
      },
    })

    const sse = consume(
      await handlers.stream(streamRequest(seed.experimentId), {
        experimentId: seed.experimentId,
      }),
    )

    const failed = (await sse.waitFor(
      (event) => event.type === 'pipeline.failed',
      5_000,
    )) as Extract<PipelineEvent, { type: 'pipeline.failed' }>
    expect(failed.error).toMatch(/budget/i)
    await sse.waitForClose(5_000)

    // No run had started, so there is exactly one terminal and no timeout.
    expect(await countEvents(seed.experimentId, 'pipeline.failed')).toBe(1)
    expect(await countEvents(seed.experimentId, 'run.timeout')).toBe(0)
    expect(await countEvents(seed.experimentId, 'approval.requested')).toBe(0)
    expect(await getGate(seed.experimentId)).toBeNull()
    expect(fixture.planCalls).toBe(1)
    expect(fixture.executeCalls).toBe(0)

    // The stage returns after the deadline. Its continuation must not open a
    // gate, append an event, or write anything else.
    releasePlan()
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(await countEvents(seed.experimentId, 'pipeline.failed')).toBe(1)
    expect(await countEvents(seed.experimentId, 'approval.requested')).toBe(0)
    expect(await getGate(seed.experimentId)).toBeNull()
    expect(await getClaim(seed.experimentId)).toMatchObject({
      close_reason: 'failed',
    })
  })

  it('writes run.timeout and one terminal when execute ignores the abort signal', async () => {
    let releaseExecute: () => void = () => undefined
    const executeGate = new Promise<void>((resolve) => {
      releaseExecute = resolve
    })

    const fixture = createFixtureStages({
      spec: seed.spec,
      cooperative: false,
      duringExecute: () => executeGate,
    })
    const handlers = handlersFor({
      fixture,
      timings: {
        budgetMs: 600,
        heartbeatIntervalMs: 60,
        approvalPollIntervalMs: 20,
        eventPollIntervalMs: 20,
        claimTtlMs: 5_000,
      },
    })

    const sse = consume(
      await handlers.stream(streamRequest(seed.experimentId), {
        experimentId: seed.experimentId,
      }),
    )
    const requested = await sse.waitFor(
      (event) => event.type === 'approval.requested',
    )

    await handlers.approve(
      approveRequest(seed.experimentId, {
        gateSeq: requested.seq,
        decision: 'approved',
      }),
      { experimentId: seed.experimentId },
    )

    const timedOut = (await sse.waitFor(
      (event) => event.type === 'run.timeout',
      5_000,
    )) as Extract<PipelineEvent, { type: 'run.timeout' }>
    expect(timedOut.runId).toBe('run-fixture-1')
    expect(timedOut.budgetMs).toBe(600)

    const failed = (await sse.waitFor(
      (event) => event.type === 'pipeline.failed',
      5_000,
    )) as Extract<PipelineEvent, { type: 'pipeline.failed' }>
    expect(failed.error).toMatch(/budget/i)
    await sse.waitForClose(5_000)

    // The stage returns late and keeps going. None of its later events may be
    // persisted, and `pipeline.completed` must never appear.
    releaseExecute()
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(await countEvents(seed.experimentId, 'pipeline.completed')).toBe(0)
    expect(await countEvents(seed.experimentId, 'run.succeeded')).toBe(0)
    expect(await countEvents(seed.experimentId, 'run.timeout')).toBe(1)
    expect(await countEvents(seed.experimentId, 'pipeline.failed')).toBe(1)
    expect(await getClaim(seed.experimentId)).toMatchObject({
      close_reason: 'failed',
    })
    expect(fixture.executeCalls).toBe(1)
  })

  it('never publishes a raw provider exception in the terminal event', async () => {
    const secret = 'sk-test-provider-secret@db.internal:5432'
    const fixture = createFixtureStages({
      spec: seed.spec,
      duringPlan: async () => {
        throw new Error(`provider rejected the call (${secret})`)
      },
    })
    const handlers = handlersFor({ fixture })

    const sse = consume(
      await handlers.stream(streamRequest(seed.experimentId), {
        experimentId: seed.experimentId,
      }),
    )

    const failed = (await sse.waitFor(
      (event) => event.type === 'pipeline.failed',
      5_000,
    )) as Extract<PipelineEvent, { type: 'pipeline.failed' }>
    expect(failed.error).not.toContain('sk-test-provider-secret')
    expect(failed.error).not.toContain('db.internal')
    expect(failed.error).toMatch(/unexpectedly/i)
    await sse.waitForClose(5_000)

    const persisted = await testDb.pool.query<{
      event: Extract<PipelineEvent, { type: 'pipeline.failed' }>
    }>(
      `SELECT event
         FROM pipeline_events
        WHERE experiment_id = $1 AND type = 'pipeline.failed'`,
      [seed.experimentId],
    )
    expect(persisted.rows).toHaveLength(1)
    expect(persisted.rows[0]?.event.error).toBe(failed.error)
    expect(JSON.stringify(persisted.rows[0]?.event)).not.toContain(
      'sk-test-provider-secret',
    )
    expect(await getClaim(seed.experimentId)).toMatchObject({
      close_reason: 'failed',
    })
  })

  it('refuses to start without a stage provider and writes no claim', async () => {
    const handlers = createPipelineHandlers({
      data: createDrizzlePipelineData(testDb.db),
      readActor: async () => ({ id: seed.memberId }),
      stages: null,
      timings: FAST_TIMINGS,
    })

    const response = await handlers.stream(
      streamRequest(seed.experimentId),
      { experimentId: seed.experimentId },
    )
    expect(response.status).toBe(503)

    expect(await countEvents(seed.experimentId, 'pipeline.started')).toBe(0)
    expect(await getClaim(seed.experimentId)).toBeNull()
  })
})
