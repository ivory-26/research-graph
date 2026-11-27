/**
 * Recorded model-output replay for the seed's two-database baseline.
 *
 * A live model is not a deterministic function: two seeds over the same PDFs
 * produced different claims, method titles and edges. The issue's canonical
 * baseline needs two independent databases to be logically identical, so the
 * seed can capture one live run's model responses and replay them.
 *
 * What is replayed is the model's structured output, never a graph row. The
 * production pipeline still runs: prompts are built by the real extraction,
 * edge, planner and evaluator code; each replayed output is parsed with the
 * same Zod schema; the production store validates quotes, node ownership,
 * evidence and the DB constraints before writing.
 *
 * Model outputs contain database-minted UUIDs (chunk ids, node ids, claim
 * ids). Replaying raw output would point at the first seed's rows. The replay
 * layer therefore normalises every UUID in the prompt to an ordered token,
 * keys the recording by that normalised prompt, and rewrites the recorded
 * output's UUIDs to the current seed's UUIDs for the same token. The rest of
 * the prompt must match exactly; a changed prompt is a hard error, not a
 * fuzzy fallback.
 *
 * Environment:
 * - `SEED_RECORD_MODEL_OUTPUTS=<path>` wraps the real generator and writes a
 *   recording after every call.
 * - `SEED_REPLAY_MODEL_OUTPUTS=<path>` replaces the generator with the
 *   recorded responses.
 * Set at most one. Neither is set in normal application runtime.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import type {
  StructuredGenerationRequest,
  StructuredGenerationResult,
  StructuredGenerator,
} from './model'

export const MODEL_OUTPUT_RECORD_ENV = 'SEED_RECORD_MODEL_OUTPUTS'
export const MODEL_OUTPUT_REPLAY_ENV = 'SEED_REPLAY_MODEL_OUTPUTS'

const FILE_VERSION = 1
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

type ModelOutputRecord = {
  key: string
  modelId: string
  /** The original prompt, with database UUIDs intact. */
  prompt: string
  output: unknown
  inputTokens: number | null
  outputTokens: number | null
}

type ModelOutputFile = {
  version: number
  records: ModelOutputRecord[]
}

export type NormalizedPrompt = {
  normalized: string
  /** UUID (lowercase) → ordered placeholder. */
  ids: Map<string, string>
  /** Ordered placeholder → UUID (lowercase). */
  placeholders: Map<string, string>
}

/**
 * Replace every UUID with an ordered placeholder.
 *
 * The same UUID always receives the same placeholder, and first appearance
 * determines the number. Two prompts that differ only in DB-minted UUIDs
 * therefore normalise to the same string.
 */
export function normalizeModelPrompt(prompt: string): NormalizedPrompt {
  const ids = new Map<string, string>()
  const placeholders = new Map<string, string>()

  const normalized = prompt.replace(UUID_PATTERN, (match) => {
    const id = match.toLowerCase()
    const existing = ids.get(id)
    if (existing) return existing

    const placeholder = `__rg_uuid_${ids.size + 1}__`
    ids.set(id, placeholder)
    placeholders.set(placeholder, id)
    return placeholder
  })

  return { normalized, ids, placeholders }
}

/** Stable key for one model request: model id plus the UUID-normalised prompt. */
export function modelOutputKey(request: {
  modelId: string
  prompt: string
}): string {
  return createHash('sha256')
    .update(
      `${request.modelId}\u0000${normalizeModelPrompt(request.prompt).normalized}`,
      'utf8',
    )
    .digest('hex')
}

/**
 * Replace recorded UUIDs in a JSON-shaped value with the current seed's UUIDs.
 * Values not present in the map are left untouched; the production validator
 * will reject them if they are genuinely invalid.
 */
export function rewriteRecordedOutput(
  value: unknown,
  idMap: ReadonlyMap<string, string>,
): unknown {
  if (typeof value === 'string') {
    return value.replace(UUID_PATTERN, (match) => {
      return idMap.get(match.toLowerCase()) ?? match
    })
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteRecordedOutput(item, idMap))
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        rewriteRecordedOutput(child, idMap),
      ]),
    )
  }
  return value
}

function readRecording(path: string, allowMissing: boolean): ModelOutputRecord[] {
  if (!existsSync(path)) {
    if (allowMissing) return []
    throw new Error(
      `No recorded model output file at ${path}. Create one with ${MODEL_OUTPUT_RECORD_ENV}.`,
    )
  }

  const parsed = JSON.parse(readFileSync(path, 'utf8')) as ModelOutputFile
  if (
    parsed.version !== FILE_VERSION ||
    !Array.isArray(parsed.records) ||
    parsed.records.some(
      (record) =>
        typeof record.key !== 'string' ||
        typeof record.modelId !== 'string' ||
        typeof record.prompt !== 'string',
    )
  ) {
    throw new Error(`Recorded model output file ${path} has an unsupported shape.`)
  }
  return parsed.records
}

function writeRecording(path: string, records: readonly ModelOutputRecord[]): void {
  mkdirSync(dirname(path), { recursive: true })
  const body: ModelOutputFile = {
    version: FILE_VERSION,
    records: [...records].sort((a, b) => a.key.localeCompare(b.key)),
  }
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
}

/** Wrap a real generator, persisting every request/response to `path`. */
export function createRecordingGenerator(
  real: StructuredGenerator,
  path: string,
): StructuredGenerator {
  const target = resolve(path)
  const records = new Map<string, ModelOutputRecord>()
  for (const record of readRecording(target, true)) {
    records.set(record.key, record)
  }

  return async (request: StructuredGenerationRequest) => {
    const result = await real(request)
    const key = modelOutputKey(request)
    records.set(key, {
      key,
      modelId: request.modelId,
      prompt: request.prompt,
      output: result.output,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    })
    writeRecording(target, [...records.values()])
    return result
  }
}

/** Replay recorded outputs, remapping the recording's UUIDs to this seed's. */
export function createReplayGenerator(path: string): StructuredGenerator {
  const target = resolve(path)
  const records = new Map<string, ModelOutputRecord>()
  for (const record of readRecording(target, false)) {
    records.set(record.key, record)
  }

  return async (
    request: StructuredGenerationRequest,
  ): Promise<StructuredGenerationResult> => {
    const current = normalizeModelPrompt(request.prompt)
    const key = modelOutputKey(request)
    const record = records.get(key)
    if (!record) {
      throw new Error(
        `No recorded model output for ${request.modelId} (key ${key.slice(0, 12)}…) in ${target}. ` +
          'The prompt differs from the captured run; recapture with ' +
          `${MODEL_OUTPUT_RECORD_ENV}.`,
      )
    }

    const recorded = normalizeModelPrompt(record.prompt)
    if (recorded.normalized !== current.normalized) {
      throw new Error(
        `Recorded prompt for ${request.modelId} does not match after UUID normalisation.`,
      )
    }

    const idMap = new Map<string, string>()
    for (const [placeholder, recordedId] of recorded.placeholders) {
      const currentId = current.placeholders.get(placeholder)
      if (!currentId) {
        throw new Error(
          `Recorded UUID ${placeholder} has no counterpart in the current prompt.`,
        )
      }
      idMap.set(recordedId, currentId)
    }

    return {
      output: rewriteRecordedOutput(record.output, idMap),
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
    }
  }
}

/**
 * Pick the generator from the seed's environment. Normal application runtime
 * leaves both variables unset and gets the real Meta generator.
 */
export function defaultGeneratorFromEnv(
  real: StructuredGenerator,
): StructuredGenerator {
  const replay = process.env[MODEL_OUTPUT_REPLAY_ENV]?.trim()
  const record = process.env[MODEL_OUTPUT_RECORD_ENV]?.trim()

  if (replay && record) {
    throw new Error(
      `Set only one of ${MODEL_OUTPUT_RECORD_ENV} and ${MODEL_OUTPUT_REPLAY_ENV}.`,
    )
  }
  if (replay) return createReplayGenerator(replay)
  if (record) return createRecordingGenerator(real, record)
  return real
}
