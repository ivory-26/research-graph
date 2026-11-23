import { configDefaults, defineConfig } from 'vitest/config'

// Tests are node-only. Keep them off the TanStack Start plugin pipeline so a
// unit test does not need the router, Nitro or the app environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // pipeline-transport tests use node:test and run via `node --test` in the
    // package test script; Vitest would report them as empty test suites.
    // Setting exclude replaces the defaults, so keep those too.
    exclude: [...configDefaults.exclude, 'src/server/pipeline-transport/**'],
  },
})
