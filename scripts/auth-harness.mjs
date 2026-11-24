#!/usr/bin/env node
/**
 * Disposable end-to-end harness for issue #4 (Neon Auth server wiring).
 *
 * Copies the app to a temporary directory, adds a smoke page, starts Vite
 * there, and exercises the application's auth route:
 *
 *   POST /api/auth/sign-in/email   -> same-origin proxy sets the session cookie
 *   GET  /auth-smoke               -> a route loader calls getCurrentUser()
 *   GET  /auth-smoke (again)       -> the session survives a refresh
 *   GET  /auth-smoke (no cookie)   -> signed out
 *
 * By default the upstream is a local fake Neon Auth server, so the run never
 * touches Neon and creates no users. `--real` talks to the URL already in
 * NEON_AUTH_BASE_URL and signs in with AUTH_HARNESS_EMAIL /
 * AUTH_HARNESS_PASSWORD (never signs up, never prints either value).
 *
 * Usage:
 *   node scripts/auth-harness.mjs
 *   node scripts/auth-harness.mjs --build   # also build the copy, proving the
 *                                           # client bundle never imports auth.server
 *   node scripts/auth-harness.mjs --real
 *   AUTH_HARNESS_DEBUG=1 node scripts/auth-harness.mjs
 *
 * Exit code 0 means every assertion passed. The temp directory is removed on
 * success and failure.
 */
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  cp,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const useRealUpstream = process.argv.includes('--real')
const debug = process.env.AUTH_HARNESS_DEBUG === '1'

const SESSION_TOKEN_COOKIE = '__Secure-neon-auth.session_token'
const SESSION_DATA_COOKIE = '__Secure-neon-auth.local.session_data'
const FAKE_USER_ID = 'harness-user-1'

const SKIP_COPY = new Set([
  '.git',
  '.nitro',
  '.output',
  '.tanstack',
  '.vite-auth-harness',
  'dist',
  'node_modules',
])

function log(message) {
  console.log(`[auth-harness] ${message}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolvePort(address.port))
    })
  })
}

function sessionPayload(userId, email, name) {
  const now = new Date().toISOString()
  return {
    user: {
      id: userId,
      email,
      name,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: 'harness-session-1',
      userId,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
  }
}

async function readRequestBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function writeJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json', ...headers })
  response.end(body === null ? 'null' : JSON.stringify(body))
}

/** Local stand-in for Managed Better Auth. Never leaves this machine. */
async function startFakeUpstream() {
  const server = createServer(async (request, response) => {
    const body = await readRequestBody(request)

    if (request.method === 'GET' && request.url?.startsWith('/get-session')) {
      if ((request.headers.cookie ?? '').includes(`${SESSION_TOKEN_COOKIE}=harness-token`)) {
        writeJson(
          response,
          200,
          sessionPayload(FAKE_USER_ID, 'harness@example.test', 'Harness User'),
          {
            // Simulates a rolling session token. The server function must
            // propagate this Set-Cookie to the browser response.
            'set-cookie': [
              `${SESSION_TOKEN_COOKIE}=harness-token-refreshed; Path=/; HttpOnly; Secure; SameSite=None`,
            ],
          },
        )
      } else {
        writeJson(response, 200, null)
      }
      return
    }

    if (request.method === 'POST' && request.url === '/sign-in/email') {
      let parsed
      try {
        parsed = JSON.parse(body)
      } catch {
        writeJson(response, 400, { message: 'invalid json' })
        return
      }
      if (!parsed?.email || !parsed?.password) {
        writeJson(response, 400, { message: 'email and password required' })
        return
      }
      writeJson(
        response,
        200,
        sessionPayload(FAKE_USER_ID, parsed.email, 'Harness User'),
        {
          'set-cookie': [
            `${SESSION_TOKEN_COOKIE}=harness-token; Path=/; HttpOnly; Secure; SameSite=None`,
          ],
        },
      )
      return
    }

    writeJson(response, 404, { message: 'not found in harness upstream' })
  })

  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((done) => server.close(done)),
  }
}

function cookieJar() {
  const jar = new Map()

  return {
    absorb(response) {
      for (const cookie of response.headers.getSetCookie()) {
        const [pair, ...attributes] = cookie.split(';')
        const separator = pair.indexOf('=')
        if (separator < 0) continue
        const name = pair.slice(0, separator).trim()
        const value = pair.slice(separator + 1)
        const expired = attributes.some((attribute) => {
          const [key, rawValue] = attribute.trim().split('=')
          return key.toLowerCase() === 'max-age' && Number(rawValue) <= 0
        })
        if (!value || expired) jar.delete(name)
        else jar.set(name, value)
      }
      return this
    },
    header() {
      return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
    },
    names() {
      return [...jar.keys()]
    },
  }
}

async function copyApplication(destination) {
  await cp(repoRoot, destination, {
    recursive: true,
    filter: (source) => {
      const base = source.split(/[\\/]/).pop() ?? ''
      if (source === repoRoot) return true
      // Never copy a real env file (or any secret-adjacent variant) into the
      // temporary directory. The example is safe and useful.
      if (base === '.env') return false
      if (base.startsWith('.env.') && base !== '.env.example') return false
      return !SKIP_COPY.has(base)
    },
  })

  const nodeModules = join(repoRoot, 'node_modules')
  if (!existsSync(nodeModules)) {
    throw new Error('node_modules is missing; run pnpm install first')
  }
  await symlink(nodeModules, join(destination, 'node_modules'), 'junction')
}

const SMOKE_ROUTE = `import { createFileRoute } from '@tanstack/react-router'
import { getCurrentUser } from '../server/auth'

// Throwaway route for the auth harness only. The loader runs during SSR, so
// the rendered HTML proves the server function read the request's session.
export const Route = createFileRoute('/auth-smoke')({
  loader: () => getCurrentUser(),
  component: AuthSmoke,
})

function AuthSmoke() {
  const user = Route.useLoaderData()
  return (
    <main>
      <p data-testid="whoami">{user?.id ?? 'signed-out'}</p>
    </main>
  )
}
`

const VITE_CONFIG = `import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT),
    // node_modules is a junction to the shared install, which lives outside
    // this temporary root. Vite must be allowed to read it.
    fs: { allow: [process.cwd(), process.env.AUTH_HARNESS_NODE_MODULES] },
  },
  // Keep dependency caches out of the shared node_modules junction.
  cacheDir: '.vite-auth-harness',
  plugins: [tanstackStart(), nitro(), viteReact()],
})
`

async function prepareApplication() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'research-graph-auth-'))
  await copyApplication(tempRoot)

  await writeFile(join(tempRoot, 'src', 'routes', 'auth-smoke.tsx'), SMOKE_ROUTE, 'utf8')
  await writeFile(join(tempRoot, 'vite.config.ts'), VITE_CONFIG, 'utf8')

  return tempRoot
}

async function waitForServer(url, child, logs, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`dev server exited early (${child.exitCode})\n${redact(logs())}`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // not listening yet
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }
  throw new Error(`dev server did not start in ${timeoutMs}ms\n${redact(logs())}`)
}

let secretForRedaction = ''
let upstreamForRedaction = ''

function redact(text) {
  let redacted = text
  if (secretForRedaction) redacted = redacted.split(secretForRedaction).join('***')
  if (upstreamForRedaction) redacted = redacted.split(upstreamForRedaction).join('<upstream>')
  return redacted
}

function runProcess(command, args, options, onOutput) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    child.stdout.on('data', (chunk) => onOutput(chunk))
    child.stderr.on('data', (chunk) => onOutput(chunk))
    child.once('error', rejectRun)
    child.once('exit', (code) => resolveRun(code ?? 1))
  })
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return

  if (process.platform === 'win32') {
    await new Promise((resolveKill) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.once('exit', resolveKill)
      killer.once('error', resolveKill)
    })
    return
  }

  child.kill('SIGTERM')
  await new Promise((resolveKill) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolveKill()
    }, 5_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolveKill()
    })
  })
}

async function fetchSmokePage(appBaseUrl, cookieHeader) {
  const headers = cookieHeader
    ? { cookie: cookieHeader, accept: 'text/html' }
    : { accept: 'text/html' }
  const response = await fetch(`${appBaseUrl}/auth-smoke`, { headers })
  const html = await response.text()
  assert(response.ok, `GET /auth-smoke returned ${response.status}`)
  return { html, response }
}

async function main() {
  const realBaseUrl = process.env.NEON_AUTH_BASE_URL?.trim()
  const realEmail = process.env.AUTH_HARNESS_EMAIL
  const realPassword = process.env.AUTH_HARNESS_PASSWORD

  if (useRealUpstream) {
    if (!realBaseUrl || !realEmail || !realPassword) {
      throw new Error(
        '--real needs NEON_AUTH_BASE_URL, AUTH_HARNESS_EMAIL and AUTH_HARNESS_PASSWORD',
      )
    }
  }

  const upstream = useRealUpstream ? null : await startFakeUpstream()
  const upstreamUrl = useRealUpstream ? realBaseUrl : upstream.url
  upstreamForRedaction = upstreamUrl

  const cookieSecret = randomBytes(32).toString('base64')
  secretForRedaction = cookieSecret
  assert(cookieSecret.length >= 32, 'generated cookie secret is too short')

  const appPort = await freePort()
  const appBaseUrl = `http://127.0.0.1:${appPort}`
  const origin = appBaseUrl

  let tempRoot
  let child
  let logs = ''

  try {
    log('copying the app to a temporary directory')
    tempRoot = await prepareApplication()

    log('starting the disposable dev server')
    child = spawn(
      process.execPath,
      [
        join(tempRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
        'dev',
        '--host',
        '127.0.0.1',
        '--port',
        String(appPort),
        '--strictPort',
      ],
      {
        cwd: tempRoot,
        env: {
          ...process.env,
          PORT: String(appPort),
          AUTH_HARNESS_NODE_MODULES: join(repoRoot, 'node_modules'),
          NEON_AUTH_BASE_URL: upstreamUrl,
          NEON_AUTH_COOKIE_SECRET: cookieSecret,
          NODE_ENV: 'development',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )

    child.stdout.on('data', (chunk) => {
      logs += chunk
      if (debug) process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      logs += chunk
      if (debug) process.stderr.write(chunk)
    })

    await waitForServer(`${appBaseUrl}/`, child, () => logs)

    const email = useRealUpstream ? realEmail : 'harness@example.test'
    const password = useRealUpstream ? realPassword : 'harness-password'

    log('signing in through the same-origin proxy')
    const signIn = await fetch(`${appBaseUrl}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email, password }),
    })
    assert(signIn.status === 200, `sign-in returned ${signIn.status}`)

    const jar = cookieJar().absorb(signIn)
    assert(jar.names().includes(SESSION_TOKEN_COOKIE), 'session token cookie was not set')
    assert(jar.names().includes(SESSION_DATA_COOKIE), 'session cache cookie was not set')

    log('reading the server function on a fresh page load')
    const firstLoad = await fetchSmokePage(appBaseUrl, jar.header())
    if (useRealUpstream) {
      assert(!firstLoad.html.includes('signed-out'), 'server function did not see the session')
    } else {
      assert(firstLoad.html.includes(FAKE_USER_ID), 'server function did not return the user id')
    }

    if (!useRealUpstream) {
      log('forcing an upstream session read through the server function')
      const tokenOnly = jar
        .header()
        .split('; ')
        .filter((pair) => pair.startsWith(`${SESSION_TOKEN_COOKIE}=`))
        .join('; ')
      const reviewed = await fetchSmokePage(appBaseUrl, tokenOnly)
      assert(reviewed.html.includes(FAKE_USER_ID), 'server function lost the session on upstream read')

      const refreshedCookies = reviewed.response.headers.getSetCookie()
      assert(
        refreshedCookies.some((cookie) => cookie.startsWith(SESSION_TOKEN_COOKIE)),
        'server function did not propagate the refreshed session token',
      )
      assert(
        refreshedCookies.some((cookie) => cookie.startsWith(SESSION_DATA_COOKIE)),
        'server function did not propagate the refreshed session cache',
      )
      jar.absorb(reviewed.response)
    }

    log('reloading with the same cookie jar (refresh)')
    const secondLoad = await fetchSmokePage(appBaseUrl, jar.header())
    if (useRealUpstream) {
      assert(!secondLoad.html.includes('signed-out'), 'session did not survive a refresh')
    } else {
      assert(secondLoad.html.includes(FAKE_USER_ID), 'session did not survive a refresh')
    }

    log('checking that a cookie-less request is signed out')
    const signedOut = await fetchSmokePage(appBaseUrl, null)
    assert(signedOut.html.includes('signed-out'), 'cookie-less request was not signed out')

    if (process.argv.includes('--build')) {
      log('building the disposable copy to check client import protection')
      await stopChild(child)
      child = undefined

      let buildLogs = ''
      const buildCode = await runProcess(
        process.execPath,
        [join(tempRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'],
        {
          cwd: tempRoot,
          env: {
            ...process.env,
            PORT: String(appPort),
            AUTH_HARNESS_NODE_MODULES: join(repoRoot, 'node_modules'),
            NEON_AUTH_BASE_URL: upstreamUrl,
            NEON_AUTH_COOKIE_SECRET: cookieSecret,
            NODE_ENV: 'production',
          },
        },
        (chunk) => {
          buildLogs += chunk
          if (debug) process.stdout.write(chunk)
        },
      )
      assert(buildCode === 0, `vite build failed (${buildCode})\n${redact(buildLogs)}`)
    }

    log('PASS: sign-in, refresh and server-side user id verified')
  } finally {
    if (child) await stopChild(child)
    if (upstream) await upstream.close()
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
    if (debug && logs) process.stdout.write(redact(logs))
  }
}

main().catch((error) => {
  console.error(`[auth-harness] FAIL: ${redact(error instanceof Error ? error.message : String(error))}`)
  process.exitCode = 1
})
