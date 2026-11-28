import { describe, expect, it } from 'vitest'

import { RunArtifactReadError } from './run-artifacts'
import {
  createRunArtifactHandler,
  type RunArtifactRouteDeps,
} from './run-artifacts-route'
import type { RunArtifactManifest } from '../shared/run-artifacts'

const RUN_ID = '11111111-1111-4111-8111-111111111111'
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'
const ARTIFACT_ID = '33333333-3333-4333-8333-333333333333'

function manifest(overrides: Partial<RunArtifactManifest> = {}): RunArtifactManifest {
  return {
    runId: RUN_ID,
    experimentId: '44444444-4444-4444-8444-444444444444',
    workspaceId: WORKSPACE_ID,
    attempt: 2,
    parentRunId: '55555555-5555-4555-8555-555555555555',
    status: 'succeeded',
    metrics: { score: 0.9 },
    verdict: 'match',
    artifacts: [
      {
        id: ARTIFACT_ID,
        kind: 'notebook',
        path: 'reproducibility-record.ipynb',
        sha256: 'a'.repeat(64),
        bytes: 12,
        hasContent: true,
        downloadUrl: `/api/runs/${RUN_ID}/artifacts?artifact=${ARTIFACT_ID}`,
      },
    ],
    ...overrides,
  }
}

function deps(overrides: Partial<RunArtifactRouteDeps> = {}): RunArtifactRouteDeps {
  return {
    loadManifest: async () => manifest(),
    readArtifact: async () => ({
      artifact: manifest().artifacts[0]!,
      bytes: Buffer.from('{"cells":[]}'),
    }),
    readActor: async () => ({ id: 'user-1' }),
    assertWorkspaceMember: async () => undefined,
    ...overrides,
  }
}

function request(path: string, method = 'GET'): Request {
  return new Request(`http://localhost${path}`, { method })
}

async function errorCode(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { error?: { code?: string } }
  return body.error?.code
}

describe('createRunArtifactHandler', () => {
  it('returns 401 for an anonymous request before looking up the run', async () => {
    let lookedUp = false
    const handler = createRunArtifactHandler(
      deps({
        readActor: async () => null,
        loadManifest: async () => {
          lookedUp = true
          return manifest()
        },
      }),
    )

    const response = await handler(request(`/api/runs/${RUN_ID}/artifacts`), {
      runId: RUN_ID,
    })

    expect(response.status).toBe(401)
    expect(await errorCode(response)).toBe('UNAUTHENTICATED')
    expect(lookedUp).toBe(false)
  })

  it('returns 400 for a non-UUID run id', async () => {
    const handler = createRunArtifactHandler(deps())
    const response = await handler(request('/api/runs/not-a-uuid/artifacts'), {
      runId: 'not-a-uuid',
    })

    expect(response.status).toBe(400)
    expect(await errorCode(response)).toBe('INVALID_RUN_ID')
  })

  it('returns 404 for a missing run', async () => {
    const handler = createRunArtifactHandler(deps({ loadManifest: async () => null }))
    const response = await handler(request(`/api/runs/${RUN_ID}/artifacts`), {
      runId: RUN_ID,
    })

    expect(response.status).toBe(404)
    expect(await errorCode(response)).toBe('RUN_NOT_FOUND')
  })

  it('answers 404 for a real run in another workspace, like a missing run', async () => {
    const handler = createRunArtifactHandler(
      deps({
        assertWorkspaceMember: async () => {
          throw Object.assign(new Error('denied'), { status: 403 })
        },
      }),
    )

    const response = await handler(request(`/api/runs/${RUN_ID}/artifacts`), {
      runId: RUN_ID,
    })

    // Same response as a missing run: this endpoint is not an existence oracle.
    expect(response.status).toBe(404)
    expect(await errorCode(response)).toBe('RUN_NOT_FOUND')
  })

  it('keeps a 5xx when membership cannot be checked at all', async () => {
    const handler = createRunArtifactHandler(
      deps({
        assertWorkspaceMember: async () => {
          throw Object.assign(new Error('auth down'), { status: 503 })
        },
      }),
    )

    const response = await handler(request(`/api/runs/${RUN_ID}/artifacts`), {
      runId: RUN_ID,
    })

    expect(response.status).toBe(502)
    expect(await errorCode(response)).toBe('AUTH_UNAVAILABLE')
  })

  it('returns the manifest with no-store headers for a member', async () => {
    const handler = createRunArtifactHandler(deps())
    const response = await handler(request(`/api/runs/${RUN_ID}/artifacts`), {
      runId: RUN_ID,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    const body = (await response.json()) as RunArtifactManifest
    expect(body.attempt).toBe(2)
    expect(body.parentRunId).toBe('55555555-5555-4555-8555-555555555555')
    expect(body.artifacts).toHaveLength(1)
  })

  it('returns notebook bytes as an attachment', async () => {
    const handler = createRunArtifactHandler(deps())
    const response = await handler(
      request(`/api/runs/${RUN_ID}/artifacts?artifact=notebook`),
      { runId: RUN_ID },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/x-ipynb+json; charset=utf-8',
    )
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="reproducibility-record.ipynb"',
    )
    expect(await response.text()).toBe('{"cells":[]}')
  })

  it('maps an invalid artifact selector to 400', async () => {
    const handler = createRunArtifactHandler(
      deps({
        readArtifact: async () => {
          throw new RunArtifactReadError('INVALID_ARTIFACT_ID', 'bad selector')
        },
      }),
    )

    const response = await handler(
      request(`/api/runs/${RUN_ID}/artifacts?artifact=../../etc/passwd`),
      { runId: RUN_ID },
    )

    expect(response.status).toBe(400)
    expect(await errorCode(response)).toBe('INVALID_ARTIFACT_ID')
  })

  it('maps metadata-only artifacts to 409', async () => {
    const handler = createRunArtifactHandler(
      deps({
        readArtifact: async () => {
          throw new RunArtifactReadError(
            'ARTIFACT_CONTENT_MISSING',
            'no inline bytes',
          )
        },
      }),
    )

    const response = await handler(
      request(`/api/runs/${RUN_ID}/artifacts?artifact=${ARTIFACT_ID}`),
      { runId: RUN_ID },
    )

    expect(response.status).toBe(409)
    expect(await errorCode(response)).toBe('ARTIFACT_CONTENT_MISSING')
  })

  it('does not stream an integrity failure detail', async () => {
    const handler = createRunArtifactHandler(
      deps({
        readArtifact: async () => {
          throw new RunArtifactReadError(
            'ARTIFACT_INTEGRITY',
            'sha256 mismatch: secret detail',
          )
        },
      }),
    )

    const response = await handler(
      request(`/api/runs/${RUN_ID}/artifacts?artifact=${ARTIFACT_ID}`),
      { runId: RUN_ID },
    )

    expect(response.status).toBe(500)
    const body = (await response.json()) as { error: { message: string } }
    expect(body.error.message).toBe(
      'The stored artifact failed its integrity check',
    )
    expect(JSON.stringify(body)).not.toContain('secret detail')
  })

  it('rejects a non-GET method', async () => {
    const handler = createRunArtifactHandler(deps())
    const response = await handler(
      request(`/api/runs/${RUN_ID}/artifacts`, 'POST'),
      { runId: RUN_ID },
    )

    expect(response.status).toBe(405)
    expect(await errorCode(response)).toBe('METHOD_NOT_ALLOWED')
  })
})
