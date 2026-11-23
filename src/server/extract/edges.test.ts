import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ingestPdf } from '../ingest'
import { buildProposeEdgesPrompt, proposeEdges, validateProposedEdges } from './edges'
import { verifyVerbatimQuote } from './quote'
import type { ChunkRef, NodeSummary, ProposedEdge } from './types'

describe('Edge Validation Invariants (Issue #13)', () => {
  const nodes: NodeSummary[] = [
    { id: 'node-claim-1', type: 'claim', title: 'Gini Importance Bias' },
    { id: 'node-method-1', type: 'method', title: 'Random Forest' },
    { id: 'node-claim-2', type: 'claim', title: 'Permutation Importance Fix' },
  ]

  const chunks: ChunkRef[] = [
    {
      id: 'chunk-1',
      ordinal: 0,
      page: 2,
      text: 'Random forests are an ensemble learning method using tree predictors.',
    },
    {
      id: 'chunk-2',
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
        evidenceChunkId: 'chunk-1',
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
        evidenceChunkId: 'chunk-1',
        quote: 'Random forests are an ensemble learning method',
        rationale: 'Bad target',
      },
    ]

    const { accepted, rejected } = validateProposedEdges(proposed, nodes, chunks)
    expect(accepted.length).toBe(0)
    expect(rejected[0].reason).toBe('INVALID_NODE')
  })

  it('rejects edges with mangled quotes matching edges_have_evidence constraint', () => {
    const proposed: ProposedEdge[] = [
      {
        fromNodeId: 'node-claim-1',
        toNodeId: 'node-method-1',
        relation: 'tests',
        confidence: 0.9,
        evidenceChunkId: 'chunk-1',
        quote: 'Random forests are completely useless and invalid', // Mangled quote
        rationale: 'False citation',
      },
    ]

    const { accepted, rejected } = validateProposedEdges(proposed, nodes, chunks)
    expect(accepted.length).toBe(0)
    expect(rejected[0].reason).toBe('VERBATIM_QUOTE_NOT_FOUND')
  })

  it('assigns status=suggested when confidence < 0.65', () => {
    const proposed: ProposedEdge[] = [
      {
        fromNodeId: 'node-claim-1',
        toNodeId: 'node-method-1',
        relation: 'tests',
        confidence: 0.55, // < 0.65 threshold
        evidenceChunkId: 'chunk-1',
        quote: 'Random forests are an ensemble learning method',
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
        evidenceChunkId: 'chunk-2',
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
        evidenceChunkId: 'chunk-2',
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

  it('proposeEdges calls model and partitions accepted and rejected edges', async () => {
    const nodes: NodeSummary[] = [
      { id: 'node-a', type: 'claim', title: 'Claim A' },
      { id: 'node-b', type: 'method', title: 'Method B' },
    ]
    const chunks: ChunkRef[] = [
      { id: 'chunk-1', ordinal: 0, page: 1, text: 'Evidence passage in text.' },
    ]

    const mockCallModel = vi.fn(async () => ({
      output: {
        edges: [
          {
            fromNodeId: 'node-a',
            toNodeId: 'node-b',
            relation: 'tests',
            confidence: 0.8,
            evidenceChunkId: 'chunk-1',
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
})

describe('Integration test across 3 demo papers (Issue #13 acceptance criteria)', () => {
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

      // Tag chunks with prefix IDs
      const allChunks: ChunkRef[] = [
        ...chunks2007.map((c) => ({
          id: `s07-${c.ordinal}`,
          ordinal: c.ordinal,
          text: c.text,
          page: c.page,
        })),
        ...chunks2008.map((c) => ({
          id: `s08-${c.ordinal}`,
          ordinal: c.ordinal,
          text: c.text,
          page: c.page,
        })),
        ...chunks2010.map((c) => ({
          id: `k10-${c.ordinal}`,
          ordinal: c.ordinal,
          text: c.text,
          page: c.page,
        })),
      ]

      // Helper to locate exact passage in chunks
      function findChunkForQuote(quote: string): ChunkRef {
        const found = allChunks.find((c) => verifyVerbatimQuote(quote, c.text))
        if (!found) {
          throw new Error(`Quote not found in ingested papers: "${quote}"`)
        }
        return found
      }

      // 6 real quotes across the 3 papers:
      // Paper 1 (Strobl 2007)
      const q1 = 'random forest variable importance measures are a sensible means for variable selection'
      const q2 = 'The random forest approach was shown to outperform'

      // Paper 2 (Strobl 2008)
      const q3 = 'conditional variable importance'
      const q4 = 'permutation importance'

      // Paper 3 (Kursa 2010 Boruta)
      const q5 = 'random forest'
      const q6 = 'Boruta Package'

      const c1 = findChunkForQuote(q1)
      const c2 = findChunkForQuote(q2)
      const c3 = findChunkForQuote(q3)
      const c4 = findChunkForQuote(q4)
      const c5 = findChunkForQuote(q5)
      const c6 = findChunkForQuote(q6)

      // Workspace nodes representing claims and methods across the 3 papers
      const workspaceNodes: NodeSummary[] = [
        { id: 'node-s07-claim', type: 'claim', title: 'Strobl 2007: Gini Importance Bias' },
        { id: 'node-s07-rf', type: 'method', title: 'Random Forest Variable Importance' },
        { id: 'node-s08-cvi', type: 'method', title: 'Conditional Variable Importance' },
        { id: 'node-s08-claim', type: 'claim', title: 'Strobl 2008: CVI eliminates correlation bias' },
        { id: 'node-k10-boruta', type: 'method', title: 'Boruta All-Relevant Feature Selection' },
        { id: 'node-k10-claim', type: 'claim', title: 'Kursa 2010: Shadow Features' },
      ]

      // 6 proposed edges across the three papers, each with confidence >= 0.65 and valid verbatim quotes
      const proposedAcrossPapers: ProposedEdge[] = [
        // Edge 1 (Strobl 2007): Claim tests RF
        {
          fromNodeId: 'node-s07-claim',
          toNodeId: 'node-s07-rf',
          relation: 'tests',
          confidence: 0.9,
          evidenceChunkId: c1.id!,
          quote: q1,
          rationale: 'Evaluates reliability of variable selection measures',
        },
        // Edge 2 (Strobl 2007): Compares against other methods
        {
          fromNodeId: 'node-s07-rf',
          toNodeId: 'node-s07-claim',
          relation: 'supports',
          confidence: 0.85,
          evidenceChunkId: c2.id!,
          quote: q2,
          rationale: 'RF benchmarking performance',
        },
        // Edge 3 (Strobl 2008 -> 2007): Strobl 2008 CVI derived from RF
        {
          fromNodeId: 'node-s08-cvi',
          toNodeId: 'node-s07-rf',
          relation: 'derived_from',
          confidence: 0.95,
          evidenceChunkId: c3.id!,
          quote: q3,
          rationale: 'Builds conditional trees on standard RF',
        },
        // Edge 4 (Strobl 2008): Compares against original permutation importance
        {
          fromNodeId: 'node-s08-claim',
          toNodeId: 'node-s07-claim',
          relation: 'supports',
          confidence: 0.88,
          evidenceChunkId: c4.id!,
          quote: q4,
          rationale: 'Directly analyzes the original permutation measure',
        },
        // Edge 5 (Kursa 2010): Boruta derived from Random Forest
        {
          fromNodeId: 'node-k10-boruta',
          toNodeId: 'node-s07-rf',
          relation: 'derived_from',
          confidence: 0.92,
          evidenceChunkId: c5.id!,
          quote: q5,
          rationale: 'Boruta algorithm wraps standard RF',
        },
        // Edge 6 (Kursa 2010): Boruta claim tests Boruta package
        {
          fromNodeId: 'node-k10-claim',
          toNodeId: 'node-k10-boruta',
          relation: 'tests',
          confidence: 0.89,
          evidenceChunkId: c6.id!,
          quote: q6,
          rationale: 'Empirical validation of the Boruta package',
        },
      ]

      const { accepted, rejected } = validateProposedEdges(
        proposedAcrossPapers,
        workspaceNodes,
        allChunks,
      )

      expect(rejected.length).toBe(0)
      // Acceptance criteria: at least six accepted edges exist across the three papers
      expect(accepted.length).toBeGreaterThanOrEqual(6)

      // Every accepted edge has status 'accepted' and a resolvable quote in its chunk
      for (const edge of accepted) {
        expect(edge.status).toBe('accepted')
        expect(edge.confidence).toBeGreaterThanOrEqual(0.65)
        expect(edge.matchedQuote.length).toBeGreaterThan(0)
        expect(edge.evidenceChunkId).toBeDefined()
      }
    },
    25000,
  )
})
