import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { chunkDocument, estimateTokens } from './chunker'
import { extractPageReadingOrder } from './order'
import { extractPdf, ingestPdf } from './pdf'
import type { ExtractedPage, TextItem } from './types'

describe('extractPageReadingOrder (Coordinate-based layout)', () => {
  it('correctly orders a two-column layout: column 1 before column 2', () => {
    // Synthetic two-column page with 20 items in each column
    const items: TextItem[] = []

    // Column 1 (x=50, y=700 down to 100)
    for (let i = 0; i < 20; i++) {
      items.push({
        str: `Col1-Line-${i}`,
        x: 50,
        y: 700 - i * 30,
        width: 150,
        height: 10,
      })
    }

    // Column 2 (x=350, y=700 down to 100)
    for (let i = 0; i < 20; i++) {
      items.push({
        str: `Col2-Line-${i}`,
        x: 350,
        y: 700 - i * 30,
        width: 150,
        height: 10,
      })
    }

    // Shuffle items to simulate arbitrary PDF stream ordering
    const shuffled = [...items].sort(() => Math.random() - 0.5)

    const result = extractPageReadingOrder(shuffled)

    // Col1-Line-0 must be at the very top
    expect(result).toContain('Col1-Line-0')
    // Col1-Line-19 must come before Col2-Line-0
    const col1End = result.indexOf('Col1-Line-19')
    const col2Start = result.indexOf('Col2-Line-0')

    expect(col1End).toBeGreaterThan(-1)
    expect(col2Start).toBeGreaterThan(-1)
    expect(col1End).toBeLessThan(col2Start)
  })

  it('preserves top-spanning header before two-column body', () => {
    const items: TextItem[] = [
      // Top spanning title at y=680
      { str: 'Paper Title Spanning Both Columns', x: 50, y: 680, width: 450, height: 14 },
    ]

    for (let i = 0; i < 15; i++) {
      items.push({ str: `Left-${i}`, x: 50, y: 550 - i * 30, width: 120, height: 10 })
      items.push({ str: `Right-${i}`, x: 350, y: 550 - i * 30, width: 120, height: 10 })
    }

    const result = extractPageReadingOrder(items)
    const titleIdx = result.indexOf('Paper Title')
    const leftIdx = result.indexOf('Left-0')
    const rightIdx = result.indexOf('Right-0')

    expect(titleIdx).toBeLessThan(leftIdx)
    expect(leftIdx).toBeLessThan(rightIdx)
  })

  it('de-hyphenates broken words across lines', () => {
    const items: TextItem[] = [
      { str: 'sta-', x: 50, y: 500, width: 25, height: 10 },
      { str: 'tistical epidemiology', x: 50, y: 485, width: 120, height: 10 },
    ]
    const result = extractPageReadingOrder(items)
    expect(result).toContain('statistical epidemiology')
  })

  it('filters out running headers and footers outside normal page margins', () => {
    const items: TextItem[] = [
      { str: 'BMC Bioinformatics Running Header', x: 50, y: 750, width: 200, height: 10 },
      { str: 'Page 1 of 21', x: 500, y: 20, width: 50, height: 10 },
      { str: 'Important Body Content', x: 50, y: 500, width: 150, height: 10 },
    ]
    const result = extractPageReadingOrder(items)
    expect(result).toContain('Important Body Content')
    expect(result).not.toContain('BMC Bioinformatics Running Header')
    expect(result).not.toContain('Page 1 of 21')
  })
})

describe('chunkDocument (Token sizing and overlap)', () => {
  it('splits text into ~800 token chunks with 15% overlap', () => {
    // Generate ~2000 tokens of text (~8000 characters)
    const paragraphs: string[] = []
    for (let p = 0; p < 25; p++) {
      paragraphs.push(
        `Paragraph ${p}: In statistics and machine learning, variable importance measures quantify the contribution of each input variable. This text illustrates reproducible research and automated analysis across multiple paragraphs.`
      )
    }
    const fullText = paragraphs.join('\n\n')

    const pages: ExtractedPage[] = [
      { page: 1, text: fullText.slice(0, 3000), charStart: 0, charEnd: 3000 },
      { page: 2, text: fullText.slice(3000), charStart: 3000, charEnd: fullText.length },
    ]

    const chunks = chunkDocument(fullText, pages, {
      targetTokens: 400, // scaled for quick deterministic test
      overlapRatio: 0.15,
      charsPerToken: 4,
    })

    expect(chunks.length).toBeGreaterThan(1)

    // Verify ordinals are sequential starting at 0
    chunks.forEach((chunk, idx) => {
      expect(chunk.ordinal).toBe(idx)
      expect(chunk.tokenCount).toBeGreaterThan(0)
      expect(chunk.page).toBeGreaterThanOrEqual(1)
      expect(chunk.charEnd).toBeGreaterThan(chunk.charStart)
    })

    // Verify overlap between chunk 0 and chunk 1
    const chunk0 = chunks[0]
    const chunk1 = chunks[1]

    // Next chunk start must be strictly before previous chunk end
    expect(chunk1.charStart).toBeLessThan(chunk0.charEnd)
    // Next chunk start must advance beyond previous chunk start
    expect(chunk1.charStart).toBeGreaterThan(chunk0.charStart)

    // Common overlapping text between chunk 0 and chunk 1
    const overlapText = fullText.slice(chunk1.charStart, chunk0.charEnd)
    expect(overlapText.length).toBeGreaterThan(0)
  })

  it('maps chunks correctly to their source pages', () => {
    const textP1 = 'Page 1 text content that goes here and continues for some length.'
    const textP2 = 'Page 2 text content with additional explanations and findings.'
    const fullText = `${textP1}\n\n${textP2}`

    const pages: ExtractedPage[] = [
      { page: 1, text: textP1, charStart: 0, charEnd: textP1.length },
      { page: 2, text: textP2, charStart: textP1.length + 2, charEnd: fullText.length },
    ]

    const chunks = chunkDocument(fullText, pages, {
      targetTokens: 10, // very small to force multiple chunks
      overlapRatio: 0.1,
    })

    expect(chunks[0].page).toBe(1)
    const lastChunk = chunks[chunks.length - 1]
    expect(lastChunk.page).toBe(2)
  })
})

describe('PDF Ingestion Integration with Fixtures', () => {
  const stroblPdfPath = path.resolve(process.cwd(), 'fixtures/papers/strobl-2007.pdf')

  it.skipIf(!fs.existsSync(stroblPdfPath))(
    'ingests real Strobl 2007 PDF into ordered pages and valid chunks',
    async () => {
      const buffer = fs.readFileSync(stroblPdfPath)
      const { result, chunks } = await ingestPdf(buffer, {
        targetTokens: 800,
        overlapRatio: 0.15,
      })

      expect(result.totalPages).toBe(21)
      expect(result.pages.length).toBe(21)
      expect(chunks.length).toBeGreaterThan(0)

      // Verify Page 2 reading order preserves column 1 before column 2
      const page2 = result.pages[1]
      expect(page2.page).toBe(2)
      expect(page2.text).toContain('Background')
      expect(page2.text).toContain('Prediction of phenotypes')

      const backgroundIdx = page2.text.indexOf('Background')
      const phenotypesIdx = page2.text.indexOf('Prediction of phenotypes')

      // Column 1 heading must be before Column 2 paragraph
      expect(backgroundIdx).toBeLessThan(phenotypesIdx)

      // Verify all chunks have required metadata
      for (const chunk of chunks) {
        expect(chunk.ordinal).toBeGreaterThanOrEqual(0)
        expect(chunk.text.length).toBeGreaterThan(0)
        expect(chunk.page).toBeGreaterThanOrEqual(1)
        expect(chunk.page).toBeLessThanOrEqual(21)
        expect(chunk.charStart).toBeGreaterThanOrEqual(0)
        expect(chunk.charEnd).toBeGreaterThan(chunk.charStart)
      }
    },
    15000,
  )
})
