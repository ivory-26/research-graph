import { describe, expect, it, vi } from 'vitest'

import {
  artifactDownloadUrl,
  fetchRunArtifactManifest,
} from './artifactClient'
import type { RunArtifactManifest } from '../shared/run-artifacts'

const RUN_ID = '11111111-1111-4111-8111-111111111111'
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222'

const MANIFEST: RunArtifactManifest = {
  runId: RUN_ID,
  experimentId: '33333333-3333-4333-8333-333333333333',
  workspaceId: '44444444-4444-4444-8444-444444444444',
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
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('fetchRunArtifactManifest', () => {
  it('requests the run-scoped manifest with same-origin credentials', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(MANIFEST))

    const result = await fetchRunArtifactManifest(RUN_ID, fetchImpl as unknown as typeof fetch)

    expect(result).toEqual({ ok: true, manifest: MANIFEST })
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/runs/${RUN_ID}/artifacts`,
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
      }),
    )
  })

  it('surfaces the server code and sentence for a refusal', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: 'WORKSPACE_ACCESS_DENIED',
            message: 'Workspace membership required',
          },
        },
        403,
      ),
    )

    const result = await fetchRunArtifactManifest(RUN_ID, fetchImpl as unknown as typeof fetch)

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'Workspace membership required',
      code: 'WORKSPACE_ACCESS_DENIED',
    })
  })

  it('does not treat a non-array artifacts payload as a manifest', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ runId: RUN_ID }))

    const result = await fetchRunArtifactManifest(RUN_ID, fetchImpl as unknown as typeof fetch)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('not valid JSON')
  })

  it('rejects an empty run id without a request', async () => {
    const fetchImpl = vi.fn()

    const result = await fetchRunArtifactManifest('', fetchImpl as unknown as typeof fetch)

    expect(result).toEqual({ ok: false, status: 400, error: 'runId is required' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('artifactDownloadUrl', () => {
  it('encodes the selector into the same route the server mounts', () => {
    expect(artifactDownloadUrl(RUN_ID, 'notebook')).toBe(
      `/api/runs/${RUN_ID}/artifacts?artifact=notebook`,
    )
  })
})
