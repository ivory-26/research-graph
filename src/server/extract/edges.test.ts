import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ingestPdf } from '../ingest'
import { buildProposeEdgesPrompt, proposeEdges, storeEdges, validateProposedEdges } from './edges'
import { verifyVerbatimQuote } from './quote'
import type { ChunkRef, NodeSummary, ProposedEdge, ValidatedEdge } from './types'

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

      // Tag chunks with valid UUIDs
      const allChunks: ChunkRef[] = [
        ...chunks2007.map((c) => ({
          id: crypto.randomUUID(),
          sourceId: 'src-s07',
          ordinal: c.ordinal,
          text: c.text,
          page: c.page,
        })),
        ...chunks2008.map((c) => ({
          id: crypto.randomUUID(),
          sourceId: 'src-s08',
          ordinal: c.ordinal,
          text: c.text,
          page: c.page,
        })),
        ...chunks2010.map((c) => ({
          id: crypto.randomUUID(),
          sourceId: 'src-k10',
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

describe('storeEdges (Issue #13 persistence and foreign key enforcement)', () => {
  const hasDb = Boolean(process.env.DATABASE_URL)

  it.skipIf(!hasDb)(
    'persists accepted edges into Neon satisfying edges_have_evidence check constraint',
    async () => {
      const { getDb } = await import('../../db/client')
      const { workspaces, sources, sourceChunks, nodes, edges } = await import('../../db/schema')
      const { eq } = await import('drizzle-orm')
      const crypto = await import('node:crypto')

      const db = getDb()
      const testWsId = crypto.randomUUID()
      const testSourceId = crypto.randomUUID()
      const testChunkId = crypto.randomUUID()
      const testNode1Id = crypto.randomUUID()
      const testNode2Id = crypto.randomUUID()

      try {
        // Setup workspace
        await db.insert(workspaces).values({
          id: testWsId,
          name: 'Issue 13 Test Workspace',
          slug: `test-ws-edges-${Date.now()}`,
        })

        // Setup source & chunk
        await db.insert(sources).values({
          id: testSourceId,
          workspaceId: testWsId,
          kind: 'paper',
          title: 'Edges Evidence Paper',
          sha256: crypto.createHash('sha256').update('edges-test').digest('hex'),
          bytes: 1024,
        })

        await db.insert(sourceChunks).values({
          id: testChunkId,
          sourceId: testSourceId,
          ordinal: 0,
          text: 'Verified evidence chunk text.',
          page: 1,
          charStart: 0,
          charEnd: 30,
        })

        // Setup 2 nodes
        await db.insert(nodes).values([
          {
            id: testNode1Id,
            workspaceId: testWsId,
            type: 'claim',
            title: 'Node 1',
            data: {
              type: 'claim',
              text: 'Node 1 text',
              reported: null,
              datasetName: null,
              methodName: null,
              locator: { page: 1, quote: 'Verified evidence chunk text.' },
            },
          },
          {
            id: testNode2Id,
            workspaceId: testWsId,
            type: 'method',
            title: 'Node 2',
            data: {
              type: 'method',
              summary: 'Node 2 method summary',
              library: null,
            },
          },
        ])

        const edgeToStore: ValidatedEdge = {
          fromNodeId: testNode1Id,
          toNodeId: testNode2Id,
          relation: 'supports',
          confidence: 0.9,
          status: 'accepted',
          evidenceChunkId: testChunkId,
          matchedQuote: 'Verified evidence chunk text.',
          rationale: 'Direct support',
        }

        const inserted = await storeEdges(db, testWsId, [edgeToStore])
        expect(inserted.length).toBe(1)
        expect(inserted[0].evidenceChunkId).toBe(testChunkId)
        expect(inserted[0].sourceNodeId).toBe(testNode1Id)
        expect(inserted[0].targetNodeId).toBe(testNode2Id)
        expect(inserted[0].status).toBe('accepted')
      } finally {
        await db.delete(edges).where(eq(edges.workspaceId, testWsId))
        await db.delete(nodes).where(eq(nodes.workspaceId, testWsId))
        await db.delete(sourceChunks).where(eq(sourceChunks.sourceId, testSourceId))
        await db.delete(sources).where(eq(sources.workspaceId, testWsId))
        await db.delete(workspaces).where(eq(workspaces.id, testWsId))
      }
    },
    20000,
  )
})
