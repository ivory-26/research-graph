import { randomUUID } from 'node:crypto'
import { and, asc, eq, ne } from 'drizzle-orm'
import type { Database } from '../../db/client'
import {
  edges as edgesTable,
  nodes as nodesTable,
  sourceChunks as sourceChunksTable,
  sources as sourcesTable,
  type NewEdge,
  type NewNode,
  type NodeRow,
  type SourceChunkRow,
  type SourceRow,
} from '../../db/schema'
import type { NodeData } from '../../shared/types'
import {
  ingestWebSource,
  type FirecrawlDeps,
  type IngestWebSourceOptions,
} from '../firecrawl'
import type { EmbedDeps, embedChunks, embedQuery } from '../ingest/embed'
import { ingestPdfSource } from '../ingest/pdf'
import type { searchSimilarChunksForWorkspace } from '../ingest/store'
import type { ChunkOptions } from '../ingest/types'
import type { AgentTaskStore, CallModel } from '../model'
import {
  extractClaims,
  type ExtractionStrategy,
  type UpdateTaskStatusFn,
} from './claims'
import {
  proposeEdgesForWorkspace,
  retrieveCandidateChunksForNodes,
  storeEdges,
} from './edges'
import type {
  ChunkRef,
  ExtractionOutcome,
  NodeSummary,
  ProposeEdgesOutcome,
} from './types'

export type WorkspaceSourceInput =
  | {
      kind: 'pdf'
      data: Uint8Array | ArrayBuffer
      title: string
      url?: string | null
      doi?: string | null
      meta?: Record<string, unknown>
      chunkOptions?: ChunkOptions
    }
  | {
      kind: 'web'
      url: string
      title?: string
      sourceKind?: 'web' | 'repo'
      scrapeOptions?: Omit<IngestWebSourceOptions, 'workspaceId'>
      firecrawlDeps?: FirecrawlDeps
    }

export interface IngestSourceToGraphOptions {
  db?: Database
  workspaceId: string
  source: WorkspaceSourceInput
  strategy?: ExtractionStrategy
  strategyId?: string | null
  /**
   * Stable identifier for this ingestion's extraction batch. EXTRACT_CLAIMS
   * and PROPOSE_EDGES rows carry it; omission leaves them unattributed.
   */
  runId?: string | null
  /** Optional human-readable label stored beside `runId`. Never inferred. */
  runLabel?: string | null
  /** Injected task store for tests using a disposable database. */
  taskStore?: AgentTaskStore
  maxChars?: number
  topKChunks?: number
  /**
   * Controls per-pair vector retrieval for PROPOSE_EDGES (`docs/03-agent-pipeline.md`).
   * Defaults to `true` unless `existingChunks` is explicitly provided; falls back to a balanced
   * workspace slice only if pair retrieval returns zero chunks.
   */
  retrieveForEdges?: boolean
  /** Optional pre-supplied workspace nodes (overrides querying existing nodes from db). */
  existingNodes?: NodeSummary[]
  /** Optional pre-supplied extra chunks (e.g., from earlier workspace sources). */
  existingChunks?: ChunkRef[]
  // Dependency injections for testing without live API keys
  ingestPdfSourceFn?: typeof ingestPdfSource
  ingestWebSourceFn?: typeof ingestWebSource
  embedChunksFn?: typeof embedChunks
  embedQueryFn?: typeof embedQuery
  embedDeps?: EmbedDeps
  searchSimilarChunksFn?: typeof searchSimilarChunksForWorkspace
  extractClaimsFn?: typeof extractClaims
  proposeEdgesFn?: typeof proposeEdgesForWorkspace
  retrieveChunksFn?: typeof retrieveCandidateChunksForNodes
  callModelFn?: CallModel
  updateTaskStatusFn?: UpdateTaskStatusFn
  storeEdgesFn?: typeof storeEdges
}

export interface IngestSourceToGraphOutcome {
  source: SourceRow
  chunks: SourceChunkRow[]
  chunkCount: number
  needsOcr: boolean
  extraction: ExtractionOutcome
  createdNodes: NodeRow[]
  allNodes: NodeSummary[]
  edges: ProposeEdgesOutcome
}

function summarizeNodeRow(row: Pick<NodeRow, 'id' | 'type' | 'title' | 'data' | 'sourceId'>): NodeSummary {
  const data = row.data
  let summary = ''
  if (data.type === 'claim') {
    summary = data.text
  } else if (data.type === 'method') {
    summary = data.summary
  } else if (data.type === 'dataset') {
    summary = data.name
  } else if (data.type === 'source') {
    summary = `${data.kind}: ${row.title}`
  }

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    summary,
    sourceId: row.sourceId,
  }
}

function buildNodesFromExtraction(
  workspaceId: string,
  source: SourceRow,
  extraction: ExtractionOutcome,
  chunkRows: SourceChunkRow[],
): { nodes: NewNode[]; structuralEdges: NewEdge[] } {
  // Node ids are minted here rather than by the database so a structural edge
  // can name its endpoints without relying on INSERT ... RETURNING row order.
  const sourceNodeId = randomUUID()
  const items: NewNode[] = [
    {
      id: sourceNodeId,
      workspaceId,
      type: 'source',
      title: source.title,
      sourceId: source.id,
      data: {
        type: 'source',
        sourceId: source.id,
        kind: source.kind,
      } satisfies NodeData,
    },
  ]

  // A claim was read out of exactly one source chunk, so the source→claim edge
  // is a deterministic fact, not another model judgement. The chunk id is the
  // evidence the database requires; no edge is written when the claim cannot be
  // tied back to a persisted chunk.
  const chunkIdByOrdinal = new Map<number, string>()
  for (const chunk of chunkRows) {
    chunkIdByOrdinal.set(chunk.ordinal, chunk.id)
  }

  const structuralEdges: NewEdge[] = []

  for (const claim of extraction.acceptedClaims) {
    const hasReportedMeta =
      (claim.metric !== null && claim.metric !== undefined) ||
      (claim.reportedValue !== null && claim.reportedValue !== undefined)

    const claimNodeId = randomUUID()
    items.push({
      id: claimNodeId,
      workspaceId,
      type: 'claim',
      title: claim.text.slice(0, 140),
      sourceId: source.id,
      data: {
        type: 'claim',
        text: claim.text,
        reported: hasReportedMeta
          ? {
              metric: claim.metric ?? claim.text.slice(0, 80),
              value: claim.reportedValue ?? null,
              comparator: claim.comparator ?? null,
              against: claim.againstValue ?? null,
              quote: claim.quote,
            }
          : null,
        datasetName: claim.datasetName ?? null,
        methodName: claim.methodName ?? null,
        locator: {
          page: claim.page ?? 1,
          quote: claim.quote,
        },
      } satisfies NodeData,
    })

    const evidenceChunkId = chunkIdByOrdinal.get(claim.chunkOrdinal)
    if (evidenceChunkId) {
      structuralEdges.push({
        workspaceId,
        sourceNodeId,
        targetNodeId: claimNodeId,
        relation: 'supports',
        status: 'accepted',
        evidenceChunkId,
        confidence: 1,
      })
    }
  }

  const primaryLibraryUrl = extraction.codeUrls[0] ?? null
  for (const method of extraction.methods) {
    items.push({
      workspaceId,
      type: 'method',
      title: method.name,
      sourceId: source.id,
      data: {
        type: 'method',
        summary: method.summary,
        library: primaryLibraryUrl,
      } satisfies NodeData,
    })
  }

  for (const dataset of extraction.datasets) {
    items.push({
      workspaceId,
      type: 'dataset',
      title: dataset.name,
      sourceId: source.id,
      data: {
        type: 'dataset',
        name: dataset.name,
        url: dataset.url ?? null,
        sha256: null,
        rows: null,
      } satisfies NodeData,
    })
  }

  return { nodes: items, structuralEdges }
}

function dedupeChunks(chunks: ChunkRef[]): ChunkRef[] {
  const seen = new Set<string>()
  const out: ChunkRef[] = []
  for (const chunk of chunks) {
    if (!chunk.id || seen.has(chunk.id)) continue
    seen.add(chunk.id)
    out.push(chunk)
  }
  return out
}

function buildBalancedWorkspaceChunks(
  currentChunks: ChunkRef[],
  priorChunks: ChunkRef[],
  topK: number,
): ChunkRef[] {
  if (priorChunks.length === 0) {
    return dedupeChunks(currentChunks)
  }
  const priorBudget = Math.max(1, Math.floor(topK / 2))
  const currentBudget = Math.max(1, topK - priorBudget)
  return dedupeChunks([
    ...currentChunks.slice(0, currentBudget),
    ...priorChunks.slice(0, priorBudget),
    ...currentChunks,
    ...priorChunks,
  ])
}

/**
 * Unified workspace-scoped ingestion-to-graph pipeline (`docs/07-workstreams.md`):
 * 1. Ingests PDF (`ingestPdfSource`) or Web/Repo (`ingestWebSource`) with sequential
 *    `gemini-embedding-2` embeddings and atomic `sources` + `source_chunks` persistence.
 * 2. Stops early without model/embedding calls if a PDF needs OCR (`needsOcr: true`).
 * 3. Runs `extractClaims` (`single_pass`, `sectioned`, or `table_first`) against persisted UUID chunks.
 * 4. Persists extracted `source`, `claim`, `method`, and `dataset` nodes atomically.
 * 5. Runs `proposeEdgesForWorkspace` against combined workspace nodes and workspace-verified
 *    chunks (persisted in Postgres `edges` respecting `edges_have_evidence` + tenant isolation).
 */
export async function ingestSourceToGraphForWorkspace(
  options: IngestSourceToGraphOptions,
): Promise<IngestSourceToGraphOutcome> {
  const workspaceId = options.workspaceId.trim()
  if (!workspaceId) {
    throw new Error('workspaceId is required for ingestSourceToGraphForWorkspace.')
  }

  let db = options.db
  if (!db) {
    const { getDb } = await import('../../db/client')
    db = getDb()
  }

  // 1. Stage: INGEST_SOURCE
  let sourceRow: SourceRow
  let chunkRows: SourceChunkRow[]
  let needsOcr = false

  if (options.source.kind === 'pdf') {
    const pdfIngestFn = options.ingestPdfSourceFn ?? ingestPdfSource
    const res = await pdfIngestFn(
      options.source.data,
      {
        workspaceId,
        title: options.source.title,
        url: options.source.url,
        doi: options.source.doi,
        meta: options.source.meta,
        chunkOptions: options.source.chunkOptions,
        strategyId: options.strategyId,
      },
      {
        db,
        embedChunksFn: options.embedChunksFn,
        embedDeps: options.embedDeps,
      },
    )
    sourceRow = res.source
    chunkRows = res.chunks
    needsOcr = res.needsOcr
  } else {
    const webIngestFn = options.ingestWebSourceFn ?? ingestWebSource
    const res = await webIngestFn(
      options.source.url,
      {
        ...options.source.scrapeOptions,
        workspaceId,
        title: options.source.title ?? options.source.scrapeOptions?.title,
        kind: options.source.sourceKind ?? options.source.scrapeOptions?.kind,
      },
      {
        ...options.source.firecrawlDeps,
        db,
        embedChunksFn: options.source.firecrawlDeps?.embedChunksFn ?? options.embedChunksFn,
        embedDeps: options.source.firecrawlDeps?.embedDeps ?? options.embedDeps,
      },
    )
    sourceRow = res.source
    chunkRows = res.chunkRows
  }

  const emptyExtraction: ExtractionOutcome = {
    acceptedClaims: [],
    rejectedClaims: [],
    datasets: [],
    methods: [],
    codeUrls: [],
  }

  if (needsOcr || chunkRows.length === 0) {
    return {
      source: sourceRow,
      chunks: chunkRows,
      chunkCount: chunkRows.length,
      needsOcr,
      extraction: emptyExtraction,
      createdNodes: [],
      allNodes: options.existingNodes ?? [],
      edges: { acceptedEdges: [], rejectedEdges: [], persisted: false },
    }
  }

  // Load prior nodes strictly scoped to workspaceId before adding the new source's nodes
  const priorNodes: NodeSummary[] =
    options.existingNodes ??
    (typeof db.select === 'function'
      ? (
          await db
            .select({
              id: nodesTable.id,
              type: nodesTable.type,
              title: nodesTable.title,
              data: nodesTable.data,
              sourceId: nodesTable.sourceId,
            })
            .from(nodesTable)
            .where(eq(nodesTable.workspaceId, workspaceId))
        ).map(summarizeNodeRow)
      : [])

  const persistedChunkRefs: ChunkRef[] = chunkRows.map((c) => ({
    id: c.id,
    ordinal: c.ordinal,
    page: c.page,
    text: c.text,
  }))

  // 2. Stage: EXTRACT_CLAIMS (uses real persisted Postgres chunk UUIDs)
  const extractFn = options.extractClaimsFn ?? extractClaims
  const extraction = await extractFn({
    workspaceId,
    sourceId: sourceRow.id,
    chunks: persistedChunkRefs,
    sourceTitle: sourceRow.title,
    strategy: options.strategy ?? 'single_pass',
    strategyId: options.strategyId ?? null,
    runId: options.runId ?? null,
    runLabel: options.runLabel ?? null,
    maxChars: options.maxChars,
    callModelFn: options.callModelFn,
    updateTaskStatusFn: options.updateTaskStatusFn,
    taskStore: options.taskStore,
  })

  // 3. Persist extracted source/claim/method/dataset nodes and the structural
  //    source→claim edges in one atomic transaction. The claim→source link is
  //    grounded in the chunk the quote was verified against, so the graph is
  //    connected without depending on the model proposing that edge too.
  const { nodes: nodesToInsert, structuralEdges } = buildNodesFromExtraction(
    workspaceId,
    sourceRow,
    extraction,
    chunkRows,
  )
  const createdNodes: NodeRow[] =
    nodesToInsert.length > 0
      ? await db.transaction(async (tx) => {
          const insertedNodes = await tx
            .insert(nodesTable)
            .values(nodesToInsert)
            .returning()
          if (structuralEdges.length > 0) {
            // `.returning()` is not needed for the caller, but it makes the
            // insert execute through the same interface the test adapters and
            // Drizzle both implement.
            await tx.insert(edgesTable).values(structuralEdges).returning({ id: edgesTable.id })
          }
          return insertedNodes
        })
      : []

  const allNodes: NodeSummary[] = [...priorNodes, ...createdNodes.map(summarizeNodeRow)]

  // 4. Stage: PROPOSE_EDGES
  if (allNodes.length < 2) {
    return {
      source: sourceRow,
      chunks: chunkRows,
      chunkCount: chunkRows.length,
      needsOcr: false,
      extraction,
      createdNodes,
      allNodes,
      edges: { acceptedEdges: [], rejectedEdges: [], persisted: false },
    }
  }

  const topK = Math.max(1, options.topKChunks ?? 8)
  const usePairRetrieval =
    options.retrieveForEdges ?? options.existingChunks === undefined

  const loadFallbackChunks = async (): Promise<ChunkRef[]> => {
    let priorChunks: ChunkRef[] = options.existingChunks ?? []
    if (!options.existingChunks && priorNodes.length > 0 && typeof db.select === 'function') {
      priorChunks = await db
        .select({
          id: sourceChunksTable.id,
          ordinal: sourceChunksTable.ordinal,
          page: sourceChunksTable.page,
          text: sourceChunksTable.text,
        })
        .from(sourceChunksTable)
        .innerJoin(sourcesTable, eq(sourceChunksTable.sourceId, sourcesTable.id))
        .where(
          and(
            eq(sourcesTable.workspaceId, workspaceId),
            ne(sourceChunksTable.sourceId, sourceRow.id),
          ),
        )
        .orderBy(asc(sourceChunksTable.ordinal))
        .limit(topK)
    }
    return buildBalancedWorkspaceChunks(persistedChunkRefs, priorChunks, topK)
  }

  let edgeChunks: ChunkRef[]
  let evidenceSelection: 'pair_retrieval' | 'caller_chunks' | 'fallback_slice'

  if (usePairRetrieval) {
    const retrieveFn = options.retrieveChunksFn ?? retrieveCandidateChunksForNodes
    const retrieved = await retrieveFn(db, workspaceId, allNodes, {
      strategyId: options.strategyId ?? null,
      maxChunks: topK,
      embedDeps: options.embedDeps,
      embedQueryFn: options.embedQueryFn,
      searchSimilarChunksFn: options.searchSimilarChunksFn,
    })

    if (retrieved.length > 0) {
      edgeChunks = dedupeChunks([...retrieved, ...persistedChunkRefs])
      evidenceSelection = 'pair_retrieval'
    } else {
      edgeChunks = await loadFallbackChunks()
      evidenceSelection = 'fallback_slice'
    }
  } else {
    edgeChunks = await loadFallbackChunks()
    evidenceSelection = options.existingChunks !== undefined ? 'caller_chunks' : 'fallback_slice'
  }

  const proposeFn = options.proposeEdgesFn ?? proposeEdgesForWorkspace
  const edgesOutcome = await proposeFn(db, {
    workspaceId,
    nodes: allNodes,
    chunks: edgeChunks,
    topKChunks: topK,
    strategyId: options.strategyId ?? null,
    strategyName: options.strategy ?? 'single_pass',
    runId: options.runId ?? null,
    runLabel: options.runLabel ?? null,
    evidenceSelection,
    existingEdges: structuralEdges,
    callModelFn: options.callModelFn,
    updateTaskStatusFn: options.updateTaskStatusFn,
    storeEdgesFn: options.storeEdgesFn,
    taskStore: options.taskStore,
  })

  return {
    source: sourceRow,
    chunks: chunkRows,
    chunkCount: chunkRows.length,
    needsOcr: false,
    extraction,
    createdNodes,
    allNodes,
    edges: edgesOutcome,
  }
}
