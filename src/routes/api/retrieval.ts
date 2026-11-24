import { createFileRoute } from '@tanstack/react-router'
import { queryRetrieval } from '../../server/pipelineBridge'

export const Route = createFileRoute('/api/retrieval')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}))
          const question = typeof body?.question === 'string' ? body.question : ''
          const result = queryRetrieval(question)
          return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (error) {
          return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Retrieval failed' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }
      },
    },
  },
})
