/**
 * Production stage-provider tests over a real Postgres database.
 *
 * These exercise the same `PipelineStages` port the mounted GET uses, with the
 * real planner (`validateExperimentSpec`), the real delivery handlers and the
 * real schema. The E2B sandbox is replaced by a disclosed deterministic runner
 * because E2B credentials are not part of this suite; the delivery, claim,
 * gate, run-row, verdict and #7 graph-projection paths are real.
 *
 * Skipped unless `TEST_DATABASE_URL` is set. See `test-support/pg.ts` for the
 * disposable-database rules.
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
import type { ExperimentSpec } from '../../shared/types'
import type { PipelineTimings } from './timings'
import { createDrizzlePipelineData } from './data'
import { createPipelineHandlers } from './handlers'
import { createProductionPipelineStages } from './production-stages'
import {
  createRecordedCallModel,
  createStubRunner,
  makeValidSpec,
  type StubRunner,
} from './test-support/production-fixtures'
import {
  createTestDatabase,
  seedWorkspace,
  type SeededWorkspace,
  type TestDatabase,
} from './test-support/pg'
import { consumeSse, type SseConsumer } from './test-support/sse'

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

describeIntegration('production pipeline stages over real Postgres', () => {
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
  })

  afterEach(async () => {
    for (const consumer of consumers.splice(0)) {
      await consumer.cancel().catch(() => undefined)
    }
  })

  function handlersFor(
    runner: StubRunner,
    timings: Partial<PipelineTimings> = FAST_TIMINGS,
  ) {
    return createPipelineHandlers({
      data: createDrizzlePipelineData(testDb.db),
      readActor: async () => ({ id: seed.memberId }),
      stages: createProductionPipelineStages({
        db: testDb.db,
        runner,
        callModel: createRecordedCallModel(),
        randomUUID: () => '11111111-1111-4111-8111-111111111111',
      }),
      timings,
    })
  }

  function streamRequest(experimentId: string): Request {
    return new Request(`${ORIGIN}/api/pipeline/${experimentId}`, {
      method: 'GET',
      headers: { origin: ORIGIN },
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

  async function approveRequested(
    handlers: ReturnType<typeof handlersFor>,
    sse: SseConsumer,
    decision: 'approved' | 'rejected' = 'approved',
  ) {
    const requested = (await sse.waitFor(
      (event) => event.type === 'approval.requested',
    )) as Extract<PipelineEvent, { type: 'approval.requested' }>

    const response = await handlers.approve(
      approveRequest(seed.experimentId, requested.seq, decision),
      { experimentId: seed.experimentId },
    )
    expect(response.status).toBe(200)
    return requested
  }

  async function runRows() {
    const result = await testDb.pool.query<{
      id: string
      status: string
      spec: ExperimentSpec
      metrics: Record<string, number>
      environment: Record<string, unknown>
      stderr: string
      verdict: string | null
      verdict_detail: { checks: unknown[]; explanation: string | null } | null
      experiment_id: string
    }>(
      `SELECT id, status, spec, metrics, environment, stderr, verdict,
              verdict_detail, experiment_id
         FROM runs
        WHERE experiment_id = $1
        ORDER BY created_at`,
      [seed.experimentId],
    )
    return result.rows
  }

  async function graphRows() {
    const nodeResult = await testDb.pool.query<{
      id: string
      type: string
      title: string
      data: Record<string, unknown>
    }>(
      `SELECT id, type, title, data
         FROM nodes
        WHERE workspace_id = $1
        ORDER BY created_at, id`,
      [seed.workspaceId],
    )
    const edgeResult = await testDb.pool.query<{
      id: string
      source_node_id: string
      target_node_id: string
      relation: string
      status: string
      evidence_run_id: string | null
    }>(
      `SELECT id, source_node_id, target_node_id, relation, status,
              evidence_run_id
         FROM edges
        WHERE workspace_id = $1
        ORDER BY created_at, id`,
      [seed.workspaceId],
    )
    return { nodes: nodeResult.rows, edges: edgeResult.rows }
  }

  /** The abort path writes the graph after the row update; wait for it. */
  async function waitForRunNode(timeoutMs = 3_000) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const graph = await graphRows()
      if (graph.nodes.some((node) => node.type === 'run')) return graph
      if (Date.now() > deadline) {
        throw new Error('timed out waiting for the run graph projection')
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  it('offers the persisted plan at the gate after real planner validation', async () => {
    const runner = createStubRunner('succeed')
    const handlers = handlersFor(runner)

    const sse = consume(
      await handlers.stream(streamRequest(seed.experimentId), {
        experimentId: seed.experimentId,
      }),
    )
    const requested = (await sse.waitFor(
      (event) => event.type === 'approval.requested',
    )) as Extract<PipelineEvent, { type: 'approval.requested' }>

    expect(requested.spec).toEqual(seed.spec)
    expect(
      sse.events.filter(
        (event) =>
          (event.type === 'stage.started' ||
            event.type === 'stage.finished') &&
          event.stage === 'PLAN_EXPERIMENT',
      ),
    ).toHaveLength(2)
    // The provider did not run the earlier graph stages in this request.
    expect(
      sse.events.some(
        (event) =>
          (event.type === 'stage.started' ||
            event.type === 'stage.finished') &&
          event.stage === 'INGEST_SOURCE',
      ),
    ).toBe(false)
  })

  it('executes the approved plan and persists the measured run and computed verdict', async () => {
    const runner = createStubRunner('succeed')
    const handlers = handlersFor(runner)

    const sse = consume(
      await handlers.stream(streamRequest(seed.experimentId), {
        experimentId: seed.experimentId,
      }),
    )
    await approveRequested(handlers, sse)

    const completed = (await sse.waitFor(
      (event) => event.type === 'pipeline.completed',
    )) as Extract<PipelineEvent, { type: 'pipeline.completed' }>
    await sse.waitForClose()

    expect(completed.runId).toBe(
      '11111111-1111-4111-8111-111111111111',
    )
    expect(runner.runCalls).toBe(1)

    const rows = await runRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: completed.runId,
      experiment_id: seed.experimentId,
      status: 'succeeded',
      metrics: { score: 0.9 },
      verdict: 'match',
    })
    // The run keeps the exact plan that was approved, not a pointer.
    expect(rows[0]?.spec).toEqual(seed.spec)
    expect(rows[0]?.verdict_detail?.checks).toEqual([
      expect.objectContaining({
        metric: 'score',
        measured: 0.9,
        passed: true,
      }),
    ])

    const succeeded = (await sse.waitFor(
      (event) => event.type === 'run.succeeded',
    )) as Extract<PipelineEvent, { type: 'run.succeeded' }>
    expect(succeeded.result.metrics).toEqual({ score: 0.9 })

    const verdict = (await sse.waitFor(
      (event) => event.type === 'verdict.computed',
    )) as Extract<PipelineEvent, { type: 'verdict.computed' }>
    expect(verdict.verdict).toBe('match')

    const artifacts = await testDb.pool.query<{
      kind: string
      content: string
    }>('SELECT kind, content FROM run_artifacts WHERE run_id = $1', [
      completed.runId,
    ])
    expect(artifacts.rows).toHaveLength(1)
    expect(artifacts.rows[0]?.kind).toBe('notebook')
    const notebook = JSON.parse(artifacts.rows[0]!.content)
    expect(notebook).toMatchObject({ nbformat: 4, nbformat_minor: 5 })
    const metadata = notebook.cells[0].source.join('')
    expect(metadata).toContain('noise can outrank informative features')
    expect(metadata).toContain(rows[0]!.verdict_detail!.explanation)

    const tasks = await testDb.pool.query<{
      task_kind: string
      status: string
    }>('SELECT task_kind, status FROM agent_tasks')
    expect(tasks.rows).toEqual([
      { task_kind: 'explain_gap', status: 'succeeded' },
    ])

    // #7: the completed run is in the graph, projected from the run row after
    // the verdict was persisted.
    const graph = await graphRows()
    const runNodes = graph.nodes.filter((node) => node.type === 'run')
    const resultNodes = graph.nodes.filter((node) => node.type === 'result')
    expect(runNodes).toHaveLength(1)
    expect(resultNodes).toHaveLength(1)
    expect(runNodes[0]?.data).toEqual({
      type: 'run',
      runId: completed.runId,
      status: 'succeeded',
      mode: 'adapted',
    })
    expect(resultNodes[0]?.data).toEqual({
      type: 'result',
      metrics: { score: 0.9 },
      runId: completed.runId,
      verdict: 'match',
    })
    expect(graph.edges).toEqual([
      expect.objectContaining({
        source_node_id: runNodes[0]?.id,
        target_node_id: resultNodes[0]?.id,
        relation: 'produced',
        status: 'accepted',
        evidence_run_id: completed.runId,
      }),
    ])
  })

  it('fails before opening a gate when the stored plan violates the planner rules', async () => {
    const invalid = { ...seed.spec, mode: 'exact' as const }
    await testDb.pool.query(
      'UPDATE experiments SET spec = $2 WHERE id = $1',
      [seed.experimentId, JSON.stringify(invalid)],
    )

    const runner = createStubRunner('succeed')
    const handlers = handlersFor(runner)
    const sse = consume(
      await handlers.stream(streamRequest(seed.experimentId), {
        experimentId: seed.experimentId,
      }),
    )

    const failed = (await sse.waitFor(
      (event) => event.type === 'pipeline.failed',
    )) as Extract<PipelineEvent, { type: 'pipeline.failed' }>
    await sse.waitForClose()

    expect(failed.error).toBe('The stored experiment plan failed validation')
    expect(
      sse.events.some((event) => event.type === 'approval.requested'),
    ).toBe(false)
    expect(runner.runCalls).toBe(0)

    const gate = await testDb.pool.query('SELECT 1 FROM approval_gates')
    expect(gate.rows).toHaveLength(0)
    const claim = await testDb.pool.query<{ close_reason: string }>(
      'SELECT close_reason FROM execution_claims WHERE experiment_id = $1',
      [seed.experimentId],
    )
    expect(claim.rows[0]?.close_reason).toBe('failed')
  })

  it('persists a failed run without copying a runner exception onto the wire', async () => {
    const runner = createStubRunner('throw')
    const handlers = handlersFor(runner)

    const sse = consume(
      await handlers.stream(streamRequest(seed.experimentId), {
        experimentId: seed.experimentId,
      }),
    )
    await approveRequested(handlers, sse)

    const runFailed = (await sse.waitFor(
      (event) => event.type === 'run.failed',
    )) as Extract<PipelineEvent, { type: 'run.failed' }>
    expect(runFailed.error).not.toContain('sk-test-secret')
    expect(runFailed.error).not.toContain('db.internal')

    const completed = (await sse.waitFor(
      (event) => event.type === 'pipeline.completed',
    )) as Extract<PipelineEvent, { type: 'pipeline.completed' }>
    await sse.waitForClose()
    expect(completed.runId).not.toBeNull()

    const rows = await runRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('failed')
    expect(rows[0]?.verdict).toBe('failed')
    expect(rows[0]?.stderr).toBe(
      'The experiment runner failed before producing a result',
    )
    expect(rows[0]?.stderr).not.toContain('sk-test-secret')
    expect(rows[0]?.stderr).not.toContain('db.internal')

    // #7: a failed run still gets both nodes and the edge, and the run node's
    // `data.runId` resolves the canonical stderr without copying it.
    const graph = await graphRows()
    const runNode = graph.nodes.find((node) => node.type === 'run')
    const resultNode = graph.nodes.find((node) => node.type === 'result')
    expect(runNode?.data).toEqual({
      type: 'run',
      runId: completed.runId,
      status: 'failed',
      mode: 'adapted',
    })
    expect(resultNode?.data).toEqual({
      type: 'result',
      metrics: {},
      runId: completed.runId,
      verdict: 'failed',
    })
    expect(JSON.stringify(runNode?.data)).not.toContain('sk-test-secret')
    expect(JSON.stringify(runNode?.data)).not.toContain('db.internal')

    const nodeRunId = (runNode?.data as { runId: string }).runId
    const canonical = await testDb.pool.query<{ stderr: string }>(
      'SELECT stderr FROM runs WHERE id = $1',
      [nodeRunId],
    )
    expect(canonical.rows[0]?.stderr).toBe(
      'The experiment runner failed before producing a result',
    )
    expect(graph.edges).toEqual([
      expect.objectContaining({
        source_node_id: runNode?.id,
        target_node_id: resultNode?.id,
        relation: 'produced',
        status: 'accepted',
        evidence_run_id: completed.runId,
      }),
    ])
  })

  it('fails the pipeline rather than reporting completion without the graph', async () => {
    const runner = createStubRunner('succeed')
    const handlers = handlersFor(runner)

    // The projection writes its nodes before the edge; fail the last
    // statement and the whole projection rolls back.
    await testDb.pool.query(`
      CREATE OR REPLACE FUNCTION rg_test_fail_edge_insert()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced edge failure';
      END;
      $$ LANGUAGE plpgsql
    `)
    await testDb.pool.query(`
      CREATE TRIGGER rg_test_fail_edge_insert
      BEFORE INSERT ON edges
      FOR EACH ROW EXECUTE FUNCTION rg_test_fail_edge_insert()
    `)

    try {
      const sse = consume(
        await handlers.stream(streamRequest(seed.experimentId), {
          experimentId: seed.experimentId,
        }),
      )
      await approveRequested(handlers, sse)

      const failed = (await sse.waitFor(
        (event) => event.type === 'pipeline.failed',
      )) as Extract<PipelineEvent, { type: 'pipeline.failed' }>
      await sse.waitForClose()

      expect(failed.error).toBe(
        'The completed run could not be written to the graph',
      )
      expect(
        sse.events.some((event) => event.type === 'pipeline.completed'),
      ).toBe(false)

      // The run executed and its row is durable; the graph is absent, and the
      // pipeline did not claim completion.
      const rows = await runRows()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.status).toBe('succeeded')

      const graph = await graphRows()
      expect(
        graph.nodes.filter(
          (node) => node.type === 'run' || node.type === 'result',
        ),
      ).toHaveLength(0)
      expect(graph.edges).toHaveLength(0)
    } finally {
      await testDb.pool.query(
        'DROP TRIGGER IF EXISTS rg_test_fail_edge_insert ON edges',
      )
      await testDb.pool.query(
        'DROP FUNCTION IF EXISTS rg_test_fail_edge_insert()',
      )
    }
  })

  it('never creates a run when the human rejects the plan', async () => {
    const runner = createStubRunner('succeed')
    const handlers = handlersFor(runner)
    const sse = consume(
      await handlers.stream(streamRequest(seed.experimentId), {
        experimentId: seed.experimentId,
      }),
    )
    await approveRequested(handlers, sse, 'rejected')

    await sse.waitFor((event) => event.type === 'pipeline.cancelled')
    await sse.waitForClose()

    expect(runner.runCalls).toBe(0)
    expect(await runRows()).toHaveLength(0)

    // A rejection never creates a run, so it never manufactures a graph node.
    const graph = await graphRows()
    expect(
      graph.nodes.filter(
        (node) => node.type === 'run' || node.type === 'result',
      ),
    ).toHaveLength(0)
    expect(graph.edges).toHaveLength(0)
  })

  it('cancels the live sandbox and marks the run timed out when the budget expires', async () => {
    const runner = createStubRunner('hangUntilCancel')
    const handlers = handlersFor(runner, {
      budgetMs: 900,
      heartbeatIntervalMs: 90,
      approvalPollIntervalMs: 20,
      eventPollIntervalMs: 20,
      claimTtlMs: 5_000,
    })

    const sse = consume(
      await handlers.stream(streamRequest(seed.experimentId), {
        experimentId: seed.experimentId,
      }),
    )
    await approveRequested(handlers, sse)

    await sse.waitFor((event) => event.type === 'run.started')
    const timedOut = (await sse.waitFor(
      (event) => event.type === 'run.timeout',
      5_000,
    )) as Extract<PipelineEvent, { type: 'run.timeout' }>
    const failed = (await sse.waitFor(
      (event) => event.type === 'pipeline.failed',
      5_000,
    )) as Extract<PipelineEvent, { type: 'pipeline.failed' }>
    await sse.waitForClose(5_000)

    expect(timedOut.budgetMs).toBe(900)
    expect(failed.error).toMatch(/budget/i)
    expect(runner.cancelCalls).toEqual(['sandbox-test-1'])
    expect(
      sse.events.some((event) => event.type === 'pipeline.completed'),
    ).toBe(false)

    // The aborted run is marked durable without inventing a verdict.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const rows = await runRows()
      if (rows[0]?.status === 'timeout') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const rows = await runRows()
    expect(rows[0]).toMatchObject({ status: 'timeout', verdict: null })

    // The abort path still owes the graph once the row is terminal.
    const graph = await waitForRunNode()
    const runNode = graph.nodes.find((node) => node.type === 'run')
    const resultNode = graph.nodes.find((node) => node.type === 'result')
    expect(runNode?.data).toEqual({
      type: 'run',
      runId: rows[0]?.id,
      status: 'timeout',
      mode: 'adapted',
    })
    expect(resultNode?.data).toEqual({
      type: 'result',
      metrics: {},
      runId: rows[0]?.id,
      verdict: null,
    })
    expect(graph.edges).toEqual([
      expect.objectContaining({
        source_node_id: runNode?.id,
        target_node_id: resultNode?.id,
        relation: 'produced',
        status: 'accepted',
        evidence_run_id: rows[0]?.id,
      }),
    ])
  })
})
