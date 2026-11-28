import '@tanstack/react-start/server-only'

import { and, eq } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { workspaceMembers, workspaces } from '../../db/schema'
import {
  enforceWorkspaceMembership,
  requireCurrentUser,
  WorkspaceAccessDeniedError,
  type CurrentUser,
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

// ---------------------------------------------------------------------------
// First-use onboarding
// ---------------------------------------------------------------------------

/** Longest user id accepted into a personal workspace slug. */
const MAX_USER_ID_LENGTH = 240

/** Prefix that keeps a personal workspace slug from colliding with another kind. */
const PERSONAL_SLUG_PREFIX = 'personal-'

export type EnsuredOwnerWorkspace = {
  workspaceId: string
  role: string
  /** True when this call created the membership; false when it already existed. */
  created: boolean
}

/** A short, displayable workspace name derived only from the verified user. */
function personalWorkspaceName(user: CurrentUser): string {
  const label =
    user.name?.trim() ||
    user.email?.split('@', 1)[0]?.trim() ||
    ''

  // Strip control characters and cap the stored name; the fallback is fixed.
  const safe = label.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 96)

  return safe ? `${safe}'s workspace` : 'Personal workspace'
}

/**
 * Gives a verified user their own workspace on first use, exactly once.
 *
 * Identity comes only from the verified session passed by the caller — never
 * from request input — so this can only ever grant the user access to a
 * workspace keyed to their own id. A user who already belongs to any workspace
 * is left alone: their existing membership is returned with `created: false`.
 *
 * Concurrency and idempotency are structural:
 * - the workspace slug is deterministic (`personal-<userId>`), and the unique
 *   `workspaces.slug` index turns a duplicate insert into an update of the same
 *   row, so two racing first-use requests resolve to one workspace;
 * - `(workspace_id, user_id)` is the membership primary key, so the membership
 *   insert is `ON CONFLICT DO NOTHING`.
 *
 * Both writes run in one transaction; either the workspace and its owner
 * membership commit together or neither does.
 */
export async function ensureOwnerWorkspace(
  user: CurrentUser,
): Promise<EnsuredOwnerWorkspace> {
  const userId = user.id
  if (!userId || userId !== userId.trim() || userId.length > MAX_USER_ID_LENGTH) {
    throw new WorkspaceAccessDeniedError()
  }

  return getDb().transaction(async (tx) => {
    const [existing] = await tx
      .select({
        workspaceId: workspaceMembers.workspaceId,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId))
      .limit(1)

    if (existing) return { ...existing, created: false }

    const slug = `${PERSONAL_SLUG_PREFIX}${userId}`
    const [workspace] = await tx
      .insert(workspaces)
      .values({ name: personalWorkspaceName(user), slug })
      // A racing first-use request may have created this exact slug already.
      // Updating the slug to itself returns the existing row without changing
      // its name or id.
      .onConflictDoUpdate({ target: workspaces.slug, set: { slug } })
      .returning({ id: workspaces.id })

    if (!workspace) {
      throw new Error('workspace onboarding did not return a workspace')
    }

    // `returning()` is the precise "did this call create the row" signal: a
    // concurrent caller that loses the primary-key conflict gets no row back
    // even though it ran the same insert.
    const inserted = await tx
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId, role: 'owner' })
      .onConflictDoNothing({
        target: [workspaceMembers.workspaceId, workspaceMembers.userId],
      })
      .returning({ workspaceId: workspaceMembers.workspaceId })

    // Read the persisted role in this transaction, including when another
    // request inserted the membership first.
    const [membership] = await tx
      .select({
        workspaceId: workspaceMembers.workspaceId,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspace.id),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1)

    if (!membership) {
      throw new Error('workspace onboarding did not return a membership')
    }

    return { ...membership, created: inserted.length > 0 }
  })
}
