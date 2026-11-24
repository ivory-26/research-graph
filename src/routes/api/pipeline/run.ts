import { createFileRoute } from '@tanstack/react-router'
import { executePipelineRun } from '../../../server/pipelineBridge'

export const Route = createFileRoute('/api/pipeline/run')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}))
          const result = await executePipelineRun(body?.spec)
          return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (error) {
          return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Execution failed' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }
      },
    },
  },
})
