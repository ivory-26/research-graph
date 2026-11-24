import { extractTextItems, getDocumentProxy } from 'unpdf'
import { chunkDocument } from './chunker'
import { extractPageReadingOrder } from './order'
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
