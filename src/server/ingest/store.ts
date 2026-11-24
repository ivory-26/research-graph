import { and, cosineDistance, desc, eq, isNotNull, sql } from 'drizzle-orm'
import type { Database } from '../../db/client'
import {
  sourceChunks,
  sources,
  type NewSourceChunk,
  type SourceChunkRow,
} from '../../db/schema'
import type { Chunk, ScoredChunk, SearchChunksOptions } from './types'

/**
 * Inserts chunks with their embeddings, page numbers, and character spans into the database.
 *
 * Implements Issue #11:
 * - Stores chunks with page and character span in `source_chunks`
 * - Embeddings are persisted in the pgvector column for HNSW cosine search
 */
export async function storeChunks(
  db: Database,
  sourceId: string,
  chunks: Chunk[],
  embeddings: number[][],
): Promise<SourceChunkRow[]> {
  if (chunks.length !== embeddings.length) {
    throw new Error(
      `Chunk count (${chunks.length}) does not match embedding count (${embeddings.length}).`,
    )
  }

  if (chunks.length === 0) {
    return []
  }

  const rows: NewSourceChunk[] = chunks.map((chunk, idx) => ({
    sourceId,
    ordinal: chunk.ordinal,
    text: chunk.text,
    page: chunk.page,
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
    embedding: embeddings[idx],
  }))

  const inserted: SourceChunkRow[] = []
  const insertBatchSize = 50

  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += insertBatchSize) {
      const batch = rows.slice(i, i + insertBatchSize)
      const result = await tx.insert(sourceChunks).values(batch).returning()
      inserted.push(...result)
    }
  })

  return inserted
}

/**
 * Searches stored chunks by cosine similarity using Neon pgvector HNSW indexing.
 *
 * Implements Issue #11:
 * - Top-k cosine search over stored chunks
 * - Calculates cosine similarity (1 - cosineDistance)
 * - Optional workspace and source scoping
 */
export async function searchSimilarChunks(
  db: Database,
  options: SearchChunksOptions,
): Promise<ScoredChunk[]> {
  const { queryEmbedding, workspaceId, sourceId, topK = 5, minSimilarity } = options

  if (!queryEmbedding || queryEmbedding.length === 0) {
    throw new Error('queryEmbedding is required for similarity search.')
  }

  const safeTopK = Math.max(1, Math.min(topK ?? 5, 100))

  // Cosine distance expression: source_chunks.embedding <=> queryEmbedding
  // Cosine similarity: 1 - cosineDistance
  const similarityExpr = sql<number>`1 - (${cosineDistance(sourceChunks.embedding, queryEmbedding)})`

  // Exclude chunks with null embeddings so nullable column doesn't sort first as NULLS FIRST
  const conditions = [isNotNull(sourceChunks.embedding)]

  if (sourceId) {
    conditions.push(eq(sourceChunks.sourceId, sourceId))
  }

  if (workspaceId) {
    conditions.push(eq(sources.workspaceId, workspaceId))
  }

  if (minSimilarity !== undefined) {
    conditions.push(sql`${similarityExpr} >= ${minSimilarity}`)
  }

  // If workspaceId is supplied, join the sources table for isolation
  let rows: { chunk: SourceChunkRow; similarity: number }[]

  if (workspaceId) {
    rows = await db
      .select({
        chunk: sourceChunks,
        similarity: similarityExpr,
      })
      .from(sourceChunks)
      .innerJoin(sources, eq(sourceChunks.sourceId, sources.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(similarityExpr))
      .limit(safeTopK)
  } else {
    rows = await db
      .select({
        chunk: sourceChunks,
        similarity: similarityExpr,
      })
      .from(sourceChunks)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(similarityExpr))
      .limit(safeTopK)
  }

  return rows.map((r) => ({
    chunk: r.chunk,
    similarity: Number(r.similarity),
  }))
}

/**
 * Production wrapper enforcing mandatory workspace tenant isolation for vector similarity search.
 */
export async function searchSimilarChunksForWorkspace(
  db: Database,
  workspaceId: string,
  options: Omit<SearchChunksOptions, 'workspaceId'>,
): Promise<ScoredChunk[]> {
  return searchSimilarChunks(db, { ...options, workspaceId })
}
