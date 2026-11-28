import { createFileRoute } from '@tanstack/react-router'

import { handleRunArtifacts } from '../../../../server/run-artifacts-route'

/**
 * Authenticated read of a terminal run's persisted artifacts.
 *
 * `GET /api/runs/:runId/artifacts` returns the manifest;
 * `?artifact=<id>` or `?artifact=notebook` returns the verified bytes.
 * Workspace membership is proved before any row is returned, so a run id from
 * another tenant is a 403/404, never a download.
 */
export const Route = createFileRoute('/api/runs/$runId/artifacts')({
  server: {
    handlers: {
      GET: ({ request, params }) => handleRunArtifacts(request, params),
    },
  },
})
