import type { Database } from '../../db/client'
import { edges, type EdgeRow } from '../../db/schema'
import { callModel as defaultCallModel, type CallModel, agentTaskStore } from '../model'
import { normalizeQuote, verifyVerbatimQuote } from './quote'
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

    // 3. Quote presence check
    const rawQuote = edge.quote?.trim()
    if (!rawQuote) {
      rejected.push({ edge, reason: 'QUOTE_EMPTY' })
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

    accepted.push({
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      relation: edge.relation,
      confidence: edge.confidence,
      status,
      evidenceChunkId: targetChunk.id,
      matchedQuote: normalizeQuote(edge.quote),
      rationale: (edge.rationale || '').trim(),
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
  const topK = options?.topKChunks ?? 8
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
2. Every edge MUST have an exact, VERBATIM quote from one of the evidence chunks proving this relationship.
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
  db?: Database
  storeEdgesFn?: typeof storeEdges
  /** Injected callModel implementation (defaults to production callModel) */
  callModelFn?: CallModel
  /** Injected task updater (defaults to Neon direct update) */
  updateTaskStatusFn?: UpdateTaskStatusFn
}

/**
 * Proposes typed edges between workspace nodes with verbatim evidence validation (Issue #13).
 */
export async function proposeEdges(
  options: ProposeEdgesOptions,
): Promise<ProposeEdgesOutcome> {
  const { workspaceId, nodes, chunks, topKChunks, callModelFn = defaultCallModel } = options

  if (nodes.length < 2 || chunks.length === 0) {
    return { acceptedEdges: [], rejectedEdges: [] }
  }

  // Enforce that evidence chunks carry valid UUIDs so proposed edges can be persisted
  for (const chunk of chunks) {
    if (!chunk.id || !UUID_REGEX.test(chunk.id)) {
      throw new Error(
        `Every chunk passed to proposeEdges must have a valid UUID id. Received: ${chunk.id}`,
      )
    }
  }

  const prompt = buildProposeEdgesPrompt(nodes, chunks, { topKChunks })
  const topK = options.topKChunks ?? chunks.length
  const selectedChunks = chunks.slice(0, topK)

  const result = await callModelFn<ProposeEdgesResult>(
    ProposeEdgesResultSchema,
    prompt,
    {
      workspaceId,
      taskKind: 'propose_edges',
      store: agentTaskStore,
      inputRef: { nodeCount: nodes.length, chunkCount: selectedChunks.length },
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
  const storeFn = options.storeEdgesFn ?? storeEdges
  if (options.db && accepted.length > 0) {
    storedRows = await storeFn(options.db, workspaceId, accepted)
  }

  return {
    acceptedEdges: accepted,
    rejectedEdges: rejected,
    storedRows,
    taskId: result.task?.id,
  }
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

  return await db.transaction(async (tx) => {
    const inserted: EdgeRow[] = []
    for (const edge of edgesToStore) {
      if (
        !UUID_REGEX.test(edge.fromNodeId) ||
        !UUID_REGEX.test(edge.toNodeId) ||
        !UUID_REGEX.test(edge.evidenceChunkId)
      ) {
        continue
      }
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
