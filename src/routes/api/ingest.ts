import { createFileRoute } from '@tanstack/react-router'
import { ingestSourceIntoGraph } from '../../server/pipelineBridge'

export const Route = createFileRoute('/api/ingest')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}))
          const title = typeof body?.title === 'string' ? body.title : 'Ingested Paper'
          const kind = (body?.kind as 'web' | 'repo' | 'pdf') || 'pdf'
          const url = typeof body?.url === 'string' ? body.url : undefined
          const result = ingestSourceIntoGraph({ title, kind, url })
          return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (error) {
          return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Ingestion failed' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }
      },
    },
  },
})
