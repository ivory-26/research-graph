import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '../../db/client'
import {
  edges,
  nodes as nodesTable,
  sourceChunks as sourceChunksTable,
  sources as sourcesTable,
  type EdgeRow,
} from '../../db/schema'
import { embedQuery, type EmbedDeps } from '../ingest/embed'
import { searchSimilarChunksForWorkspace } from '../ingest/store'
import {
  callModel as defaultCallModel,
  type AgentTaskStore,
  type CallModel,
  agentTaskStore,
} from '../model'
import { MAX_QUOTE_CHARS, normalizeQuote, verifyVerbatimQuote } from './quote'
import type { UpdateTaskStatusFn } from './claims'
import {
  ProposeEdgesResultSchema,
  type ChunkRef,
  type NodeSummary,
  type ProposedEdge,
  type ProposeEdgesOutcome,
  type ProposeEdgesResult,
  type RejectedEdge,
  type ValidatedEdge,
} from './types'

/** Confidence threshold below which edges land as suggested rather than accepted. */
export const ACCEPTANCE_CONFIDENCE_THRESHOLD = 0.65

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Validates proposed edges against graph nodes and source chunks (Issue #13).
 *
 * Enforces hard database constraints and invariant pipeline rules:
 * 1. No self-loops: `fromNodeId !== toNodeId` (matches `edges_no_self_loop` check constraint)
 * 2. Node references must exist in the workspace
 * 3. Evidence chunk must exist, resolve to a valid UUID, and contain the quote verbatim
 *    NO SILENT RE-BINDING: if quote is in chunk-2 but edge cites chunk-1, it is strictly rejected.
 * 4. `confidence < 0.65` lands as `suggested`
 * 5. `contradicts` ALWAYS lands as `suggested`, regardless of confidence
 */
export function validateProposedEdges(
  proposedEdges: ProposedEdge[],
  nodes: NodeSummary[],
  chunks: ChunkRef[],
): { accepted: ValidatedEdge[]; rejected: RejectedEdge[] } {
  const accepted: ValidatedEdge[] = []
  const rejected: RejectedEdge[] = []

  const nodeMap = new Map<string, NodeSummary>()
  for (const node of nodes) {
    nodeMap.set(node.id, node)
  }

  // Key chunkMap only by chunk.id (and namespaced sourceId:ordinal if available).
  // Do NOT key by bare String(ordinal) to prevent cross-source ordinal collisions.
  const chunkMap = new Map<string, ChunkRef>()
  for (const chunk of chunks) {
    if (chunk.id) {
      chunkMap.set(chunk.id, chunk)
    }
    if (chunk.sourceId) {
      chunkMap.set(`${chunk.sourceId}:${chunk.ordinal}`, chunk)
    }
  }

  for (const edge of proposedEdges) {
    // 1. Self-loop check
    if (edge.fromNodeId === edge.toNodeId) {
      rejected.push({ edge, reason: 'SELF_LOOP' })
      continue
    }

    // 2. Node existence check
    const fromNode = nodeMap.get(edge.fromNodeId)
    const toNode = nodeMap.get(edge.toNodeId)
    if (!fromNode || !toNode) {
      rejected.push({ edge, reason: 'INVALID_NODE' })
      continue
    }

    // 3. Quote presence & bounded length check (per-edge rejection so sibling edges survive)
    const rawQuote = edge.quote?.trim()
    if (!rawQuote) {
      rejected.push({ edge, reason: 'QUOTE_EMPTY' })
      continue
    }
    if (normalizeQuote(rawQuote).length > MAX_QUOTE_CHARS) {
      rejected.push({ edge, reason: 'QUOTE_TOO_LONG' })
      continue
    }

    // 3b. Rationale presence check
    const rawRationale = edge.rationale?.trim()
    if (!rawRationale) {
      rejected.push({ edge, reason: 'RATIONALE_EMPTY' })
      continue
    }

    // 4. Chunk resolution: strictly lookup the chunk referenced by evidenceChunkId.
    // Invariant: no silent fallback scanning across all chunks.
    const targetChunk = chunkMap.get(edge.evidenceChunkId)
    if (!targetChunk) {
      rejected.push({ edge, reason: 'CHUNK_NOT_FOUND' })
      continue
    }

    // Invariant: evidenceChunkId MUST resolve to a valid UUID (Postgres uuid FK to source_chunks.id)
    if (!targetChunk.id || !UUID_REGEX.test(targetChunk.id)) {
      rejected.push({ edge, reason: 'CHUNK_NOT_FOUND' })
      continue
    }

    // 5. Verbatim quote validation strictly within the cited evidence chunk (exact case, no dash folding)
    const isVerbatim = verifyVerbatimQuote(edge.quote, targetChunk.text)
    if (!isVerbatim) {
      rejected.push({ edge, reason: 'VERBATIM_QUOTE_NOT_FOUND' })
      continue
    }

    // 6. Status assignment based on confidence and relation
    // Rule: 'contradicts' ALWAYS lands as 'suggested' regardless of confidence
    // Rule: confidence < 0.65 lands as 'suggested', otherwise 'accepted'
    let status: 'suggested' | 'accepted' = 'accepted'
    if (edge.relation === 'contradicts' || edge.confidence < ACCEPTANCE_CONFIDENCE_THRESHOLD) {
      status = 'suggested'
    }

    const boundedRationale =
      rawRationale.length > 240 ? rawRationale.slice(0, 240).trimEnd() : rawRationale

    accepted.push({
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      relation: edge.relation,
      confidence: edge.confidence,
      status,
      evidenceChunkId: targetChunk.id,
      matchedQuote: normalizeQuote(edge.quote),
      rationale: boundedRationale,
    })
  }

  return { accepted, rejected }
}

/**
 * Builds the prompt asking Gemini to propose typed edges between existing workspace nodes.
 * Caps the evidence chunks to top-k (default: 8) to maintain focus and prevent token exhaustion.
 */
export function buildProposeEdgesPrompt(
  nodes: NodeSummary[],
  chunks: ChunkRef[],
  options?: { topKChunks?: number },
): string {
  const topK = Math.max(1, options?.topKChunks ?? 8)
  const selectedChunks = chunks.slice(0, topK)

  const nodeList = nodes
    .map((n) => `[ID: ${n.id}] (${n.type}) ${n.title}: ${n.summary || ''}`)
    .join('\n')

  const chunkList = selectedChunks
    .map((c) => `--- CHUNK ID: ${c.id} (Page ${c.page ?? '?'}) ---\n${c.text}`)
    .join('\n\n')

  return `WORKSPACE NODES:
${nodeList}

EVIDENCE CHUNKS:
${chunkList}

INSTRUCTIONS:
You are an expert scientific graph analyzer. Identify and propose typed relationship edges between the workspace nodes above.

Allowed Relations:
- "supports": Claim/result provides direct theoretical or empirical backing for another claim.
- "contradicts": Claim/finding explicitly disagrees with or questions another claim.
- "cites": Paper/author explicitly cites another paper, technique, or result.
- "uses_dataset": Method or experiment evaluates on a specific dataset.
- "tests": An experiment or benchmark explicitly tests a claim.
- "derived_from": A method or claim builds directly upon a prior method/concept.

RULES:
1. No self-loops: fromNodeId and toNodeId MUST be different.
2. Every edge MUST have an exact, VERBATIM quote from one of the evidence chunks proving this relationship (keep each quote concise, <= 400 characters).
3. Assign a calibrated confidence score between 0.0 and 1.0 based on how directly the quote substantiates the relation.
4. "evidenceChunkId" must be the exact CHUNK ID containing the quote.
5. "rationale": required brief explanation under 240 characters.
6. Limit proposals to at most 12 edges.`
}

export interface ProposeEdgesOptions {
  workspaceId: string
  nodes: NodeSummary[]
  chunks: ChunkRef[]
  topKChunks?: number
  strategyId?: string | null
  /** Stable identifier for the extraction batch that produced these nodes. */
  runId?: string | null
  /** Optional human-readable label stored beside `runId`. Never inferred. */
  runLabel?: string | null
  /** Audit trail indicating how candidate evidence chunks were assembled for this call. */
  evidenceSelection?: 'pair_retrieval' | 'caller_chunks' | 'fallback_slice'
  db?: Database
  /** Fail fast if no database handle was supplied rather than returning unpersisted edges. */
  requirePersistence?: boolean
  storeEdgesFn?: typeof storeEdges
  /** Injected callModel implementation (defaults to production callModel) */
  callModelFn?: CallModel
  /** Injected task updater (defaults to Neon direct update) */
  updateTaskStatusFn?: UpdateTaskStatusFn
  /** Injected task store (defaults to the production Drizzle store). */
  taskStore?: AgentTaskStore
}

export interface RetrieveNodePairChunksOptions {
  strategyId?: string | null
  topKPerPair?: number
  maxPairs?: number
  maxChunks?: number
  minSimilarity?: number
  embedDeps?: EmbedDeps
  embedQueryFn?: typeof embedQuery
  searchSimilarChunksFn?: typeof searchSimilarChunksForWorkspace
}

export interface ProposeEdgesForWorkspaceOptions
  extends Omit<ProposeEdgesOptions, 'db' | 'chunks' | 'requirePersistence'> {
  /** Optional explicit candidate chunks; when omitted, retrieves top-k chunks per node pair via pgvector. */
  chunks?: ChunkRef[]
  topKPerPair?: number
  maxPairs?: number
  minSimilarity?: number
  embedDeps?: EmbedDeps
  embedQueryFn?: typeof embedQuery
  searchSimilarChunksFn?: typeof searchSimilarChunksForWorkspace
  retrieveChunksFn?: typeof retrieveCandidateChunksForNodes
}

/**
 * Selects distinct node pairs prioritizing cross-source pairs first so cross-paper
 * relationships compete fairly within the `maxPairs` sequential query budget.
 */
function buildPrioritizedNodePairs(
  nodes: NodeSummary[],
  maxPairs: number,
): Array<[NodeSummary, NodeSummary]> {
  const crossSource: Array<[NodeSummary, NodeSummary]> = []
  const sameSource: Array<[NodeSummary, NodeSummary]> = []

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!
      const b = nodes[j]!
      if (a.id === b.id) continue
      if (a.sourceId && b.sourceId && a.sourceId !== b.sourceId) {
        crossSource.push([a, b])
      } else {
        sameSource.push([a, b])
      }
    }
  }

  return [...crossSource, ...sameSource].slice(0, Math.max(1, maxPairs))
}

/**
 * Retrieves top-k workspace-scoped evidence chunks for prioritized node pairs
 * using pgvector similarity search (docs/03 PROPOSE_EDGES input contract).
 * Executes sequential embedding + DB queries (never parallel calls).
 */
export async function retrieveCandidateChunksForNodes(
  db: Database,
  workspaceId: string,
  nodes: NodeSummary[],
  options: RetrieveNodePairChunksOptions = {},
): Promise<ChunkRef[]> {
  if (nodes.length < 2) return []

  const topKPerPair = Math.max(1, options.topKPerPair ?? 3)
  const maxPairs = Math.max(1, options.maxPairs ?? 6)
  const maxChunks = Math.max(1, options.maxChunks ?? 8)
  const embedFn = options.embedQueryFn ?? embedQuery
  const searchFn = options.searchSimilarChunksFn ?? searchSimilarChunksForWorkspace

  const validStrategyId =
    options.strategyId && UUID_REGEX.test(options.strategyId) ? options.strategyId : null

  const pairs = buildPrioritizedNodePairs(nodes, maxPairs)
  const byChunkId = new Map<string, { chunk: ChunkRef; similarity: number }>()

  // docs/03: Issue embedding calls strictly sequentially
  for (const [a, b] of pairs) {
    const queryText = [a.title, a.summary, b.title, b.summary]
      .filter((part): part is string => Boolean(part && part.trim().length > 0))
      .join(' — ')
      .slice(0, 600)

    if (!queryText.trim()) continue

    const queryEmbedding = await embedFn(
      queryText,
      {
        workspaceId,
        taskKind: 'propose_edges',
        strategyId: validStrategyId,
      },
      options.embedDeps ?? {},
    )

    const hits = await searchFn(db, workspaceId, {
      queryEmbedding,
      topK: topKPerPair,
      minSimilarity: options.minSimilarity,
    })

    for (const hit of hits) {
      const existing = byChunkId.get(hit.chunk.id)
      if (!existing || hit.similarity > existing.similarity) {
        byChunkId.set(hit.chunk.id, {
          chunk: {
            id: hit.chunk.id,
            ordinal: hit.chunk.ordinal,
            page: hit.chunk.page,
            text: hit.chunk.text,
          },
          similarity: hit.similarity,
        })
      }
    }
  }

  return [...byChunkId.values()]
    .sort((x, y) => y.similarity - x.similarity)
    .slice(0, maxChunks)
    .map((entry) => entry.chunk)
}

/**
 * Proposes typed edges between workspace nodes with verbatim evidence validation (Issue #13).
 */
export async function proposeEdges(
  options: ProposeEdgesOptions,
): Promise<ProposeEdgesOutcome> {
  const { workspaceId, nodes, chunks, callModelFn = defaultCallModel } = options

  if (options.requirePersistence && !options.db) {
    throw new Error('proposeEdges requires a database handle when requirePersistence is true.')
  }

  if (nodes.length < 2 || chunks.length === 0) {
    return { acceptedEdges: [], rejectedEdges: [], persisted: false }
  }

  const topK = Math.max(1, options.topKChunks ?? 8)
  const selectedChunks = chunks.slice(0, topK)

  // Enforce that rendered evidence chunks carry valid UUIDs so proposed edges can be persisted
  for (const chunk of selectedChunks) {
    if (!chunk.id || !UUID_REGEX.test(chunk.id)) {
      throw new Error(
        `Every chunk passed to proposeEdges must have a valid UUID id. Received: ${chunk.id}`,
      )
    }
  }

  const validStrategyId =
    options.strategyId && UUID_REGEX.test(options.strategyId) ? options.strategyId : null
  const runId = options.runId?.trim() || null
  const runLabel = options.runLabel?.trim() || null
  const taskStore = options.taskStore ?? agentTaskStore

  const prompt = buildProposeEdgesPrompt(nodes, selectedChunks, { topKChunks: topK })

  const result = await callModelFn<ProposeEdgesResult>(
    ProposeEdgesResultSchema,
    prompt,
    {
      workspaceId,
      taskKind: 'propose_edges',
      strategyId: validStrategyId,
      store: taskStore,
      inputRef: {
        nodeCount: nodes.length,
        chunkCount: selectedChunks.length,
        evidenceSelection: options.evidenceSelection ?? 'caller_chunks',
        ...(runId ? { extractionRunId: runId } : {}),
        ...(runLabel ? { extractionRunLabel: runLabel } : {}),
        ...(options.strategyId ? { strategy: options.strategyId } : {}),
      },
    },
  )

  const raw = result.output
  // Invariant: validate strictly against selectedChunks (chunks that were rendered into prompt)
  const { accepted, rejected } = validateProposedEdges(raw.edges ?? [], nodes, selectedChunks)

  // docs/03: When no proposed edges survive validation, mark the task as rejected
  if (result.task?.id && accepted.length === 0) {
    result.task.status = 'rejected'
    const updateStatus =
      options.updateTaskStatusFn ??
      (async (taskId, status, error) => {
        if (process.env.DATABASE_URL && UUID_REGEX.test(taskId)) {
          const { getDb } = await import('../../db/client')
          const { agentTasks } = await import('../../db/schema')
          const { eq } = await import('drizzle-orm')
          await getDb()
            .update(agentTasks)
            .set({ status, error: error ?? null })
            .where(eq(agentTasks.id, taskId))
        }
      })

    const rejectReason =
      (raw.edges ?? []).length === 0
        ? 'Model returned no proposed edges.'
        : 'All proposed edges were rejected due to unverified verbatim quotes or constraint violations.'

    await updateStatus(result.task.id, 'rejected', rejectReason)
  }

  let storedRows: EdgeRow[] | undefined
  let persisted = false
  const storeFn = options.storeEdgesFn ?? storeEdges
  if (options.db && accepted.length > 0) {
    storedRows = await storeFn(options.db, workspaceId, accepted)
    persisted = true
  }

  return {
    acceptedEdges: accepted,
    rejectedEdges: rejected,
    storedRows,
    persisted,
    taskId: result.task?.id,
  }
}

/**
 * Production wrapper enforcing mandatory database persistence for workspace edge proposals
 * and retrieving top-k candidate evidence chunks per node pair when chunks are omitted.
 */
export async function proposeEdgesForWorkspace(
  db: Database,
  options: ProposeEdgesForWorkspaceOptions,
): Promise<ProposeEdgesOutcome> {
  if (options.nodes.length < 2) {
    return { acceptedEdges: [], rejectedEdges: [], persisted: false }
  }

  const retrieveFn = options.retrieveChunksFn ?? retrieveCandidateChunksForNodes
  const candidateChunks =
    options.chunks !== undefined
      ? options.chunks
      : await retrieveFn(db, options.workspaceId, options.nodes, {
          strategyId: options.strategyId,
          topKPerPair: options.topKPerPair,
          maxPairs: options.maxPairs,
          maxChunks: options.topKChunks ?? 8,
          minSimilarity: options.minSimilarity,
          embedDeps: options.embedDeps,
          embedQueryFn: options.embedQueryFn,
          searchSimilarChunksFn: options.searchSimilarChunksFn,
        })

  const evidenceSelection =
    options.evidenceSelection ??
    (options.chunks !== undefined ? 'caller_chunks' : 'pair_retrieval')

  return proposeEdges({
    workspaceId: options.workspaceId,
    nodes: options.nodes,
    chunks: candidateChunks,
    topKChunks: options.topKChunks,
    strategyId: options.strategyId,
    runId: options.runId,
    runLabel: options.runLabel,
    evidenceSelection,
    db,
    requirePersistence: true,
    storeEdgesFn: options.storeEdgesFn,
    callModelFn: options.callModelFn,
    updateTaskStatusFn: options.updateTaskStatusFn,
    taskStore: options.taskStore,
  })
}

/**
 * Persists accepted edges into the database inside a transaction.
 * Satisfies the `edges_have_evidence` foreign key / check constraint.
 */
export async function storeEdges(
  db: Database,
  workspaceId: string,
  edgesToStore: ValidatedEdge[],
): Promise<EdgeRow[]> {
  if (edgesToStore.length === 0) return []

  const uniqueNodeIds = new Set<string>()
  const uniqueChunkIds = new Set<string>()
  for (const edge of edgesToStore) {
    if (
      !UUID_REGEX.test(edge.fromNodeId) ||
      !UUID_REGEX.test(edge.toNodeId) ||
      !UUID_REGEX.test(edge.evidenceChunkId)
    ) {
      throw new Error(
        `Invalid UUID in edge persistence: fromNodeId=${edge.fromNodeId}, toNodeId=${edge.toNodeId}, evidenceChunkId=${edge.evidenceChunkId}`,
      )
    }
    uniqueNodeIds.add(edge.fromNodeId)
    uniqueNodeIds.add(edge.toNodeId)
    uniqueChunkIds.add(edge.evidenceChunkId)
  }

  return await db.transaction(async (tx) => {
    const ownedNodes = await tx
      .select({ id: nodesTable.id })
      .from(nodesTable)
      .where(
        and(
          eq(nodesTable.workspaceId, workspaceId),
          inArray(nodesTable.id, [...uniqueNodeIds]),
        ),
      )

    const ownedNodeIds = new Set(ownedNodes.map((n) => n.id))
    for (const nodeId of uniqueNodeIds) {
      if (!ownedNodeIds.has(nodeId)) {
        throw new Error(
          `Cross-workspace or missing node in edge persistence: node ${nodeId} does not belong to workspace ${workspaceId}`,
        )
      }
    }

    const ownedChunks = await tx
      .select({ id: sourceChunksTable.id })
      .from(sourceChunksTable)
      .innerJoin(sourcesTable, eq(sourceChunksTable.sourceId, sourcesTable.id))
      .where(
        and(
          eq(sourcesTable.workspaceId, workspaceId),
          inArray(sourceChunksTable.id, [...uniqueChunkIds]),
        ),
      )

    const ownedChunkIds = new Set(ownedChunks.map((c) => c.id))
    for (const chunkId of uniqueChunkIds) {
      if (!ownedChunkIds.has(chunkId)) {
        throw new Error(
          `Cross-workspace or missing evidence chunk in edge persistence: chunk ${chunkId} does not belong to workspace ${workspaceId}`,
        )
      }
    }

    const inserted: EdgeRow[] = []
    for (const edge of edgesToStore) {
      const rows = await tx
        .insert(edges)
        .values({
          workspaceId,
          sourceNodeId: edge.fromNodeId,
          targetNodeId: edge.toNodeId,
          relation: edge.relation,
          confidence: edge.confidence,
          status: edge.status,
          evidenceChunkId: edge.evidenceChunkId,
        })
        .returning()
      if (rows[0]) inserted.push(rows[0])
    }
    return inserted
  })
}
