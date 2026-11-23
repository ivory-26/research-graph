import { z } from 'zod'
import type { EdgeRow } from '../../db/schema'

/**
 * Zod schemas and contract types for EXTRACT_CLAIMS (Issue #12 & docs/03-agent-pipeline.md).
 *
 * Designed within Gemini's structured output subset (flat or 1-level nesting).
 */

export const ExtractedClaimSchema = z.object({
  text: z.string().max(600),
  metric: z.string().max(80).nullable().optional(),
  reportedValue: z.number().nullable().optional(),
  comparator: z.enum(['gt', 'lt', 'eq']).nullable().optional(),
  againstValue: z.number().nullable().optional(),
  datasetName: z.string().max(120).nullable().optional(),
  methodName: z.string().max(120).nullable().optional(),
  /** Must appear verbatim in the referenced chunk after whitespace normalisation */
  quote: z.string().max(400),
  /** Chunk id or ordinal string */
  chunkId: z.string(),
})

export const ExtractionDatasetSchema = z.object({
  name: z.string().max(120),
  url: z.string().nullable().optional(),
})

export const ExtractionMethodSchema = z.object({
  name: z.string().max(120),
  summary: z.string().max(300),
})

export const ExtractionResultSchema = z.object({
  _provenance: z
    .object({
      model: z.string(),
      capturedAt: z.string(),
      promptHash: z.string().optional(),
    })
    .optional(),
  claims: z.array(ExtractedClaimSchema).max(12),
  datasets: z.array(ExtractionDatasetSchema).max(8).optional().default([]),
  methods: z.array(ExtractionMethodSchema).max(8).optional().default([]),
  codeUrls: z.array(z.string().max(500)).max(8).optional().default([]),
})

// ---------------------------------------------------------------------------
// PROPOSE_EDGES schemas (Issue #13 & docs/03-agent-pipeline.md)
// ---------------------------------------------------------------------------

export const ProposedEdgeSchema = z.object({
  fromNodeId: z.string(),
  toNodeId: z.string(),
  relation: z.enum([
    'supports',
    'contradicts',
    'cites',
    'uses_dataset',
    'tests',
    'derived_from',
  ]),
  confidence: z.number().min(0).max(1),
  evidenceChunkId: z.string(),
  quote: z.string().max(400),
  rationale: z.string().max(240),
})

export const ProposeEdgesResultSchema = z.object({
  _provenance: z
    .object({
      model: z.string(),
      capturedAt: z.string(),
      promptHash: z.string().optional(),
    })
    .optional(),
  edges: z.array(ProposedEdgeSchema).max(12),
})

export type ExtractedClaim = z.infer<typeof ExtractedClaimSchema>
export type ExtractionDataset = z.infer<typeof ExtractionDatasetSchema>
export type ExtractionMethod = z.infer<typeof ExtractionMethodSchema>
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>
export type ProposedEdge = z.infer<typeof ProposedEdgeSchema>
export type ProposeEdgesResult = z.infer<typeof ProposeEdgesResultSchema>

export interface ChunkRef {
  id?: string
  sourceId?: string
  ordinal: number
  text: string
  page?: number | null
}

export interface ValidatedClaim extends ExtractedClaim {
  chunkOrdinal: number
  page: number | null
  matchedQuote: string
}

export interface RejectedClaim {
  claim: ExtractedClaim
  reason: 'VERBATIM_QUOTE_NOT_FOUND' | 'CHUNK_NOT_FOUND' | 'QUOTE_EMPTY'
}

export interface ExtractionOutcome {
  acceptedClaims: ValidatedClaim[]
  rejectedClaims: RejectedClaim[]
  datasets: ExtractionDataset[]
  methods: ExtractionMethod[]
  codeUrls: string[]
  taskId?: string
}

export interface NodeSummary {
  id: string
  type: string
  title: string
  summary?: string
  sourceId?: string | null
}

export interface ValidatedEdge {
  fromNodeId: string
  toNodeId: string
  relation: 'supports' | 'contradicts' | 'cites' | 'uses_dataset' | 'tests' | 'derived_from'
  confidence: number
  status: 'suggested' | 'accepted'
  evidenceChunkId: string
  matchedQuote: string
  rationale: string
}

export interface RejectedEdge {
  edge: ProposedEdge
  reason:
    | 'SELF_LOOP'
    | 'VERBATIM_QUOTE_NOT_FOUND'
    | 'CHUNK_NOT_FOUND'
    | 'QUOTE_EMPTY'
    | 'INVALID_NODE'
}

export interface ProposeEdgesOutcome {
  acceptedEdges: ValidatedEdge[]
  rejectedEdges: RejectedEdge[]
  storedRows?: EdgeRow[]
  taskId?: string
}
