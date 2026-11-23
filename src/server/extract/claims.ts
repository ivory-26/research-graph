import { callModel as defaultCallModel, type CallModel } from '../model'
import { validateClaimQuotes } from './quote'
import {
  ExtractionResultSchema,
  type ChunkRef,
  type ExtractionOutcome,
  type ExtractionResult,
} from './types'

export const DEFAULT_SINGLE_PASS_MAX_CHARS = 30_000

export type ExtractionStrategy = 'single_pass' | 'chunk_by_chunk' | 'hierarchical'

export type UpdateTaskStatusFn = (
  taskId: string,
  status: 'succeeded' | 'failed' | 'rejected' | 'retried',
  error?: string | null,
) => Promise<void>

export interface ExtractClaimsOptions {
  workspaceId: string
  sourceId: string
  chunks: ChunkRef[]
  sourceTitle?: string
  strategy?: ExtractionStrategy
  strategyId?: string | null
  maxChars?: number
  /** Injected callModel implementation (defaults to production callModel) */
  callModelFn?: CallModel
  /** Injected status updater (defaults to direct Drizzle DB update) */
  updateTaskStatusFn?: UpdateTaskStatusFn
}

/**
 * Builds the structured prompt asking Gemini to extract claims, methods, and datasets.
 */
export function buildExtractionPrompt(
  chunks: ChunkRef[],
  sourceTitle?: string,
): string {
  const context = chunks
    .map(
      (c) =>
        `--- CHUNK ID: ${c.id || c.ordinal} (Page ${c.page ?? '?'}) ---\n${c.text}`,
    )
    .join('\n\n')

  return `Document: ${sourceTitle || 'Unknown Document'}

EVIDENCE PASSAGES:
${context}

INSTRUCTIONS:
You are an expert scientific claim extraction system. Extract key empirical claims, methods, datasets, and code URLs from the text passages above.

CRITICAL REQUIREMENT:
1. Every claim MUST include an exact, VERBATIM quote copied directly from the text of the passage.
2. The "chunkId" field MUST be the chunk ID or integer ordinal of the passage containing the verbatim quote (e.g. "0", "1").
3. Do not paraphrase or alter words inside the "quote". Any claim with an altered or missing quote will be rejected.
4. If a claim makes a quantitative assertion, record "metric", "reportedValue", "comparator" ("gt", "lt", "eq"), and "againstValue" if stated.
5. Limit to at most 12 claims, 8 datasets, and 8 methods.`
}

/**
 * Executes the EXTRACT_CLAIMS pipeline stage with verbatim quote verification (Issue #12).
 *
 * Rules:
 * - One structured model call per source
 * - Enforces max 12 claims
 * - single_pass strategy restricts input to the first 30,000 characters per docs/03
 * - Rejects any claim whose quote does not appear verbatim in its source chunk
 * - When all claims are rejected, updates the agent_tasks row to 'rejected' per docs/03
 */
export async function extractClaims(
  options: ExtractClaimsOptions,
): Promise<ExtractionOutcome> {
  const {
    workspaceId,
    sourceId,
    chunks,
    sourceTitle,
    strategy = 'single_pass',
    callModelFn = defaultCallModel,
  } = options

  if (strategy !== 'single_pass') {
    throw new Error(
      `Extraction strategy '${strategy}' is not yet supported. Only 'single_pass' is implemented.`,
    )
  }

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const validStrategyId =
    options.strategyId && UUID_REGEX.test(options.strategyId) ? options.strategyId : null

  if (chunks.length === 0) {
    return {
      acceptedClaims: [],
      rejectedClaims: [],
      datasets: [],
      methods: [],
      codeUrls: [],
    }
  }

  // docs/03: single_pass — first 30k characters, one call
  let targetChunks = chunks
  if (strategy === 'single_pass') {
    const maxChars = options.maxChars ?? DEFAULT_SINGLE_PASS_MAX_CHARS
    let accumulatedChars = 0
    targetChunks = []
    for (const chunk of chunks) {
      if (accumulatedChars >= maxChars && targetChunks.length > 0) {
        break
      }
      targetChunks.push(chunk)
      accumulatedChars += chunk.text.length
    }
  }

  const prompt = buildExtractionPrompt(targetChunks, sourceTitle)

  const result = await callModelFn<ExtractionResult>(
    ExtractionResultSchema,
    prompt,
    {
      workspaceId,
      taskKind: 'extract_claims',
      strategyId: validStrategyId,
      // Lazily import the agentTaskStore to avoid DB imports in pure unit test runs
      store: (await import('../model')).agentTaskStore,
      inputRef: { sourceId, chunkCount: targetChunks.length, strategy },
    },
  )

  const raw = result.output

  // Validate verbatim quotes against actual source chunks
  const { accepted, rejected } = validateClaimQuotes(raw.claims, targetChunks)

  // docs/03: "A claim whose quote is unverifiable is dropped and counted as a rejected task"
  // When no claim survives validation (either zero claims returned or all were rejected), update the task row to 'rejected'
  // so dashboard #22 doesn't count a fabrication or empty extraction as a success.
  if (result.task?.id && accepted.length === 0) {
    if (result.task) {
      result.task.status = 'rejected'
    }
    const updateStatus =
      options.updateTaskStatusFn ??
      (async (taskId, status, error) => {
        if (process.env.DATABASE_URL) {
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
      raw.claims.length === 0
        ? 'Model returned no claims.'
        : 'All proposed claims were rejected due to unverified verbatim quotes.'

    await updateStatus(result.task.id, 'rejected', rejectReason).catch(() => {})
  }

  return {
    acceptedClaims: accepted,
    rejectedClaims: rejected,
    datasets: raw.datasets ?? [],
    methods: raw.methods ?? [],
    codeUrls: raw.codeUrls ?? [],
    taskId: result.task?.id,
  }
}
