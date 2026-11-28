import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ingestPdf } from '../ingest'
import { DEFAULT_META_MODEL_ID, DEFAULT_MODEL_ID, callModel, type CallModel } from '../model'
import { buildExtractionPrompt, extractClaims } from './claims'
import { normalizeQuote, validateClaimQuotes, verifyVerbatimQuote } from './quote'
import { ExtractionResultSchema, type ChunkRef, type ExtractedClaim, type ExtractionResult } from './types'

describe('Quote Normalization and Verbatim Verification (Issue #12)', () => {
  it('normalises whitespace and folds unicode quotation marks without altering dashes', () => {
    const raw = `  “Random   forests” are ‘effective’ — in \n\n many  scenarios.  `
    const normalized = normalizeQuote(raw)
    expect(normalized).toBe('"Random forests" are \'effective\' — in many scenarios.')
  })

  it('strictly rejects hyphen/em-dash substitutions (no dash folding per docs/03)', () => {
    const chunkText = 'Random forests — an ensemble method — are robust.'
    const quoteWithHyphens = 'Random forests - an ensemble method - are robust.'
    expect(verifyVerbatimQuote(quoteWithHyphens, chunkText)).toBe(false)

    // With identical em-dash, it matches verbatim
    const quoteWithEmDash = 'Random forests — an ensemble method — are robust.'
    expect(verifyVerbatimQuote(quoteWithEmDash, chunkText)).toBe(true)
  })

  it('strictly rejects case-only alterations (exact case required per docs/03)', () => {
    const chunkText = 'Random forests are an ensemble method.'
    const lowerQuote = 'random forests are an ensemble method.'
    expect(verifyVerbatimQuote(lowerQuote, chunkText)).toBe(false)
  })

  it('matches verbatim quotes despite line breaks and irregular spacing', () => {
    const chunkText = `In bioinformatics and related scientific fields, an important
task is the prediction of a categorical response variable (such as the disease status
of a patient) based on a large number of predictors.`

    const validQuote = `an important task is the prediction of a categorical response variable`
    expect(verifyVerbatimQuote(validQuote, chunkText)).toBe(true)
  })

  it('strictly rejects mangled or paraphrased quotes', () => {
    const chunkText = `We show that random forest variable importance measures are not reliable
in situations where potential predictor variables vary in their scale of measurement.`

    // Altered word: "measures are totally broken" instead of "measures are not reliable"
    const mangledQuote = `We show that random forest variable importance measures are totally broken`
    expect(verifyVerbatimQuote(mangledQuote, chunkText)).toBe(false)

    // Truncated / empty quote
    expect(verifyVerbatimQuote('', chunkText)).toBe(false)
  })
})

describe('validateClaimQuotes', () => {
  const chunks: ChunkRef[] = [
    {
      id: 'chunk-1',
      ordinal: 0,
      page: 1,
      text: `Simulation studies are presented illustrating that, when predictor variables vary in their scale of measurement or number of categories, the Gini importance measure is biased toward features with more categories.`,
    },
    {
      id: 'chunk-2',
      ordinal: 1,
      page: 2,
      text: `Permutation importance does not exhibit this bias and correctly identifies uninformative predictors.`,
    },
  ]

  it('accepts valid claims with verbatim quotes and maps page and ordinal', () => {
    const claims: ExtractedClaim[] = [
      {
        text: 'Gini importance is biased toward features with more categories',
        quote: 'the Gini importance measure is biased toward features with more categories',
        chunkId: 'chunk-1',
        metric: 'Gini importance',
        reportedValue: null,
      },
    ]

    const { accepted, rejected } = validateClaimQuotes(claims, chunks)

    expect(accepted.length).toBe(1)
    expect(rejected.length).toBe(0)
    expect(accepted[0].chunkOrdinal).toBe(0)
    expect(accepted[0].page).toBe(1)
  })

  it('rejects claims with mangled or hallucinated quotes', () => {
    const claims: ExtractedClaim[] = [
      {
        text: 'Permutation importance solves all issues',
        // Deliberately mangled quote not in chunk-2
        quote: 'Permutation importance completely eradicates all statistical defects in all models',
        chunkId: 'chunk-2',
      },
      {
        text: 'Uncited claim',
        quote: '',
        chunkId: 'chunk-1',
      },
      {
        text: 'Wrong chunk reference',
        quote: 'Some text that does not exist anywhere',
        chunkId: 'non-existent-chunk',
      },
    ]

    const { accepted, rejected } = validateClaimQuotes(claims, chunks)

    expect(accepted.length).toBe(0)
    expect(rejected.length).toBe(3)
    expect(rejected[0].reason).toBe('VERBATIM_QUOTE_NOT_FOUND')
    expect(rejected[1].reason).toBe('QUOTE_EMPTY')
    expect(rejected[2].reason).toBe('CHUNK_NOT_FOUND')
  })

  it('strictly rejects when quote exists in chunk-2 but claim cites chunk-1 (no silent rebinding)', () => {
    const claims: ExtractedClaim[] = [
      {
        text: 'Permutation importance claim',
        // Quote exists in chunk-2, but claim cites chunk-1!
        quote: 'Permutation importance does not exhibit this bias and correctly identifies uninformative predictors.',
        chunkId: 'chunk-1',
      },
    ]

    const result = validateClaimQuotes(claims, chunks)
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].reason).toBe('VERBATIM_QUOTE_NOT_FOUND')
  })

  it('rejects quotes exceeding 400 characters with QUOTE_TOO_LONG per claim without aborting sibling claims', () => {
    const overlong = 'A'.repeat(405)
    const valid = 'Random forests are robust across noise.'
    const localChunks: ChunkRef[] = [
      { id: 'c-len', ordinal: 0, page: 1, text: `${overlong} ${valid}` },
    ]
    const result = validateClaimQuotes(
      [
        { text: 'Overlong quote claim', quote: overlong, chunkId: 'c-len' },
        { text: 'Valid concise claim', quote: valid, chunkId: 'c-len' },
      ],
      localChunks,
    )
    expect(result.accepted).toHaveLength(1)
    expect(result.accepted[0]?.text).toBe('Valid concise claim')
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0]?.reason).toBe('QUOTE_TOO_LONG')
  })

  it('prefers chunk ID lookup over another chunk ordinal when ID is a decimal string', () => {
    const numericIdChunks: ChunkRef[] = [
      { id: '1', ordinal: 0, page: 1, text: 'Quote strictly in chunk with id 1.' },
      { id: 'chunk-ordinal-1', ordinal: 1, page: 2, text: 'Completely unrelated second chunk.' },
    ]

    const result = validateClaimQuotes(
      [
        {
          text: 'Exact ID match',
          quote: 'Quote strictly in chunk with id 1.',
          chunkId: '1',
        },
      ],
      numericIdChunks,
    )

    expect(result.rejected).toHaveLength(0)
    expect(result.accepted).toHaveLength(1)
    expect(result.accepted[0]?.chunkOrdinal).toBe(0)
    expect(result.accepted[0]?.page).toBe(1)
  })
})

describe('extractClaims with model wrapper', () => {
  it('processes extraction results and separates accepted from rejected claims', async () => {
    const chunks: ChunkRef[] = [
      {
        id: 'chunk-hero',
        ordinal: 0,
        page: 1,
        text: 'The random forest algorithm computes variable importance.',
      },
    ]

    const mockOutput: ExtractionResult = {
      claims: [
        {
          text: 'Valid claim',
          quote: 'The random forest algorithm computes variable importance.',
          chunkId: 'chunk-hero',
        },
        {
          text: 'Mangled claim',
          quote: 'This fabricated sentence does not exist in any chunk.',
          chunkId: 'chunk-hero',
        },
      ],
      datasets: [{ name: 'breast-w', url: 'https://openml.org' }],
      methods: [{ name: 'RandomForest', summary: 'Ensemble tree classifier' }],
      codeUrls: ['https://github.com/cran/party'],
    }

    const mockCallModel = vi.fn(async () => ({
      output: mockOutput,
      task: { id: 'task-123' },
      attempts: [],
    }))

    const outcome = await extractClaims({
      workspaceId: 'ws-1',
      sourceId: 'src-1',
      chunks,
      sourceTitle: 'Strobl 2007',
      // @ts-expect-error test mock injection
      callModelFn: mockCallModel,
    })

    expect(mockCallModel).toHaveBeenCalledTimes(1)
    expect(outcome.acceptedClaims.length).toBe(1)
    expect(outcome.acceptedClaims[0].text).toBe('Valid claim')
    expect(outcome.rejectedClaims.length).toBe(1)
    expect(outcome.rejectedClaims[0].claim.text).toBe('Mangled claim')
    expect(outcome.datasets.length).toBe(1)
    expect(outcome.methods.length).toBe(1)
    expect(outcome.codeUrls.length).toBe(1)
    expect(outcome.taskId).toBe('task-123')
  })

  it('updates task row to rejected when all proposed claims have unverifiable quotes (docs/03)', async () => {
    const chunks: ChunkRef[] = [
      { id: 'c1', ordinal: 0, text: 'Real chunk text without the fabricated quote.' },
    ]
    let updatedStatus = ''
    let updatedTaskId = ''
    const mockUpdateStatus = vi.fn(async (taskId: string, status: any) => {
      updatedTaskId = taskId
      updatedStatus = status
    })

    const mockCallModel = vi.fn(async () => ({
      output: {
        claims: [
          {
            text: 'Fabricated claim',
            quote: 'This text does not exist in any chunk',
            chunkId: 'c1',
          },
        ],
      },
      task: { id: 'task-fabricated-1', status: 'succeeded' as const },
      attempts: [],
    }))

    const outcome = await extractClaims({
      workspaceId: 'ws-test',
      sourceId: 'src-1',
      chunks,
      // @ts-expect-error test mock injection
      callModelFn: mockCallModel,
      updateTaskStatusFn: mockUpdateStatus,
    })

    expect(outcome.acceptedClaims.length).toBe(0)
    expect(outcome.rejectedClaims.length).toBe(1)
    expect(mockUpdateStatus).toHaveBeenCalledTimes(1)
    expect(updatedStatus).toBe('rejected')
    expect(updatedTaskId).toBe('task-fabricated-1')
  })

  it('updates task row to rejected when model returns zero claims (empty claim list)', async () => {
    const chunks: ChunkRef[] = [
      { id: 'c1', ordinal: 0, text: 'Real chunk text here.' },
    ]
    let updatedStatus = ''
    let updatedTaskId = ''
    const mockUpdateStatus = vi.fn(async (taskId: string, status: any) => {
      updatedTaskId = taskId
      updatedStatus = status
    })

    const mockCallModel = vi.fn(async () => ({
      output: {
        claims: [],
        datasets: [],
        methods: [],
        codeUrls: [],
      },
      task: { id: 'task-empty-1', status: 'succeeded' as const },
      attempts: [],
    }))

    const outcome = await extractClaims({
      workspaceId: 'ws-test',
      sourceId: 'src-1',
      chunks,
      // @ts-expect-error test mock injection
      callModelFn: mockCallModel,
      updateTaskStatusFn: mockUpdateStatus,
    })

    expect(outcome.acceptedClaims.length).toBe(0)
    expect(mockUpdateStatus).toHaveBeenCalledWith(
      'task-empty-1',
      'rejected',
      'Model returned no claims.',
    )
    expect(updatedStatus).toBe('rejected')
  })

  it('sanitizes non-uuid strategyId to null and preserves strategy in inputRef', async () => {
    const chunks: ChunkRef[] = [
      { id: 'c1', ordinal: 0, text: 'Real chunk text here.' },
    ]
    let capturedCallContext: any = null
    const mockCallModel = vi.fn(async (_schema, _prompt, context) => {
      capturedCallContext = context
      return {
        output: { claims: [], datasets: [], methods: [], codeUrls: [] },
        task: { id: 'task-strat-null' },
        attempts: [],
      }
    })

    await extractClaims({
      workspaceId: 'ws-test',
      sourceId: 'src-1',
      chunks,
      strategy: 'single_pass',
      strategyId: 'single_pass', // Not a uuid!
      // @ts-expect-error test mock injection
      callModelFn: mockCallModel,
      updateTaskStatusFn: vi.fn(),
    })

    expect(capturedCallContext.strategyId).toBeNull()
    expect(capturedCallContext.inputRef.strategy).toBe('single_pass')
  })

  it('throws descriptive error on unsupported strategy', async () => {
    const chunks: ChunkRef[] = [{ id: 'c1', ordinal: 0, text: 'Some text' }]
    await expect(
      extractClaims({
        workspaceId: 'ws-test',
        sourceId: 'src-1',
        chunks,
        strategy: 'unsupported_strategy' as any,
      }),
    ).rejects.toThrow(/Extraction strategy 'unsupported_strategy' is not supported/)
  })

  it('sectioned strategy locates Methods/Results headings cleanly, ignores abstract sub-labels and Method column headers, and calls model sequentially', async () => {
    const { partitionChunksBySection } = await import('./claims')
    const syntheticChunks: ChunkRef[] = [
      {
        id: 'c-abs',
        ordinal: 0,
        page: 1,
        text: 'Abstract\nBackground:\nVariable selection is subtle.\nResults:\nBias appears in Gini importance.\nConclusion:\nUse permutation importance.',
      },
      {
        id: 'c-intro',
        ordinal: 1,
        page: 2,
        text: '1 Background\nRandom forests combine classification trees.',
      },
      {
        id: 'c-methods',
        ordinal: 2,
        page: 3,
        text: '2 Methods\nWe simulated correlated and uncorrelated predictor variables.',
      },
      {
        id: 'c-results',
        ordinal: 3,
        page: 4,
        text: '3 Results\nMethod\nTable 1 compares accuracy.\nGini importance ranked the 20-category noise feature ahead of informative predictors.',
      },
      {
        id: 'c-tail',
        ordinal: 4,
        page: 5,
        text: '4 Conclusion\nUnbiased subsampling resolves variable selection bias.',
      },
    ]

    const partitioned = partitionChunksBySection(syntheticChunks)
    expect(partitioned.fallbackUsed).toBe(false)
    expect(partitioned.methodsChunks.map((c) => c.id)).toEqual(['c-methods'])
    expect(partitioned.resultsChunks.map((c) => c.id)).toEqual(['c-results'])

    const callOrder: string[] = []
    let activeRequests = 0
    let maxConcurrency = 0

    const mockCallModel = vi.fn(async (_schema: any, prompt: string, ctx: any) => {
      activeRequests++
      maxConcurrency = Math.max(maxConcurrency, activeRequests)
      await Promise.resolve()
      callOrder.push(ctx.inputRef.pass)

      const isMethods = prompt.includes('c-methods')
      activeRequests--
      return {
        output: isMethods
          ? {
              claims: [
                {
                  text: 'Simulated predictors with varying correlation structures',
                  quote: 'We simulated correlated and uncorrelated predictor variables.',
                  chunkId: 'c-methods',
                },
              ],
              datasets: [{ name: 'Simulation benchmark' }],
              methods: [{ name: 'Random Forest', summary: 'Ensemble tree classifier' }],
              codeUrls: [],
            }
          : {
              claims: [
                {
                  text: 'Gini importance favored high-cardinality noise',
                  quote:
                    'Gini importance ranked the 20-category noise feature ahead of informative predictors.',
                  chunkId: 'c-results',
                },
              ],
              datasets: [{ name: 'Simulation benchmark' }],
              methods: [{ name: 'Random Forest', summary: 'Ensemble tree classifier' }],
              codeUrls: ['https://example.com/rf-sim'],
            },
        task: { id: `task-${ctx.inputRef.pass}`, status: 'succeeded' as const },
        attempts: [],
      }
    })

    const outcome = await extractClaims({
      workspaceId: 'ws-sec',
      sourceId: 'src-sec',
      chunks: syntheticChunks,
      strategy: 'sectioned',
      strategyId: '11111111-1111-4111-8111-111111111111',
      callModelFn: mockCallModel as any,
      updateTaskStatusFn: vi.fn(),
    })

    expect(maxConcurrency).toBe(1)
    expect(callOrder).toEqual(['methods', 'results'])
    expect(outcome.acceptedClaims).toHaveLength(2)
    expect(outcome.datasets).toHaveLength(1)
    expect(outcome.methods).toHaveLength(1)
    expect(outcome.codeUrls).toEqual(['https://example.com/rf-sim'])
    expect(outcome.taskIds).toEqual(['task-methods', 'task-results'])
  })

  it('sectioned strategy marks only the empty/rejected section pass task row as rejected without discarding other section claims', async () => {
    const chunks: ChunkRef[] = [
      { id: 'c-m', ordinal: 0, page: 2, text: 'Methods\nSubsampling without replacement keeps scale invariance.' },
      { id: 'c-r', ordinal: 1, page: 4, text: 'Results\nPermutation importance stayed calibrated across predictors.' },
    ]
    const rejectedCalls: Array<{ taskId: string; status: string }> = []

    const mockCallModel = vi.fn(async (_schema: any, _prompt: string, ctx: any) => {
      const isMethods = ctx.inputRef.pass === 'methods'
      return {
        output: {
          claims: isMethods
            ? [
                {
                  text: 'Subsampling without replacement preserves balance',
                  quote: 'Subsampling without replacement keeps scale invariance.',
                  chunkId: 'c-m',
                },
              ]
            : [
                {
                  text: 'Hallucinated result claim',
                  quote: 'Completely fabricated result quote not present in chunk.',
                  chunkId: 'c-r',
                },
              ],
          datasets: [],
          methods: [],
          codeUrls: [],
        },
        task: { id: `task-${ctx.inputRef.pass}`, status: 'succeeded' as const },
        attempts: [],
      }
    })

    const outcome = await extractClaims({
      workspaceId: 'ws-sec-partial',
      sourceId: 'src-sec-partial',
      chunks,
      strategy: 'sectioned',
      callModelFn: mockCallModel as any,
      updateTaskStatusFn: async (taskId, status) => {
        rejectedCalls.push({ taskId, status })
      },
    })

    expect(outcome.acceptedClaims).toHaveLength(1)
    expect(outcome.rejectedClaims).toHaveLength(1)
    expect(rejectedCalls).toEqual([{ taskId: 'task-results', status: 'rejected' }])
  })

  it('sectioned strategy falls back to balanced sequential halves when explicit Methods/Results headings are absent', async () => {
    const chunks: ChunkRef[] = [
      { id: 'c-0', ordinal: 0, page: 1, text: '1. Overview\nBoruta uses shadow variables.' },
      { id: 'c-1', ordinal: 1, page: 2, text: '2. Evaluation\nShadow attributes detect noise cleanly.' },
    ]
    const seenPasses: any[] = []
    const mockCallModel = vi.fn(async (_s: any, _p: string, ctx: any) => {
      seenPasses.push(ctx.inputRef)
      return {
        output: {
          claims: [
            {
              text: ctx.inputRef.pass === 'section_part_1' ? 'Boruta overview' : 'Shadow evaluation',
              quote:
                ctx.inputRef.pass === 'section_part_1'
                  ? 'Boruta uses shadow variables.'
                  : 'Shadow attributes detect noise cleanly.',
              chunkId: ctx.inputRef.pass === 'section_part_1' ? 'c-0' : 'c-1',
            },
          ],
          datasets: [],
          methods: [],
          codeUrls: [],
        },
        task: { id: `task-${ctx.inputRef.pass}` },
        attempts: [],
      }
    })

    const outcome = await extractClaims({
      workspaceId: 'ws-fallback',
      sourceId: 'src-fallback',
      chunks,
      strategy: 'sectioned',
      callModelFn: mockCallModel as any,
      updateTaskStatusFn: vi.fn(),
    })

    expect(seenPasses.map((p) => p.pass)).toEqual(['section_part_1', 'section_part_2'])
    expect(seenPasses.every((p) => p.sectionFallback === true)).toBe(true)
    expect(outcome.acceptedClaims).toHaveLength(2)
  })

  it('sectioned strategy falls back on uncovered chunks when only one section heading is present', async () => {
    const chunks: ChunkRef[] = [
      { id: 'c-intro', ordinal: 0, page: 1, text: 'Background\nPermutation tests avoid bias.' },
      { id: 'c-m', ordinal: 1, page: 2, text: 'Methods\nWe evaluated 100 trees.' },
      { id: 'c-discussion', ordinal: 2, page: 3, text: 'Discussion\nBias disappears under subsampling.' },
    ]
    const seenPasses: any[] = []
    const mockCallModel = vi.fn(async (_s: any, prompt: string, ctx: any) => {
      seenPasses.push({ ...ctx.inputRef, prompt })
      return {
        output: {
          claims: [
            ctx.inputRef.pass === 'methods'
              ? { text: '100 trees evaluated', quote: 'We evaluated 100 trees.', chunkId: 'c-m' }
              : { text: 'Subsampling eliminates bias', quote: 'Bias disappears under subsampling.', chunkId: 'c-discussion' },
          ],
          datasets: [],
          methods: [],
          codeUrls: [],
        },
        task: { id: `task-${ctx.inputRef.pass}` },
        attempts: [],
      }
    })

    const outcome = await extractClaims({
      workspaceId: 'ws-partial-sec',
      sourceId: 'src-partial-sec',
      chunks,
      strategy: 'sectioned',
      callModelFn: mockCallModel as any,
      updateTaskStatusFn: vi.fn(),
    })

    expect(seenPasses.map((p) => p.pass)).toEqual(['methods', 'complement_fallback'])
    expect(seenPasses[1]?.sectionFallback).toBe(true)
    expect(seenPasses[1]?.prompt).toContain('c-intro')
    expect(seenPasses[1]?.prompt).toContain('c-discussion')
    expect(outcome.acceptedClaims).toHaveLength(2)
  })

  it('table_first strategy partitions Markdown/numeric/captioned tables ahead of prose body and runs sequentially', async () => {
    const { isTableChunk, partitionChunksTableFirst } = await import('./claims')

    const chunks: ChunkRef[] = [
      { id: 'c-prose-1', ordinal: 0, page: 1, text: 'Random forests generalize across classification tasks.' },
      {
        id: 'c-table-md',
        ordinal: 1,
        page: 2,
        text: '| Predictor | Importance |\n|---|---|\n| Noise_20 | 0.42 |',
      },
      {
        id: 'c-table-cap',
        ordinal: 2,
        page: 3,
        text: 'Table 1: Mean misclassification rates\nGini 0.18 0.24 0.31',
      },
      { id: 'c-prose-2', ordinal: 3, page: 4, text: 'Conditional permutation reduces bias across correlated predictors.' },
    ]

    expect(isTableChunk(chunks[0]!.text)).toBe(false)
    expect(isTableChunk(chunks[1]!.text)).toBe(true)
    expect(isTableChunk(chunks[2]!.text)).toBe(true)
    expect(isTableChunk(chunks[3]!.text)).toBe(false)

    const { tableChunks, otherChunks } = partitionChunksTableFirst(chunks)
    expect(tableChunks.map((c) => c.id)).toEqual(['c-table-md', 'c-table-cap'])
    expect(otherChunks.map((c) => c.id)).toEqual(['c-prose-1', 'c-prose-2'])

    const passOrder: string[] = []
    let inFlight = 0
    let maxInFlight = 0

    const mockCallModel = vi.fn(async (_s: any, prompt: string, ctx: any) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      passOrder.push(ctx.inputRef.pass)

      const isTablePass = ctx.inputRef.pass === 'tables'
      if (isTablePass) {
        expect(prompt).toContain('c-table-md')
        expect(prompt).not.toContain('c-prose-1')
      } else {
        expect(prompt).toContain('c-prose-1')
        expect(prompt).not.toContain('c-table-md')
      }
      inFlight--

      return {
        output: {
          claims: [
            isTablePass
              ? {
                  text: 'Noise_20 scored 0.42 Gini importance in Table',
                  metric: 'Gini importance',
                  reportedValue: 0.42,
                  quote: '| Noise_20 | 0.42 |',
                  chunkId: 'c-table-md',
                }
              : {
                  text: 'Conditional permutation lowers bias',
                  quote: 'Conditional permutation reduces bias across correlated predictors.',
                  chunkId: 'c-prose-2',
                },
          ],
          datasets: [],
          methods: [],
          codeUrls: [],
        },
        task: { id: `task-${ctx.inputRef.pass}` },
        attempts: [],
      }
    })

    const outcome = await extractClaims({
      workspaceId: 'ws-table',
      sourceId: 'src-table',
      chunks,
      strategy: 'table_first',
      maxChars: 10_000,
      callModelFn: mockCallModel as any,
      updateTaskStatusFn: vi.fn(),
    })

    expect(maxInFlight).toBe(1)
    expect(passOrder).toEqual(['tables', 'body'])
    expect(outcome.acceptedClaims).toHaveLength(2)
    expect(outcome.acceptedClaims[0]?.reportedValue).toBe(0.42)
  })

  it.skipIf(!fs.existsSync(path.resolve(process.cwd(), 'fixtures/papers/strobl-2007.pdf')))(
    'partitions real Strobl 2007 and Strobl 2008 PDFs accurately for sectioned and table_first strategies',
    async () => {
      const { partitionChunksBySection, partitionChunksTableFirst } = await import('./claims')
      const strobl07 = await ingestPdf(
        fs.readFileSync(path.resolve(process.cwd(), 'fixtures/papers/strobl-2007.pdf')),
      )
      const strobl08 = await ingestPdf(
        fs.readFileSync(path.resolve(process.cwd(), 'fixtures/papers/strobl-2008.pdf')),
      )

      const refs07: ChunkRef[] = strobl07.chunks.map((c) => ({
        id: `s07-${c.ordinal}`,
        ordinal: c.ordinal,
        page: c.page,
        text: c.text,
      }))
      const refs08: ChunkRef[] = strobl08.chunks.map((c) => ({
        id: `s08-${c.ordinal}`,
        ordinal: c.ordinal,
        page: c.page,
        text: c.text,
      }))

      const sec07 = partitionChunksBySection(refs07)
      expect(sec07.fallbackUsed).toBe(false)
      expect(sec07.methodsChunks.length).toBeGreaterThanOrEqual(1)
      expect(sec07.resultsChunks.length).toBeGreaterThanOrEqual(1)
      // Abstract on page 1 must never pull Page 1 into Results section
      expect(sec07.resultsChunks[0]?.page).toBeGreaterThanOrEqual(4)

      const sec08 = partitionChunksBySection(refs08)
      expect(sec08.fallbackUsed).toBe(false)
      expect(sec08.methodsChunks.some((c) => c.page === 3 || c.page === 4)).toBe(true)
      expect(sec08.resultsChunks.some((c) => (c.page ?? 0) >= 8)).toBe(true)

      const tbl07 = partitionChunksTableFirst(refs07)
      expect(tbl07.tableChunks.length).toBeGreaterThanOrEqual(1)
      expect(tbl07.otherChunks.length).toBeGreaterThanOrEqual(1)
      expect(tbl07.tableChunks.some((c) => /\bTable\s+\d+\b/i.test(c.text))).toBe(true)
    },
  )

  it('buildExtractionPrompt formats chunks cleanly', () => {
    const prompt = buildExtractionPrompt(
      [
        { id: 'c-1', ordinal: 0, page: 3, text: 'Sample chunk content.' },
      ],
      'Paper Title',
    )
    expect(prompt).toContain('Document: Paper Title')
    expect(prompt).toContain('--- CHUNK ID: c-1 (Page 3) ---')
    expect(prompt).toContain('Sample chunk content.')
    expect(prompt).toContain('CRITICAL REQUIREMENT')
  })
})

describe('Integration test with real Strobl 2007 paper text (Issue #12 acceptance criteria)', () => {
  const stroblPdfPath = path.resolve(process.cwd(), 'fixtures/papers/strobl-2007.pdf')

  it.skipIf(!fs.existsSync(stroblPdfPath))(
    'validates Strobl hero claim quote exactly and rejects a deliberately mangled quote',
    async () => {
      const buffer = fs.readFileSync(stroblPdfPath)
      const { chunks } = await ingestPdf(buffer)

      // The exact hero claim quote from Page 1 abstract of Strobl 2007:
      const realHeroQuote =
        'random forest variable importance measures are a sensible means for variable selection in many applications, but are not reliable in situations where potential predictor variables vary in their scale of measurement or their number of categories.'

      const mangledHeroQuote =
        'random forest variable importance measures are completely defective and always fail on every dataset.'

      // Find the chunk containing the hero quote
      const chunkRefs: ChunkRef[] = chunks.map((c) => ({
        id: `chunk-${c.ordinal}`,
        ordinal: c.ordinal,
        text: c.text,
        page: c.page,
      }))

      const targetChunk = chunkRefs.find((c) => verifyVerbatimQuote(realHeroQuote, c.text))
      expect(targetChunk).toBeDefined()
      expect(targetChunk?.page).toBe(1)

      const claimsToValidate: ExtractedClaim[] = [
        {
          text: 'Hero Claim: Gini importance is unreliable when predictors vary in scale or category count',
          quote: realHeroQuote,
          chunkId: targetChunk!.id!,
          metric: 'variable importance',
          reportedValue: null,
          comparator: null,
          againstValue: null,
        },
        {
          text: 'Mangled Claim: RF always fails',
          quote: mangledHeroQuote,
          chunkId: targetChunk!.id!,
        },
      ]

      const { accepted, rejected } = validateClaimQuotes(claimsToValidate, chunkRefs)

      // 1. The Strobl hero claim matches the PDF text exactly
      expect(accepted.length).toBe(1)
      expect(accepted[0].text).toContain('Hero Claim')
      expect(accepted[0].page).toBe(1)

      // 2. The deliberately mangled quote is rejected
      expect(rejected.length).toBe(1)
      expect(rejected[0].claim.text).toContain('Mangled Claim')
      expect(rejected[0].reason).toBe('VERBATIM_QUOTE_NOT_FOUND')
    },
    15000,
  )

  it.skipIf(!fs.existsSync(stroblPdfPath))(
    'executes extractClaims on real Strobl 2007 chunks using checked-in model output fixture and extracts hero claim with verbatim quote',
    async () => {
      const buffer = fs.readFileSync(stroblPdfPath)
      const { chunks } = await ingestPdf(buffer)

      const realHeroQuote =
        'random forest variable importance measures are a sensible means for variable selection in many applications, but are not reliable in situations where potential predictor variables vary in their scale of measurement or their number of categories.'

      const chunkRefs: ChunkRef[] = chunks.map((c) => ({
        id: `chunk-${c.ordinal}`,
        ordinal: c.ordinal,
        text: c.text,
        page: c.page,
      }))

      // Load checked-in fixture of hand-authored model output schema for Strobl 2007 hero claim quote verification
      const fixturePath = path.resolve(process.cwd(), 'fixtures/extract/strobl-2007-claims.json')
      const rawFixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
      const capturedModelOutput: ExtractionResult = ExtractionResultSchema.parse(rawFixture)

      const mockCallModel = vi.fn().mockResolvedValue({
        output: capturedModelOutput,
        task: { id: 'task-hero-extract', latencyMs: 250 },
        attempts: [],
      })

      const outcome = await extractClaims({
        workspaceId: 'ws-extract-test',
        sourceId: 'strobl-2007',
        chunks: chunkRefs,
        strategy: 'single_pass',
        callModelFn: mockCallModel as any,
      })

      expect(mockCallModel).toHaveBeenCalledTimes(1)
      expect(outcome.acceptedClaims.length).toBeGreaterThanOrEqual(1)

      const heroClaim = outcome.acceptedClaims.find((c) => c.quote.includes('random forest variable importance measures'))
      expect(heroClaim).toBeDefined()
      expect(heroClaim!.quote).toBe(realHeroQuote)
      expect(heroClaim!.page).toBe(1)

      // Invariant: verifyVerbatimQuote is true against the real Strobl 2007 chunk it cites
      const citedChunk = chunkRefs.find((c) => c.ordinal === heroClaim!.chunkOrdinal)
      expect(citedChunk).toBeDefined()
      expect(verifyVerbatimQuote(heroClaim!.quote, citedChunk!.text)).toBe(true)
    },
    15000,
  )

  const hasGeminiKey = Boolean(
    process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  )
  const hasMetaKey = Boolean(process.env.META_API_KEY)
  const hasDb = Boolean(process.env.DATABASE_URL)

  async function runLiveStroblExtraction(pinnedModelId: string) {
    const { getDb } = await import('../../db/client')
    const { agentTasks, sources, workspaces } = await import('../../db/schema')
    const { eq } = await import('drizzle-orm')

    const db = getDb()
    const testWsId = crypto.randomUUID()
    const testSourceId = crypto.randomUUID()
    const pinnedCallModel: CallModel = (schema, prompt, ctx) =>
      callModel(schema, prompt, { ...ctx, modelId: pinnedModelId })

    try {
      await db.insert(workspaces).values({
        id: testWsId,
        name: 'Extract Live Test Workspace',
        slug: `test-ws-extract-${Date.now()}`,
      })

      await db.insert(sources).values({
        id: testSourceId,
        workspaceId: testWsId,
        kind: 'paper',
        title: 'Strobl 2007 Paper',
        sha256: 'test-extract-sha',
        bytes: 1024,
      })

      const buffer = fs.readFileSync(stroblPdfPath)
      const { chunks } = await ingestPdf(buffer)
      const chunkRefs: ChunkRef[] = chunks.map((c) => ({
        id: `chunk-${c.ordinal}`,
        ordinal: c.ordinal,
        text: c.text,
        page: c.page,
      }))

      const outcome = await extractClaims({
        workspaceId: testWsId,
        sourceId: testSourceId,
        chunks: chunkRefs,
        strategy: 'single_pass',
        callModelFn: pinnedCallModel,
      })

      expect(outcome.acceptedClaims.length).toBeGreaterThanOrEqual(1)
      const hero = outcome.acceptedClaims.find(
        (c) =>
          c.text.toLowerCase().includes('importance') ||
          c.quote.toLowerCase().includes('importance'),
      )
      expect(hero).toBeDefined()
      const cited = chunkRefs.find((c) => c.ordinal === hero!.chunkOrdinal)
      expect(cited).toBeDefined()
      expect(verifyVerbatimQuote(hero!.quote, cited!.text)).toBe(true)
    } finally {
      await db.delete(agentTasks).where(eq(agentTasks.workspaceId, testWsId)).catch(() => {})
      await db.delete(sources).where(eq(sources.id, testSourceId)).catch(() => {})
      await db.delete(workspaces).where(eq(workspaces.id, testWsId)).catch(() => {})
    }
  }

  const canRunLiveGemini = hasGeminiKey && hasDb && fs.existsSync(stroblPdfPath)
  it.skipIf(!canRunLiveGemini)(
    'LIVE: executes extractClaims with real Gemini model on Strobl 2007 and extracts hero claim',
    async () => runLiveStroblExtraction(DEFAULT_MODEL_ID),
    60000,
  )

  const canRunLiveMeta = hasMetaKey && hasDb && fs.existsSync(stroblPdfPath)
  it.skipIf(!canRunLiveMeta)(
    'LIVE META: executes extractClaims with muse-spark-1.3-contributor on Strobl 2007 and extracts hero claim',
    async () => runLiveStroblExtraction(DEFAULT_META_MODEL_ID),
    60000,
  )

  it('truncates input chunks strictly at character level under single_pass strategy', async () => {
    // 1. Test with one oversized first chunk that exceeds maxChars
    const oversizedFirstChunk: ChunkRef[] = [
      { id: 'c-giant', ordinal: 0, text: 'Z'.repeat(2000), page: 1 },
      { id: 'c-next', ordinal: 1, text: 'W'.repeat(100), page: 1 },
    ]

    let giantCapturedPrompt = ''
    const mockGiantCallModel = vi.fn().mockImplementation((_schema, prompt) => {
      giantCapturedPrompt = prompt
      return Promise.resolve({
        output: { claims: [], datasets: [], methods: [], codeUrls: [] },
        task: { id: 'task-giant' },
        attempts: [],
      })
    })

    await extractClaims({
      workspaceId: 'ws-giant',
      sourceId: 'src-giant',
      chunks: oversizedFirstChunk,
      strategy: 'single_pass',
      maxChars: 500, // Budget 500: c-giant must be truncated to exactly 500 chars, c-next excluded
      callModelFn: mockGiantCallModel as any,
      updateTaskStatusFn: vi.fn(),
    })

    expect(giantCapturedPrompt).toContain('CHUNK ID: c-giant')
    expect(giantCapturedPrompt).toContain('Z'.repeat(500))
    expect(giantCapturedPrompt).not.toContain('Z'.repeat(501))
    expect(giantCapturedPrompt).not.toContain('CHUNK ID: c-next')

    // 2. Test with fitting first chunk and partially fitting last chunk
    const mixedChunks: ChunkRef[] = [
      { id: 'c-0', ordinal: 0, text: 'A'.repeat(500), page: 1 },
      { id: 'c-1', ordinal: 1, text: 'B'.repeat(800), page: 1 },
      { id: 'c-2', ordinal: 2, text: 'C'.repeat(1000), page: 1 },
    ]

    let mixedCapturedPrompt = ''
    const mockMixedCallModel = vi.fn().mockImplementation((_schema, prompt) => {
      mixedCapturedPrompt = prompt
      return Promise.resolve({
        output: { claims: [], datasets: [], methods: [], codeUrls: [] },
        task: { id: 'task-mixed' },
        attempts: [],
      })
    })

    await extractClaims({
      workspaceId: 'ws-mixed',
      sourceId: 'src-mixed',
      chunks: mixedChunks,
      strategy: 'single_pass',
      maxChars: 1000, // Budget 1000: c-0 takes 500, c-1 takes 500, c-2 excluded
      callModelFn: mockMixedCallModel as any,
      updateTaskStatusFn: vi.fn(),
    })

    expect(mixedCapturedPrompt).toContain('CHUNK ID: c-0')
    expect(mixedCapturedPrompt).toContain('CHUNK ID: c-1')
    expect(mixedCapturedPrompt).toContain('B'.repeat(500))
    expect(mixedCapturedPrompt).not.toContain('B'.repeat(501))
    expect(mixedCapturedPrompt).not.toContain('CHUNK ID: c-2')
  })
})

describe('extraction run attribution', () => {
  const chunks: ChunkRef[] = [
    { id: 'c-attribution-1', ordinal: 0, page: 1, text: 'The first passage states a testable claim.' },
    { id: 'c-attribution-2', ordinal: 1, page: 2, text: 'The second passage reports a result.' },
  ]

  function capturingCallModel() {
    const contexts: Array<Record<string, any>> = []
    const callModelFn = vi.fn(async (_schema, _prompt, ctx) => {
      contexts.push(ctx)
      return {
        output: { claims: [], datasets: [], methods: [], codeUrls: [] },
        task: { id: `task-${contexts.length}` },
        attempts: [],
      }
    })
    return { callModelFn, contexts }
  }

  it('writes the same stable run id and label on every pass of one batch', async () => {
    const { callModelFn, contexts } = capturingCallModel()

    await extractClaims({
      workspaceId: 'ws-attribution',
      sourceId: 'src-attribution',
      chunks,
      strategy: 'sectioned',
      runId: 'extract:strobl-2007:sectioned',
      runLabel: 'Strobl 2007 · sectioned',
      callModelFn: callModelFn as any,
      updateTaskStatusFn: vi.fn(),
    })

    expect(contexts).toHaveLength(2)
    for (const ctx of contexts) {
      expect(ctx.inputRef.extractionRunId).toBe('extract:strobl-2007:sectioned')
      expect(ctx.inputRef.extractionRunLabel).toBe('Strobl 2007 · sectioned')
      expect(ctx.inputRef.strategy).toBe('sectioned')
    }
    expect(contexts.map((ctx) => ctx.inputRef.pass)).toEqual([
      'section_part_1',
      'section_part_2',
    ])
  })

  it('omits run fields when the caller has not adopted attribution', async () => {
    const { callModelFn, contexts } = capturingCallModel()

    await extractClaims({
      workspaceId: 'ws-legacy',
      sourceId: 'src-legacy',
      chunks,
      strategy: 'single_pass',
      callModelFn: callModelFn as any,
      updateTaskStatusFn: vi.fn(),
    })

    expect(contexts).toHaveLength(1)
    expect(contexts[0]!.inputRef).not.toHaveProperty('extractionRunId')
    expect(contexts[0]!.inputRef).not.toHaveProperty('extractionRunLabel')
  })

  it('passes the injected task store through to the call wrapper', async () => {
    const { callModelFn, contexts } = capturingCallModel()
    const taskStore = { insert: vi.fn() }

    await extractClaims({
      workspaceId: 'ws-store',
      sourceId: 'src-store',
      chunks,
      strategy: 'single_pass',
      runId: 'extract:test:single_pass',
      callModelFn: callModelFn as any,
      updateTaskStatusFn: vi.fn(),
      taskStore: taskStore as any,
    })

    expect(contexts[0]!.store).toBe(taskStore)
  })
})
