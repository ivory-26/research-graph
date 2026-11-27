import { createFileRoute } from '@tanstack/react-router';
import { eq } from 'drizzle-orm';

import { getDb } from '../../db/client';
import { agentStrategies, agentTasks } from '../../db/schema';
import { requireWorkspaceAccess } from '../../server/auth/workspace.server';
import {
  AuthConfigurationError,
  AuthUnavailableError,
  UnauthenticatedError,
  WorkspaceAccessDeniedError,
} from '../../server/auth.server';
import type { AgentTaskRow } from '../../utils/strategyClient';

/**
 * Auth-guarded, workspace-scoped Strategy Tasks API endpoint.
 *
 * Reads persisted `agent_tasks` rows from Postgres for the authorized workspace.
 */
export const Route = createFileRoute('/api/strategies')({
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

          const rows = await db
            .select({
              id: agentTasks.id,
              taskKind: agentTasks.taskKind,
              strategyName: agentStrategies.name,
              strategyId: agentTasks.strategyId,
              status: agentTasks.status,
              inputRef: agentTasks.inputRef,
              latencyMs: agentTasks.latencyMs,
              costUsd: agentTasks.costUsd,
              error: agentTasks.error,
            })
            .from(agentTasks)
            .leftJoin(agentStrategies, eq(agentTasks.strategyId, agentStrategies.id))
            .where(eq(agentTasks.workspaceId, membership.workspaceId));

          const tasks: AgentTaskRow[] = rows.map((r) => ({
            id: r.id,
            taskKind: r.taskKind,
            strategyId: r.strategyName ?? r.strategyId ?? 'unassigned',
            runId: typeof r.inputRef?.runId === 'string' ? r.inputRef.runId : null,
            status: r.status,
            latencyMs: r.latencyMs ?? null,
            costUsd: r.costUsd != null ? Number(r.costUsd) : null,
            error: r.error,
          }));

          return Response.json(
            {
              tasks,
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
            { error: 'Failed to load agent_tasks' },
            { status: 500, headers: { 'Cache-Control': 'no-store' } },
          );
        }
      },
    },
  },
});
