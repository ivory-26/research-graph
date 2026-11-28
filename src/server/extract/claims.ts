import {
  callModel as defaultCallModel,
  type AgentTaskStore,
  type CallModel,
  agentTaskStore,
} from '../model'
import { normalizeQuote, validateClaimQuotes } from './quote'
import {
  ExtractionResultSchema,
  type ChunkRef,
  type ExtractionDataset,
  type ExtractionMethod,
  type ExtractionOutcome,
  type ExtractionResult,
  type RejectedClaim,
  type ValidatedClaim,
} from './types'

export const DEFAULT_SINGLE_PASS_MAX_CHARS = 30_000

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ExtractionStrategy = 'single_pass' | 'sectioned' | 'table_first'

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
  /**
   * Stable identifier for this extraction batch. Every pass of a sectioned
   * extraction records the same id, so `agent_tasks` rows can be compared per
   * run. Omitted by callers that have not adopted run attribution; their rows
   * stay in the legacy unattributed bucket.
   */
  runId?: string | null
  /** Optional human-readable label stored beside `runId`. Never inferred. */
  runLabel?: string | null
  maxChars?: number
  /** Injected callModel implementation (defaults to production callModel) */
  callModelFn?: CallModel
  /** Injected status updater (defaults to direct Drizzle DB update) */
  updateTaskStatusFn?: UpdateTaskStatusFn
  /** Injected task store (defaults to the production Drizzle store). */
  taskStore?: AgentTaskStore
}

/**
 * Slices chunks strictly to a maximum character budget so prompt construction
 * adheres to model input bounds across all extraction strategies.
 */
export function sliceChunksToMaxChars(chunks: ChunkRef[], maxChars: number): ChunkRef[] {
  if (maxChars <= 0 || chunks.length === 0) return []

  let accumulatedChars = 0
  const sliced: ChunkRef[] = []

  for (const chunk of chunks) {
    if (accumulatedChars >= maxChars) break

    const remainingBudget = maxChars - accumulatedChars
    if (chunk.text.length <= remainingBudget) {
      sliced.push(chunk)
      accumulatedChars += chunk.text.length
    } else {
      sliced.push({
        ...chunk,
        text: chunk.text.slice(0, remainingBudget),
      })
      accumulatedChars += remainingBudget
      break
    }
  }

  return sliced
}

const ABSTRACT_HEADER_RE = /^(?:\d+(?:\.\d+)*\.?\s+)?Abstract(?:\s+(?=[A-Z0-9"'(])|$)/
const ABSTRACT_SUBLABEL_RE =
  /^(?:Background|Introduction|Objectives?|Aims?|Methods?|Methodology|Results?|Conclusions?|Discussion):(?:\s|$)/i
const INTRO_BOUNDARY_RE =
  /^(?:\d+(?:\.\d+)*\.?\s+)?(?:Background|Introduction)(?:\s*[:.\-–—]?|\s+(?=[A-Z0-9"'(])|$)/
const METHODS_HEADING_INLINE_RE =
  /^(?:\d+(?:\.\d+)*\.?\s+(?:Materials?\s+and\s+[Mm]ethods?|Methods?|Method|Methodology|Experimental\s+(?:[Ss]etup|[Dd]esign|[Pp]rocedures?|[Mm]ethods?)|Simulation\s+(?:[Ss]tudy|[Ss]tudies|[Dd]esign))|(?:Materials?\s+and\s+[Mm]ethods?|Methods|Methodology|Experimental\s+(?:[Ss]etup|[Dd]esign|[Pp]rocedures?|[Mm]ethods?)|Simulation\s+(?:[Ss]tudy|[Ss]tudies|[Dd]esign)))(?=$|\s*[:\-–—]|\s+[A-Z0-9"'(])/
const RESULTS_HEADING_INLINE_RE =
  /^(?:\d+(?:\.\d+)*\.?\s+(?:Results?(?:\s+and\s+(?:[Dd]iscussion|[Cc]onclusions?))?|Experimental\s+[Rr]esults?|Empirical\s+(?:[Rr]esults?|[Ee]valuation|[Ff]indings)|Findings)|(?:Results(?:\s+and\s+(?:[Dd]iscussion|[Cc]onclusions?))?|Experimental\s+[Rr]esults?|Empirical\s+(?:[Rr]esults?|[Ee]valuation|[Ff]indings)|Findings))(?=$|\s*[:\-–—]|\s+(?=[A-Z0-9"'(])|\s+of\s+the\s+[^.]{1,60}(?:$|\s+[A-Z]))/
const TAIL_BOUNDARY_INLINE_RE =
  /^(?:\d+(?:\.\d+)*\.?\s+(?:Discussion|Conclusions?|Summary\s+and\s+[Cc]onclusions?|Acknowledgments?|Acknowledgements?|References|Bibliography|Appendix(?:\s+[A-Za-z0-9]+)?)|(?:Discussion|Conclusions?|Summary\s+and\s+[Cc]onclusions?|Acknowledgments?|Acknowledgements?|References|Bibliography|Appendix(?:\s+[A-Za-z0-9]+)?))(?=$|\s*[:\-–—]|\s+[A-Z0-9"'(])/

export interface SectionedChunks {
  methodsChunks: ChunkRef[]
  resultsChunks: ChunkRef[]
  fallbackUsed: boolean
  fallbackHalves?: [ChunkRef[], ChunkRef[]]
  /** Uncovered chunks when only one of Methods/Results headings was found. */
  complementChunks?: ChunkRef[]
  missingSection?: 'methods' | 'results'
}

/**
 * Locates Methods and Results sections by heading across ordered chunks.
 * Supports both standalone headings and PDF-extracted paragraph lines where a bold
 * heading is joined onto the opening sentence. Ignores structured-abstract sub-labels
 * (e.g., "Results:") until body sections start, and falls back to balanced sequential
 * halves when explicit Methods/Results headings are absent.
 */
export function partitionChunksBySection(chunks: ChunkRef[]): SectionedChunks {
  const methodsChunks: ChunkRef[] = []
  const resultsChunks: ChunkRef[] = []

  let inAbstract = false
  let activeSection: 'none' | 'methods' | 'results' | 'tail' = 'none'

  for (const chunk of chunks) {
    let touchedMethods = false
    let touchedResults = false

    for (const rawLine of chunk.text.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line) continue
      if (/^methodology\s+article$/i.test(line)) continue

      if (ABSTRACT_HEADER_RE.test(line)) {
        inAbstract = true
        activeSection = 'none'
        continue
      }

      if (inAbstract) {
        if (ABSTRACT_SUBLABEL_RE.test(line)) continue
        if (INTRO_BOUNDARY_RE.test(line) || /^\d+(?:\.\d+)*\.?\s+[A-Z]/.test(line)) {
          inAbstract = false
        }
      }

      const startsWithUpperOrDigit = /^[\dA-Z]/.test(line)

      if (startsWithUpperOrDigit && METHODS_HEADING_INLINE_RE.test(line)) {
        inAbstract = false
        activeSection = 'methods'
        touchedMethods = true
        continue
      }

      if (startsWithUpperOrDigit && RESULTS_HEADING_INLINE_RE.test(line)) {
        inAbstract = false
        activeSection = 'results'
        touchedResults = true
        continue
      }

      if (startsWithUpperOrDigit && INTRO_BOUNDARY_RE.test(line) && !line.endsWith('.')) {
        inAbstract = false
        activeSection = 'none'
        continue
      }

      if (startsWithUpperOrDigit && TAIL_BOUNDARY_INLINE_RE.test(line)) {
        inAbstract = false
        activeSection = 'tail'
        continue
      }

      // Normal body line belongs to whichever section is currently active
      if (activeSection === 'methods') touchedMethods = true
      if (activeSection === 'results') touchedResults = true
    }

    if (touchedMethods) methodsChunks.push(chunk)
    if (touchedResults) resultsChunks.push(chunk)
  }

  if (methodsChunks.length === 0 && resultsChunks.length === 0 && chunks.length > 0) {
    if (chunks.length === 1) {
      return {
        methodsChunks,
        resultsChunks,
        fallbackUsed: true,
        fallbackHalves: [[chunks[0]!], []],
      }
    }
    const mid = Math.ceil(chunks.length / 2)
    return {
      methodsChunks,
      resultsChunks,
      fallbackUsed: true,
      fallbackHalves: [chunks.slice(0, mid), chunks.slice(mid)],
    }
  }

  if (methodsChunks.length > 0 && resultsChunks.length === 0) {
    const covered = new Set(methodsChunks)
    const complementChunks = chunks.filter((c) => !covered.has(c))
    return {
      methodsChunks,
      resultsChunks,
      fallbackUsed: false,
      ...(complementChunks.length > 0
        ? { complementChunks, missingSection: 'results' as const }
        : {}),
    }
  }

  if (resultsChunks.length > 0 && methodsChunks.length === 0) {
    const covered = new Set(resultsChunks)
    const complementChunks = chunks.filter((c) => !covered.has(c))
    return {
      methodsChunks,
      resultsChunks,
      fallbackUsed: false,
      ...(complementChunks.length > 0
        ? { complementChunks, missingSection: 'methods' as const }
        : {}),
    }
  }

  return { methodsChunks, resultsChunks, fallbackUsed: false }
}

const TABLE_CAPTION_RE = /^\s*Table\s+\d+\b(?:\s*[:.\-–—]|\s+[A-Z])/im
const NUMERIC_COLUMN_LINE_RE =
  /(?:^|\s)[-+]?\d+(?:\.\d+)?%?(?:\s+[-+]?\d+(?:\.\d+)?%?){2,}\s*$/

/**
 * Detects whether a chunk contains tabular content (explicit Table N captions,
 * Markdown pipe tables, or dense multi-column numeric rows).
 */
export function isTableChunk(text: string): boolean {
  if (TABLE_CAPTION_RE.test(text)) return true

  const lines = text.split(/\r?\n/)
  let pipeLines = 0
  let tabLines = 0
  let numericColumnLines = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^\|.*\|$/.test(trimmed)) pipeLines++
    if (line.includes('\t') && line.split('\t').length >= 3) tabLines++
    if (NUMERIC_COLUMN_LINE_RE.test(trimmed)) numericColumnLines++
  }

  return pipeLines >= 2 || tabLines >= 3 || numericColumnLines >= 3
}

/**
 * Splits chunks into table-bearing passages (processed first) and remaining body passages.
 */
export function partitionChunksTableFirst(chunks: ChunkRef[]): {
  tableChunks: ChunkRef[]
  otherChunks: ChunkRef[]
} {
  const tableChunks: ChunkRef[] = []
  const otherChunks: ChunkRef[] = []

  for (const chunk of chunks) {
    if (isTableChunk(chunk.text)) {
      tableChunks.push(chunk)
    } else {
      otherChunks.push(chunk)
    }
  }

  return { tableChunks, otherChunks }
}

/**
 * Builds the structured prompt asking Gemini to extract claims, methods, and datasets.
 */
export function buildExtractionPrompt(
  chunks: ChunkRef[],
  sourceTitle?: string,
  focusNote?: string,
): string {
  const context = chunks
    .map(
      (c) =>
        `--- CHUNK ID: ${c.id || c.ordinal} (Page ${c.page ?? '?'}) ---\n${c.text}`,
    )
    .join('\n\n')

  const focusSection = focusNote ? `\nPASS FOCUS:\n${focusNote}\n` : ''

  return `Document: ${sourceTitle || 'Unknown Document'}
${focusSection}
EVIDENCE PASSAGES:
${context}

INSTRUCTIONS:
You are an expert scientific claim extraction system. Extract key empirical claims, methods, datasets, and code URLs from the text passages above.

CRITICAL REQUIREMENT:
1. Every claim MUST include an exact, VERBATIM quote copied directly from the text of the passage (keep each quote concise: 1-2 sentences, <= 400 characters).
2. The "chunkId" field MUST be the chunk ID or integer ordinal of the passage containing the verbatim quote (e.g. "0", "1").
3. Do not paraphrase or alter words inside the "quote". Any claim with an altered, missing, or >400-character quote will be rejected.
4. Keep "text" <= 600 chars, "metric" <= 80 chars, and dataset/method names ("datasetName", "methodName", datasets[].name, methods[].name) concise short names <= 120 chars; keep method "summary" <= 300 chars and each "codeUrl" <= 500 chars.
5. If a claim makes a quantitative assertion, record "metric", "reportedValue", "comparator" ("gt", "lt", "eq"), and "againstValue" if stated.
6. Limit strictly to at most 12 claims, 8 datasets, 8 methods, and 8 codeUrls.`
}

interface ExtractionPassSpec {
  passName: string
  chunks: ChunkRef[]
  focusNote?: string
  sectionFallback?: boolean
}

function resolveDefaultTaskStatusUpdater(): UpdateTaskStatusFn {
  return async (taskId, status, error) => {
    if (process.env.DATABASE_URL && UUID_REGEX.test(taskId)) {
      const { getDb } = await import('../../db/client')
      const { agentTasks } = await import('../../db/schema')
      const { eq } = await import('drizzle-orm')
      await getDb()
        .update(agentTasks)
        .set({ status, error: error ?? null })
        .where(eq(agentTasks.id, taskId))
    }
  }
}

async function runExtractionPass(
  pass: ExtractionPassSpec,
  params: {
    workspaceId: string
    sourceId: string
    sourceTitle?: string
    strategy: ExtractionStrategy
    validStrategyId: string | null
    runId: string | null
    runLabel: string | null
    maxChars: number
    callModelFn: CallModel
    updateStatusFn: UpdateTaskStatusFn
    taskStore: AgentTaskStore
  },
): Promise<{
  accepted: ValidatedClaim[]
  rejected: RejectedClaim[]
  datasets: ExtractionDataset[]
  methods: ExtractionMethod[]
  codeUrls: string[]
  taskId?: string
}> {
  const passChunks = sliceChunksToMaxChars(pass.chunks, params.maxChars)
  if (passChunks.length === 0) {
    return {
      accepted: [],
      rejected: [],
      datasets: [],
      methods: [],
      codeUrls: [],
    }
  }

  const prompt = buildExtractionPrompt(passChunks, params.sourceTitle, pass.focusNote)

  const result = await params.callModelFn<ExtractionResult>(ExtractionResultSchema, prompt, {
    workspaceId: params.workspaceId,
    taskKind: 'extract_claims',
    strategyId: params.validStrategyId,
    store: params.taskStore,
    inputRef: {
      sourceId: params.sourceId,
      chunkCount: passChunks.length,
      strategy: params.strategy,
      ...(params.runId ? { extractionRunId: params.runId } : {}),
      ...(params.runLabel ? { extractionRunLabel: params.runLabel } : {}),
      ...(pass.passName !== 'single_pass' ? { pass: pass.passName } : {}),
      ...(pass.sectionFallback ? { sectionFallback: true } : {}),
    },
  })

  const raw = result.output
  const { accepted, rejected } = validateClaimQuotes(raw.claims, passChunks)

  // docs/03: A claim whose quote is unverifiable is dropped and counted as a rejected task
  if (result.task?.id && accepted.length === 0) {
    result.task.status = 'rejected'
    const rejectReason =
      raw.claims.length === 0
        ? 'Model returned no claims.'
        : 'All proposed claims were rejected due to unverified verbatim quotes.'

    await params.updateStatusFn(result.task.id, 'rejected', rejectReason)
  }

  return {
    accepted,
    rejected,
    datasets: raw.datasets ?? [],
    methods: raw.methods ?? [],
    codeUrls: raw.codeUrls ?? [],
    taskId: result.task?.id,
  }
}

function mergePassResults(
  passResults: Array<Awaited<ReturnType<typeof runExtractionPass>>>,
): ExtractionOutcome {
  const acceptedClaims: ValidatedClaim[] = []
  const rejectedClaims: RejectedClaim[] = []
  const datasets: ExtractionDataset[] = []
  const methods: ExtractionMethod[] = []
  const codeUrls: string[] = []
  const taskIds: string[] = []

  const seenQuotes = new Set<string>()
  const seenDatasets = new Set<string>()
  const seenMethods = new Set<string>()
  const seenCodeUrls = new Set<string>()
  let primaryTaskId: string | undefined

  for (const pass of passResults) {
    if (pass.taskId) {
      taskIds.push(pass.taskId)
      if (!primaryTaskId && pass.accepted.length > 0) {
        primaryTaskId = pass.taskId
      }
    }

    for (const claim of pass.accepted) {
      const key = normalizeQuote(claim.quote)
      if (!seenQuotes.has(key)) {
        seenQuotes.add(key)
        acceptedClaims.push(claim)
      }
    }

    rejectedClaims.push(...pass.rejected)

    for (const ds of pass.datasets) {
      const key = ds.name.trim().toLowerCase()
      if (key && !seenDatasets.has(key)) {
        seenDatasets.add(key)
        datasets.push(ds)
      }
    }

    for (const method of pass.methods) {
      const key = method.name.trim().toLowerCase()
      if (key && !seenMethods.has(key)) {
        seenMethods.add(key)
        methods.push(method)
      }
    }

    for (const url of pass.codeUrls) {
      const trimmed = url.trim()
      if (trimmed && !seenCodeUrls.has(trimmed)) {
        seenCodeUrls.add(trimmed)
        codeUrls.push(trimmed)
      }
    }
  }

  return {
    acceptedClaims,
    rejectedClaims,
    datasets,
    methods,
    codeUrls,
    taskId: primaryTaskId ?? taskIds[0],
    ...(taskIds.length > 0 ? { taskIds } : {}),
  }
}

/**
 * Executes the EXTRACT_CLAIMS pipeline stage with verbatim quote verification (Issue #12).
 *
 * Supports:
 * - `single_pass`: first 30,000 characters, one structured call
 * - `sectioned`: Methods and Results sections located by heading, one sequential call each
 * - `table_first`: table-bearing chunks first, remaining body prose second, sequentially
 *
 * Every physical call records an `agent_tasks` row and rejects unverifiable quotes strictly.
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

  if (strategy !== 'single_pass' && strategy !== 'sectioned' && strategy !== 'table_first') {
    throw new Error(
      `Extraction strategy '${String(strategy)}' is not supported. Valid strategies: 'single_pass', 'sectioned', 'table_first'.`,
    )
  }

  const validStrategyId =
    options.strategyId && UUID_REGEX.test(options.strategyId) ? options.strategyId : null
  const runId = options.runId?.trim() || null
  const runLabel = options.runLabel?.trim() || null
  const taskStore = options.taskStore ?? agentTaskStore

  if (chunks.length === 0) {
    return {
      acceptedClaims: [],
      rejectedClaims: [],
      datasets: [],
      methods: [],
      codeUrls: [],
    }
  }

  const maxChars = options.maxChars ?? DEFAULT_SINGLE_PASS_MAX_CHARS
  const passes: ExtractionPassSpec[] = []

  if (strategy === 'single_pass') {
    passes.push({ passName: 'single_pass', chunks })
  } else if (strategy === 'sectioned') {
    const sectioned = partitionChunksBySection(chunks)
    if (!sectioned.fallbackUsed) {
      if (sectioned.methodsChunks.length > 0) {
        passes.push({
          passName: 'methods',
          chunks: sectioned.methodsChunks,
          focusNote:
            'Focus on experimental setup, simulation design, datasets, and methods in the Methods section.',
        })
      }
      if (sectioned.resultsChunks.length > 0) {
        passes.push({
          passName: 'results',
          chunks: sectioned.resultsChunks,
          focusNote:
            'Focus on empirical findings, quantitative comparisons, and conclusions in the Results section.',
        })
      }
      if (sectioned.complementChunks && sectioned.complementChunks.length > 0) {
        const missingLabel = sectioned.missingSection === 'results' ? 'Results' : 'Methods'
        passes.push({
          passName: 'complement_fallback',
          chunks: sectioned.complementChunks,
          sectionFallback: true,
          focusNote: `No explicit ${missingLabel} heading found; extracting claims from remaining uncovered passages.`,
        })
      }
    } else if (sectioned.fallbackHalves) {
      if (sectioned.fallbackHalves[0].length > 0) {
        passes.push({
          passName: 'section_part_1',
          chunks: sectioned.fallbackHalves[0],
          sectionFallback: true,
          focusNote:
            'First half of document (explicit Methods/Results headings were absent). Extract core methods and claims.',
        })
      }
      if (sectioned.fallbackHalves[1].length > 0) {
        passes.push({
          passName: 'section_part_2',
          chunks: sectioned.fallbackHalves[1],
          sectionFallback: true,
          focusNote:
            'Second half of document (explicit Methods/Results headings were absent). Extract empirical results and claims.',
        })
      }
    }
  } else if (strategy === 'table_first') {
    const { tableChunks, otherChunks } = partitionChunksTableFirst(chunks)
    if (tableChunks.length > 0) {
      passes.push({
        passName: 'tables',
        chunks: tableChunks,
        focusNote:
          'Priority pass over table captions and tabular data. Extract quantitative metrics, datasets, and claims from tables first.',
      })
    }
    if (otherChunks.length > 0) {
      passes.push({
        passName: 'body',
        chunks: otherChunks,
        focusNote:
          'Body prose pass (non-table passages). Extract claims, methods, datasets, and code URLs from prose.',
      })
    }
  }

  const updateStatusFn = options.updateTaskStatusFn ?? resolveDefaultTaskStatusUpdater()
  const passResults: Array<Awaited<ReturnType<typeof runExtractionPass>>> = []

  // docs/03: Never issue parallel model requests
  for (const pass of passes) {
    const passOutcome = await runExtractionPass(pass, {
      workspaceId,
      sourceId,
      sourceTitle,
      strategy,
      validStrategyId,
      runId,
      runLabel,
      maxChars,
      callModelFn,
      updateStatusFn,
      taskStore,
    })
    passResults.push(passOutcome)
  }

  return mergePassResults(passResults)
}
