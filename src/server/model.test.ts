import { describe, expect, it } from 'vitest'
import { APICallError } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import { agentTasks } from '../db/schema'
import type { Database } from '../db/client'
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MODEL_ID,
  createCallModel,
  createDrizzleAgentTaskStore,
  createGeminiGenerator,
  isRateLimitError,
  type AgentTaskInsert,
  type AgentTaskStore,
  type CallModelContext,
  type GeminiGenerateText,
  type PersistedAgentTask,
  type StructuredGenerator,
} from './model'

// ---------------------------------------------------------------------------
// Fakes. No live key: every test drives an injected generator.
// ---------------------------------------------------------------------------

class MemoryTaskStore implements AgentTaskStore {
  readonly rows: PersistedAgentTask[] = []
  private nextId = 0

  async insert(task: AgentTaskInsert): Promise<{ id: string }> {
    const id = `task-${(this.nextId += 1)}`
    this.rows.push({ ...task, id })
    return { id }
  }
}

/**
 * A stand-in for the Drizzle client that captures what the real adapter would
 * send to the `agent_tasks` table. It proves the adapter uses #3's table object
 * and the `.values(...).returning({ id })` path without a database connection.
 */
function agentTaskDb(rows: AgentTaskInsert[]): Pick<Database, 'insert'> {
  const fake = {
    insert(table: typeof agentTasks) {
      expect(table).toBe(agentTasks)
      return {
        values(values: AgentTaskInsert) {
          rows.push(values)
          return {
            returning(fields: Record<string, unknown>) {
              expect(fields).toEqual({ id: agentTasks.id })
              return Promise.resolve([{ id: `agent-task-${rows.length}` }])
            },
          }
        },
      }
    },
  }
  return fake as unknown as Pick<Database, 'insert'>
}

function rateLimitError(): APICallError {
  return new APICallError({
    message: '429 Too Many Requests',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    requestBodyValues: {},
    statusCode: 429,
    responseHeaders: { 'retry-after': '1' },
    responseBody: '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}',
    isRetryable: true,
  })
}

/** Two `now()` reads per attempt, so every attempt records a 25 ms latency. */
function steppingClock(stepMs = 25): () => number {
  let current = 0
  return () => {
    const value = current
    current += stepMs
    return value
  }
}

const ClaimSchema = z.object({
  claims: z.array(z.string()),
})

function context(store: AgentTaskStore): CallModelContext {
  return {
    workspaceId: 'workspace-1',
    taskKind: 'extract_claims',
    store,
  }
}

// ---------------------------------------------------------------------------
// The issue's done criterion: a forced 429 is retried, and both attempts are
// task rows with latency and token columns.
// ---------------------------------------------------------------------------

describe('callModel task accounting', () => {
  it('retries a 429 and records one real agent_tasks row per attempt', async () => {
    const inserted: AgentTaskInsert[] = []
    const store = createDrizzleAgentTaskStore(agentTaskDb(inserted))
    const sleeps: number[] = []
    let requests = 0

    const generate: StructuredGenerator = async () => {
      requests += 1
      if (requests === 1) throw rateLimitError()
      return {
        output: { claims: ['noise can outrank informative features'] },
        inputTokens: 120,
        outputTokens: 30,
      }
    }

    const call = createCallModel({
      generate,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      random: () => 0.5,
      now: steppingClock(),
    })

    const result = await call(ClaimSchema, 'extract the claims', {
      ...context(store),
      strategyId: 'strategy-1',
      inputRef: { sourceId: 'source-1' },
    })

    expect(requests).toBe(2)
    expect(inserted).toHaveLength(2)

    // The 429 attempt: its own row, its own latency, no invented token counts.
    expect(inserted[0]).toMatchObject({
      workspaceId: 'workspace-1',
      strategyId: 'strategy-1',
      taskKind: 'extract_claims',
      model: DEFAULT_MODEL_ID,
      status: 'retried',
      inputRef: { sourceId: 'source-1' },
      output: null,
      promptTokens: null,
      completionTokens: null,
      costUsd: null,
      latencyMs: 25,
    })
    expect(inserted[0]!.error).toContain('429')

    // The successful attempt: tokens, cost and latency on the same row.
    expect(inserted[1]).toMatchObject({
      status: 'succeeded',
      promptTokens: 120,
      completionTokens: 30,
      costUsd: '0.000111',
      latencyMs: 25,
      error: null,
    })
    expect(inserted[1]!.output).toEqual({
      claims: ['noise can outrank informative features'],
    })

    // Full jitter with random() = 0.5: 0.5 * 1000 for the first retry.
    expect(sleeps).toEqual([500])

    expect(result.output).toEqual({
      claims: ['noise can outrank informative features'],
    })
    expect(result.task.id).toBe('agent-task-2')
    expect(result.attempts.map((task) => task.id)).toEqual([
      'agent-task-1',
      'agent-task-2',
    ])
  })

  it('stops at the documented attempt ceiling and keeps every row', async () => {
    const store = new MemoryTaskStore()
    const sleeps: number[] = []
    const finalError = rateLimitError()

    const generate: StructuredGenerator = async () => {
      throw finalError
    }

    const call = createCallModel({
      generate,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      random: () => 0.5,
      now: steppingClock(),
    })

    await expect(
      call(ClaimSchema, 'extract the claims', context(store)),
    ).rejects.toBe(finalError)

    expect(store.rows).toHaveLength(DEFAULT_MAX_ATTEMPTS)
    expect(store.rows.map((row) => row.status)).toEqual([
      'retried',
      'retried',
      'failed',
    ])
    expect(store.rows.map((row) => row.latencyMs)).toEqual([25, 25, 25])
    expect(
      store.rows.every(
        (row) => row.promptTokens === null && row.completionTokens === null,
      ),
    ).toBe(true)

    // Exponential ceilings 1000, 2000 with full jitter at 0.5.
    expect(sleeps).toEqual([500, 1000])
  })

  it('does not retry a non-429 failure', async () => {
    const store = new MemoryTaskStore()
    const sleeps: number[] = []
    const failure = new Error('model exploded')

    const generate: StructuredGenerator = async () => {
      throw failure
    }

    const call = createCallModel({
      generate,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      random: () => 0.5,
      now: steppingClock(),
    })

    await expect(
      call(ClaimSchema, 'extract the claims', context(store)),
    ).rejects.toBe(failure)

    expect(store.rows).toHaveLength(1)
    expect(store.rows[0]).toMatchObject({
      status: 'failed',
      error: 'Error: model exploded',
      output: null,
      promptTokens: null,
      completionTokens: null,
    })
    expect(sleeps).toEqual([])
  })

  it('surfaces a store failure without a second insert for the same attempt', async () => {
    let inserts = 0
    const store: AgentTaskStore = {
      async insert() {
        inserts += 1
        throw new Error('database is down')
      },
    }

    const generate: StructuredGenerator = async () => ({
      output: { claims: ['claim'] },
      inputTokens: 1,
      outputTokens: 1,
    })

    const call = createCallModel({
      generate,
      sleep: async () => undefined,
      random: () => 0,
      now: steppingClock(),
    })

    await expect(
      call(ClaimSchema, 'extract the claims', context(store)),
    ).rejects.toThrow('database is down')

    expect(inserts).toBe(1)
  })

  it('records a failed row when the output violates the Zod schema', async () => {
    const store = new MemoryTaskStore()
    const rawOutput = { claims: 'not-an-array' }

    const generate: StructuredGenerator = async () => ({
      output: rawOutput,
      inputTokens: 10,
      outputTokens: 2,
    })

    const call = createCallModel({
      generate,
      sleep: async () => undefined,
      random: () => 0.5,
      now: steppingClock(),
    })

    await expect(
      call(ClaimSchema, 'extract the claims', context(store)),
    ).rejects.toBeInstanceOf(z.ZodError)

    expect(store.rows).toHaveLength(1)
    expect(store.rows[0]).toMatchObject({
      status: 'failed',
      output: rawOutput,
      promptTokens: 10,
      completionTokens: 2,
      latencyMs: 25,
    })
    expect(store.rows[0]!.error).toContain('ZodError')
  })

  it('records cost from the configured price table, or null when prices are off', async () => {
    const generated: StructuredGenerator = async () => ({
      output: { claims: ['claim'] },
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })

    const pricedStore = new MemoryTaskStore()
    const priced = createCallModel({
      generate: generated,
      sleep: async () => undefined,
      random: () => 0,
      now: steppingClock(),
    })
    await priced(ClaimSchema, 'p', context(pricedStore))
    expect(pricedStore.rows[0]!.costUsd).toBe('2.800000')

    const unpricedStore = new MemoryTaskStore()
    const unpriced = createCallModel({
      generate: generated,
      sleep: async () => undefined,
      random: () => 0,
      now: steppingClock(),
    })
    await unpriced(ClaimSchema, 'p', {
      ...context(unpricedStore),
      pricing: null,
    })
    expect(unpricedStore.rows[0]!.costUsd).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Sequential discipline and queue recovery
// ---------------------------------------------------------------------------

describe('callModel sequencing', () => {
  it('never runs two physical requests at once', async () => {
    const store = new MemoryTaskStore()
    let active = 0
    let maxActive = 0

    const generate: StructuredGenerator = async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active -= 1
      return {
        output: { claims: ['claim'] },
        inputTokens: 1,
        outputTokens: 1,
      }
    }

    const call = createCallModel({
      generate,
      sleep: async () => undefined,
      random: () => 0,
      now: Date.now,
    })

    await Promise.all([
      call(ClaimSchema, 'first', context(store)),
      call(ClaimSchema, 'second', context(store)),
      call(ClaimSchema, 'third', context(store)),
    ])

    expect(maxActive).toBe(1)
    expect(store.rows).toHaveLength(3)
  })

  it('lets the next call run after a failed call', async () => {
    const store = new MemoryTaskStore()
    let requests = 0

    const generate: StructuredGenerator = async () => {
      requests += 1
      if (requests === 1) throw new Error('first call fails')
      return {
        output: { claims: ['claim'] },
        inputTokens: 1,
        outputTokens: 1,
      }
    }

    const call = createCallModel({
      generate,
      sleep: async () => undefined,
      random: () => 0,
      now: steppingClock(),
    })

    await expect(call(ClaimSchema, 'first', context(store))).rejects.toThrow(
      'first call fails',
    )
    const second = await call(ClaimSchema, 'second', context(store))

    expect(second.output).toEqual({ claims: ['claim'] })
    expect(store.rows.map((row) => row.status)).toEqual(['failed', 'succeeded'])
  })
})

// ---------------------------------------------------------------------------
// SDK boundary: the wrapper owns retries, the SDK owns none.
// ---------------------------------------------------------------------------

describe('createGeminiGenerator', () => {
  it('disables the SDK retry loop and forwards usage', async () => {
    const fakeModel = new MockLanguageModelV4()
    const calls: Array<Parameters<GeminiGenerateText>[0]> = []

    const fakeGenerateText: GeminiGenerateText = async (options) => {
      calls.push(options)
      return {
        output: { ok: true },
        usage: { inputTokens: 10, outputTokens: 5 },
      }
    }

    const generator = createGeminiGenerator({
      generateText: fakeGenerateText,
      resolveModel: () => fakeModel,
    })

    const result = await generator({
      modelId: DEFAULT_MODEL_ID,
      prompt: 'return an object',
      schema: z.object({ ok: z.boolean() }),
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.maxRetries).toBe(0)
    expect(calls[0]!.model).toBe(fakeModel)
    expect(calls[0]!.output).toBeDefined()
    expect(result).toEqual({
      output: { ok: true },
      inputTokens: 10,
      outputTokens: 5,
    })
  })
})

describe('isRateLimitError', () => {
  it('recognises a 429 and nothing else', () => {
    expect(isRateLimitError(rateLimitError())).toBe(true)
    expect(
      isRateLimitError(
        new APICallError({
          message: '500 Internal Server Error',
          url: 'https://example.test',
          requestBodyValues: {},
          statusCode: 500,
          isRetryable: true,
        }),
      ),
    ).toBe(false)
    expect(isRateLimitError({ statusCode: 429 })).toBe(true)
    expect(isRateLimitError(new Error('429 in a message'))).toBe(false)
  })
})
