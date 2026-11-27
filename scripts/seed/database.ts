import { fileURLToPath } from 'node:url'

import { Pool as NeonPool } from '@neondatabase/serverless'
import { drizzle as neonDrizzle } from 'drizzle-orm/neon-serverless'
import { migrate as migrateNeon } from 'drizzle-orm/neon-serverless/migrator'
import { drizzle as postgresDrizzle } from 'drizzle-orm/node-postgres'
import { migrate as migratePostgres } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

import type { Database } from '../../src/db/client.ts'
import * as schema from '../../src/db/schema.ts'

const migrationsFolder = fileURLToPath(new URL('../../src/db/migrations/', import.meta.url))
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

export interface SeedDatabase {
  db: Database
  migrate(): Promise<void>
  close(): Promise<void>
}

export function openSeedDatabase(connectionString: string): SeedDatabase {
  const url = new URL(connectionString)
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error('The seed database must use a PostgreSQL connection URL.')
  }

  if (loopbackHosts.has(url.hostname)) {
    const pool = new pg.Pool({ connectionString })
    const db = postgresDrizzle({ client: pool, schema })
    return {
      // Both Drizzle drivers expose the same Postgres query and transaction
      // operations used by the production stages. Only the client differs.
      db: db as unknown as Database,
      migrate: () => migratePostgres(db, { migrationsFolder }),
      close: () => pool.end(),
    }
  }

  const pool = new NeonPool({ connectionString })
  const db = neonDrizzle({ client: pool, schema })
  return {
    db,
    migrate: () => migrateNeon(db, { migrationsFolder }),
    close: () => pool.end(),
  }
}
