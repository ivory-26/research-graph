/**
 * Authorized reads of persisted `run_artifacts`.
 *
 * The write side lives in two places on purpose:
 *
 * - `pipeline-delivery/artifacts.ts` verifies and stores runner output;
 * - `notebook.ts` builds the reproducibility notebook deterministically.
 *
 * This module is the one read side. It never invents an artifact, never
 * re-derives a metric, and never exposes a row from another workspace. The
 * route adapter proves the actor and workspace membership before calling in
 * (`run-artifacts-route.ts`); the SQL here is scoped by the run id and joins
 * the run's experiment only to report its workspace for that check.
 *
 * `content` has no encoding column in the frozen schema. The write paths differ
 * — `saveRunArtifacts` stores canonical base64, `saveNotebookArtifact` stores
 * UTF-8 JSON — so a read verifies both interpretations against the recorded
 * `sha256` and byte count and refuses the row if neither matches. A corrupt
 * artifact is an integrity error, not a different file.
 */
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { and, eq, sql } from 'drizzle-orm'

import type { Database } from '../db/client'
import { experiments, runArtifacts, runs } from '../db/schema'
import {
  findNotebookArtifact,
  runArtifactDownloadPath,
  type RunArtifactKind,
  type RunArtifactManifest,
  type RunArtifactManifestEntry,
} from '../shared/run-artifacts'
import type { RunStatus, Verdict } from '../shared/types'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ARTIFACT_KINDS: ReadonlySet<RunArtifactKind> = new Set([
  'figure',
  'table',
  'notebook',
  'log',
])

export type RunArtifactReadErrorCode =
  | 'INVALID_ARTIFACT_ID'
  | 'ARTIFACT_NOT_FOUND'
  | 'ARTIFACT_CONTENT_MISSING'
  | 'ARTIFACT_INTEGRITY'

/**
 * A refused read. `message` is server-log detail; the route maps it to a
 * product-authored sentence and never streams it.
 */
export class RunArtifactReadError extends Error {
  readonly code: RunArtifactReadErrorCode

  constructor(code: RunArtifactReadErrorCode, message: string) {
    super(message)
    this.name = 'RunArtifactReadError'
    this.code = code
  }
}

export type RunArtifactContent = {
  artifact: RunArtifactManifestEntry
  bytes: Buffer
}

function normalizeKind(kind: string): RunArtifactKind {
  return ARTIFACT_KINDS.has(kind as RunArtifactKind)
    ? (kind as RunArtifactKind)
    : 'log'
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Decodes a `run_artifacts.content` string by trying the two encodings the
 * writers use and accepting only the one that reproduces the recorded bytes.
 */
export function decodeArtifactContent(
  content: string,
  expectedSha256: string,
  expectedBytes: number,
): Buffer {
  const isCanonicalBase64 =
    content.length > 0 &&
    content.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(content)

  const candidates: Buffer[] = []
  if (isCanonicalBase64) candidates.push(Buffer.from(content, 'base64'))
  candidates.push(Buffer.from(content, 'utf8'))

  for (const candidate of candidates) {
    if (
      candidate.byteLength === expectedBytes &&
      sha256Hex(candidate) === expectedSha256.toLowerCase()
    ) {
      return candidate
    }
  }

  throw new RunArtifactReadError(
    'ARTIFACT_INTEGRITY',
    `artifact content does not reproduce the recorded sha256/bytes (expected ${expectedBytes} bytes)`,
  )
}

/** The response content type for a stored artifact. */
export function artifactContentType(artifact: {
  kind: RunArtifactKind
  path: string
}): string {
  const extension = posix.extname(artifact.path).toLowerCase()
  switch (extension) {
    case '.ipynb':
      return 'application/x-ipynb+json; charset=utf-8'
    case '.csv':
      return 'text/csv; charset=utf-8'
    case '.tsv':
      return 'text/tab-separated-values; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.pdf':
      return 'application/pdf'
    case '.txt':
    case '.log':
      return 'text/plain; charset=utf-8'
    default:
      return artifact.kind === 'notebook'
        ? 'application/x-ipynb+json; charset=utf-8'
        : 'application/octet-stream'
  }
}

/**
 * A safe `Content-Disposition` filename. The stored path is sandbox-authored;
 * quotes and control characters cannot be allowed to break the header.
 */
export function artifactDownloadName(artifact: {
  id: string
  kind: RunArtifactKind
  path: string
}): string {
  const base = posix.basename(artifact.path) || `${artifact.kind}-${artifact.id}`
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)
  return safe.length > 0 ? safe : `${artifact.kind}-${artifact.id}`
}

function toManifestEntry(
  runId: string,
  row: {
    id: string
    kind: string
    path: string
    sha256: string
    bytes: number
    hasContent: boolean
  },
): RunArtifactManifestEntry {
  return {
    id: row.id,
    kind: normalizeKind(row.kind),
    path: row.path,
    sha256: row.sha256,
    bytes: row.bytes,
    hasContent: row.hasContent,
    downloadUrl: runArtifactDownloadPath(runId, row.id),
  }
}

/**
 * Reads one run's manifest. Returns `null` for a missing run; an existing run
 * with zero artifacts returns an empty list rather than a 404, because "this
 * run has no artifacts" is a fact the caller should see.
 */
export async function loadRunArtifactManifest(
  db: Pick<Database, 'select'>,
  runId: string,
): Promise<RunArtifactManifest | null> {
  const [run] = await db
    .select({
      id: runs.id,
      experimentId: runs.experimentId,
      workspaceId: experiments.workspaceId,
      attempt: runs.attempt,
      parentRunId: runs.parentRunId,
      status: runs.status,
      metrics: runs.metrics,
      verdict: runs.verdict,
    })
    .from(runs)
    .innerJoin(experiments, eq(experiments.id, runs.experimentId))
    .where(eq(runs.id, runId))
    .limit(1)

  if (!run) return null

  const rows = await db
    .select({
      id: runArtifacts.id,
      kind: runArtifacts.kind,
      path: runArtifacts.path,
      sha256: runArtifacts.sha256,
      bytes: runArtifacts.bytes,
      hasContent: sql<boolean>`${runArtifacts.content} is not null`,
    })
    .from(runArtifacts)
    .where(eq(runArtifacts.runId, runId))
    .orderBy(runArtifacts.kind, runArtifacts.path, runArtifacts.id)

  return {
    runId: run.id,
    experimentId: run.experimentId,
    workspaceId: run.workspaceId,
    attempt: run.attempt,
    parentRunId: run.parentRunId,
    status: run.status as RunStatus,
    metrics: run.metrics ?? {},
    verdict: (run.verdict as Verdict | null) ?? null,
    artifacts: rows.map((row) => toManifestEntry(run.id, row)),
  }
}

type ArtifactRow = {
  id: string
  kind: string
  path: string
  sha256: string
  bytes: number
  content: string | null
}

function toContent(runId: string, row: ArtifactRow): RunArtifactContent {
  if (row.content === null) {
    throw new RunArtifactReadError(
      'ARTIFACT_CONTENT_MISSING',
      `artifact ${row.id} (${row.path}) has no inline bytes`,
    )
  }

  const bytes = decodeArtifactContent(row.content, row.sha256, row.bytes)
  return {
    artifact: toManifestEntry(runId, { ...row, hasContent: true }),
    bytes,
  }
}

/**
 * Reads one artifact's verified bytes.
 *
 * `selector` is either a `run_artifacts.id` UUID or the literal `notebook`,
 * which resolves the reproducibility notebook through the same rule the UI
 * uses (`findNotebookArtifact`). Passing a row id from another run is a 404:
 * the query is scoped to both ids.
 */
export async function readRunArtifact(
  db: Pick<Database, 'select'>,
  runId: string,
  selector: string,
): Promise<RunArtifactContent | null> {
  const columns = {
    id: runArtifacts.id,
    kind: runArtifacts.kind,
    path: runArtifacts.path,
    sha256: runArtifacts.sha256,
    bytes: runArtifacts.bytes,
    content: runArtifacts.content,
  }

  if (selector === 'notebook') {
    const rows = await db
      .select(columns)
      .from(runArtifacts)
      .where(and(eq(runArtifacts.runId, runId), eq(runArtifacts.kind, 'notebook')))
      .orderBy(runArtifacts.path, runArtifacts.id)

    if (rows.length === 0) return null

    const chosen =
      findNotebookArtifact({
        artifacts: rows.map((row) =>
          toManifestEntry(runId, { ...row, hasContent: row.content !== null }),
        ),
      }) ?? null

    const row = chosen
      ? rows.find((candidate) => candidate.id === chosen.id)
      : undefined
    return row ? toContent(runId, row) : null
  }

  if (!UUID_RE.test(selector)) {
    throw new RunArtifactReadError(
      'INVALID_ARTIFACT_ID',
      'artifact selector must be a UUID or the literal "notebook"',
    )
  }

  const [row] = await db
    .select(columns)
    .from(runArtifacts)
    .where(
      and(
        eq(runArtifacts.runId, runId),
        eq(runArtifacts.id, selector.toLowerCase()),
      ),
    )
    .limit(1)

  if (!row) return null
  return toContent(runId, row)
}
