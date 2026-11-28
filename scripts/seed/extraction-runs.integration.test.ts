/**
 * Real-Postgres proof that two extraction attempts are attributed to distinct
 * stable run ids and can be compared from the persisted `agent_tasks`.
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { agentTasks } from '../../src/db/schema.ts'
import { extractClaims } from '../../src/server/extract/claims.ts'
import type { ChunkRef } from '../../src/server/extract/types.ts'
import {
  createCallModel,
  createDrizzleAgentTaskStore,
  type StructuredGenerator,
} from '../../src/server/model.ts'
import {
  createTestDatabase,
  seedWorkspace,
  type SeededWorkspace,
  type TestDatabase,
} from '../../src/server/pipeline-delivery/test-support/pg.ts'
import { mapAgentTaskQueryRows } from '../../src/server/strategies.ts'
import {
  aggregateAgentTasksByRun,
  summarizeAgentTaskRuns,
} from '../../src/utils/strategyClient.ts'

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

describeIntegration('two extraction runs over real agent_tasks', () => {
  let testDb: TestDatabase
  let seed: SeededWorkspace
  let taskStore: ReturnType<typeof createDrizzleAgentTaskStore>

  beforeAll(async () => {
    testDb = await createTestDatabase(TEST_DATABASE_URL as string)
    seed = await seedWorkspace(testDb.pool)
    taskStore = createDrizzleAgentTaskStore(testDb.db)
  })

  afterAll(async () => {
    await testDb.close()
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
    const rows = await testDb.db
      .select({
        id: agentTasks.id,
        taskKind: agentTasks.taskKind,
        strategyId: agentTasks.strategyId,
        status: agentTasks.status,
        inputRef: agentTasks.inputRef,
        latencyMs: agentTasks.latencyMs,
        costUsd: agentTasks.costUsd,
        error: agentTasks.error,
      })
      .from(agentTasks)
      .where(eq(agentTasks.workspaceId, seed.workspaceId))

    return mapAgentTaskQueryRows(rows.map((row) => ({ ...row, strategyName: null })))
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
  })
})
