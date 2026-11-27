/**
 * Real-Postgres coverage for the seed's run-lineage anchors and five edges.
 *
 * The pure tests in `run-edges.test.ts` pin selection, ambiguity and the edge
 * plan without a database. These tests exercise the SQL paths the seed
 * actually runs: `ensureRunGraphAnchors` selecting/creating workspace-scoped
 * nodes, and `writeRunGraphEdges` persisting exactly five `accepted`,
 * run-evidenced edges or refusing before writing any.
 *
 * Skipped unless `TEST_DATABASE_URL` is set. The URL names a server; the
 * harness creates a uniquely named, disposable database on it, migrates only
 * that database, and drops only that database. See
 * `src/server/pipeline-delivery/test-support/pg.ts`. No E2B, model or network
 * call is involved.
 */
import { eq, inArray } from 'drizzle-orm'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'

import {
  edges as edgesTable,
  experiments as experimentsTable,
  nodes as nodesTable,
  runs as runsTable,
  sources as sourcesTable,
} from '../../src/db/schema.ts'
import type {
  ExperimentSpec,
  RunEnvironment,
  RunStatus,
} from '../../src/shared/types.ts'
import {
  createTestDatabase,
  seedWorkspace,
  type SeededWorkspace,
  type TestDatabase,
} from '../../src/server/pipeline-delivery/test-support/pg.ts'
import {
  RunEdgeError,
  ensureRunGraphAnchors,
  writeRunGraphEdges,
  type RunEdgeErrorCode,
  type RunGraphAnchors,
} from './run-edges.ts'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip

const DATASET_SHA256 =
  'cb44e7f62f4a962881147264e5f985eacc13256712e7a4b9d1731ced05f3ee9b'
const DATASET_BYTES = 19177

function runSpec(
  claimNodeId: string,
  importanceMethod: 'impurity' | 'permutation',
): ExperimentSpec {
  return {
    claimNodeId,
    mode: 'adapted',
    language: 'python',
    image: 'researchgraph/base:test',
    files: { 'main.py': 'print("fixture")\n' },
    entrypoint: 'python main.py',
    datasets: [
      {
        name: 'breast-w',
        url: 'https://www.openml.org/data/download/52350/breast-w.arff',
        path: 'data/breast-w.arff',
        sha256: DATASET_SHA256,
        bytes: DATASET_BYTES,
      },
    ],
    parameters: { importance_method: importanceMethod, seed: 42 },
    criteria: {
      mode: 'all',
      checks: [{ metric: 'score', op: 'gte', value: 0.5 }],
    },
    timeoutSeconds: 60,
    memoryMb: 2048,
    cpuCount: 1,
    network: 'none',
  }
}

function runEnvironment(): RunEnvironment {
  return {
    imageDigest: 'sha256:test-image',
    python: 'Python 3.12.16',
    packages: {},
    datasets: [
      { name: 'breast-w', sha256: DATASET_SHA256, bytes: DATASET_BYTES },
    ],
    seeds: [42],
    startedAt: '2026-11-25T12:00:00.000Z',
  }
}

async function expectRunEdgeError(
  promise: Promise<unknown>,
  code: RunEdgeErrorCode,
): Promise<RunEdgeError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(RunEdgeError)
    expect((error as RunEdgeError).code).toBe(code)
    return error as RunEdgeError
  }
  throw new Error(`expected a RunEdgeError with code ${code}`)
}

describeIntegration('seed run edges over real Postgres', () => {
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
    seed = await seedWorkspace(testDb.pool)
  })

  async function insertSource(workspaceId: string): Promise<string> {
    const [row] = await testDb.db
      .insert(sourcesTable)
      .values({
        workspaceId,
        kind: 'pdf',
        title: 'Strobl 2007',
        url: 'https://example.test/strobl-2007.pdf',
        doi: null,
        sha256: 'a'.repeat(64),
        bytes: 1,
        meta: {},
      })
      .returning({ id: sourcesTable.id })
    if (!row) throw new Error('source insert returned no row')
    return row.id
  }

  async function insertMethodNode(
    workspaceId: string,
    title: string,
    sourceId: string | null = null,
  ): Promise<string> {
    const [row] = await testDb.db
      .insert(nodesTable)
      .values({
        workspaceId,
        type: 'method',
        title,
        data: { type: 'method', summary: 'extracted method', library: null },
        sourceId,
      })
      .returning({ id: nodesTable.id })
    if (!row) throw new Error('method node insert returned no row')
    return row.id
  }

  async function insertDatasetNode(
    workspaceId: string,
    name: string,
  ): Promise<string> {
    const [row] = await testDb.db
      .insert(nodesTable)
      .values({
        workspaceId,
        type: 'dataset',
        title: name,
        data: {
          type: 'dataset',
          name,
          url: 'https://example.test/breast-w.arff',
          sha256: null,
          rows: null,
        },
      })
      .returning({ id: nodesTable.id })
    if (!row) throw new Error('dataset node insert returned no row')
    return row.id
  }

  async function insertExperiment(
    claimNodeId: string,
    spec: ExperimentSpec,
  ): Promise<string> {
    const [row] = await testDb.db
      .insert(experimentsTable)
      .values({
        workspaceId: seed.workspaceId,
        claimNodeId,
        spec,
        mode: spec.mode,
        approvalState: 'approved',
      })
      .returning({ id: experimentsTable.id })
    if (!row) throw new Error('experiment insert returned no row')
    return row.id
  }

  async function insertRun(options: {
    experimentId: string
    spec: ExperimentSpec
    status?: RunStatus
    parentRunId?: string | null
  }): Promise<string> {
    const [row] = await testDb.db
      .insert(runsTable)
      .values({
        experimentId: options.experimentId,
        parentRunId: options.parentRunId ?? null,
        attempt: 1,
        status: options.status ?? 'succeeded',
        spec: options.spec,
        parameters: options.spec.parameters,
        environment: runEnvironment(),
      })
      .returning({ id: runsTable.id })
    if (!row) throw new Error('run insert returned no row')
    return row.id
  }

  async function insertRunNode(
    runId: string,
    status: RunStatus = 'succeeded',
  ): Promise<string> {
    const [row] = await testDb.db
      .insert(nodesTable)
      .values({
        workspaceId: seed.workspaceId,
        type: 'run',
        title: 'Run · fixture claim',
        data: { type: 'run', runId, status, mode: 'adapted' },
      })
      .returning({ id: nodesTable.id })
    if (!row) throw new Error('run node insert returned no row')
    return row.id
  }

  async function insertTerminalRunPair(): Promise<{
    runAId: string
    runBId: string
    runANodeId: string
    runBNodeId: string
  }> {
    const specA = runSpec(seed.claimNodeId, 'impurity')
    const specB = runSpec(seed.claimNodeId, 'permutation')

    const experimentAId = await insertExperiment(seed.claimNodeId, specA)
    const experimentBId = await insertExperiment(seed.claimNodeId, specB)
    const runAId = await insertRun({
      experimentId: experimentAId,
      spec: specA,
    })
    const runBId = await insertRun({
      experimentId: experimentBId,
      spec: specB,
      parentRunId: runAId,
    })

    return {
      runAId,
      runBId,
      runANodeId: await insertRunNode(runAId),
      runBNodeId: await insertRunNode(runBId),
    }
  }

  async function edgesInWorkspace(): Promise<Array<typeof edgesTable.$inferSelect>> {
    return testDb.db
      .select()
      .from(edgesTable)
      .where(eq(edgesTable.workspaceId, seed.workspaceId))
  }

  it('creates spec-derived anchors scoped to the workspace and ignores extracted titles', async () => {
    const sourceId = await insertSource(seed.workspaceId)
    const extractedMethodId = await insertMethodNode(
      seed.workspaceId,
      'Gini importance',
      sourceId,
    )

    // Same-looking nodes in the other workspace must never be selected.
    const foreignMethodAId = await insertMethodNode(
      seed.otherWorkspaceId,
      'Gini importance',
    )
    const foreignMethodBId = await insertMethodNode(
      seed.otherWorkspaceId,
      'Permutation importance',
    )
    const foreignDatasetId = await insertDatasetNode(
      seed.otherWorkspaceId,
      'breast-w',
    )

    const anchors = await ensureRunGraphAnchors(testDb.db, {
      workspaceId: seed.workspaceId,
      runASpec: runSpec(seed.claimNodeId, 'impurity'),
      runBSpec: runSpec(seed.claimNodeId, 'permutation'),
    })

    expect(anchors.workspaceId).toBe(seed.workspaceId)
    expect(anchors.method.runA).toMatchObject({
      title: 'Impurity importance',
      origin: 'spec',
    })
    expect(anchors.method.runB).toMatchObject({
      title: 'Permutation importance',
      origin: 'spec',
    })
    expect(anchors.dataset).toMatchObject({
      title: 'breast-w',
      origin: 'spec',
    })

    const anchorIds = [
      anchors.method.runA.nodeId,
      anchors.method.runB.nodeId,
      anchors.dataset.nodeId,
    ]
    expect(anchorIds).not.toContain(extractedMethodId)
    expect(anchorIds).not.toContain(foreignMethodAId)
    expect(anchorIds).not.toContain(foreignMethodBId)
    expect(anchorIds).not.toContain(foreignDatasetId)

    const rows = await testDb.db
      .select()
      .from(nodesTable)
      .where(inArray(nodesTable.id, anchorIds))
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.workspaceId).toBe(seed.workspaceId)
    }

    const runBNode = rows.find((row) => row.id === anchors.method.runB.nodeId)
    expect(runBNode?.data).toEqual({
      type: 'method',
      summary: 'Importance method selected by the frozen experiment spec.',
      library: null,
    })
    expect(runBNode?.sourceId).toBeNull()

    const datasetNode = rows.find((row) => row.id === anchors.dataset.nodeId)
    expect(datasetNode?.data).toEqual({
      type: 'dataset',
      name: 'breast-w',
      url: 'https://www.openml.org/data/download/52350/breast-w.arff',
      sha256: DATASET_SHA256,
      rows: null,
    })
    expect(datasetNode?.sourceId).toBeNull()
  })

  it('writes exactly the five planned accepted, run-evidenced edges', async () => {
    const anchors = await ensureRunGraphAnchors(testDb.db, {
      workspaceId: seed.workspaceId,
      runASpec: runSpec(seed.claimNodeId, 'impurity'),
      runBSpec: runSpec(seed.claimNodeId, 'permutation'),
    })
    const { runAId, runBId, runANodeId, runBNodeId } =
      await insertTerminalRunPair()

    const result = await writeRunGraphEdges(testDb.db, {
      workspaceId: seed.workspaceId,
      anchors,
      runs: {
        runA: { runId: runAId, runNodeId: runANodeId },
        runB: { runId: runBId, runNodeId: runBNodeId },
      },
    })

    expect(result.workspaceId).toBe(seed.workspaceId)
    expect(result.edges).toHaveLength(5)
    expect(
      result.edges.every(
        (edge) => edge.status === 'accepted' && edge.confidence === 1,
      ),
    ).toBe(true)

    const rows = await edgesInWorkspace()
    expect(rows).toHaveLength(5)
    expect(result.edges.map((edge) => edge.id).sort()).toEqual(
      rows.map((row) => row.id).sort(),
    )

    const expected = [
      {
        sourceNodeId: anchors.method.runA.nodeId,
        targetNodeId: runANodeId,
        relation: 'produced',
        evidenceRunId: runAId,
      },
      {
        sourceNodeId: anchors.method.runB.nodeId,
        targetNodeId: runBNodeId,
        relation: 'produced',
        evidenceRunId: runBId,
      },
      {
        sourceNodeId: anchors.dataset.nodeId,
        targetNodeId: runANodeId,
        relation: 'uses_dataset',
        evidenceRunId: runAId,
      },
      {
        sourceNodeId: anchors.dataset.nodeId,
        targetNodeId: runBNodeId,
        relation: 'uses_dataset',
        evidenceRunId: runBId,
      },
      {
        sourceNodeId: runANodeId,
        targetNodeId: runBNodeId,
        relation: 'derived_from',
        evidenceRunId: runBId,
      },
    ] as const

    const key = (edge: { sourceNodeId: string; targetNodeId: string; relation: string }) =>
      `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.relation}`
    expect(rows.map(key).sort()).toEqual(expected.map(key).sort())

    for (const planned of expected) {
      const row = rows.find((candidate) => key(candidate) === key(planned))
      expect(row).toBeDefined()
      expect(row?.status).toBe('accepted')
      expect(row?.confidence).toBe(1)
      expect(row?.evidenceRunId).toBe(planned.evidenceRunId)
      expect(row?.evidenceChunkId).toBeNull()
    }

    const endpointIds = [
      anchors.method.runA.nodeId,
      anchors.method.runB.nodeId,
      anchors.dataset.nodeId,
      runANodeId,
      runBNodeId,
    ]
    const endpointRows = await testDb.db
      .select()
      .from(nodesTable)
      .where(inArray(nodesTable.id, endpointIds))
    expect(endpointRows).toHaveLength(5)

    const byId = new Map(endpointRows.map((row) => [row.id, row]))
    expect(byId.get(anchors.method.runA.nodeId)?.type).toBe('method')
    expect(byId.get(anchors.method.runB.nodeId)?.type).toBe('method')
    expect(byId.get(anchors.dataset.nodeId)?.type).toBe('dataset')
    expect(byId.get(runANodeId)?.type).toBe('run')
    expect(byId.get(runBNodeId)?.type).toBe('run')
    expect(byId.get(runANodeId)?.data).toMatchObject({
      type: 'run',
      runId: runAId,
    })
    expect(byId.get(runBNodeId)?.data).toMatchObject({
      type: 'run',
      runId: runBId,
    })
  })

  it('refuses a non-terminal evidence run and writes no edges', async () => {
    const anchors = await ensureRunGraphAnchors(testDb.db, {
      workspaceId: seed.workspaceId,
      runASpec: runSpec(seed.claimNodeId, 'impurity'),
      runBSpec: runSpec(seed.claimNodeId, 'permutation'),
    })

    const specA = runSpec(seed.claimNodeId, 'impurity')
    const specB = runSpec(seed.claimNodeId, 'permutation')
    const experimentAId = await insertExperiment(seed.claimNodeId, specA)
    const experimentBId = await insertExperiment(seed.claimNodeId, specB)
    const runningRunId = await insertRun({
      experimentId: experimentAId,
      spec: specA,
      status: 'running',
    })
    const succeededRunId = await insertRun({
      experimentId: experimentBId,
      spec: specB,
    })
    const runningNodeId = await insertRunNode(runningRunId, 'running')
    const succeededNodeId = await insertRunNode(succeededRunId)

    const error = await expectRunEdgeError(
      writeRunGraphEdges(testDb.db, {
        workspaceId: seed.workspaceId,
        anchors,
        runs: {
          runA: { runId: runningRunId, runNodeId: runningNodeId },
          runB: { runId: succeededRunId, runNodeId: succeededNodeId },
        },
      }),
      'EDGE_EVIDENCE_RUN_INVALID',
    )
    expect(error.message).toContain('is running, not terminal')
    expect(await edgesInWorkspace()).toHaveLength(0)
  })

  it('refuses an anchor node from another workspace and writes no edges', async () => {
    const anchors = await ensureRunGraphAnchors(testDb.db, {
      workspaceId: seed.workspaceId,
      runASpec: runSpec(seed.claimNodeId, 'impurity'),
      runBSpec: runSpec(seed.claimNodeId, 'permutation'),
    })
    const { runAId, runBId, runANodeId, runBNodeId } =
      await insertTerminalRunPair()

    const foreignMethodId = await insertMethodNode(
      seed.otherWorkspaceId,
      'Impurity importance',
    )
    const foreignAnchors: RunGraphAnchors = {
      ...anchors,
      method: {
        ...anchors.method,
        runA: {
          nodeId: foreignMethodId,
          title: 'Impurity importance',
          origin: 'extracted',
        },
      },
    }

    const error = await expectRunEdgeError(
      writeRunGraphEdges(testDb.db, {
        workspaceId: seed.workspaceId,
        anchors: foreignAnchors,
        runs: {
          runA: { runId: runAId, runNodeId: runANodeId },
          runB: { runId: runBId, runNodeId: runBNodeId },
        },
      }),
      'EDGE_ENDPOINT_INVALID',
    )
    expect(error.message).toContain(
      `belongs to workspace ${seed.otherWorkspaceId}`,
    )
    expect(await edgesInWorkspace()).toHaveLength(0)
  })
})
