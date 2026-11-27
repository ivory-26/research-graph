import { defineConfig } from 'vitest/config'

// Seed-only unit tests. They are pure (no database, no model call) and are
// listed explicitly so an unrelated test file in this directory is not picked
// up by the seed suite.
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'scripts/seed/assets.test.ts',
      'scripts/seed/compare.test.ts',
      'scripts/seed/contracts.test.ts',
      'scripts/seed/hero-claim.test.ts',
      'scripts/seed/run-edges.test.ts',
      'scripts/seed/runs.test.ts',
    ],
    testTimeout: 10_000,
  },
})
