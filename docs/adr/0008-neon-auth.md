# Neon Auth for identity

Sign-in uses Neon Auth (managed Better Auth) against the same Neon project as the application data.

The alternative worth considering was Clerk, which has a better sign-in UI and more documentation. It was rejected because it puts a third-party script and a third-party outage inside the recorded path, and because the ten-day budget does not include time to learn a second vendor's object model. Hand-rolling sessions was rejected on the grounds that it costs six to eight hours and produces a worse security posture than either managed option.

## Consequences

- Authentication is coupled to the database provider. If the project ever moves off Neon, auth moves too.
- The first day must verify Neon Auth actually works end to end before any UI is built on it. This is the single highest-risk unverified dependency in the stack, and the fallback is Clerk.
- Neon Auth owns user identities. The application's `workspace_members` table references those user IDs and grants workspace access through explicit rows.

## Update — 25 November 2026

The first-day verification happened and passed: the local harness exercises sign-in, server identity, refreshed cookies and cookie-less requests, and a live membership check on a disposable Neon branch confirmed 401 for anonymous requests, denial before assignment, access after an explicit row, denial for another workspace, and loss of access when the row is removed. The server-side integration is on `main`. There are still no sign-in screens; that is #16, not an auth-service problem.
