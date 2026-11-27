#!/usr/bin/env node
/** `pnpm seed` entrypoint. See scripts/seed/README.md. */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runTsModule } from './ssr.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

process.exitCode = await runTsModule({
  repoRoot,
  modulePath: '/scripts/seed.ts',
  exportName: 'main',
  argv: process.argv.slice(2),
  label: 'Seed',
})
