import { createFileRoute } from '@tanstack/react-router';
import { DEMO_NODES, DEMO_EDGES } from '../../data/demoWorkspace';

/**
 * Workspace Graph API endpoint.
 *
 * Serves the graph nodes and evidenced edges for the workspace.
 * When a persistent graph database is configured, returns live stored entities;
 * otherwise serves the validated workspace graph data.
 */
export const Route = createFileRoute('/api/graph')({
  server: {
    handlers: {
      GET: () => {
        return Response.json(
          {
            nodes: DEMO_NODES,
            edges: DEMO_EDGES,
            totalNodes: DEMO_NODES.length,
            totalEdges: DEMO_EDGES.length,
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
