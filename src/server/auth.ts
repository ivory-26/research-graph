/**
 * Public, import-safe boundary for authentication server functions.
 *
 * Route files and components may import this module. The server-only
 * implementation (env, SDK, cookies, membership) is loaded inside the
 * handlers, so nothing here reaches the browser bundle.
 *
 * Sign-in flows belong to the auth screens (issue #16); this module only
 * answers "who is the verified user on this request?".
 */
import { createMiddleware, createServerFn } from '@tanstack/react-start'

import type { CurrentUser } from './auth.server'

const loadAuth = () => import('./auth.server')

/**
 * Same-origin `/api/auth/*` handler.
 *
 * Proxies sign-in, sign-out and session refresh to Neon Auth while keeping
 * the session cookie on this origin.
 */
export async function handleAuthRequest(
  request: Request,
  splat: string,
): Promise<Response> {
  const { handleAuthRequest: handle } = await loadAuth()
  return handle(request, splat)
}

/**
 * Completes a social sign-in callback before the route guard reads the session.
 *
 * Returns a redirect carrying the exchanged session cookies (verifier already
 * removed from the URL), or `null` when the request is not an OAuth callback.
 * Server-only work is loaded inside the call, so importing this module from the
 * request middleware never pulls the SDK into a client bundle.
 */
export async function completeOAuthCallback(
  request: Request,
): Promise<Response | null> {
  const { completeOAuthCallback: complete } = await loadAuth()
  return complete(request)
}

/**
 * Returns the current verified user, or `null` when signed out.
 *
 * The response is private and uncached because it depends on the request's
 * session cookie. Callers must not treat `null` as a network error; an
 * upstream failure throws instead.
 */
export const getCurrentUser = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CurrentUser | null> => {
    const { markPrivateResponse, readCurrentUser } = await loadAuth()
    markPrivateResponse()

    return readCurrentUser()
  },
)

/**
 * Function middleware that requires a signed-in user.
 *
 * Adds `context.user`, the verified identity, to the server function. It only
 * proves authentication. Workspace operations must use `requireWorkspaceAccess`
 * from `auth/workspace.server.ts`.
 */
export const requireUser = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const { requireCurrentUser } = await loadAuth()
    const user = await requireCurrentUser()

    return next({ context: { user } })
  },
)
