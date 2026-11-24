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
 * Isolation and safety:
 *
 * - The supplied `TEST_DATABASE_URL` is a *server* endpoint, never a database
 *   this harness may modify. The harness connects to it only to run
 *   `CREATE DATABASE` / `DROP DATABASE` for a database whose name it generated,
 *   and every drop is re-checked against the disposable-name grammar first.
 * - Nothing here drops a schema, truncates a table, or writes to the database
 *   named in the URL. Migrations and `reset()` only ever run against the
 *   uniquely named database this harness created, and `reset()` re-reads
 *   `current_database()` before it truncates anything.
 * - The host must be loopback unless `TEST_DATABASE_ALLOW_REMOTE=1` is set
 *   explicitly. That flag is for a server that is itself disposable (a CI
 *   container); it is not a way to point the suite at a shared database.
 *
 * The test URL therefore needs the `CREATEDB` privilege. A local container
 * (`pgvector/pgvector:pg18`) satisfies that:
 *
 * ```bash
 * docker run --rm -d --name rg-test-pg \
 *   -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55432:5432 \
 *   pgvector/pgvector:pg18
 * TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres \
 *   pnpm exec vitest run src/server/pipeline-delivery
 * ```
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

/** Every database this harness creates is named after this prefix. */
export const DISPOSABLE_DATABASE_PREFIX = 'rg_test_'

/** The only names this harness will ever drop. */
const DISPOSABLE_DATABASE_RE = /^rg_test_[a-z0-9_]{1,48}$/

/** Postgres identifiers are limited to 63 bytes. */
const MAX_IDENTIFIER_BYTES = 63

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

/** Tables owned by the application migrations, in TRUNCATE order. */
const APPLICATION_TABLES = [
  'approval_gates',
  'execution_claims',
  'pipeline_events',
  'run_artifacts',
  'runs',
  'experiments',
  'agent_tasks',
  'agent_strategies',
  'edges',
  'nodes',
  'source_chunks',
  'sources',
  'workspace_members',
  'workspaces',
] as const

export type TestDatabase = {
  pool: Pool
  db: Database
  /** The generated database name, for diagnostics and safety checks. */
  databaseName: string
  /** Truncates application tables, but only in the database created here. */
  reset(): Promise<void>
  /** Ends the pool and drops the database created here. Idempotent. */
  close(): Promise<void>
}

type Env = Record<string, string | undefined>

function readUrl(connectionString: string): URL {
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    throw new TypeError(
      'TEST_DATABASE_URL must be a postgres:// URL, not a keyword/value DSN',
    )
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new TypeError(
      'TEST_DATABASE_URL must use the postgres:// or postgresql:// scheme',
    )
  }

  if (url.hostname === '') {
    throw new TypeError(
      'TEST_DATABASE_URL must name an explicit host; Unix-socket URLs are refused',
    )
  }

  if (url.pathname === '' || url.pathname === '/') {
    throw new TypeError(
      'TEST_DATABASE_URL must name the maintenance database to connect to',
    )
  }

  return url
}

function normalizedHostname(url: URL): string {
  return url.hostname.replace(/^\[/u, '').replace(/\]$/u, '').toLowerCase()
}

/**
 * Validates the supplied endpoint before any connection is opened.
 *
 * This is deliberately strict: the URL selects a server, and a mistake here is
 * a mistake against a real database cluster.
 */
export function assertDisposableAdminUrl(
  connectionString: string,
  env: Env = process.env,
): URL {
  const url = readUrl(connectionString)
  const host = normalizedHostname(url)

  if (!LOOPBACK_HOSTS.has(host) && env.TEST_DATABASE_ALLOW_REMOTE !== '1') {
    throw new TypeError(
      `TEST_DATABASE_URL host ${host} is not loopback. ` +
        'The suite creates and drops a disposable database on that server; ' +
        'use a local pgvector container, or set TEST_DATABASE_ALLOW_REMOTE=1 ' +
        'only when the server itself is disposable.',
    )
  }

  return url
}

/** Rejects any name this harness did not generate. */
export function assertDisposableDatabaseName(databaseName: string): void {
  if (
    !DISPOSABLE_DATABASE_RE.test(databaseName) ||
    Buffer.byteLength(databaseName, 'utf8') > MAX_IDENTIFIER_BYTES
  ) {
    throw new TypeError(
      `refusing to operate on database ${JSON.stringify(databaseName)}: ` +
        `only ${DISPOSABLE_DATABASE_PREFIX}* names created by this harness are disposable`,
    )
  }
}

export function createDisposableDatabaseName(
  now: number = Date.now(),
  id: string = randomUUID(),
): string {
  const name = `${DISPOSABLE_DATABASE_PREFIX}${now.toString(36)}_${id
    .replace(/-/gu, '')
    .slice(0, 12)
    .toLowerCase()}`
  assertDisposableDatabaseName(name)
  return name
}

/** Returns the same connection string pointed at another database. */
export function withDatabaseName(
  connectionString: string,
  databaseName: string,
): string {
  assertDisposableDatabaseName(databaseName)
  const url = readUrl(connectionString)
  url.pathname = `/${databaseName}`
  return url.toString()
}

function quoteIdentifier(databaseName: string): string {
  assertDisposableDatabaseName(databaseName)
  return `"${databaseName}"`
}

async function applyMigrations(pool: Pool): Promise<void> {
  for (const file of MIGRATION_FILES) {
    const sql = await readFile(resolve(MIGRATIONS_DIR, file), 'utf8')
    await pool.query(sql)
  }
}

async function dropDisposableDatabase(
  adminPool: Pool,
  databaseName: string,
): Promise<void> {
  assertDisposableDatabaseName(databaseName)

  // Only connections to the database just created by this harness; the
  // admin connection lives in the maintenance database and is excluded.
  await adminPool.query(
    `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
      WHERE datname = $1
        AND pid <> pg_backend_pid()`,
    [databaseName],
  )
  await adminPool.query(
    `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`,
  )
}

/**
 * Creates a uniquely named, disposable database, applies the committed
 * migrations inside it, and returns a client scoped to it.
 *
 * The database named in `connectionString` is used only as a maintenance
 * endpoint. It is never migrated, truncated, dropped, or written to.
 */
export async function createTestDatabase(
  connectionString: string,
  env: Env = process.env,
): Promise<TestDatabase> {
  const adminUrl = assertDisposableAdminUrl(connectionString, env)
  const databaseName = createDisposableDatabaseName()

  const adminPool = new Pool({
    connectionString: adminUrl.toString(),
    max: 2,
  })

  let pool: Pool | null = null
  try {
    try {
      await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
    } catch (error) {
      throw new Error(
        `could not create the disposable test database ${databaseName}. ` +
          'The TEST_DATABASE_URL role needs CREATEDB; a local pgvector ' +
          'container has it. No existing database was modified.',
        { cause: error },
      )
    }

    pool = new Pool({
      connectionString: withDatabaseName(connectionString, databaseName),
      max: 8,
    })
    await applyMigrations(pool)
  } catch (error) {
    await pool?.end().catch(() => undefined)
    await dropDisposableDatabase(adminPool, databaseName).catch(
      () => undefined,
    )
    await adminPool.end().catch(() => undefined)
    throw error
  }

  const testPool = pool
  const db = drizzle({ client: testPool, schema }) as unknown as Database
  let closed = false

  return {
    pool: testPool,
    db,
    databaseName,

    async reset() {
      const result = await testPool.query<{ name: string }>(
        'SELECT current_database() AS name',
      )
      const current = result.rows[0]?.name
      if (current !== databaseName) {
        throw new Error(
          `refusing to truncate: connected to ${JSON.stringify(current)}, ` +
            `not the disposable database ${JSON.stringify(databaseName)}`,
        )
      }

      await testPool.query(`
        TRUNCATE TABLE
          ${APPLICATION_TABLES.join(',\n          ')}
        RESTART IDENTITY CASCADE
      `)
    },

    async close() {
      if (closed) return
      closed = true

      await testPool.end()
      try {
        await dropDisposableDatabase(adminPool, databaseName)
      } finally {
        await adminPool.end()
      }
    },
  }
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
