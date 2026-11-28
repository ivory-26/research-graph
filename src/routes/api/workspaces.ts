import { createFileRoute } from '@tanstack/react-router';
import { eq } from 'drizzle-orm';

import { getDb } from '../../db/client';
import { workspaceMembers, workspaces } from '../../db/schema';
import {
  AuthConfigurationError,
  AuthUnavailableError,
  requireCurrentUser,
  UnauthenticatedError,
} from '../../server/auth.server';

/**
 * Auth-guarded endpoint listing the current user's workspaces with their UUIDs.
 */
export const Route = createFileRoute('/api/workspaces')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const user = await requireCurrentUser(request);
          const db = getDb();

          const rows = await db
            .select({
              id: workspaces.id,
              name: workspaces.name,
              role: workspaceMembers.role,
            })
            .from(workspaceMembers)
            .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
            .where(eq(workspaceMembers.userId, user.id));

          return Response.json(
            {
              workspaces: rows.map((r) => ({
                id: r.id,
                name: r.name,
                subtitle: `Role: ${r.role}`,
              })),
            },
            {
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'private, no-store',
                Vary: 'Cookie',
              },
            },
          );
        } catch (err: unknown) {
          if (
            err instanceof UnauthenticatedError ||
            err instanceof AuthUnavailableError ||
            err instanceof AuthConfigurationError
          ) {
            return Response.json(
              { error: err.message, code: err.code },
              { status: err.status, headers: { 'Cache-Control': 'no-store' } },
            );
          }
          return Response.json(
            { error: 'Failed to load workspaces' },
            { status: 500, headers: { 'Cache-Control': 'no-store' } },
          );
        }
      },
    },
  },
});
