# Authentication

Neon Auth (managed Better Auth) owns identities and sessions. The application's `workspace_members` table grants workspace access through explicit rows keyed by Neon Auth user ID and workspace ID. See [ADR 0008](./adr/0008-neon-auth.md).

## Setup

Set the server environment variables listed in `.env.example`.

| Variable | Value |
| --- | --- |
| `NEON_AUTH_BASE_URL` | The managed Auth endpoint for the Neon branch, including its database path |
| `NEON_AUTH_COOKIE_SECRET` | A persistent random secret of at least 32 characters. Generate one with `openssl rand -base64 32`. |
| `DATABASE_URL` | The application Postgres connection string for the branch with the #3 migrations applied |

Allow the application's deployed origin in Neon Auth before using it there. The local smoke test uses Neon's existing localhost allowance.

## Sign-in and session

The TanStack route at `src/routes/api/auth/$.ts` forwards same-origin auth requests through the official `@neon/auth/server` proxy. The route mount and generated route entry are the only changes under the routing boundary. The mount needs frag2win's review before merge.

In the #16 sign-in screens, use the Neon React adapter against the same-origin route.

```ts
import { createAuthClient } from '@neon/auth'
import { BetterAuthReactAdapter } from '@neon/auth/react/adapters'

export const authClient = createAuthClient('', {
  adapter: BetterAuthReactAdapter(),
})
```

Use `signIn.email`, `signUp.email` and `signOut` from that client. Route loaders can call `getCurrentUser()` from `src/server/auth.ts`. It returns `{ id, email, name }` for a verified session and `null` for an anonymous request. The server verifies the session directly with Neon and forwards any refreshed cookies. `requireUser` middleware supplies the same identity as `context.user` for server functions that only require sign-in.

## Workspace authorization for #6

```ts
import { requireWorkspaceAccess } from '../server/auth/workspace.server'

const { userId, workspaceId, role } = await requireWorkspaceAccess(
  request,
  experiment.workspaceId,
)
```

Pass the raw TanStack server route `Request` and resolve the experiment's workspace ID on the server. The guard verifies the request's session and reads the matching row through #3's Drizzle schema. It returns the verified actor ID, the authorized workspace ID, and the stored role. Use the returned `userId` for the approval decision.

The guard throws an error with status 401 for an anonymous request or 403 if membership cannot be confirmed. An auth service failure throws with status 502 and configuration errors use 500. Handle errors at the route boundary and send a private, uncached response. Request-origin checks for approval POST and any SSE GET that starts work belong at the #6 route boundary.

## Verification

Run `pnpm test`, `pnpm typecheck`, `pnpm build`, and `node scripts/auth-harness.mjs --build`. The harness runs the app's auth route in a temporary copy with a smoke page. With its local upstream it checks sign-in, server identity, refreshed cookies, and cookie-less requests, then checks that the production build keeps the SDK server-side.

For a live identity check set `NEON_AUTH_BASE_URL`, `AUTH_HARNESS_EMAIL`, and `AUTH_HARNESS_PASSWORD` securely for an existing developer test account on a disposable Neon branch, then run `node scripts/auth-harness.mjs --real`. The harness signs in with that account and exercises the server user lookup and refresh.

The #4 live membership check used the #3 migration on an expiring Neon branch. It verified that a signed-in user is denied before assignment, gets access as the same actor after an explicit row is inserted, is denied for another workspace, and loses access when the row is removed. An anonymous request received 401.
