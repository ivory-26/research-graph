/**
 * Global Start request middleware.
 *
 * The only request-wide concern is finishing a social sign-in. Neon Auth sends
 * the browser back to the callback URL with a single-use
 * `neon_auth_session_verifier`; the exchange must happen on the server before a
 * route's `beforeLoad` guard reads the session, or an SSR guard redirects a
 * freshly signed-in user to `/sign-in`.
 *
 * Every request without that parameter falls straight through, so the auth
 * proxy, server functions and route loaders behave exactly as before.
 */
import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from '@tanstack/react-start'

import { completeOAuthCallback } from './server/auth'

// Defining src/start.ts replaces the CSRF middleware Start installs by
// default, so re-add it with the same server-fn-only filter.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

const oauthCallbackMiddleware = createMiddleware({ type: 'request' }).server(
  async ({ request, next }) => {
    const redirect = await completeOAuthCallback(request)
    if (redirect) return redirect

    return next()
  },
)

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, oauthCallbackMiddleware],
}))
