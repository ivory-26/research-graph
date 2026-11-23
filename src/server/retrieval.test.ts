import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ingestPdf } from './ingest'
import type { Database } from '../db/client'
import type { CallModel, CallModelContext, CallModelResult } from './model'
import {
  askAcrossSources,
  retrieveCrossSourcePassages,
  verifyCitationQuotes,
  type RetrievedPassage,
  type RetrievalAnswer,
  type RetrievalCitation,
} from './retrieval'

describe('Ask-Across-Sources Retrieval (Issue #14)', () => {
  const samplePassages: RetrievedPassage[] = [
    {
      chunkId: 'chunk-s07-1',
      sourceId: 'source-strobl-2007',
      sourceTitle: 'Bias in random forest variable importance measures (Strobl et al., 2007)',
      sourceKind: 'paper',
      page: 1,
      ordinal: 0,
      charStart: 0,
      charEnd: 350,
      text: 'Simulation studies are presented illustrating that, when predictor variables vary in their scale of measurement or number of categories, the Gini importance measure is biased toward features with more categories. Even an uninformative variable with many categories can rank higher than an informative one.',
      similarity: 0.89,
    },
    {
      chunkId: 'chunk-s08-1',
      sourceId: 'source-strobl-2008',
      sourceTitle: 'Conditional variable importance for random forests (Strobl et al., 2008)',
      sourceKind: 'paper',
      page: 2,
      ordinal: 1,
      charStart: 0,
      charEnd: 320,
      text: 'We propose a conditional permutation importance measure that reflects the true impact of a predictor variable under feature correlation. By conditioning on correlated predictors, spurious importance is eliminated.',
      similarity: 0.84,
    },
    {
      chunkId: 'chunk-k10-1',
      sourceId: 'source-kursa-2010',
      sourceTitle: 'Feature Selection with the Boruta Package (Kursa & Rudnicki, 2010)',
      sourceKind: 'paper',
      page: 3,
      ordinal: 0,
      charStart: 0,
      charEnd: 340,
      text: 'Boruta is a feature selection wrapper algorithm based on random forest classification. It contrasts original features against shadow features created by shuffling to find all relevant attributes rather than just a minimal subset.',
      similarity: 0.81,
    },
  ]

  describe('verifyCitationQuotes', () => {
    it('verifies exact and normalized verbatim quotes from retrieved passages', () => {
      const citations: RetrievalCitation[] = [
        {
          sourceId: 'source-strobl-2007',
          sourceTitle: 'Strobl 2007',
          chunkId: 'chunk-s07-1',
          page: 1,
          quote: 'the Gini importance measure is biased toward features with more categories',
          claimSupported: 'Gini importance favors high-cardinality predictors',
        },
        {
          sourceId: 'source-strobl-2008',
          sourceTitle: 'Strobl 2008',
          chunkId: 'chunk-s08-1',
          page: 2,
          quote: 'conditional permutation importance measure that reflects the true impact',
          claimSupported: 'Conditional importance remedies correlation bias',
        },
      ]

      const { accepted, rejected } = verifyCitationQuotes(citations, samplePassages)
      expect(rejected).toHaveLength(0)
      expect(accepted).toHaveLength(2)
      expect(accepted[0]?.verified).toBe(true)
      expect(accepted[0]?.chunkId).toBe('chunk-s07-1')
      expect(accepted[1]?.verified).toBe(true)
      expect(accepted[1]?.chunkId).toBe('chunk-s08-1')
    })

    it('rejects citations with hallucinated or altered quotes', () => {
      const citations: RetrievalCitation[] = [
        {
          sourceId: 'source-strobl-2007',
          sourceTitle: 'Strobl 2007',
          chunkId: 'chunk-s07-1',
          page: 1,
          quote: 'Gini importance is totally broken and should never be used ever',
          claimSupported: 'Hallucinated critique',
        },
      ]

      const { accepted, rejected } = verifyCitationQuotes(citations, samplePassages)
      expect(accepted).toHaveLength(0)
      expect(rejected).toHaveLength(1)
      expect(rejected[0]?.reason).toBe('quote_not_found_in_chunk')
    })

    it('rejects citations referencing non-existent chunk IDs', () => {
      const citations: RetrievalCitation[] = [
        {
          sourceId: 'source-strobl-2007',
          sourceTitle: 'Strobl 2007',
          chunkId: 'non-existent-chunk-id',
          page: 1,
          quote: 'the Gini importance measure is biased',
          claimSupported: 'Claim with missing chunk',
        },
      ]

      const { accepted, rejected } = verifyCitationQuotes(citations, samplePassages)
      expect(accepted).toHaveLength(0)
      expect(rejected).toHaveLength(1)
      expect(rejected[0]?.reason).toBe('chunk_not_found')
    })
  })

  describe('retrieveCrossSourcePassages', () => {
    it('throws error when workspaceId is missing for multi-tenant isolation', async () => {
      const mockDb = {} as unknown as Database
      await expect(retrieveCrossSourcePassages(mockDb, 'random forests bias')).rejects.toThrow(
        'workspaceId is required for cross-source retrieval multi-tenant isolation.',
      )
    })

    it('forwards workspaceId to embedQuery for agent_tasks model accounting', async () => {
      const mockLimit = vi.fn().mockResolvedValue([])
      const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit })
      const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy })
      const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere })
      const mockFrom = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin })
      const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })
      const mockDb = { select: mockSelect } as unknown as Database

      let capturedEmbedOptions: any = null
      const fakeEmbedQuery = vi.fn(async (_query: string, opts: any) => {
        capturedEmbedOptions = opts
        return new Array(768).fill(0.01)
      })

      await retrieveCrossSourcePassages(
        mockDb,
        'what is permutation importance',
        { workspaceId: 'ws-tenant-42' },
        { embedQueryFn: fakeEmbedQuery as any },
      )

      expect(fakeEmbedQuery).toHaveBeenCalledTimes(1)
      expect(capturedEmbedOptions.workspaceId).toBe('ws-tenant-42')
    })

    it('executes database query joining sources and sourceChunks with cosine similarity', async () => {
      const mockRows = [
        {
          chunk: {
            id: 'chunk-1',
            sourceId: 'source-1',
            ordinal: 0,
            text: 'Random forests variable importance text',
            page: 1,
            charStart: 0,
            charEnd: 39,
            embedding: new Array(768).fill(0.01),
          },
          source: {
            id: 'source-1',
            workspaceId: 'ws-1',
            kind: 'paper',
            title: 'Strobl 2007',
            url: null,
            doi: null,
            sha256: 'abc',
            bytes: 1234,
            meta: {},
            createdAt: new Date(),
          },
          similarity: 0.92,
        },
      ]

      const mockLimit = vi.fn().mockResolvedValue(mockRows)
      const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit })
      const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy })
      const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere })
      const mockFrom = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin })
      const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })

      const mockDb = { select: mockSelect } as unknown as Database
      const queryVec = new Array(768).fill(0.05)

      const passages = await retrieveCrossSourcePassages(mockDb, 'random forests bias', {
        workspaceId: 'ws-1',
        queryEmbedding: queryVec,
        topK: 5,
        minSimilarity: 0.7,
      })

      expect(mockSelect).toHaveBeenCalled()
      expect(mockFrom).toHaveBeenCalled()
      expect(mockInnerJoin).toHaveBeenCalled()
      expect(passages).toHaveLength(1)
      expect(passages[0]?.chunkId).toBe('chunk-1')
      expect(passages[0]?.sourceTitle).toBe('Strobl 2007')
      expect(passages[0]?.similarity).toBe(0.92)
    })
  })

  describe('askAcrossSources', () => {
    it('throws error if query is empty', async () => {
      await expect(askAcrossSources('  ')).rejects.toThrow('Query string cannot be empty.')
    })

    it('throws error if workspaceId is missing', async () => {
      await expect(askAcrossSources('valid query', { passages: [] })).rejects.toThrow(
        'workspaceId is required for askAcrossSources.',
      )
    })

    it('returns empty result when no passages are found', async () => {
      const result = await askAcrossSources('something irrelevant', {
        workspaceId: 'ws-empty',
        passages: [],
      })

      expect(result.answer).toContain('No relevant passages found')
      expect(result.citations).toHaveLength(0)
      expect(result.sourcesConsulted).toHaveLength(0)
    })

    it('synthesizes answer across multiple sources and validates citations with honest taskKind and strategyId: null', async () => {
      const mockModelAnswer: RetrievalAnswer = {
        answer:
          'Strobl et al. (2007) demonstrate that Gini importance is biased towards features with many categories. In response, Strobl et al. (2008) developed conditional permutation importance to eliminate spurious correlations, while Kursa & Rudnicki (2010) proposed Boruta to detect all relevant attributes by comparing against shadow features.',
        citations: [
          {
            sourceId: 'source-strobl-2007',
            sourceTitle: 'Strobl 2007',
            chunkId: 'chunk-s07-1',
            page: 1,
            quote: 'the Gini importance measure is biased toward features with more categories',
            claimSupported: 'Gini importance bias towards multi-category predictors',
          },
          {
            sourceId: 'source-strobl-2008',
            sourceTitle: 'Strobl 2008',
            chunkId: 'chunk-s08-1',
            page: 2,
            quote: 'conditional permutation importance measure that reflects the true impact',
            claimSupported: 'Conditional importance fixes correlation bias',
          },
          {
            sourceId: 'source-kursa-2010',
            sourceTitle: 'Kursa 2010',
            chunkId: 'chunk-k10-1',
            page: 3,
            quote: 'contrasts original features against shadow features created by shuffling',
            claimSupported: 'Boruta uses shadow features for all-relevant selection',
          },
          {
            sourceId: 'source-strobl-2007',
            sourceTitle: 'Strobl 2007',
            chunkId: 'chunk-s07-1',
            page: 1,
            quote: 'Fake hallucinated quote not in the paper',
            claimSupported: 'Invalid claim',
          },
        ],
      }

      let capturedContext: any = null
      const mockCallModel: CallModel = vi.fn().mockImplementation(async (_schema, _prompt, ctx) => {
        capturedContext = ctx
        return {
          output: mockModelAnswer,
          task: {
            id: 'task-ask-1',
            workspaceId: ctx.workspaceId,
            strategyId: ctx.strategyId,
            taskKind: ctx.taskKind,
            model: 'gemini-3.8-flash',
            status: 'succeeded',
            inputRef: ctx.inputRef ?? {},
            output: mockModelAnswer,
            error: null,
            promptTokens: 400,
            completionTokens: 120,
            costUsd: '0.00042',
            latencyMs: 340,
          },
          attempts: [],
        } as CallModelResult<RetrievalAnswer>
      })

      const result = await askAcrossSources(
        'How do random forest variable importance measures handle bias and correlation?',
        {
          passages: samplePassages,
          workspaceId: 'workspace-demo',
        },
        {
          callModelFn: mockCallModel,
        },
      )

      expect(mockCallModel).toHaveBeenCalledTimes(1)
      expect(capturedContext.taskKind).toBe('ask_across_sources')
      expect(capturedContext.strategyId).toBeNull() // Sanitized to null to avoid Postgres 22P02 FK error
      expect(capturedContext.inputRef.strategy).toBe('ask_across_sources')
      expect(result.question).toBe(
        'How do random forest variable importance measures handle bias and correlation?',
      )
      expect(result.answer).toContain('Strobl et al.')

      // Sources consulted deduplicated to 3 papers
      expect(result.sourcesConsulted).toHaveLength(3)
      expect(result.sourcesConsulted.map((s) => s.id)).toEqual([
        'source-strobl-2007',
        'source-strobl-2008',
        'source-kursa-2010',
      ])

      // 3 valid citations accepted across the 3 papers
      expect(result.citations).toHaveLength(3)
      expect(result.citations.map((c) => c.sourceId)).toEqual([
        'source-strobl-2007',
        'source-strobl-2008',
        'source-kursa-2010',
      ])

      // 1 hallucinated citation rejected
      expect(result.rejectedCitations).toHaveLength(1)
      expect(result.rejectedCitations[0]?.reason).toBe('quote_not_found_in_chunk')
    })

    it('rejects citations where cit.sourceId does not match passage.sourceId', async () => {
      const mismatchedCitations: RetrievalCitation[] = [
        {
          sourceId: 'source-wrong-paper', // Mismatched!
          sourceTitle: 'Wrong Paper Title',
          chunkId: 'chunk-s07-1',
          page: 99,
          quote: 'the Gini importance measure is biased toward features with more categories',
          claimSupported: 'Wrong source ID test',
        },
      ]

      const { accepted, rejected } = verifyCitationQuotes(mismatchedCitations, samplePassages)
      expect(accepted).toHaveLength(0)
      expect(rejected).toHaveLength(1)
      expect(rejected[0]?.reason).toBe('quote_not_found_in_chunk')
    })

    it('unconditionally sets sourceTitle and page from authentic passage data', async () => {
      const citationsWithBadMetadata: RetrievalCitation[] = [
        {
          sourceId: 'source-strobl-2007',
          sourceTitle: 'Hallucinated Title',
          chunkId: 'chunk-s07-1',
          page: 999, // Hallucinated page number
          quote: 'the Gini importance measure is biased toward features with more categories',
          claimSupported: 'Authentic metadata verification',
        },
      ]

      const { accepted } = verifyCitationQuotes(citationsWithBadMetadata, samplePassages)
      expect(accepted).toHaveLength(1)
      // Must take sourceTitle and page from samplePassages, NOT the model citation
      expect(accepted[0]?.sourceTitle).toBe(samplePassages[0]!.sourceTitle)
      expect(accepted[0]?.page).toBe(1)
    })
  })

  describe('Integration with real 3 demo papers (Issue #14 acceptance criteria)', () => {
    it('answers cross-paper question and verifies verbatim citations across Strobl 2007, Strobl 2008, and Kursa 2010', async () => {
      const papersDir = path.resolve(process.cwd(), 'fixtures/papers')
      const strobl2007Pdf = path.join(papersDir, 'strobl-2007.pdf')
      const strobl2008Pdf = path.join(papersDir, 'strobl-2008.pdf')
      const kursa2010Pdf = path.join(papersDir, 'kursa-2010.pdf')

      // Ensure fixtures exist
      expect(fs.existsSync(strobl2007Pdf)).toBe(true)
      expect(fs.existsSync(strobl2008Pdf)).toBe(true)
      expect(fs.existsSync(kursa2010Pdf)).toBe(true)

      // Ingest the 3 papers to get real chunks
      const strobl07 = await ingestPdf(new Uint8Array(fs.readFileSync(strobl2007Pdf)).buffer)
      const strobl08 = await ingestPdf(new Uint8Array(fs.readFileSync(strobl2008Pdf)).buffer)
      const kursa10 = await ingestPdf(new Uint8Array(fs.readFileSync(kursa2010Pdf)).buffer)

      // Pick representative real chunks from each paper
      const c07 = strobl07.chunks.find((c) =>
        c.text.toLowerCase().includes('variable importance'),
      )!
      const c08 = strobl08.chunks.find((c) =>
        c.text.toLowerCase().includes('conditional'),
      )!
      const c10 = kursa10.chunks.find((c) =>
        c.text.toLowerCase().includes('shadow'),
      )!

      expect(c07).toBeDefined()
      expect(c08).toBeDefined()
      expect(c10).toBeDefined()

      const realPassages: RetrievedPassage[] = [
        {
          chunkId: `c07-${c07.ordinal}`,
          sourceId: 'strobl-2007',
          sourceTitle: 'Strobl et al. 2007 (Hero)',
          sourceKind: 'paper',
          page: c07.page,
          ordinal: c07.ordinal,
          charStart: c07.charStart,
          charEnd: c07.charEnd,
          text: c07.text,
          similarity: 0.91,
        },
        {
          chunkId: `c08-${c08.ordinal}`,
          sourceId: 'strobl-2008',
          sourceTitle: 'Strobl et al. 2008 (Support)',
          sourceKind: 'paper',
          page: c08.page,
          ordinal: c08.ordinal,
          charStart: c08.charStart,
          charEnd: c08.charEnd,
          text: c08.text,
          similarity: 0.88,
        },
        {
          chunkId: `c10-${c10.ordinal}`,
          sourceId: 'kursa-2010',
          sourceTitle: 'Kursa & Rudnicki 2010 (Support)',
          sourceKind: 'paper',
          page: c10.page,
          ordinal: c10.ordinal,
          charStart: c10.charStart,
          charEnd: c10.charEnd,
          text: c10.text,
          similarity: 0.83,
        },
      ]

      // Extract actual substrings from the real chunk texts
      const quote07 = c07.text.slice(10, 60).trim()
      const quote08 = c08.text.slice(10, 60).trim()
      const quote10 = c10.text.slice(10, 60).trim()

      const modelSynthesis: RetrievalAnswer = {
        answer:
          'Across the three papers, variable importance is examined from multiple angles: Strobl 2007 highlights methodological bias, Strobl 2008 proposes conditional inference, and Kursa 2010 introduces Boruta.',
        citations: [
          {
            sourceId: 'strobl-2007',
            sourceTitle: 'Strobl et al. 2007 (Hero)',
            chunkId: `c07-${c07.ordinal}`,
            page: c07.page,
            quote: quote07,
            claimSupported: 'Strobl 2007 observation',
          },
          {
            sourceId: 'strobl-2008',
            sourceTitle: 'Strobl et al. 2008 (Support)',
            chunkId: `c08-${c08.ordinal}`,
            page: c08.page,
            quote: quote08,
            claimSupported: 'Strobl 2008 conditional approach',
          },
          {
            sourceId: 'kursa-2010',
            sourceTitle: 'Kursa & Rudnicki 2010 (Support)',
            chunkId: `c10-${c10.ordinal}`,
            page: c10.page,
            quote: quote10,
            claimSupported: 'Boruta shadow attribute methodology',
          },
        ],
      }

      const mockCallModel: CallModel = vi.fn().mockResolvedValue({
        output: modelSynthesis,
        task: {
          id: 'task-real-1',
          workspaceId: 'ws-demo',
          strategyId: 'ask_across_sources',
          taskKind: 'extract_claims',
          model: 'gemini-3.8-flash',
          status: 'succeeded',
          inputRef: {},
          output: modelSynthesis,
          error: null,
          promptTokens: 500,
          completionTokens: 100,
          costUsd: '0.0005',
          latencyMs: 310,
        },
        attempts: [],
      } as CallModelResult<RetrievalAnswer>)

      const res = await askAcrossSources(
        'How do feature importance methods differ across the literature?',
        {
          passages: realPassages,
          workspaceId: 'ws-demo',
        },
        {
          callModelFn: mockCallModel,
        },
      )

      expect(res.citations).toHaveLength(3)
      expect(res.rejectedCitations).toHaveLength(0)
      expect(res.sourcesConsulted).toHaveLength(3)
      expect(res.citations[0]?.verified).toBe(true)
      expect(res.citations[1]?.verified).toBe(true)
      expect(res.citations[2]?.verified).toBe(true)
    })
  })
})
