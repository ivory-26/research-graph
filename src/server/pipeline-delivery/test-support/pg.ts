/**
 * Real-Postgres test harness.
 *
 * Test-only. The production client is Neon's WebSocket driver; a plain `pg`
 * pool over TCP is used here so the app layer can be exercised against a real
 * Postgres server in Docker without a Neon branch. The SQL, migrations,
 * constraints and transactions are the real ones. The only concession is the
 * `Database` cast below: the two Drizzle clients expose the same query API,
 * but their branded types are not assignable, and the cast is confined to this
 * test file.
 *
 * No credential is stored here. The caller reads `TEST_DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import type { Database } from '../../../db/client'
import * as schema from '../../../db/schema'
import type { ExperimentSpec } from '../../../shared/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = resolve(HERE, '../../../db/migrations')

const MIGRATION_FILES = [
  '0000_initial_schema.sql',
  '0001_pipeline_foundation.sql',
] as const

export type TestDatabase = {
  pool: Pool
  db: Database
  close(): Promise<void>
}

/** Recreates the `public` schema and applies the committed migrations. */
export async function createTestDatabase(
  connectionString: string,
): Promise<TestDatabase> {
  const pool = new Pool({ connectionString, max: 8 })

  await pool.query('DROP SCHEMA IF EXISTS public CASCADE')
  await pool.query('CREATE SCHEMA public')

  for (const file of MIGRATION_FILES) {
    const sql = await readFile(resolve(MIGRATIONS_DIR, file), 'utf8')
    await pool.query(sql)
  }

  const db = drizzle({ client: pool, schema }) as unknown as Database

  return {
    pool,
    db,
    close: () => pool.end(),
  }
}

/** Clears every application table while keeping the schema and migrations. */
export async function resetData(pool: Pool): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE
      approval_gates,
      execution_claims,
      pipeline_events,
      run_artifacts,
      runs,
      experiments,
      agent_tasks,
      agent_strategies,
      edges,
      nodes,
      source_chunks,
      sources,
      workspace_members,
      workspaces
    RESTART IDENTITY CASCADE
  `)
}

export type SeededWorkspace = {
  workspaceId: string
  otherWorkspaceId: string
  memberId: string
  strangerId: string
  /** A member of a different workspace: membership must not cross over. */
  outsiderId: string
  claimNodeId: string
  experimentId: string
  spec: ExperimentSpec
}

function makeSpec(claimNodeId: string): ExperimentSpec {
  return {
    claimNodeId,
    // The product only ever produces `adapted` (CLAUDE.md).
    mode: 'adapted',
    language: 'python',
    image: 'researchgraph/base:test',
    files: { 'main.py': 'print("fixture")\n' },
    entrypoint: 'python main.py',
    datasets: [],
    parameters: {},
    criteria: {
      mode: 'all',
      checks: [{ metric: 'score', op: 'gte', value: 0.5 }],
    },
    timeoutSeconds: 30,
    memoryMb: 2048,
    cpuCount: 1,
    network: 'none',
  }
}

async function insertedId(
  pool: Pool,
  sql: string,
  values: unknown[],
): Promise<string> {
  const result = await pool.query<{ id: string }>(sql, values)
  const row = result.rows[0]
  if (!row) throw new Error('seed insert returned no row')
  return row.id
}

/**
 * Seeds one workspace with one member, one non-member identity, an unrelated
 * workspace, a claim node and one pending experiment.
 */
export async function seedWorkspace(pool: Pool): Promise<SeededWorkspace> {
  const memberId = 'test-member'
  const strangerId = 'test-stranger'
  const outsiderId = 'test-outsider'

  const workspaceId = await insertedId(
    pool,
    `INSERT INTO workspaces (name, slug) VALUES ($1, $2) RETURNING id`,
    ['Fixture workspace', `fixture-${randomUUID()}`],
  )

  const otherWorkspaceId = await insertedId(
    pool,
    `INSERT INTO workspaces (name, slug) VALUES ($1, $2) RETURNING id`,
    ['Other workspace', `other-${randomUUID()}`],
  )

  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
    [workspaceId, memberId],
  )

  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
    [otherWorkspaceId, outsiderId],
  )

  const claimNodeData = {
    type: 'claim',
    text: 'Noise features can outrank informative ones.',
    reported: null,
    datasetName: null,
    methodName: null,
    locator: { page: 1, quote: 'noise can outrank informative features' },
  }

  const claimNodeId = await insertedId(
    pool,
    `INSERT INTO nodes (workspace_id, type, title, data)
     VALUES ($1, 'claim', $2, $3) RETURNING id`,
    [workspaceId, 'Claim', JSON.stringify(claimNodeData)],
  )

  const spec = makeSpec(claimNodeId)

  const experimentId = await insertedId(
    pool,
    `INSERT INTO experiments (workspace_id, claim_node_id, spec, mode)
     VALUES ($1, $2, $3, 'adapted') RETURNING id`,
    [workspaceId, claimNodeId, JSON.stringify(spec)],
  )

  return {
    workspaceId,
    otherWorkspaceId,
    memberId,
    strangerId,
    outsiderId,
    claimNodeId,
    experimentId,
    spec,
  }
}
