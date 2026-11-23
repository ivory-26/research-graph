import { callModel as defaultCallModel, type CallModel } from '../model'
import { normalizeQuote, verifyVerbatimQuote } from './quote'
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

/**
 * Validates proposed edges against graph nodes and source chunks (Issue #13).
 *
 * Enforces hard database constraints and invariant pipeline rules:
 * 1. No self-loops: `fromNodeId !== toNodeId` (matches `edges_no_self_loop` check constraint)
 * 2. Node references must exist in the workspace
 * 3. Evidence chunk must exist and contain the quote verbatim (matches `edges_have_evidence` constraint)
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

  const chunkMap = new Map<string, ChunkRef>()
  for (const chunk of chunks) {
    if (chunk.id) chunkMap.set(chunk.id, chunk)
    chunkMap.set(String(chunk.ordinal), chunk)
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

    // 4. Chunk resolution
    let targetChunk = chunkMap.get(edge.evidenceChunkId)
    if (!targetChunk) {
      const parsedOrdinal = parseInt(edge.evidenceChunkId, 10)
      if (!Number.isNaN(parsedOrdinal)) {
        targetChunk = chunks.find((c) => c.ordinal === parsedOrdinal)
      }
    }
    // Fallback: search if quote uniquely matches any chunk
    if (!targetChunk) {
      const match = chunks.find((c) => verifyVerbatimQuote(edge.quote, c.text))
      if (match) {
        targetChunk = match
      }
    }

    if (!targetChunk) {
      rejected.push({ edge, reason: 'CHUNK_NOT_FOUND' })
      continue
    }

    // 5. Verbatim quote validation in evidence chunk
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
      evidenceChunkId: targetChunk.id || String(targetChunk.ordinal),
      matchedQuote: normalizeQuote(edge.quote),
      rationale: edge.rationale.trim(),
    })
  }

  return { accepted, rejected }
}

/**
 * Builds the prompt asking Gemini to propose typed edges between existing workspace nodes.
 */
export function buildProposeEdgesPrompt(
  nodes: NodeSummary[],
  chunks: ChunkRef[],
): string {
  const nodeList = nodes
    .map((n) => `[ID: ${n.id}] (${n.type}) ${n.title}: ${n.summary || ''}`)
    .join('\n')

  const chunkList = chunks
    .map((c) => `--- CHUNK ID: ${c.id || c.ordinal} (Page ${c.page ?? '?'}) ---\n${c.text}`)
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
4. "evidenceChunkId" must be the exact CHUNK ID containing the quote.`
}

export interface ProposeEdgesOptions {
  workspaceId: string
  nodes: NodeSummary[]
  chunks: ChunkRef[]
  /** Injected callModel implementation (defaults to production callModel) */
  callModelFn?: CallModel
}

/**
 * Proposes typed edges between workspace nodes with verbatim evidence validation (Issue #13).
 */
export async function proposeEdges(
  options: ProposeEdgesOptions,
): Promise<ProposeEdgesOutcome> {
  const { workspaceId, nodes, chunks, callModelFn = defaultCallModel } = options

  if (nodes.length < 2 || chunks.length === 0) {
    return { acceptedEdges: [], rejectedEdges: [] }
  }

  const prompt = buildProposeEdgesPrompt(nodes, chunks)

  const result = await callModelFn<ProposeEdgesResult>(
    ProposeEdgesResultSchema,
    prompt,
    {
      workspaceId,
      taskKind: 'propose_edges',
      store: (await import('../model')).agentTaskStore,
      inputRef: { nodeCount: nodes.length, chunkCount: chunks.length },
    },
  )

  const raw = result.output
  const { accepted, rejected } = validateProposedEdges(raw.edges ?? [], nodes, chunks)

  return {
    acceptedEdges: accepted,
    rejectedEdges: rejected,
    taskId: result.task?.id,
  }
}
