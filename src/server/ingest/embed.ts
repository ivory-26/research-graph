import { embed, embedMany, type EmbeddingModel } from 'ai'
import { createGoogleGenerativeAI, google } from '@ai-sdk/google'
import type { Chunk, EmbedOptions } from './types'
import { agentTaskStore, enqueueProcessTask, isRateLimitError } from '../model'

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function backoffDelayMs(retryIndex: number): number {
  const ceiling = Math.min(DEFAULT_MAX_DELAY_MS, DEFAULT_BASE_DELAY_MS * 2 ** (retryIndex - 1))
  const jitter = Math.max(0, Math.min(1, Math.random()))
  return Math.floor(jitter * ceiling)
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
 * - maxRetries: 0 with manual 429 backoff recording 'retried' rows for intermediate attempts
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
  const sleepCall = deps.sleepFn ?? sleep

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
        const is429 = isRateLimitError(err)

        if (is429 && attempt < maxAttempts) {
          if (options.workspaceId) {
            await taskStore.insert({
              workspaceId: options.workspaceId,
              strategyId: options.strategyId ?? null,
              taskKind: 'ingest',
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
          const delay = backoffDelayMs(attempt)
          await sleepCall(delay)
          continue
        }

        // Exhausted retries or non-429 error
        if (options.workspaceId) {
          await taskStore.insert({
            workspaceId: options.workspaceId,
            strategyId: options.strategyId ?? null,
            taskKind: 'ingest',
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
    // Estimate tokens from text length since Google doEmbed returns usage: undefined
    const estimatedTokens = Math.ceil(batch.reduce((sum, s) => sum + s.length, 0) / 4)
    const promptTokens = result.usage?.tokens ?? result.usage?.inputTokens ?? estimatedTokens
    const costUsd =
      promptTokens !== null
        ? ((promptTokens * DEFAULT_EMBEDDING_PRICE_PER_MILLION) / 1_000_000).toFixed(6)
        : null

    // Validate dimensions BEFORE inserting success row
    for (const vec of result.embeddings) {
      if (vec.length !== dimensions) {
        if (options.workspaceId) {
          await taskStore.insert({
            workspaceId: options.workspaceId,
            strategyId: options.strategyId ?? null,
            taskKind: 'ingest',
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
        taskKind: 'ingest',
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
  const sleepCall = deps.sleepFn ?? sleep

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
      const is429 = isRateLimitError(err)

      if (is429 && attempt < maxAttempts) {
        if (options.workspaceId) {
          await taskStore.insert({
            workspaceId: options.workspaceId,
            strategyId: options.strategyId ?? null,
            taskKind: 'ingest',
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
        const delay = backoffDelayMs(attempt)
        await sleepCall(delay)
        continue
      }

      if (options.workspaceId) {
        await taskStore.insert({
          workspaceId: options.workspaceId,
          strategyId: options.strategyId ?? null,
          taskKind: 'ingest',
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
  const estimatedTokens = Math.ceil(trimmed.length / 4)
  const promptTokens = result.usage?.tokens ?? result.usage?.inputTokens ?? estimatedTokens
  const costUsd =
    promptTokens !== null
      ? ((promptTokens * DEFAULT_EMBEDDING_PRICE_PER_MILLION) / 1_000_000).toFixed(6)
      : null

  // Validate dimensions BEFORE inserting success row
  if (result.embedding.length !== dimensions) {
    if (options.workspaceId) {
      await taskStore.insert({
        workspaceId: options.workspaceId,
        strategyId: options.strategyId ?? null,
        taskKind: 'ingest',
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
      taskKind: 'ingest',
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
