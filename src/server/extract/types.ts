import { z } from 'zod'
import type { EdgeRow } from '../../db/schema'

/**
 * Zod schemas and contract types for EXTRACT_CLAIMS (Issue #12 & docs/03-agent-pipeline.md).
 *
 * Designed within the flat/1-level structured output subset of Gemini and Meta Model API:
 * providers ignore JSON Schema length/item keywords during generation, so Zod validates
 * all documented bounds post-call while `.describe()` hints guide concise outputs.
 */

export const ExtractedClaimSchema = z.object({
  text: z.string().max(600).describe('Concise empirical claim summary (<= 600 characters)'),
  metric: z.string().max(80).nullable().optional().describe('Short metric identifier (<= 80 characters) or null'),
  reportedValue: z.number().nullable().optional(),
  comparator: z.enum(['gt', 'lt', 'eq']).nullable().optional(),
  againstValue: z.number().nullable().optional(),
  datasetName: z.string().max(120).nullable().optional().describe('Short dataset name (<= 120 characters) or null'),
  methodName: z.string().max(120).nullable().optional().describe('Short method name (<= 120 characters) or null'),
  /** Must appear verbatim in the referenced chunk after whitespace normalisation (<= 400 chars, enforced per claim) */
  quote: z
    .string()
    .describe('Exact verbatim quote from the chunk (<= 400 characters)'),
  /** Chunk id or ordinal string */
  chunkId: z.string(),
})

export const ExtractionDatasetSchema = z.object({
  name: z.string().max(120).describe('Short dataset identifier/name only (<= 120 characters)'),
  url: z.string().nullable().optional(),
})

export const ExtractionMethodSchema = z.object({
  name: z.string().max(120).describe('Short method identifier/name only (<= 120 characters)'),
  summary: z.string().max(300).describe('Concise method summary (<= 300 characters)'),
})

export const ExtractionResultSchema = z.object({
  claims: z.array(ExtractedClaimSchema).max(12).describe('Up to 12 extracted claims'),
  datasets: z.array(ExtractionDatasetSchema).max(8).optional().default([]).describe('Up to 8 datasets'),
  methods: z.array(ExtractionMethodSchema).max(8).optional().default([]).describe('Up to 8 methods'),
  codeUrls: z.array(z.string().max(500)).max(8).optional().default([]).describe('Up to 8 repository/code URLs (<= 500 characters each)'),
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
  confidence: z.number().min(0).max(1).describe('Calibrated confidence score in [0, 1]'),
  evidenceChunkId: z.string(),
  quote: z
    .string()
    .describe('Exact verbatim quote from the evidence chunk (<= 400 characters)'),
  rationale: z.string().describe('Brief justification under 240 characters'),
})

export const ProposeEdgesResultSchema = z.object({
  edges: z.array(ProposedEdgeSchema).max(12).describe('Up to 12 proposed edges'),
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
  reason: 'VERBATIM_QUOTE_NOT_FOUND' | 'CHUNK_NOT_FOUND' | 'QUOTE_EMPTY' | 'QUOTE_TOO_LONG'
}

export interface ExtractionOutcome {
  acceptedClaims: ValidatedClaim[]
  rejectedClaims: RejectedClaim[]
  datasets: ExtractionDataset[]
  methods: ExtractionMethod[]
  codeUrls: string[]
  taskId?: string
  taskIds?: string[]
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
    | 'QUOTE_TOO_LONG'
    | 'RATIONALE_EMPTY'
    | 'INVALID_NODE'
}

export interface ProposeEdgesOutcome {
  acceptedEdges: ValidatedEdge[]
  rejectedEdges: RejectedEdge[]
  storedRows?: EdgeRow[]
  persisted: boolean
  taskId?: string
}
