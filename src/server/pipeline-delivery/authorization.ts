/**
 * Authentication and workspace authorization for both pipeline endpoints.
 *
 * Order is deliberate:
 *
 * 1. origin guard — a cross-origin request never reaches the database;
 * 2. path validation — a malformed experiment id is a 400, not a lookup;
 * 3. the verified actor — an anonymous request is a 401 even if the experiment
 *    does not exist, so the endpoint is not an existence oracle;
 * 4. the experiment lookup — a missing id is a 404;
 * 5. workspace membership — a signed-in non-member is a 403.
 *
 * Identity comes from #4's Neon Auth integration (`readCurrentUser`). The
 * membership check is #4's `enforceWorkspaceMembership`. The only injection
 * point is the identity reader, so tests can supply a verified actor without
 * a live auth service; membership itself is always checked against Postgres.
 */
import type { ExperimentScope, PipelineData } from './data'
import { PipelineHttpError } from './errors'

export type VerifiedActor = { id: string }

/**
 * Returns the verified actor for a request, or `null` when signed out.
 * Production passes #4's `readCurrentUser`; tests pass a deterministic reader.
 */
export type ReadVerifiedActor = (
  request: Request,
) => Promise<VerifiedActor | null>

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Validates the `$experimentId` path parameter. */
export function requireExperimentIdParam(raw: string | undefined): string {
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) {
    throw new PipelineHttpError(
      400,
      'INVALID_EXPERIMENT_ID',
      'experimentId must be a UUID',
    )
  }
  return raw.toLowerCase()
}

export type SameOriginOptions = {
  /**
   * State-changing requests (the approval POST) require an Origin header, not
   * merely a matching one when present. A browser always sends it for a
   * same-origin POST, and requiring it removes the "no Origin means trusted"
   * hole that CSRF checks usually leave.
   */
  requireOrigin?: boolean
}

/**
 * Rejects a request whose Origin header names another origin.
 *
 * A same-origin `EventSource` GET normally carries no Origin at all, so an
 * absent header is allowed unless `requireOrigin` is set.
 */
export function assertSameOrigin(
  request: Request,
  options: SameOriginOptions = {},
): void {
  const origin = request.headers.get('origin')
  const expectedOrigin = new URL(request.url).origin

  if (origin === null) {
    if (options.requireOrigin) {
      throw new PipelineHttpError(
        403,
        'ORIGIN_REQUIRED',
        'A same-origin Origin header is required',
      )
    }
    return
  }

  if (origin !== expectedOrigin) {
    throw new PipelineHttpError(
      403,
      'ORIGIN_MISMATCH',
      'Cross-origin requests are not allowed',
    )
  }
}

/** The production identity reader. Loaded lazily so tests never touch Neon. */
export const readVerifiedActorFromNeonAuth: ReadVerifiedActor = async (
  request,
) => {
  const { readCurrentUser } = await import('../auth.server')
  const user = await readCurrentUser(request)
  return user ? { id: user.id } : null
}

function readAuthFailure(error: unknown): PipelineHttpError {
  const status =
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : 502

  if (status === 401) {
    return new PipelineHttpError(
      401,
      'UNAUTHENTICATED',
      'A signed-in user is required',
    )
  }
  if (status === 403) {
    return new PipelineHttpError(
      403,
      'WORKSPACE_ACCESS_DENIED',
      'Workspace membership required',
    )
  }
  if (status === 500) {
    return new PipelineHttpError(
      500,
      'AUTH_NOT_CONFIGURED',
      'Authentication is not configured',
    )
  }
  return new PipelineHttpError(
    502,
    'AUTH_UNAVAILABLE',
    'Authentication is temporarily unavailable',
  )
}

export type AuthorizationInput = {
  request: Request
  experimentId: string
  data: Pick<PipelineData, 'findExperiment' | 'findWorkspaceMember'>
  readActor: ReadVerifiedActor
}

export type AuthorizedPipelineRequest = {
  experiment: ExperimentScope
  actor: VerifiedActor
}

/**
 * Verifies the actor and proves workspace membership for one experiment.
 *
 * A DB or dependency failure while checking membership fails closed as a 403;
 * `enforceWorkspaceMembership` already guarantees that, and this wrapper keeps
 * its error shape consistent with the rest of the delivery layer.
 */
export async function authorizePipelineExperiment(
  input: AuthorizationInput,
): Promise<AuthorizedPipelineRequest> {
  let actor: VerifiedActor | null
  try {
    actor = await input.readActor(input.request)
  } catch (error) {
    throw readAuthFailure(error)
  }

  const actorId = typeof actor?.id === 'string' ? actor.id.trim() : ''
  if (!actorId) {
    throw new PipelineHttpError(
      401,
      'UNAUTHENTICATED',
      'A signed-in user is required',
    )
  }

  const experiment = await input.data.findExperiment(input.experimentId)
  if (!experiment) {
    throw new PipelineHttpError(
      404,
      'EXPERIMENT_NOT_FOUND',
      'Experiment not found',
    )
  }

  const { enforceWorkspaceMembership } = await import('../auth.server')
  try {
    await enforceWorkspaceMembership(
      { userId: actorId, workspaceId: experiment.workspaceId },
      input.data.findWorkspaceMember,
    )
  } catch (error) {
    if (error instanceof PipelineHttpError) throw error
    throw new PipelineHttpError(
      403,
      'WORKSPACE_ACCESS_DENIED',
      'Workspace membership required',
    )
  }

  return { experiment, actor: { id: actorId } }
}
