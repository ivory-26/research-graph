/**
 * First-use workspace onboarding against disposable Postgres.
 *
 * Skipped unless `TEST_DATABASE_URL` names a disposable server; see
 * `src/server/pipeline-delivery/test-support/pg.ts`.
 *
 * These tests use the real migrations and the real transaction in
 * `ensureOwnerWorkspace`. They prove the two product requirements directly:
 * the first verified visit creates exactly one workspace with an owner row, and
 * a second user can never gain a membership in that workspace.
 */
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { workspaceMembers, workspaces } from '../db/schema.ts'
import { enforceWorkspaceMembership } from './auth.server.ts'
import { ensureOwnerWorkspace } from './auth/workspace.server.ts'
import {
  createTestDatabase,
  type TestDatabase,
} from './pipeline-delivery/test-support/pg.ts'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip

const routeState = vi.hoisted(() => ({
  db: undefined as TestDatabase['db'] | undefined,
}))

vi.mock('../db/client', () => ({ getDb: () => routeState.db }))

function user(id: string, name: string | null = null) {
  return { id, email: `${id}@example.test`, name }
}

describeIntegration('ensureOwnerWorkspace on Postgres', () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase(TEST_DATABASE_URL as string)
    routeState.db = testDb.db
  })

  afterAll(async () => {
    await testDb?.close()
  })

  async function membershipsFor(userId: string) {
    return testDb.db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId))
  }

  async function workspaceCount() {
    const rows = await testDb.db.select({ id: workspaces.id }).from(workspaces)
    return rows.length
  }

  it('creates one workspace with an owner membership on first use', async () => {
    const ensured = await ensureOwnerWorkspace(user('first-user', 'Ada'))

    expect(ensured).not.toBeNull()
    expect(ensured?.created).toBe(true)
    expect(ensured?.role).toBe('owner')

    const memberships = await membershipsFor('first-user')
    expect(memberships).toEqual([
      { workspaceId: ensured?.workspaceId, role: 'owner' },
    ])

    const [workspace] = await testDb.db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, ensured?.workspaceId ?? ''))
    expect(workspace?.name).toBe("Ada's workspace")
  })

  it('is idempotent: a second call returns the same workspace and adds nothing', async () => {
    const first = await ensureOwnerWorkspace(user('repeat-user'))
    const second = await ensureOwnerWorkspace(user('repeat-user'))

    expect(second?.workspaceId).toBe(first?.workspaceId)
    expect(first?.created).toBe(true)
    expect(second?.created).toBe(false)
    expect(await membershipsFor('repeat-user')).toHaveLength(1)
  })

  it('never grants access to another user’s workspace', async () => {
    const owner = await ensureOwnerWorkspace(user('owner-user'))
    const other = await ensureOwnerWorkspace(user('other-user'))

    expect(other?.workspaceId).not.toBe(owner?.workspaceId)

    const [crossRow] = await testDb.db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, owner?.workspaceId ?? ''),
          eq(workspaceMembers.userId, 'other-user'),
        ),
      )
      .limit(1)
    expect(crossRow).toBeUndefined()

    const lookup = async (input: { userId: string; workspaceId: string }) => {
      const [row] = await testDb.db
        .select({
          userId: workspaceMembers.userId,
          workspaceId: workspaceMembers.workspaceId,
          role: workspaceMembers.role,
        })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.userId, input.userId),
            eq(workspaceMembers.workspaceId, input.workspaceId),
          ),
        )
        .limit(1)
      return row ?? null
    }

    await expect(
      enforceWorkspaceMembership(
        { userId: 'other-user', workspaceId: owner?.workspaceId ?? '' },
        lookup,
      ),
    ).rejects.toThrow()
  })

  it('resolves concurrent first-use requests to a single workspace and membership', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => ensureOwnerWorkspace(user('racing-user'))),
    )

    const ids = new Set(results.map((result) => result?.workspaceId))
    expect(ids.size).toBe(1)
    expect(await membershipsFor('racing-user')).toHaveLength(1)

    // Exactly one caller observed the insert; the rest found the winner.
    expect(results.filter((result) => result?.created)).toHaveLength(1)
  })

  it('rejects an empty user id without writing anything', async () => {
    const before = await workspaceCount()

    await expect(ensureOwnerWorkspace({ id: '   ', email: null, name: null })).rejects.toThrow()

    expect(await workspaceCount()).toBe(before)
  })
})
