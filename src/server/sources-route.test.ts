import { describe, expect, it, vi } from 'vitest'

import { Route } from '../routes/api/sources.ts'

const state = vi.hoisted(() => ({
  captured: null as Record<string, unknown> | null,
}))

vi.mock('../db/client', () => ({
  getDb: () => ({}),
}))

vi.mock('./auth/workspace.server', () => ({
  requireWorkspaceAccess: async (_request: Request, workspaceId: string) => ({
    workspaceId,
  }),
}))

vi.mock('./extract/pipeline', () => ({
  ingestSourceToGraphForWorkspace: async (options: Record<string, unknown>) => {
    state.captured = options
    return {
      source: {
        id: 'source-ui-1',
        kind: 'repo',
        title: 'ranger project page',
        url: 'https://github.com/imbs-hl/ranger',
        doi: null,
        sha256: 'a'.repeat(64),
        bytes: 10,
        meta: {},
        createdAt: new Date(),
      },
      chunks: [],
      chunkCount: 0,
      needsOcr: false,
      extraction: {
        acceptedClaims: [],
        rejectedClaims: [],
        datasets: [],
        methods: [],
        codeUrls: [],
      },
      createdNodes: [],
      allNodes: [],
      edges: { acceptedEdges: [], rejectedEdges: [], persisted: false },
    }
  },
}))

const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'

function getPostHandler() {
  return (Route as unknown as {
    options: {
      server: {
        handlers: { POST: (ctx: { request: Request }) => Promise<Response> }
      }
    }
  }).options.server.handlers.POST
}

describe('POST /api/sources', () => {
  it('does not attribute the ingestion batch to an invented run id', async () => {
    const response = await getPostHandler()({
      request: new Request('http://localhost/api/sources', {
        method: 'POST',
        headers: {
          origin: 'http://localhost',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          kind: 'repo',
          url: 'https://github.com/imbs-hl/ranger',
        }),
      }),
    })

    expect(response.status).toBe(201)
    const captured = state.captured
    expect(captured).not.toBeNull()
    expect(captured).not.toHaveProperty('runId')
    expect(captured).toMatchObject({
      workspaceId: WORKSPACE_ID,
      runLabel: 'ui:repo',
      source: {
        kind: 'web',
        url: 'https://github.com/imbs-hl/ranger',
        sourceKind: 'repo',
      },
    })
  })
})
