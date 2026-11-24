/**
 * Mounted-route integration tests.
 *
 * These import the actual TanStack Start route modules
 * (`src/routes/api/pipeline/$experimentId.ts` and its `approve` child) and call
 * their `server.handlers` with a real `Request`. The handlers are the
 * production ones: the real database adapter, the real identity path, the real
 * stage provider, the real E2B runner logic and the real evaluator.
 *
 * Two process boundaries are replaced, because they are external services and
 * this suite must run without credentials:
 *
 * - `src/db/client` returns the disposable Postgres pool instead of Neon's
 *   WebSocket driver. The SQL, migrations and constraints are the real ones.
 * - `e2b` is a deterministic in-memory sandbox. The `E2BRunner` above it is
 *   the real implementation.
 * - `callModel` is deterministic and writes through the real agent_tasks
 *   store, so no Gemini request is made.
 *
 * Skipped unless `TEST_DATABASE_URL` is set.
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
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip

const ORIGIN = 'http://localhost'

const state = vi.hoisted(() => ({
  db: null as unknown,
  actorId: 'test-member',
  sandboxRuns: 0,
  sandboxCreated: 0,
  sandboxKilled: 0,
  executeStarted: false,
  holdExecute: false,
}))

vi.mock('../../db/client', () => ({
  getDb: () => state.db,
  closeDb: async () => undefined,
}))

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

vi.mock('../model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../model')>()
  return {
    ...actual,
    callModel: async (
      _schema: unknown,
      _prompt: string,
      context: {
        workspaceId: string
        taskKind: string
        inputRef?: Record<string, unknown>
        store: {
          insert: (task: Record<string, unknown>) => Promise<{ id: string }>
        }
      },
    ) => {
      const explanation =
        'The measured score exceeded the published threshold.'
      const task = {
        workspaceId: context.workspaceId,
        strategyId: null,
        taskKind: context.taskKind,
        model: 'deterministic-test-model',
        status: 'succeeded',
        inputRef: context.inputRef ?? {},
        output: { explanation },
        error: null,
        promptTokens: 12,
        completionTokens: 9,
        costUsd: null,
        latencyMs: 1,
      }
      const { id } = await context.store.insert(task)
      return {
        output: { explanation },
        task: { ...task, id },
        attempts: [{ ...task, id }],
      }
    },
  }
})

vi.mock('e2b', () => {
  const METRICS = JSON.stringify({ score: 0.9 })
  const PACKAGES = JSON.stringify([
    { name: 'numpy', version: '2.5.5' },
    { name: 'pandas', version: '2.3.3' },
    { name: 'scikit-learn', version: '1.9.1' },
    { name: 'scipy', version: '1.17.1' },
    { name: 'matplotlib', version: '3.10.0' },
  ])

  class FakeCommandExitError extends Error {
    exitCode = 1
    stdout = ''
    stderr = ''
  }

  class FakeSandbox {
    readonly sandboxId = `sandbox-${state.sandboxCreated + 1}`
    private metrics: string | null = null
    private release: (() => void) | null = null

    readonly files = {
      write: async (path: string, content: unknown) => {
        if (path.endsWith('metrics.json')) {
          this.metrics = String(content)
        }
      },
      read: async (path: string) => {
        if (path === '/output/metrics.json') {
          if (this.metrics === null) throw new Error('no metrics file')
          return this.metrics
        }
        return ''
      },
      list: async () => [] as Array<{ name: string }>,
    }

    readonly commands = {
      run: async (command: string, options?: { onStdout?: (chunk: string) => void }) => {
        if (command === 'python main.py') {
          state.sandboxRuns += 1
          state.executeStarted = true
          if (state.holdExecute) {
            await new Promise<void>((resolve) => {
              this.release = resolve
            })
            throw new Error('sandbox was killed')
          }
          options?.onStdout?.('computed metrics\n')
          this.metrics = METRICS
          return { exitCode: 0, stdout: 'computed metrics\n', stderr: '' }
        }
        if (command === 'python --version') {
          return { exitCode: 0, stdout: 'Python 3.12.16\n', stderr: '' }
        }
        if (command.startsWith('cat /etc/image-digest')) {
          return { exitCode: 0, stdout: '', stderr: '' }
        }
        if (command === 'pip list --format=json') {
          return { exitCode: 0, stdout: PACKAGES, stderr: '' }
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    }

    async kill(): Promise<void> {
      state.sandboxKilled += 1
      this.release?.()
    }

    static async create(): Promise<FakeSandbox> {
      state.sandboxCreated += 1
      return new FakeSandbox()
    }

    static async connect(): Promise<FakeSandbox> {
      return new FakeSandbox()
    }
  }

  return { Sandbox: FakeSandbox, CommandExitError: FakeCommandExitError }
})

// Imported after the mocks are registered (vi.mock is hoisted).
import { Route as StreamRoute } from '../../routes/api/pipeline/$experimentId'
import { Route as ApproveRoute } from '../../routes/api/pipeline/$experimentId/approve'

type Handler = (context: {
  request: Request
  params: { experimentId: string }
}) => Promise<Response>

function routeHandler(
  route: unknown,
  method: 'GET' | 'POST',
): Handler {
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

describeIntegration('mounted pipeline routes over real Postgres', () => {
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
    seed = await seedWorkspace(testDb.pool, {
      spec: makeValidSpec('claim-placeholder'),
    })
    state.db = testDb.db
    state.actorId = seed.memberId
    state.sandboxRuns = 0
    state.sandboxCreated = 0
    state.sandboxKilled = 0
    state.executeStarted = false
    state.holdExecute = false
  })

  afterEach(async () => {
    for (const consumer of consumers.splice(0)) {
      await consumer.cancel().catch(() => undefined)
    }
    state.holdExecute = false
  })

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
    gateSeq: number,
    decision: 'approved' | 'rejected',
  ): Request {
    return new Request(
      `${ORIGIN}/api/pipeline/${experimentId}/approve`,
      {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ gateSeq, decision }),
      },
    )
  }

  function consume(response: Response): SseConsumer {
    const consumer = consumeSse(response)
    consumers.push(consumer)
    return consumer
  }

  async function openStream(experimentId: string, headers = {}) {
    const response = await GET({
      request: streamRequest(experimentId, headers),
      params: { experimentId },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    return consume(response)
  }

  async function decide(
    experimentId: string,
    gateSeq: number,
    decision: 'approved' | 'rejected',
  ) {
    const response = await POST({
      request: approveRequest(experimentId, gateSeq, decision),
      params: { experimentId },
    })
    expect(response.status).toBe(200)
    return (await response.json()) as Record<string, unknown>
  }

  async function runRows() {
    const result = await testDb.pool.query<{
      id: string
      status: string
      spec: unknown
      metrics: Record<string, number>
      verdict: string | null
      verdict_detail: { checks: Array<{ metric: string; measured: number | null }> } | null
    }>(
      `SELECT id, status, spec, metrics, verdict, verdict_detail
         FROM runs
        WHERE experiment_id = $1
        ORDER BY created_at`,
      [seed.experimentId],
    )
    return result.rows
  }

  it('runs the real provider and survives an approval posted by the other mounted route', async () => {
    const sse = await openStream(seed.experimentId)
    const requested = (await sse.waitFor(
      (event) => event.type === 'approval.requested',
    )) as Extract<PipelineEvent, { type: 'approval.requested' }>

    const body = await decide(seed.experimentId, requested.seq, 'approved')
    expect(body).toMatchObject({
      outcome: 'decided',
      decision: 'approved',
      approvedBy: seed.memberId,
    })

    const completed = (await sse.waitFor(
      (event) => event.type === 'pipeline.completed',
    )) as Extract<PipelineEvent, { type: 'pipeline.completed' }>
    await sse.waitForClose()

    expect(completed.runId).not.toBeNull()
    expect(state.sandboxRuns).toBe(1)

    const rows = await runRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: completed.runId,
      status: 'succeeded',
      metrics: { score: 0.9 },
      verdict: 'match',
    })
    expect(rows[0]?.spec).toEqual(seed.spec)
    expect(rows[0]?.verdict_detail?.checks).toEqual([
      expect.objectContaining({ metric: 'score', measured: 0.9 }),
    ])

    const tasks = await testDb.pool.query<{ task_kind: string }>(
      'SELECT task_kind FROM agent_tasks',
    )
    expect(tasks.rows).toEqual([{ task_kind: 'explain_gap' }])
  })

  it('ends a mounted rejection as cancelled with no run row', async () => {
    const sse = await openStream(seed.experimentId)
    const requested = (await sse.waitFor(
      (event) => event.type === 'approval.requested',
    )) as Extract<PipelineEvent, { type: 'approval.requested' }>

    await decide(seed.experimentId, requested.seq, 'rejected')

    const cancelled = (await sse.waitFor(
      (event) => event.type === 'pipeline.cancelled',
    )) as Extract<PipelineEvent, { type: 'pipeline.cancelled' }>
    await sse.waitForClose()

    expect(cancelled.reason).toBe('rejected')
    expect(state.sandboxRuns).toBe(0)
    expect(await runRows()).toHaveLength(0)
  })

  it('replays from Last-Event-ID on the mounted route without a second execution', async () => {
    const owner = await openStream(seed.experimentId)
    const requested = (await owner.waitFor(
      (event) => event.type === 'approval.requested',
    )) as Extract<PipelineEvent, { type: 'approval.requested' }>

    await decide(seed.experimentId, requested.seq, 'approved')

    const reconnect = await openStream(seed.experimentId, {
      'last-event-id': String(requested.seq),
    })

    const firstReplayed = (await reconnect.waitFor(() => true)) as PipelineEvent
    expect(firstReplayed.seq).toBeGreaterThan(requested.seq)
    expect(
      reconnect.events.some((event) => event.type === 'pipeline.started'),
    ).toBe(false)

    await reconnect.waitFor((event) => event.type === 'pipeline.completed')
    await reconnect.waitForClose()
    await owner.waitForClose()

    expect(state.sandboxRuns).toBe(1)
    expect(await runRows()).toHaveLength(1)
  })

  it('cancels the live sandbox when the mounted stream consumer goes away', async () => {
    state.holdExecute = true

    const sse = await openStream(seed.experimentId)
    const requested = (await sse.waitFor(
      (event) => event.type === 'approval.requested',
    )) as Extract<PipelineEvent, { type: 'approval.requested' }>

    await decide(seed.experimentId, requested.seq, 'approved')
    await sse.waitFor((event) => event.type === 'run.started')

    // The sandbox is created after `run.started` is appended, and the runner
    // registers it before it starts the command.
    for (let attempt = 0; attempt < 100 && !state.executeStarted; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(state.sandboxCreated).toBeGreaterThan(0)
    expect(state.executeStarted).toBe(true)

    await sse.cancel()

    for (let attempt = 0; attempt < 100 && state.sandboxKilled === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(state.sandboxKilled).toBeGreaterThan(0)
    expect(
      sse.events.some((event) => event.type === 'pipeline.completed'),
    ).toBe(false)
  })
})
