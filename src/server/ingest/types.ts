import type { EmbeddingModel } from 'ai'
import type { SourceChunkRow } from '../../db/schema'

/**
 * Contract types for PDF ingestion, layout reading order, chunking, and vector storage (Issues #10 & #11).
 */

export interface TextItem {
  str: string
  x: number
  y: number
  width?: number
  height?: number
  fontSize?: number
  fontFamily?: string
}

export interface ExtractedPage {
  page: number
  text: string
  charStart: number
  charEnd: number
}

export interface PdfExtractResult {
  pages: ExtractedPage[]
  fullText: string
  totalPages: number
}

export interface Chunk {
  ordinal: number
  text: string
  page: number
  charStart: number
  charEnd: number
  tokenCount: number
}

export interface ChunkOptions {
  /** Target token size per chunk (default: 800) */
  targetTokens?: number
  /** Overlap ratio between adjacent chunks (default: 0.15 = 15%) */
  overlapRatio?: number
  /** Estimated characters per token for heuristic sizing (default: 4) */
  charsPerToken?: number
}

export interface EmbedOptions {
  /** Injected embedding model (defaults to gemini-embedding-2 at 768 dimensions) */
  model?: EmbeddingModel
  /** Batch size per embedding call (default: 20 per Issue #11) */
  batchSize?: number
  /** Dimensions of the embedding vector (default: 768) */
  dimensions?: number
  /** Optional cancellation signal */
  abortSignal?: AbortSignal
}

export interface ScoredChunk {
  chunk: SourceChunkRow
  similarity: number
}

export interface SearchChunksOptions {
  /** 768-dimensional query vector */
  queryEmbedding: number[]
  /** Optional workspace scoping (joins sources table) */
  workspaceId?: string
  /** Optional source filter */
  sourceId?: string
  /** Maximum number of results to return (default: 5) */
  topK?: number
  /** Optional minimum cosine similarity cutoff (e.g. 0.5) */
  minSimilarity?: number
}
