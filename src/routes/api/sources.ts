import { createFileRoute } from '@tanstack/react-router'
import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, sql } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { sourceChunks, sources } from '../../db/schema'
import { requireWorkspaceAccess } from '../../server/auth/workspace.server'
import {
  AuthConfigurationError,
  AuthUnavailableError,
  UnauthenticatedError,
  WorkspaceAccessDeniedError,
} from '../../server/auth.server'
import { ingestSourceToGraphForWorkspace } from '../../server/extract/pipeline'
import { assertSameOrigin } from '../../server/pipeline-delivery/authorization'
import { toErrorResponse } from '../../server/pipeline-delivery/errors'
import {
  decodePdfBase64,
  MAX_PDF_BYTES,
  MAX_SOURCE_TITLE_LENGTH,
  validateIngestUrl,
} from '../../server/source-input'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const AUTH_ERRORS = [
  UnauthenticatedError,
  WorkspaceAccessDeniedError,
  AuthUnavailableError,
  AuthConfigurationError,
] as const

function authErrorResponse(err: unknown): Response | null {
  for (const ErrorType of AUTH_ERRORS) {
    if (err instanceof ErrorType) {
      return Response.json(
        { error: err.message, code: err.code },
        { status: err.status, headers: { 'Cache-Control': 'no-store' } },
      )
    }
  }
  return null
}

function jsonError(message: string, status: number, code?: string): Response {
  return Response.json(
    code ? { error: message, code } : { error: message },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

interface IngestBody {
  workspaceId: unknown
  kind: unknown
  url?: unknown
  title?: unknown
  pdfBase64?: unknown
}

interface ParsedIngestRequest {
  workspaceId: string
  kind: 'web' | 'repo' | 'pdf'
  url?: string
  title?: string
  pdf?: Uint8Array
}

async function parseIngestRequest(request: Request): Promise<
  { ok: true; value: ParsedIngestRequest } | { ok: false; response: Response }
> {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('multipart/form-data')) {
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return { ok: false, response: jsonError('Invalid multipart body', 400) }
    }
    const workspaceId = typeof form.get('workspaceId') === 'string'
      ? String(form.get('workspaceId')).trim()
      : ''
    const title = typeof form.get('title') === 'string' ? String(form.get('title')).trim() : ''
    const file = form.get('file')

    if (!workspaceId) {
      return { ok: false, response: jsonError('workspaceId is required', 400) }
    }
    if (!(file instanceof File)) {
      return { ok: false, response: jsonError('file is required for PDF upload', 400) }
    }
    if (file.size === 0) {
      return { ok: false, response: jsonError('PDF file is empty', 400) }
    }
    if (file.size > MAX_PDF_BYTES) {
      return { ok: false, response: jsonError('PDF file exceeds the 25 MB limit', 413) }
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    return {
      ok: true,
      value: {
        workspaceId,
        kind: 'pdf',
        title: (title || file.name.replace(/\.pdf$/i, '') || 'Uploaded paper').slice(
          0,
          MAX_SOURCE_TITLE_LENGTH,
        ),
        pdf: bytes,
      },
    }
  }

  let body: IngestBody
  try {
    const parsed: unknown = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, response: jsonError('Expected a JSON object', 400) }
    }
    body = parsed as IngestBody
  } catch {
    return { ok: false, response: jsonError('Invalid JSON body', 400) }
  }

  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : ''
  if (!workspaceId) {
    return { ok: false, response: jsonError('workspaceId is required', 400) }
  }

  const rawKind = typeof body.kind === 'string' ? body.kind.trim() : ''
  const kind = rawKind === 'pdf' || rawKind === 'repo' || rawKind === 'web' ? rawKind : null
  if (!kind) {
    return { ok: false, response: jsonError('kind must be "web", "repo" or "pdf"', 400) }
  }

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_SOURCE_TITLE_LENGTH) : ''

  if (kind === 'pdf') {
    if (typeof body.pdfBase64 !== 'string') {
      return { ok: false, response: jsonError('pdfBase64 is required for PDF ingestion', 400) }
    }
    const pdf = decodePdfBase64(body.pdfBase64)
    if (!pdf) {
      return {
        ok: false,
        response: jsonError('pdfBase64 is not a valid PDF payload under 25 MB', 400),
      }
    }
    return { ok: true, value: { workspaceId, kind, title, pdf } }
  }

  if (typeof body.url !== 'string') {
    return { ok: false, response: jsonError('url is required for web or repo ingestion', 400) }
  }
  const validated = validateIngestUrl(body.url)
  if ('error' in validated) {
    return { ok: false, response: jsonError(validated.error, 400) }
  }

  return { ok: true, value: { workspaceId, kind, title: title || undefined, url: validated.url } }
}

/**
 * Auth-guarded workspace sources API.
 *
 * GET lists persisted sources (and, with `sourceId`, their chunks). POST runs
 * the existing real ingestion workflow: Firecrawl for web/repo pages, `unpdf`
 * for PDFs, `gemini-embedding-2` for vectors, and the claim/edge extractor.
 * There is no simulated queue on this path: a 2xx response means the rows are
 * in Postgres.
 */
export const Route = createFileRoute('/api/sources')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const workspaceId = url.searchParams.get('workspaceId')?.trim()
        const sourceId = url.searchParams.get('sourceId')?.trim()

        if (!workspaceId) {
          return jsonError('workspaceId query parameter is required', 400)
        }

        try {
          const membership = await requireWorkspaceAccess(request, workspaceId)
          const db = getDb()

          if (sourceId) {
            if (!UUID_REGEX.test(sourceId)) {
              return jsonError('sourceId must be a UUID', 400)
            }

            const [source] = await db
              .select({
                id: sources.id,
                kind: sources.kind,
                title: sources.title,
                url: sources.url,
                doi: sources.doi,
                sha256: sources.sha256,
                bytes: sources.bytes,
                meta: sources.meta,
                createdAt: sources.createdAt,
              })
              .from(sources)
              .where(
                and(
                  eq(sources.id, sourceId),
                  eq(sources.workspaceId, membership.workspaceId),
                ),
              )
              .limit(1)

            if (!source) {
              return jsonError('Source not found in this workspace', 404)
            }

            const chunkRows = await db
              .select({
                id: sourceChunks.id,
                sourceId: sourceChunks.sourceId,
                sourceTitle: sources.title,
                ordinal: sourceChunks.ordinal,
                page: sourceChunks.page,
                text: sourceChunks.text,
                charStart: sourceChunks.charStart,
                charEnd: sourceChunks.charEnd,
              })
              .from(sourceChunks)
              .innerJoin(sources, eq(sourceChunks.sourceId, sources.id))
              .where(
                and(
                  eq(sourceChunks.sourceId, sourceId),
                  eq(sources.workspaceId, membership.workspaceId),
                ),
              )
              .orderBy(asc(sourceChunks.ordinal))

            return Response.json(
              { source: formatSource(source, chunkRows.length), chunks: chunkRows },
              { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } },
            )
          }

          const rows = await db
            .select({
              id: sources.id,
              kind: sources.kind,
              title: sources.title,
              url: sources.url,
              doi: sources.doi,
              sha256: sources.sha256,
              bytes: sources.bytes,
              meta: sources.meta,
              createdAt: sources.createdAt,
              chunkCount: sql<number>`count(${sourceChunks.id})::int`,
            })
            .from(sources)
            .leftJoin(sourceChunks, eq(sourceChunks.sourceId, sources.id))
            .where(eq(sources.workspaceId, membership.workspaceId))
            .groupBy(sources.id)
            .orderBy(desc(sources.createdAt), asc(sources.id))

          return Response.json(
            {
              sources: rows.map((row) => formatSource(row, Number(row.chunkCount))),
              source: 'database',
            },
            { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } },
          )
        } catch (err: unknown) {
          const authResponse = authErrorResponse(err)
          if (authResponse) return authResponse
          console.error('[sources] list failed', err)
          return jsonError('Failed to load workspace sources', 500)
        }
      },

      POST: async ({ request }) => {
        try {
          assertSameOrigin(request, { requireOrigin: true })
        } catch (error) {
          return toErrorResponse(error)
        }

        const parsed = await parseIngestRequest(request)
        if (!parsed.ok) return parsed.response

        const input = parsed.value

        try {
          const membership = await requireWorkspaceAccess(request, input.workspaceId)

          const outcome = await ingestSourceToGraphForWorkspace({
            workspaceId: membership.workspaceId,
            runId: randomUUID(),
            runLabel: `ui:${input.kind}`,
            source:
              input.kind === 'pdf'
                ? {
                    kind: 'pdf',
                    data: input.pdf!,
                    title: input.title || 'Uploaded paper',
                  }
                : {
                    kind: 'web',
                    url: input.url!,
                    title: input.title,
                    sourceKind: input.kind,
                  },
          })

          return Response.json(
            {
              source: formatSource(outcome.source, outcome.chunkCount),
              chunkCount: outcome.chunkCount,
              claimCount: outcome.extraction.acceptedClaims.length,
              rejectedClaimCount: outcome.extraction.rejectedClaims.length,
              methodCount: outcome.extraction.methods.length,
              datasetCount: outcome.extraction.datasets.length,
              edgeCount: outcome.edges.acceptedEdges.length,
              needsOcr: outcome.needsOcr,
            },
            {
              status: outcome.needsOcr ? 202 : 201,
              headers: { 'Cache-Control': 'no-store' },
            },
          )
        } catch (err: unknown) {
          const authResponse = authErrorResponse(err)
          if (authResponse) return authResponse

          const message = err instanceof Error ? err.message : String(err)

          if (/FIRECRAWL_API_KEY is not configured/i.test(message)) {
            return jsonError(
              'Web ingestion is not configured on this deployment.',
              503,
              'INGESTION_NOT_CONFIGURED',
            )
          }
          if (/PDF file|pdf|unpdf/i.test(message) && /invalid|parse|structure/i.test(message)) {
            return jsonError('The uploaded PDF could not be read', 422, 'PDF_UNREADABLE')
          }
          if (/No content could be extracted|produced zero valid chunks/i.test(message)) {
            return jsonError('No readable text was found at that URL', 422, 'SOURCE_EMPTY')
          }

          console.error('[sources] ingestion failed', {
            kind: input.kind,
            error: message,
          })
          return jsonError('Source ingestion failed', 500, 'INGESTION_FAILED')
        }
      },
    },
  },
})

interface SourceListShape {
  id: string
  kind: string
  title: string
  url: string | null
  doi: string | null
  sha256: string
  bytes: number
  meta: Record<string, unknown>
  createdAt: Date | string
}

function formatSource(row: SourceListShape, chunkCount: number) {
  const meta = (row.meta ?? {}) as Record<string, unknown>
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    url: row.url,
    doi: row.doi,
    sha256: row.sha256,
    bytes: row.bytes,
    chunkCount,
    pages:
      typeof meta.totalPages === 'number' && Number.isFinite(meta.totalPages)
        ? meta.totalPages
        : null,
    needsOcr: meta.needsOcr === true,
    createdAt:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  }
}
