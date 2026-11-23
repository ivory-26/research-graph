import crypto from 'node:crypto'
import type { Database } from '../db/client'
import {
  sources,
  sourceChunks,
  type NewSource,
  type SourceChunkRow,
  type SourceRow,
} from '../db/schema'
import { chunkDocument } from './ingest/chunker'
import { embedChunks, type EmbedDeps } from './ingest/embed'
import { storeChunks } from './ingest/store'
import type { Chunk, ChunkOptions } from './ingest/types'

export const DEFAULT_FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v1'

export interface FirecrawlScrapeOptions {
  /** API key override (defaults to process.env.FIRECRAWL_API_KEY) */
  apiKey?: string
  /** Base URL override (defaults to https://api.firecrawl.dev/v1) */
  baseUrl?: string
  /** Optional timeout in milliseconds */
  timeoutMs?: number
  /** AbortSignal for cancellation */
  abortSignal?: AbortSignal
}

export interface FirecrawlScrapeResult {
  url: string
  title: string
  markdown: string
  description: string | null
  statusCode: number
  metadata: Record<string, unknown>
}

export interface IngestWebSourceOptions extends FirecrawlScrapeOptions {
  /** Workspace ID to attach the source to */
  workspaceId: string
  /** Source kind: 'web' | 'repo' (default: 'web', or 'repo' if github.com) */
  kind?: 'web' | 'repo'
  /** Title override if Firecrawl metadata title is absent or generic */
  title?: string
  /** Target token size and overlap options for chunking */
  chunkOptions?: ChunkOptions
  /** Optional pre-fetched markdown content (bypasses network scrape) */
  preFetchedMarkdown?: string
  /** Optional pre-fetched title */
  preFetchedTitle?: string
}

export interface IngestWebSourceResult {
  source: SourceRow
  chunks: Chunk[]
  chunkRows: SourceChunkRow[]
  embeddings: number[][]
}

export type FirecrawlScraper = (
  url: string,
  options?: FirecrawlScrapeOptions,
) => Promise<FirecrawlScrapeResult>

export interface FirecrawlDeps {
  db?: Database
  scraper?: FirecrawlScraper
  embedChunksFn?: typeof embedChunks
  embedDeps?: EmbedDeps
}

/**
 * Checks if a given URL points to a PDF document or if scrape metadata reports a PDF MIME type.
 * Invariant: PDFs never go through Firecrawl (Issue #15 & CLAUDE.md).
 */
export function isPdfUrl(url: string, metadata?: Record<string, unknown>): boolean {
  if (metadata) {
    const contentType =
      (metadata['content-type'] ?? metadata['contentType'] ?? metadata['mimeType'] ?? '') as string
    if (typeof contentType === 'string' && contentType.toLowerCase().includes('application/pdf')) {
      return true
    }
  }

  try {
    const parsed = new URL(url)
    const pathname = parsed.pathname.toLowerCase()
    return pathname.endsWith('.pdf') || pathname.includes('/pdf/')
  } catch {
    const lower = url.toLowerCase()
    return lower.includes('.pdf') || lower.includes('/pdf/')
  }
}

/**
 * Scrapes a web page or repo README via Firecrawl API.
 *
 * Rules:
 * - Reject any PDF URL: "PDFs never go through Firecrawl" (Issue #15)
 * - Returns clean markdown, title, description, and metadata
 * - Respects timeout and abort signals
 */
export async function scrapeWithFirecrawl(
  url: string,
  options: FirecrawlScrapeOptions = {},
  deps: FirecrawlDeps = {},
): Promise<FirecrawlScrapeResult> {
  const trimmed = url.trim()
  if (!trimmed) {
    throw new Error('URL cannot be empty.')
  }

  // Hard rule: PDFs must never go through Firecrawl
  if (isPdfUrl(trimmed)) {
    throw new Error(
      `PDFs never go through Firecrawl. Ingest PDFs through ingestPdf instead: ${trimmed}`,
    )
  }

  if (deps.scraper) {
    return deps.scraper(trimmed, options)
  }

  const apiKey = options.apiKey ?? process.env.FIRECRAWL_API_KEY
  if (!apiKey) {
    throw new Error(
      'FIRECRAWL_API_KEY is not configured. Set FIRECRAWL_API_KEY in environment or pass apiKey in options.',
    )
  }

  const baseUrl = options.baseUrl ?? process.env.FIRECRAWL_API_URL ?? DEFAULT_FIRECRAWL_API_URL
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/scrape`

  const controller = new AbortController()
  const timeoutId = options.timeoutMs
    ? setTimeout(() => controller.abort(), options.timeoutMs)
    : null

  const signal = options.abortSignal
    ? AbortSignal.any
      ? AbortSignal.any([options.abortSignal, controller.signal])
      : controller.signal
    : controller.signal

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: trimmed,
        formats: ['markdown'],
      }),
      signal,
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(
        `Firecrawl scrape failed with HTTP status ${response.status} (${response.statusText}): ${errText}`,
      )
    }

    const payload = (await response.json()) as {
      success?: boolean
      error?: string
      data?: {
        markdown?: string
        content?: string
        metadata?: {
          title?: string
          description?: string
          statusCode?: number
          sourceURL?: string
          [key: string]: unknown
        }
      }
    }

    if (payload.success === false) {
      throw new Error(`Firecrawl API error: ${payload.error ?? 'Unknown Firecrawl error'}`)
    }

    const data = payload.data ?? {}
    const meta = data.metadata ?? {}

    if (isPdfUrl(trimmed, meta)) {
      throw new Error(
        `PDFs never go through Firecrawl. Scraped response content-type is application/pdf: ${trimmed}`,
      )
    }

    const markdown = data.markdown ?? data.content ?? ''

    return {
      url: trimmed,
      title: (meta.title as string) || (trimmed.split('/').pop() ?? 'Web Source'),
      markdown,
      description: (meta.description as string) || null,
      statusCode: (meta.statusCode as number) ?? 200,
      metadata: meta,
    }
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

/**
 * Ingests a web project page or repository README as a source in the workspace.
 *
 * Implements Issue #15 acceptance criteria:
 * - Scrapes clean markdown from Firecrawl
 * - Enforces "PDFs never go through Firecrawl"
 * - Chunks text into ~800-token chunks with 15% overlap
 * - Embeds chunks with gemini-embedding-2 (768 dimensions)
 * - Persists source row and chunk rows in Neon DB for cross-source retrieval and citations
 */
export async function ingestWebSource(
  url: string,
  options: IngestWebSourceOptions,
  deps: FirecrawlDeps = {},
): Promise<IngestWebSourceResult> {
  const trimmed = url.trim()
  if (!trimmed) {
    throw new Error('URL cannot be empty.')
  }

  if (isPdfUrl(trimmed)) {
    throw new Error(
      `PDFs never go through Firecrawl. Ingest PDFs through ingestPdf instead: ${trimmed}`,
    )
  }

  // 1. Scrape web page or use pre-fetched markdown
  let markdown = options.preFetchedMarkdown
  let title = options.title ?? options.preFetchedTitle
  let metadata: Record<string, unknown> = {}

  if (!markdown) {
    const scrapeResult = await scrapeWithFirecrawl(trimmed, options, deps)
    markdown = scrapeResult.markdown
    title = title ?? scrapeResult.title
    metadata = scrapeResult.metadata
  }

  if (!markdown || markdown.trim().length === 0) {
    throw new Error(`No content could be extracted from URL: ${trimmed}`)
  }

  const finalTitle = title ?? trimmed

  // 2. Detect kind (repo vs web)
  const isRepo =
    options.kind === 'repo' ||
    trimmed.includes('github.com/') ||
    trimmed.includes('gitlab.com/')

  const kind: 'web' | 'repo' = options.kind ?? (isRepo ? 'repo' : 'web')

  // 3. Compute sha256 and byte length
  const sha256 = crypto.createHash('sha256').update(markdown).digest('hex')
  const bytes = Buffer.byteLength(markdown, 'utf-8')

  // 4. Chunk markdown content into ~800 token chunks with 15% overlap
  const virtualPages = [
    {
      page: 1,
      text: markdown,
      charStart: 0,
      charEnd: markdown.length,
    },
  ]

  const chunks = chunkDocument(markdown, virtualPages, options.chunkOptions)

  // 5. Embed chunks using gemini-embedding-2 (768d) with workspaceId task accounting
  const embedFn = deps.embedChunksFn ?? embedChunks
  const embeddings = await embedFn(
    chunks,
    { workspaceId: options.workspaceId },
    deps.embedDeps ?? {},
  )

  // 6. Persist source and chunks atomically inside a single transaction
  let db = deps.db
  if (!db) {
    const { getDb } = await import('../db/client')
    db = getDb()
  }

  const newSource: NewSource = {
    workspaceId: options.workspaceId,
    kind,
    title: finalTitle,
    url: trimmed,
    doi: null,
    sha256,
    bytes,
    meta: {
      firecrawl: true,
      scrapedAt: new Date().toISOString(),
      ...metadata,
    },
  }

  const { createdSource, chunkRows } = await db.transaction(async (tx) => {
    const [insertedSource] = await tx.insert(sources).values(newSource).returning()
    if (!insertedSource) {
      throw new Error('Failed to insert source row into database.')
    }
    const stored = await storeChunks(tx as Database, insertedSource.id, chunks, embeddings)
    return { createdSource: insertedSource, chunkRows: stored }
  })

  return {
    source: createdSource,
    chunks,
    chunkRows,
    embeddings,
  }
}
