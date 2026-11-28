import { createFileRoute } from '@tanstack/react-router';
import { asc, eq } from 'drizzle-orm';

import { getDb } from '../../db/client';
import { edges, nodes, sourceChunks } from '../../db/schema';
import { requireWorkspaceAccess } from '../../server/auth/workspace.server';
import { layoutGraphNodes } from '../../server/graph-layout';
import {
  AuthConfigurationError,
  AuthUnavailableError,
  UnauthenticatedError,
  WorkspaceAccessDeniedError,
} from '../../server/auth.server';

/**
 * Auth-guarded, workspace-scoped Graph API endpoint.
 *
 * Reads persisted graph nodes and evidenced edges (joined with source_chunks
 * for verbatim chunk text, page, and character offsets) from Postgres.
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

          const [dbNodes, dbEdgeRows] = await Promise.all([
            db
              .select()
              .from(nodes)
              .where(eq(nodes.workspaceId, membership.workspaceId))
              .orderBy(asc(nodes.createdAt), asc(nodes.id)),
            db
              .select({
                edge: edges,
                chunkText: sourceChunks.text,
                chunkPage: sourceChunks.page,
                chunkOrdinal: sourceChunks.ordinal,
                chunkCharStart: sourceChunks.charStart,
                chunkCharEnd: sourceChunks.charEnd,
              })
              .from(edges)
              .leftJoin(sourceChunks, eq(edges.evidenceChunkId, sourceChunks.id))
              .where(eq(edges.workspaceId, membership.workspaceId))
              .orderBy(asc(edges.createdAt), asc(edges.id)),
          ]);

          const nodeTitleById = new Map(dbNodes.map((n) => [n.id, n.title]));

          // Deterministic placement that preserves authored coordinates, splits
          // coincident run/result projections, and keeps fallback columns clear
          // of stored cards. See src/server/graph-layout.ts.
          const layout = layoutGraphNodes(dbNodes);

          const formattedNodes = dbNodes.map((n) => {
            const position = layout.get(n.id) ?? { x: n.positionX, y: n.positionY };
            return {
              id: n.id,
              type: n.type,
              title: n.title,
              position,
              data: {
                ...(n.data as Record<string, unknown>),
                title: n.title,
              },
            };
          });

          const formattedEdges = dbEdgeRows.map((row) => ({
            id: row.edge.id,
            source: row.edge.sourceNodeId,
            target: row.edge.targetNodeId,
            relation: row.edge.relation,
            status: row.edge.status,
            confidence: row.edge.confidence ?? undefined,
            evidenceChunkId: row.edge.evidenceChunkId ?? undefined,
            evidenceRunId: row.edge.evidenceRunId ?? undefined,
            quote: row.chunkText ?? undefined,
            page: row.chunkPage ?? undefined,
            chunkNumber: row.chunkOrdinal ?? undefined,
            charStart: row.chunkCharStart ?? undefined,
            charEnd: row.chunkCharEnd ?? undefined,
            sourceTitle: nodeTitleById.get(row.edge.sourceNodeId),
            targetTitle: nodeTitleById.get(row.edge.targetNodeId),
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
