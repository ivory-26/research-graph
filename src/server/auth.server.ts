/**
 * Server-only Neon Auth (Managed Better Auth) integration.
 *
 * Identity and sessions belong to Neon Auth. This module never owns users and
 * never decides workspace access: `workspace_members` does, and only an
 * explicit membership row grants access (docs/adr/0008-neon-auth.md).
 *
 * The import below fails the build if any client module reaches this file.
 * Public server functions live in `./auth.ts`, which loads this module only
 * inside its server handlers.
 */
import '@tanstack/react-start/server-only'

import {
  createAuthServer,
  extractNeonAuthCookies,
  handleAuthProxyRequest,
  type NeonAuthServer,
  type RequestContext,
  type RequestContextFactory,
  type SessionData,
} from '@neon/auth/server'
import {
  getRequest,
  setCookie,
  setResponseHeader,
} from '@tanstack/react-start/server'

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Deployment misconfiguration. The message names an env var, never its value. */
export class AuthConfigurationError extends Error {
  readonly code = 'AUTH_NOT_CONFIGURED'
  readonly status = 500

  constructor(message: string) {
    super(message)
    this.name = 'AuthConfigurationError'
  }
}

/** The session could not be verified because the auth service failed. */
export class AuthUnavailableError extends Error {
  readonly code = 'AUTH_UNAVAILABLE'
  readonly status = 502

  constructor() {
    super('Authentication is temporarily unavailable')
    this.name = 'AuthUnavailableError'
  }
}

/** No verified session on the request. */
export class UnauthenticatedError extends Error {
  readonly code = 'UNAUTHENTICATED'
  readonly status = 401

  constructor() {
    super('A signed-in user is required')
    this.name = 'UnauthenticatedError'
  }
}

/** Workspace membership is absent or could not be confirmed. */
export class WorkspaceAccessDeniedError extends Error {
  readonly code = 'WORKSPACE_ACCESS_DENIED'
  readonly status = 403

  constructor() {
    super('Workspace membership required')
    this.name = 'WorkspaceAccessDeniedError'
  }
}

// ---------------------------------------------------------------------------
// Identity exposed to the application
// ---------------------------------------------------------------------------

/**
 * The only identity shape server code receives.
 *
 * Deliberately excludes session ids, access tokens and every other user's
 * data. Use it as `userId` when writing `workspace_members.user_id`.
 */
export type CurrentUser = {
  id: string
  email: string | null
  name: string | null
}

/**
 * Narrows an SDK session to {@link CurrentUser}.
 *
 * A session without a usable user id is treated as signed out rather than
 * throwing, so a malformed upstream payload can never become an identity.
 */
export function normalizeSessionUser(
  session: SessionData | null | undefined,
): CurrentUser | null {
  const user = session?.user
  if (!user || !session.session || session.session.userId !== user.id) return null

  const id = typeof user.id === 'string' ? user.id.trim() : ''
  if (!id) return null

  return {
    id,
    email: typeof user.email === 'string' ? user.email : null,
    name: typeof user.name === 'string' ? user.name : null,
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type AuthConfig = {
  baseUrl: string
  cookieSecret: string
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * Reads and validates the two server-only auth variables.
 *
 * - `NEON_AUTH_BASE_URL` must be an absolute URL. HTTPS is required outside
 *   loopback so a cookie secret and session tokens never cross plain HTTP.
 * - `NEON_AUTH_COOKIE_SECRET` signs the cached session cookie and must be at
 *   least 32 characters (the SDK enforces the same minimum).
 *
 * Errors name the variable but never include its value.
 */
export function readAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  const rawBaseUrl = env.NEON_AUTH_BASE_URL?.trim()
  if (!rawBaseUrl) {
    throw new AuthConfigurationError('NEON_AUTH_BASE_URL is not set')
  }

  let baseUrl: URL
  try {
    baseUrl = new URL(rawBaseUrl)
  } catch {
    throw new AuthConfigurationError(
      'NEON_AUTH_BASE_URL must be an absolute URL',
    )
  }

  const isLoopback = LOOPBACK_HOSTS.has(baseUrl.hostname)
  if (baseUrl.protocol !== 'https:' && !(baseUrl.protocol === 'http:' && isLoopback)) {
    throw new AuthConfigurationError(
      'NEON_AUTH_BASE_URL must use https (http is allowed only for loopback development)',
    )
  }
  if (baseUrl.username || baseUrl.password) {
    throw new AuthConfigurationError(
      'NEON_AUTH_BASE_URL must not embed credentials',
    )
  }
  if (baseUrl.search || baseUrl.hash) {
    throw new AuthConfigurationError(
      'NEON_AUTH_BASE_URL must not contain a query string or fragment',
    )
  }

  const cookieSecret = env.NEON_AUTH_COOKIE_SECRET
  if (!cookieSecret || cookieSecret.trim().length < 32) {
    throw new AuthConfigurationError(
      'NEON_AUTH_COOKIE_SECRET must be set to at least 32 characters',
    )
  }

  return {
    baseUrl: rawBaseUrl.replace(/\/+$/, ''),
    cookieSecret,
  }
}

// ---------------------------------------------------------------------------
// SDK server instance (session verification and cookie refresh)
// ---------------------------------------------------------------------------

/**
 * Request context for the SDK. Called once per server method, so it reads the
 * current TanStack Start request rather than capturing one at module load.
 *
 * `setCookie` is what makes a refreshed session reach the browser from a
 * server function or loader: the SDK hands us every upstream `Set-Cookie`.
 */
function tanstackStartContext(request = getRequest()): RequestContext {
  return {
    getCookies: () => extractNeonAuthCookies(request.headers),
    setCookie: (name, value, options) => {
      setCookie(name, value, options)
    },
    getHeader: (name) => request.headers.get(name),
    getOrigin: () =>
      request.headers.get('origin') ?? new URL(request.url).origin,
    getFramework: () => 'tanstack-start',
  }
}

/** Builds an SDK instance. Exported so tests can supply their own context. */
export function createAppAuthServer(
  config: AuthConfig,
  context: RequestContextFactory = tanstackStartContext,
): NeonAuthServer {
  return createAuthServer({
    baseUrl: config.baseUrl,
    cookieSecret: config.cookieSecret,
    context,
  })
}

let appAuth: NeonAuthServer | undefined

/** The process-wide SDK instance, created on first use. */
export function getAppAuthServer(): NeonAuthServer {
  if (!appAuth) {
    appAuth = createAppAuthServer(readAuthConfig())
  }
  return appAuth
}

/**
 * Marks the response as per-user and uncached. Safe only inside a request.
 *
 * Kept here rather than in `auth.ts` so the public module never imports a
 * server-only specifier, which TanStack Start blocks from client bundles.
 */
export function markPrivateResponse(): void {
  setResponseHeader('Cache-Control', 'private, no-store')
  setResponseHeader('Vary', 'Cookie')
}

/**
 * Reads the current verified user, or `null` when the request is signed out.
 *
 * Never accepts a user id from the caller and never returns a token. An
 * upstream failure throws instead of pretending the visitor is signed out.
 */
export async function readCurrentUser(request?: Request): Promise<CurrentUser | null> {
  const auth = request
    ? createAppAuthServer(readAuthConfig(), () => tanstackStartContext(request))
    : getAppAuthServer()
  const { data, error } = await auth.getSession({ query: { disableCookieCache: true } })

  if (error) {
    // An expired or revoked session is signed out, not an outage. Anything
    // else (transport, 5xx) fails closed as unavailable rather than silently
    // presenting the visitor as signed out.
    if (error.status === 401 || error.status === 403) return null
    throw new AuthUnavailableError()
  }

  return normalizeSessionUser(data)
}

/** Throws {@link UnauthenticatedError} unless the request has a verified user. */
export async function requireCurrentUser(request?: Request): Promise<CurrentUser> {
  const user = await readCurrentUser(request)
  if (!user) throw new UnauthenticatedError()
  return user
}

// ---------------------------------------------------------------------------
// Same-origin auth handler
// ---------------------------------------------------------------------------

const AUTH_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const AUTH_METHOD_SET = new Set<string>(AUTH_METHODS)

const AUTH_PATH_PATTERN = /^[A-Za-z0-9._~/-]+$/

/**
 * Normalizes the catch-all segment into an upstream auth path.
 *
 * Rejects empty, over-long, traversal and query-bearing paths so the route
 * can only reach endpoints under `NEON_AUTH_BASE_URL`. The query string is
 * forwarded separately from the original request URL by the SDK.
 */
export function normalizeAuthPath(raw: string): string | null {
  const path = raw.replace(/^\/+/, '')

  if (!path || path.length > 512) return null
  if (!AUTH_PATH_PATTERN.test(path)) return null
  if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null
  }

  return path
}

function noStoreJson(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...headers,
    },
  })
}

function withPrivateCacheHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store, private')
  headers.set('Vary', 'Cookie')
  headers.set('X-Content-Type-Options', 'nosniff')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Handles one request to the same-origin `/api/auth/*` mount.
 *
 * The SDK proxy does the security-relevant work: it forwards only the Neon
 * auth cookies upstream, builds the upstream URL under `NEON_AUTH_BASE_URL`,
 * rewrites cookie attributes, and mints the signed session cache cookie.
 *
 * @param request Standard Web API request from the route handler.
 * @param splat The `_splat` route param, e.g. `get-session`.
 */
export async function handleAuthRequest(
  request: Request,
  splat: string,
): Promise<Response> {
  const method = request.method.toUpperCase()
  if (!AUTH_METHOD_SET.has(method)) {
    return noStoreJson(
      405,
      { error: 'Method not allowed' },
      { Allow: AUTH_METHODS.join(', ') },
    )
  }

  const path = normalizeAuthPath(splat)
  if (!path) {
    return noStoreJson(404, { error: 'Not found' })
  }

  let config: AuthConfig
  try {
    config = readAuthConfig()
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      // Name the missing variable on the server only; keep the response generic.
      console.error(`[auth] ${error.message}`)
      return noStoreJson(500, { error: 'Authentication is not configured' })
    }
    throw error
  }

  const response = await handleAuthProxyRequest({
    request,
    path,
    baseUrl: config.baseUrl,
    cookieSecret: config.cookieSecret,
    // `lax` keeps the session cookie on top-level OAuth returns. Cookies are
    // always Secure; the SDK applies this to every upstream Set-Cookie.
    sameSite: 'lax',
  })

  return withPrivateCacheHeaders(response)
}

// ---------------------------------------------------------------------------
// Workspace membership enforcement
// ---------------------------------------------------------------------------

/**
 * A membership row as the application sees it.
 *
 * `role` is deliberately an open string: docs/02-data-model.md defines
 * `workspace_members.role` as text with a default, not as an enum.
 */
export type WorkspaceMembership = {
  workspaceId: string
  userId: string
  role: string
}

export type WorkspaceMembershipLookup = (input: {
  userId: string
  workspaceId: string
}) => Promise<WorkspaceMembership | null> | WorkspaceMembership | null

/**
 * Fail-closed membership check against a verified user id.
 *
 * Denies missing IDs, lookup failures, missing or mismatched rows, and
 * empty roles.
 *
 * @param input.userId Must come from {@link requireCurrentUser} or
 *   {@link readCurrentUser}, never from request input.
 */
export async function enforceWorkspaceMembership(
  input: { userId: string; workspaceId: string },
  lookup: WorkspaceMembershipLookup,
): Promise<WorkspaceMembership> {
  const userId = typeof input.userId === 'string' ? input.userId.trim() : ''
  const workspaceId =
    typeof input.workspaceId === 'string' ? input.workspaceId.trim() : ''

  if (!userId || !workspaceId) throw new WorkspaceAccessDeniedError()

  let membership: WorkspaceMembership | null
  try {
    membership = await lookup({ userId, workspaceId })
  } catch {
    // Never let a database failure become an allow, and never echo its detail.
    throw new WorkspaceAccessDeniedError()
  }

  if (!membership) throw new WorkspaceAccessDeniedError()
  if (membership.userId !== userId) throw new WorkspaceAccessDeniedError()
  if (membership.workspaceId !== workspaceId) throw new WorkspaceAccessDeniedError()
  if (typeof membership.role !== 'string' || membership.role.trim() === '') {
    throw new WorkspaceAccessDeniedError()
  }

  return {
    workspaceId,
    userId,
    role: membership.role,
  }
}
