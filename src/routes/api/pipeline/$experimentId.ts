import { createFileRoute } from '@tanstack/react-router'

import { handlePipelineStream } from '../../../server/pipeline-delivery/production'

/**
 * The SSE read path. One request is one pipeline attempt (ADR 0003): it may
 * claim the experiment's single execution start, run the real planner, runner
 * and evaluator, open the approval gate, and poll `experiments.approval_state`
 * while the approval POST commits in its own request.
 */
export const Route = createFileRoute('/api/pipeline/$experimentId')({
  server: {
    handlers: {
      GET: ({ request, params }) => handlePipelineStream(request, params),
    },
  },
})
