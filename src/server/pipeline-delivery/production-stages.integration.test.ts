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
import { createHash } from 'node:crypto'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'

import { createCallModel } from '../model'
import {
  MetricsExtractionError,
  PackageVerificationError,
  SandboxTimeoutError,
} from '../runner'
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
  measuredResult,
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
    callModel = createRecordedCallModel(),
  ) {
    return createPipelineHandlers({
      data: createDrizzlePipelineData(testDb.db),
      readActor: async () => ({ id: seed.memberId }),
      stages: createProductionPipelineStages({
        db: testDb.db,
        runner,
        callModel,
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
    experimentId: string = seed.experimentId,
  ) {
    const requested = (await sse.waitFor(
      (event) => event.type === 'approval.requested',
    )) as Extract<PipelineEvent, { type: 'approval.requested' }>

    const response = await handlers.approve(
      approveRequest(experimentId, requested.seq, decision),
      { experimentId },
    )
    expect(response.status).toBe(200)
    return requested
  }

  async function runRows(experimentId: string = seed.experimentId) {
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
      parent_run_id: string | null
      attempt: number
      started_at: Date | null
      sandbox_id: string | null
    }>(
      `SELECT id, status, spec, metrics, environment, stderr, verdict,
              verdict_detail, experiment_id, parent_run_id, attempt,
              started_at, sandbox_id
         FROM runs
        WHERE experiment_id = $1
        ORDER BY created_at`,
      [experimentId],
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

  /** A what-if child plan: the parent spec with one parameter leaf changed. */
  function branchedSpec(seedValue: number): ExperimentSpec {
    return {
      ...seed.spec,
      parameters: { ...seed.spec.parameters, seed: seedValue },
    }
  }

  /**
   * Mirrors `createDrizzleWhatIfBranchStore` (PR #66): a completed parent run,
   * a pending child experiment, and the queued attempt-1 child run with
   * `parentRunId` that EXECUTE is expected to adopt (issue #62).
   *
   * `approvedSeed` distinct from `queuedSeed` advances the experiment plan
   * after the branch row was written, so the test can prove EXECUTE freezes
   * the approved plan rather than the queued copy.
   */
  async function seedQueuedWhatIfChild(options: {
    queuedSeed: number
    approvedSeed: number
  }) {
    const parent = await testDb.pool.query<{ id: string }>(
      `INSERT INTO runs
         (experiment_id, parent_run_id, attempt, status, spec, parameters,
          metrics, environment, started_at, finished_at)
       VALUES ($1, NULL, 1, 'succeeded', $2, $3, $4, $5, now(), now())
       RETURNING id`,
      [
        seed.experimentId,
        JSON.stringify(seed.spec),
        JSON.stringify(seed.spec.parameters),
        JSON.stringify({ score: 0.9 }),
        JSON.stringify({
          imageDigest: 'sha256:parent-image',
          python: 'Python 3.12.16',
          packages: {},
          datasets: [],
          seeds: [42],
          startedAt: new Date(0).toISOString(),
        }),
      ],
    )
    const parentRunId = parent.rows[0]!.id

    const queuedSpec = branchedSpec(options.queuedSeed)
    const child = await testDb.pool.query<{ id: string }>(
      `INSERT INTO experiments (workspace_id, claim_node_id, spec, mode)
       VALUES ($1, $2, $3, 'adapted')
       RETURNING id`,
      [seed.workspaceId, seed.claimNodeId, JSON.stringify(queuedSpec)],
    )
    const childExperimentId = child.rows[0]!.id

    const queued = await testDb.pool.query<{ id: string }>(
      `INSERT INTO runs
         (experiment_id, parent_run_id, attempt, status, spec, parameters,
          environment)
       VALUES ($1, $2, 1, 'queued', $3, $4, $5)
       RETURNING id`,
      [
        childExperimentId,
        parentRunId,
        JSON.stringify(queuedSpec),
        JSON.stringify(queuedSpec.parameters),
        JSON.stringify({
          imageDigest: 'unknown',
          python: 'unknown',
          packages: {},
          datasets: [],
          seeds: [options.queuedSeed],
          startedAt: '',
        }),
      ],
    )
    const queuedRunId = queued.rows[0]!.id

    const approvedSpec = branchedSpec(options.approvedSeed)
    await testDb.pool.query(
      'UPDATE experiments SET spec = $2 WHERE id = $1',
      [childExperimentId, JSON.stringify(approvedSpec)],
    )

    return {
      parentRunId,
      childExperimentId,
      queuedRunId,
      queuedSpec,
      approvedSpec,
    }
  }

  /** A stub runner that observes the durable row at the moment EXECUTE starts. */
  function createObservingRunner(
    mode: Parameters<typeof createStubRunner>[0],
    observe: () => Promise<void>,
  ): StubRunner {
    const stub = createStubRunner(mode)
    return {
      get runCalls() {
        return stub.runCalls
      },
      get cancelCalls() {
        return stub.cancelCalls
      },
      getActiveSandboxes: () => stub.getActiveSandboxes(),
      async run(spec, onStdout) {
        await observe()
        return stub.run(spec, onStdout)
      },
      cancel: (sandboxId) => stub.cancel(sandboxId),
    }
  }
  it.each(['automatic', 'approved', 'rejected'] as const)(
    'records a failed run and handles a subsequent %s repair through the production stages',
    async (mode) => {
      const repairedScript = seed.spec.files['main.py']!
      const brokenScript = repairedScript.replace('import json', 'import missing_json')
      seed.spec.files['main.py'] = brokenScript
      await testDb.pool.query('UPDATE experiments SET spec = $1 WHERE id = $2', [
        JSON.stringify(seed.spec), seed.experimentId,
      ])

      const candidate = mode === 'automatic'
        ? repairedScript
        : repairedScript.replace('0.9', '0.8')
      const runner: StubRunner = {
        ...createStubRunner('succeed'),
        async run(spec) {
          this.runCalls++
          if (this.runCalls === 1) {
            expect(spec.files['main.py']).toBe(brokenScript)
            return measuredResult({
              exitCode: 1,
              stderr: 'ModuleNotFoundError: missing_json',
              metrics: {},
            })
          }
          expect(spec.files['main.py']).toBe(candidate)
          return measuredResult({ metrics: { score: mode === 'automatic' ? 0.9 : 0.8 } })
        },
      }
      const callModel = createCallModel({
        generate: async ({ prompt }) => ({
          output: prompt.includes('ModuleNotFoundError: missing_json')
            ? { script: candidate, summary: 'Fixed the import' }
            : { explanation: 'The verdict was computed from the run.' },
          inputTokens: 15,
          outputTokens: 10,
        }),
      })
      const handlers = handlersFor(runner, FAST_TIMINGS, callModel)
      const sse = consume(await handlers.stream(streamRequest(seed.experimentId), {
        experimentId: seed.experimentId,
      }))
      const initial = await approveRequested(handlers, sse)

      if (mode !== 'automatic') {
        const repairGate = await sse.waitFor(
          (event) => event.type === 'approval.requested' && event.seq > initial.seq,
        )
        expect(runner.runCalls).toBe(1)
        const replay = await handlers.approve(
          approveRequest(seed.experimentId, initial.seq, 'approved'),
          { experimentId: seed.experimentId },
        )
        expect(replay.status).toBe(200)
        expect(runner.runCalls).toBe(1)

        const decision = mode === 'approved' ? 'approved' : 'rejected'
        const response = await handlers.approve(
          approveRequest(seed.experimentId, repairGate.seq, decision),
          { experimentId: seed.experimentId },
        )
        expect(response.status).toBe(200)
        await sse.waitFor((event) => event.type === 'approval.resolved' && event.seq > repairGate.seq)
      }

      await sse.waitFor((event) => event.type === (
        mode === 'rejected' ? 'pipeline.cancelled' : 'pipeline.completed'
      ))
      const rows = await runRows()
      const [parent, child] = rows
      expect(parent).toMatchObject({
        attempt: 1,
        status: 'failed',
        verdict: 'failed',
        sandbox_id: 'sandbox-test-1',
      })
      expect(parent!.spec.files['main.py']).toBe(brokenScript)
      const task = await testDb.pool.query<{ input_ref: unknown }>(
        "SELECT input_ref FROM agent_tasks WHERE task_kind = 'repair_script'",
      )
      expect(task.rows).toEqual([{
        input_ref: { experimentId: seed.experimentId, runId: parent!.id },
      }])

      if (mode === 'rejected') {
        expect(rows).toHaveLength(1)
        expect(runner.runCalls).toBe(1)
        return
      }
      expect(rows).toHaveLength(2)
      expect(child).toMatchObject({
        attempt: 2,
        parent_run_id: parent!.id,
        status: 'succeeded',
        verdict: 'match',
        // The repaired run's own sandbox, persisted by the repair store.
        sandbox_id: 'sandbox-test-1',
      })
      expect(child!.spec.files['main.py']).toBe(candidate)
      expect(sse.events.at(-1)).toMatchObject({ type: 'pipeline.completed', runId: child!.id })
      expect((await graphRows()).edges.map((edge) => edge.evidence_run_id))
        .toEqual(expect.arrayContaining([parent!.id, child!.id]))
    },
  )

  it('starts the repair loop after a sandbox timeout and records the parent as timeout', async () => {
    const originalScript = seed.spec.files['main.py']!
    const candidate = originalScript.replace('import json', 'import json as json')
    const runner: StubRunner = {
      ...createStubRunner('succeed'),
      async run() {
        this.runCalls++
        if (this.runCalls === 1) {
          throw new SandboxTimeoutError(
            'Execution timed out after 30 seconds',
            30,
            '',
            '',
            0,
            undefined,
            'sandbox-timeout-1',
          )
        }
        return measuredResult({ metrics: { score: 0.9 } })
      },
    }
    const callModel = createCallModel({
      generate: async ({ prompt }) => ({
        output: prompt.includes('timed out')
          ? { script: candidate, summary: 'Retry after the sandbox timeout' }
          : { explanation: 'The verdict was computed from the run.' },
        inputTokens: 15,
        outputTokens: 10,
      }),
    })
    const handlers = handlersFor(runner, FAST_TIMINGS, callModel)
    const sse = consume(await handlers.stream(streamRequest(seed.experimentId), {
      experimentId: seed.experimentId,
    }))
    await approveRequested(handlers, sse)
    await sse.waitFor((event) => event.type === 'pipeline.completed')

    const rows = await runRows()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      attempt: 1,
      status: 'timeout',
      // A typed timeout still reports the sandbox that ran.
      sandbox_id: 'sandbox-timeout-1',
    })
    expect(rows[1]).toMatchObject({
      attempt: 2,
      parent_run_id: rows[0]!.id,
      status: 'succeeded',
      sandbox_id: 'sandbox-test-1',
    })
    expect(runner.runCalls).toBe(2)
  })

  it('repairs a run that exited 0 without valid metrics and persists the repaired notebook', async () => {
    const originalScript = seed.spec.files['main.py']!
    // A substantive change (not imports/columns/paths), so it re-opens the gate.
    const candidate = originalScript.replace('0.9', '0.8')
    const runner: StubRunner = {
      ...createStubRunner('succeed'),
      async run() {
        this.runCalls++
        if (this.runCalls === 1) {
          // The script exited successfully but never wrote /output/metrics.json.
          throw new MetricsExtractionError(
            'Execution completed (exit code 0), but /output/metrics.json was not created.',
            0,
            'computed ranks\n',
            '',
            0,
            undefined,
            'sandbox-metrics-1',
          )
        }
        return measuredResult({ metrics: { score: 0.8 } })
      },
    }
    const callModel = createCallModel({
      generate: async ({ prompt }) => ({
        output: prompt.includes('metrics.json was not created')
          ? { script: candidate, summary: 'Write the metrics file' }
          : { explanation: 'The repaired run produced the expected score.' },
        inputTokens: 15,
        outputTokens: 10,
      }),
    })
    const handlers = handlersFor(runner, FAST_TIMINGS, callModel)
    const sse = consume(await handlers.stream(streamRequest(seed.experimentId), {
      experimentId: seed.experimentId,
    }))

    const initial = await approveRequested(handlers, sse)
    const repairGate = (await sse.waitFor(
      (event) => event.type === 'approval.requested' && event.seq > initial.seq,
    )) as Extract<PipelineEvent, { type: 'approval.requested' }>
    expect(runner.runCalls).toBe(1)
    // A metrics-extraction failure is a script bug, not infrastructure: the
    // repair loop opened a gate instead of ending the pipeline.
    expect(repairGate.repair?.parentRunId).toBeTruthy()
    expect(repairGate.repair?.attempt).toBe(2)

    const response = await handlers.approve(
      approveRequest(seed.experimentId, repairGate.seq, 'approved'),
      { experimentId: seed.experimentId },
    )
    expect(response.status).toBe(200)
    await sse.waitFor((event) => event.type === 'pipeline.completed')

    const rows = await runRows()
    expect(rows).toHaveLength(2)
    const [parent, child] = rows
    expect(parent).toMatchObject({
      attempt: 1,
      status: 'failed',
      // A typed metrics failure still reports the sandbox that ran.
      sandbox_id: 'sandbox-metrics-1',
    })
    expect(child).toMatchObject({
      attempt: 2,
      parent_run_id: parent!.id,
      status: 'succeeded',
      verdict: 'match',
      sandbox_id: 'sandbox-test-1',
    })
    expect(child!.spec.files['main.py']).toBe(candidate)

    const notebooks = await testDb.pool.query<{ content: string }>(
      "SELECT content FROM run_artifacts WHERE run_id = $1 AND kind = 'notebook'",
      [child!.id],
    )
    expect(notebooks.rows).toHaveLength(1)
    const notebook = JSON.parse(notebooks.rows[0]!.content)
    expect(notebook).toMatchObject({ nbformat: 4, nbformat_minor: 5 })
    expect(notebook.cells[0].source.join('')).toContain('Reproducibility Record')

    // One REPAIR_SCRIPT model call, one task row, scoped to the failed parent
    // run: a metrics failure opens the repair path without duplicating either.
    const repairTasks = await testDb.pool.query<{ input_ref: unknown }>(
      "SELECT input_ref FROM agent_tasks WHERE task_kind = 'repair_script'",
    )
    expect(repairTasks.rows).toEqual([
      { input_ref: { experimentId: seed.experimentId, runId: parent!.id } },
    ])
  })

  it('does not enter the repair loop for a pinned-package mismatch', async () => {
    const runner: StubRunner = {
      ...createStubRunner('succeed'),
      async run() {
        this.runCalls++
        throw new PackageVerificationError(
          'Sandbox environment failed package verification: numpy',
          0,
          'computed\n',
          '',
          0,
          undefined,
          {},
          'sandbox-packages-1',
        )
      },
    }
    const handlers = handlersFor(runner)
    const sse = consume(await handlers.stream(streamRequest(seed.experimentId), {
      experimentId: seed.experimentId,
    }))
    await approveRequested(handlers, sse)
    await sse.waitFor((event) => event.type === 'pipeline.completed')

    expect(runner.runCalls).toBe(1)
    const rows = await runRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      attempt: 1,
      status: 'failed',
      // A typed package failure still reports the sandbox that ran.
      sandbox_id: 'sandbox-packages-1',
    })
    const tasks = await testDb.pool.query(
      "SELECT id FROM agent_tasks WHERE task_kind = 'repair_script'",
    )
    expect(tasks.rows).toHaveLength(0)
  })

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
    const run = runner.run.bind(runner)
    const output = Buffer.from('feature,rank\nnoise_20,4\n')
    const artifact = {
      path: '/output/importance.csv',
      sha256: createHash('sha256').update(output).digest('hex'),
      bytes: output.byteLength,
      content: output.toString('base64'),
    }
    runner.run = async (...args) => ({ ...(await run(...args)), artifacts: [artifact] })
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
      // Run A: a fresh attempt-1 row with no parent; no branch row exists.
      parent_run_id: null,
      attempt: 1,
      status: 'succeeded',
      metrics: { score: 0.9 },
      verdict: 'match',
      started_at: expect.any(Date),
      // The runner reports its sandbox id and the measured-result update
      // persists it; the earlier `run.started` event could not (no sandbox yet).
      sandbox_id: 'sandbox-test-1',
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
    const artifacts = await testDb.pool.query(
      'SELECT kind, path, sha256, bytes, content FROM run_artifacts WHERE run_id = $1',
      [completed.runId],
    )
    // The runner's table artifact and #67's exported notebook are both stored.
    expect(artifacts.rows).toHaveLength(2)
    expect(artifacts.rows).toEqual(
      expect.arrayContaining([{ ...artifact, kind: 'table' }]),
    )

    const verdict = (await sse.waitFor(
      (event) => event.type === 'verdict.computed',
    )) as Extract<PipelineEvent, { type: 'verdict.computed' }>
    expect(verdict.verdict).toBe('match')

    const notebookArtifacts = await testDb.pool.query<{
      kind: string
      content: string
    }>(
      "SELECT kind, content FROM run_artifacts WHERE run_id = $1 AND kind = 'notebook'",
      [completed.runId],
    )
    expect(notebookArtifacts.rows).toHaveLength(1)
    expect(notebookArtifacts.rows[0]?.kind).toBe('notebook')
    const notebook = JSON.parse(notebookArtifacts.rows[0]!.content)
    expect(notebook).toMatchObject({ nbformat: 4, nbformat_minor: 5 })
    const metadata = notebook.cells[0].source.join('')
    expect(metadata).toContain('noise can outrank informative features')
    expect(metadata).toContain(rows[0]!.verdict_detail!.explanation)
    // The synthetic spec is not the supported template, so the notebook must
    // not claim the fixed breast-w protocol.
    expect(metadata).not.toContain('fixed adapted breast-w protocol')

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

  it('adopts the queued what-if child run and freezes the approved spec', async () => {
    const branch = await seedQueuedWhatIfChild({
      queuedSeed: 7,
      approvedSeed: 11,
    })
    const startedRows: Awaited<ReturnType<typeof runRows>>[] = []
    const runner = createObservingRunner('succeed', async () => {
      startedRows.push(await runRows(branch.childExperimentId))
    })
    const handlers = handlersFor(runner)

    const sse = consume(
      await handlers.stream(streamRequest(branch.childExperimentId), {
        experimentId: branch.childExperimentId,
      }),
    )
    const requested = (await sse.waitFor(
      (event) => event.type === 'approval.requested',
    )) as Extract<PipelineEvent, { type: 'approval.requested' }>
    expect(requested.spec).toEqual(branch.approvedSpec)

    await approveRequested(
      handlers,
      sse,
      'approved',
      branch.childExperimentId,
    )

    const completed = (await sse.waitFor(
      (event) => event.type === 'pipeline.completed',
    )) as Extract<PipelineEvent, { type: 'pipeline.completed' }>
    await sse.waitForClose()

    // The branch id and lineage survive EXECUTE; no second row was inserted.
    expect(completed.runId).toBe(branch.queuedRunId)
    expect(completed.runId).not.toBe('11111111-1111-4111-8111-111111111111')
    expect(runner.runCalls).toBe(1)

    // The transport reports the adopted identity, not a fresh one.
    const started = (await sse.waitFor(
      (event) => event.type === 'run.started',
    )) as Extract<PipelineEvent, { type: 'run.started' }>
    expect(started).toMatchObject({
      runId: branch.queuedRunId,
      attempt: 1,
      sandboxId: null,
    })

    expect(startedRows).toHaveLength(1)
    const atStart = startedRows[0] ?? []
    expect(atStart).toHaveLength(1)
    expect(atStart[0]).toMatchObject({
      id: branch.queuedRunId,
      experiment_id: branch.childExperimentId,
      parent_run_id: branch.parentRunId,
      attempt: 1,
      status: 'running',
    })
    // The approved plan is frozen into the adopted row before the sandbox,
    // and the execution timestamp/environment are initialized.
    expect(atStart[0]?.spec).toEqual(branch.approvedSpec)
    expect(atStart[0]?.started_at).toBeInstanceOf(Date)
    expect(atStart[0]?.environment).toMatchObject({
      imageDigest: 'unknown',
      python: 'unknown',
      seeds: [11],
      startedAt: expect.any(String),
    })
    expect(
      (atStart[0]?.environment as { startedAt: string }).startedAt,
    ).not.toBe('')

    const rows = await runRows(branch.childExperimentId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: branch.queuedRunId,
      experiment_id: branch.childExperimentId,
      parent_run_id: branch.parentRunId,
      attempt: 1,
      status: 'succeeded',
      metrics: { score: 0.9 },
      verdict: 'match',
      started_at: expect.any(Date),
    })
    expect(rows[0]?.spec).toEqual(branch.approvedSpec)
    expect(rows[0]?.spec).not.toEqual(branch.queuedSpec)

    // The parent run is never touched.
    const parent = await testDb.pool.query<{
      parent_run_id: string | null
      status: string
    }>('SELECT parent_run_id, status FROM runs WHERE id = $1', [
      branch.parentRunId,
    ])
    expect(parent.rows[0]).toEqual({
      parent_run_id: null,
      status: 'succeeded',
    })

    // #7 projection uses the adopted identity, not a second run.
    const graph = await graphRows()
    const runNode = graph.nodes.find((node) => node.type === 'run')
    const resultNode = graph.nodes.find((node) => node.type === 'result')
    expect(runNode?.data).toEqual({
      type: 'run',
      runId: branch.queuedRunId,
      status: 'succeeded',
      mode: 'adapted',
    })
    expect(resultNode?.data).toEqual({
      type: 'result',
      metrics: { score: 0.9 },
      runId: branch.queuedRunId,
      verdict: 'match',
    })
    expect(graph.edges).toEqual([
      expect.objectContaining({
        source_node_id: runNode?.id,
        target_node_id: resultNode?.id,
        relation: 'produced',
        status: 'accepted',
        evidence_run_id: branch.queuedRunId,
      }),
    ])
  })

  it('refuses a second run instead of duplicating an already-started branch child', async () => {
    const branch = await seedQueuedWhatIfChild({
      queuedSeed: 7,
      approvedSeed: 7,
    })
    // Another owner already adopted the queued row.
    await testDb.pool.query(
      `UPDATE runs SET status = 'running', started_at = now() WHERE id = $1`,
      [branch.queuedRunId],
    )

    const runner = createStubRunner('succeed')
    const handlers = handlersFor(runner)
    const sse = consume(
      await handlers.stream(streamRequest(branch.childExperimentId), {
        experimentId: branch.childExperimentId,
      }),
    )
    await approveRequested(
      handlers,
      sse,
      'approved',
      branch.childExperimentId,
    )

    const failed = (await sse.waitFor(
      (event) => event.type === 'pipeline.failed',
    )) as Extract<PipelineEvent, { type: 'pipeline.failed' }>
    await sse.waitForClose()

    expect(failed.error).toBe('The experiment already has a run')
    expect(runner.runCalls).toBe(0)
    expect(
      sse.events.some((event) => event.type === 'run.started'),
    ).toBe(false)

    // The already-started row is left alone; no duplicate attempt-1 row.
    const rows = await runRows(branch.childExperimentId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: branch.queuedRunId,
      parent_run_id: branch.parentRunId,
      status: 'running',
    })

    // Nothing terminal was executed, so nothing was projected.
    const graph = await graphRows()
    expect(
      graph.nodes.filter(
        (node) => node.type === 'run' || node.type === 'result',
      ),
    ).toHaveLength(0)
  })

  it('refuses to adopt a queued branch when another run exists', async () => {
    const branch = await seedQueuedWhatIfChild({ queuedSeed: 7, approvedSeed: 7 })
    await testDb.pool.query(
      `INSERT INTO runs (experiment_id, attempt, status, spec, parameters, environment)
       SELECT experiment_id, 2, 'running', spec, parameters, environment
       FROM runs WHERE id = $1`,
      [branch.queuedRunId],
    )

    const runner = createStubRunner('succeed')
    const handlers = handlersFor(runner)
    const sse = consume(
      await handlers.stream(streamRequest(branch.childExperimentId), {
        experimentId: branch.childExperimentId,
      }),
    )
    await approveRequested(handlers, sse, 'approved', branch.childExperimentId)
    const failed = await sse.waitFor((event) => event.type === 'pipeline.failed')
    await sse.waitForClose()

    expect(failed).toMatchObject({ error: 'The experiment already has a run' })
    expect(runner.runCalls).toBe(0)
    const rows = await runRows(branch.childExperimentId)
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.id === branch.queuedRunId)?.status).toBe('queued')
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

  it('emits run.failed for a non-zero exit that still produced valid metrics', async () => {
    const originalScript = seed.spec.files['main.py']!
    // A substantive change, so the repaired candidate re-opens the gate.
    const candidate = originalScript.replace('0.9', '0.8')
    const runner: StubRunner = {
      ...createStubRunner('succeed'),
      async run() {
        this.runCalls++
        if (this.runCalls === 1) {
          // The script wrote valid metrics but exited non-zero: the row is
          // `failed`, so the event must be `run.failed`, not `run.succeeded`.
          return measuredResult({
            exitCode: 1,
            stderr: 'AssertionError: score too low',
            metrics: { score: 0.4 },
          })
        }
        return measuredResult({ metrics: { score: 0.8 } })
      },
    }
    const callModel = createCallModel({
      generate: async ({ prompt }) => ({
        output: prompt.includes('score too low')
          ? { script: candidate, summary: 'Relaxed the failing threshold' }
          : { explanation: 'The verdict was computed from the run.' },
        inputTokens: 15,
        outputTokens: 10,
      }),
    })
    const handlers = handlersFor(runner, FAST_TIMINGS, callModel)
    const sse = consume(await handlers.stream(streamRequest(seed.experimentId), {
      experimentId: seed.experimentId,
    }))
    const initial = await approveRequested(handlers, sse)

    const runFailed = (await sse.waitFor(
      (event) => event.type === 'run.failed',
    )) as Extract<PipelineEvent, { type: 'run.failed' }>
    expect(runFailed.error).toBe('The experiment script did not exit successfully')

    const failedRows = await runRows()
    expect(failedRows).toHaveLength(1)
    expect(failedRows[0]).toMatchObject({
      id: runFailed.runId,
      status: 'failed',
      metrics: { score: 0.4 },
    })

    // A non-zero exit with valid metrics is still repairable, so the repair
    // gate must appear after the failed event.
    const repairGate = await sse.waitFor(
      (event) => event.type === 'approval.requested' && event.seq > initial.seq,
    )
    expect(runner.runCalls).toBe(1)

    const response = await handlers.approve(
      approveRequest(seed.experimentId, repairGate.seq, 'approved'),
      { experimentId: seed.experimentId },
    )
    expect(response.status).toBe(200)
    await sse.waitFor((event) => event.type === 'pipeline.completed')

    const rows = await runRows()
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({
      attempt: 2,
      parent_run_id: rows[0]!.id,
      status: 'succeeded',
    })
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

  /**
   * Simulates the creation race: when the budget aborts, the runner holds no
   * sandbox yet (as during `Sandbox.create`); it registers one only after the
   * abort has fired, then settles.
   */
  function createLateSandboxRunner(delayMs: number): StubRunner {
    const active = new Map<string, unknown>()
    const cancelCalls: string[] = []
    let runCalls = 0
    return {
      get runCalls() {
        return runCalls
      },
      cancelCalls,
      getActiveSandboxes: () => active,
      async run() {
        runCalls += 1
        await new Promise((resolve) => setTimeout(resolve, delayMs))
        active.set('sandbox-late', {})
        return measuredResult({ sandboxId: 'sandbox-late' })
      },
      async cancel(sandboxId) {
        cancelCalls.push(sandboxId)
        active.delete(sandboxId)
      },
    }
  }

  it('disposes a sandbox that was still being created when the budget aborted', async () => {
    const runner = createLateSandboxRunner(1_200)
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
    await sse.waitFor((event) => event.type === 'run.timeout', 5_000)
    await sse.waitForClose(5_000)

    // The abort listener swept while the map was empty; the sweep after the
    // runner settled is what disposes the late sandbox instead of leaving it
    // to E2B's timeout. The stage settles after the stream's terminal, so poll.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (runner.cancelCalls.includes('sandbox-late')) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(runner.cancelCalls).toEqual(['sandbox-late'])
    expect(runner.getActiveSandboxes().size).toBe(0)

    // The aborted run is still marked durable and terminal.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const rows = await runRows()
      if (rows[0]?.status === 'timeout') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const rows = await runRows()
    expect(rows[0]).toMatchObject({
      status: 'timeout',
      verdict: null,
      // The sandbox created after the abort still lands on the run row.
      sandbox_id: 'sandbox-late',
    })
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
    expect(rows[0]).toMatchObject({
      status: 'timeout',
      verdict: null,
      sandbox_id: 'sandbox-test-1',
    })

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
