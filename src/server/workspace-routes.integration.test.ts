/**
 * Read-path coverage for the workspace graph and strategy dashboard on
 * disposable Postgres. Authentication is stubbed at the route boundary.
 *
 * The production extractor runs twice against the same chunk set:
 *
 * - run 1 returns a claim whose quote is verbatim, so the task succeeds;
 * - run 2 returns a claim whose quote is not in the chunk, so the production
 *   validator rejects it and the task row becomes `rejected`.
 *
 * Both calls go through the real `callModel` wrapper with a deterministic
 * generator, and both write through `createDrizzleAgentTaskStore` into the
 * disposable database. No model network call, fixture metric or hand-written
 * task row is involved for the attributed runs. A single pre-attribution row
 * is inserted directly to prove the legacy bucket still appears.
 *
 * Skipped unless `TEST_DATABASE_URL` names a disposable server; see
 * `src/server/pipeline-delivery/test-support/pg.ts`.
 */
import { eq } from 'drizzle-orm'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { EvidencePanel } from '../components/panels/EvidencePanel.tsx'
import { StrategyDashboard } from '../components/panels/StrategyDashboard.tsx'
import type { WorkspaceEdge, WorkspaceNode } from '../data/demoWorkspace.ts'
import { agentTasks, edges, nodes, runs, sourceChunks, sources } from '../db/schema.ts'
import { Route as GraphRoute } from '../routes/api/graph.ts'
import { Route as StrategiesRoute } from '../routes/api/strategies.ts'
import { extractClaims } from './extract/claims.ts'
import type { ChunkRef } from './extract/types.ts'
import { ingestSourceToGraphForWorkspace } from './extract/pipeline.ts'
import {
  createCallModel,
  createDrizzleAgentTaskStore,
  type StructuredGenerator,
} from './model.ts'
import {
  createTestDatabase,
  seedWorkspace,
  type SeededWorkspace,
  type TestDatabase,
} from './pipeline-delivery/test-support/pg.ts'
import {
  aggregateAgentTasksByRun,
  summarizeAgentTaskRuns,
  type AgentTaskRow,
} from '../utils/strategyClient.ts'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip

const CHUNK_ID = '11111111-1111-4111-8111-111111111111'
const VERBATIM_QUOTE =
  'Random forests are an ensemble learning method using tree predictors.'
const ABSENT_QUOTE = 'This sentence is absent from the provided passage.'

const CHUNKS: ChunkRef[] = [
  {
    id: CHUNK_ID,
    ordinal: 0,
    page: 1,
    text: `${VERBATIM_QUOTE} Variable importance can be biased when predictors differ in scale.`,
  },
]

const routeState = vi.hoisted(() => ({ db: undefined as TestDatabase['db'] | undefined }))
vi.mock('../db/client', () => ({ getDb: () => routeState.db }))
vi.mock('./auth/workspace.server', () => ({
  requireWorkspaceAccess: async (_request: Request, workspaceId: string) => ({ workspaceId }),
}))

function getHandler(route: unknown) {
  return (route as {
    options: { server: { handlers: { GET: (ctx: { request: Request }) => Promise<Response> } } }
  }).options.server.handlers.GET
}

function extractionOutput(quote: string): Record<string, unknown> {
  return {
    claims: [
      {
        text: 'Random forests combine tree predictors.',
        quote,
        chunkId: CHUNK_ID,
      },
    ],
    datasets: [],
    methods: [],
    codeUrls: [],
  }
}

function generatorReturning(quote: string): StructuredGenerator {
  return async () => ({
    output: extractionOutput(quote),
    inputTokens: 120,
    outputTokens: 80,
  })
}

describeIntegration('workspace data routes on Postgres', () => {
  let testDb: TestDatabase
  let seed: SeededWorkspace
  let taskStore: ReturnType<typeof createDrizzleAgentTaskStore>

  beforeAll(async () => {
    testDb = await createTestDatabase(TEST_DATABASE_URL as string)
    routeState.db = testDb.db
    seed = await seedWorkspace(testDb.pool)
    taskStore = createDrizzleAgentTaskStore(testDb.db)
  })

  afterAll(async () => {
    await testDb?.close()
  })

  async function runExtraction(
    runId: string,
    runLabel: string,
    quote: string,
  ): Promise<void> {
    const call = createCallModel({ generate: generatorReturning(quote) })
    await extractClaims({
      workspaceId: seed.workspaceId,
      sourceId: 'source-fixture',
      chunks: CHUNKS,
      strategy: 'single_pass',
      runId,
      runLabel,
      callModelFn: call,
      taskStore,
      updateTaskStatusFn: async (taskId, status, error) => {
        await testDb.db
          .update(agentTasks)
          .set({ status, error: error ?? null })
          .where(eq(agentTasks.id, taskId))
      },
    })
  }

  async function readTasks() {
    const response = await getHandler(StrategiesRoute)({
      request: new Request(`http://localhost/api/strategies?workspaceId=${seed.workspaceId}`),
    })
    expect(response.status).toBe(200)
    const payload = await response.json() as { tasks: AgentTaskRow[]; source: string }
    expect(payload.source).toBe('database')
    return payload.tasks
  }

  it('persists two distinct runs with a visible success/failure difference', async () => {
    await runExtraction(
      'extract:strobl-2007:single_pass',
      'Strobl 2007 · single_pass',
      VERBATIM_QUOTE,
    )
    await runExtraction(
      'extract:kursa-2010:single_pass',
      'Kursa 2010 · single_pass',
      ABSENT_QUOTE,
    )

    // A row recorded before attribution existed must stay visible as legacy.
    await testDb.db.insert(agentTasks).values({
      workspaceId: seed.workspaceId,
      strategyId: null,
      taskKind: 'extract_claims',
      model: 'gemini-3.8-flash',
      status: 'succeeded',
      inputRef: {},
      output: null,
      error: null,
      promptTokens: null,
      completionTokens: null,
      costUsd: '0.000100',
      latencyMs: 25,
    })

    const tasks = await readTasks()
    expect(tasks).toHaveLength(3)
    // The extractor's recorded strategy name is the display strategy; no
    // agent_strategies row or UUID join is required.
    expect(tasks.filter((task) => task.runId !== null).map((task) => task.strategyId)).toEqual([
      'single_pass',
      'single_pass',
    ])

    const summaries = summarizeAgentTaskRuns(tasks)
    expect(summaries.map((run) => run.runId)).toEqual([
      'extract:kursa-2010:single_pass',
      'extract:strobl-2007:single_pass',
      null,
    ])

    const failed = summaries[0]!
    const succeeded = summaries[1]!
    const legacy = summaries[2]!

    expect(failed.label).toBe('Kursa 2010 · single_pass')
    expect(failed.attempts).toBe(1)
    expect(failed.successes).toBe(0)
    expect(failed.failures).toBe(1)
    expect(failed.successRate).toBe(0)

    expect(succeeded.label).toBe('Strobl 2007 · single_pass')
    expect(succeeded.attempts).toBe(1)
    expect(succeeded.successes).toBe(1)
    expect(succeeded.failures).toBe(0)
    expect(succeeded.successRate).toBe(100)
    expect(succeeded.avgCostUsd).not.toBeNull()

    // The two actual extraction attempts differ on the row-level comparison.
    expect(failed.successRate).not.toBe(succeeded.successRate)
    expect(failed.failures).not.toBe(succeeded.failures)

    expect(legacy.label).toBe('Unattributed')
    expect(legacy.runId).toBeNull()
    expect(legacy.successes).toBe(1)

    const rows = aggregateAgentTasksByRun(tasks)
    const extractRows = rows.filter((row) => row.taskKind === 'extract_claims')
    expect(extractRows.map((row) => row.runId)).toEqual([
      'extract:kursa-2010:single_pass',
      'extract:strobl-2007:single_pass',
      null,
    ])
    expect(extractRows.map((row) => row.failures)).toEqual([1, 0, 0])

    const markup = renderToStaticMarkup(createElement(StrategyDashboard, { tasks, source: 'api' }))
    const tableRows = markup.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) ?? []
    expect(tableRows.find((row) => row.includes('Kursa 2010 · single_pass'))).toContain('>0%</td>')
    expect(tableRows.find((row) => row.includes('Strobl 2007 · single_pass'))).toContain('>100%</td>')
  })

  it('leaves UI ingestion task rows unattributed instead of inventing a run id', async () => {
    await ingestSourceToGraphForWorkspace({
      db: testDb.db,
      workspaceId: seed.workspaceId,
      source: {
        kind: 'web',
        url: 'https://github.com/imbs-hl/ranger',
        title: 'ranger project page',
        firecrawlDeps: {
          scraper: async (url) => ({
            url,
            title: 'imbs-hl/ranger',
            markdown: VERBATIM_QUOTE,
            description: null,
            statusCode: 200,
            metadata: { statusCode: 200 },
          }),
        },
      },
      // Mirrors the route: a label but no run id, because this request has no
      // `runs` row to point at.
      runLabel: 'ui:repo',
      embedChunksFn: (async (items: unknown[]) =>
        items.map(() => new Array(768).fill(0.05))) as never,
      embedQueryFn: (async () => new Array(768).fill(0.05)) as never,
      searchSimilarChunksFn: (async () => []) as never,
      callModelFn: createCallModel({
        generate: async ({ prompt }) => ({
          // PROPOSE_EDGES runs after the rejected claim because the seeded
          // workspace already has nodes; it may propose nothing.
          output: prompt.includes('WORKSPACE NODES:')
            ? { edges: [] }
            : extractionOutput(ABSENT_QUOTE),
          inputTokens: 120,
          outputTokens: 80,
        }),
      }),
      taskStore,
    })

    const rows = await testDb.db
      .select({ inputRef: agentTasks.inputRef })
      .from(agentTasks)
      .where(eq(agentTasks.workspaceId, seed.workspaceId))
    const uiRows = rows.filter(
      (row) => (row.inputRef as Record<string, unknown>).extractionRunLabel === 'ui:repo',
    )

    expect(uiRows.length).toBeGreaterThan(0)
    for (const row of uiRows) {
      expect(row.inputRef).not.toHaveProperty('extractionRunId')
    }
    expect(uiRows[0]?.inputRef).toMatchObject({
      extractionRunLabel: 'ui:repo',
    })
  })

  it('renders the cited paper and exact run from persisted graph evidence', async () => {
    const [source] = await testDb.db.insert(sources).values({
      workspaceId: seed.workspaceId,
      kind: 'paper',
      title: 'Cited paper',
      sha256: '0'.repeat(64),
      bytes: VERBATIM_QUOTE.length,
    }).returning({ id: sources.id })
    const [chunk] = await testDb.db.insert(sourceChunks).values({
      sourceId: source!.id,
      ordinal: 0,
      text: VERBATIM_QUOTE,
      page: 4,
      charStart: 0,
      charEnd: VERBATIM_QUOTE.length,
    }).returning({ id: sourceChunks.id })
    const [run] = await testDb.db.insert(runs).values({
      experimentId: seed.experimentId,
      spec: seed.spec,
      attempt: 2,
      status: 'succeeded',
      parameters: {},
      environment: {
        imageDigest: 'test', python: '3', packages: {}, datasets: [], seeds: [], startedAt: '2026-01-01',
      },
    }).returning({ id: runs.id })
    const [endpoint] = await testDb.db.insert(nodes).values({
      workspaceId: seed.workspaceId,
      type: 'note',
      title: 'Graph endpoint',
      data: { type: 'note', body: 'Graph endpoint' },
    }).returning({ id: nodes.id })
    const baseEdge = {
      workspaceId: seed.workspaceId,
      sourceNodeId: endpoint!.id,
      targetNodeId: seed.claimNodeId,
      relation: 'supports',
      status: 'accepted',
    } as const
    await testDb.db.insert(edges).values([
      { ...baseEdge, evidenceChunkId: chunk!.id },
      { ...baseEdge, evidenceRunId: run!.id },
    ])

    const response = await getHandler(GraphRoute)({
      request: new Request(`http://localhost/api/graph?workspaceId=${seed.workspaceId}`),
    })
    expect(response.status).toBe(200)
    const graph = await response.json() as { edges: WorkspaceEdge[]; nodes: WorkspaceNode[] }
    const citation = graph.edges.find((edge) => edge.evidenceChunkId === chunk!.id)
    const runEvidence = graph.edges.find((edge) => edge.evidenceRunId === run!.id)
    expect(citation).toMatchObject({ evidenceSourceTitle: 'Cited paper', quote: VERBATIM_QUOTE, page: 4 })
    expect(runEvidence).toMatchObject({ evidenceRun: { id: run!.id, attempt: 2, status: 'succeeded' } })

    const renderEvidence = (edge: WorkspaceEdge) => renderToStaticMarkup(createElement(EvidencePanel, {
      edge, allNodes: graph.nodes, allEdges: graph.edges,
    }))
    const citationMarkup = renderEvidence(citation!)
    expect(citationMarkup).toContain('Cited paper')
    expect(citationMarkup).toContain(VERBATIM_QUOTE)
    expect(citationMarkup).toContain('PAGE 4')
    const runMarkup = renderEvidence(runEvidence!)
    expect(runMarkup).toContain('Run-Evidenced Relation')
    expect(runMarkup).toContain(run!.id)
  })
})
