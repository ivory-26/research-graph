import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '../../db/client'
import type { EdgeRow, NodeRow, SourceChunkRow, SourceRow } from '../../db/schema'
import { ingestSourceToGraphForWorkspace } from './pipeline'
import { proposeEdgesForWorkspace } from './edges'
import { verifyVerbatimQuote } from './quote'
import { DEFAULT_META_MODEL_ID, DEFAULT_MODEL_ID, callModel, type CallModel } from '../model'
import {
  ProposeEdgesResultSchema,
  type ProposeEdgesResult,
  type ValidatedEdge,
} from './types'

/**
 * In-memory workspace-isolated store adapter simulating Drizzle Postgres tables (`sources`, `source_chunks`,
 * `nodes`, `edges`) so `ingestSourceToGraphForWorkspace` exercises real persistence transactions, UUID FKs,
 * and cross-source node/chunk propagation offline without live API keys.
 */
function createInMemoryWorkspaceDb() {
  const sourceRows: SourceRow[] = []
  const chunkRows: SourceChunkRow[] = []
  const nodeRows: NodeRow[] = []
  const edgeRows: EdgeRow[] = []

  const db: any = {
    sourceRows,
    chunkRows,
    nodeRows,
    edgeRows,
    transaction: async (cb: any) => cb(db),
    select: () => ({
      from: () => ({
        where: async () => [...nodeRows],
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async (n: number) => chunkRows.slice(0, n),
            }),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (vals: any) => ({
        returning: async () => {
          const arr = Array.isArray(vals) ? vals : [vals]
          const first = arr[0]
          if (!first) return []

          if ('sha256' in first && 'bytes' in first) {
            const created = arr.map((v) => ({
              id: v.id ?? crypto.randomUUID(),
              ...v,
              createdAt: new Date(),
            })) as SourceRow[]
            sourceRows.push(...created)
            return created
          }

          if ('ordinal' in first && 'charStart' in first) {
            const created = arr.map((v) => ({
              id: v.id ?? crypto.randomUUID(),
              ...v,
            })) as SourceChunkRow[]
            chunkRows.push(...created)
            return created
          }

          if ('data' in first && 'type' in first) {
            const created = arr.map((v) => ({
              id: v.id ?? crypto.randomUUID(),
              ...v,
              positionX: v.positionX ?? 0,
              positionY: v.positionY ?? 0,
              createdAt: new Date(),
            })) as NodeRow[]
            nodeRows.push(...created)
            return created
          }

          if ('sourceNodeId' in first && 'targetNodeId' in first) {
            const created = arr.map((v) => ({
              id: v.id ?? crypto.randomUUID(),
              ...v,
              evidenceRunId: v.evidenceRunId ?? null,
              createdAt: new Date(),
            })) as EdgeRow[]
            edgeRows.push(...created)
            return created
          }

          return []
        },
      }),
    }),
  }

  return db as Database & {
    sourceRows: SourceRow[]
    chunkRows: SourceChunkRow[]
    nodeRows: NodeRow[]
    edgeRows: EdgeRow[]
  }
}

describe('Workspace-scoped ingest -> extractClaims -> proposeEdges pipeline (docs/07)', () => {
  const papersDir = path.resolve(process.cwd(), 'fixtures/papers')
  const hasAllPapers =
    fs.existsSync(path.join(papersDir, 'strobl-2007.pdf')) &&
    fs.existsSync(path.join(papersDir, 'strobl-2008.pdf')) &&
    fs.existsSync(path.join(papersDir, 'kursa-2010.pdf'))

  it('wires ingestWebSource -> extractClaims -> nodes -> proposeEdgesForWorkspace cleanly using default pair retrieval', async () => {
    const db = createInMemoryWorkspaceDb()
    const workspaceId = crypto.randomUUID()
    let seenProposeInputRef: any = null

    const mockCallModel = vi.fn(async (_schema: any, prompt: string, ctx: any) => {
      if (ctx.taskKind === 'extract_claims') {
        expect(prompt).toContain('ranger project page')
        const idMatch = prompt.match(/--- CHUNK ID: ([0-9a-f-]+) /i)
        const chunkId = idMatch?.[1] ?? ''
        return {
          output: {
            claims: [
              {
                text: 'ranger provides fast random forest importance computation',
                quote:
                  'ranger is a fast implementation of random forests supporting permutation variable importance.',
                chunkId,
                metric: 'permutation importance',
                reportedValue: null,
              },
            ],
            datasets: [],
            methods: [{ name: 'ranger', summary: 'Fast C++ / R random forest implementation' }],
            codeUrls: ['https://github.com/imbs-hl/ranger'],
          },
          task: { id: crypto.randomUUID(), status: 'succeeded' },
          attempts: [],
        }
      }

      seenProposeInputRef = ctx.inputRef
      const nodeIds = [...prompt.matchAll(/\[ID: ([0-9a-f-]+)\]/gi)].map((m) => m[1]!)
      const chunkMatch = prompt.match(/--- CHUNK ID: ([0-9a-f-]+) /i)
      const edgeChunkId = chunkMatch?.[1] ?? ''
      return {
        output: {
          edges: [
            {
              fromNodeId: nodeIds[1]!,
              toNodeId: nodeIds[2]!,
              relation: 'tests',
              confidence: 0.9,
              evidenceChunkId: edgeChunkId,
              quote:
                'ranger is a fast implementation of random forests supporting permutation variable importance.',
              rationale: 'Project page verifies permutation variable importance implementation in ranger',
            },
          ],
        },
        task: { id: crypto.randomUUID(), status: 'succeeded' },
        attempts: [],
      }
    })

    const storeStub = async (_db: Database, wsId: string, edgesToStore: any[]) => {
      return (await db
        .insert({} as any)
        .values(
          edgesToStore.map((e) => ({
            workspaceId: wsId,
            sourceNodeId: e.fromNodeId,
            targetNodeId: e.toNodeId,
            relation: e.relation,
            confidence: e.confidence,
            status: e.status,
            evidenceChunkId: e.evidenceChunkId,
          })),
        )
        .returning()) as EdgeRow[]
    }

    const res = await ingestSourceToGraphForWorkspace({
      db,
      workspaceId,
      source: {
        kind: 'web',
        url: 'https://github.com/imbs-hl/ranger',
        title: 'ranger project page',
        firecrawlDeps: {
          scraper: async (url) => ({
            url,
            title: 'imbs-hl/ranger',
            markdown:
              'ranger is a fast implementation of random forests supporting permutation variable importance.',
            description: null,
            statusCode: 200,
            metadata: { statusCode: 200 },
          }),
        },
      },
      embedChunksFn: (async (items: any[]) => items.map(() => new Array(768).fill(0.05))) as any,
      embedQueryFn: (async () => new Array(768).fill(0.05)) as any,
      searchSimilarChunksFn: (async () =>
        db.chunkRows.map((c) => ({ chunk: c, similarity: 0.9 }))) as any,
      callModelFn: mockCallModel as any,
      updateTaskStatusFn: vi.fn(),
      storeEdgesFn: storeStub,
    })

    expect(res.needsOcr).toBe(false)
    expect(res.source.kind).toBe('repo')
    expect(res.source.workspaceId).toBe(workspaceId)
    expect(res.extraction.acceptedClaims).toHaveLength(1)
    expect(res.createdNodes).toHaveLength(3)
    const claimNode = res.createdNodes.find((n) => n.type === 'claim')
    expect(claimNode?.data.type).toBe('claim')
    if (claimNode?.data.type === 'claim') {
      expect(claimNode.data.reported?.value).toBeNull()
    }
    expect(seenProposeInputRef.evidenceSelection).toBe('pair_retrieval')
    expect(res.edges.persisted).toBe(true)
    expect(res.edges.acceptedEdges).toHaveLength(1)
    expect(res.edges.acceptedEdges[0]?.status).toBe('accepted')
  })

  it('short-circuits scanned needsOcr PDFs cleanly and keeps needsOcr=false for empty non-PDF scrapes', async () => {
    const db = createInMemoryWorkspaceDb()
    const embedSpy = vi.fn()
    const modelSpy = vi.fn()

    const pdfRes = await ingestSourceToGraphForWorkspace({
      db,
      workspaceId: crypto.randomUUID(),
      source: {
        kind: 'pdf',
        data: new Uint8Array(0),
        title: 'Scanned unreadable paper.pdf',
      },
      embedChunksFn: embedSpy as any,
      callModelFn: modelSpy as any,
    })

    expect(pdfRes.needsOcr).toBe(true)
    expect(pdfRes.chunkCount).toBe(0)
    expect(pdfRes.createdNodes).toHaveLength(0)
    expect(pdfRes.edges.persisted).toBe(false)
    expect(embedSpy).not.toHaveBeenCalled()
    expect(modelSpy).not.toHaveBeenCalled()

    const emptyWebRes = await ingestSourceToGraphForWorkspace({
      db,
      workspaceId: crypto.randomUUID(),
      source: { kind: 'web', url: 'https://example.com/empty' },
      ingestWebSourceFn: (async (url: string, opts: { workspaceId: string }) => ({
        source: {
          id: crypto.randomUUID(),
          workspaceId: opts.workspaceId,
          kind: 'web',
          title: 'Empty page',
          url,
          doi: null,
          sha256: 'abc',
          bytes: 0,
          meta: {},
          createdAt: new Date(),
        },
        chunks: [],
        chunkRows: [],
        embeddings: [],
      })) as any,
      callModelFn: modelSpy as any,
    })

    expect(emptyWebRes.needsOcr).toBe(false)
    expect(emptyWebRes.chunkCount).toBe(0)
    expect(emptyWebRes.edges.persisted).toBe(false)
    expect(modelSpy).not.toHaveBeenCalled()
  })

  it('uses per-pair retrieval by default and records fallback_slice explicitly when retrieval returns nothing', async () => {
    const db = createInMemoryWorkspaceDb()
    const workspaceId = crypto.randomUUID()
    const retrievedChunkId = crypto.randomUUID()
    const strategyUuid = crypto.randomUUID()
    let seenRetrieveStrategyId: string | null | undefined

    const retrieveSpy = vi.fn(async (_d: Database, _w: string, _n: any[], opts?: any) => {
      seenRetrieveStrategyId = opts?.strategyId
      return [
        {
          id: retrievedChunkId,
          ordinal: 0,
          page: 1,
          text: 'Conditional variable importance mitigates correlation bias.',
        },
      ]
    })

    let seenSelection = ''
    const resRetrieved = await ingestSourceToGraphForWorkspace({
      db,
      workspaceId,
      strategyId: strategyUuid,
      source: {
        kind: 'web',
        url: 'https://example.com/cvi',
        scrapeOptions: {
          preFetchedTitle: 'CVI Note',
          preFetchedMarkdown: 'Conditional variable importance mitigates correlation bias.',
        },
      },
      retrieveChunksFn: retrieveSpy,
      embedChunksFn: (async (items: any[]) => items.map(() => new Array(768).fill(0.05))) as any,
      callModelFn: (async (_s: any, prompt: string, ctx: any) => {
        if (ctx.taskKind === 'extract_claims') {
          const cid = prompt.match(/--- CHUNK ID: ([0-9a-f-]+) /i)?.[1] ?? ''
          return {
            output: {
              claims: [
                {
                  text: 'CVI mitigates correlation bias',
                  quote: 'Conditional variable importance mitigates correlation bias.',
                  chunkId: cid,
                },
              ],
              datasets: [],
              methods: [],
              codeUrls: [],
            },
            task: { id: crypto.randomUUID() },
            attempts: [],
          }
        }
        seenSelection = ctx.inputRef.evidenceSelection
        const nids = [...prompt.matchAll(/\[ID: ([0-9a-f-]+)\]/gi)].map((m) => m[1]!)
        return {
          output: {
            edges: [
              {
                fromNodeId: nids[1]!,
                toNodeId: nids[0]!,
                relation: 'supports',
                confidence: 0.85,
                evidenceChunkId: retrievedChunkId,
                quote: 'Conditional variable importance mitigates correlation bias.',
                rationale: 'Supported by retrieved chunk',
              },
            ],
          },
          task: { id: crypto.randomUUID() },
          attempts: [],
        }
      }) as any,
      storeEdgesFn: async (_d, wsId, es) =>
        es.map((e) => ({
          id: crypto.randomUUID(),
          workspaceId: wsId,
          sourceNodeId: e.fromNodeId,
          targetNodeId: e.toNodeId,
          relation: e.relation,
          evidenceChunkId: e.evidenceChunkId,
          evidenceRunId: null,
          confidence: e.confidence,
          status: e.status,
          createdAt: new Date(),
        })),
    })

    expect(retrieveSpy).toHaveBeenCalledTimes(1)
    expect(seenRetrieveStrategyId).toBe(strategyUuid)
    expect(seenSelection).toBe('pair_retrieval')
    expect(resRetrieved.edges.acceptedEdges[0]?.evidenceChunkId).toBe(retrievedChunkId)
    expect(resRetrieved.edges.persisted).toBe(true)

    // When pair retrieval yields zero chunks, pipeline falls back and records evidenceSelection='fallback_slice'
    let fallbackSelection = ''
    await ingestSourceToGraphForWorkspace({
      db,
      workspaceId,
      source: {
        kind: 'web',
        url: 'https://example.com/fallback',
        scrapeOptions: {
          preFetchedTitle: 'Fallback Note',
          preFetchedMarkdown: 'Permutation variable importance remains unbiased across predictor scales.',
        },
      },
      retrieveChunksFn: vi.fn(async () => []),
      embedChunksFn: (async (items: any[]) => items.map(() => new Array(768).fill(0.05))) as any,
      callModelFn: (async (_s: any, prompt: string, ctx: any) => {
        if (ctx.taskKind === 'extract_claims') {
          const cid = prompt.match(/--- CHUNK ID: ([0-9a-f-]+) /i)?.[1] ?? ''
          return {
            output: {
              claims: [
                {
                  text: 'Permutation importance is unbiased',
                  quote: 'Permutation variable importance remains unbiased across predictor scales.',
                  chunkId: cid,
                },
              ],
              datasets: [],
              methods: [],
              codeUrls: [],
            },
            task: { id: crypto.randomUUID() },
            attempts: [],
          }
        }
        fallbackSelection = ctx.inputRef.evidenceSelection
        return { output: { edges: [] }, task: { id: crypto.randomUUID() }, attempts: [] }
      }) as any,
      updateTaskStatusFn: vi.fn(),
    })

    expect(fallbackSelection).toBe('fallback_slice')
  })

  it.skipIf(!hasAllPapers)(
    'processes all 3 real demo papers into one workspace accumulating >= 6 evidenced edges across single_pass/sectioned/table_first',
    async () => {
      const db = createInMemoryWorkspaceDb()
      const workspaceId = crypto.randomUUID()

      const storeStub = async (_db: Database, wsId: string, edgesToStore: any[]) => {
        return (await db
          .insert({} as any)
          .values(
            edgesToStore.map((e) => ({
              workspaceId: wsId,
              sourceNodeId: e.fromNodeId,
              targetNodeId: e.toNodeId,
              relation: e.relation,
              confidence: e.confidence,
              status: e.status,
              evidenceChunkId: e.evidenceChunkId,
            })),
          )
          .returning()) as EdgeRow[]
      }

      const specs = [
        {
          file: 'strobl-2007.pdf',
          title: 'Strobl et al. 2007',
          strategy: 'single_pass' as const,
          quoteNeedle:
            'random forest variable importance measures are a sensible means for variable selection in many applications, but are not reliable in situations where potential predictor variables vary in their scale of measurement or their number of categories.',
          claimText: 'Gini importance is unreliable when predictors vary in scale or category count',
          method: { name: 'Gini Importance', summary: 'Split criterion impurity importance' },
        },
        {
          file: 'strobl-2008.pdf',
          title: 'Strobl et al. 2008',
          strategy: 'sectioned' as const,
          quoteNeedle:
            'With this scheme the importance scores of the correlated predictor variables are highly overestimated.',
          claimText:
            'Ordinary permutation importance overestimates correlated predictor importance scores',
          method: { name: 'Conditional Variable Importance', summary: 'Conditional permutation scheme' },
        },
        {
          file: 'kursa-2010.pdf',
          title: 'Kursa & Rudnicki 2010',
          strategy: 'table_first' as const,
          quoteNeedle:
            'The algorithm uses a wrapper approach built around a random forest (Breiman 2001) classifier (Boruta is a god of the forest in the Slavic mythology).',
          claimText: 'Boruta finds all relevant variables using shadow attributes',
          method: { name: 'Boruta', summary: 'All-relevant wrapper around random forests' },
        },
      ]

      let totalPersistedEdges = 0

      for (const spec of specs) {
        const pdfBytes = fs.readFileSync(path.join(papersDir, spec.file))

        const mockCallModel = vi.fn(async (_schema: any, prompt: string, ctx: any) => {
          if (ctx.taskKind === 'extract_claims') {
            const sections = [
              ...prompt.matchAll(
                /--- CHUNK ID: ([0-9a-f-]+) \(Page [^)]+\) ---\n([\s\S]*?)(?=\n--- CHUNK ID:|\nINSTRUCTIONS:)/gi,
              ),
            ]
            const matchSection = sections.find((m) =>
              m[2]!.replace(/\s+/g, ' ').includes(spec.quoteNeedle),
            )
            if (!matchSection) {
              return {
                output: { claims: [], datasets: [], methods: [], codeUrls: [] },
                task: { id: crypto.randomUUID(), status: 'succeeded' },
                attempts: [],
              }
            }
            return {
              output: {
                claims: [
                  {
                    text: spec.claimText,
                    quote: spec.quoteNeedle,
                    chunkId: matchSection[1]!,
                    methodName: spec.method.name,
                  },
                ],
                datasets: [],
                methods: [spec.method],
                codeUrls: [],
              },
              task: { id: crypto.randomUUID(), status: 'succeeded' },
              attempts: [],
            }
          }

          const nodeIds = [...prompt.matchAll(/\[ID: ([0-9a-f-]+)\]/gi)].map((m) => m[1]!)
          const chunkSections = [
            ...prompt.matchAll(
              /--- CHUNK ID: ([0-9a-f-]+) \(Page [^)]+\) ---\n([\s\S]*?)(?=\n--- CHUNK ID:|\nINSTRUCTIONS:)/gi,
            ),
          ]
          const citeChunk =
            chunkSections.find((m) => m[2]!.replace(/\s+/g, ' ').includes(spec.quoteNeedle)) ??
            chunkSections[0]!

          const snippetQuote = citeChunk[2]!.trim().slice(0, 90)
          const proposal: ProposeEdgesResult = ProposeEdgesResultSchema.parse({
            edges: [
              {
                fromNodeId: nodeIds[nodeIds.length - 1]!,
                toNodeId: nodeIds[nodeIds.length - 2]!,
                relation: 'tests',
                confidence: 0.9,
                evidenceChunkId: citeChunk[1]!,
                quote: snippetQuote,
                rationale: 'Method tests extracted empirical claim',
              },
              {
                fromNodeId: nodeIds[nodeIds.length - 2]!,
                toNodeId: nodeIds[0]!,
                relation: 'supports',
                confidence: 0.85,
                evidenceChunkId: citeChunk[1]!,
                quote: snippetQuote,
                rationale: 'Claim supports source paper thesis',
              },
            ],
          })

          return {
            output: proposal,
            task: { id: crypto.randomUUID(), status: 'succeeded' },
            attempts: [],
          }
        })

        const outcome = await ingestSourceToGraphForWorkspace({
          db,
          workspaceId,
          strategy: spec.strategy,
          source: { kind: 'pdf', data: pdfBytes, title: spec.title },
          embedChunksFn: (async (items: any[]) => items.map(() => new Array(768).fill(0.02))) as any,
          embedQueryFn: (async () => new Array(768).fill(0.02)) as any,
          searchSimilarChunksFn: (async () =>
            db.chunkRows.slice(-8).map((c) => ({ chunk: c, similarity: 0.88 }))) as any,
          callModelFn: mockCallModel as any,
          updateTaskStatusFn: vi.fn(),
          storeEdgesFn: storeStub,
        })

        expect(outcome.needsOcr).toBe(false)
        expect(outcome.extraction.acceptedClaims).toHaveLength(1)
        expect(outcome.edges.persisted).toBe(true)
        totalPersistedEdges += outcome.edges.acceptedEdges.length
      }

      expect(totalPersistedEdges).toBeGreaterThanOrEqual(6)
      expect(db.sourceRows).toHaveLength(3)
      expect(db.edgeRows.length).toBeGreaterThanOrEqual(6)
      expect(db.edgeRows.every((e) => e.evidenceChunkId !== null && e.workspaceId === workspaceId)).toBe(true)
    },
    30000,
  )

  const hasDb = Boolean(process.env.DATABASE_URL)
  const hasGeminiKey = Boolean(
    process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  )

  async function cleanupLiveWorkspace(db: Database, wsId: string): Promise<void> {
    const { agentTasks, edges, nodes, sourceChunks, sources, workspaces } = await import(
      '../../db/schema'
    )
    const { eq } = await import('drizzle-orm')

    const steps: Array<{ label: string; run: () => Promise<unknown> }> = [
      { label: 'edges', run: () => db.delete(edges).where(eq(edges.workspaceId, wsId)) },
      { label: 'nodes', run: () => db.delete(nodes).where(eq(nodes.workspaceId, wsId)) },
      { label: 'agent_tasks', run: () => db.delete(agentTasks).where(eq(agentTasks.workspaceId, wsId)) },
      {
        label: 'source_chunks',
        run: async () => {
          const wsSources = await db.select().from(sources).where(eq(sources.workspaceId, wsId))
          for (const s of wsSources) {
            await db.delete(sourceChunks).where(eq(sourceChunks.sourceId, s.id))
          }
        },
      },
      { label: 'sources', run: () => db.delete(sources).where(eq(sources.workspaceId, wsId)) },
      { label: 'workspaces', run: () => db.delete(workspaces).where(eq(workspaces.id, wsId)) },
    ]

    for (const step of steps) {
      try {
        await step.run()
      } catch (err) {
        console.warn(`[cleanupLiveWorkspace] Failed deleting ${step.label} for ${wsId}:`, err)
      }
    }
  }

  it.skipIf(!hasDb || !hasAllPapers)(
    'LIVE DB (stubbed callModel): ingests all 3 demo PDFs via ingestSourceToGraphForWorkspace into Neon Postgres, retrieves pair chunks via pgvector, and persists >= 6 accepted edges spanning all 3 papers',
    async () => {
      const { getDb } = await import('../../db/client')
      const { edges, sourceChunks, sources, workspaces } = await import('../../db/schema')
      const { and, eq } = await import('drizzle-orm')

      const db = getDb()
      const wsId = crypto.randomUUID()
      const allAcceptedEdges: ValidatedEdge[] = []
      const recordedTaskInputs: any[] = []

      // Deterministic content-aware 768d unit vectors so Neon pgvector genuinely ranks relevant chunks highest offline
      const textToVec = (text: string, boostSlot?: number) => {
        const v = new Array<number>(768).fill(0)
        const lower = text.toLowerCase()
        const vocab = [
          'ensemble',
          'classification trees',
          'bootstrap',
          'correlated predictor',
          'overestimated',
          'conditional permutation',
          'boruta',
          'z score',
          'accuracy loss',
          'random forest',
        ]
        vocab.forEach((term, idx) => {
          if (lower.includes(term)) v[idx + 1] = 1
        })
        if (boostSlot !== undefined) {
          v[boostSlot] = (v[boostSlot] ?? 0) + 0.5
        }
        v[0] = 0.05
        const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
        return v.map((x) => x / norm)
      }

      const paperSpecs = [
        {
          file: 'strobl-2007.pdf',
          title: 'Strobl et al. 2007',
          strategy: 'single_pass' as const,
          slot: 1,
          quote:
            'Random forests are an ensemble method that combines several individual classification trees in the following way: From the original sample several bootstrap samples are drawn, and an unpruned classification tree is fit to each bootstrap sample.',
          claimText: 'Random forests fit unpruned classification trees across bootstrap samples',
          method: { name: 'CART Bootstrap Ensemble', summary: 'Bootstrap ensemble of unpruned CART trees' },
        },
        {
          file: 'strobl-2008.pdf',
          title: 'Strobl et al. 2008',
          strategy: 'sectioned' as const,
          slot: 100,
          quote:
            'With this scheme the importance scores of the correlated predictor variables are highly overestimated.',
          claimText: 'Marginal permutation overestimates correlated predictor importance scores',
          method: { name: 'Conditional Permutation Grid', summary: 'Tree-partition conditional permutation scheme' },
        },
        {
          file: 'kursa-2010.pdf',
          title: 'Kursa & Rudnicki 2010',
          strategy: 'table_first' as const,
          slot: 200,
          quote:
            'Nevertheless, in Boruta we use Z score as the importance measure since it takes into account the fluctuations of the mean accuracy loss among trees in the forest.',
          claimText: 'Boruta uses Z score normalized accuracy loss to stabilize importance ranking',
          method: { name: 'Boruta Shadow Wrapper', summary: 'All-relevant random forest feature wrapper' },
        },
      ]

      const paperQuoteMap = new Map(paperSpecs.map((s) => [s.title, s]))

      try {
        await db.insert(workspaces).values({
          id: wsId,
          name: 'Three Papers Neon DB Pipeline Test',
          slug: `ws-three-neon-${Date.now()}`,
        })

        for (const p of paperSpecs) {
          const outcome = await ingestSourceToGraphForWorkspace({
            db,
            workspaceId: wsId,
            strategy: p.strategy,
            topKChunks: 8,
            source: {
              kind: 'pdf',
              data: fs.readFileSync(path.join(papersDir, p.file)),
              title: p.title,
            },
            embedChunksFn: (async (items: any[]) =>
              items.map((it) => {
                const txt = typeof it === 'string' ? it : it.text
                const isTarget = txt.replace(/\s+/g, ' ').includes(p.quote)
                return textToVec(txt, isTarget ? 400 + p.slot : undefined)
              })) as any,
            embedQueryFn: (async (q: string) => {
              if (q.includes('Boruta') || q.includes('Z score')) {
                return textToVec('boruta z score accuracy loss', 400 + 200)
              }
              if (q.includes('Marginal') || q.includes('Conditional') || q.includes('correlated')) {
                return textToVec('correlated predictor overestimated conditional permutation', 400 + 100)
              }
              return textToVec('ensemble classification trees bootstrap', 400 + 1)
            }) as any,
            callModelFn: (async (_schema: any, prompt: string, ctx: any) => {
              if (ctx.taskKind === 'extract_claims') {
                const sections = [
                  ...prompt.matchAll(
                    /--- CHUNK ID: ([0-9a-f-]+) \(Page [^)]+\) ---\n([\s\S]*?)(?=\n--- CHUNK ID:|\nINSTRUCTIONS:)/gi,
                  ),
                ]
                const matched = sections.find((m) =>
                  m[2]!.replace(/\s+/g, ' ').includes(p.quote),
                )
                if (!matched) {
                  return {
                    output: { claims: [], datasets: [], methods: [], codeUrls: [] },
                    task: { id: crypto.randomUUID(), status: 'succeeded' },
                    attempts: [],
                  }
                }
                return {
                  output: {
                    claims: [
                      {
                        text: p.claimText,
                        quote: p.quote,
                        chunkId: matched[1]!,
                        methodName: p.method.name,
                      },
                    ],
                    datasets: [],
                    methods: [p.method],
                    codeUrls: [],
                  },
                  task: { id: crypto.randomUUID(), status: 'succeeded' },
                  attempts: [],
                }
              }

              recordedTaskInputs.push(ctx.inputRef)
              const nodeLines = [...prompt.matchAll(/\[ID: ([0-9a-f-]+)\] \(([^)]+)\) ([^:]+):/gi)]
              const claimNode = nodeLines.find((n) => n[2] === 'claim' && n[3]?.includes(p.claimText.slice(0, 20))) ?? nodeLines[1]!
              const methodNode = nodeLines.find((n) => n[2] === 'method' && n[3]?.includes(p.method.name.slice(0, 10))) ?? nodeLines[2]!
              const sourceNode = nodeLines[0]!

              const chunkSections = [
                ...prompt.matchAll(
                  /--- CHUNK ID: ([0-9a-f-]+) \(Page [^)]+\) ---\n([\s\S]*?)(?=\n--- CHUNK ID:|\nINSTRUCTIONS:)/gi,
                ),
              ]
              const matchedChunk = chunkSections.find((m) =>
                m[2]!.replace(/\s+/g, ' ').includes(p.quote),
              )
              if (!matchedChunk || !claimNode || !methodNode || !sourceNode) {
                return {
                  output: { edges: [] },
                  task: { id: crypto.randomUUID(), status: 'succeeded' },
                  attempts: [],
                }
              }

              const targetChunkId = matchedChunk[1]!
              return {
                output: {
                  edges: [
                    {
                      fromNodeId: methodNode[1]!,
                      toNodeId: claimNode[1]!,
                      relation: p.slot === 1 ? 'tests' : 'derived_from',
                      confidence: p.slot === 1 ? 0.87 : p.slot === 100 ? 0.91 : 0.93,
                      evidenceChunkId: targetChunkId,
                      quote: p.quote,
                      rationale: `Verified ${p.title} mechanism claim from source passage`,
                    },
                    {
                      fromNodeId: claimNode[1]!,
                      toNodeId: sourceNode[1]!,
                      relation: 'supports',
                      confidence: p.slot === 1 ? 0.82 : p.slot === 100 ? 0.86 : 0.89,
                      evidenceChunkId: targetChunkId,
                      quote: p.quote,
                      rationale: `Claim empirically supports thesis of ${p.title}`,
                    },
                  ],
                },
                task: { id: crypto.randomUUID(), status: 'succeeded' },
                attempts: [],
              }
            }) as any,
            updateTaskStatusFn: vi.fn(),
          })

          expect(outcome.needsOcr).toBe(false)
          expect(outcome.extraction.acceptedClaims).toHaveLength(1)
          expect(outcome.edges.persisted).toBe(true)
          expect(outcome.edges.acceptedEdges.length).toBeGreaterThanOrEqual(2)
          allAcceptedEdges.push(...outcome.edges.acceptedEdges)
        }

        // Verify pgvector pair retrieval ran across all 3 passes
        expect(recordedTaskInputs.every((i) => i.evidenceSelection === 'pair_retrieval')).toBe(true)

        const persistedAccepted = await db
          .select({
            edge: edges,
            chunkText: sourceChunks.text,
            page: sourceChunks.page,
            sourceId: sources.id,
            sourceTitle: sources.title,
          })
          .from(edges)
          .innerJoin(sourceChunks, eq(edges.evidenceChunkId, sourceChunks.id))
          .innerJoin(sources, eq(sourceChunks.sourceId, sources.id))
          .where(and(eq(edges.workspaceId, wsId), eq(edges.status, 'accepted')))

        expect(persistedAccepted.length).toBeGreaterThanOrEqual(6)
        const distinctSources = new Set(persistedAccepted.map((r) => r.sourceId))
        expect(distinctSources.size).toBe(3)

        console.log('\n### Recorded Neon Postgres Storage/pgvector Verification (stubbed callModel, 3 PDFs):')
        console.log(
          '| # | Edge ID | Source Paper | Page | Relation | Confidence | Status | Evidence Chunk ID | Verbatim Check | Quoted Excerpt |',
        )
        console.log('|---|---|---|---|---|---|---|---|---|---|')

        let idx = 1
        for (const row of persistedAccepted) {
          const matched = allAcceptedEdges.find(
            (e) =>
              e.fromNodeId === row.edge.sourceNodeId &&
              e.toNodeId === row.edge.targetNodeId &&
              e.evidenceChunkId === row.edge.evidenceChunkId,
          )
          expect(matched).toBeDefined()
          expect(verifyVerbatimQuote(matched!.matchedQuote, row.chunkText)).toBe(true)
          expect(paperQuoteMap.has(row.sourceTitle)).toBe(true)
          const snippet = matched!.matchedQuote.slice(0, 60).replace(/\n/g, ' ') + '...'
          console.log(
            `| ${idx++} | \`${row.edge.id}\` | ${row.sourceTitle} | ${row.page ?? '?'} | \`${row.edge.relation}\` | ${row.edge.confidence} | \`${row.edge.status}\` | \`${row.edge.evidenceChunkId}\` | VERIFIED_VERBATIM | "${snippet}" |`,
          )
        }
      } finally {
        await cleanupLiveWorkspace(db, wsId)
      }
    },
    60_000,
  )

  const hasMetaKey = Boolean(process.env.META_API_KEY)
  const canRunLiveGemini =
    hasDb &&
    hasGeminiKey &&
    hasAllPapers &&
    process.env.RUN_LIVE_GEMINI_PIPELINE === '1'
  const canRunLiveMeta =
    hasDb &&
    hasGeminiKey &&
    hasMetaKey &&
    hasAllPapers &&
    process.env.RUN_LIVE_META_PIPELINE === '1'

  async function runLiveThreePaperPipeline(pinnedModelId: string) {
    const { getDb } = await import('../../db/client')
    const { edges, sourceChunks, sources, workspaces } = await import('../../db/schema')
    const { embedChunksForWorkspace } = await import('../ingest/embed')
    const { and, eq } = await import('drizzle-orm')

    const db = getDb()
    const wsId = crypto.randomUUID()
    const allReturnedEdges: ValidatedEdge[] = []
    const pinnedCallModel: CallModel = (schema, prompt, ctx) =>
      callModel(schema, prompt, { ...ctx, modelId: pinnedModelId })

    // Rate-limit guard ONLY for live multi-PDF run: gemini-embedding-2 free tier has 30k TPM
    let charsSinceWindow = 0
    const throttledEmbedChunks: typeof embedChunksForWorkspace = async (
      wId,
      items,
      opts,
      deps,
    ) => {
      const batchChars = items.reduce(
        (sum, it) => sum + (typeof it === 'string' ? it.length : it.text.length),
        0,
      )
      if (charsSinceWindow > 0 && charsSinceWindow + batchChars > 95_000) {
        await new Promise((r) => setTimeout(r, 62_000))
        charsSinceWindow = 0
      }
      charsSinceWindow += batchChars
      return embedChunksForWorkspace(wId, items, opts, deps)
    }

    try {
      await db.insert(workspaces).values({
        id: wsId,
        name: 'Three Papers Live Pipeline Test',
        slug: `ws-three-papers-live-${Date.now()}`,
      })

      const paperSpecs = [
        {
          file: 'strobl-2007.pdf',
          title: 'Strobl et al. (2007) — Bias in random forest variable importance measures',
          strategy: 'single_pass' as const,
        },
        {
          file: 'strobl-2008.pdf',
          title: 'Strobl et al. (2008) — Conditional variable importance for random forests',
          strategy: 'sectioned' as const,
        },
        {
          file: 'kursa-2010.pdf',
          title: 'Kursa & Rudnicki (2010) — Feature Selection with the Boruta Package',
          strategy: 'table_first' as const,
        },
      ]

      let latestAllNodes: Array<{
        id: string
        type: string
        title: string
        summary?: string
        sourceId?: string | null
      }> = []

      for (const p of paperSpecs) {
        const outcome = await ingestSourceToGraphForWorkspace({
          db,
          workspaceId: wsId,
          strategy: p.strategy,
          topKChunks: 8,
          source: {
            kind: 'pdf',
            data: fs.readFileSync(path.join(papersDir, p.file)),
            title: p.title,
          },
          callModelFn: pinnedCallModel,
          embedChunksFn: (items, opts, deps) =>
            throttledEmbedChunks(wsId, items, opts, deps),
        })

        expect(outcome.needsOcr).toBe(false)
        latestAllNodes = outcome.allNodes
        allReturnedEdges.push(...outcome.edges.acceptedEdges)
      }

      // Wait briefly before workspace-wide cross-paper consolidation retrieval if total accepted edges < 6
      const acceptedCount = allReturnedEdges.filter((e) => e.status === 'accepted').length
      if (acceptedCount < 6) {
        await new Promise((r) => setTimeout(r, 62_000))
        const crossOutcome = await proposeEdgesForWorkspace(db, {
          workspaceId: wsId,
          nodes: latestAllNodes,
          topKChunks: 12,
          maxPairs: 6,
          topKPerPair: 3,
          callModelFn: pinnedCallModel,
        })
        allReturnedEdges.push(...crossOutcome.acceptedEdges)
      }

      const persistedAccepted = await db
        .select({
          edge: edges,
          chunkText: sourceChunks.text,
          page: sourceChunks.page,
          sourceTitle: sources.title,
        })
        .from(edges)
        .innerJoin(sourceChunks, eq(edges.evidenceChunkId, sourceChunks.id))
        .innerJoin(sources, eq(sourceChunks.sourceId, sources.id))
        .where(and(eq(edges.workspaceId, wsId), eq(edges.status, 'accepted')))

      expect(persistedAccepted.length).toBeGreaterThanOrEqual(6)

      console.log(`\n### Live Neon + ${pinnedModelId} 3-Paper End-to-End Evidence Join:`)
      console.log(
        '| # | Edge ID | Source | Page | Relation | Confidence | Status | Evidence Chunk ID | Quote Verified? | Matched Quote Snippet |',
      )
      console.log('|---|---|---|---|---|---|---|---|---|---|')

      let idx = 1
      for (const row of persistedAccepted) {
        const matched = allReturnedEdges.find(
          (e) =>
            e.fromNodeId === row.edge.sourceNodeId &&
            e.toNodeId === row.edge.targetNodeId &&
            e.evidenceChunkId === row.edge.evidenceChunkId,
        )
        expect(matched).toBeDefined()
        expect(verifyVerbatimQuote(matched!.matchedQuote, row.chunkText)).toBe(true)
        const snippet = matched!.matchedQuote.slice(0, 60).replace(/\n/g, ' ') + '...'
        console.log(
          `| ${idx++} | \`${row.edge.id}\` | ${row.sourceTitle.slice(0, 24)} | ${row.page ?? '?'} | \`${row.edge.relation}\` | ${row.edge.confidence} | \`${row.edge.status}\` | \`${row.edge.evidenceChunkId}\` | VERIFIED_VERBATIM | "${snippet}" |`,
        )
      }
    } finally {
      await cleanupLiveWorkspace(db, wsId)
    }
  }

  it.skipIf(!canRunLiveGemini)(
    'LIVE END-TO-END (OPT-IN): ingests all 3 demo PDFs through Gemini + pgvector + Neon Postgres accumulating >= 6 accepted edges with verified verbatim quotes',
    async () => runLiveThreePaperPipeline(DEFAULT_MODEL_ID),
    300_000,
  )

  it.skipIf(!canRunLiveMeta)(
    'LIVE END-TO-END META (OPT-IN): ingests all 3 demo PDFs through Meta muse-spark-1.3-contributor + pgvector + Neon Postgres accumulating >= 6 accepted edges with verified verbatim quotes',
    async () => runLiveThreePaperPipeline(DEFAULT_META_MODEL_ID),
    600_000,
  )
})
