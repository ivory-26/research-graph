import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ingestPdf } from '../ingest'
import { buildExtractionPrompt, extractClaims } from './claims'
import { normalizeQuote, validateClaimQuotes, verifyVerbatimQuote } from './quote'
import type { ChunkRef, ExtractedClaim, ExtractionResult } from './types'

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
    'executes extractClaims on real Strobl 2007 chunks and extracts hero claim with verbatim quote',
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

      const targetChunk = chunkRefs.find((c) => c.text.includes(realHeroQuote))
      expect(targetChunk).toBeDefined()

      const mockModelOutput: ExtractionResult = {
        claims: [
          {
            text: 'Gini importance is unreliable when predictors vary in category count',
            metric: 'variable importance',
            reportedValue: null,
            comparator: null,
            againstValue: null,
            datasetName: null,
            methodName: 'Random Forest',
            quote: realHeroQuote,
            chunkId: targetChunk!.id!,
          },
        ],
        datasets: [],
        methods: [{ name: 'RandomForest', summary: 'Tree ensemble' }],
        codeUrls: [],
      }

      const mockCallModel = vi.fn().mockResolvedValue({
        output: mockModelOutput,
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
      expect(outcome.acceptedClaims).toHaveLength(1)
      expect(outcome.rejectedClaims).toHaveLength(0)
      expect(outcome.acceptedClaims[0].quote).toBe(realHeroQuote)
      expect(outcome.acceptedClaims[0].page).toBe(1)
    },
    15000,
  )

  it('truncates input chunks to 30,000 characters under single_pass strategy', async () => {
    // Generate chunks totalling 50,000 characters
    const chunks: ChunkRef[] = []
    for (let i = 0; i < 50; i++) {
      chunks.push({
        id: `c-${i}`,
        ordinal: i,
        text: `Chunk ${i} `.padEnd(1000, 'x'),
        page: i + 1,
      })
    }

    let capturedPrompt = ''
    const mockCallModel = vi.fn().mockImplementation((_schema, prompt) => {
      capturedPrompt = prompt
      return Promise.resolve({
        output: { claims: [], datasets: [], methods: [], codeUrls: [] },
        task: { id: 'task-strat' },
        attempts: [],
      })
    })

    await extractClaims({
      workspaceId: 'ws-strat',
      sourceId: 'src-strat',
      chunks,
      strategy: 'single_pass',
      maxChars: 30000,
      callModelFn: mockCallModel as any,
    })

    // The prompt should include at most ~30 chunks (~30k characters), not all 50
    expect(capturedPrompt).toContain('CHUNK ID: c-0')
    expect(capturedPrompt).toContain('CHUNK ID: c-29')
    expect(capturedPrompt).not.toContain('CHUNK ID: c-45')
  })
})
