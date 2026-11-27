/**
 * Durable `run_artifacts` persistence for a terminal run.
 *
 * A run's `ExperimentResult.artifacts` is the only runner-produced evidence
 * outside `runs.metrics` and `runs.stdout`. This module writes it to
 * `run_artifacts` without inventing anything:
 *
 * - **Metadata is always durable.** `path`, `sha256`, `bytes` and a `kind`
 *   derived from the path are written for every artifact the runner reports.
 * - **Content is verified before it is stored.** The runner's `content` is
 *   canonical base64 of the file bytes (`defaultCollectArtifacts` in
 *   `src/server/runner.ts`). The helper decodes it, hashes the bytes and
 *   refuses the write when either the hash or the byte count disagrees with
 *   the runner's own metadata.
 * - **Content is inline only when small.** `run_artifacts.content` is "inline
 *   for small artifacts; null if external" (docs/02-data-model.md). There is no
 *   external artifact store, so an artifact above `MAX_INLINE_ARTIFACT_BYTES`
 *   keeps its verified metadata row and `content` stays null. The omission is
 *   returned to the caller, never silently truncated.
 * - **Missing content is legal.** A collector may return hash and size only;
 *   the frozen `ExperimentResult` contract makes `content` optional. The row
 *   keeps the declared metadata and `content` is null. There are no bytes to
 *   verify in that case, and the result reports the omission.
 * - **Terminal runs only.** `queued` and `running` runs have no result yet;
 *   their artifacts would be unverifiable claims about a run still in flight.
 *   The terminal-status list is #7's (`isTerminalRunStatus`), not a copy.
 * - **Stable and non-destructive.** This writer re-reads a run's existing
 *   rows and reuses one with the same hash, refusing a hash or byte-count
 *   disagreement rather than overwriting it. Concurrent writers are serialized
 *   by the terminal run-row lock. `run_artifacts` has no unique constraint on
 *   `(run_id, path)`, so the guarantee is that lock plus this check, not a
 *   database invariant; `saveNotebookArtifact` in `../notebook.ts` inserts
 *   directly and relies on a single post-terminal call. Rows that are not in
 *   the new input are left alone; this module never deletes evidence.
 *
 * `metrics.json` is deliberately not an artifact: the sandbox contract makes it
 * the run's metrics, and `runs.metrics` is its durable record.
 *
 * Errors carry codes and server-log detail. None of the messages here are safe
 * to persist or stream as user-facing text; the delivery layer keeps its
 * product-authored sentences (see `./errors` and `./stream`).
 */
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { eq } from 'drizzle-orm'

import type { Database } from '../../db/client'
import { runArtifacts, runs } from '../../db/schema'
import type { ExperimentResult } from '../../shared/types'
import { isTerminalRunStatus } from '../pipeline'

/** The `run_artifacts.kind` vocabulary from docs/02-data-model.md. */
export type ArtifactKind = 'figure' | 'table' | 'notebook' | 'log'

/** How an inline `content` string encodes the artifact bytes. */
export type RunArtifactContentEncoding = 'base64' | 'utf8'

/** Why a row exists without inline content. */
export type ArtifactContentOmissionReason = 'missing' | 'too-large'

/**
 * Largest verified payload stored inline in `run_artifacts.content`.
 *
 * Postgres `text` would hold more, but "inline for small artifacts" is a
 * deliberate ceiling: a pathological file in `/output` must not turn one run
 * row set into hundreds of megabytes. Matplotlib figures and nbformat
 * notebooks are comfortably below this.
 */
export const MAX_INLINE_ARTIFACT_BYTES = 256 * 1024

/** One artifact as the runner reports it, with optional caller hints. */
export type RunArtifactInput = ExperimentResult['artifacts'][number] & {
  /**
   * Encoding of `content`. Defaults to `base64`, the format
   * `defaultCollectArtifacts` emits. `utf8` is for artifacts generated
   * app-side (for example an nbformat notebook), not for runner output.
   */
  contentEncoding?: RunArtifactContentEncoding
  /** Defaults to an extension-based classification. */
  kind?: ArtifactKind
}

/** A verified artifact, ready to be written. */
export type PreparedRunArtifact = {
  path: string
  kind: ArtifactKind
  sha256: string
  bytes: number
  /** Canonical inline content, or null when it was missing or too large. */
  content: string | null
  /** Set when `content` is null; null when content is stored inline. */
  contentOmitted: ArtifactContentOmissionReason | null
}

/** A persisted `run_artifacts` row. */
export type PersistedRunArtifact = {
  id: string
  runId: string
  kind: ArtifactKind
  path: string
  sha256: string
  bytes: number
  content: string | null
}

/** A path whose naive durable record has no inline content. */
export type RunArtifactOmission = {
  path: string
  reason: ArtifactContentOmissionReason
}

export type SaveRunArtifactsResult = {
  runId: string
  /** The rows for the artifacts supplied in this call, ordered by path. */
  artifacts: PersistedRunArtifact[]
  /** Rows this call inserted. */
  inserted: number
  /** Rows this call found already persisted (content may have been completed). */
  existing: number
  /** Rows that are durable with `content: null`, and why. */
  omitted: RunArtifactOmission[]
}

export type RunArtifactErrorCode =
  | 'RUN_NOT_FOUND'
  | 'RUN_NOT_TERMINAL'
  | 'INVALID_ARTIFACT'
  | 'ARTIFACT_INTEGRITY'
  | 'ARTIFACT_CONFLICT'

/**
 * A refused artifact write.
 *
 * `message` is server-log detail. The delivery layer must not copy it onto the
 * wire or into a persisted `pipeline.failed.error`.
 */
export class RunArtifactError extends Error {
  readonly code: RunArtifactErrorCode

  constructor(code: RunArtifactErrorCode, message: string) {
    super(message)
    this.name = 'RunArtifactError'
    this.code = code
  }
}

const ARTIFACT_KINDS = new Set<ArtifactKind>([
  'figure',
  'table',
  'notebook',
  'log',
])

const NOTEBOOK_EXTENSIONS = new Set(['.ipynb'])

const FIGURE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.pdf',
])

const TABLE_EXTENSIONS = new Set([
  '.csv',
  '.tsv',
  '.json',
  '.parquet',
  '.feather',
  '.xlsx',
  '.xls',
])

const SHA256_PATTERN = /^[0-9a-f]{64}$/i

/** Postgres `integer` upper bound; `run_artifacts.bytes` is an `integer`. */
const MAX_INTEGER_BYTES = 2_147_483_647

/**
 * Classifies an artifact from its sandbox path.
 *
 * The runner reports no kind, so the extension is the only signal available.
 * Unknown extensions fall back to `log` rather than inventing a new value: the
 * documented vocabulary is exactly four kinds.
 */
export function classifyArtifactKind(filePath: string): ArtifactKind {
  const extension = posix.extname(filePath).toLowerCase()
  if (NOTEBOOK_EXTENSIONS.has(extension)) return 'notebook'
  if (FIGURE_EXTENSIONS.has(extension)) return 'figure'
  if (TABLE_EXTENSIONS.has(extension)) return 'table'
  return 'log'
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function invalidArtifact(index: number, detail: string): RunArtifactError {
  return new RunArtifactError(
    'INVALID_ARTIFACT',
    `artifact ${index}: ${detail}`,
  )
}

function decodeContent(
  content: string,
  encoding: RunArtifactContentEncoding,
  index: number,
  path: string,
): Buffer {
  if (encoding === 'utf8') {
    return Buffer.from(content, 'utf8')
  }

  const decoded = Buffer.from(content, 'base64')
  // Node's decoder is lenient: it ignores invalid characters and accepts
  // missing padding. Re-encoding is the strict check, so a content string that
  // is not canonical base64 is refused rather than silently decoded to
  // different bytes than the hash describes.
  if (decoded.toString('base64') !== content) {
    throw new RunArtifactError(
      'ARTIFACT_INTEGRITY',
      `artifact ${index} (${path}): content is not canonical base64`,
    )
  }
  return decoded
}

/**
 * Validates, classifies and verifies runner artifacts without touching the
 * database.
 *
 * Deterministic: the returned array is sorted by path (code-unit order, not
 * locale order), so two callers persisting the same result write the same rows
 * in the same order. Throws `RunArtifactError` before any write when an
 * artifact is malformed or its content does not match its declared hash/size.
 */
export function prepareRunArtifacts(
  artifacts: readonly RunArtifactInput[],
): PreparedRunArtifact[] {
  const prepared: PreparedRunArtifact[] = []
  const seenPaths = new Set<string>()

  artifacts.forEach((artifact, index) => {
    if (!artifact || typeof artifact !== 'object') {
      throw invalidArtifact(index, 'expected an object')
    }

    const path = artifact.path
    if (typeof path !== 'string' || path.trim().length === 0) {
      throw invalidArtifact(index, 'path must be a non-empty string')
    }
    if (seenPaths.has(path)) {
      throw invalidArtifact(index, `duplicate path ${path}`)
    }
    seenPaths.add(path)

    if (
      typeof artifact.sha256 !== 'string' ||
      !SHA256_PATTERN.test(artifact.sha256)
    ) {
      throw invalidArtifact(index, `sha256 for ${path} is not 64 hex characters`)
    }
    if (
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 0 ||
      artifact.bytes > MAX_INTEGER_BYTES
    ) {
      throw invalidArtifact(
        index,
        `bytes for ${path} must be an integer between 0 and ${MAX_INTEGER_BYTES}`,
      )
    }

    const kind = artifact.kind ?? classifyArtifactKind(path)
    if (!ARTIFACT_KINDS.has(kind)) {
      throw invalidArtifact(index, `unknown artifact kind ${String(kind)}`)
    }

    const encoding: RunArtifactContentEncoding =
      artifact.contentEncoding ?? 'base64'
    if (encoding !== 'base64' && encoding !== 'utf8') {
      throw invalidArtifact(
        index,
        `unknown content encoding ${String(encoding)}`,
      )
    }

    const declaredSha256 = artifact.sha256.toLowerCase()
    const declaredBytes = artifact.bytes

    // No content: the runner's metadata is the whole record. There is nothing
    // to verify, and the schema allows `content` to be null.
    if (artifact.content === undefined) {
      prepared.push({
        path,
        kind,
        sha256: declaredSha256,
        bytes: declaredBytes,
        content: null,
        contentOmitted: 'missing',
      })
      return
    }

    if (typeof artifact.content !== 'string') {
      throw invalidArtifact(index, `content for ${path} must be a string`)
    }

    const decoded = decodeContent(artifact.content, encoding, index, path)
    if (decoded.byteLength !== declaredBytes) {
      throw new RunArtifactError(
        'ARTIFACT_INTEGRITY',
        `artifact ${index} (${path}): content is ${decoded.byteLength} bytes, declared ${declaredBytes}`,
      )
    }

    const actualSha256 = sha256Hex(decoded)
    if (actualSha256 !== declaredSha256) {
      throw new RunArtifactError(
        'ARTIFACT_INTEGRITY',
        `artifact ${index} (${path}): content hashes to ${actualSha256}, declared ${declaredSha256}`,
      )
    }

    // Verification happens for every payload, including one too large to
    // store: an oversized file with a bad hash is corrupt evidence, not a
    // metadata-only artifact.
    if (decoded.byteLength > MAX_INLINE_ARTIFACT_BYTES) {
      prepared.push({
        path,
        kind,
        sha256: actualSha256,
        bytes: declaredBytes,
        content: null,
        contentOmitted: 'too-large',
      })
      return
    }

    prepared.push({
      path,
      kind,
      sha256: actualSha256,
      bytes: declaredBytes,
      content: artifact.content,
      contentOmitted: null,
    })
  })

  return prepared.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )
}

const artifactReturning = {
  id: runArtifacts.id,
  runId: runArtifacts.runId,
  kind: runArtifacts.kind,
  path: runArtifacts.path,
  sha256: runArtifacts.sha256,
  bytes: runArtifacts.bytes,
  content: runArtifacts.content,
} as const

type ArtifactRowShape = {
  id: string
  runId: string
  kind: string
  path: string
  sha256: string
  bytes: number
  content: string | null
}

function toPersisted(row: ArtifactRowShape): PersistedRunArtifact {
  return {
    id: row.id,
    runId: row.runId,
    // This module writes only the four documented kinds; a legacy row written
    // elsewhere keeps whatever it has.
    kind: row.kind as ArtifactKind,
    path: row.path,
    sha256: row.sha256,
    bytes: row.bytes,
    content: row.content,
  }
}

/**
 * Persists one terminal run's artifacts.
 *
 * The run row is locked first, so concurrent calls for the same run serialize
 * and the second observes the first call's rows instead of inserting duplicates.
 * Everything happens in one transaction: a refused artifact leaves no partial
 * row set behind.
 */
export async function saveRunArtifacts(
  db: Database,
  runId: string,
  artifacts: readonly RunArtifactInput[],
): Promise<SaveRunArtifactsResult> {
  // Verification is pure and happens before the transaction: a corrupt
  // artifact must not hold a run lock while it is rejected.
  const prepared = prepareRunArtifacts(artifacts)

  return db.transaction(async (tx) => {
    const [run] = await tx
      .select({ id: runs.id, status: runs.status })
      .from(runs)
      .where(eq(runs.id, runId))
      .for('update')

    if (!run) {
      throw new RunArtifactError(
        'RUN_NOT_FOUND',
        `run ${runId} does not exist`,
      )
    }
    if (!isTerminalRunStatus(run.status)) {
      throw new RunArtifactError(
        'RUN_NOT_TERMINAL',
        `run ${runId} is ${run.status}; artifacts are only persisted for a terminal run`,
      )
    }

    const existingRows = await tx
      .select(artifactReturning)
      .from(runArtifacts)
      .where(eq(runArtifacts.runId, runId))
      .orderBy(runArtifacts.path, runArtifacts.id)

    // First row per path is the canonical one. Anything older than this
    // module's `(run_id, path)` identity is left untouched rather than
    // deleted behind a user's back.
    const existingByPath = new Map<string, ArtifactRowShape>()
    for (const row of existingRows) {
      if (!existingByPath.has(row.path)) {
        existingByPath.set(row.path, row)
      }
    }

    const persisted: PersistedRunArtifact[] = []
    const omitted: RunArtifactOmission[] = []
    let inserted = 0
    let existing = 0

    for (const artifact of prepared) {
      const current = existingByPath.get(artifact.path)

      if (current) {
        if (
          current.sha256.toLowerCase() !== artifact.sha256 ||
          current.bytes !== artifact.bytes
        ) {
          throw new RunArtifactError(
            'ARTIFACT_CONFLICT',
            `run ${runId} already has ${artifact.path} with different bytes; refusing to overwrite measured evidence`,
          )
        }

        if (current.content === null && artifact.content !== null) {
          // Same hash proves these are the same bytes. Completing a row that
          // an earlier call stored with metadata only is not an overwrite.
          const [updated] = await tx
            .update(runArtifacts)
            .set({ content: artifact.content })
            .where(eq(runArtifacts.id, current.id))
            .returning(artifactReturning)
          persisted.push(toPersisted(updated))
        } else {
          persisted.push(toPersisted(current))
          if (current.content === null) {
            omitted.push({
              path: artifact.path,
              reason: artifact.contentOmitted ?? 'missing',
            })
          }
        }
        existing += 1
        continue
      }

      const [row] = await tx
        .insert(runArtifacts)
        .values({
          runId,
          kind: artifact.kind,
          path: artifact.path,
          sha256: artifact.sha256,
          bytes: artifact.bytes,
          content: artifact.content,
        })
        .returning(artifactReturning)

      persisted.push(toPersisted(row))
      if (artifact.content === null) {
        omitted.push({
          path: artifact.path,
          reason: artifact.contentOmitted ?? 'missing',
        })
      }
      inserted += 1
    }

    return {
      runId,
      artifacts: persisted,
      inserted,
      existing,
      omitted,
    }
  })
}
