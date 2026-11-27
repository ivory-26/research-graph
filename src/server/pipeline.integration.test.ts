/**
 * The run → graph seam over a real Postgres database (#7).
 *
 * These tests use the same disposable-database harness as the delivery
 * integration suites: real migrations, real constraints, real transactions.
 * Nothing here needs E2B, Gemini or a production database.
 *
 * The rollback test forces a failure after both node inserts by installing a
 * `BEFORE INSERT` trigger on `edges`. That is the only way to prove the
 * transaction really covers the node writes rather than just the last
 * statement.
 *
 * Skipped unless `TEST_DATABASE_URL` is set. See
 * `pipeline-delivery/test-support/pg.ts` for the disposable-database rules.
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

import type {
  ExperimentSpec,
  RunStatus,
  Verdict,
  VerdictDetail,
} from '../shared/types'
import {
  projectRunToGraph,
  RunGraphError,
  type RunGraphProjection,
} from './pipeline'
import { makeValidSpec } from './pipeline-delivery/test-support/production-fixtures'
import {
  createTestDatabase,
  seedWorkspace,
  type SeededWorkspace,
  type TestDatabase,
} from './pipeline-delivery/test-support/pg'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip

const TEST_ENVIRONMENT = {
  imageDigest: 'sha256:test-image',
  python: 'Python 3.12.16',
  packages: {},
  datasets: [],
  seeds: [42],
  startedAt: new Date(0).toISOString(),
}

const TRIGGER_NAME = 'rg_test_fail_edge_insert'
const FUNCTION_NAME = 'rg_test_fail_edge_insert'

type InsertRunOptions = {
  experimentId: string
  spec: ExperimentSpec
  status: RunStatus
  attempt?: number
  metrics?: Record<string, number>
  verdict?: Verdict | null
  verdictDetail?: VerdictDetail | null
  stdout?: string
  stderr?: string
}

type NodeRow = {
  id: string
  workspace_id: string
  type: string
  title: string
  data: Record<string, unknown>
  position_x: number
  position_y: number
  source_id: string | null
}

type EdgeRow = {
  id: string
  workspace_id: string
  source_node_id: string
  target_node_id: string
  relation: string
  status: string
  evidence_chunk_id: string | null
  evidence_run_id: string | null
  confidence: number | null
}

describeIntegration('run → graph projection over real Postgres', () => {
  let testDb: TestDatabase
  let seed: SeededWorkspace

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
    // `reset()` truncates rows, not functions or triggers.
    await testDb.pool.query(
      `DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON edges`,
    )
    await testDb.pool.query(
      `DROP FUNCTION IF EXISTS ${FUNCTION_NAME}()`,
    )
  })

  async function insertRun(options: InsertRunOptions): Promise<string> {
    const result = await testDb.pool.query<{ id: string }>(
      `INSERT INTO runs (
         experiment_id, attempt, status, spec, parameters, metrics,
         environment, verdict, verdict_detail, stdout, stderr,
         started_at, finished_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now()
       ) RETURNING id`,
      [
        options.experimentId,
        options.attempt ?? 1,
        options.status,
        JSON.stringify(options.spec),
        JSON.stringify(options.spec.parameters),
        JSON.stringify(options.metrics ?? {}),
        JSON.stringify(TEST_ENVIRONMENT),
        options.verdict ?? null,
        options.verdictDetail === undefined
          ? null
          : JSON.stringify(options.verdictDetail),
        options.stdout ?? '',
        options.stderr ?? '',
      ],
    )
    const id = result.rows[0]?.id
    if (!id) throw new Error('run insert returned no row')
    return id
  }

  async function graphRows(workspaceId: string) {
    const nodeResult = await testDb.pool.query<NodeRow>(
      `SELECT id, workspace_id, type, title, data, position_x, position_y,
              source_id
         FROM nodes
        WHERE workspace_id = $1
        ORDER BY created_at, id`,
      [workspaceId],
    )
    const edgeResult = await testDb.pool.query<EdgeRow>(
      `SELECT id, workspace_id, source_node_id, target_node_id, relation,
              status, evidence_chunk_id, evidence_run_id, confidence
         FROM edges
        WHERE workspace_id = $1
        ORDER BY created_at, id`,
      [workspaceId],
    )
    return { nodes: nodeResult.rows, edges: edgeResult.rows }
  }

  async function countGraph(workspaceId: string) {
    const result = await testDb.pool.query<{
      nodes: number
      run_nodes: number
      result_nodes: number
      edges: number
    }>(
      `SELECT
         (SELECT count(*)::int FROM nodes WHERE workspace_id = $1) AS nodes,
         (SELECT count(*)::int FROM nodes WHERE workspace_id = $1 AND type = 'run') AS run_nodes,
         (SELECT count(*)::int FROM nodes WHERE workspace_id = $1 AND type = 'result') AS result_nodes,
         (SELECT count(*)::int FROM edges WHERE workspace_id = $1) AS edges`,
      [workspaceId],
    )
    const row = result.rows[0]
    if (!row) throw new Error('count query returned no row')
    return row
  }

  function expectProjectionShape(
    projection: RunGraphProjection,
    runId: string,
    status: RunStatus,
  ): void {
    expect(projection.runId).toBe(runId)
    expect(projection.workspaceId).toBe(seed.workspaceId)
    expect(projection.runNode).toMatchObject({
      type: 'run',
      data: { type: 'run', runId, status, mode: 'adapted' },
    })
    expect(projection.runNode.title).toContain('Run ·')
    expect(projection.resultNode).toMatchObject({
      type: 'result',
      data: { type: 'result', runId },
    })
    expect(projection.resultNode.title).toContain('Result ·')
    expect(projection.edge).toMatchObject({
      sourceNodeId: projection.runNode.id,
      targetNodeId: projection.resultNode.id,
      relation: 'produced',
      status: 'accepted',
      evidenceChunkId: null,
      evidenceRunId: runId,
      confidence: 1,
    })
  }

  it('writes one run node, one result node and one accepted produced edge', async () => {
    const runId = await insertRun({
      experimentId: seed.experimentId,
      spec: seed.spec,
      status: 'succeeded',
      metrics: { score: 0.9 },
      verdict: 'match',
      verdictDetail: {
        checks: [
          {
            metric: 'score',
            op: 'gte',
            threshold: 0.5,
            tolerance: null,
            measured: 0.9,
            passed: true,
          },
        ],
        explanation: 'The measured score exceeded the threshold.',
      },
    })

    const projection = await projectRunToGraph(testDb.db, runId)

    expect(projection.created).toBe(true)
    expectProjectionShape(projection, runId, 'succeeded')
    expect(projection.resultNode.data).toEqual({
      type: 'result',
      metrics: { score: 0.9 },
      runId,
      verdict: 'match',
    })

    // Workspace came from the experiment, and the rows agree with it.
    const graph = await graphRows(seed.workspaceId)
    const runNodes = graph.nodes.filter((node) => node.type === 'run')
    const resultNodes = graph.nodes.filter((node) => node.type === 'result')
    expect(runNodes).toHaveLength(1)
    expect(resultNodes).toHaveLength(1)
    expect(runNodes[0]).toMatchObject({
      id: projection.runNode.id,
      workspace_id: seed.workspaceId,
      data: { type: 'run', runId, status: 'succeeded', mode: 'adapted' },
      source_id: null,
    })
    expect(resultNodes[0]).toMatchObject({
      id: projection.resultNode.id,
      workspace_id: seed.workspaceId,
      data: { type: 'result', metrics: { score: 0.9 }, runId, verdict: 'match' },
      source_id: null,
    })
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]).toMatchObject({
      id: projection.edge.id,
      workspace_id: seed.workspaceId,
      source_node_id: projection.runNode.id,
      target_node_id: projection.resultNode.id,
      relation: 'produced',
      status: 'accepted',
      evidence_chunk_id: null,
      evidence_run_id: runId,
      confidence: 1,
    })

    // New nodes get distinct seed positions rather than stacking at (0, 0).
    expect(runNodes[0]?.position_x).not.toBe(resultNodes[0]?.position_x)
    expect(runNodes[0]?.position_y).toBe(resultNodes[0]?.position_y)
  })

  it('keeps a failed run’s stderr on the run row, reachable through data.runId', async () => {
    const stderr =
      'Traceback (most recent call last):\n  File "main.py", line 3\nValueError: boom\n'

    const runId = await insertRun({
      experimentId: seed.experimentId,
      spec: seed.spec,
      status: 'failed',
      stdout: 'starting\n',
      stderr,
      metrics: {},
      verdict: 'failed',
      verdictDetail: { checks: [], explanation: null },
    })

    const projection = await projectRunToGraph(testDb.db, runId)

    expectProjectionShape(projection, runId, 'failed')
    expect(projection.resultNode.data).toEqual({
      type: 'result',
      metrics: {},
      runId,
      verdict: 'failed',
    })

    // The frozen NodeData is not widened: the node carries only the handle.
    expect(JSON.stringify(projection.runNode.data)).not.toContain('Traceback')
    expect(projection.runNode.data).not.toHaveProperty('stderr')

    // A consumer holding the run node resolves the canonical stderr here.
    const nodeRunId = (projection.runNode.data as { runId: string }).runId
    const stored = await testDb.pool.query<{ stderr: string; status: string }>(
      'SELECT stderr, status FROM runs WHERE id = $1',
      [nodeRunId],
    )
    expect(stored.rows[0]).toEqual({ stderr, status: 'failed' })
  })

  it('projects timeout and cancelled runs as terminal', async () => {
    for (const status of ['timeout', 'cancelled'] as const) {
      const runId = await insertRun({
        experimentId: seed.experimentId,
        spec: seed.spec,
        status,
        stdout: 'partial output\n',
        stderr: '',
        verdict: null,
      })

      const projection = await projectRunToGraph(testDb.db, runId)
      expect(projection.created).toBe(true)
      expectProjectionShape(projection, runId, status)
      expect(projection.resultNode.data).toMatchObject({
        type: 'result',
        runId,
        verdict: null,
      })
    }

    const counts = await countGraph(seed.workspaceId)
    expect(counts).toMatchObject({
      nodes: 5, // the seeded claim, plus two runs and two results
      run_nodes: 2,
      result_nodes: 2,
      edges: 2,
    })
  })

  it('refuses queued and running runs without writing anything', async () => {
    for (const status of ['queued', 'running'] as const) {
      const runId = await insertRun({
        experimentId: seed.experimentId,
        spec: seed.spec,
        status,
      })

      await expect(projectRunToGraph(testDb.db, runId)).rejects.toMatchObject({
        name: 'RunGraphError',
        code: 'RUN_NOT_TERMINAL',
      })
    }

    expect(await countGraph(seed.workspaceId)).toEqual({
      nodes: 1,
      run_nodes: 0,
      result_nodes: 0,
      edges: 0,
    })
  })

  it('refuses a run id that does not exist', async () => {
    await expect(
      projectRunToGraph(testDb.db, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toBeInstanceOf(RunGraphError)

    expect(await countGraph(seed.workspaceId)).toEqual({
      nodes: 1,
      run_nodes: 0,
      result_nodes: 0,
      edges: 0,
    })
  })

  it('replays serially with stable identity, preserved positions and fresh data', async () => {
    const runId = await insertRun({
      experimentId: seed.experimentId,
      spec: seed.spec,
      status: 'succeeded',
      metrics: { score: 0.9 },
      verdict: null,
    })

    const first = await projectRunToGraph(testDb.db, runId)
    expect(first.created).toBe(true)

    // The canvas moved the result node, and the verdict landed after the first
    // projection (the abort-then-evaluate shape this seam must tolerate).
    await testDb.pool.query(
      'UPDATE nodes SET position_x = 999, position_y = 888 WHERE id = $1',
      [first.resultNode.id],
    )
    await testDb.pool.query(
      `UPDATE runs SET verdict = 'match', verdict_detail = $2 WHERE id = $1`,
      [
        runId,
        JSON.stringify({ checks: [], explanation: null }),
      ],
    )

    const second = await projectRunToGraph(testDb.db, runId)
    expect(second.created).toBe(false)
    expect(second.runNode.id).toBe(first.runNode.id)
    expect(second.resultNode.id).toBe(first.resultNode.id)
    expect(second.edge.id).toBe(first.edge.id)
    expect(second.resultNode.data).toMatchObject({
      type: 'result',
      metrics: { score: 0.9 },
      runId,
      verdict: 'match',
    })

    const graph = await graphRows(seed.workspaceId)
    expect(graph.nodes).toHaveLength(3)
    expect(graph.edges).toHaveLength(1)
    const moved = graph.nodes.find((node) => node.id === first.resultNode.id)
    expect(moved).toMatchObject({ position_x: 999, position_y: 888 })
  })

  it('serializes concurrent replays into one row set', async () => {
    const runId = await insertRun({
      experimentId: seed.experimentId,
      spec: seed.spec,
      status: 'succeeded',
      metrics: { score: 0.9 },
      verdict: 'match',
    })

    const projections = await Promise.all(
      Array.from({ length: 4 }, () => projectRunToGraph(testDb.db, runId)),
    )

    const runNodeIds = new Set(projections.map((p) => p.runNode.id))
    const resultNodeIds = new Set(projections.map((p) => p.resultNode.id))
    const edgeIds = new Set(projections.map((p) => p.edge.id))
    expect(runNodeIds.size).toBe(1)
    expect(resultNodeIds.size).toBe(1)
    expect(edgeIds.size).toBe(1)
    expect(projections.filter((p) => p.created)).toHaveLength(1)

    expect(await countGraph(seed.workspaceId)).toEqual({
      nodes: 3,
      run_nodes: 1,
      result_nodes: 1,
      edges: 1,
    })
  })

  it('rolls both node writes back when the edge write fails', async () => {
    const runId = await insertRun({
      experimentId: seed.experimentId,
      spec: seed.spec,
      status: 'succeeded',
      metrics: { score: 0.9 },
      verdict: 'match',
    })

    // Fail after the run and result inserts, at the last statement of the
    // transaction. If the transaction is real, neither node survives.
    await testDb.pool.query(`
      CREATE OR REPLACE FUNCTION ${FUNCTION_NAME}()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced edge failure';
      END;
      $$ LANGUAGE plpgsql
    `)
    await testDb.pool.query(`
      CREATE TRIGGER ${TRIGGER_NAME}
      BEFORE INSERT ON edges
      FOR EACH ROW EXECUTE FUNCTION ${FUNCTION_NAME}()
    `)

    let failure: unknown
    try {
      await projectRunToGraph(testDb.db, runId)
    } catch (error) {
      failure = error
    }

    // Drizzle wraps the driver error; walk the cause chain to prove the edge
    // statement is what failed, after both node inserts succeeded.
    const messages: string[] = []
    let current: unknown = failure
    for (let depth = 0; current !== null && depth < 6; depth += 1) {
      if (current instanceof Error) messages.push(current.message)
      if (typeof current !== 'object' || !('cause' in current)) break
      current = (current as { cause?: unknown }).cause
    }
    expect(messages.join('\n')).toContain('forced edge failure')

    expect(await countGraph(seed.workspaceId)).toEqual({
      nodes: 1,
      run_nodes: 0,
      result_nodes: 0,
      edges: 0,
    })
  })

  it('takes the workspace from the run’s experiment, not the caller’s', async () => {
    // A second workspace, claim and experiment, independent of the seeded one.
    const other = await seedWorkspace(testDb.pool, {
      spec: makeValidSpec('other-claim-placeholder'),
    })
    const runId = await insertRun({
      experimentId: other.experimentId,
      spec: other.spec,
      status: 'succeeded',
      metrics: { score: 0.9 },
      verdict: 'match',
    })

    const projection = await projectRunToGraph(testDb.db, runId)

    expect(projection.workspaceId).toBe(other.workspaceId)
    expect(projection.workspaceId).not.toBe(seed.workspaceId)

    const otherGraph = await graphRows(other.workspaceId)
    expect(otherGraph.nodes).toHaveLength(3) // claim + run + result
    expect(otherGraph.edges).toHaveLength(1)
    expect(
      otherGraph.nodes.every((node) => node.workspace_id === other.workspaceId),
    ).toBe(true)

    // The first workspace is untouched.
    expect(await countGraph(seed.workspaceId)).toEqual({
      nodes: 1,
      run_nodes: 0,
      result_nodes: 0,
      edges: 0,
    })
  })
})
