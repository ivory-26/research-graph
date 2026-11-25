import { configDefaults, defineConfig } from 'vitest/config'

// Tests are node-only. Keep them off the TanStack Start plugin pipeline so a
// unit test does not need the router, Nitro or the app environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The pipeline-delivery integration files create and drop a real
    // database per file. Under parallel workers that occasionally exceeds
    // Vitest's 5 s default for a test that is otherwise sub-second.
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // pipeline-transport tests use node:test and run via `node --test` in the
    // package test script; Vitest would report them as empty test suites.
    // Setting exclude replaces the defaults, so keep those too.
    exclude: [...configDefaults.exclude, 'src/server/pipeline-transport/**'],
  },
})
