import { describe, expect, it, vi } from 'vitest'
import { APICallError } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import { agentTasks } from '../db/schema'
import type { Database } from '../db/client'
import { ExtractionResultSchema, ProposeEdgesResultSchema } from './extract/types'
import { RetrievalAnswerSchema } from './retrieval'
import {
  AgentTaskPersistenceError,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_META_CHAT_COMPLETIONS_URL,
  DEFAULT_META_MODEL_ID,
  DEFAULT_MODEL_ID,
  DEFAULT_PRICING,
  MetaApiError,
  createCallModel,
  createDrizzleAgentTaskStore,
  createGeminiGenerator,
  createMetaGenerator,
  isRetryableProviderError,
  resolveConfiguredDefaultModelId,
  resolveGeminiApiKey,
  resolveMetaApiKey,
  toMetaStrictJsonSchema,
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

function providerError(statusCode: 429 | 503): APICallError {
  return new APICallError({
    message:
      statusCode === 429
        ? '429 Too Many Requests'
        : '503 Service Unavailable: high demand',
    url: `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL_ID}:generateContent`,
    requestBodyValues: {},
    statusCode,
    responseHeaders: statusCode === 429 ? { 'retry-after': '1' } : {},
    responseBody:
      statusCode === 429
        ? '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'
        : '{"error":{"code":503,"status":"UNAVAILABLE"}}',
    isRetryable: true,
  })
}

function rateLimitError(): APICallError {
  return providerError(429)
}

function capacityError(): APICallError {
  return providerError(503)
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
  it.each([
    ['429 rate limit', 429],
    ['503 provider capacity', 503],
  ] as const)(
    'retries a %s and records one real agent_tasks row per attempt',
    async (_label, status) => {
    const inserted: AgentTaskInsert[] = []
    const store = createDrizzleAgentTaskStore(agentTaskDb(inserted))
    const sleeps: number[] = []
    let requests = 0

    const generate: StructuredGenerator = async () => {
      requests += 1
      if (requests === 1) throw providerError(status)
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
    expect(inserted[0]!.error).toContain(String(status))

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
    },
  )

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

  it('does not retry a non-retryable failure', async () => {
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

    const failure = await call(ClaimSchema, 'extract the claims', context(store))
      .then(() => null, (error: unknown) => error)

    expect(failure).toBeInstanceOf(AgentTaskPersistenceError)
    expect((failure as AgentTaskPersistenceError).cause).toMatchObject({
      message: 'database is down',
    })

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

describe('isRetryableProviderError', () => {
  it('recognises 429 and 503 and nothing else', () => {
    expect(isRetryableProviderError(rateLimitError())).toBe(true)
    expect(isRetryableProviderError(capacityError())).toBe(true)
    expect(
      isRetryableProviderError(
        new APICallError({
          message: '500 Internal Server Error',
          url: 'https://example.test',
          requestBodyValues: {},
          statusCode: 500,
          isRetryable: true,
        }),
      ),
    ).toBe(false)
    expect(isRetryableProviderError({ statusCode: 429 })).toBe(true)
    expect(isRetryableProviderError({ statusCode: 503 })).toBe(true)
    expect(isRetryableProviderError(new MetaApiError(429, 'rate limited'))).toBe(true)
    expect(isRetryableProviderError(new MetaApiError(503, 'unavailable'))).toBe(true)
    expect(isRetryableProviderError(new Error('429 in a message'))).toBe(false)
  })
})

describe('resolveGeminiApiKey', () => {
  it('prefers the documented Google variable', () => {
    expect(
      resolveGeminiApiKey({
        GOOGLE_GENERATIVE_AI_API_KEY: 'google-key',
        GEMINI_API_KEY: 'alias-key',
      } as NodeJS.ProcessEnv),
    ).toBe('google-key')
  })

  it('accepts the GEMINI_API_KEY alias so a deploy does not embed and then fail text calls', () => {
    expect(
      resolveGeminiApiKey({ GEMINI_API_KEY: '  alias-key  ' } as NodeJS.ProcessEnv),
    ).toBe('alias-key')
  })

  it('returns null when neither variable is set', () => {
    expect(resolveGeminiApiKey({} as NodeJS.ProcessEnv)).toBeNull()
    expect(resolveGeminiApiKey({ GEMINI_API_KEY: '   ' } as NodeJS.ProcessEnv)).toBeNull()
  })
})

describe('Meta Model API support in callModel (muse-spark-1.3-contributor)', () => {
  it('resolveMetaApiKey and resolveConfiguredDefaultModelId only switch on explicit META_API_KEY', () => {
    expect(resolveMetaApiKey({} as NodeJS.ProcessEnv)).toBeNull()
    expect(resolveMetaApiKey({ META_API_KEY: '   ' } as NodeJS.ProcessEnv)).toBeNull()
    expect(resolveMetaApiKey({ MODEL_API_KEY: 'ignored-generic' } as NodeJS.ProcessEnv)).toBeNull()
    expect(resolveConfiguredDefaultModelId({} as NodeJS.ProcessEnv)).toBe(DEFAULT_MODEL_ID)
    expect(resolveConfiguredDefaultModelId({ MODEL_API_KEY: 'ignored-generic' } as NodeJS.ProcessEnv)).toBe(
      DEFAULT_MODEL_ID,
    )

    expect(resolveMetaApiKey({ META_API_KEY: '  stub-meta-key  ' } as NodeJS.ProcessEnv)).toBe(
      'stub-meta-key',
    )
    expect(
      resolveConfiguredDefaultModelId({ META_API_KEY: 'stub-meta-key' } as NodeJS.ProcessEnv),
    ).toBe(DEFAULT_META_MODEL_ID)
  })

  it('toMetaStrictJsonSchema builds strict JSON Schema objects without length/range keywords, including production schemas', () => {
    const TestSchema = z.object({
      title: z.string().max(120).describe('Concise title'),
      items: z
        .array(
          z.object({
            name: z.string().min(1).max(80),
            score: z.number().min(0).max(1).nullable(),
          }),
        )
        .max(12),
    })

    function assertStrictNodeTree(node: unknown): void {
      if (Array.isArray(node)) {
        node.forEach(assertStrictNodeTree)
        return
      }
      if (typeof node !== 'object' || node === null) return
      const obj = node as Record<string, unknown>
      expect(obj.$schema).toBeUndefined()
      expect(obj.$defs).toBeUndefined()
      expect(obj.$ref).toBeUndefined()
      if (obj.type === 'object' || (typeof obj.properties === 'object' && obj.properties !== null)) {
        expect(obj.additionalProperties).toBe(false)
        const propKeys = Object.keys((obj.properties as Record<string, unknown>) ?? {})
        expect(obj.required).toEqual(propKeys)
        for (const prop of Object.values((obj.properties as Record<string, unknown>) ?? {})) {
          assertStrictNodeTree(prop)
        }
      }
      if (obj.items !== undefined) assertStrictNodeTree(obj.items)
      if (obj.anyOf !== undefined) assertStrictNodeTree(obj.anyOf)
      if (obj.oneOf !== undefined) assertStrictNodeTree(obj.oneOf)
      if (obj.allOf !== undefined) assertStrictNodeTree(obj.allOf)
    }

    for (const prodSchema of [
      TestSchema,
      ExtractionResultSchema,
      ProposeEdgesResultSchema,
      RetrievalAnswerSchema,
    ]) {
      const strictSchema = toMetaStrictJsonSchema(prodSchema)
      expect(strictSchema.type).toBe('object')
      assertStrictNodeTree(strictSchema)

      const serialized = JSON.stringify(strictSchema)
      expect(serialized).not.toContain('"$schema"')
      expect(serialized).not.toContain('"$defs"')
      expect(serialized).not.toContain('"$ref"')
      expect(serialized).not.toContain('"minLength"')
      expect(serialized).not.toContain('"maxLength"')
      expect(serialized).not.toContain('"maxItems"')
      expect(serialized).not.toContain('"minimum"')
      expect(serialized).not.toContain('"maximum"')
    }
  })

  it('createMetaGenerator posts documented Meta payload, rejects non-contributor Meta models, and redacts the sent key', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const dummyToken = 'stub-bearer-token-value'

    const okFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedInit = init
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify({ claims: ['verified'] }) },
            },
          ],
          usage: { prompt_tokens: 150, completion_tokens: 60 },
        }),
        { status: 200 },
      )
    })

    const gen = createMetaGenerator({
      fetchImpl: okFetch as unknown as typeof fetch,
      getApiKey: () => dummyToken,
      maxCompletionTokens: 4096,
    })

    const out = await gen({
      modelId: DEFAULT_META_MODEL_ID,
      prompt: 'Extract claims',
      schema: ClaimSchema,
    })

    expect(capturedUrl).toBe(DEFAULT_META_CHAT_COMPLETIONS_URL)
    expect((capturedInit?.headers as Record<string, string>).Authorization).toBe(`Bearer ${dummyToken}`)
    const payload = JSON.parse(String(capturedInit?.body))
    expect(payload.model).toBe('muse-spark-1.3-contributor')
    expect(payload.max_completion_tokens).toBe(4096)
    expect(payload.response_format.type).toBe('json_schema')
    expect(payload.response_format.json_schema.strict).toBe(true)
    expect(out).toEqual({
      output: { claims: ['verified'] },
      inputTokens: 150,
      outputTokens: 60,
    })

    await expect(
      gen({ modelId: 'muse-spark-1.3', prompt: 'test', schema: ClaimSchema }),
    ).rejects.toThrow(/muse-spark-1\.3-contributor/)

    const failFetch = vi.fn(async () =>
      new Response(`Unauthorized for ${dummyToken} / Bearer header.payload.sig`, { status: 401 }),
    )
    const failGen = createMetaGenerator({
      fetchImpl: failFetch as unknown as typeof fetch,
      getApiKey: () => dummyToken,
    })

    try {
      await failGen({ modelId: DEFAULT_META_MODEL_ID, prompt: 'test', schema: ClaimSchema })
      expect.unreachable('expected 401 failure')
    } catch (err) {
      expect(err).toBeInstanceOf(MetaApiError)
      const msg = err instanceof Error ? err.message : String(err)
      expect(msg).not.toContain(dummyToken)
      expect(msg).not.toContain('header.payload.sig')
      expect(msg).toContain('[REDACTED]')
    }
  })

  it('routes explicit Meta vs Gemini models cleanly through the single callModel runtime and costs Meta contributor rates', async () => {
    const store = new MemoryTaskStore()
    const calls: string[] = []
    const sleeps: number[] = []
    let metaAttempts = 0

    const geminiStub: StructuredGenerator = async ({ modelId }) => {
      calls.push(`gemini:${modelId}`)
      return { output: { claims: ['from-gemini'] }, inputTokens: 100, outputTokens: 20 }
    }

    const metaStub: StructuredGenerator = async ({ modelId }) => {
      calls.push(`meta:${modelId}`)
      metaAttempts += 1
      if (metaAttempts === 1) {
        throw new MetaApiError(429, 'rate limit')
      }
      return {
        output: { claims: ['from-meta'] },
        inputTokens: 1_000_000,
        outputTokens: 500_000,
      }
    }

    const call = createCallModel({
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      random: () => 0.5,
      now: steppingClock(),
      baseDelayMs: 100,
      maxDelayMs: 500,
      resolveDefaultModelId: () => DEFAULT_META_MODEL_ID,
      resolveGenerator: (modelId) => {
        if (modelId === DEFAULT_META_MODEL_ID) return metaStub
        if (modelId.startsWith('muse-')) {
          throw new Error(`Meta Model API provider supports '${DEFAULT_META_MODEL_ID}' only`)
        }
        return geminiStub
      },
    })

    // 1. Evaluator-style explicit gemini-4-hydrogen stays on Gemini even when Meta is default
    const evalRes = await call(ClaimSchema, 'explain', {
      ...context(store),
      taskKind: 'explain_gap',
      modelId: 'gemini-4-hydrogen',
    })
    expect(evalRes.output).toEqual({ claims: ['from-gemini'] })

    // 2. Omitted modelId routes to muse-spark-1.3-contributor with 429 retry and published contributor rate
    const metaRes = await call(ClaimSchema, 'extract', context(store))
    expect(metaRes.output).toEqual({ claims: ['from-meta'] })
    expect(sleeps).toEqual([50])

    // 3. Disallowed muse-* variant fails fast without entering the attempt loop
    await expect(
      call(ClaimSchema, 'extract', { ...context(store), modelId: 'muse-spark-1.3' }),
    ).rejects.toThrow(/muse-spark-1\.3-contributor/)

    expect(calls).toEqual([
      'gemini:gemini-4-hydrogen',
      'meta:muse-spark-1.3-contributor',
      'meta:muse-spark-1.3-contributor',
    ])
    expect(store.rows.map((r) => [r.model, r.status, r.costUsd])).toEqual([
      ['gemini-4-hydrogen', 'succeeded', '0.000300'],
      ['muse-spark-1.3-contributor', 'retried', null],
      [
        'muse-spark-1.3-contributor',
        'succeeded',
        (
          DEFAULT_PRICING[DEFAULT_META_MODEL_ID]!.inputUsdPerMillionTokens +
          0.5 * DEFAULT_PRICING[DEFAULT_META_MODEL_ID]!.outputUsdPerMillionTokens
        ).toFixed(6),
      ],
    ])
  })
})
