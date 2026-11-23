import { extractTextItems, getDocumentProxy } from 'unpdf'
import { chunkDocument } from './chunker'
import { extractPageReadingOrder } from './order'
import type { Chunk, ChunkOptions, ExtractedPage, PdfExtractResult } from './types'

/**
 * Extracts all text from a PDF buffer in visual reading order using coordinates.
 */
export async function extractPdf(data: Uint8Array | ArrayBuffer): Promise<PdfExtractResult> {
  const binary = data instanceof Uint8Array ? data : new Uint8Array(data)
  const doc = await getDocumentProxy(binary)
  const { items, totalPages } = await extractTextItems(doc)

  const pages: ExtractedPage[] = []
  let fullText = ''

  for (let pageIdx = 0; pageIdx < items.length; pageIdx++) {
    const pageNum = pageIdx + 1
    const rawItems = items[pageIdx] ?? []

    const pageText = extractPageReadingOrder(rawItems)
    const charStart = fullText.length
    const charEnd = charStart + pageText.length

    pages.push({
      page: pageNum,
      text: pageText,
      charStart,
      charEnd,
    })

    if (pageText.length > 0) {
      fullText += (fullText.length > 0 ? '\n\n' : '') + pageText
    }
  }

  return {
    pages,
    fullText,
    totalPages,
  }
}

/**
 * Ingests a PDF buffer: extracts reading order, maps character spans, and splits into ~800 token chunks.
 */
export async function ingestPdf(
  data: Uint8Array | ArrayBuffer,
  options?: ChunkOptions,
): Promise<{ result: PdfExtractResult; chunks: Chunk[] }> {
  const result = await extractPdf(data)
  const chunks = chunkDocument(result.fullText, result.pages, options)

  return {
    result,
    chunks,
  }
}
