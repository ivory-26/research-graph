/**
 * Shared Vite-SSR runner for the seed CLI modules.
 *
 * Node 26 strips TypeScript, but production modules use extensionless relative
 * imports that Node's ESM resolver does not resolve. Vite is the repo's
 * declared build/dev/test toolchain and already resolves those modules for the
 * app and for Vitest, so the CLIs load their `.ts` entrypoints through it
 * instead of adding an undeclared runner.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

import { createServer } from 'vite'

function loadDotEnv(repoRoot) {
  const envPath = join(repoRoot, '.env')
  if (!existsSync(envPath)) return

  let parsed
  try {
    parsed = parseEnv(readFileSync(envPath, 'utf8'))
  } catch (error) {
    throw new Error(
      `could not parse ${envPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function describeError(error) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? ` [${String(error.code)}]`
      : ''
  const message = error instanceof Error ? error.message : String(error)
  return { code, message }
}

export async function runTsModule({
  repoRoot,
  modulePath,
  exportName = 'main',
  argv = [],
  label = 'Seed',
}) {
  try {
    loadDotEnv(repoRoot)
  } catch (error) {
    const { message } = describeError(error)
    console.error(`${label} failed: ${message}`)
    return 1
  }

  const server = await createServer({
    root: repoRoot,
    configFile: false,
    appType: 'custom',
    logLevel: 'warn',
    server: { middlewareMode: true },
  })

  try {
    const module = await server.ssrLoadModule(modulePath)
    if (typeof module[exportName] !== 'function') {
      throw new Error(`${modulePath} does not export ${exportName}()`)
    }
    const code = await module[exportName](argv)
    return typeof code === 'number' ? code : 0
  } catch (error) {
    const { code, message } = describeError(error)
    console.error(`${label} failed${code}: ${message}`)
    if (process.env.SEED_DEBUG === '1' && error instanceof Error && error.stack) {
      console.error(error.stack)
    }
    return 1
  } finally {
    await server.close()
  }
}
