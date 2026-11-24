import { defineConfig } from 'drizzle-kit'

/**
 * Application schema only.
 *
 * `schemaFilter: ['public']` keeps drizzle-kit's introspection and push scoped
 * to our tables. The `neon_auth` schema belongs to Neon Auth (Managed Better
 * Auth) and is deliberately outside our migrations, so push must not inspect
 * or drop it.
 *
 * `DATABASE_URL` comes from the environment, or from `.env`, which drizzle-kit
 * loads itself. The empty fallback exists only so `drizzle-kit generate` works
 * without a secret; commands that connect fail with a clear Neon error.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  schemaFilter: ['public'],
  strict: false,
  verbose: true,
})
