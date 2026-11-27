import { createFileRoute } from '@tanstack/react-router';
import { asc, eq } from 'drizzle-orm';

import { getDb } from '../../db/client';
import { edges, nodes, sourceChunks } from '../../db/schema';
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
 * Reads persisted graph nodes and evidenced edges (joined with source_chunks
 * for verbatim quote, page, and character offsets) from Postgres.
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
              .where(eq(edges.workspaceId, membership.workspaceId)),
          ]);

          const nodeTitleById = new Map(dbNodes.map((n) => [n.id, n.title]));

          const MAX_ROWS_PER_COL = 5;
          const COL_WIDTH = 260;
          const ROW_HEIGHT = 170;
          const GROUP_ORDER = ['source', 'claim', 'method_dataset', 'run', 'result'] as const;
          const bucketOf = (type: string): (typeof GROUP_ORDER)[number] => {
            if (type === 'source') return 'source';
            if (type === 'method' || type === 'dataset') return 'method_dataset';
            if (type === 'run') return 'run';
            if (type === 'result') return 'result';
            return 'claim';
          };

          const originCounts = new Map<string, number>();
          let maxStoredX = -Infinity;
          for (const n of dbNodes) {
            if (n.positionX === 0 && n.positionY === 0) {
              const b = bucketOf(n.type);
              originCounts.set(b, (originCounts.get(b) ?? 0) + 1);
            } else if (n.positionX > maxStoredX) {
              maxStoredX = n.positionX;
            }
          }

          // Start fallback columns outside the bounding box of any already-positioned nodes
          // (e.g. run/result nodes written by projectRunToGraph) so cards cannot overlap.
          const groupStartX = new Map<string, number>();
          let cursorX = Number.isFinite(maxStoredX) ? maxStoredX + 280 : 40;
          for (const g of GROUP_ORDER) {
            groupStartX.set(g, cursorX);
            const count = originCounts.get(g) ?? 0;
            const subCols = Math.max(1, Math.ceil(count / MAX_ROWS_PER_COL));
            cursorX += subCols * COL_WIDTH + 40;
          }

          const placedInGroup = new Map<string, number>();

          const formattedNodes = dbNodes.map((n) => {
            let x = n.positionX;
            let y = n.positionY;
            if (x === 0 && y === 0) {
              const g = bucketOf(n.type);
              const idx = placedInGroup.get(g) ?? 0;
              placedInGroup.set(g, idx + 1);
              const subCol = Math.floor(idx / MAX_ROWS_PER_COL);
              const rowIdx = idx % MAX_ROWS_PER_COL;
              x = (groupStartX.get(g) ?? 40) + subCol * COL_WIDTH;
              y = 80 + rowIdx * ROW_HEIGHT;
            }
            return {
              id: n.id,
              type: n.type,
              title: n.title,
              position: { x, y },
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
