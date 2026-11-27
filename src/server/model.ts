/**
 * The one wrapper every model call goes through.
 *
 * docs/03-agent-pipeline.md fixes four rules this file exists to enforce:
 *
 * 1. Calls are sequential. Gemini's free-tier quota is per project and
 *    unpublished, so this wrapper queues every call behind the previous one.
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
 * Structured output goes through the AI SDK's `Output.object`. The caller
 * passes a flat, non-recursive Zod schema; the wrapper still re-parses with
 * that schema because provider-side constraint support differs. Meta Model
 * API constrains decoding to the schema; Gemini silently ignores `minLength`,
 * `maxLength` and `uniqueItems` (ADR 0009).
 */
import { APICallError, Output, generateText } from 'ai'
import type { LanguageModel } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { google } from '@ai-sdk/google'
import type { z } from 'zod'
import type { AgentTaskStatus, TaskKind } from '../shared/types'
import { agentTasks, type NewAgentTask } from '../db/schema'
import type { Database } from '../db/client'

/**
 * The pinned text model (CLAUDE.md). Meta Model API's Contributor-mode
 * variant is used for every text call; Gemini remains the embedding provider.
 */
export const DEFAULT_MODEL_ID = 'muse-spark-1.3-contributor'

/** Meta Model API's OpenAI-compatible base URL. */
export const DEFAULT_MODEL_BASE_URL = 'https://api.meta.ai/v1'

/** Bearer token for the Meta Model API. Never logged or persisted. */
export const MODEL_API_KEY_ENV = 'MODEL_API_KEY'

/** Optional override for self-hosted or proxied Meta Model API endpoints. */
export const MODEL_API_BASE_URL_ENV = 'MODEL_API_BASE_URL'

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
 * Google changes them; the row records the cost this table produced.
 *
 * `muse-spark-1.3-contributor` is the default text model. Its entry is Meta
 * Model API's Contributor-mode rate: $0.10 per million input tokens and $0.20
 * per million output tokens. Contributor mode permits Meta to use the prompts
 * and responses to train future models; the project sends only public paper
 * text and generated specs, never a secret or personal document. The two
 * Gemini entries are retained for a caller that explicitly overrides the
 * default and for the embedding-adjacent tests. This is an accounting
 * estimate from published prices, not billing telemetry.
 */
export const DEFAULT_PRICING: Readonly<Record<string, ModelPricing>> = {
  'muse-spark-1.3-contributor': {
    inputUsdPerMillionTokens: 0.1,
    outputUsdPerMillionTokens: 0.2,
  },
  'gemini-4-hydrogen': {
    inputUsdPerMillionTokens: 1.5,
    outputUsdPerMillionTokens: 7.5,
  },
  'gemini-3.8-flash': {
    inputUsdPerMillionTokens: 0.3,
    outputUsdPerMillionTokens: 2.5,
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
 * production uses `generateWithMeta`.
 */
export type StructuredGenerator = (
  request: StructuredGenerationRequest,
) => Promise<StructuredGenerationResult>

/**
 * A deliberately loose view of `generateText`. The SDK's generic overloads
 * make its exact type unusable as an injected dependency; the default generator
 * below calls the real function with the documented AI SDK 7 options.
 */
export type StructuredGenerateText = (options: {
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

export type StructuredGeneratorDeps = {
  /** Injected in tests. Defaults to the AI SDK's `generateText`. */
  generateText?: StructuredGenerateText
  /** Injected in tests. Defaults to the provider's cached model. */
  resolveModel?: (modelId: string) => LanguageModel
}

const geminiModelCache = new Map<string, LanguageModel>()

function resolveGeminiModel(modelId: string): LanguageModel {
  const cached = geminiModelCache.get(modelId)
  if (cached) return cached
  const model = google(modelId)
  geminiModelCache.set(modelId, model)
  return model
}

let metaProvider: ReturnType<typeof createOpenAICompatible> | null = null

function getMetaProvider(): ReturnType<typeof createOpenAICompatible> {
  if (metaProvider) return metaProvider

  const apiKey = process.env[MODEL_API_KEY_ENV]?.trim()
  if (!apiKey) {
    throw new Error(
      `${MODEL_API_KEY_ENV} is required for the Meta Model API text provider.`,
    )
  }

  metaProvider = createOpenAICompatible({
    name: 'meta-model-api',
    baseURL:
      process.env[MODEL_API_BASE_URL_ENV]?.trim() || DEFAULT_MODEL_BASE_URL,
    apiKey,
    // Meta constrains decoding to the supplied JSON Schema; without this the
    // OpenAI-compatible provider would fall back to plain JSON mode.
    supportsStructuredOutputs: true,
  })
  return metaProvider
}

const metaModelCache = new Map<string, LanguageModel>()

function resolveMetaModel(modelId: string): LanguageModel {
  const cached = metaModelCache.get(modelId)
  if (cached) return cached
  const model = getMetaProvider()(modelId)
  metaModelCache.set(modelId, model)
  return model
}

/**
 * The shared structured-output generator. `maxRetries: 0` is not a tuning
 * knob: retries belong to `createCallModel` so every physical attempt gets a
 * task row.
 */
function createStructuredGenerator(
  defaultResolveModel: (modelId: string) => LanguageModel,
  deps: StructuredGeneratorDeps,
): StructuredGenerator {
  const resolveModel = deps.resolveModel ?? defaultResolveModel
  const generate: StructuredGenerateText =
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

/** The Gemini generator, retained for explicit overrides and tests. */
export function createGeminiGenerator(
  deps: StructuredGeneratorDeps = {},
): StructuredGenerator {
  return createStructuredGenerator(resolveGeminiModel, deps)
}

/** The default text generator: Meta Model API, OpenAI-compatible. */
export function createMetaGenerator(
  deps: StructuredGeneratorDeps = {},
): StructuredGenerator {
  return createStructuredGenerator(resolveMetaModel, deps)
}

export const generateWithGemini: StructuredGenerator = createGeminiGenerator()
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
  /** Defaults to `muse-spark-1.3-contributor`. */
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

const DEFAULT_RUNTIME: CallModelRuntime = {
  generate: generateWithMeta,
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
 * capacity (503, e.g. Gemini's "high demand"). Everything else is final.
 */
const RETRYABLE_PROVIDER_STATUS_CODES = new Set([429, 503])

function isRetryableStatus(value: unknown): boolean {
  return (
    typeof value === 'number' && RETRYABLE_PROVIDER_STATUS_CODES.has(value)
  )
}

/**
 * A 429 or 503 is retried. The fallback covers provider errors that carry the
 * status but are not the SDK's `APICallError` instance.
 */
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
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
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
  runtime: CallModelRuntime,
): Promise<AttemptOutcome<T>> {
  const startedAt = runtime.now()
  let generated: StructuredGenerationResult

  try {
    generated = await runtime.generate({
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
  const modelId = ctx.modelId ?? runtime.defaultModelId
  const pricing =
    ctx.pricing === undefined
      ? (runtime.pricing[modelId] ?? null)
      : ctx.pricing
  const attempts: PersistedAgentTask[] = []

  for (let attempt = 1; attempt <= runtime.maxAttempts; attempt += 1) {
    const outcome = await runAttempt(schema, prompt, ctx, modelId, runtime)

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

    const retry =
      isRetryableProviderError(outcome.error) && attempt < runtime.maxAttempts

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
  const runtime: CallModelRuntime = { ...DEFAULT_RUNTIME, ...overrides }
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
