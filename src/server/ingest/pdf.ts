import crypto from 'node:crypto'
import { extractTextItems, getDocumentProxy } from 'unpdf'
import type { Database } from '../../db/client'
import { sources, type SourceChunkRow, type SourceRow } from '../../db/schema'
import type { AgentTaskStore } from '../model'
import { chunkDocument } from './chunker'
import { embedChunks, embedChunksForWorkspace, type EmbedDeps } from './embed'
import { extractPageReadingOrder } from './order'
import { storeChunks } from './store'
import type { Chunk, ChunkOptions, ExtractedPage, PdfExtractResult } from './types'

/**
 * Extracts all text from a PDF buffer in visual reading order using coordinates.
 */
export async function extractPdf(data: Uint8Array | ArrayBuffer): Promise<PdfExtractResult> {
  const binary = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (!binary || binary.length === 0) {
    return {
      pages: [],
      fullText: '',
      totalPages: 0,
      needsOcr: true,
    }
  }

  const doc = await getDocumentProxy(binary)
  const { items, totalPages } = await extractTextItems(doc)

  const pages: ExtractedPage[] = []
  let fullText = ''
  let needsOcr = false

  for (let pageIdx = 0; pageIdx < items.length; pageIdx++) {
    const pageNum = pageIdx + 1
    const rawItems = items[pageIdx] ?? []

    const pageText = extractPageReadingOrder(rawItems)
    
    // docs/03: "If a page yields fewer than 40 characters, the PDF is probably scanned — mark the source needs_ocr and stop"
    const nonWsCount = pageText.replace(/\s+/g, '').length
    if (nonWsCount < 40) {
      needsOcr = true
    }

    const separator = fullText.length > 0 ? '\n\n' : ''
    const charStart = fullText.length + separator.length
    const charEnd = charStart + pageText.length

    if (pageText.length > 0) {
      fullText += separator + pageText
    }

    pages.push({
      page: pageNum,
      text: pageText,
      charStart,
      charEnd,
    })
  }

  return {
    pages,
    fullText,
    totalPages,
    needsOcr,
  }
}

/**
 * Ingests a PDF buffer: extracts reading order, maps character spans, and splits into ~800 token chunks.
 * If the source document needs OCR (page yielding fewer than 40 characters), stops and returns empty chunks.
 */
export async function ingestPdf(
  data: Uint8Array | ArrayBuffer,
  options?: ChunkOptions,
): Promise<{ result: PdfExtractResult; chunks: Chunk[] }> {
  const result = await extractPdf(data)
  
  if (result.needsOcr) {
    return {
      result,
      chunks: [],
    }
  }

  const chunks = chunkDocument(result.fullText, result.pages, options)

  return {
    result,
    chunks,
  }
}

export interface IngestPdfSourceOptions {
  workspaceId: string
  title: string
  url?: string | null
  doi?: string | null
  meta?: Record<string, unknown>
  chunkOptions?: ChunkOptions
  strategyId?: string | null
  taskStore?: AgentTaskStore
  abortSignal?: AbortSignal
}

export interface IngestPdfSourceDeps {
  db?: Database
  embedChunksFn?: typeof embedChunks
  embedDeps?: EmbedDeps
}

export interface IngestPdfSourceResult {
  source: SourceRow
  chunks: SourceChunkRow[]
  chunkCount: number
  extractResult: PdfExtractResult
  needsOcr: boolean
}

/**
 * End-to-end workspace-scoped PDF ingestion (docs/03 & docs/07):
 * extracts reading order, chunks text, generates 768d embeddings sequentially
 * with `agent_tasks` accounting, and persists `sources` + `source_chunks`
 * atomically in a single Postgres transaction.
 * Stops before embedding if `needsOcr` is triggered (< 40 non-whitespace chars on a page).
 */
export async function ingestPdfSource(
  data: Uint8Array | ArrayBuffer,
  options: IngestPdfSourceOptions,
  deps: IngestPdfSourceDeps = {},
): Promise<IngestPdfSourceResult> {
  const workspaceId = options.workspaceId.trim()
  if (!workspaceId) {
    throw new Error('workspaceId is required for ingestPdfSource.')
  }

  const title = options.title.trim()
  if (!title) {
    throw new Error('title is required for ingestPdfSource.')
  }

  const binary = data instanceof Uint8Array ? data : new Uint8Array(data)
  const sha256 = crypto.createHash('sha256').update(binary).digest('hex')
  const bytes = binary.byteLength

  const { result, chunks } = await ingestPdf(binary, options.chunkOptions)

  let db = deps.db
  if (!db) {
    const { getDb } = await import('../../db/client')
    db = getDb()
  }

  // docs/03: If any page yields < 40 non-whitespace characters, mark needsOcr and stop before embedding
  if (result.needsOcr || chunks.length === 0) {
    const [createdSource] = await db
      .insert(sources)
      .values({
        workspaceId,
        kind: 'paper',
        title,
        url: options.url ?? null,
        doi: options.doi ?? null,
        sha256,
        bytes,
        meta: {
          ...options.meta,
          needsOcr: true,
          totalPages: result.totalPages,
        },
      })
      .returning()

    if (!createdSource) {
      throw new Error('Failed to insert source row into database.')
    }

    return {
      source: createdSource,
      chunks: [],
      chunkCount: 0,
      extractResult: result,
      needsOcr: true,
    }
  }

  // Embed before opening the DB transaction so HTTP calls never hold locks open
  const embeddings = deps.embedChunksFn
    ? await deps.embedChunksFn(
        chunks,
        {
          workspaceId,
          strategyId: options.strategyId ?? null,
          taskStore: options.taskStore,
          abortSignal: options.abortSignal,
        },
        deps.embedDeps ?? {},
      )
    : await embedChunksForWorkspace(
        workspaceId,
        chunks,
        {
          strategyId: options.strategyId ?? null,
          taskStore: options.taskStore,
          abortSignal: options.abortSignal,
        },
        deps.embedDeps ?? {},
      )

  const { createdSource, chunkRows } = await db.transaction(async (tx) => {
    const [insertedSource] = await tx
      .insert(sources)
      .values({
        workspaceId,
        kind: 'paper',
        title,
        url: options.url ?? null,
        doi: options.doi ?? null,
        sha256,
        bytes,
        meta: {
          ...options.meta,
          needsOcr: false,
          totalPages: result.totalPages,
        },
      })
      .returning()

    if (!insertedSource) {
      throw new Error('Failed to insert source row into database.')
    }

    const stored = await storeChunks(tx as Database, insertedSource.id, chunks, embeddings)
    return { createdSource: insertedSource, chunkRows: stored }
  })

  return {
    source: createdSource,
    chunks: chunkRows,
    chunkCount: chunkRows.length,
    extractResult: result,
    needsOcr: false,
  }
}
