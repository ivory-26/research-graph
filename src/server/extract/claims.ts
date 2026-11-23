import { callModel as defaultCallModel, type CallModel } from '../model'
import { validateClaimQuotes } from './quote'
import {
  ExtractionResultSchema,
  type ChunkRef,
  type ExtractionOutcome,
  type ExtractionResult,
} from './types'

/**
 * Builds the structured extraction prompt presenting source chunks to Gemini.
 */
export function buildExtractionPrompt(
  chunks: ChunkRef[],
  sourceTitle?: string,
): string {
  const header = sourceTitle
    ? `Document: ${sourceTitle}\n\n`
    : 'Document Chunks:\n\n'

  const formattedChunks = chunks
    .map((c) => `--- CHUNK ID: ${c.id || c.ordinal} (Page ${c.page ?? '?'}) ---\n${c.text}`)
    .join('\n\n')

  return `${header}${formattedChunks}

INSTRUCTIONS:
You are a rigorous scientific extractor. From the document chunks provided above, extract:
1. Core scientific claims (max 12).
   - "text": A concise, clear summary of the assertion made in the paper (under 600 characters).
   - "quote": An EXACT, VERBATIM quote copied word-for-word from the chunk that justifies this claim. Do NOT paraphrase, summarize, or alter punctuation.
   - "chunkId": The exact CHUNK ID from which the quote was copied.
   - "metric": If the claim reports a quantitative measurement (e.g. "accuracy", "runtime", "rank"), name it. Otherwise null.
   - "reportedValue": Number reported in the paper. If qualitative or simulation-based without a single scalar, set to null.
   - "comparator": 'gt', 'lt', or 'eq' if a comparison is asserted, otherwise null.
   - "againstValue": Baseline number compared against, if any, otherwise null.
   - "datasetName": Name of the benchmark or dataset used, if applicable.
   - "methodName": Name of the proposed or evaluated method.
2. Datasets mentioned (max 8, with name and url if provided).
3. Methods described (max 8, with name and summary).
4. Code repository URLs (max 8).

CRITICAL REQUIREMENT:
Every quote MUST exist verbatim inside the designated chunk text. Any claim whose quote cannot be found verbatim in the text will be immediately rejected.`
}

export type ExtractionStrategy = 'single_pass' | 'sectioned' | 'table_first'
export const DEFAULT_SINGLE_PASS_MAX_CHARS = 30_000

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
}

/**
 * Executes the EXTRACT_CLAIMS pipeline stage with verbatim quote verification (Issue #12).
 *
 * Rules:
 * - One structured model call per source
 * - Enforces max 12 claims
 * - single_pass strategy restricts input to the first 30,000 characters per docs/03
 * - Rejects any claim whose quote does not appear verbatim in its source chunk
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
    strategyId = strategy,
    callModelFn = defaultCallModel,
  } = options

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
      strategyId,
      // Lazily import the agentTaskStore to avoid DB imports in pure unit test runs
      store: (await import('../model')).agentTaskStore,
      inputRef: { sourceId, chunkCount: targetChunks.length, strategy },
    },
  )

  const raw = result.output

  // Validate verbatim quotes against actual source chunks
  const { accepted, rejected } = validateClaimQuotes(raw.claims, targetChunks)

  return {
    acceptedClaims: accepted,
    rejectedClaims: rejected,
    datasets: raw.datasets ?? [],
    methods: raw.methods ?? [],
    codeUrls: raw.codeUrls ?? [],
    taskId: result.task?.id,
  }
}
