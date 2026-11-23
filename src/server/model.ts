/**
 * The one wrapper every model call goes through.
 *
 * docs/03-agent-pipeline.md fixes four rules this file exists to enforce:
 *
 * 1. Calls are sequential. Gemini's free-tier quota is per project and
 *    unpublished, so this wrapper queues every call behind the previous one.
 * 2. A 429 backs off exponentially with jitter. Other failures do not retry;
 *    they are the caller's problem (a repair is a new pipeline task, not a
 *    hidden retry).
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
 * Structured output stays inside Gemini's documented subset: the caller passes
 * a flat, non-recursive Zod schema. The wrapper parses the result with that
 * same Zod schema after the call, because Gemini silently ignores `minLength`,
 * `maxLength` and `uniqueItems` (ADR 0009).
 */
import { APICallError, Output, generateText } from 'ai'
import type { LanguageModel } from 'ai'
import { google } from '@ai-sdk/google'
import type { z } from 'zod'
import type { AgentTaskStatus, TaskKind } from '../shared/types'
import { agentTasks, type NewAgentTask } from '../db/schema'
import type { Database } from '../db/client'

/** The pinned text model (CLAUDE.md). */
export const DEFAULT_MODEL_ID = 'gemini-3.8-flash'

/**
 * One initial attempt plus two retries. docs/03-agent-pipeline.md sets the
 * ceiling for repair at two attempts and docs/06-risks.md budgets the pipeline
 * around that ceiling; the same bound keeps a 429 cascade inside the
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
 * List price for the pinned model, used to fill `agent_tasks.cost_usd`.
 * Override through `createCallModel({ pricing })` if Google changes the price;
 * the row records the cost that the configured table produced.
 */
export const DEFAULT_PRICING: Readonly<Record<string, ModelPricing>> = {
  [DEFAULT_MODEL_ID]: {
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

function resolveGeminiModel(modelId: string): LanguageModel {
  const cached = modelCache.get(modelId)
  if (cached) return cached
  const model = google(modelId)
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
  generate: generateWithGemini,
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
 * A 429 is the only error the wrapper retries. The fallback covers provider
 * errors that carry the status but are not the SDK's `APICallError` instance.
 */
export function isRateLimitError(error: unknown): boolean {
  if (APICallError.isInstance(error)) return error.statusCode === 429
  if (typeof error !== 'object' || error === null) return false
  if ((error as { statusCode?: unknown }).statusCode === 429) return true
  const cause = (error as { cause?: unknown }).cause
  return (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as { statusCode?: unknown }).statusCode === 429
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

async function recordTask(
  store: AgentTaskStore,
  row: AgentTaskInsert,
): Promise<PersistedAgentTask> {
  const { id } = await store.insert(row)
  return { ...row, id }
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

    const retry = isRateLimitError(outcome.error) && attempt < runtime.maxAttempts

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

/**
 * Build an isolated wrapper. Production uses the default `callModel` export so
 * that every call in the process shares one queue; the factory exists so tests
 * can inject a fake generator, clock and sleep without touching a live key.
 */
export function createCallModel(
  overrides: Partial<CallModelRuntime> = {},
): CallModel {
  const runtime: CallModelRuntime = { ...DEFAULT_RUNTIME, ...overrides }
  let tail: Promise<unknown> = Promise.resolve()

  return <T>(
    schema: z.ZodType<T>,
    prompt: string,
    ctx: CallModelContext,
  ): Promise<CallModelResult<T>> => {
    const run = tail.then(() => executeCall(schema, prompt, ctx, runtime))
    // A failed call must not poison the queue for the next one.
    tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

/**
 * The one function every call site imports. The queue is process-wide, which is
 * exactly the "every call is sequential" rule docs/03-agent-pipeline.md states.
 */
export const callModel: CallModel = createCallModel()
