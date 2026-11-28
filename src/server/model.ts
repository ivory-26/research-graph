/**
 * The one wrapper every model call goes through.
 *
 * docs/03-agent-pipeline.md fixes four rules this file exists to enforce:
 *
 * 1. Calls are sequential. Provider quotas are per project and unpublished,
 *    so this wrapper queues every call behind the previous one.
 * 2. A 429 rate-limit or 503 provider-capacity response backs off
 *    exponentially with jitter. Other failures do not retry; they are the
 *    caller's problem (a repair is a new pipeline task, not a hidden retry).
 * 3. Every physical request attempt writes exactly one `agent_tasks` row,
 *    including the attempts that fail. A retried attempt is `retried`; the
 *    final attempt is `succeeded` or `failed`.
 * 4. The SDK's own retries are disabled (`maxRetries: 0`). If the SDK retried
 *    behind our back, one wrapper call would produce several physical requests
 *    and one task row — the accounting would be a lie. See ADR 0009.
 *
 * Persistence is an injected port. `agent_tasks` is owned by the schema
 * workstream (issue #3); this file imports the published table only for the
 * thin Drizzle-backed adapter below and never duplicates the schema.
 *
 * Structured output stays inside the providers' documented subsets: the caller
 * passes a flat, non-recursive Zod schema. The wrapper parses the result with
 * that same Zod schema after the call, because Gemini silently ignores
 * `minLength`, `maxLength` and `uniqueItems` (ADR 0009) and Meta's strict mode
 * rejects optional properties (ADR 0014).
 */
import { APICallError, Output, generateText } from 'ai'
import type { LanguageModel } from 'ai'
import { createGoogleGenerativeAI, google } from '@ai-sdk/google'
import { z } from 'zod'
import type { AgentTaskStatus, TaskKind } from '../shared/types'
import { agentTasks, type NewAgentTask } from '../db/schema'
import type { Database } from '../db/client'

/** The pinned default Google Gemini text model (CLAUDE.md). */
export const DEFAULT_MODEL_ID = 'gemini-3.8-flash'

/** Pinned Meta Model API model identifier (only the contributor tier is permitted). */
export const DEFAULT_META_MODEL_ID = 'muse-spark-1.3-contributor'

/** Official Meta Model API Chat Completions endpoint (`https://api.meta.ai/v1`). */
export const DEFAULT_META_CHAT_COMPLETIONS_URL =
  'https://api.meta.ai/v1/chat/completions'

/** Bearer token for the Meta Model API. Never logged or persisted. */
export const META_API_KEY_ENV = 'META_API_KEY'

/**
 * One initial attempt plus two retries. docs/03-agent-pipeline.md sets the
 * ceiling for repair at two attempts and docs/06-risks.md budgets the pipeline
 * around that ceiling; the same bound keeps a 429/503 cascade inside the
 * 240-second stream budget.
 */
export const DEFAULT_MAX_ATTEMPTS = 3

export const DEFAULT_BASE_DELAY_MS = 1_000
export const DEFAULT_MAX_DELAY_MS = 30_000

/** USD per one million tokens. */
export type ModelPricing = {
  inputUsdPerMillionTokens: number
  outputUsdPerMillionTokens: number
}

/**
 * Published list prices for the models this project pins, used to fill
 * `agent_tasks.cost_usd`. Override through `createCallModel({ pricing })` if
 * providers change them; the row records the cost this table produced.
 *
 * `gemini-4-hydrogen` is the evaluator's `explain_gap` pin (see `evaluate.ts`),
 * not a general default. Its entry is the published Standard paid rate:
 * $1.50 per million input tokens and $7.50 per million output tokens. Gemini
 * bills thinking tokens at the output rate, and the SDK's `outputTokens` is
 * the total output count, so thinking is included.
 *
 * `muse-spark-1.3-contributor` is the optional Meta Model API text model when
 * `META_API_KEY` is configured or explicitly pinned (ADR 0014). Its entry is
 * Meta's published Contributor list rate: $0.10 per million input tokens and
 * $0.20 per million output tokens (`completion_tokens` includes reasoning tokens).
 * This is an accounting estimate from published prices, not billing telemetry.
 */
export const DEFAULT_PRICING: Readonly<Record<string, ModelPricing>> = {
  [DEFAULT_MODEL_ID]: {
    inputUsdPerMillionTokens: 0.3,
    outputUsdPerMillionTokens: 2.5,
  },
  'gemini-4-hydrogen': {
    inputUsdPerMillionTokens: 1.5,
    outputUsdPerMillionTokens: 7.5,
  },
  [DEFAULT_META_MODEL_ID]: {
    inputUsdPerMillionTokens: 0.1,
    outputUsdPerMillionTokens: 0.2,
  },
}

// ---------------------------------------------------------------------------
// Task rows and the persistence port
// ---------------------------------------------------------------------------

/**
 * One `agent_tasks` insert. The fields mirror docs/02-data-model.md; the id and
 * `created_at` are database defaults and therefore absent here.
 *
 * `costUsd` is a string because Drizzle's `numeric` column is a string in
 * Postgres, and `output` is JSON because the column is `jsonb`.
 */
export type AgentTaskInsert = {
  workspaceId: string
  strategyId: string | null
  taskKind: TaskKind
  model: string
  status: AgentTaskStatus
  inputRef: Record<string, unknown>
  output: unknown
  error: string | null
  promptTokens: number | null
  completionTokens: number | null
  costUsd: string | null
  latencyMs: number
}

export type PersistedAgentTask = AgentTaskInsert & { id: string }

/**
 * The small persistence seam. The production implementation is expected to be
 * a Drizzle adapter over `agent_tasks` that calls `.returning({ id })`.
 */
export interface AgentTaskStore {
  /** Insert exactly one row and return its generated id. */
  insert(task: AgentTaskInsert): Promise<{ id: string }>
}

/**
 * The production store, over the real `agent_tasks` table from #3.
 *
 * `db` is injected rather than imported so this file does not need a database
 * connection to be unit tested. Downstream code builds one store per process:
 *
 *   import { getDb } from '../db/client'
 *   const store = createDrizzleAgentTaskStore(getDb())
 *
 * The `NewAgentTask` annotation is deliberate: it fails the build if the
 * wrapper's row ever stops matching the schema's insert type.
 */
export function createDrizzleAgentTaskStore(
  db: Pick<Database, 'insert'>,
): AgentTaskStore {
  return {
    async insert(task: AgentTaskInsert): Promise<{ id: string }> {
      const values: NewAgentTask = task
      const [row] = await db
        .insert(agentTasks)
        .values(values)
        .returning({ id: agentTasks.id })

      if (!row) {
        throw new Error('agent_tasks insert returned no row')
      }
      return { id: row.id }
    },
  }
}

/**
 * The ready-made production store for call sites that should not care where
 * the connection comes from. The client is imported lazily so tests that
 * inject a memory store never load Neon or TanStack Start.
 */
export const agentTaskStore: AgentTaskStore = {
  async insert(task: AgentTaskInsert): Promise<{ id: string }> {
    const { getDb } = await import('../db/client')
    return createDrizzleAgentTaskStore(getDb()).insert(task)
  },
}

// ---------------------------------------------------------------------------
// Generation seam
// ---------------------------------------------------------------------------

export type StructuredGenerationRequest = {
  modelId: string
  prompt: string
  schema: z.ZodType<unknown>
  signal?: AbortSignal
}

export type StructuredGenerationResult = {
  output: unknown
  inputTokens: number | null
  outputTokens: number | null
}

/**
 * The only thing between `callModel` and the AI SDK. Tests inject a fake here;
 * production uses `generateWithGemini`.
 */
export type StructuredGenerator = (
  request: StructuredGenerationRequest,
) => Promise<StructuredGenerationResult>

/**
 * A deliberately loose view of `generateText`. The SDK's generic overloads
 * make its exact type unusable as an injected dependency; the default generator
 * below calls the real function with the documented AI SDK 7 options.
 */
export type GeminiGenerateText = (options: {
  model: LanguageModel
  prompt: string
  output: unknown
  maxRetries: number
  abortSignal?: AbortSignal
}) => Promise<{
  output: unknown
  usage: {
    inputTokens?: number | undefined
    outputTokens?: number | undefined
  }
}>

export type GeminiGeneratorDeps = {
  /** Injected in tests. Defaults to the AI SDK's `generateText`. */
  generateText?: GeminiGenerateText
  /** Injected in tests. Defaults to a cached `google(modelId)`. */
  resolveModel?: (modelId: string) => LanguageModel
}

const modelCache = new Map<string, LanguageModel>()

/**
 * The Gemini API key the text generator uses.
 *
 * `@ai-sdk/google` reads `GOOGLE_GENERATIVE_AI_API_KEY` only; the embedding
 * module (`src/server/ingest/embed.ts`) has always accepted `GEMINI_API_KEY`
 * too. A deploy that follows the shorter name would therefore embed fine and
 * fail every text call, so the same alias is resolved here. The deployed
 * variable should still be `GOOGLE_GENERATIVE_AI_API_KEY` (see `.env.example`).
 */
export function resolveGeminiApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const key =
    env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    env.GEMINI_API_KEY?.trim() ||
    ''
  return key.length > 0 ? key : null
}

let geminiProvider: ReturnType<typeof createGoogleGenerativeAI> | null = null

function resolveGeminiProvider(): ReturnType<typeof createGoogleGenerativeAI> {
  if (geminiProvider) return geminiProvider
  const apiKey = resolveGeminiApiKey()
  // No explicit key: keep the SDK's default provider, which reads the env at
  // request time and fails with its own clear message if it is absent.
  if (!apiKey) return google
  geminiProvider = createGoogleGenerativeAI({ apiKey })
  return geminiProvider
}

function resolveGeminiModel(modelId: string): LanguageModel {
  const cached = modelCache.get(modelId)
  if (cached) return cached
  const model = resolveGeminiProvider()(modelId)
  modelCache.set(modelId, model)
  return model
}

/**
 * The default generator. `maxRetries: 0` is not a tuning knob: retries belong
 * to `createCallModel` so that every physical attempt gets a task row.
 */
export function createGeminiGenerator(
  deps: GeminiGeneratorDeps = {},
): StructuredGenerator {
  const resolveModel = deps.resolveModel ?? resolveGeminiModel
  const generate: GeminiGenerateText =
    deps.generateText ??
    (async (options) => {
      const result = await generateText({
        model: options.model,
        prompt: options.prompt,
        // The injected-dependency view is intentionally loose; the value is
        // always an `Output.object(...)` specification from this file.
        output: options.output as ReturnType<typeof Output.object>,
        maxRetries: options.maxRetries,
        abortSignal: options.abortSignal,
      })
      return { output: result.output as unknown, usage: result.usage }
    })

  return async ({ modelId, prompt, schema, signal }) => {
    const result = await generate({
      model: resolveModel(modelId),
      prompt,
      output: Output.object({ schema }),
      maxRetries: 0,
      abortSignal: signal,
    })

    return {
      output: result.output,
      inputTokens: result.usage.inputTokens ?? null,
      outputTokens: result.usage.outputTokens ?? null,
    }
  }
}

export const generateWithGemini: StructuredGenerator = createGeminiGenerator()

// ---------------------------------------------------------------------------
// Meta Model API adapter (`muse-spark-1.3-contributor` only, ADR 0014)
// ---------------------------------------------------------------------------

const META_UNSUPPORTED_STRICT_KEYWORDS = new Set([
  '$schema',
  '$id',
  'default',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'pattern',
  'format',
])

export class MetaApiError extends Error {
  readonly statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'MetaApiError'
    this.statusCode = statusCode
  }
}

export function resolveMetaApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env[META_API_KEY_ENV]?.trim() ?? ''
  return key.length > 0 ? key : null
}

/**
 * Selects the default model id when callers omit `ctx.modelId`: uses Meta's
 * `muse-spark-1.3-contributor` when explicit `META_API_KEY` is configured,
 * otherwise keeps `DEFAULT_MODEL_ID` (`gemini-3.8-flash`).
 */
export function resolveConfiguredDefaultModelId(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveMetaApiKey(env) ? DEFAULT_META_MODEL_ID : DEFAULT_MODEL_ID
}

function redactSecrets(message: string, sentApiKey?: string | null): string {
  let out = message
  if (sentApiKey && sentApiKey.length >= 6) {
    out = out.split(sentApiKey).join('[REDACTED]')
  }
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
  out = out.replace(/\bAIza[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]')
  return out
}

function assertAllowedMetaModelId(modelId: string): void {
  if (modelId !== DEFAULT_META_MODEL_ID) {
    throw new Error(
      `Meta Model API provider supports '${DEFAULT_META_MODEL_ID}' only; received '${modelId}'.`,
    )
  }
}

function sanitizeStrictJsonSchemaNode(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(sanitizeStrictJsonSchemaNode)
  }
  if (typeof node !== 'object' || node === null) {
    return node
  }

  const record = node as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(record)) {
    if (META_UNSUPPORTED_STRICT_KEYWORDS.has(key)) continue

    if (
      key === 'properties' &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      const propsOut: Record<string, unknown> = {}
      for (const [propKey, propSchema] of Object.entries(value as Record<string, unknown>)) {
        propsOut[propKey] = sanitizeStrictJsonSchemaNode(propSchema)
      }
      out.properties = propsOut
      continue
    }

    if (
      (key === '$defs' || key === 'definitions') &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      const defsOut: Record<string, unknown> = {}
      for (const [defKey, defSchema] of Object.entries(value as Record<string, unknown>)) {
        defsOut[defKey] = sanitizeStrictJsonSchemaNode(defSchema)
      }
      out[key] = defsOut
      continue
    }

    if (key === 'items' || key === 'additionalProperties') {
      out[key] = typeof value === 'boolean' ? value : sanitizeStrictJsonSchemaNode(value)
      continue
    }

    if (key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
      out[key] = Array.isArray(value)
        ? value.map(sanitizeStrictJsonSchemaNode)
        : sanitizeStrictJsonSchemaNode(value)
      continue
    }

    out[key] = value
  }

  if (out.type === 'object' || (typeof out.properties === 'object' && out.properties !== null)) {
    const props = (out.properties as Record<string, unknown> | undefined) ?? {}
    out.properties = props
    out.required = Object.keys(props)
    out.additionalProperties = false
  }

  return out
}

/**
 * Converts a Zod schema into Meta Model API's `strict: true` JSON Schema subset.
 * Unsupported length/range keywords are stripped for server-side grammar compilation
 * while full Zod validation still runs post-call inside `executeCall`.
 */
export function toMetaStrictJsonSchema(
  schema: z.ZodType<unknown>,
): Record<string, unknown> {
  const rawSchema = z.toJSONSchema(schema) as Record<string, unknown>
  return sanitizeStrictJsonSchemaNode(rawSchema) as Record<string, unknown>
}

export type MetaGeneratorDeps = {
  fetchImpl?: typeof fetch
  endpoint?: string
  getApiKey?: () => string | null
  schemaName?: string
  maxCompletionTokens?: number
}

function normalizeTokenCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.round(value))
}

function extractMetaMessageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (
          typeof part === 'object' &&
          part !== null &&
          (part as { type?: unknown }).type === 'text'
        ) {
          const text = (part as { text?: unknown }).text
          return typeof text === 'string' ? text : ''
        }
        return ''
      })
      .join('')
  }
  return ''
}

function parseMetaJsonContent(rawText: string, finishReason?: string | null): unknown {
  const trimmed = rawText.trim()
  if (!trimmed) {
    throw new Error(
      `Meta Model API returned empty message content${finishReason ? ` (finish_reason=${finishReason})` : ''}.`,
    )
  }

  try {
    return JSON.parse(trimmed)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Meta Model API returned invalid JSON${finishReason ? ` (finish_reason=${finishReason})` : ''}: ${reason}`,
    )
  }
}

/**
 * Direct `fetch`-based structured generator targeting Meta Model API (`muse-spark-1.3-contributor`).
 * Retries are disabled here so `executeCall` writes exactly one `agent_tasks` row per physical attempt.
 */
export function createMetaGenerator(
  deps: MetaGeneratorDeps = {},
): StructuredGenerator {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  const endpoint = deps.endpoint ?? DEFAULT_META_CHAT_COMPLETIONS_URL
  const getApiKey = deps.getApiKey ?? (() => resolveMetaApiKey())
  const schemaName = deps.schemaName ?? 'structured_output'

  return async ({ modelId, prompt, schema, signal }): Promise<StructuredGenerationResult> => {
    assertAllowedMetaModelId(modelId)

    const apiKey = getApiKey()?.trim() || ''
    if (!apiKey) {
      throw new Error(
        `Missing ${META_API_KEY_ENV} environment variable for Meta Model API.`,
      )
    }

    const body: Record<string, unknown> = {
      model: DEFAULT_META_MODEL_ID,
      messages: [{ role: 'user', content: prompt }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: schemaName,
          strict: true,
          schema: toMetaStrictJsonSchema(schema),
        },
      },
    }
    if (deps.maxCompletionTokens !== undefined) {
      body.max_completion_tokens = deps.maxCompletionTokens
    }

    let response: Response
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      throw new Error(`Meta Model API request failed: ${redactSecrets(msg, apiKey)}`, {
        cause: error,
      })
    }

    if (!response.ok) {
      const rawBody = await response.text().catch(() => '')
      const safeDetail = redactSecrets(rawBody.trim(), apiKey).slice(0, 500)
      throw new MetaApiError(
        response.status,
        `Meta Model API HTTP ${response.status}${safeDetail ? `: ${safeDetail}` : ''}`,
      )
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        finish_reason?: string | null
        message?: {
          content?: unknown
          refusal?: unknown
        }
      }>
      usage?: {
        prompt_tokens?: unknown
        completion_tokens?: unknown
      }
    }

    const choice = payload?.choices?.[0]
    const message = choice?.message
    if (typeof message?.refusal === 'string' && message.refusal.trim().length > 0) {
      throw new Error(
        `Meta Model API refused structured output: ${redactSecrets(message.refusal.trim(), apiKey).slice(0, 300)}`,
      )
    }

    const contentText = extractMetaMessageText(message?.content)
    const output = parseMetaJsonContent(contentText, choice?.finish_reason)

    return {
      output,
      inputTokens: normalizeTokenCount(payload?.usage?.prompt_tokens),
      outputTokens: normalizeTokenCount(payload?.usage?.completion_tokens),
    }
  }
}

export const generateWithMeta: StructuredGenerator = createMetaGenerator()

// ---------------------------------------------------------------------------
// The wrapper
// ---------------------------------------------------------------------------

export type CallModelContext = {
  workspaceId: string
  taskKind: TaskKind
  /** Persistence seam. Required: an unrecorded model call is not allowed. */
  store: AgentTaskStore
  strategyId?: string | null
  /** Whatever identifies the inputs for this call, e.g. source or chunk ids. */
  inputRef?: Record<string, unknown>
  /** Defaults to `gemini-3.8-flash`. */
  modelId?: string
  /**
   * `undefined` uses the configured default price table; `null` records no
   * cost (for a caller that has not configured prices yet).
   */
  pricing?: ModelPricing | null
  signal?: AbortSignal
}

export type CallModelResult<T> = {
  output: T
  /** The successful attempt's row. */
  task: PersistedAgentTask
  /** Every physical attempt for this call, oldest first. */
  attempts: PersistedAgentTask[]
}

export type CallModel = <T>(
  schema: z.ZodType<T>,
  prompt: string,
  ctx: CallModelContext,
) => Promise<CallModelResult<T>>

export type CallModelRuntime = {
  generate: StructuredGenerator
  /** Optional model-id dispatcher used by production runtime; defaults to `generate`. */
  resolveGenerator?: (modelId: string) => StructuredGenerator
  /** Optional dynamic default model resolver; falls back to `defaultModelId`. */
  resolveDefaultModelId?: () => string
  sleep: (ms: number) => Promise<void>
  random: () => number
  now: () => number
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  pricing: Readonly<Record<string, ModelPricing>>
  defaultModelId: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveProductionGenerator(modelId: string): StructuredGenerator {
  if (modelId === DEFAULT_META_MODEL_ID) return generateWithMeta
  if (modelId.startsWith('muse-')) {
    assertAllowedMetaModelId(modelId)
  }
  return generateWithGemini
}

const DEFAULT_RUNTIME: CallModelRuntime = {
  generate: generateWithGemini,
  resolveGenerator: resolveProductionGenerator,
  resolveDefaultModelId: () => resolveConfiguredDefaultModelId(),
  sleep,
  random: Math.random,
  now: Date.now,
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  baseDelayMs: DEFAULT_BASE_DELAY_MS,
  maxDelayMs: DEFAULT_MAX_DELAY_MS,
  pricing: DEFAULT_PRICING,
  defaultModelId: DEFAULT_MODEL_ID,
}

/**
 * Full jitter: `random() * min(maxDelay, base * 2^(retryIndex - 1))`.
 * `retryIndex` is 1 for the delay after the first failed attempt.
 */
function backoffDelayMs(
  retryIndex: number,
  runtime: Pick<CallModelRuntime, 'baseDelayMs' | 'maxDelayMs' | 'random'>,
): number {
  const ceiling = Math.min(
    runtime.maxDelayMs,
    runtime.baseDelayMs * 2 ** (retryIndex - 1),
  )
  const jitter = Math.max(0, Math.min(1, runtime.random()))
  return Math.floor(jitter * ceiling)
}

function elapsedMs(startedAt: number, finishedAt: number): number {
  return Math.max(0, Math.round(finishedAt - startedAt))
}

/**
 * Statuses the wrapper retries: rate limiting (429) and transient provider
 * capacity (503, e.g. "high demand"). The fallback covers provider errors that
 * carry the status but are not the SDK's `APICallError` instance, including
 * the Meta generator's own `MetaApiError`.
 */
const RETRYABLE_PROVIDER_STATUS_CODES = new Set([429, 503])

function isRetryableStatus(value: unknown): boolean {
  return (
    typeof value === 'number' && RETRYABLE_PROVIDER_STATUS_CODES.has(value)
  )
}

export function isRetryableProviderError(error: unknown): boolean {
  if (APICallError.isInstance(error)) return isRetryableStatus(error.statusCode)
  if (typeof error !== 'object' || error === null) return false
  if (isRetryableStatus((error as { statusCode?: unknown }).statusCode)) {
    return true
  }
  const cause = (error as { cause?: unknown }).cause
  return (
    typeof cause === 'object' &&
    cause !== null &&
    isRetryableStatus((cause as { statusCode?: unknown }).statusCode)
  )
}

function describeError(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return redactSecrets(raw)
}

function computeCostUsd(
  pricing: ModelPricing | null,
  inputTokens: number | null,
  outputTokens: number | null,
): string | null {
  if (pricing === null) return null
  if (inputTokens === null && outputTokens === null) return null

  const usd =
    ((inputTokens ?? 0) * pricing.inputUsdPerMillionTokens +
      (outputTokens ?? 0) * pricing.outputUsdPerMillionTokens) /
    1_000_000
  return usd.toFixed(6)
}

function buildTaskRow(
  ctx: CallModelContext,
  modelId: string,
  status: AgentTaskStatus,
  output: unknown,
  error: string | null,
  tokens: { inputTokens: number | null; outputTokens: number | null },
  latencyMs: number,
  pricing: ModelPricing | null,
): AgentTaskInsert {
  return {
    workspaceId: ctx.workspaceId,
    strategyId: ctx.strategyId ?? null,
    taskKind: ctx.taskKind,
    model: modelId,
    status,
    inputRef: ctx.inputRef ?? {},
    output,
    error,
    promptTokens: tokens.inputTokens,
    completionTokens: tokens.outputTokens,
    costUsd: computeCostUsd(pricing, tokens.inputTokens, tokens.outputTokens),
    latencyMs,
  }
}

export class AgentTaskPersistenceError extends Error {
  constructor(cause: unknown) {
    super('Could not persist the model attempt', { cause })
    this.name = 'AgentTaskPersistenceError'
  }
}

async function recordTask(
  store: AgentTaskStore,
  row: AgentTaskInsert,
): Promise<PersistedAgentTask> {
  try {
    const { id } = await store.insert(row)
    return { ...row, id }
  } catch (error) {
    throw new AgentTaskPersistenceError(error)
  }
}

type AttemptOutcome<T> =
  | {
      ok: true
      output: T
      generated: StructuredGenerationResult
      latencyMs: number
    }
  | {
      ok: false
      error: unknown
      generated: StructuredGenerationResult | null
      latencyMs: number
    }

/**
 * One physical request. Latency is measured once, immediately after the
 * request returns, so Zod parsing never inflates it.
 */
async function runAttempt<T>(
  schema: z.ZodType<T>,
  prompt: string,
  ctx: CallModelContext,
  modelId: string,
  generator: StructuredGenerator,
  runtime: CallModelRuntime,
): Promise<AttemptOutcome<T>> {
  const startedAt = runtime.now()
  let generated: StructuredGenerationResult

  try {
    generated = await generator({
      modelId,
      prompt,
      schema,
      signal: ctx.signal,
    })
  } catch (error) {
    return {
      ok: false,
      error,
      generated: null,
      latencyMs: elapsedMs(startedAt, runtime.now()),
    }
  }

  const latencyMs = elapsedMs(startedAt, runtime.now())
  try {
    return {
      ok: true,
      output: schema.parse(generated.output) as T,
      generated,
      latencyMs,
    }
  } catch (error) {
    return { ok: false, error, generated, latencyMs }
  }
}

async function executeCall<T>(
  schema: z.ZodType<T>,
  prompt: string,
  ctx: CallModelContext,
  runtime: CallModelRuntime,
): Promise<CallModelResult<T>> {
  const modelId =
    ctx.modelId ?? runtime.resolveDefaultModelId?.() ?? runtime.defaultModelId
  const generator = runtime.resolveGenerator
    ? runtime.resolveGenerator(modelId)
    : runtime.generate
  const pricing =
    ctx.pricing === undefined
      ? (runtime.pricing[modelId] ?? null)
      : ctx.pricing
  const attempts: PersistedAgentTask[] = []

  for (let attempt = 1; attempt <= runtime.maxAttempts; attempt += 1) {
    const outcome = await runAttempt(schema, prompt, ctx, modelId, generator, runtime)

    if (outcome.ok) {
      const task = await recordTask(
        ctx.store,
        buildTaskRow(
          ctx,
          modelId,
          'succeeded',
          outcome.output,
          null,
          {
            inputTokens: outcome.generated.inputTokens,
            outputTokens: outcome.generated.outputTokens,
          },
          outcome.latencyMs,
          pricing,
        ),
      )
      attempts.push(task)
      return { output: outcome.output, task, attempts }
    }

    const retry = isRetryableProviderError(outcome.error) && attempt < runtime.maxAttempts

    // Persistence is deliberately outside the request handling above: if the
    // insert fails, it must surface as a database error, not trigger a second
    // insert for the same physical attempt.
    const task = await recordTask(
      ctx.store,
      buildTaskRow(
        ctx,
        modelId,
        retry ? 'retried' : 'failed',
        outcome.generated?.output ?? null,
        describeError(outcome.error),
        {
          inputTokens: outcome.generated?.inputTokens ?? null,
          outputTokens: outcome.generated?.outputTokens ?? null,
        },
        outcome.latencyMs,
        pricing,
      ),
    )
    attempts.push(task)

    if (!retry) throw outcome.error

    await runtime.sleep(backoffDelayMs(attempt, runtime))
  }

  // The loop either returns or throws on the last attempt.
  throw new Error('callModel exhausted every attempt without a result')
}

let processTail: Promise<unknown> = Promise.resolve()

/**
 * Sequential process-wide queue shared across generation and embedding calls
 * to uphold the ADR 0009 and docs/03 "pipeline never issues parallel requests" rule.
 */
export function enqueueProcessTask<T>(fn: () => Promise<T>): Promise<T> {
  const run = processTail.then(() => fn())
  processTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/**
 * Build an isolated wrapper. Production uses the default `callModel` export so
 * that every call in the process shares one queue; the factory exists so tests
 * can inject a fake generator, clock and sleep without touching a live key.
 */
export function createCallModel(
  overrides: Partial<CallModelRuntime> = {},
): CallModel {
  const runtime: CallModelRuntime = {
    ...DEFAULT_RUNTIME,
    ...overrides,
    // When tests inject a fake `generate` without explicit `resolveGenerator`, bypass production routing
    // and pin `defaultModelId` so unit tests stay independent of ambient environment keys.
    ...(overrides.generate && !overrides.resolveGenerator
      ? {
          resolveGenerator: () => overrides.generate!,
          resolveDefaultModelId: overrides.resolveDefaultModelId ?? (() => overrides.defaultModelId ?? DEFAULT_MODEL_ID),
        }
      : {}),
  }
  let localTail: Promise<unknown> = Promise.resolve()
  const isCustom = Object.keys(overrides).length > 0

  return <T>(
    schema: z.ZodType<T>,
    prompt: string,
    ctx: CallModelContext,
  ): Promise<CallModelResult<T>> => {
    if (isCustom) {
      const run = localTail.then(() => executeCall(schema, prompt, ctx, runtime))
      localTail = run.then(
        () => undefined,
        () => undefined,
      )
      return run
    }
    return enqueueProcessTask(() => executeCall(schema, prompt, ctx, runtime))
  }
}

/**
 * The one function every call site imports. The queue is process-wide, which is
 * exactly the "every call is sequential" rule docs/03-agent-pipeline.md states.
 */
export const callModel: CallModel = createCallModel()
