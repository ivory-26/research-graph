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
      rollupConfig: { external: [/^@sentry\//] },
    }),
    viteReact(),
  ],
})
