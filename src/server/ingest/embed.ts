import { embed, embedMany, type EmbeddingModel } from 'ai'
import { createGoogleGenerativeAI, google } from '@ai-sdk/google'
import type { Chunk, EmbedOptions } from './types'

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

const modelCache = new Map<string, EmbeddingModel>()

/**
 * Resolves the Google Generative AI embedding model with caching.
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
}

/**
 * Embeds an array of texts in batches of at most 20 chunks using gemini-embedding-2.
 *
 * Implements Issue #11 rules:
 * - gemini-embedding-2 at 768 dimensions
 * - One call per batch of at most 20 chunks
 * - Enforces dimensions match expected vector schema length
 */
export async function embedChunks(
  items: (string | Chunk | { text: string })[],
  options: EmbedOptions = {},
  deps: EmbedDeps = {},
): Promise<number[][]> {
  if (items.length === 0) {
    return []
  }

  const batchSize = Math.max(1, Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, 50))
  const dimensions = options.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS
  const resolveModelFn = deps.resolveModel ?? resolveEmbeddingModel
  const model = options.model ?? resolveModelFn(DEFAULT_EMBEDDING_MODEL_ID)
  const embedManyCall = deps.embedManyFn ?? embedMany

  const texts: string[] = items.map((item) => (typeof item === 'string' ? item : item.text))
  const allEmbeddings: number[][] = []

  // Process sequentially in batches of batchSize (default 20)
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)

    const result = await embedManyCall({
      model,
      values: batch,
      abortSignal: options.abortSignal,
    })

    for (const vec of result.embeddings) {
      if (vec.length !== dimensions) {
        throw new Error(
          `Embedding returned ${vec.length} dimensions, expected ${dimensions}.`,
        )
      }
      allEmbeddings.push(vec)
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

  const result = await embedCall({
    model,
    value: trimmed,
    abortSignal: options.abortSignal,
  })

  if (result.embedding.length !== dimensions) {
    throw new Error(
      `Query embedding returned ${result.embedding.length} dimensions, expected ${dimensions}.`,
    )
  }

  return result.embedding
}
