/**
 * The authorized artifact read endpoint: `GET /api/runs/:runId/artifacts`.
 *
 * Two responses share one route:
 *
 * - no `?artifact=` → a JSON manifest of the run's artifacts and terminal
 *   fields;
 * - `?artifact=<id>` or `?artifact=notebook` → the verified bytes, with a
 *   `Content-Disposition: attachment` filename.
 *
 * Authorization order mirrors the pipeline endpoints, because an artifact is
 * research evidence and the same rules apply:
 *
 * 1. method and path validation;
 * 2. the verified actor (401) — an anonymous request is refused before any
 *    lookup, so this is not an existence oracle;
 * 3. the run lookup (404);
 * 4. workspace membership proved against `workspace_members` (403).
 *
 * The handler is framework-free and dependency-injected so it can be tested
 * without a router or a live identity service. `handleRunArtifacts` is the
 * production adapter the TanStack route calls.
 */
import type { RunArtifactManifest } from '../shared/run-artifacts'
import {
  RunArtifactReadError,
  artifactContentType,
  artifactDownloadName,
  type RunArtifactContent,
} from './run-artifacts'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
} as const

export type RunArtifactRouteParams = {
  runId: string
}

export type VerifiedRunActor = { id: string }

export type RunArtifactRouteDeps = {
  loadManifest(runId: string): Promise<RunArtifactManifest | null>
  readArtifact(runId: string, selector: string): Promise<RunArtifactContent | null>
  readActor(request: Request): Promise<VerifiedRunActor | null>
  /** Throws when membership is absent; must never resolve for a non-member. */
  assertWorkspaceMember(input: {
    userId: string
    workspaceId: string
  }): Promise<void>
}

class ArtifactHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ArtifactHttpError'
  }
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { ...NO_STORE_HEADERS } },
  )
}

function requireRunId(raw: string | undefined): string {
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) {
    throw new ArtifactHttpError(
      400,
      'INVALID_RUN_ID',
      'runId must be a UUID',
    )
  }
  return raw.toLowerCase()
}

function authFailure(error: unknown): ArtifactHttpError {
  const status =
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : 502

  if (status === 401) {
    return new ArtifactHttpError(
      401,
      'UNAUTHENTICATED',
      'A signed-in user is required',
    )
  }
  if (status === 403) {
    return new ArtifactHttpError(
      403,
      'WORKSPACE_ACCESS_DENIED',
      'Workspace membership required',
    )
  }
  if (status === 500) {
    return new ArtifactHttpError(
      500,
      'AUTH_NOT_CONFIGURED',
      'Authentication is not configured',
    )
  }
  return new ArtifactHttpError(
    502,
    'AUTH_UNAVAILABLE',
    'Authentication is temporarily unavailable',
  )
}

function artifactReadFailure(error: RunArtifactReadError): ArtifactHttpError {
  switch (error.code) {
    case 'INVALID_ARTIFACT_ID':
      return new ArtifactHttpError(
        400,
        'INVALID_ARTIFACT_ID',
        'artifact must be an artifact id or "notebook"',
      )
    case 'ARTIFACT_NOT_FOUND':
      return new ArtifactHttpError(
        404,
        'ARTIFACT_NOT_FOUND',
        'Artifact not found',
      )
    case 'ARTIFACT_CONTENT_MISSING':
      return new ArtifactHttpError(
        409,
        'ARTIFACT_CONTENT_MISSING',
        'This artifact has metadata but no stored bytes',
      )
    case 'ARTIFACT_INTEGRITY':
      return new ArtifactHttpError(
        500,
        'ARTIFACT_INTEGRITY',
        'The stored artifact failed its integrity check',
      )
  }
}

export function createRunArtifactHandler(
  deps: RunArtifactRouteDeps,
): (request: Request, params: RunArtifactRouteParams) => Promise<Response> {
  return async function handle(request, params) {
    try {
      if (request.method.toUpperCase() !== 'GET') {
        throw new ArtifactHttpError(
          405,
          'METHOD_NOT_ALLOWED',
          'Use GET',
        )
      }

      const runId = requireRunId(params.runId)

      let actor: VerifiedRunActor | null
      try {
        actor = await deps.readActor(request)
      } catch (error) {
        throw authFailure(error)
      }

      const actorId = typeof actor?.id === 'string' ? actor.id.trim() : ''
      if (!actorId) {
        throw new ArtifactHttpError(
          401,
          'UNAUTHENTICATED',
          'A signed-in user is required',
        )
      }

      const manifest = await deps.loadManifest(runId)
      if (!manifest) {
        throw new ArtifactHttpError(
          404,
          'RUN_NOT_FOUND',
          'Run not found',
        )
      }

      try {
        await deps.assertWorkspaceMember({
          userId: actorId,
          workspaceId: manifest.workspaceId,
        })
      } catch (error) {
        if (error instanceof ArtifactHttpError) throw error
        throw authFailure(error)
      }

      const selector = new URL(request.url).searchParams.get('artifact')
      if (selector === null || selector.trim().length === 0) {
        return Response.json(manifest, { headers: { ...NO_STORE_HEADERS } })
      }

      let content: RunArtifactContent | null
      try {
        content = await deps.readArtifact(runId, selector.trim())
      } catch (error) {
        if (error instanceof RunArtifactReadError) {
          throw artifactReadFailure(error)
        }
        throw error
      }
      if (!content) {
        throw new ArtifactHttpError(
          404,
          'ARTIFACT_NOT_FOUND',
          'Artifact not found',
        )
      }

      const filename = artifactDownloadName(content.artifact)
      return new Response(new Uint8Array(content.bytes), {
        status: 200,
        headers: {
          'Content-Type': artifactContentType(content.artifact),
          'Content-Length': String(content.bytes.byteLength),
          'Content-Disposition': `attachment; filename="${filename}"`,
          ...NO_STORE_HEADERS,
        },
      })
    } catch (error) {
      if (error instanceof ArtifactHttpError) {
        return jsonError(error.status, error.code, error.message)
      }
      console.error('[run-artifacts] artifact read failed', error)
      return jsonError(
        500,
        'ARTIFACT_READ_FAILED',
        'The artifact could not be read',
      )
    }
  }
}

/**
 * The production adapter. Every heavy dependency is imported lazily so the
 * route module carries no database driver or auth secret at build time.
 */
export async function handleRunArtifacts(
  request: Request,
  params: RunArtifactRouteParams,
): Promise<Response> {
  const { getDb } = await import('../db/client')
  const { readCurrentUser, enforceWorkspaceMembership } = await import(
    './auth.server'
  )
  const { loadRunArtifactManifest, readRunArtifact } = await import(
    './run-artifacts'
  )

  const db = getDb()
  const handler = createRunArtifactHandler({
    loadManifest: (runId) => loadRunArtifactManifest(db, runId),
    readArtifact: (runId, selector) => readRunArtifact(db, runId, selector),
    readActor: async (req) => {
      const user = await readCurrentUser(req)
      return user ? { id: user.id } : null
    },
    assertWorkspaceMember: async ({ userId, workspaceId }) => {
      const { workspaceMembers } = await import('../db/schema')
      const { and, eq } = await import('drizzle-orm')
      await enforceWorkspaceMembership(
        { userId, workspaceId },
        async (input) => {
          const [row] = await db
            .select({
              userId: workspaceMembers.userId,
              workspaceId: workspaceMembers.workspaceId,
              role: workspaceMembers.role,
            })
            .from(workspaceMembers)
            .where(
              and(
                eq(workspaceMembers.userId, input.userId),
                eq(workspaceMembers.workspaceId, input.workspaceId),
              ),
            )
            .limit(1)
          return row ?? null
        },
      )
    },
  })

  return handler(request, params)
}
