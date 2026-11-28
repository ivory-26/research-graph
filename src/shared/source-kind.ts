/**
 * Authoritative source-kind inference.
 *
 * The client may suggest a kind, but only the URL decides whether an ingested
 * source is a repository. A pure function so the route, the UI and the tests
 * agree without importing anything server-side.
 */

export type InferredSourceKind = 'web' | 'repo'

const REPOSITORY_HOSTS = [
  'github.com',
  'gitlab.com',
  'bitbucket.org',
  'codeberg.org',
] as const

function normaliseHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '')
}

function isRepositoryHost(hostname: string): boolean {
  const host = normaliseHost(hostname)
  return REPOSITORY_HOSTS.some(
    (repositoryHost) =>
      host === repositoryHost || host.endsWith(`.${repositoryHost}`),
  )
}

function isRepositoryPath(pathname: string): boolean {
  const path = pathname.toLowerCase().replace(/\/+$/, '')
  return path.endsWith('.git')
}

export function inferSourceKind(url: string): InferredSourceKind {
  const trimmed = url.trim()
  if (!trimmed) return 'web'

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return isRepositoryPath(trimmed) ? 'repo' : 'web'
  }

  if (isRepositoryHost(parsed.hostname) || isRepositoryPath(parsed.pathname)) {
    return 'repo'
  }
  return 'web'
}
