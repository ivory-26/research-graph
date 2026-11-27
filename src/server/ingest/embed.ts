import { embed, embedMany, type EmbeddingModel } from 'ai'
import { createGoogleGenerativeAI, google } from '@ai-sdk/google'
import type { Chunk, EmbedOptions } from './types'
import {
  agentTaskStore,
  enqueueProcessTask,
  isRetryableProviderError,
} from '../model'
import { abortableSleep } from '../pipeline-transport'

/** The pinned embedding model (CLAUDE.md & Issue #11). */
export const DEFAULT_EMBEDDING_MODEL_ID = 'gemini-embedding-2'

/**
 * 768 dimensions as constrained by CLAUDE.md and the source_chunks schema.
 */
export const DEFAULT_EMBEDDING_DIMENSIONS = 768

/**
 * Batch size ceiling per API call as specified in Issue #11:
 * "gemini-embedding-2 at 768 dimensions, one call per batch of 20 chunks"
 */
export const DEFAULT_BATCH_SIZE = 20

/** Named constant for embedding list price: $0.15 per 1M tokens (Issue #11 & ADR 0009). */
export const DEFAULT_EMBEDDING_PRICE_PER_MILLION = 0.15

export const DEFAULT_MAX_EMBED_ATTEMPTS = 3
export const DEFAULT_BASE_DELAY_MS = 1_000
export const DEFAULT_MAX_DELAY_MS = 30_000

function backoffDelayMs(retryIndex: number): number {
  const ceiling = Math.min(DEFAULT_MAX_DELAY_MS, DEFAULT_BASE_DELAY_MS * 2 ** (retryIndex - 1))
  const jitter = Math.max(0, Math.min(1, Math.random()))
  return Math.floor(jitter * ceiling)
}

/**
 * Gemini's 429 body often says "Please retry in 13.2s"; respecting that
 * window matters on the free tier, where the jittered 1-2 s backoff expires
 * well before the quota window reopens. Use the provider's guidance when it
 * is present, otherwise the normal jittered delay.
 */
function providerRetryDelayMs(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null) {
    const headers = (error as { responseHeaders?: Record<string, string> })
      .responseHeaders
    const raw = headers?.['retry-after'] ?? headers?.['Retry-After']
    if (raw !== undefined) {
      const seconds = Number(raw)
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.ceil(seconds * 1000)
      }
    }
  }

  const message = error instanceof Error ? error.message : String(error)
  const match = /retry in ([\d.]+)\s*s/i.exec(message)
  if (match) {
    const seconds = Number(match[1])
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.ceil(seconds * 1000)
    }
  }
  return undefined
}

/**
 * Honour the provider's window, but never beyond the existing max-delay bound:
 * a quota message asking for minutes must not outlast the caller's stream
 * budget. The sleep itself is abortable, so a cancelled pipeline stops here.
 */
function retryDelayMs(retryIndex: number, error: unknown): number {
  return Math.min(
    DEFAULT_MAX_DELAY_MS,
    Math.max(backoffDelayMs(retryIndex), providerRetryDelayMs(error) ?? 0),
  )
}

/**
 * Resolves finite token usage and cost for an embedding request.
 * AI SDK 7's embed/embedMany can return `{ tokens: NaN }` when the provider omits usage metadata.
 */
function resolveEmbeddingUsage(
  usage: { tokens?: number; inputTokens?: number } | undefined,
  charCount: number,
): { promptTokens: number; costUsd: string } {
  // Heuristic uses ceil as a conservative upper bound when usage metadata is missing;
  // provider-reported counts use round solely as a defensive integer cast for Postgres.
  const estimatedTokens = Math.ceil(charCount / 4)
  const rawTokens = usage?.tokens
  const rawInputTokens = usage?.inputTokens
  const promptTokens =
    typeof rawTokens === 'number' && Number.isFinite(rawTokens)
      ? Math.round(rawTokens)
      : typeof rawInputTokens === 'number' && Number.isFinite(rawInputTokens)
        ? Math.round(rawInputTokens)
        : estimatedTokens
  const costUsd = ((promptTokens * DEFAULT_EMBEDDING_PRICE_PER_MILLION) / 1_000_000).toFixed(6)
  return { promptTokens, costUsd }
}

// Shared process-wide sequential queue for all model calls (ADR 0009: sequential rate-limited execution)
const enqueue = enqueueProcessTask

const modelCache = new Map<string, EmbeddingModel>()

/**
 * Resolves the Google Generative AI embedding model with caching and explicit 768 dimensions.
 */
export function resolveEmbeddingModel(
  modelId: string = DEFAULT_EMBEDDING_MODEL_ID,
): EmbeddingModel {
  const cached = modelCache.get(modelId)
  if (cached) return cached

  // Support both GOOGLE_GENERATIVE_AI_API_KEY and GEMINI_API_KEY env vars
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY
  let model: EmbeddingModel

  if (apiKey && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const customGoogle = createGoogleGenerativeAI({ apiKey })
    model = customGoogle.textEmbeddingModel(modelId)
  } else {
    model = google.textEmbeddingModel(modelId)
  }

  modelCache.set(modelId, model)
  return model
}

/**
 * Injected dependencies for embedding functions, enabling unit testing without network calls.
 */
export interface EmbedDeps {
  embedManyFn?: typeof embedMany
  embedFn?: typeof embed
  resolveModel?: typeof resolveEmbeddingModel
  sleepFn?: (ms: number) => Promise<void>
}

/**
 * Embeds an array of texts in batches of at most 20 chunks using gemini-embedding-2.
 *
 * Implements Issue #11 rules & ADR 0009 invariants:
 * - gemini-embedding-2 at 768 dimensions passed to provider via outputDimensionality
 * - One call per batch of at most 20 chunks
 * - Sequential queue to prevent parallel burst rate-limiting across concurrent ingests
 * - maxRetries: 0 with manual 429/503 backoff recording 'retried' rows for intermediate attempts
 * - Estimated tokens recorded when provider returns undefined usage
 * - Vector dimension validated BEFORE recording success in agent_tasks
 * - Accounting failures surface rather than being swallowed
 */
export async function embedChunks(
  items: (string | Chunk | { text: string })[],
  options: EmbedOptions = {},
  deps: EmbedDeps = {},
): Promise<number[][]> {
  if (items.length === 0) {
    return []
  }

  const batchSize = Math.max(1, Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, DEFAULT_BATCH_SIZE))
  const dimensions = options.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS
  const resolveModelFn = deps.resolveModel ?? resolveEmbeddingModel
  const model = options.model ?? resolveModelFn(DEFAULT_EMBEDDING_MODEL_ID)
  const embedManyCall = deps.embedManyFn ?? embedMany
  const taskStore = options.taskStore ?? agentTaskStore
  const taskKind = options.taskKind ?? 'ingest'
  const sleepCall =
    deps.sleepFn ??
    ((ms: number) => abortableSleep(ms, options.abortSignal))

  const texts: string[] = items.map((item) => (typeof item === 'string' ? item : item.text))
  const allEmbeddings: number[][] = []

  // Process sequentially in batches of at most 20
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)
    let attempt = 0
    let result: any = null
    let successfulLatencyMs = 0
    const maxAttempts = DEFAULT_MAX_EMBED_ATTEMPTS

    while (attempt < maxAttempts) {
      attempt++
      const startedAt = Date.now()

      try {
        result = await enqueue(() =>
          embedManyCall({
            model,
            values: batch,
            abortSignal: options.abortSignal,
            maxRetries: 0, // ADR 0009: disable AI SDK retries to preserve 1-row-per-attempt invariant
            providerOptions: {
              google: {
                outputDimensionality: dimensions,
              },
            },
          } as any),
        )
        // Attempt succeeded
        successfulLatencyMs = Math.max(0, Date.now() - startedAt)
        break
      } catch (err) {
        const latencyMs = Math.max(0, Date.now() - startedAt)
        const retryable = isRetryableProviderError(err)

        if (retryable && attempt < maxAttempts) {
          if (options.workspaceId) {
            await taskStore.insert({
              workspaceId: options.workspaceId,
              strategyId: options.strategyId ?? null,
              taskKind,
              model: DEFAULT_EMBEDDING_MODEL_ID,
              status: 'retried',
              inputRef: { batchIndex: i / batchSize, itemCount: batch.length },
              output: null,
              error: err instanceof Error ? err.message : String(err),
              promptTokens: null,
              completionTokens: null,
              costUsd: null,
              latencyMs,
            })
          }
          const delay = retryDelayMs(attempt, err)
          await sleepCall(delay)
          continue
        }

        // Exhausted retries or a non-retryable error
        if (options.workspaceId) {
          await taskStore.insert({
            workspaceId: options.workspaceId,
            strategyId: options.strategyId ?? null,
            taskKind,
            model: DEFAULT_EMBEDDING_MODEL_ID,
            status: 'failed',
            inputRef: { batchIndex: i / batchSize, itemCount: batch.length },
            output: null,
            error: err instanceof Error ? err.message : String(err),
            promptTokens: null,
            completionTokens: null,
            costUsd: null,
            latencyMs,
          })
        }
        throw err
      }
    }

    const latencyMs = successfulLatencyMs // Latency of successful final attempt
    const { promptTokens, costUsd } = resolveEmbeddingUsage(
      result.usage,
      batch.reduce((sum, s) => sum + s.length, 0),
    )

    // Validate embeddings count and dimensions BEFORE inserting success row
    if (result.embeddings.length !== batch.length) {
      if (options.workspaceId) {
        await taskStore.insert({
          workspaceId: options.workspaceId,
          strategyId: options.strategyId ?? null,
          taskKind,
          model: DEFAULT_EMBEDDING_MODEL_ID,
          status: 'failed',
          inputRef: { batchIndex: i / batchSize, itemCount: batch.length },
          output: null,
          error: `Embedding batch returned ${result.embeddings.length} vectors, expected ${batch.length}.`,
          promptTokens,
          completionTokens: 0,
          costUsd,
          latencyMs,
        })
      }
      throw new Error(
        `Embedding batch returned ${result.embeddings.length} vectors, expected ${batch.length}.`,
      )
    }

    for (const vec of result.embeddings) {
      if (vec.length !== dimensions) {
        if (options.workspaceId) {
          await taskStore.insert({
            workspaceId: options.workspaceId,
            strategyId: options.strategyId ?? null,
            taskKind,
            model: DEFAULT_EMBEDDING_MODEL_ID,
            status: 'failed',
            inputRef: { batchIndex: i / batchSize, itemCount: batch.length },
            output: null,
            error: `Embedding returned ${vec.length} dimensions, expected ${dimensions}.`,
            promptTokens,
            completionTokens: 0,
            costUsd,
            latencyMs,
          })
        }
        throw new Error(
          `Embedding returned ${vec.length} dimensions, expected ${dimensions}.`,
        )
      }
      allEmbeddings.push(vec)
    }

    // Record success only after vectors pass dimension validation
    if (options.workspaceId) {
      await taskStore.insert({
        workspaceId: options.workspaceId,
        strategyId: options.strategyId ?? null,
        taskKind,
        model: DEFAULT_EMBEDDING_MODEL_ID,
        status: 'succeeded',
        inputRef: { batchIndex: i / batchSize, itemCount: batch.length },
        output: { embeddingCount: result.embeddings.length, dimensions },
        error: null,
        promptTokens,
        completionTokens: 0,
        costUsd,
        latencyMs,
      })
    }
  }

  return allEmbeddings
}

/**
 * Embeds a single query string for semantic cosine search over chunks.
 */
export async function embedQuery(
  query: string,
  options: EmbedOptions = {},
  deps: EmbedDeps = {},
): Promise<number[]> {
  const trimmed = query.trim()
  if (!trimmed) {
    throw new Error('Query string cannot be empty.')
  }

  const dimensions = options.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS
  const resolveModelFn = deps.resolveModel ?? resolveEmbeddingModel
  const model = options.model ?? resolveModelFn(DEFAULT_EMBEDDING_MODEL_ID)
  const embedCall = deps.embedFn ?? embed
  const taskStore = options.taskStore ?? agentTaskStore
  const taskKind = options.taskKind ?? 'ingest'
  const sleepCall =
    deps.sleepFn ??
    ((ms: number) => abortableSleep(ms, options.abortSignal))

  let attempt = 0
  let result: any = null
  let successfulLatencyMs = 0
  const maxAttempts = DEFAULT_MAX_EMBED_ATTEMPTS

  while (attempt < maxAttempts) {
    attempt++
    const startedAt = Date.now()

    try {
      result = await enqueue(() =>
        embedCall({
          model,
          value: trimmed,
          abortSignal: options.abortSignal,
          maxRetries: 0, // ADR 0009: disable AI SDK retries to preserve 1-row-per-attempt invariant
          providerOptions: {
            google: {
              outputDimensionality: dimensions,
            },
          },
        } as any),
      )
      // Success
      successfulLatencyMs = Math.max(0, Date.now() - startedAt)
      break
    } catch (err) {
      const latencyMs = Math.max(0, Date.now() - startedAt)
      const retryable = isRetryableProviderError(err)

      if (retryable && attempt < maxAttempts) {
        if (options.workspaceId) {
          await taskStore.insert({
            workspaceId: options.workspaceId,
            strategyId: options.strategyId ?? null,
            taskKind,
            model: DEFAULT_EMBEDDING_MODEL_ID,
            status: 'retried',
            inputRef: { query: trimmed },
            output: null,
            error: err instanceof Error ? err.message : String(err),
            promptTokens: null,
            completionTokens: null,
            costUsd: null,
            latencyMs,
          })
        }
        const delay = retryDelayMs(attempt, err)
        await sleepCall(delay)
        continue
      }

      if (options.workspaceId) {
        await taskStore.insert({
          workspaceId: options.workspaceId,
          strategyId: options.strategyId ?? null,
          taskKind,
          model: DEFAULT_EMBEDDING_MODEL_ID,
          status: 'failed',
          inputRef: { query: trimmed },
          output: null,
          error: err instanceof Error ? err.message : String(err),
          promptTokens: null,
          completionTokens: null,
          costUsd: null,
          latencyMs,
        })
      }
      throw err
    }
  }

  const latencyMs = successfulLatencyMs
  const { promptTokens, costUsd } = resolveEmbeddingUsage(result.usage, trimmed.length)

  // Validate dimensions BEFORE inserting success row
  if (result.embedding.length !== dimensions) {
    if (options.workspaceId) {
      await taskStore.insert({
        workspaceId: options.workspaceId,
        strategyId: options.strategyId ?? null,
        taskKind,
        model: DEFAULT_EMBEDDING_MODEL_ID,
        status: 'failed',
        inputRef: { query: trimmed },
        output: null,
        error: `Query embedding returned ${result.embedding.length} dimensions, expected ${dimensions}.`,
        promptTokens,
        completionTokens: 0,
        costUsd,
        latencyMs,
      })
    }
    throw new Error(
      `Query embedding returned ${result.embedding.length} dimensions, expected ${dimensions}.`,
    )
  }

  if (options.workspaceId) {
    await taskStore.insert({
      workspaceId: options.workspaceId,
      strategyId: options.strategyId ?? null,
      taskKind,
      model: DEFAULT_EMBEDDING_MODEL_ID,
      status: 'succeeded',
      inputRef: { query: trimmed },
      output: { dimensions },
      error: null,
      promptTokens,
      completionTokens: 0,
      costUsd,
      latencyMs,
    })
  }

  return result.embedding
}

/**
 * Production wrapper enforcing mandatory workspace accounting for batch embeddings.
 */
export async function embedChunksForWorkspace(
  workspaceId: string,
  items: (string | Chunk | { text: string })[],
  options?: Omit<EmbedOptions, 'workspaceId'>,
  deps?: EmbedDeps,
): Promise<number[][]> {
  return embedChunks(items, { ...options, workspaceId }, deps)
}

/**
 * Production wrapper enforcing mandatory workspace accounting for query embeddings.
 */
export async function embedQueryForWorkspace(
  workspaceId: string,
  query: string,
  options?: Omit<EmbedOptions, 'workspaceId'>,
  deps?: EmbedDeps,
): Promise<number[]> {
  return embedQuery(query, { ...options, workspaceId }, deps)
}
