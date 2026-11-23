import '@tanstack/react-start/server-only'

import { and, eq } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { workspaceMembers } from '../../db/schema'
import {
  enforceWorkspaceMembership,
  requireCurrentUser,
  WorkspaceAccessDeniedError,
  type WorkspaceMembership,
} from '../auth.server'

const WORKSPACE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Authorize a raw TanStack server request against the app's membership table. */
export async function requireWorkspaceAccess(
  request: Request,
  workspaceId: string,
): Promise<WorkspaceMembership> {
  const user = await requireCurrentUser(request)
  const id = workspaceId.toLowerCase()
  if (!WORKSPACE_UUID.test(id)) throw new WorkspaceAccessDeniedError()

  return enforceWorkspaceMembership({ userId: user.id, workspaceId: id }, async (input) => {
    const [membership] = await getDb()
      .select({
        userId: workspaceMembers.userId,
        workspaceId: workspaceMembers.workspaceId,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .where(and(
        eq(workspaceMembers.userId, input.userId),
        eq(workspaceMembers.workspaceId, input.workspaceId),
      ))
      .limit(1)

    return membership ?? null
  })
}
