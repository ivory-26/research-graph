import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ingestPdf } from '../ingest'
import { buildProposeEdgesPrompt, proposeEdges, storeEdges, validateProposedEdges } from './edges'
import { verifyVerbatimQuote } from './quote'
import type { Database } from '../../db/client'
import {
  ProposeEdgesResultSchema,
  type ChunkRef,
  type NodeSummary,
  type ProposedEdge,
  type ProposeEdgesResult,
  type ValidatedEdge,
} from './types'

const CHUNK_UUID_1 = '11111111-1111-4111-8111-111111111111'
const CHUNK_UUID_2 = '22222222-2222-4222-8222-222222222222'

describe('Edge Validation Invariants (Issue #13)', () => {
  const nodes: NodeSummary[] = [
    { id: 'node-claim-1', type: 'claim', title: 'Gini Importance Bias' },
    { id: 'node-method-1', type: 'method', title: 'Random Forest' },
    { id: 'node-claim-2', type: 'claim', title: 'Permutation Importance Fix' },
  ]

  const chunks: ChunkRef[] = [
    {
      id: CHUNK_UUID_1,
      ordinal: 0,
      page: 2,
      text: 'Random forests are an ensemble learning method using tree predictors.',
    },
    {
      id: CHUNK_UUID_2,
      ordinal: 1,
      page: 5,
      text: 'Permutation importance measures variable importance by permuting out-of-bag samples.',
    },
  ]

  it('rejects self-loops matching edges_no_self_loop database constraint', () => {
    const proposed: ProposedEdge[] = [
      {
        fromNodeId: 'node-claim-1',
        toNodeId: 'node-claim-1', // Self-loop
        relation: 'supports',
        confidence: 0.9,
        evidenceChunkId: CHUNK_UUID_1,
        quote: 'Random forests are an ensemble learning method',
        rationale: 'Self-referencing',
      },
    ]

    const { accepted, rejected } = validateProposedEdges(proposed, nodes, chunks)
    expect(accepted.length).toBe(0)
    expect(rejected.length).toBe(1)
    expect(rejected[0].reason).toBe('SELF_LOOP')
  })

  it('rejects edges pointing to non-existent nodes', () => {
    const proposed: ProposedEdge[] = [
      {
        fromNodeId: 'node-claim-1',
        toNodeId: 'non-existent-node',
        relation: 'supports',
        confidence: 0.9,
        evidenceChunkId: CHUNK_UUID_1,
        quote: 'Random forests are an ensemble learning method',
        rationale: 'Bad target',
      },
    ]

    const { accepted, rejected } = validateProposedEdges(proposed, nodes, chunks)
    expect(accepted.length).toBe(0)
    expect(rejected[0].reason).toBe('INVALID_NODE')
  })

  it('rejects edge when rationale is empty or blank', () => {
    const proposed: ProposedEdge[] = [
      {
        fromNodeId: 'node-claim-1',
        toNodeId: 'node-method-1',
        relation: 'supports',
        confidence: 0.9,
        evidenceChunkId: CHUNK_UUID_1,
        quote: 'Random forests are an ensemble learning method',
        rationale: '   ',
      },
    ]

    const { accepted, rejected } = validateProposedEdges(proposed, nodes, chunks)
    expect(accepted.length).toBe(0)
    expect(rejected[0].reason).toBe('RATIONALE_EMPTY')
  })

  it('rejects edges with mangled quotes matching edges_have_evidence constraint', () => {
    const proposed: ProposedEdge[] = [
      {
        fromNodeId: 'node-claim-1',
        toNodeId: 'node-method-1',
        relation: 'tests',
        confidence: 0.9,
        evidenceChunkId: CHUNK_UUID_1,
        quote: 'Random forests are completely useless and invalid', // Mangled quote
        rationale: 'False citation',
      },
    ]

    const { accepted, rejected } = validateProposedEdges(proposed, nodes, chunks)
    expect(accepted.length).toBe(0)
    expect(rejected[0].reason).toBe('VERBATIM_QUOTE_NOT_FOUND')
  })

  it('rejects edge when quote exists in chunk-2 but edge cites chunk-1 without silent fallback', () => {
    const proposed: ProposedEdge[] = [
      {
        fromNodeId: 'node-claim-1',
        toNodeId: 'node-method-1',
        relation: 'supports',
        confidence: 0.9,
        evidenceChunkId: CHUNK_UUID_1, // Citing chunk-1
        quote: 'Permutation importance measures variable importance by permuting out-of-bag samples.', // Exists only in chunk-2!
        rationale: 'Wrong chunk cited',
      },
    ]

    const { accepted, rejected } = validateProposedEdges(proposed, nodes, chunks)
    expect(accepted.length).toBe(0)
    expect(rejected.length).toBe(1)
    expect(rejected[0].reason).toBe('VERBATIM_QUOTE_NOT_FOUND')
  })

  it('rejects edge citing non-existent chunk ID', () => {
    const proposed: ProposedEdge[] = [
      {
        fromNodeId: 'node-claim-1',
        toNodeId: 'node-method-1',
        relation: 'supports',
        confidence: 0.9,
        evidenceChunkId: '99999999-9999-4999-8999-999999999999', // Does not exist
        quote: 'Random forests are an ensemble learning method',
        rationale: 'Missing chunk',
      },
    ]

    const { accepted, rejected } = validateProposedEdges(proposed, nodes, chunks)
    expect(accepted.length).toBe(0)
    expect(rejected.length).toBe(1)
    expect(rejected[0].reason).toBe('CHUNK_NOT_FOUND')
  })

  it('rejects edge citing non-UUID chunk ID to avoid Postgres 22P02 syntax error', () => {
    const proposed: ProposedEdge[] = [
      {
        fromNodeId: 'node-claim-1',
        toNodeId: 'node-method-1',
        relation: 'supports',
        confidence: 0.9,
        evidenceChunkId: 'non-uuid-string',
        quote: 'Random forests are an ensemble learning method',
        rationale: 'Non-UUID ID',
      },
    ]

    const nonUuidChunks: ChunkRef[] = [
      { id: 'non-uuid-string', ordinal: 0, text: 'Random forests are an ensemble learning method' },
    ]

    const { accepted, rejected } = validateProposedEdges(proposed, nodes, nonUuidChunks)
    expect(accepted.length).toBe(0)
    expect(rejected.length).toBe(1)
    expect(rejected[0].reason).toBe('CHUNK_NOT_FOUND')
  })

  it('rejects bare ordinal alias without UUID to prevent cross-source ordinal collisions', () => {
    const proposed: ProposedEdge[] = [
      {
        fromNodeId: 'node-claim-1',
        toNodeId: 'node-method-1',
        relation: 'supports',
        confidence: 0.9,
        evidenceChunkId: '0', // Bare ordinal alias
        quote: 'Random forests are an ensemble learning method',
        rationale: 'Bare ordinal',
      },
    ]

    const { accepted, rejected } = validateProposedEdges(proposed, nodes, chunks)
    expect(accepted.length).toBe(0)
    expect(rejected.length).toBe(1)
    expect(rejected[0].reason).toBe('CHUNK_NOT_FOUND')
  })

  it('strictly rejects edge quote with case-only differences (exact casing required)', () => {
    const proposed: ProposedEdge[] = [
      {
        fromNodeId: 'node-claim-1',
        toNodeId: 'node-method-1',
        relation: 'supports',
        confidence: 0.9,
        evidenceChunkId: CHUNK_UUID_1,
        // Lowercase "random forests" vs capitalized "Random forests" in chunk
        quote: 'random forests are an ensemble learning method using tree predictors.',
        rationale: 'Case mismatch',
      },
    ]

    const { accepted, rejected } = validateProposedEdges(proposed, nodes, chunks)
    expect(accepted.length).toBe(0)
    expect(rejected.length).toBe(1)
    expect(rejected[0].reason).toBe('VERBATIM_QUOTE_NOT_FOUND')
  })

  it('assigns status=suggested when confidence < 0.65', () => {
    const proposed: ProposedEdge[] = [
      {
        fromNodeId: 'node-claim-1',
        toNodeId: 'node-method-1',
        relation: 'tests',
        confidence: 0.55, // < 0.65 threshold
        evidenceChunkId: CHUNK_UUID_1,
        quote: 'Random forests are an ensemble learning method using tree predictors.',
        rationale: 'Moderate confidence',
      },
    ]

    const { accepted, rejected } = validateProposedEdges(proposed, nodes, chunks)
    expect(rejected.length).toBe(0)
    expect(accepted.length).toBe(1)
    expect(accepted[0].status).toBe('suggested')
  })

  it('assigns status=accepted when confidence >= 0.65 for non-contradicting relations', () => {
    const proposed: ProposedEdge[] = [
      {
        fromNodeId: 'node-claim-2',
        toNodeId: 'node-method-1',
        relation: 'derived_from',
        confidence: 0.85,
        evidenceChunkId: CHUNK_UUID_2,
        quote: 'Permutation importance measures variable importance by permuting out-of-bag samples.',
        rationale: 'High confidence derivation',
      },
    ]

    const { accepted, rejected } = validateProposedEdges(proposed, nodes, chunks)
    expect(rejected.length).toBe(0)
    expect(accepted.length).toBe(1)
    expect(accepted[0].status).toBe('accepted')
  })

  it('forces contradicts relation to land as suggested regardless of high confidence', () => {
    const proposed: ProposedEdge[] = [
      {
        fromNodeId: 'node-claim-2',
        toNodeId: 'node-claim-1',
        relation: 'contradicts',
        confidence: 0.99, // Extremely high confidence
        evidenceChunkId: CHUNK_UUID_2,
        quote: 'Permutation importance measures variable importance by permuting out-of-bag samples.',
        rationale: 'Disagreement asserted',
      },
    ]

    const { accepted, rejected } = validateProposedEdges(proposed, nodes, chunks)
    expect(rejected.length).toBe(0)
    expect(accepted.length).toBe(1)
    // Invariant: machine never automatically accepts contradiction without human agreement
    expect(accepted[0].status).toBe('suggested')
  })
})

describe('proposeEdges runner and prompt builder', () => {
  it('buildProposeEdgesPrompt includes all nodes and chunk text', () => {
    const prompt = buildProposeEdgesPrompt(
      [{ id: 'n1', type: 'claim', title: 'Claim Title', summary: 'Summary text' }],
      [{ id: 'c1', ordinal: 0, text: 'Chunk body text', page: 3 }],
    )

    expect(prompt).toContain('[ID: n1] (claim) Claim Title: Summary text')
    expect(prompt).toContain('--- CHUNK ID: c1 (Page 3) ---')
    expect(prompt).toContain('Chunk body text')
    expect(prompt).toContain('No self-loops')
  })

  it('caps evidence chunks in prompt to topKChunks', () => {
    const manyChunks: ChunkRef[] = Array.from({ length: 15 }, (_, i) => ({
      id: `chunk-${i}`,
      ordinal: i,
      text: `Evidence text for chunk ${i}`,
      page: i + 1,
    }))

    const prompt = buildProposeEdgesPrompt(
      [{ id: 'n1', type: 'claim', title: 'Claim Title' }],
      manyChunks,
      { topKChunks: 5 },
    )
    expect(prompt).toContain('CHUNK ID: chunk-0')
    expect(prompt).toContain('CHUNK ID: chunk-4')
    expect(prompt).not.toContain('CHUNK ID: chunk-5')
  })

  it('throws error in proposeEdges if chunks do not carry valid UUID ids', async () => {
    const nodes: NodeSummary[] = [
      { id: 'node-a', type: 'claim', title: 'Claim A' },
      { id: 'node-b', type: 'method', title: 'Method B' },
    ]
    const idLessChunks: ChunkRef[] = [
      { ordinal: 0, page: 1, text: 'Evidence passage in text.' },
    ]

    await expect(
      proposeEdges({
        workspaceId: 'ws-1',
        nodes,
        chunks: idLessChunks,
      }),
    ).rejects.toThrow(/Every chunk passed to proposeEdges must have a valid UUID id/)
  })

  it('proposeEdges calls model and partitions accepted and rejected edges', async () => {
    const nodes: NodeSummary[] = [
      { id: 'node-a', type: 'claim', title: 'Claim A' },
      { id: 'node-b', type: 'method', title: 'Method B' },
    ]
    const chunks: ChunkRef[] = [
      { id: CHUNK_UUID_1, ordinal: 0, page: 1, text: 'Evidence passage in text.' },
    ]

    const mockCallModel = vi.fn(async () => ({
      output: {
        edges: [
          {
            fromNodeId: 'node-a',
            toNodeId: 'node-b',
            relation: 'tests',
            confidence: 0.8,
            evidenceChunkId: CHUNK_UUID_1,
            quote: 'Evidence passage in text.',
            rationale: 'Direct test relation',
          },
        ],
      },
      task: { id: 'task-edges-1' },
      attempts: [],
    }))

    const outcome = await proposeEdges({
      workspaceId: 'ws-1',
      nodes,
      chunks,
      // @ts-expect-error test mock injection
      callModelFn: mockCallModel,
    })

    expect(mockCallModel).toHaveBeenCalledTimes(1)
    expect(outcome.acceptedEdges.length).toBe(1)
    expect(outcome.acceptedEdges[0].status).toBe('accepted')
    expect(outcome.acceptedEdges[0].relation).toBe('tests')
    expect(outcome.taskId).toBe('task-edges-1')
  })

  it('rejects an edge citing a chunk excluded by topKChunks slice with CHUNK_NOT_FOUND', async () => {
    const nodes: NodeSummary[] = [
      { id: 'node-a', type: 'claim', title: 'Claim A' },
      { id: 'node-b', type: 'method', title: 'Method B' },
    ]
    const chunks: ChunkRef[] = [
      { id: CHUNK_UUID_1, ordinal: 0, page: 1, text: 'First chunk rendered in prompt.' },
      { id: CHUNK_UUID_2, ordinal: 1, page: 2, text: 'Second chunk unrendered due to topK.' },
    ]

    // Model proposes an edge citing CHUNK_UUID_2 which was NOT rendered because topKChunks = 1
    const mockCallModel = vi.fn(async () => ({
      output: {
        edges: [
          {
            fromNodeId: 'node-a',
            toNodeId: 'node-b',
            relation: 'supports',
            confidence: 0.9,
            evidenceChunkId: CHUNK_UUID_2,
            quote: 'Second chunk unrendered due to topK.',
            rationale: 'Citation to chunk outside prompt slice',
          },
        ],
      },
      task: { id: 'task-edges-topk' },
      attempts: [],
    }))

    const outcome = await proposeEdges({
      workspaceId: 'ws-topk',
      nodes,
      chunks,
      topKChunks: 1,
      // @ts-expect-error test mock injection
      callModelFn: mockCallModel,
      updateTaskStatusFn: vi.fn(),
    })

    expect(outcome.acceptedEdges).toHaveLength(0)
    expect(outcome.rejectedEdges).toHaveLength(1)
    expect(outcome.rejectedEdges[0].reason).toBe('CHUNK_NOT_FOUND')
  })

  it('updates task row to rejected when all proposed edges fail validation (docs/03)', async () => {
    const nodes: NodeSummary[] = [
      { id: 'node-a', type: 'claim', title: 'Claim A' },
      { id: 'node-b', type: 'method', title: 'Method B' },
    ]
    const chunks: ChunkRef[] = [
      { id: CHUNK_UUID_1, ordinal: 0, page: 1, text: 'Real evidence passage in text.' },
    ]

    let updatedTaskId = ''
    let updatedStatus = ''
    const mockUpdateStatus = vi.fn(async (taskId: string, status: any) => {
      updatedTaskId = taskId
      updatedStatus = status
    })

    const mockCallModel = vi.fn(async () => ({
      output: {
        edges: [
          {
            fromNodeId: 'node-a',
            toNodeId: 'node-b',
            relation: 'supports',
            confidence: 0.9,
            evidenceChunkId: CHUNK_UUID_1,
            quote: 'Hallucinated quote not in chunk.',
            rationale: 'Invalid quote',
          },
        ],
      },
      task: { id: 'task-edges-reject-1' },
      attempts: [],
    }))

    const outcome = await proposeEdges({
      workspaceId: 'ws-reject',
      nodes,
      chunks,
      // @ts-expect-error test mock injection
      callModelFn: mockCallModel,
      updateTaskStatusFn: mockUpdateStatus,
    })

    expect(outcome.acceptedEdges).toHaveLength(0)
    expect(outcome.rejectedEdges).toHaveLength(1)
    expect(mockUpdateStatus).toHaveBeenCalledTimes(1)
    expect(updatedStatus).toBe('rejected')
    expect(updatedTaskId).toBe('task-edges-reject-1')
  })

  it('defaults topKChunks to 8 and rejects edges citing chunks beyond the top 8 slice', async () => {
    const nodes: NodeSummary[] = [
      { id: 'node-a', type: 'claim', title: 'Claim A' },
      { id: 'node-b', type: 'method', title: 'Method B' },
    ]
    // 10 valid UUID chunks
    const tenChunks: ChunkRef[] = Array.from({ length: 10 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      ordinal: i,
      page: i + 1,
      text: `Evidence passage for chunk ${i} in text.`,
    }))

    // Model proposes an edge citing chunk index 9 (the 10th chunk)
    const mockCallModel = vi.fn(async () => ({
      output: {
        edges: [
          {
            fromNodeId: 'node-a',
            toNodeId: 'node-b',
            relation: 'supports',
            confidence: 0.9,
            evidenceChunkId: tenChunks[9].id!,
            quote: 'Evidence passage for chunk 9 in text.',
            rationale: 'Valid quote in 10th chunk',
          },
        ],
      },
      task: { id: 'task-edges-topk-default' },
      attempts: [],
    }))

    // Omits topKChunks option -> should default to 8
    const outcome = await proposeEdges({
      workspaceId: 'ws-topk-default',
      nodes,
      chunks: tenChunks,
      // @ts-expect-error test mock injection
      callModelFn: mockCallModel,
    })

    // Chunk 9 is outside the rendered slice [0..7], so it MUST be rejected with CHUNK_NOT_FOUND
    expect(outcome.acceptedEdges).toHaveLength(0)
    expect(outcome.rejectedEdges).toHaveLength(1)
    expect(outcome.rejectedEdges[0].reason).toBe('CHUNK_NOT_FOUND')
  })

  it('persists accepted edges via storeEdges when db option is provided', async () => {
    const nodes: NodeSummary[] = [
      { id: 'node-a', type: 'claim', title: 'Claim A' },
      { id: 'node-b', type: 'method', title: 'Method B' },
    ]
    const chunks: ChunkRef[] = [
      { id: CHUNK_UUID_1, ordinal: 0, page: 1, text: 'Evidence passage in text.' },
    ]

    const mockCallModel = vi.fn(async () => ({
      output: {
        edges: [
          {
            fromNodeId: 'node-a',
            toNodeId: 'node-b',
            relation: 'supports',
            confidence: 0.9,
            evidenceChunkId: CHUNK_UUID_1,
            quote: 'Evidence passage in text.',
            rationale: 'Solid support',
          },
        ],
      },
      task: { id: 'task-edges-persist' },
      attempts: [],
    }))

    const mockStoreEdges = vi.fn(async () => [
      {
        id: 'edge-row-1',
        workspaceId: 'ws-persist',
        sourceNodeId: 'node-a',
        targetNodeId: 'node-b',
        relation: 'supports' as const,
        confidence: 0.9,
        status: 'accepted' as const,
        evidenceChunkId: CHUNK_UUID_1,
        evidenceRunId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]) as any

    const fakeDb = {} as any
    const outcome = await proposeEdges({
      workspaceId: 'ws-persist',
      nodes,
      chunks,
      db: fakeDb,
      storeEdgesFn: mockStoreEdges,
      // @ts-expect-error test mock injection
      callModelFn: mockCallModel,
    })

    expect(outcome.acceptedEdges).toHaveLength(1)
    expect(mockStoreEdges).toHaveBeenCalledWith(fakeDb, 'ws-persist', outcome.acceptedEdges)
    expect(outcome.storedRows).toHaveLength(1)
    expect(outcome.storedRows![0].id).toBe('edge-row-1')
  })
})

describe('Integration test across 3 demo papers (verbatim quote verification and edge extraction)', () => {
  const strobl2007Path = path.resolve(process.cwd(), 'fixtures/papers/strobl-2007.pdf')
  const strobl2008Path = path.resolve(process.cwd(), 'fixtures/papers/strobl-2008.pdf')
  const kursa2010Path = path.resolve(process.cwd(), 'fixtures/papers/kursa-2010.pdf')

  const hasAllPapers =
    fs.existsSync(strobl2007Path) &&
    fs.existsSync(strobl2008Path) &&
    fs.existsSync(kursa2010Path)

  it.skipIf(!hasAllPapers)(
    'validates at least six accepted edges across the three papers with resolvable quotes',
    async () => {
      // 1. Ingest all 3 papers to get their real chunk text
      const { chunks: chunks2007 } = await ingestPdf(fs.readFileSync(strobl2007Path))
      const { chunks: chunks2008 } = await ingestPdf(fs.readFileSync(strobl2008Path))
      const { chunks: chunks2010 } = await ingestPdf(fs.readFileSync(kursa2010Path))

      // Tag chunks with valid UUIDs partitioned by paper
      const tagged2007: ChunkRef[] = chunks2007.map((c) => ({
        id: crypto.randomUUID(),
        sourceId: 'src-s07',
        ordinal: c.ordinal,
        text: c.text,
        page: c.page,
      }))
      const tagged2008: ChunkRef[] = chunks2008.map((c) => ({
        id: crypto.randomUUID(),
        sourceId: 'src-s08',
        ordinal: c.ordinal,
        text: c.text,
        page: c.page,
      }))
      const tagged2010: ChunkRef[] = chunks2010.map((c) => ({
        id: crypto.randomUUID(),
        sourceId: 'src-k10',
        ordinal: c.ordinal,
        text: c.text,
        page: c.page,
      }))

      // Paper-specific helpers to locate exact distinctive passage within that exact paper
      function findIn2007(quote: string): ChunkRef {
        const found = tagged2007.find((c) => verifyVerbatimQuote(quote, c.text))
        if (!found) throw new Error(`Quote not found in Strobl 2007: "${quote}"`)
        return found
      }
      function findIn2008(quote: string): ChunkRef {
        const found = tagged2008.find((c) => verifyVerbatimQuote(quote, c.text))
        if (!found) throw new Error(`Quote not found in Strobl 2008: "${quote}"`)
        return found
      }
      function findIn2010(quote: string): ChunkRef {
        const found = tagged2010.find((c) => verifyVerbatimQuote(quote, c.text))
        if (!found) throw new Error(`Quote not found in Kursa 2010: "${quote}"`)
        return found
      }

      // 6 real quotes verified distinctly inside their respective papers:
      // Paper 1 (Strobl 2007)
      const q1 = 'random forest variable importance measures are a sensible means for variable selection in many applications, but are not reliable in situations where potential predictor variables vary in their scale of measurement or their number of categories.'
      const q2 = 'The random forest approach was shown to outperform six other methods in the prediction of protein interactions based on various biological features such as gene expression, gene ontology (GO) features and sequence data [12].'

      // Paper 2 (Strobl 2008)
      const q3 = 'Based on these considerations we develop a new, conditional permutation scheme for the computation of the variable importance measure.'
      const q4 = 'Lunetta et al. [2] find that genetic markers relevant in interactions with other markers or environmental variables can be detected more efficiently by means of random forests'

      // Paper 3 (Kursa 2010 Boruta)
      const q5 = 'The algorithm uses a wrapper approach built around a random forest (Breiman 2001) classifier (Boruta is a god of the forest in the Slavic mythology).'
      const q6 = 'This article describes a R package Boruta, implementing a novel feature selection algorithm for finding all relevant variables.'

      const c1 = findIn2007(q1)
      const c2 = findIn2007(q2)
      const c3 = findIn2008(q3)
      const c4 = findIn2008(q4)
      const c5 = findIn2010(q5)
      const c6 = findIn2010(q6)

      // Assign stable UUIDs matching the checked-in fixture
      c1.id = '11111111-1111-4111-8111-111111111111'
      c2.id = '11111111-1111-4111-8111-111111111112'
      c3.id = '22222222-2222-4222-8222-222222222221'
      c4.id = '22222222-2222-4222-8222-222222222222'
      c5.id = '33333333-3333-4333-8333-333333333331'
      c6.id = '33333333-3333-4333-8333-333333333332'

      const allChunks: ChunkRef[] = [...tagged2007, ...tagged2008, ...tagged2010]

      const nodeS07ClaimId = '11111111-0001-4000-8000-000000000001'
      const nodeS07RfId = '11111111-0002-4000-8000-000000000002'
      const nodeS08CviId = '22222222-0001-4000-8000-000000000001'
      const nodeS08ClaimId = '22222222-0002-4000-8000-000000000002'
      const nodeK10BorutaId = '33333333-0001-4000-8000-000000000001'
      const nodeK10ClaimId = '33333333-0002-4000-8000-000000000002'
      const threePapersWsId = '44444444-4444-4444-8444-444444444444'

      // Workspace nodes representing claims and methods across the 3 papers
      const workspaceNodes: NodeSummary[] = [
        { id: nodeS07ClaimId, type: 'claim', title: 'Strobl 2007: Gini Importance Bias' },
        { id: nodeS07RfId, type: 'method', title: 'Random Forest Variable Importance' },
        { id: nodeS08CviId, type: 'method', title: 'Conditional Variable Importance' },
        { id: nodeS08ClaimId, type: 'claim', title: 'Strobl 2008: CVI eliminates correlation bias' },
        { id: nodeK10BorutaId, type: 'method', title: 'Boruta All-Relevant Feature Selection' },
        { id: nodeK10ClaimId, type: 'claim', title: 'Kursa 2010: Shadow Features' },
      ]

      // Load and schema-validate checked-in fixture of model output
      const fixturePath = path.resolve(process.cwd(), 'fixtures/extract/three-papers-edges.json')
      const capturedFixture: ProposeEdgesResult = ProposeEdgesResultSchema.parse(
        JSON.parse(fs.readFileSync(fixturePath, 'utf8')),
      )

      const mockCallModel = vi.fn().mockResolvedValue({
        output: capturedFixture,
        task: { id: 'task-edges-fixture' },
        attempts: [],
      })

      const insertedDbRows: any[] = []
      const ownedNodeRows = workspaceNodes.map((n) => ({ id: n.id }))
      const ownedChunkRows = [c1, c2, c3, c4, c5, c6].map((c) => ({ id: c.id }))
      const fakeDb = {
        transaction: vi.fn(async (cb: any) => {
          const tx = {
            select: vi.fn(() => ({
              from: vi.fn(() => ({
                where: vi.fn(async () => ownedNodeRows),
                innerJoin: vi.fn(() => ({
                  where: vi.fn(async () => ownedChunkRows),
                })),
              })),
            })),
            insert: vi.fn(() => ({
              values: vi.fn((vals: any) => ({
                returning: vi.fn(async () => {
                  const row = { id: crypto.randomUUID(), ...vals, evidenceRunId: null, createdAt: new Date() }
                  insertedDbRows.push(row)
                  return [row]
                }),
              })),
            })),
          }
          return await cb(tx)
        }),
      } as unknown as Database

      const outcome = await proposeEdges({
        workspaceId: threePapersWsId,
        nodes: workspaceNodes,
        chunks: [c1, c2, c3, c4, c5, c6],
        db: fakeDb,
        callModelFn: mockCallModel as any,
      })

      expect(mockCallModel).toHaveBeenCalledTimes(1)
      expect(fakeDb.transaction).toHaveBeenCalledTimes(1)
      expect(outcome.acceptedEdges.length).toBeGreaterThanOrEqual(6)
      expect(outcome.rejectedEdges).toHaveLength(0)
      expect(outcome.storedRows?.length).toBeGreaterThanOrEqual(6)
      expect(insertedDbRows.length).toBeGreaterThanOrEqual(6)
      for (const row of insertedDbRows) {
        expect(row.workspaceId).toBe(threePapersWsId)
        expect(row.status).toBe('accepted')
        expect(row.evidenceChunkId).toBeDefined()
      }

      // Every accepted edge has status 'accepted', confidence >= 0.65, and a resolvable quote verified against its cited chunk from that paper
      for (const edge of outcome.acceptedEdges) {
        expect(edge.status).toBe('accepted')
        expect(edge.confidence).toBeGreaterThanOrEqual(0.65)
        expect(edge.matchedQuote.length).toBeGreaterThan(0)
        expect(edge.evidenceChunkId).toBeDefined()
        const citedChunk = allChunks.find((c) => c.id === edge.evidenceChunkId)
        expect(citedChunk).toBeDefined()
        expect(verifyVerbatimQuote(edge.matchedQuote, citedChunk!.text)).toBe(true)
      }
    },
    25000,
  )
})

describe('storeEdges (Issue #13 persistence and foreign key enforcement)', () => {
  it('persists accepted edges via atomic transaction and maps all required foreign key fields', async () => {
    const insertedRows: any[] = []
    const fakeDb = {
      transaction: vi.fn(async (cb: any) => {
        const fakeTx = {
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(async () => [
                { id: '11111111-1111-4111-8111-111111111111' },
                { id: '22222222-2222-4222-8222-222222222222' },
              ]),
              innerJoin: vi.fn(() => ({
                where: vi.fn(async () => [
                  { id: '33333333-3333-4333-8333-333333333333' },
                ]),
              })),
            })),
          })),
          insert: vi.fn(() => ({
            values: vi.fn((vals: any) => ({
              returning: vi.fn(async () => {
                const row = {
                  id: crypto.randomUUID(),
                  ...vals,
                  evidenceRunId: null,
                  createdAt: new Date(),
                }
                insertedRows.push(row)
                return [row]
              }),
            })),
          })),
        }
        return await cb(fakeTx)
      }),
    } as unknown as Database

    const edgeToStore: ValidatedEdge = {
      fromNodeId: '11111111-1111-4111-8111-111111111111',
      toNodeId: '22222222-2222-4222-8222-222222222222',
      relation: 'supports',
      confidence: 0.9,
      status: 'accepted',
      evidenceChunkId: '33333333-3333-4333-8333-333333333333',
      matchedQuote: 'Verified evidence chunk text.',
      rationale: 'Direct empirical support',
    }

    const inserted = await storeEdges(fakeDb, 'ws-test-unit', [edgeToStore])
    expect(fakeDb.transaction).toHaveBeenCalledTimes(1)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].evidenceChunkId).toBe('33333333-3333-4333-8333-333333333333')
    expect(inserted[0].sourceNodeId).toBe('11111111-1111-4111-8111-111111111111')
    expect(inserted[0].targetNodeId).toBe('22222222-2222-4222-8222-222222222222')
    expect(inserted[0].status).toBe('accepted')
    expect(inserted[0].relation).toBe('supports')
  })

  it('throws if fromNodeId or toNodeId does not belong to the target workspace', async () => {
    const fakeDb = {
      transaction: vi.fn(async (cb: any) => {
        const fakeTx = {
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              // Only source node exists in workspace; target node belongs to another workspace
              where: vi.fn(async () => [{ id: '11111111-1111-4111-8111-111111111111' }]),
            })),
          })),
          insert: vi.fn(),
        }
        return await cb(fakeTx)
      }),
    } as unknown as Database

    const crossWorkspaceEdge: ValidatedEdge = {
      fromNodeId: '11111111-1111-4111-8111-111111111111',
      toNodeId: '22222222-2222-4222-8222-222222222222',
      relation: 'supports',
      confidence: 0.9,
      status: 'accepted',
      evidenceChunkId: '33333333-3333-4333-8333-333333333333',
      matchedQuote: 'Verified evidence chunk text.',
      rationale: 'Cross-workspace attempt',
    }

    await expect(storeEdges(fakeDb, 'ws-owned', [crossWorkspaceEdge])).rejects.toThrow(
      'Cross-workspace or missing node in edge persistence',
    )
  })

  it('throws if evidenceChunkId belongs to a source outside the target workspace', async () => {
    const fakeDb = {
      transaction: vi.fn(async (cb: any) => {
        const fakeTx = {
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(async () => [
                { id: '11111111-1111-4111-8111-111111111111' },
                { id: '22222222-2222-4222-8222-222222222222' },
              ]),
              // Chunk belongs to another tenant workspace, so join with sources filters it out
              innerJoin: vi.fn(() => ({
                where: vi.fn(async () => []),
              })),
            })),
          })),
          insert: vi.fn(),
        }
        return await cb(fakeTx)
      }),
    } as unknown as Database

    const crossWorkspaceChunkEdge: ValidatedEdge = {
      fromNodeId: '11111111-1111-4111-8111-111111111111',
      toNodeId: '22222222-2222-4222-8222-222222222222',
      relation: 'supports',
      confidence: 0.9,
      status: 'accepted',
      evidenceChunkId: '99999999-9999-4999-8999-999999999999',
      matchedQuote: 'Verified evidence chunk text.',
      rationale: 'Cross-workspace evidence chunk attempt',
    }

    await expect(storeEdges(fakeDb, 'ws-owned', [crossWorkspaceChunkEdge])).rejects.toThrow(
      'Cross-workspace or missing evidence chunk in edge persistence',
    )
  })

  it('ignores non-UUID chunks beyond the topKChunks window instead of failing early', async () => {
    const validChunkId = '11111111-1111-4111-8111-111111111111'
    const outcome = await proposeEdges({
      workspaceId: 'ws-slice',
      topKChunks: 1,
      nodes: [
        { id: 'n1', type: 'claim', title: 'Node 1' },
        { id: 'n2', type: 'method', title: 'Node 2' },
      ],
      chunks: [
        { id: validChunkId, ordinal: 0, page: 1, text: 'Included passage.' },
        { id: 'non-uuid-trailing', ordinal: 1, page: 2, text: 'Excluded passage beyond topK.' },
      ],
      callModelFn: vi.fn(async () => ({
        output: { edges: [] },
        task: { id: 'task-1' },
        attempts: [],
      })) as any,
    })
    expect(outcome.acceptedEdges).toHaveLength(0)
  })

  it('throws an error if an edge to persist has a non-UUID node or chunk ID', async () => {
    const fakeDb = {
      transaction: vi.fn(async (cb: any) => cb({ insert: vi.fn() })),
    } as unknown as Database

    const invalidEdge: ValidatedEdge = {
      fromNodeId: 'non-uuid-node',
      toNodeId: '22222222-2222-4222-8222-222222222222',
      relation: 'supports',
      confidence: 0.9,
      status: 'accepted',
      evidenceChunkId: '33333333-3333-4333-8333-333333333333',
      matchedQuote: 'Verified evidence chunk text.',
      rationale: 'Direct empirical support',
    }

    await expect(storeEdges(fakeDb, 'ws-test-unit', [invalidEdge])).rejects.toThrow(
      'Invalid UUID in edge persistence',
    )
  })

  const hasDb = Boolean(process.env.DATABASE_URL)

  it.skipIf(!hasDb)(
    'LIVE DB: persists accepted edges across the 3 demo papers into Neon satisfying foreign keys and check constraints, joining evidence_chunk_id to source_chunks with verified quote',
    async () => {
      const { getDb } = await import('../../db/client')
      const { workspaces, sources, sourceChunks, nodes, edges } = await import('../../db/schema')
      const { eq } = await import('drizzle-orm')
      const crypto = await import('node:crypto')

      const db = getDb()
      const testWsId = crypto.randomUUID()
      const s07Id = crypto.randomUUID()
      const s08Id = crypto.randomUUID()
      const k10Id = crypto.randomUUID()

      const c1Id = crypto.randomUUID()
      const c2Id = crypto.randomUUID()
      const c3Id = crypto.randomUUID()
      const c4Id = crypto.randomUUID()
      const c5Id = crypto.randomUUID()
      const c6Id = crypto.randomUUID()

      const nodeS07ClaimId = crypto.randomUUID()
      const nodeS07RfId = crypto.randomUUID()
      const nodeS08CviId = crypto.randomUUID()
      const nodeS08ClaimId = crypto.randomUUID()
      const nodeK10BorutaId = crypto.randomUUID()
      const nodeK10ClaimId = crypto.randomUUID()

      const fixtureIdMap = new Map<string, string>([
        ['11111111-1111-4111-8111-111111111111', c1Id],
        ['11111111-1111-4111-8111-111111111112', c2Id],
        ['22222222-2222-4222-8222-222222222221', c3Id],
        ['22222222-2222-4222-8222-222222222222', c4Id],
        ['33333333-3333-4333-8333-333333333331', c5Id],
        ['33333333-3333-4333-8333-333333333332', c6Id],
        ['11111111-0001-4000-8000-000000000001', nodeS07ClaimId],
        ['11111111-0002-4000-8000-000000000002', nodeS07RfId],
        ['22222222-0001-4000-8000-000000000001', nodeS08CviId],
        ['22222222-0002-4000-8000-000000000002', nodeS08ClaimId],
        ['33333333-0001-4000-8000-000000000001', nodeK10BorutaId],
        ['33333333-0002-4000-8000-000000000002', nodeK10ClaimId],
      ])

      // Ingest real paper chunks
      const papersDir = path.resolve(process.cwd(), 'fixtures/papers')
      const strobl07 = await ingestPdf(new Uint8Array(fs.readFileSync(path.join(papersDir, 'strobl-2007.pdf'))).buffer)
      const strobl08 = await ingestPdf(new Uint8Array(fs.readFileSync(path.join(papersDir, 'strobl-2008.pdf'))).buffer)
      const kursa10 = await ingestPdf(new Uint8Array(fs.readFileSync(path.join(papersDir, 'kursa-2010.pdf'))).buffer)

      const findIn2007 = (needle: string) => strobl07.chunks.find((c) => c.text.includes(needle))!
      const findIn2008 = (needle: string) => strobl08.chunks.find((c) => c.text.includes(needle))!
      const findIn2010 = (needle: string) => kursa10.chunks.find((c) => c.text.includes(needle))!

      const c1 = findIn2007('random forest variable importance measures are a sensible means')
      const c2 = findIn2007('The random forest approach was shown to outperform')
      const c3 = findIn2008('Based on these considerations we develop a new, conditional permutation scheme')
      const c4 = findIn2008('Lunetta et al. [2] find that genetic markers')
      const c5 = findIn2010('The algorithm uses a wrapper approach built around a random forest')
      const c6 = findIn2010('This article describes a R package Boruta')

      try {
        await db.insert(workspaces).values({
          id: testWsId,
          name: 'Three Papers Live Workspace',
          slug: `test-ws-three-${Date.now()}`,
        })

        await db.insert(sources).values([
          { id: s07Id, workspaceId: testWsId, kind: 'paper', title: 'Strobl 2007', sha256: 'sha-s07-live', bytes: 100 },
          { id: s08Id, workspaceId: testWsId, kind: 'paper', title: 'Strobl 2008', sha256: 'sha-s08-live', bytes: 100 },
          { id: k10Id, workspaceId: testWsId, kind: 'paper', title: 'Kursa 2010', sha256: 'sha-k10-live', bytes: 100 },
        ])

        await db.insert(sourceChunks).values([
          { id: c1Id, sourceId: s07Id, ordinal: c1.ordinal, text: c1.text, page: c1.page, charStart: c1.charStart, charEnd: c1.charEnd },
          { id: c2Id, sourceId: s07Id, ordinal: c2.ordinal, text: c2.text, page: c2.page, charStart: c2.charStart, charEnd: c2.charEnd },
          { id: c3Id, sourceId: s08Id, ordinal: c3.ordinal, text: c3.text, page: c3.page, charStart: c3.charStart, charEnd: c3.charEnd },
          { id: c4Id, sourceId: s08Id, ordinal: c4.ordinal, text: c4.text, page: c4.page, charStart: c4.charStart, charEnd: c4.charEnd },
          { id: c5Id, sourceId: k10Id, ordinal: c5.ordinal, text: c5.text, page: c5.page, charStart: c5.charStart, charEnd: c5.charEnd },
          { id: c6Id, sourceId: k10Id, ordinal: c6.ordinal, text: c6.text, page: c6.page, charStart: c6.charStart, charEnd: c6.charEnd },
        ])

        await db.insert(nodes).values([
          { id: nodeS07ClaimId, workspaceId: testWsId, type: 'claim', title: 'Strobl 2007: Gini Importance Bias', data: { type: 'claim', text: 'Strobl 2007 claim', reported: null, datasetName: null, methodName: null, locator: { page: 1, quote: c1.text.slice(0, 30) } } },
          { id: nodeS07RfId, workspaceId: testWsId, type: 'method', title: 'Random Forest Variable Importance', data: { type: 'method', summary: 'RF method', library: null } },
          { id: nodeS08CviId, workspaceId: testWsId, type: 'method', title: 'Conditional Variable Importance', data: { type: 'method', summary: 'CVI method', library: null } },
          { id: nodeS08ClaimId, workspaceId: testWsId, type: 'claim', title: 'Strobl 2008: CVI eliminates correlation bias', data: { type: 'claim', text: 'Strobl 2008 claim', reported: null, datasetName: null, methodName: null, locator: { page: 1, quote: c4.text.slice(0, 30) } } },
          { id: nodeK10BorutaId, workspaceId: testWsId, type: 'method', title: 'Boruta All-Relevant Feature Selection', data: { type: 'method', summary: 'Boruta method', library: null } },
          { id: nodeK10ClaimId, workspaceId: testWsId, type: 'claim', title: 'Kursa 2010: Shadow Features', data: { type: 'claim', text: 'Kursa 2010 claim', reported: null, datasetName: null, methodName: null, locator: { page: 1, quote: c6.text.slice(0, 30) } } },
        ])

        const fixturePath = path.resolve(process.cwd(), 'fixtures/extract/three-papers-edges.json')
        const parsedFixture = ProposeEdgesResultSchema.parse(
          JSON.parse(fs.readFileSync(fixturePath, 'utf8')),
        )
        const capturedFixture: ProposeEdgesResult = {
          edges: parsedFixture.edges.map((e) => ({
            ...e,
            fromNodeId: fixtureIdMap.get(e.fromNodeId) ?? e.fromNodeId,
            toNodeId: fixtureIdMap.get(e.toNodeId) ?? e.toNodeId,
            evidenceChunkId: fixtureIdMap.get(e.evidenceChunkId) ?? e.evidenceChunkId,
          })),
        }

        const chunkRefs: ChunkRef[] = [
          { id: c1Id, ordinal: c1.ordinal, text: c1.text, page: c1.page },
          { id: c2Id, ordinal: c2.ordinal, text: c2.text, page: c2.page },
          { id: c3Id, ordinal: c3.ordinal, text: c3.text, page: c3.page },
          { id: c4Id, ordinal: c4.ordinal, text: c4.text, page: c4.page },
          { id: c5Id, ordinal: c5.ordinal, text: c5.text, page: c5.page },
          { id: c6Id, ordinal: c6.ordinal, text: c6.text, page: c6.page },
        ]

        const workspaceNodeSummaries: NodeSummary[] = [
          { id: nodeS07ClaimId, type: 'claim', title: 'Strobl 2007: Gini Importance Bias' },
          { id: nodeS07RfId, type: 'method', title: 'Random Forest Variable Importance' },
          { id: nodeS08CviId, type: 'method', title: 'Conditional Variable Importance' },
          { id: nodeS08ClaimId, type: 'claim', title: 'Strobl 2008: CVI eliminates correlation bias' },
          { id: nodeK10BorutaId, type: 'method', title: 'Boruta All-Relevant Feature Selection' },
          { id: nodeK10ClaimId, type: 'claim', title: 'Kursa 2010: Shadow Features' },
        ]

        const outcome = await proposeEdges({
          workspaceId: testWsId,
          nodes: workspaceNodeSummaries,
          chunks: chunkRefs,
          db,
          callModelFn: (async () => ({ output: capturedFixture, task: { id: crypto.randomUUID() }, attempts: [] })) as any,
        })

        expect(outcome.acceptedEdges.length).toBeGreaterThanOrEqual(6)

        // Query database to ensure rows are inserted, FKs hold, and evidence chunk text contains quote
        const persistedEdges = await db
          .select({
            edge: edges,
            chunkText: sourceChunks.text,
          })
          .from(edges)
          .innerJoin(sourceChunks, eq(edges.evidenceChunkId, sourceChunks.id))
          .where(eq(edges.workspaceId, testWsId))

        expect(persistedEdges.length).toBeGreaterThanOrEqual(6)
        console.log(`\n### Recorded Live Neon Run Evidence (persisted edges joined to source_chunks):`)
        console.log(`| # | Edge ID | Relation | Confidence | Status | Evidence Chunk ID | Quote Verified in Chunk? | Verbatim Quote Snippet |`)
        console.log(`|---|---|---|---|---|---|---|---|`)

        let rowIndex = 1
        for (const row of persistedEdges) {
          expect(row.edge.status).toBe('accepted')
          expect(row.edge.confidence).toBeGreaterThanOrEqual(0.65)
          const matchedEdge = outcome.acceptedEdges.find(
            (e) => e.fromNodeId === row.edge.sourceNodeId && e.toNodeId === row.edge.targetNodeId,
          )
          expect(matchedEdge).toBeDefined()
          const isVerbatim = verifyVerbatimQuote(matchedEdge!.matchedQuote, row.chunkText)
          expect(isVerbatim).toBe(true)
          const quoteSnippet = matchedEdge!.matchedQuote.slice(0, 60).replace(/\n/g, ' ') + '...'
          console.log(`| ${rowIndex++} | \`${row.edge.id}\` | \`${row.edge.relation}\` | ${row.edge.confidence} | \`${row.edge.status}\` | \`${row.edge.evidenceChunkId}\` | VERIFIED_VERBATIM | "${quoteSnippet}" |`)
        }
      } finally {
        await db.delete(edges).where(eq(edges.workspaceId, testWsId)).catch(() => {})
        await db.delete(nodes).where(eq(nodes.workspaceId, testWsId)).catch(() => {})
        await db.delete(sourceChunks).where(eq(sourceChunks.sourceId, s07Id)).catch(() => {})
        await db.delete(sourceChunks).where(eq(sourceChunks.sourceId, s08Id)).catch(() => {})
        await db.delete(sourceChunks).where(eq(sourceChunks.sourceId, k10Id)).catch(() => {})
        await db.delete(sources).where(eq(sources.workspaceId, testWsId)).catch(() => {})
        await db.delete(workspaces).where(eq(workspaces.id, testWsId)).catch(() => {})
      }
    },
    30000,
  )
})

describe('Issue #13 contract hardening: RATIONALE_EMPTY reachability, persistence signalling, and node-pair retrieval', () => {
  it('allows callModel schema.parse to pass blank or verbose rationales so validateProposedEdges rejects RATIONALE_EMPTY per edge without aborting sibling edges', async () => {
    const { createCallModel } = await import('../model')
    const validChunk = '11111111-1111-4111-8111-111111111111'
    const longRationale = 'R'.repeat(300)

    const baseCallModel = createCallModel({
      generate: async () => ({
        output: {
          edges: [
            {
              fromNodeId: 'node-1',
              toNodeId: 'node-2',
              relation: 'supports',
              confidence: 0.9,
              evidenceChunkId: validChunk,
              quote: 'Random forests measure variable importance accurately.',
              rationale: '   ', // blank rationale must reject only this edge, not crash schema.parse
            },
            {
              fromNodeId: 'node-2',
              toNodeId: 'node-1',
              relation: 'tests',
              confidence: 0.85,
              evidenceChunkId: validChunk,
              quote: 'Simulation benchmarks verify permutation calibration.',
              rationale: longRationale, // verbose rationale trimmed cleanly to <= 240
            },
          ],
        },
        inputTokens: 100,
        outputTokens: 50,
      }),
      now: () => 0,
      sleep: async () => {},
    })

    const fakeCallModel: typeof baseCallModel = (schema, prompt, ctx) =>
      baseCallModel(schema, prompt, {
        ...ctx,
        store: { insert: async () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }) },
      })

    const outcome = await proposeEdges({
      workspaceId: 'ws-rationale-edge-level',
      nodes: [
        { id: 'node-1', type: 'claim', title: 'Claim 1' },
        { id: 'node-2', type: 'method', title: 'Method 2' },
      ],
      chunks: [
        {
          id: validChunk,
          ordinal: 0,
          page: 1,
          text: 'Random forests measure variable importance accurately. Simulation benchmarks verify permutation calibration.',
        },
      ],
      callModelFn: fakeCallModel,
      updateTaskStatusFn: vi.fn(),
    })

    expect(outcome.rejectedEdges).toHaveLength(1)
    expect(outcome.rejectedEdges[0]?.reason).toBe('RATIONALE_EMPTY')
    expect(outcome.acceptedEdges).toHaveLength(1)
    expect(outcome.acceptedEdges[0]?.relation).toBe('tests')
    expect(outcome.acceptedEdges[0]?.rationale.length).toBeLessThanOrEqual(240)
    expect(outcome.persisted).toBe(false)
  })

  it('allows callModel schema.parse to pass over-400-char edge quotes so validateProposedEdges rejects QUOTE_TOO_LONG per edge without aborting sibling edges', async () => {
    const { createCallModel } = await import('../model')
    const validChunk = '11111111-1111-4111-8111-111111111111'
    const overlongQuote = 'Q'.repeat(405)

    const baseCallModel = createCallModel({
      generate: async () => ({
        output: {
          edges: [
            {
              fromNodeId: 'node-1',
              toNodeId: 'node-2',
              relation: 'supports',
              confidence: 0.9,
              evidenceChunkId: validChunk,
              quote: overlongQuote,
              rationale: 'Supported by long passage',
            },
            {
              fromNodeId: 'node-2',
              toNodeId: 'node-1',
              relation: 'tests',
              confidence: 0.85,
              evidenceChunkId: validChunk,
              quote: 'Concise verbatim evidence.',
              rationale: 'Supported by concise passage',
            },
          ],
        },
        inputTokens: 100,
        outputTokens: 50,
      }),
      now: () => 0,
      sleep: async () => {},
    })

    const fakeCallModel: typeof baseCallModel = (schema, prompt, ctx) =>
      baseCallModel(schema, prompt, {
        ...ctx,
        store: { insert: async () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }) },
      })

    const outcome = await proposeEdges({
      workspaceId: 'ws-quote-len-edge-level',
      nodes: [
        { id: 'node-1', type: 'claim', title: 'Claim 1' },
        { id: 'node-2', type: 'method', title: 'Method 2' },
      ],
      chunks: [
        {
          id: validChunk,
          ordinal: 0,
          page: 1,
          text: `${overlongQuote} Concise verbatim evidence.`,
        },
      ],
      callModelFn: fakeCallModel,
      updateTaskStatusFn: vi.fn(),
    })

    expect(outcome.rejectedEdges).toHaveLength(1)
    expect(outcome.rejectedEdges[0]?.reason).toBe('QUOTE_TOO_LONG')
    expect(outcome.acceptedEdges).toHaveLength(1)
    expect(outcome.acceptedEdges[0]?.relation).toBe('tests')
  })

  it('signals persisted explicitly and fails fast when requirePersistence is set without a db handle', async () => {
    const validChunk = '11111111-1111-4111-8111-111111111111'
    const callSpy = vi.fn()

    await expect(
      proposeEdges({
        workspaceId: 'ws-req-db',
        nodes: [
          { id: 'n1', type: 'claim', title: 'Claim 1' },
          { id: 'n2', type: 'method', title: 'Method 2' },
        ],
        chunks: [{ id: validChunk, ordinal: 0, page: 1, text: 'Verbatim text.' }],
        requirePersistence: true,
        callModelFn: callSpy as any,
      }),
    ).rejects.toThrow(/proposeEdges requires a database handle/)

    expect(callSpy).not.toHaveBeenCalled()
  })

  it('retrieveCandidateChunksForNodes executes sequential pair queries prioritized cross-source and deduplicates by max similarity', async () => {
    const { retrieveCandidateChunksForNodes } = await import('./edges')
    let activeQueries = 0
    let maxConcurrent = 0
    const queries: string[] = []

    const chunkA = 'aaaaaaaa-0000-4000-8000-000000000001'
    const chunkB = 'bbbbbbbb-0000-4000-8000-000000000002'
    const stratId = '77777777-7777-4777-8777-777777777777'
    const seenEmbedOptions: any[] = []

    const retrieved = await retrieveCandidateChunksForNodes(
      {} as Database,
      'ws-retrieve',
      [
        { id: 'n1', type: 'claim', title: 'Gini bias', sourceId: 'src-1' },
        { id: 'n2', type: 'method', title: 'Permutation importance', sourceId: 'src-1' },
        { id: 'n3', type: 'claim', title: 'Boruta wrapper', sourceId: 'src-2' },
      ],
      {
        strategyId: stratId,
        maxPairs: 2,
        topKPerPair: 2,
        maxChunks: 4,
        embedQueryFn: async (query, opts) => {
          activeQueries++
          maxConcurrent = Math.max(maxConcurrent, activeQueries)
          await Promise.resolve()
          queries.push(query)
          seenEmbedOptions.push(opts)
          activeQueries--
          return [0.1, 0.2]
        },
        searchSimilarChunksFn: async (_db, workspaceId) => {
          expect(workspaceId).toBe('ws-retrieve')
          return [
            {
              chunk: { id: chunkA, sourceId: 'src-1', ordinal: 0, page: 1, charStart: 0, charEnd: 10, text: 'Chunk A', embedding: null },
              similarity: queries.length === 1 ? 0.65 : 0.91,
            },
            {
              chunk: { id: chunkB, sourceId: 'src-2', ordinal: 0, page: 1, charStart: 0, charEnd: 10, text: 'Chunk B', embedding: null },
              similarity: 0.72,
            },
          ]
        },
      },
    )

    expect(maxConcurrent).toBe(1)
    expect(queries).toHaveLength(2)
    expect(seenEmbedOptions.every((o) => o.strategyId === stratId && o.taskKind === 'propose_edges')).toBe(true)
    // Cross-source pairs (n1+n3, n2+n3) prioritized ahead of same-source (n1+n2)
    expect(queries[0]).toContain('Boruta wrapper')
    expect(queries[1]).toContain('Boruta wrapper')
    // Deduplicated to 2 chunks ordered by highest similarity seen across pairs (0.91 > 0.72)
    expect(retrieved.map((c) => c.id)).toEqual([chunkA, chunkB])
  })

  it('proposeEdgesForWorkspace retrieves candidate chunks when omitted and persists accepted edges with persisted=true', async () => {
    const { proposeEdgesForWorkspace } = await import('./edges')
    const n1 = '11111111-0001-4000-8000-000000000001'
    const n2 = '22222222-0002-4000-8000-000000000002'
    const c1 = '33333333-0003-4000-8000-000000000003'
    const wsId = '44444444-0004-4000-8000-000000000004'

    const outcome = await proposeEdgesForWorkspace({} as Database, {
      workspaceId: wsId,
      nodes: [
        { id: n1, type: 'claim', title: 'Claim 1', sourceId: 's1' },
        { id: n2, type: 'method', title: 'Method 2', sourceId: 's2' },
      ],
      strategyId: '55555555-0005-4000-8000-000000000005',
      retrieveChunksFn: async () => [
        { id: c1, ordinal: 0, page: 1, text: 'Conditional permutation evaluates correlated features fairly.' },
      ],
      callModelFn: (async (_s: any, _p: string, ctx: any) => {
        expect(ctx.strategyId).toBe('55555555-0005-4000-8000-000000000005')
        return {
          output: {
            edges: [
              {
                fromNodeId: n1,
                toNodeId: n2,
                relation: 'supports',
                confidence: 0.88,
                evidenceChunkId: c1,
                quote: 'Conditional permutation evaluates correlated features fairly.',
                rationale: 'Supports claim using conditional permutation evidence',
              },
            ],
          },
          task: { id: 'task-ws-edge' },
          attempts: [],
        }
      }) as any,
      storeEdgesFn: async (_db, workspaceId, toStore) => {
        expect(workspaceId).toBe(wsId)
        expect(toStore).toHaveLength(1)
        return [
          {
            id: '66666666-0006-4000-8000-000000000006',
            workspaceId,
            sourceNodeId: toStore[0]!.fromNodeId,
            targetNodeId: toStore[0]!.toNodeId,
            relation: toStore[0]!.relation,
            evidenceChunkId: toStore[0]!.evidenceChunkId,
            evidenceRunId: null,
            confidence: toStore[0]!.confidence,
            status: toStore[0]!.status,
            createdAt: new Date(),
          },
        ]
      },
    })

    expect(outcome.persisted).toBe(true)
    expect(outcome.acceptedEdges).toHaveLength(1)
    expect(outcome.storedRows).toHaveLength(1)
  })
})
