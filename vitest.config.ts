import { defineConfig } from 'vitest/config'

// Tests are node-only. Keep them off the TanStack Start plugin pipeline so a
// unit test does not need the router, Nitro or the app environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
