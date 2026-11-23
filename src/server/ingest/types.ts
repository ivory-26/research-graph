/**
 * Contract types for PDF ingestion, layout reading order, and chunking (Issue #10).
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
