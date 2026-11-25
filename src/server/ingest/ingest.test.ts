import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { chunkDocument, estimateTokens, findPageForCharOffset } from './chunker'
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
  const papersDir = path.resolve(process.cwd(), 'fixtures/papers')
  const strobl2007Pdf = path.join(papersDir, 'strobl-2007.pdf')
  const strobl2008Pdf = path.join(papersDir, 'strobl-2008.pdf')
  const kursa2010Pdf = path.join(papersDir, 'kursa-2010.pdf')

  it.skipIf(!fs.existsSync(strobl2007Pdf))(
    'ingests real Strobl 2007 PDF into ordered pages and valid chunks',
    async () => {
      const buffer = fs.readFileSync(strobl2007Pdf)
      const { result, chunks } = await ingestPdf(buffer, {
        targetTokens: 800,
        overlapRatio: 0.15,
      })

      expect(result.totalPages).toBe(21)
      expect(result.pages.length).toBe(21)
      expect(chunks.length).toBeGreaterThan(0)
      expect(result.needsOcr).toBe(false)

      // Verify exact page character span identity for EVERY page (prevent drift blocker from Issue #10 review)
      for (const page of result.pages) {
        expect(result.fullText.slice(page.charStart, page.charEnd)).toBe(page.text)
      }

      // Verify Page 1 reading order
      const page1 = result.pages[0]
      expect(page1.page).toBe(1)
      expect(page1.text).toContain('Bias in random forest variable importance measures')
      expect(page1.text).toContain('Abstract')
      expect(page1.text).toContain('Background:')
      expect(page1.text).toContain('Conclusion:')
      expect(page1.text.indexOf('Background:')).toBeLessThan(page1.text.indexOf('Conclusion:'))

      // Verify Page 2 reading order preserves column 1 before column 2
      const page2 = result.pages[1]
      expect(page2.page).toBe(2)
      expect(page2.text).toContain('Background')
      expect(page2.text).toContain('Prediction of phenotypes')

      const backgroundIdx = page2.text.indexOf('Background')
      const phenotypesIdx = page2.text.indexOf('Prediction of phenotypes')

      // Column 1 heading must be before Column 2 paragraph
      expect(backgroundIdx).toBeLessThan(phenotypesIdx)

      // Verify all chunks have required metadata and alphanumeric content
      for (const chunk of chunks) {
        expect(chunk.ordinal).toBeGreaterThanOrEqual(0)
        expect(chunk.text.length).toBeGreaterThan(0)
        expect(/[a-zA-Z0-9]/.test(chunk.text)).toBe(true)
        expect(chunk.page).toBeGreaterThanOrEqual(1)
        expect(chunk.page).toBeLessThanOrEqual(21)
        expect(chunk.charStart).toBeGreaterThanOrEqual(0)
        expect(chunk.charEnd).toBeGreaterThan(chunk.charStart)
      }
    },
    15000,
  )

  it.skipIf(!fs.existsSync(strobl2008Pdf))(
    'ingests real Strobl 2008 PDF and verifies reading order and page span identity',
    async () => {
      const buffer = fs.readFileSync(strobl2008Pdf)
      const { result, chunks } = await ingestPdf(buffer)

      expect(result.totalPages).toBeGreaterThan(0)
      expect(chunks.length).toBeGreaterThan(0)
      expect(result.needsOcr).toBe(false)

      // Check character span identity for all pages
      for (const page of result.pages) {
        expect(result.fullText.slice(page.charStart, page.charEnd)).toBe(page.text)
      }

      // Verify reading order on page 1 of Strobl 2008 (no column-interleaving)
      const page1 = result.pages[0]
      expect(page1).toBeDefined()
      expect(page1.text).toContain('1 Background')
      expect(page1.text).toContain('Within the past few years, random forests')
      expect(page1.text).toContain('Identifying relevant predictor variables')
      expect(page1.text).not.toContain('varpredictive accuracy')
      expect(page1.text).toContain('predictive accuracy')
      expect(page1.text).toContain('candidate predictor variables')

      const p1Col1StartIdx = page1.text.indexOf('Within the past few years, random forests')
      const p1Col1EndIdx = page1.text.indexOf('DNA sequencing and other applications [2-5].')
      const p1Col2StartIdx = page1.text.indexOf('Identifying relevant predictor variables')
      const p1Col2EndIdx = page1.text.indexOf('of each predictor variable individu-')
      expect(p1Col1StartIdx).toBeGreaterThan(-1)
      expect(p1Col1EndIdx).toBeGreaterThan(p1Col1StartIdx)
      expect(p1Col2StartIdx).toBeGreaterThan(p1Col1EndIdx)
      expect(p1Col2EndIdx).toBeGreaterThan(p1Col2StartIdx)

      // Verify reading order preserves two-column layout on page 2 (column 1 before column 2)
      const page2 = result.pages[1]
      expect(page2).toBeDefined()
      expect(page2.text).toContain('spurious correlation')
      expect(page2.text).toContain('permutation accuracy importance')

      const col1Idx = page2.text.indexOf('spurious correlation')
      const col2Idx = page2.text.indexOf('permutation accuracy importance')
      expect(col1Idx).toBeLessThan(col2Idx)
    },
    15000,
  )

  it.skipIf(!fs.existsSync(kursa2010Pdf))(
    'ingests real Kursa 2010 PDF (A4 single-column) and verifies reading order without clipping top margin',
    async () => {
      const buffer = fs.readFileSync(kursa2010Pdf)
      const { result, chunks } = await ingestPdf(buffer)

      expect(result.totalPages).toBeGreaterThan(0)
      expect(chunks.length).toBeGreaterThan(0)
      expect(result.needsOcr).toBe(false)

      // Check character span identity for all pages
      for (const page of result.pages) {
        expect(result.fullText.slice(page.charStart, page.charEnd)).toBe(page.text)
      }

      // Page 1 should contain title and abstract in proper reading order
      const page1 = result.pages[0]
      expect(page1.text).toContain('Feature Selection with the Boruta Package')
      expect(page1.text).toContain('Abstract')
      expect(page1.text).toContain('1. Introduction')
      expect(page1.text.indexOf('Feature Selection with the Boruta Package')).toBeLessThan(
        page1.text.indexOf('1. Introduction'),
      )
    },
    15000,
  )

  it('drops chunks containing no alphanumeric characters (docs/03)', () => {
    const fullText = `Valid text with words. \n\n --- ... *** === +++ \n\n Another valid sentence.`
    const pages: ExtractedPage[] = [
      { page: 1, text: fullText, charStart: 0, charEnd: fullText.length },
    ]

    const chunks = chunkDocument(fullText, pages, {
      targetTokens: 10,
      overlapRatio: 0,
    })

    for (const chunk of chunks) {
      expect(/[a-zA-Z0-9]/.test(chunk.text)).toBe(true)
      expect(chunk.text).not.toBe('--- ... *** === +++')
    }
  })

  it('clamps inter-page separator offsets to the nearest preceding page instead of the last page', () => {
    const p1 = 'Page one content.' // 0..17
    const sep = '\n\n' // 17..19
    const p2 = 'Page two content.' // 19..36
    const p3 = 'Page three content.' // 38..57
    const fullText = `${p1}${sep}${p2}\n\n${p3}`
    const p1End = p1.length
    const p2Start = p1End + sep.length
    const p2End = p2Start + p2.length
    const p3Start = p2End + 2

    const pages: ExtractedPage[] = [
      { page: 1, text: p1, charStart: 0, charEnd: p1End },
      { page: 2, text: p2, charStart: p2Start, charEnd: p2End },
      { page: 3, text: p3, charStart: p3Start, charEnd: fullText.length },
    ]

    // 1. Offset 18 sits inside the '\n\n' separator between page 1 and page 2 (must clamp to 1, not page 3)
    expect(findPageForCharOffset(18, pages)).toBe(1)

    // 2. Through chunkDocument when a chunk starts inside a gap between page 1 (0..10) and page 2 (30..50)
    const gapText = 'Page1Head.' + 'GAPGAPGAPGAPGAPGAPGA' + 'Page2Body text here.' + 'Page3Tail text here.'
    const gapPages: ExtractedPage[] = [
      { page: 1, text: 'Page1Head.', charStart: 0, charEnd: 10 },
      { page: 2, text: 'Page2Body text here.', charStart: 30, charEnd: 50 },
      { page: 3, text: 'Page3Tail text here.', charStart: 50, charEnd: gapText.length },
    ]
    const gapChunks = chunkDocument(gapText, gapPages, {
      targetTokens: 3,
      overlapRatio: 0,
      charsPerToken: 4,
    })
    const gapChunk = gapChunks.find((c) => c.charStart > 10 && c.charStart < 30)
    expect(gapChunk).toBeDefined()
    expect(gapChunk!.page).toBe(1)
  })

  it('marks needsOcr when document is empty or a page yields fewer than 40 characters (docs/03)', async () => {
    const resEmpty = await extractPdf(new Uint8Array(0))
    expect(resEmpty.needsOcr).toBe(true)

    const ingestEmpty = await ingestPdf(new Uint8Array(0))
    expect(ingestEmpty.result.needsOcr).toBe(true)
    expect(ingestEmpty.chunks).toHaveLength(0)

    // Minimal valid single-page PDF containing only 11 non-whitespace characters ('Scanned stub')
    const streamBody = 'BT /F1 12 Tf 72 720 Td (Scanned stub) Tj ET'
    const objects = [
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n',
      `4 0 obj << /Length ${streamBody.length} >> stream\n${streamBody}\nendstream\nendobj\n`,
      '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
    ]
    let pdfStr = '%PDF-1.4\n'
    const offsets = [0]
    for (const obj of objects) {
      offsets.push(pdfStr.length)
      pdfStr += obj
    }
    const xrefStart = pdfStr.length
    pdfStr += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    for (let i = 1; i <= objects.length; i++) {
      pdfStr += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
    }
    pdfStr += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

    const sparsePdf = new TextEncoder().encode(pdfStr)
    const sparseExtract = await extractPdf(sparsePdf)
    expect(sparseExtract.totalPages).toBe(1)
    expect(sparseExtract.pages[0]?.text).toContain('Scanned stub')
    expect(sparseExtract.needsOcr).toBe(true)

    const sparseIngest = await ingestPdf(sparsePdf)
    expect(sparseIngest.result.needsOcr).toBe(true)
    expect(sparseIngest.chunks).toHaveLength(0)
  })
})

describe('ingestPdfSource (workspace-scoped persistent PDF ingestion)', () => {
  const strobl2007Pdf = path.resolve(process.cwd(), 'fixtures/papers/strobl-2007.pdf')

  it.skipIf(!fs.existsSync(strobl2007Pdf))(
    'extracts reading order, generates 768d embeddings, and persists source + chunks inside one transaction',
    async () => {
      const { ingestPdfSource } = await import('./pdf')
      const buffer = fs.readFileSync(strobl2007Pdf)
      const sourceUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      const workspaceUuid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

      let txCalled = 0
      const insertedSources: any[] = []
      const insertedChunks: any[] = []

      const fakeDb: any = {
        transaction: async (cb: any) => {
          txCalled++
          const tx: any = {
            transaction: async (inner: any) => inner(tx),
            insert: (table: any) => ({
              values: (vals: any) => ({
                returning: async () => {
                  const arr = Array.isArray(vals) ? vals : [vals]
                  if (arr[0]?.sha256 !== undefined) {
                    const row = { id: sourceUuid, ...arr[0], createdAt: new Date() }
                    insertedSources.push(row)
                    return [row]
                  }
                  const rows = arr.map((c: any, idx: number) => ({
                    id: `cccccccc-cccc-4ccc-8ccc-${String(insertedChunks.length + idx).padStart(12, '0')}`,
                    ...c,
                  }))
                  insertedChunks.push(...rows)
                  return rows
                },
              }),
            }),
          }
          return cb(tx)
        },
      }

      const embedCalls: any[] = []
      const mockEmbedChunks = async (items: any[], opts: any) => {
        embedCalls.push({ count: items.length, opts })
        return items.map(() => new Array(768).fill(0.01))
      }

      const res = await ingestPdfSource(
        buffer,
        {
          workspaceId: workspaceUuid,
          title: 'Strobl et al. 2007',
          doi: '10.1186/1471-2105-8-25',
          strategyId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        },
        { db: fakeDb, embedChunksFn: mockEmbedChunks as any },
      )

      expect(txCalled).toBe(1)
      expect(res.needsOcr).toBe(false)
      expect(res.source.id).toBe(sourceUuid)
      expect(res.source.workspaceId).toBe(workspaceUuid)
      expect(res.source.kind).toBe('paper')
      expect(res.chunkCount).toBeGreaterThan(5)
      expect(res.chunks).toHaveLength(res.chunkCount)
      expect(embedCalls).toHaveLength(1)
      expect(embedCalls[0].opts.workspaceId).toBe(workspaceUuid)
      expect(embedCalls[0].opts.strategyId).toBe('dddddddd-dddd-4ddd-8ddd-dddddddddddd')
      expect(insertedSources).toHaveLength(1)
      expect(insertedChunks).toHaveLength(res.chunkCount)
    },
  )

  it('records needsOcr source and stops before calling embeddings when PDF yields < 40 chars', async () => {
    const { ingestPdfSource } = await import('./pdf')
    const insertedSources: any[] = []
    let txCalls = 0
    const fakeDb: any = {
      insert: () => ({
        values: (vals: any) => ({
          returning: async () => {
            const row = { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', ...vals, createdAt: new Date() }
            insertedSources.push(row)
            return [row]
          },
        }),
      }),
      transaction: async () => {
        txCalls++
        throw new Error('Should not open chunk transaction when needsOcr is true')
      },
    }

    let embedCalled = false
    const mockEmbedChunks = async () => {
      embedCalled = true
      return []
    }

    const res = await ingestPdfSource(
      new Uint8Array(0),
      { workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Empty Scan.pdf' },
      { db: fakeDb, embedChunksFn: mockEmbedChunks as any },
    )

    expect(res.needsOcr).toBe(true)
    expect(res.chunkCount).toBe(0)
    expect(res.chunks).toHaveLength(0)
    expect(embedCalled).toBe(false)
    expect(txCalls).toBe(0)
    expect(insertedSources[0].meta.needsOcr).toBe(true)
  })

  it('aborts transaction cleanly without partial commit when chunk persistence throws', async () => {
    const { ingestPdfSource } = await import('./pdf')
    const streamBody = 'BT /F1 12 Tf 72 720 Td (' + 'Born digital scientific prose for atomic DB test. '.repeat(3) + ') Tj ET'
    const objects = [
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n',
      `4 0 obj << /Length ${streamBody.length} >> stream\n${streamBody}\nendstream\nendobj\n`,
      '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
    ]
    let pdfStr = '%PDF-1.4\n'
    const offsets = [0]
    for (const obj of objects) {
      offsets.push(pdfStr.length)
      pdfStr += obj
    }
    const xrefStart = pdfStr.length
    pdfStr += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    for (let i = 1; i <= objects.length; i++) {
      pdfStr += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
    }
    pdfStr += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

    let committed = false
    const fakeDb: any = {
      transaction: async (cb: any) => {
        const tx: any = {
          transaction: async (inner: any) => inner(tx),
          insert: () => ({
            values: (vals: any) => ({
              returning: async () => {
                if (!Array.isArray(vals)) {
                  return [{ id: 'src-tx-test', ...vals }]
                }
                throw new Error('simulated chunk insert failure')
              },
            }),
          }),
        }
        const out = await cb(tx)
        committed = true
        return out
      },
    }

    await expect(
      ingestPdfSource(
        new TextEncoder().encode(pdfStr),
        { workspaceId: 'ws-atomic', title: 'Atomic Test PDF' },
        {
          db: fakeDb,
          embedChunksFn: (async (items: any[]) => items.map(() => new Array(768).fill(0.1))) as any,
        },
      ),
    ).rejects.toThrow('simulated chunk insert failure')

    expect(committed).toBe(false)
  })

  it('rejects empty workspaceId or title', async () => {
    const { ingestPdfSource } = await import('./pdf')
    await expect(
      ingestPdfSource(new Uint8Array(0), { workspaceId: '   ', title: 'Valid' }),
    ).rejects.toThrow(/workspaceId is required/)
    await expect(
      ingestPdfSource(new Uint8Array(0), { workspaceId: 'ws-1', title: '   ' }),
    ).rejects.toThrow(/title is required/)
  })
})
