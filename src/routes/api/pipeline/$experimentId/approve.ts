import { createFileRoute } from '@tanstack/react-router'

import { handlePipelineApproval } from '../../../../server/pipeline-delivery/production'

/**
 * The approval write path. Authenticated (#4), origin-checked, workspace
 * scoped, and bound to the persisted `approval.requested` seq. It never runs
 * a stage or a sandbox.
 */
export const Route = createFileRoute('/api/pipeline/$experimentId/approve')({
  server: {
    handlers: {
      POST: ({ request, params }) => handlePipelineApproval(request, params),
    },
  },
})
