import { configDefaults, defineConfig } from 'vitest/config'

// Tests are node-only. Keep them off the TanStack Start plugin pipeline so a
// unit test does not need the router, Nitro or the app environment.
export default defineConfig({
  test: {
    environment: 'node',
    // The seed's run-edge DB coverage skips itself unless TEST_DATABASE_URL
    // names a disposable server; including it here makes `pnpm test` cover it
    // in the same run as the other real-Postgres integration files.
    include: ['src/**/*.test.ts', 'scripts/seed/*.integration.test.ts'],
    // The pipeline-delivery integration files create and drop a real
    // database per file. Under parallel workers that occasionally exceeds
    // Vitest's 5 s default for a test that is otherwise sub-second.
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // Each integration file provisions its own database on the same loopback
    // Postgres. Letting Vitest spawn one worker per file starves that server
    // and makes the SSE budget/heartbeat tests miss generous waits. Four
    // workers keep the suite deterministic without serializing unit tests.
    maxWorkers: 4,
    // pipeline-transport tests use node:test and run via `node --test` in the
    // package test script; Vitest would report them as empty test suites.
    // Setting exclude replaces the defaults, so keep those too.
    exclude: [...configDefaults.exclude, 'src/server/pipeline-transport/**'],
  },
})
