/**
 * Focused regression tests for the server half of issue #4.
 *
 * These run against a local fake Neon Auth upstream. They deliberately do not
 * touch Neon: no user is created and no project setting changes. The real
 * service check is `scripts/auth-smoke.mjs` (see docs/08-auth.md).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  AuthConfigurationError,
  completeOAuthCallback,
  enforceWorkspaceMembership,
  handleAuthRequest,
  normalizeAuthPath,
  normalizeSessionUser,
  readAuthConfig,
  WorkspaceAccessDeniedError,
  type WorkspaceMembership,
} from './auth.server'

// ---------------------------------------------------------------------------
// Fake Neon Auth upstream
// ---------------------------------------------------------------------------

const SESSION_TOKEN_COOKIE = '__Secure-neon-auth.session_token'
const SESSION_DATA_COOKIE = '__Secure-neon-auth.local.session_data'
const SESSION_CHALLENGE_COOKIE = '__Secure-neon-auth.session_challenge'
const TEST_COOKIE_SECRET = 'test-only-cookie-secret-0123456789abcdef'
const APP_ORIGIN = 'http://localhost:3000'

type CapturedRequest = {
  method: string
  url: string
  cookie: string | null
  origin: string | null
  body: string
}

const captured: CapturedRequest[] = []
let upstream: Server
let upstreamBaseUrl: string

function sessionPayload() {
  const now = new Date().toISOString()
  return {
    user: {
      id: 'user-1',
      email: 'person@example.test',
      name: 'Person',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
      // Must never survive normalization into CurrentUser.
      access_token: 'upstream-token-must-not-leak',
    },
    session: {
      id: 'session-1',
      userId: 'user-1',
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      access_token: 'upstream-token-must-not-leak',
    },
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function json(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string | string[]> = {},
) {
  response.writeHead(status, { 'content-type': 'application/json', ...headers })
  response.end(typeof body === 'string' ? body : JSON.stringify(body))
}

beforeAll(async () => {
  upstream = createServer(async (request, response) => {
    const body = await readBody(request)
    captured.push({
      method: request.method ?? '',
      url: request.url ?? '',
      cookie: request.headers.cookie ?? null,
      origin: (request.headers.origin as string | undefined) ?? null,
      body,
    })

    if (request.method === 'GET' && request.url?.startsWith('/get-session')) {
      const cookie = request.headers.cookie ?? ''
      const verifier = new URL(request.url, 'http://127.0.0.1').searchParams.get(
        'neon_auth_session_verifier',
      )

      // A real OAuth return carries a single-use verifier plus the challenge
      // cookie. A `bad` verifier simulates a failed exchange.
      if (verifier && cookie.includes(SESSION_CHALLENGE_COOKIE)) {
        if (verifier === 'bad') {
          json(response, 500, { error: 'verification failed' })
        } else {
          json(response, 200, sessionPayload(), {
            'set-cookie': [
              `${SESSION_TOKEN_COOKIE}=session-token; Path=/; HttpOnly; Secure; SameSite=None`,
            ],
          })
        }
        return
      }

      if (cookie.includes(`${SESSION_TOKEN_COOKIE}=session-token`)) {
        json(response, 200, sessionPayload())
      } else {
        json(response, 200, null)
      }
      return
    }

    if (request.method === 'POST' && request.url === '/sign-in/email') {
      json(response, 200, sessionPayload(), {
        'set-cookie': [
          `${SESSION_TOKEN_COOKIE}=session-token; Path=/; HttpOnly; Secure; SameSite=None`,
        ],
      })
      return
    }

    if (request.method === 'POST' && request.url === '/sign-out') {
      json(response, 200, { success: true }, {
        'set-cookie': [
          `${SESSION_TOKEN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`,
        ],
      })
      return
    }

    json(response, 404, { error: 'not found upstream' })
  })

  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const address = upstream.address() as AddressInfo
  upstreamBaseUrl = `http://127.0.0.1:${address.port}`

  process.env.NEON_AUTH_BASE_URL = upstreamBaseUrl
  process.env.NEON_AUTH_COOKIE_SECRET = TEST_COOKIE_SECRET
})

afterAll(async () => {
  delete process.env.NEON_AUTH_BASE_URL
  delete process.env.NEON_AUTH_COOKIE_SECRET
  await new Promise<void>((resolve, reject) =>
    upstream.close((error) => (error ? reject(error) : resolve())),
  )
})

afterEach(() => {
  captured.length = 0
})

function cookieHeaderFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(';', 1)[0])
    .join('; ')
}

function setCookieNames(response: Response): string[] {
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split('=', 1)[0])
}

// ---------------------------------------------------------------------------
// Session normalization
// ---------------------------------------------------------------------------

describe('normalizeSessionUser', () => {
  it('treats a null, empty or id-less session as signed out', () => {
    expect(normalizeSessionUser(null)).toBeNull()
    expect(normalizeSessionUser(undefined)).toBeNull()
    expect(
      normalizeSessionUser({ session: null, user: null }),
    ).toBeNull()
    expect(
      normalizeSessionUser({
        session: { id: 'session-1' },
        user: { id: '   ' },
      } as never),
    ).toBeNull()
    expect(normalizeSessionUser({ session: null, user: { id: 'user-1' } } as never)).toBeNull()
    expect(normalizeSessionUser({
      session: { userId: 'user-2' },
      user: { id: 'user-1' },
    } as never)).toBeNull()
  })

  it('returns only id, email and name', () => {
    const user = normalizeSessionUser(sessionPayload() as never)

    expect(user).toEqual({
      id: 'user-1',
      email: 'person@example.test',
      name: 'Person',
    })
    expect(Object.keys(user ?? {}).sort()).toEqual(['email', 'id', 'name'])
    expect(JSON.stringify(user)).not.toContain('upstream-token-must-not-leak')
  })
})

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

describe('readAuthConfig', () => {
  it('rejects a missing base URL without echoing env contents', () => {
    expect(() =>
      readAuthConfig({ NEON_AUTH_COOKIE_SECRET: TEST_COOKIE_SECRET }),
    ).toThrowError(new AuthConfigurationError('NEON_AUTH_BASE_URL is not set'))
  })

  it('rejects plain http outside loopback', () => {
    expect(() =>
      readAuthConfig({
        NEON_AUTH_BASE_URL: 'http://auth.example.test/neondb/auth',
        NEON_AUTH_COOKIE_SECRET: TEST_COOKIE_SECRET,
      }),
    ).toThrowError(AuthConfigurationError)
  })

  it('rejects a base URL with a query string or embedded credentials', () => {
    expect(() =>
      readAuthConfig({
        NEON_AUTH_BASE_URL: 'https://auth.example.test/neondb/auth?x=1',
        NEON_AUTH_COOKIE_SECRET: TEST_COOKIE_SECRET,
      }),
    ).toThrowError(AuthConfigurationError)

    expect(() =>
      readAuthConfig({
        NEON_AUTH_BASE_URL: 'https://user:pass@auth.example.test/neondb/auth',
        NEON_AUTH_COOKIE_SECRET: TEST_COOKIE_SECRET,
      }),
    ).toThrowError(AuthConfigurationError)
  })

  it('rejects a cookie secret shorter than 32 characters', () => {
    expect(() =>
      readAuthConfig({
        NEON_AUTH_BASE_URL: 'https://auth.example.test/neondb/auth',
        NEON_AUTH_COOKIE_SECRET: 'too-short',
      }),
    ).toThrowError(AuthConfigurationError)
  })

  it('accepts https and loopback http, trimming trailing slashes', () => {
    expect(
      readAuthConfig({
        NEON_AUTH_BASE_URL: 'https://auth.example.test/neondb/auth///',
        NEON_AUTH_COOKIE_SECRET: TEST_COOKIE_SECRET,
      }),
    ).toEqual({
      baseUrl: 'https://auth.example.test/neondb/auth',
      cookieSecret: TEST_COOKIE_SECRET,
    })

    expect(
      readAuthConfig({
        NEON_AUTH_BASE_URL: upstreamBaseUrl,
        NEON_AUTH_COOKIE_SECRET: TEST_COOKIE_SECRET,
      }).baseUrl,
    ).toBe(upstreamBaseUrl)
  })
})

// ---------------------------------------------------------------------------
// Auth path routing
// ---------------------------------------------------------------------------

describe('normalizeAuthPath', () => {
  it('accepts the endpoint paths Better Auth uses', () => {
    expect(normalizeAuthPath('get-session')).toBe('get-session')
    expect(normalizeAuthPath('/sign-in/email')).toBe('sign-in/email')
    expect(normalizeAuthPath('callback/google')).toBe('callback/google')
    expect(normalizeAuthPath('organization/accept-invitation')).toBe(
      'organization/accept-invitation',
    )
  })

  it('rejects empty, traversal and query-bearing paths', () => {
    expect(normalizeAuthPath('')).toBeNull()
    expect(normalizeAuthPath('/')).toBeNull()
    expect(normalizeAuthPath('../admin')).toBeNull()
    expect(normalizeAuthPath('sign-in/../admin')).toBeNull()
    expect(normalizeAuthPath('%2e%2e/admin')).toBeNull()
    expect(normalizeAuthPath('get-session?x=1')).toBeNull()
    expect(normalizeAuthPath('get-session#fragment')).toBeNull()
    expect(normalizeAuthPath('sign-in\\email')).toBeNull()
    expect(normalizeAuthPath('a//b')).toBeNull()
    expect(normalizeAuthPath('x'.repeat(513))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Same-origin proxy: sign-in, cookie propagation, refresh, signed-out
// ---------------------------------------------------------------------------

describe('handleAuthRequest', () => {
  it('proxies sign-in, forwards only Neon cookies and mints the session cache', async () => {
    const response = await handleAuthRequest(
      new Request(`${APP_ORIGIN}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: APP_ORIGIN,
          cookie: `app_session=must-not-reach-auth; ${SESSION_TOKEN_COOKIE}=previous-token`,
        },
        body: JSON.stringify({
          email: 'person@example.test',
          password: 'not-a-real-password',
        }),
      }),
      'sign-in/email',
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store, private')
    expect(response.headers.get('vary')).toBe('Cookie')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')

    const names = setCookieNames(response)
    expect(names).toContain(SESSION_TOKEN_COOKIE)
    expect(names).toContain(SESSION_DATA_COOKIE)

    // Every proxied cookie is Secure and SameSite=lax, regardless of upstream.
    for (const cookie of response.headers.getSetCookie()) {
      expect(cookie).toContain('Secure')
      expect(cookie.toLowerCase()).toContain('samesite=lax')
    }

    const signIn = captured.find((entry) => entry.url === '/sign-in/email')
    expect(signIn).toBeDefined()
    expect(signIn?.method).toBe('POST')
    expect(JSON.parse(signIn?.body ?? '{}')).toEqual({
      email: 'person@example.test',
      password: 'not-a-real-password',
    })
    expect(signIn?.origin).toBe(APP_ORIGIN)

    // The app's own cookie is not forwarded to the identity provider.
    expect(signIn?.cookie).toBe(`${SESSION_TOKEN_COOKIE}=previous-token`)
    expect(signIn?.cookie).not.toContain('app_session')
  })

  it('keeps the session across a refresh and reads the user id', async () => {
    const signIn = await handleAuthRequest(
      new Request(`${APP_ORIGIN}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: APP_ORIGIN },
        body: JSON.stringify({ email: 'person@example.test', password: 'x' }),
      }),
      'sign-in/email',
    )
    const jar = cookieHeaderFrom(signIn)
    expect(jar).toContain(`${SESSION_TOKEN_COOKIE}=session-token`)
    expect(jar).toContain(`${SESSION_DATA_COOKIE}=`)

    captured.length = 0

    const refreshed = await handleAuthRequest(
      new Request(`${APP_ORIGIN}/api/auth/get-session`, {
        headers: { cookie: jar },
      }),
      'get-session',
    )

    expect(refreshed.status).toBe(200)
    const body = (await refreshed.json()) as { user?: { id?: string } } | null
    expect(body?.user?.id).toBe('user-1')

    // The signed session cache answered without another upstream round trip.
    expect(captured).toHaveLength(0)
  })

  it('re-mints the session cache from a valid session token', async () => {
    const response = await handleAuthRequest(
      new Request(`${APP_ORIGIN}/api/auth/get-session`, {
        headers: { cookie: `${SESSION_TOKEN_COOKIE}=session-token` },
      }),
      'get-session',
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { user?: { id?: string } } | null
    expect(body?.user?.id).toBe('user-1')
    expect(setCookieNames(response)).toContain(SESSION_DATA_COOKIE)
    expect(captured.some((entry) => entry.url?.startsWith('/get-session'))).toBe(true)
  })

  it('returns the upstream signed-out payload when there is no session', async () => {
    const response = await handleAuthRequest(
      new Request(`${APP_ORIGIN}/api/auth/get-session`),
      'get-session',
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toBeNull()
    expect(response.headers.getSetCookie()).toHaveLength(0)
  })

  it('preserves the query string for OAuth callbacks', async () => {
    const response = await handleAuthRequest(
      new Request(`${APP_ORIGIN}/api/auth/callback/google?code=abc&state=xyz`),
      'callback/google',
    )

    expect(response.status).toBe(404) // fake upstream only knows sign-in/get-session
    expect(captured.some((entry) => entry.url === '/callback/google?code=abc&state=xyz')).toBe(true)
  })

  it('rejects unsupported methods and invalid paths without calling upstream', async () => {
    const methodResponse = await handleAuthRequest(
      new Request(`${APP_ORIGIN}/api/auth/get-session`, { method: 'OPTIONS' }),
      'get-session',
    )
    expect(methodResponse.status).toBe(405)
    expect(methodResponse.headers.get('allow')).toBe('GET, POST, PUT, PATCH, DELETE')

    const pathResponse = await handleAuthRequest(
      new Request(`${APP_ORIGIN}/api/auth/../admin`),
      '../admin',
    )
    expect(pathResponse.status).toBe(404)

    expect(captured).toHaveLength(0)
  })

  it('fails closed with a generic 500 when configuration is missing', async () => {
    const baseUrl = process.env.NEON_AUTH_BASE_URL
    const secret = process.env.NEON_AUTH_COOKIE_SECRET
    delete process.env.NEON_AUTH_BASE_URL
    delete process.env.NEON_AUTH_COOKIE_SECRET

    try {
      const response = await handleAuthRequest(
        new Request(`${APP_ORIGIN}/api/auth/get-session`),
        'get-session',
      )
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({
        error: 'Authentication is not configured',
      })
      expect(captured).toHaveLength(0)
    } finally {
      process.env.NEON_AUTH_BASE_URL = baseUrl
      process.env.NEON_AUTH_COOKIE_SECRET = secret
    }
  })
})

// ---------------------------------------------------------------------------
// OAuth callback: exchange the verifier before the guard sees the request
// ---------------------------------------------------------------------------

describe('completeOAuthCallback', () => {
  const challenge = `${SESSION_CHALLENGE_COOKIE}=challenge-abc`

  it('ignores requests without a verifier', async () => {
    const response = await completeOAuthCallback(
      new Request(`${APP_ORIGIN}/`, { headers: { cookie: challenge } }),
    )

    expect(response).toBeNull()
    expect(captured).toHaveLength(0)
  })

  it('exchanges the verifier, clears it from the URL and returns the session', async () => {
    const response = await completeOAuthCallback(
      new Request(
        `${APP_ORIGIN}/?neon_auth_session_verifier=verifier-123&page=graph`,
        { headers: { cookie: challenge } },
      ),
    )

    expect(response).not.toBeNull()
    expect(response?.status).toBe(302)
    expect(response?.headers.get('location')).toBe(`${APP_ORIGIN}/?page=graph`)
    expect(response?.headers.get('cache-control')).toBe('no-store')

    const setCookies = response?.headers.getSetCookie() ?? []
    expect(
      setCookies.some((entry) => entry.startsWith(`${SESSION_TOKEN_COOKIE}=`)),
    ).toBe(true)

    // The verifier reached the upstream session endpoint exactly once.
    const exchange = captured.find(
      (request) =>
        request.method === 'GET' &&
        request.url?.startsWith('/get-session') &&
        request.url.includes('neon_auth_session_verifier=verifier-123'),
    )
    expect(exchange).toBeDefined()
  })

  it('never intercepts the same-origin auth proxy', async () => {
    const response = await completeOAuthCallback(
      new Request(
        `${APP_ORIGIN}/api/auth/get-session?neon_auth_session_verifier=verifier-123`,
        { headers: { cookie: challenge } },
      ),
    )

    expect(response).toBeNull()
    expect(captured).toHaveLength(0)
  })

  it('falls back to sign-in when the verifier cannot be exchanged', async () => {
    const response = await completeOAuthCallback(
      new Request(`${APP_ORIGIN}/?neon_auth_session_verifier=bad`, {
        headers: { cookie: challenge },
      }),
    )

    expect(response?.status).toBe(302)
    const location = new URL(response?.headers.get('location') ?? '')
    expect(location.pathname).toBe('/sign-in')
    expect(location.searchParams.get('redirect')).toBe('/')
    expect(location.searchParams.has('neon_auth_session_verifier')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Workspace membership: explicit row or no access
// ---------------------------------------------------------------------------

function membership(overrides: Partial<WorkspaceMembership> = {}): WorkspaceMembership {
  return {
    workspaceId: 'workspace-1',
    userId: 'user-1',
    role: 'owner',
    ...overrides,
  }
}

describe('enforceWorkspaceMembership', () => {
  it('denies when the lookup finds no row', async () => {
    await expect(
      enforceWorkspaceMembership(
        { userId: 'user-1', workspaceId: 'workspace-1' },
        () => null,
      ),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError)
  })

  it('denies a row for another user or workspace', async () => {
    await expect(
      enforceWorkspaceMembership(
        { userId: 'user-1', workspaceId: 'workspace-1' },
        () => membership({ userId: 'user-2' }),
      ),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError)

    await expect(
      enforceWorkspaceMembership(
        { userId: 'user-1', workspaceId: 'workspace-1' },
        () => membership({ workspaceId: 'workspace-2' }),
      ),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError)
  })

  it('denies an empty role instead of inventing one', async () => {
    await expect(
      enforceWorkspaceMembership(
        { userId: 'user-1', workspaceId: 'workspace-1' },
        () => membership({ role: '   ' }),
      ),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError)
  })

  it('denies when the lookup throws and does not leak its error', async () => {
    const failure = enforceWorkspaceMembership(
      { userId: 'user-1', workspaceId: 'workspace-1' },
      () => {
        throw new Error('database password is hunter2')
      },
    )

    await expect(failure).rejects.toBeInstanceOf(WorkspaceAccessDeniedError)
    await expect(failure).rejects.not.toThrowError(/hunter2/)
  })

  it('denies missing identifiers', async () => {
    await expect(
      enforceWorkspaceMembership({ userId: '', workspaceId: 'workspace-1' }, () => membership()),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError)

    await expect(
      enforceWorkspaceMembership({ userId: 'user-1', workspaceId: '  ' }, () => membership()),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError)
  })

  it('allows the exact membership row', async () => {
    const calls: Array<{ userId: string; workspaceId: string }> = []
    const lookup = (input: { userId: string; workspaceId: string }) => {
      calls.push(input)
      return membership({ userId: input.userId, workspaceId: input.workspaceId })
    }

    await expect(
      enforceWorkspaceMembership({ userId: ' user-1 ', workspaceId: ' workspace-1 ' }, lookup),
    ).resolves.toEqual({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'owner',
    })
    expect(calls).toEqual([{ userId: 'user-1', workspaceId: 'workspace-1' }])
  })
})
