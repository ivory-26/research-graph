#!/usr/bin/env node
/**
 * Enable pgvector before drizzle-kit introspects or pushes.
 *
 * `drizzle-kit push` does not emit CREATE EXTENSION, so a fresh Neon database
 * would fail on `vector(768)`. This runs first in `pnpm db:push`. The committed
 * migration SQL carries the same statement, so `pnpm db:migrate` is safe on an
 * empty database too.
 *
 * Reads DATABASE_URL from the environment or from a local `.env`. Never prints
 * the connection string.
 */
import { existsSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

if (!process.env.DATABASE_URL && existsSync('.env')) {
  process.loadEnvFile('.env')
}

const url = process.env.DATABASE_URL
if (!url) {
  console.error(
    'DATABASE_URL is not set. Put your Neon connection string in .env ' +
      '(see src/db/README.md).',
  )
  process.exit(1)
}

try {
  const sql = neon(url)
  await sql`CREATE EXTENSION IF NOT EXISTS vector`
  console.log('pgvector ready.')
} catch {
  console.error(
    'Could not enable pgvector. Check DATABASE_URL and the Neon role’s extension permissions.',
  )
  process.exit(1)
}
