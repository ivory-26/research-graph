import { describe, expect, it, vi } from 'vitest'
import type { Database } from '../db/client'
import {
  ingestWebSource,
  isPdfUrl,
  scrapeWithFirecrawl,
  type FirecrawlScrapeResult,
} from './firecrawl'
import { verifyCitationQuotes, type RetrievedPassage, type RetrievalCitation } from './retrieval'

describe('Firecrawl Web & Repo Ingestion (Issue #15)', () => {
  describe('isPdfUrl', () => {
    it('detects PDF URLs across different query strings, fragments and cases', () => {
      expect(isPdfUrl('https://example.com/paper.pdf')).toBe(true)
      expect(isPdfUrl('https://example.com/paper.PDF')).toBe(true)
      expect(isPdfUrl('https://example.com/paper.pdf?download=true&v=2')).toBe(true)
      expect(isPdfUrl('https://example.com/paper.pdf#page=4')).toBe(true)
    })

    it('returns false for web pages, project sites and repos', () => {
      expect(isPdfUrl('https://bmcbioinformatics.biomedcentral.com/articles/10.1186/1471-2105-8-25')).toBe(false)
      expect(isPdfUrl('https://github.com/cran/party')).toBe(false)
      expect(isPdfUrl('https://cran.r-project.org/web/packages/party/index.html')).toBe(false)
      expect(isPdfUrl('https://example.com/docs/pdf/guide.html')).toBe(false)
    })

    it('detects ArXiv and BioRxiv PDF endpoints', () => {
      expect(isPdfUrl('https://arxiv.org/pdf/2103.00020')).toBe(true)
      expect(isPdfUrl('https://www.biorxiv.org/content/10.1101/2020.01.01.123456v1.full.pdf')).toBe(true)
    })

    it('detects PDF from scrape metadata content-type even without .pdf extension', () => {
      expect(isPdfUrl('https://arxiv.org/abs/2103.00020', { 'content-type': 'application/pdf' })).toBe(true)
      expect(isPdfUrl('https://example.com/stream/document', { mimeType: 'application/pdf; charset=binary' })).toBe(true)
      expect(isPdfUrl('https://example.com/article', { 'content-type': 'text/html' })).toBe(false)
    })
  })

  describe('scrapeWithFirecrawl', () => {
    it('strictly rejects PDF URLs with explicit error', async () => {
      await expect(
        scrapeWithFirecrawl('https://example.com/strobl-2007.pdf'),
      ).rejects.toThrow('PDFs never go through Firecrawl. Ingest PDFs through ingestPdf instead')
    })

    it('rejects empty or whitespace URLs', async () => {
      await expect(scrapeWithFirecrawl('   ')).rejects.toThrow('URL cannot be empty.')
    })

    it('throws error if FIRECRAWL_API_KEY is missing when calling live endpoint', async () => {
      const origKey = process.env.FIRECRAWL_API_KEY
      delete process.env.FIRECRAWL_API_KEY

      try {
        await expect(scrapeWithFirecrawl('https://example.com/project')).rejects.toThrow(
          'FIRECRAWL_API_KEY is not configured',
        )
      } finally {
        if (origKey) process.env.FIRECRAWL_API_KEY = origKey
      }
    })

    it('uses injected scraper without burning API credits (off critical path)', async () => {
      const mockScraper = vi.fn().mockResolvedValue({
        url: 'https://example.com/project',
        title: 'Bias in Random Forest Importance',
        markdown: '# Bias in Random Forest Importance\n\nProject details and documentation.',
        description: 'Project overview',
        statusCode: 200,
        metadata: { sourceURL: 'https://example.com/project' },
      } as FirecrawlScrapeResult)

      const result = await scrapeWithFirecrawl(
        'https://example.com/project',
        {},
        { scraper: mockScraper },
      )

      expect(mockScraper).toHaveBeenCalledWith('https://example.com/project', {})
      expect(result.title).toBe('Bias in Random Forest Importance')
      expect(result.markdown).toContain('# Bias in Random Forest Importance')
    })

    it('rejects injected scraper response if returned metadata has application/pdf content-type', async () => {
      await expect(
        scrapeWithFirecrawl(
          'https://example.com/stream',
          {},
          {
            scraper: async () => ({
              url: 'https://example.com/stream',
              title: 'Stream',
              markdown: 'binary',
              description: null,
              statusCode: 200,
              metadata: { 'content-type': 'application/pdf' },
            }),
          },
        ),
      ).rejects.toThrow('PDFs never go through Firecrawl')
    })

    it('executes live fetch path, validates request shape, rejects non-2xx upstream statusCode and success: false, and falls back on bare-host titles', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      try {
        // 1. Successful scrape against bare host with empty title
        fetchMock.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                markdown: '# Root Project\nClean markdown content.',
                metadata: { title: '   ', statusCode: 200 },
              },
            }),
            { status: 200 },
          ),
        )

        const ok = await scrapeWithFirecrawl('https://example.com/', { apiKey: 'fc-test-key' })
        expect(ok.title).toBe('example.com')
        expect(fetchMock).toHaveBeenCalledWith(
          'https://api.firecrawl.dev/v1/scrape',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({ Authorization: 'Bearer fc-test-key' }),
            body: JSON.stringify({ url: 'https://example.com/', formats: ['markdown'] }),
          }),
        )

        // 2. Rejects upstream HTTP 404 page returned inside Firecrawl metadata
        fetchMock.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                markdown: '404 Not Found',
                metadata: { title: 'Not Found', statusCode: 404 },
              },
            }),
            { status: 200 },
          ),
        )
        await expect(
          scrapeWithFirecrawl('https://example.com/missing', { apiKey: 'fc-test-key' }),
        ).rejects.toThrow('upstream HTTP 404')

        // 3. Rejects Firecrawl payload success: false
        fetchMock.mockResolvedValueOnce(
          new Response(
            JSON.stringify({ success: false, error: 'Blocked by target site' }),
            { status: 200 },
          ),
        )
        await expect(
          scrapeWithFirecrawl('https://example.com/blocked', { apiKey: 'fc-test-key' }),
        ).rejects.toThrow('Blocked by target site')
        // 4. Strips query string when deriving fallback title from pathname
        fetchMock.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                markdown: '# Page Content\nText body.',
                metadata: { statusCode: 200 },
              },
            }),
            { status: 200 },
          ),
        )
        const cleanTitle = await scrapeWithFirecrawl('https://example.com/project-page?ref=x#sec', {
          apiKey: 'fc-test-key',
        })
        expect(cleanTitle.title).toBe('project-page')
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  describe('ingestWebSource', () => {
    const sampleMarkdown = `
# Bias in random forest variable importance measures: Illustrations, sources and a solution

## Abstract
Random forest is a popular machine learning ensemble method. However, the standard Gini importance
measure is known to be biased toward variables with many categories or continuous scales.
This project page documents the R package implementation and simulation benchmarks.

## Package Documentation
The party package provides an implementation of conditional inference trees and unbiased random forests.
cforest implements conditional permutation importance which removes spurious correlations between predictors.
`

    it('strictly rejects PDF URLs from ingestion', async () => {
      await expect(
        ingestWebSource('https://example.com/doc.pdf', {
          workspaceId: 'ws-1',
        }),
      ).rejects.toThrow('PDFs never go through Firecrawl')
    })

    it('ingests web page, chunks markdown, generates 768d embeddings, and saves to database', async () => {
      const createdSourceRow = {
        id: 'source-web-1',
        workspaceId: 'ws-1',
        kind: 'web',
        title: 'Strobl 2007 Project Page',
        url: 'https://bmcbioinformatics.biomedcentral.com/articles/10.1186/1471-2105-8-25',
        doi: null,
        sha256: 'hash-123',
        bytes: 850,
        meta: { firecrawl: true },
        createdAt: new Date(),
      }

      const mockDb: any = {
        insert: vi.fn().mockImplementation((table) => {
          return {
            values: vi.fn().mockImplementation((values) => {
              return {
                returning: vi.fn().mockResolvedValue(
                  Array.isArray(values)
                    ? values.map((v, i) => ({ id: `chunk-row-${i}`, ...v }))
                    : [createdSourceRow],
                ),
              }
            }),
          }
        }),
      }
      mockDb.transaction = vi.fn().mockImplementation(async (cb) => cb(mockDb))

      const mockEmbedder = vi.fn().mockImplementation(async (chunks) => {
        return chunks.map(() => new Array(768).fill(0.02))
      })

      const res = await ingestWebSource(
        'https://bmcbioinformatics.biomedcentral.com/articles/10.1186/1471-2105-8-25',
        {
          workspaceId: 'ws-1',
          title: 'Strobl 2007 Project Page',
          preFetchedMarkdown: sampleMarkdown,
        },
        {
          db: mockDb,
          embedChunksFn: mockEmbedder,
        },
      )

      expect(res.source.id).toBe('source-web-1')
      expect(res.source.kind).toBe('web')
      expect(res.chunks.length).toBeGreaterThan(0)
      expect(res.chunkRows.length).toBe(res.chunks.length)
      expect(res.embeddings.length).toBe(res.chunks.length)
      expect(res.embeddings[0]).toHaveLength(768)
      expect(mockEmbedder).toHaveBeenCalledTimes(1)
      expect(mockEmbedder).toHaveBeenCalledWith(
        res.chunks,
        { workspaceId: 'ws-1' },
        expect.anything(),
      )
      expect(mockDb.transaction).toHaveBeenCalled()
    })

    it('auto-detects github.com URLs as repo kind', async () => {
      const createdSourceRow = {
        id: 'source-repo-1',
        workspaceId: 'ws-1',
        kind: 'repo',
        title: 'cran/party',
        url: 'https://github.com/cran/party',
        doi: null,
        sha256: 'hash-456',
        bytes: 400,
        meta: { firecrawl: true },
        createdAt: new Date(),
      }

      let insertedKind = ''
      const mockDb: any = {
        insert: vi.fn().mockImplementation(() => ({
          values: vi.fn().mockImplementation((val) => {
            if (!Array.isArray(val)) {
              insertedKind = val.kind
            }
            return {
              returning: vi.fn().mockResolvedValue(
                Array.isArray(val) ? val.map((v, i) => ({ id: `c-${i}`, ...v })) : [createdSourceRow],
              ),
            }
          }),
        })),
      }
      mockDb.transaction = vi.fn().mockImplementation(async (cb) => cb(mockDb))

      const mockEmbedder = vi.fn().mockResolvedValue([new Array(768).fill(0.01)])

      const res = await ingestWebSource(
        'https://github.com/cran/party',
        {
          workspaceId: 'ws-1',
          preFetchedMarkdown: '# party: A Laboratory for Recursive Partytioning\nREADME content.',
        },
        {
          db: mockDb,
          embedChunksFn: mockEmbedder,
        },
      )

      expect(insertedKind).toBe('repo')
      expect(res.source.kind).toBe('repo')
    })

    it('keeps non-GitHub hosts containing github.com substring as web kind and falls back empty titles to URL', async () => {
      let insertedSource: any = null
      const mockDb: any = {
        insert: vi.fn().mockImplementation(() => ({
          values: vi.fn().mockImplementation((val) => {
            if (!Array.isArray(val)) insertedSource = val
            return {
              returning: vi.fn().mockResolvedValue(
                Array.isArray(val) ? val.map((v, i) => ({ id: `c-${i}`, ...v })) : [{ id: 'src-w', ...val }],
              ),
            }
          }),
        })),
      }
      mockDb.transaction = vi.fn().mockImplementation(async (cb) => cb(mockDb))

      const mockEmbedder = vi.fn().mockResolvedValue([new Array(768).fill(0.01)])
      const res = await ingestWebSource(
        'https://notgithub.com/org/repo',
        {
          workspaceId: 'ws-host',
          title: '   ',
          preFetchedMarkdown: '# Lookalike Domain\nThis is a regular web page, not a GitHub repo.',
        },
        {
          db: mockDb,
          embedChunksFn: mockEmbedder,
        },
      )

      expect(res.source.kind).toBe('web')
      expect(insertedSource.kind).toBe('web')
      expect(insertedSource.title).toBe('https://notgithub.com/org/repo')
    })

    it('verifies that ingested web chunks can be cited with verbatim quotes', async () => {
      // Acceptance test: "Done when: a project page ingests as a source with chunks and can be cited."
      const mockEmbedder = vi.fn().mockResolvedValue([new Array(768).fill(0.01)])
      const mockDb: any = {
        insert: vi.fn().mockImplementation(() => ({
          values: vi.fn().mockImplementation((val) => ({
            returning: vi.fn().mockResolvedValue(
              Array.isArray(val)
                ? val.map((v, i) => ({ id: `chunk-web-${i}`, ...v }))
                : [{ id: 'src-web-1', kind: 'web', title: 'Strobl Project', ...val }],
            ),
          })),
        })),
      }
      mockDb.transaction = vi.fn().mockImplementation(async (cb) => cb(mockDb))

      const ingestResult = await ingestWebSource(
        'https://bmcbioinformatics.biomedcentral.com/articles/10.1186/1471-2105-8-25',
        {
          workspaceId: 'ws-demo',
          preFetchedMarkdown: sampleMarkdown,
        },
        {
          db: mockDb,
          embedChunksFn: mockEmbedder,
        },
      )

      const chunk = ingestResult.chunks[0]!
      const passage: RetrievedPassage = {
        chunkId: 'chunk-web-0',
        sourceId: 'src-web-1',
        sourceTitle: 'Strobl Project Page',
        sourceKind: 'web',
        page: chunk.page,
        ordinal: chunk.ordinal,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        text: chunk.text,
        similarity: 0.95,
      }

      // Valid verbatim citation from the web markdown
      const citations: RetrievalCitation[] = [
        {
          sourceId: 'src-web-1',
          sourceTitle: 'Strobl Project Page',
          chunkId: 'chunk-web-0',
          page: 1,
          quote: 'cforest implements conditional permutation importance which removes spurious correlations',
          claimSupported: 'cforest eliminates correlation bias in importance measures',
        },
      ]

      const { accepted, rejected } = verifyCitationQuotes(citations, [passage])
      expect(rejected).toHaveLength(0)
      expect(accepted).toHaveLength(1)
      expect(accepted[0]?.verified).toBe(true)
      expect(accepted[0]?.quote).toBe(
        'cforest implements conditional permutation importance which removes spurious correlations',
      )
    })

    it('throws error when markdown produces zero chunks (e.g. non-alphanumeric content)', async () => {
      await expect(
        ingestWebSource(
          'https://example.com/empty-headings',
          {
            workspaceId: 'ws-empty-chunk',
            preFetchedMarkdown: '# --- \n\n ### === \n\n ---',
          },
        ),
      ).rejects.toThrow('produced zero valid chunks')
    })

    it('preserves app-owned firecrawl: true and scrapedAt keys over remote metadata collisions', async () => {
      let insertedMeta: any = null
      const mockDb: any = {
        insert: vi.fn().mockImplementation(() => ({
          values: vi.fn().mockImplementation((val) => {
            if (!Array.isArray(val)) {
              insertedMeta = val.meta
            }
            return {
              returning: vi.fn().mockResolvedValue([
                { id: 'src-1', ...val, createdAt: new Date() },
              ]),
            }
          }),
        })),
      }
      mockDb.transaction = vi.fn().mockImplementation(async (cb) => cb(mockDb))

      await ingestWebSource(
        'https://example.com/meta-collision',
        {
          workspaceId: 'ws-meta',
        },
        {
          db: mockDb,
          embedChunksFn: vi.fn().mockResolvedValue([new Array(768).fill(0.1)]),
          scraper: vi.fn().mockResolvedValue({
            url: 'https://example.com/meta-collision',
            title: 'Title',
            markdown: '# Valid Title\n\nValid body text for chunking.',
            metadata: {
              firecrawl: false, // Malicious or collision attempt!
              scrapedAt: '1970-01-01T00:00:00.000Z',
              customField: 'preserved',
            },
          } as any),
        },
      )

      expect(insertedMeta.firecrawl).toBe(true)
      expect(insertedMeta.customField).toBe('preserved')
      expect(insertedMeta.scrapedAt).not.toBe('1970-01-01T00:00:00.000Z')
    })
  })
})
