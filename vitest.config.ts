import { defineConfig } from 'vitest/config'

// Tests target the server modules directly; they do not need the Start/Vite
// plugin pipeline, so they get their own config and stay fast and isolated.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
