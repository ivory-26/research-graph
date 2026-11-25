/**
 * Credentialed acceptance smoke test for the #6 delivery layer.
 *
 * Opt-in: skipped unless `LIVE_SMOKE=1` and `TEST_DATABASE_URL` are set. It
 * additionally needs `E2B_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` and the
 * pinned `researchgraph-python:locked` template published from
 * `Dockerfile.template` in the same E2B team.
 *
 * Unlike `route.integration.test.ts`, this suite does **not** replace `e2b` or
 * `callModel`: the mounted GET runs the real `E2BRunner` against the pinned
 * template and the real Gemini `explain_gap` call. The database is a
 * disposable local PostgreSQL; `auth.server` supplies a fixed identity so no
 * Neon Auth session is needed. The sandbox uses the plan's 30 s timeout and
 * the runner kills it in `finally`.
 *
 * Cost: one sandbox on the pinned 1-vCPU / 2-GiB template for well under a
 * minute, plus one short text-generation request.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type { PipelineEvent } from '../../shared/events'
import {
  createTestDatabase,
  seedWorkspace,
  type SeededWorkspace,
  type TestDatabase,
} from './test-support/pg'
import { consumeSse, type SseConsumer } from './test-support/sse'
import { makeValidSpec } from './test-support/production-fixtures'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const LIVE = process.env.LIVE_SMOKE === '1' && Boolean(TEST_DATABASE_URL)
const describeLive = LIVE ? describe : describe.skip

const ORIGIN = 'http://localhost'

const state = vi.hoisted(() => ({
  db: null as unknown,
  actorId: 'test-member',
}))

vi.mock('../../db/client', () => ({
  getDb: () => state.db,
  closeDb: async () => undefined,
}))

/**
 * Identity is the one boundary this suite fakes: a live Neon Auth session is
 * not what the smoke run is testing, and the membership lookup still runs
 * against the seeded database.
 */
vi.mock('../auth.server', () => ({
  readCurrentUser: async () => (state.actorId ? { id: state.actorId } : null),
  enforceWorkspaceMembership: async (
    input: { userId: string; workspaceId: string },
    lookup: (input: { userId: string; workspaceId: string }) => Promise<unknown>,
  ) => {
    const membership = await lookup(input)
    if (!membership) {
      const error = new Error('Workspace membership required')
      ;(error as Error & { status?: number }).status = 403
      throw error
    }
    return membership
  },
}))

// Imported after the mocks are registered (vi.mock is hoisted).
import { Route as StreamRoute } from '../../routes/api/pipeline/$experimentId'
import { Route as ApproveRoute } from '../../routes/api/pipeline/$experimentId/approve'

type Handler = (context: {
  request: Request
  params: { experimentId: string }
}) => Promise<Response>

function routeHandler(route: unknown, method: 'GET' | 'POST'): Handler {
  const handlers = (
    route as {
      options: { server: { handlers: Record<string, Handler> } }
    }
  ).options.server.handlers
  const handler = handlers[method]
  if (!handler) throw new Error(`missing ${method} handler`)
  return handler
}

const GET = routeHandler(StreamRoute, 'GET')
const POST = routeHandler(ApproveRoute, 'POST')

describeLive('live pipeline smoke: real E2B + real Gemini', () => {
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
    if (!process.env.E2B_API_KEY) {
      throw new Error('LIVE_SMOKE=1 requires E2B_API_KEY')
    }
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      throw new Error('LIVE_SMOKE=1 requires GOOGLE_GENERATIVE_AI_API_KEY')
    }

    await testDb.reset()
    seed = await seedWorkspace(testDb.pool, {
      spec: makeValidSpec('claim-placeholder'),
    })
    state.db = testDb.db
    state.actorId = seed.memberId
  })

  afterEach(async () => {
    for (const consumer of consumers.splice(0)) {
      await consumer.cancel().catch(() => undefined)
    }
  })

  it(
    'runs plan -> approve -> real sandbox -> real explanation -> verdict',
    { timeout: 300_000 },
    async () => {
      const sse = consume(
        await GET({
          request: new Request(
            `${ORIGIN}/api/pipeline/${seed.experimentId}`,
            {
              method: 'GET',
              headers: { origin: ORIGIN },
            },
          ),
          params: { experimentId: seed.experimentId },
        }),
      )

      const requested = (await sse.waitFor(
        (event) => event.type === 'approval.requested',
        60_000,
      )) as Extract<PipelineEvent, { type: 'approval.requested' }>

      const approval = await POST({
        request: new Request(
          `${ORIGIN}/api/pipeline/${seed.experimentId}/approve`,
          {
            method: 'POST',
            headers: { origin: ORIGIN, 'content-type': 'application/json' },
            body: JSON.stringify({
              gateSeq: requested.seq,
              decision: 'approved',
            }),
          },
        ),
        params: { experimentId: seed.experimentId },
      })
      expect(approval.status).toBe(200)

      const completed = (await sse.waitFor(
        (event) => event.type === 'pipeline.completed',
        180_000,
      )) as Extract<PipelineEvent, { type: 'pipeline.completed' }>
      await sse.waitForClose(30_000)

      expect(completed.runId).not.toBeNull()

      const runs = await testDb.pool.query<{
        status: string
        metrics: Record<string, number>
        verdict: string | null
        environment: { python: string; imageDigest: string }
        stdout: string
        stderr: string
        verdict_detail: unknown
      }>(
        `SELECT status, metrics, verdict, environment, stdout, stderr,
                verdict_detail
           FROM runs
          WHERE experiment_id = $1`,
        [seed.experimentId],
      )
      expect(runs.rows).toHaveLength(1)
      // Include the measured output in the failure message: a live sandbox
      // failure is diagnosed from stderr, not from a generic status.
      expect(runs.rows[0], JSON.stringify(runs.rows[0], null, 2)).toMatchObject({
        status: 'succeeded',
        metrics: { score: 0.9 },
        verdict: 'match',
      })
      // A live sandbox reports a real interpreter, not the initial placeholder.
      expect(runs.rows[0]?.environment.python).not.toBe('unknown')

      const tasks = await testDb.pool.query<{
        task_kind: string
        model: string
        status: string
      }>(
        `SELECT task_kind, model, status
           FROM agent_tasks
          ORDER BY created_at`,
      )
      expect(tasks.rows).toEqual([
        {
          task_kind: 'explain_gap',
          model: 'gemini-4-hydrogen',
          status: 'succeeded',
        },
      ])

      const taskRecorded = sse.events.find(
        (event) => event.type === 'agent_task.recorded',
      ) as Extract<PipelineEvent, { type: 'agent_task.recorded' }> | undefined
      expect(taskRecorded?.task.model).toBe('gemini-4-hydrogen')

      const evaluateFinished = sse.events.find(
        (event) =>
          event.type === 'stage.finished' && event.stage === 'EVALUATE',
      ) as Extract<PipelineEvent, { type: 'stage.finished' }> | undefined
      expect(evaluateFinished?.taskId).toBe(taskRecorded?.task.id)
    },
  )

  function consume(response: Response): SseConsumer {
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const consumer = consumeSse(response)
    consumers.push(consumer)
    return consumer
  }
})
