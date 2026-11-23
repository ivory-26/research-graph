/**
 * The application's database connection.
 *
 * Server-only and lazy: importing this module opens no socket and reads no
 * secret. The first `getDb()` call creates a Neon WebSocket `Pool` and a
 * Drizzle client; `closeDb()` releases it (scripts, tests, shutdown).
 *
 * The WebSocket driver is deliberate rather than the HTTP driver: graph
 * operations need interactive transactions, and `drizzle-orm/neon-serverless`
 * exposes `db.transaction(async (tx) => ...)` while the HTTP driver does not.
 *
 * Usage, from server code only:
 *
 *   import { getDb } from '../db/client'
 *   const db = getDb()
 *   await db.transaction(async (tx) => { ... })
 */
import { createServerOnlyFn } from '@tanstack/react-start'
import { Pool } from '@neondatabase/serverless'
import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless'
import * as schema from './schema'

export type Database = NeonDatabase<typeof schema>

let pool: Pool | undefined
let database: Database | undefined

function databaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Put the Neon connection string in .env at ' +
        'the repo root (see src/db/README.md).',
    )
  }
  return url
}

/**
 * The process-wide client. Safe to call repeatedly; the pool is created once.
 * Never call this from client code — `createServerOnlyFn` is a build-time
 * marker that TanStack Start replaces with a throwing stub on the client.
 */
export const getDb = createServerOnlyFn((): Database => {
  if (!database) {
    pool = new Pool({ connectionString: databaseUrl() })
    database = drizzle({ client: pool, schema })
  }
  return database
})

/** Close the pool and clear the singleton. Idempotent. */
export const closeDb = createServerOnlyFn(async (): Promise<void> => {
  const current = pool
  pool = undefined
  database = undefined
  if (current) {
    await current.end()
  }
})
