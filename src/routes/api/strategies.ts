import { createFileRoute } from '@tanstack/react-router';
import { PREVIEW_AGENT_TASKS } from '../../utils/strategyClient';

/**
 * Strategy telemetry endpoint.
 * Serves recorded `agent_tasks` rows for strategy aggregation.
 */
export const Route = createFileRoute('/api/strategies')({
  server: {
    handlers: {
      GET: () => {
        return Response.json(
          {
            tasks: PREVIEW_AGENT_TASKS,
            source: 'preview',
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-cache',
            },
          },
        );
      },
    },
  },
});
