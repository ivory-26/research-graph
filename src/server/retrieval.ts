import { and, cosineDistance, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Database } from '../db/client'
import {
  sourceChunks,
  sources,
  type SourceChunkRow,
  type SourceRow,
} from '../db/schema'
import type { CallModel, CallModelContext } from './model'
import { agentTaskStore, callModel as defaultCallModel } from './model'
import { embedQuery, type EmbedDeps } from './ingest/embed'
import { normalizeQuote, verifyVerbatimQuote } from './extract/quote'

/**
 * Zod schema for structured output from the LLM when synthesizing
 * an answer across retrieved source passages.
 */
export const RetrievalCitationSchema = z.object({
  sourceId: z.string().describe('ID of the source paper'),
  sourceTitle: z.string().describe('Title of the source paper'),
  chunkId: z.string().describe('ID of the source chunk containing evidence'),
  page: z.number().nullable().describe('Page number in the source where the quote appears'),
  quote: z.string().describe('Exact verbatim quote from the chunk supporting the point'),
  claimSupported: z.string().describe('Brief sentence on what claim or fact this quote supports'),
})

export const RetrievalAnswerSchema = z.object({
  answer: z.string().describe('Synthesized answer answering the query across the sources'),
  citations: z
    .array(RetrievalCitationSchema)
    .describe('List of specific citations with verbatim quotes supporting the answer'),
})

export type RetrievalCitation = z.infer<typeof RetrievalCitationSchema>
export type RetrievalAnswer = z.infer<typeof RetrievalAnswerSchema>

export interface RetrievedPassage {
  chunkId: string
  sourceId: string
  sourceTitle: string
  sourceKind: string
  page: number | null
  ordinal: number
  charStart: number
  charEnd: number
  text: string
  similarity: number
}

export interface VerifiedCitation {
  sourceId: string
  sourceTitle: string
  chunkId: string
  page: number | null
  quote: string
  claimSupported: string
  verified: true
}

export interface RejectedCitation {
  sourceId: string
  sourceTitle: string
  chunkId: string
  page: number | null
  quote: string
  claimSupported: string
  reason: 'quote_not_found_in_chunk' | 'chunk_not_found'
}

export interface RetrievePassagesOptions {
  /** Workspace scope for multi-tenant isolation */
  workspaceId?: string
  /** Filter to specific source IDs */
  sourceIds?: string[]
  /** Maximum number of passages to return (default: 6) */
  topK?: number
  /** Minimum cosine similarity threshold (0 to 1) */
  minSimilarity?: number
  /** Pre-computed query embedding to skip embedding API call */
  queryEmbedding?: number[]
  /** Cancellation signal */
  abortSignal?: AbortSignal
}

export interface AskAcrossSourcesOptions extends RetrievePassagesOptions {
  /** Injected pre-retrieved passages (bypasses DB search if provided) */
  passages?: RetrievedPassage[]
  /** Custom callModel context overrides */
  context?: Partial<CallModelContext>
}

export interface AskAcrossSourcesResult {
  question: string
  answer: string
  citations: VerifiedCitation[]
  rejectedCitations: RejectedCitation[]
  passages: RetrievedPassage[]
  sourcesConsulted: Array<{ id: string; title: string; kind: string }>
}

export interface RetrievalDeps {
  db?: Database
  embedQueryFn?: typeof embedQuery
  callModelFn?: CallModel
  embedDeps?: EmbedDeps
}

/**
 * Retrieves top-k relevant text passages across sources using pgvector cosine similarity.
 */
export async function retrieveCrossSourcePassages(
  db: Database,
  query: string,
  options: RetrievePassagesOptions = {},
  deps: RetrievalDeps = {},
): Promise<RetrievedPassage[]> {
  const trimmed = query.trim()
  if (!trimmed) {
    throw new Error('Query string cannot be empty.')
  }

  const {
    workspaceId,
    sourceIds,
    topK = 6,
    minSimilarity,
    abortSignal,
  } = options

  // 1. Resolve embedding for the query
  let queryVec = options.queryEmbedding
  if (!queryVec) {
    const embedFn = deps.embedQueryFn ?? embedQuery
    queryVec = await embedFn(
      trimmed,
      { abortSignal },
      deps.embedDeps ?? {},
    )
  }

  // 2. Build cosine similarity query with source join
  const similarityExpr = sql<number>`1 - (${cosineDistance(sourceChunks.embedding, queryVec)})`
  const conditions = []

  if (workspaceId) {
    conditions.push(eq(sources.workspaceId, workspaceId))
  }

  if (sourceIds && sourceIds.length > 0) {
    conditions.push(inArray(sourceChunks.sourceId, sourceIds))
  }

  if (minSimilarity !== undefined) {
    conditions.push(sql`${similarityExpr} >= ${minSimilarity}`)
  }

  const limit = Math.max(1, Math.min(topK, 25))

  const rows = await db
    .select({
      chunk: sourceChunks,
      source: sources,
      similarity: similarityExpr,
    })
    .from(sourceChunks)
    .innerJoin(sources, eq(sourceChunks.sourceId, sources.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(similarityExpr))
    .limit(limit)

  return rows.map((r) => ({
    chunkId: r.chunk.id,
    sourceId: r.source.id,
    sourceTitle: r.source.title,
    sourceKind: r.source.kind,
    page: r.chunk.page,
    ordinal: r.chunk.ordinal,
    charStart: r.chunk.charStart,
    charEnd: r.chunk.charEnd,
    text: r.chunk.text,
    similarity: Number(r.similarity),
  }))
}

/**
 * Validates citations against retrieved passages to ensure zero hallucinations.
 *
 * Every cited quote must appear verbatim (normalized) in the corresponding chunk text.
 */
export function verifyCitationQuotes(
  citations: RetrievalCitation[],
  passages: RetrievedPassage[],
): {
  accepted: VerifiedCitation[]
  rejected: RejectedCitation[]
} {
  const passageMap = new Map<string, RetrievedPassage>()
  for (const p of passages) {
    passageMap.set(p.chunkId, p)
  }

  const accepted: VerifiedCitation[] = []
  const rejected: RejectedCitation[] = []

  for (const cit of citations) {
    const passage = passageMap.get(cit.chunkId)
    if (!passage) {
      rejected.push({
        ...cit,
        reason: 'chunk_not_found',
      })
      continue
    }

    const isValid = verifyVerbatimQuote(cit.quote, passage.text)
    if (isValid) {
      accepted.push({
        sourceId: cit.sourceId,
        sourceTitle: cit.sourceTitle || passage.sourceTitle,
        chunkId: cit.chunkId,
        page: cit.page ?? passage.page,
        quote: cit.quote,
        claimSupported: cit.claimSupported,
        verified: true,
      })
    } else {
      rejected.push({
        ...cit,
        reason: 'quote_not_found_in_chunk',
      })
    }
  }

  return { accepted, rejected }
}

/**
 * Synthesizes an answer across sources with verified citations.
 *
 * Implements "Ask across sources" (docs/00-scope.md & docs/05-plan.md):
 * 1. Semantic retrieval across workspace papers.
 * 2. Grounded model synthesis with Gemini.
 * 3. Strict verbatim quote validation on all citations.
 */
export async function askAcrossSources(
  query: string,
  options: AskAcrossSourcesOptions = {},
  deps: RetrievalDeps = {},
): Promise<AskAcrossSourcesResult> {
  const trimmed = query.trim()
  if (!trimmed) {
    throw new Error('Query string cannot be empty.')
  }

  let passages = options.passages

  // If passages are not pre-injected, retrieve them from the database
  if (!passages) {
    if (!deps.db) {
      const { getDb } = await import('../db/client')
      deps.db = getDb()
    }
    passages = await retrieveCrossSourcePassages(deps.db, trimmed, options, deps)
  }

  // Deduplicate sources consulted
  const sourceMap = new Map<string, { id: string; title: string; kind: string }>()
  for (const p of passages) {
    if (!sourceMap.has(p.sourceId)) {
      sourceMap.set(p.sourceId, {
        id: p.sourceId,
        title: p.sourceTitle,
        kind: p.sourceKind,
      })
    }
  }
  const sourcesConsulted = Array.from(sourceMap.values())

  // If no passages found, return early without calling the model
  if (passages.length === 0) {
    return {
      question: trimmed,
      answer: 'No relevant passages found in the ingested sources for this workspace.',
      citations: [],
      rejectedCitations: [],
      passages: [],
      sourcesConsulted: [],
    }
  }

  // Build grounded synthesis prompt
  const passageContext = passages
    .map(
      (p, idx) =>
        `[Passage ${idx + 1}]\nSource ID: ${p.sourceId}\nSource Title: ${p.sourceTitle}\nChunk ID: ${p.chunkId}\nPage: ${p.page ?? 'N/A'}\nText:\n"""\n${p.text}\n"""`,
    )
    .join('\n\n')

  const prompt = `You are a research synthesis assistant. Answer the user's question by synthesizing the provided research passages from multiple papers.

Guidelines:
1. Synthesize a coherent, objective answer drawing from the passages. If the passages present contrasting findings, alternative methods, or caveats (e.g. impurity importance bias vs conditional permutation importance vs Boruta shadow features), explain the comparison clearly.
2. For every factual claim, provide a citation containing an EXACT, VERBATIM quote from the corresponding passage text.
3. Every citation must include:
   - sourceId: the exact Source ID from the passage header
   - sourceTitle: the Source Title from the passage header
   - chunkId: the exact Chunk ID from the passage header
   - page: the page number integer (or null)
   - quote: the exact verbatim substring from the passage text supporting the statement (do not paraphrase within the quote!)
   - claimSupported: brief description of what the quote proves
4. Do NOT cite anything that is not in the provided passages.

User Question:
${trimmed}

Retrieved Passages:
${passageContext}`

  const callModelFn = deps.callModelFn ?? defaultCallModel

  const resolvedWorkspaceId = options.workspaceId ?? options.context?.workspaceId
  if (!resolvedWorkspaceId) {
    throw new Error('workspaceId is required for askAcrossSources retrieval')
  }
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const validStrategyId = options.context?.strategyId && UUID_REGEX.test(options.context.strategyId)
    ? options.context.strategyId
    : null

  const ctx: CallModelContext = {
    workspaceId: resolvedWorkspaceId,
    taskKind: 'explain_gap',
    store: options.context?.store ?? agentTaskStore,
    strategyId: validStrategyId,
    inputRef: { query: trimmed, passageCount: passages.length },
    signal: options.abortSignal,
    ...options.context,
  }

  const modelResult = await callModelFn(RetrievalAnswerSchema, prompt, ctx)
  const rawAnswer = modelResult.output

  // Verify all citation quotes
  const { accepted, rejected } = verifyCitationQuotes(rawAnswer.citations, passages)

  return {
    question: trimmed,
    answer: rawAnswer.answer,
    citations: accepted,
    rejectedCitations: rejected,
    passages,
    sourcesConsulted,
  }
}
