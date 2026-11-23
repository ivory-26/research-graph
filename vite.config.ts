import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

// Nitro is the documented deployment path (docs/01-architecture.md).
// The React plugin must come after the Start plugin.
export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [tanstackStart(), nitro(), viteReact()],
})
