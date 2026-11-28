import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

// Nitro is the documented deployment path (docs/01-architecture.md).
// The React plugin must come after the Start plugin.
export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    nitro({
      preset: process.env.VERCEL ? 'vercel' : (process.env.NITRO_PRESET || undefined),
      // Vercel Hobby caps a function at 300 s and streamed time counts. The
      // pipeline stream's own budget is 240 s, so 300 leaves room for the
      // terminal append without the platform cutting the SSE response first.
      // Nitro writes this into each function's build-output config; a
      // `vercel.json` `functions` block is not applied to Build Output API
      // deployments.
      vercel: {
        functions: { maxDuration: 300 },
        functionRules: {
          '/api/pipeline/**': { maxDuration: 300 },
          '/api/runs/**': { maxDuration: 60 },
        },
      },
      rollupConfig: { external: [/^@sentry\//] },
    }),
    viteReact(),
  ],
})
