import { createFileRoute } from '@tanstack/react-router';
import { eq } from 'drizzle-orm';

import { getDb } from '../../db/client';
import { edges, nodes } from '../../db/schema';
import { requireWorkspaceAccess } from '../../server/auth/workspace.server';
import {
  AuthConfigurationError,
  AuthUnavailableError,
  UnauthenticatedError,
  WorkspaceAccessDeniedError,
} from '../../server/auth.server';

/**
 * Auth-guarded, workspace-scoped Graph API endpoint.
 *
 * Reads persisted graph nodes and edges from Postgres for the authorized workspace.
 */
export const Route = createFileRoute('/api/graph')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const workspaceId = url.searchParams.get('workspaceId')?.trim();

        if (!workspaceId) {
          return Response.json(
            { error: 'workspaceId query parameter is required' },
            { status: 400, headers: { 'Cache-Control': 'no-store' } },
          );
        }

        try {
          const membership = await requireWorkspaceAccess(request, workspaceId);
          const db = getDb();

          const [dbNodes, dbEdges] = await Promise.all([
            db
              .select()
              .from(nodes)
              .where(eq(nodes.workspaceId, membership.workspaceId)),
            db
              .select()
              .from(edges)
              .where(eq(edges.workspaceId, membership.workspaceId)),
          ]);

          const formattedNodes = dbNodes.map((n) => ({
            id: n.id,
            type: n.type,
            title: n.title,
            position: { x: n.positionX, y: n.positionY },
            data: n.data,
          }));

          const formattedEdges = dbEdges.map((e) => ({
            id: e.id,
            source: e.sourceNodeId,
            target: e.targetNodeId,
            relation: e.relation,
            status: e.status,
            confidence: e.confidence ?? undefined,
            evidenceChunkId: e.evidenceChunkId ?? undefined,
            evidenceRunId: e.evidenceRunId ?? undefined,
          }));

          return Response.json(
            {
              nodes: formattedNodes,
              edges: formattedEdges,
              source: 'database',
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
            err instanceof WorkspaceAccessDeniedError ||
            err instanceof AuthUnavailableError ||
            err instanceof AuthConfigurationError
          ) {
            return Response.json(
              { error: err.message, code: err.code },
              { status: err.status, headers: { 'Cache-Control': 'no-store' } },
            );
          }
          return Response.json(
            { error: 'Failed to load workspace graph' },
            { status: 500, headers: { 'Cache-Control': 'no-store' } },
          );
        }
      },
    },
  },
});
