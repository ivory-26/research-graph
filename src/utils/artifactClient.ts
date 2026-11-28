/**
 * Browser client for the authorized artifact endpoint.
 *
 * `runArtifactManifestPath` and `runArtifactDownloadPath` live in
 * `src/shared/run-artifacts.ts` so the server route and this client cannot
 * disagree about the URL. This module only performs the request and turns the
 * server's `{ error: { code, message } }` envelope into a readable message.
 */
import {
  runArtifactDownloadPath,
  runArtifactManifestPath,
  type RunArtifactManifest,
} from '../shared/run-artifacts'

export type FetchRunArtifactsResult =
  | { ok: true; manifest: RunArtifactManifest }
  | { ok: false; status: number; error: string; code?: string }

function readErrorBody(payload: unknown): { code?: string; message?: string } {
  if (!payload || typeof payload !== 'object') return {}
  const record = payload as Record<string, unknown>
  const error = record.error

  if (typeof error === 'string' && error.trim().length > 0) {
    return { message: error }
  }
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const envelope = error as Record<string, unknown>
    return {
      code:
        typeof envelope.code === 'string' && envelope.code.trim().length > 0
          ? envelope.code
          : undefined,
      message:
        typeof envelope.message === 'string' &&
        envelope.message.trim().length > 0
          ? envelope.message
          : undefined,
    }
  }
  return {}
}

/**
 * Loads one run's artifact manifest. A 404 means the run does not exist or its
 * workspace cannot be proven to belong to this session: the server answers
 * `404 RUN_NOT_FOUND` for both a missing run and a non-member, so neither case
 * leaks which one it was. Not retried.
 */
export async function fetchRunArtifactManifest(
  runId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchRunArtifactsResult> {
  if (!runId || runId.trim().length === 0) {
    return { ok: false, status: 400, error: 'runId is required' }
  }

  try {
    const response = await fetchImpl(runArtifactManifestPath(runId), {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })

    const contentType = response.headers.get('content-type') ?? ''
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : null

    if (!response.ok) {
      const { code, message } = readErrorBody(payload)
      return {
        ok: false,
        status: response.status,
        error: message ?? `HTTP ${response.status}: ${response.statusText}`,
        code,
      }
    }

    if (
      !payload ||
      typeof payload !== 'object' ||
      !Array.isArray((payload as RunArtifactManifest).artifacts)
    ) {
      return {
        ok: false,
        status: response.status,
        error: 'The artifact manifest was not valid JSON',
      }
    }

    return { ok: true, manifest: payload as RunArtifactManifest }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Same-origin download URL for one artifact row. */
export function artifactDownloadUrl(runId: string, artifactId: string): string {
  return runArtifactDownloadPath(runId, artifactId)
}

/**
 * Starts a browser download without buffering the artifact in JS memory. The
 * endpoint is same-origin, so the session cookie travels with the request and
 * `Content-Disposition` supplies the filename.
 */
export function downloadRunArtifact(
  runId: string,
  artifactId: string,
  doc: Document = document,
): void {
  const anchor = doc.createElement('a')
  anchor.href = artifactDownloadUrl(runId, artifactId)
  anchor.rel = 'noopener'
  anchor.download = ''
  doc.body.appendChild(anchor)
  anchor.click()
  doc.body.removeChild(anchor)
}
