import { extractNeonAuthCookies } from '@neon/auth/server'

import {
  createAppAuthServer,
  normalizeSessionUser,
  readAuthConfig,
} from '../../src/server/auth.server.ts'

/**
 * `extractNeonAuthCookies` returns a serialized `Cookie:` header string (not a
 * `Map`), filtered to the Neon Auth cookie prefix. Parse it into a jar so the
 * SDK's `setCookie` calls can refresh a cookie between calls in this process.
 */
function parseCookieHeader(header: string): Map<string, string> {
  const cookies = new Map<string, string>()
  for (const pair of header.split(';')) {
    const entry = pair.trim()
    const separator = entry.indexOf('=')
    if (separator <= 0) continue
    cookies.set(entry.slice(0, separator), entry.slice(separator + 1))
  }
  return cookies
}

function serializeCookieJar(cookies: Map<string, string>): string {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
}

/** Resolve the operator from the live Neon Auth session, including at each gate. */
export function createSeedSession(env: NodeJS.ProcessEnv) {
  const cookie = env.SEED_AUTH_COOKIE?.trim()
  if (!cookie) {
    throw new Error('SEED_AUTH_COOKIE must contain a signed-in workspace account session.')
  }

  const config = readAuthConfig(env)
  const headers = new Headers({ cookie })
  const cookies = parseCookieHeader(extractNeonAuthCookies(headers))
  const auth = createAppAuthServer(config, () => ({
    getCookies: () => serializeCookieJar(cookies),
    setCookie: (name, value) => {
      cookies.set(name, value)
    },
    getHeader: (name) => headers.get(name),
    getOrigin: () => new URL(config.baseUrl).origin,
    getFramework: () => 'seed-cli',
  }))
  return async () => {
    const { data, error } = await auth.getSession({ query: { disableCookieCache: true } })
    const user = error ? null : normalizeSessionUser(data)
    if (!user) throw new Error('Neon Auth could not verify the workspace account session.')
    return user
  }
}
