import { DEMO_NODES, DEMO_EDGES } from '../data/demoWorkspace';
import type { WorkspaceNode, WorkspaceEdge } from '../data/demoWorkspace';

export const GRAPH_POSITIONS_STORAGE_KEY = 'rg_node_positions';

export type PositionMap = Record<string, { x: number; y: number }>;

/**
 * Loads user-dragged node coordinates from localStorage.
 */
export function loadPersistedPositions(
  storage: Storage | null = typeof window !== 'undefined' ? window.localStorage : null,
): PositionMap {
  if (!storage) return {};
  try {
    const raw = storage.getItem(GRAPH_POSITIONS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Persists user-dragged node coordinates to localStorage so drags survive reload.
 */
export function savePersistedPositions(
  positions: PositionMap,
  storage: Storage | null = typeof window !== 'undefined' ? window.localStorage : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(GRAPH_POSITIONS_STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // Gracefully handle storage quota or privacy restrictions
  }
}

/**
 * Clears persisted node positions, resetting to default calculated force layout.
 */
export function clearPersistedPositions(
  storage: Storage | null = typeof window !== 'undefined' ? window.localStorage : null,
): void {
  if (!storage) return;
  try {
    storage.removeItem(GRAPH_POSITIONS_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export interface WorkspaceGraphData {
  nodes: WorkspaceNode[];
  edges: WorkspaceEdge[];
  source: 'api' | 'fixture';
}

/**
 * Fetches workspace graph from the backend API when configured,
 * falling back gracefully to the workspace fixture when unavailable.
 */
export async function fetchWorkspaceGraph(
  endpoint = '/api/graph',
  fetchImpl: typeof fetch = fetch,
): Promise<WorkspaceGraphData> {
  try {
    const res = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && Array.isArray(data.nodes) && Array.isArray(data.edges)) {
        return {
          nodes: data.nodes,
          edges: data.edges,
          source: 'api',
        };
      }
    }
  } catch {
    // Fall back to fixture
  }

  return {
    nodes: DEMO_NODES,
    edges: DEMO_EDGES,
    source: 'fixture',
  };
}
