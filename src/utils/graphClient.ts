import { DEMO_NODES, DEMO_EDGES } from '../data/demoWorkspace';
import type { WorkspaceNode, WorkspaceEdge } from '../data/demoWorkspace';

export const GRAPH_POSITIONS_STORAGE_KEY = 'rg_node_positions';

export type CanvasViewMode = 'memory' | 'cards';
export type PositionMap = Record<string, { x: number; y: number }>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getStorageKey(viewMode?: CanvasViewMode, workspaceId?: string): string {
  const scope = workspaceId ? `_${workspaceId}` : '';
  return viewMode
    ? `${GRAPH_POSITIONS_STORAGE_KEY}_${viewMode}${scope}`
    : `${GRAPH_POSITIONS_STORAGE_KEY}${scope}`;
}

/**
 * Loads user-dragged node coordinates from localStorage for a given view mode and workspace,
 * validating each entry's shape so tampered values cannot break the canvas.
 */
export function loadPersistedPositions(
  viewMode: CanvasViewMode = 'cards',
  storage: Storage | null = typeof window !== 'undefined' ? window.localStorage : null,
  workspaceId?: string,
): PositionMap {
  if (!storage) return {};
  try {
    const raw = storage.getItem(getStorageKey(viewMode, workspaceId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const validated: PositionMap = {};
    for (const [id, pos] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        pos &&
        typeof pos === 'object' &&
        !Array.isArray(pos) &&
        typeof (pos as any).x === 'number' &&
        Number.isFinite((pos as any).x) &&
        typeof (pos as any).y === 'number' &&
        Number.isFinite((pos as any).y)
      ) {
        validated[id] = { x: (pos as any).x, y: (pos as any).y };
      }
    }
    return validated;
  } catch {
    return {};
  }
}

/**
 * Persists user-dragged node coordinates to localStorage so drags survive reload.
 */
export function savePersistedPositions(
  positions: PositionMap,
  viewMode: CanvasViewMode = 'cards',
  storage: Storage | null = typeof window !== 'undefined' ? window.localStorage : null,
  workspaceId?: string,
): void {
  if (!storage) return;
  try {
    storage.setItem(getStorageKey(viewMode, workspaceId), JSON.stringify(positions));
  } catch {
    // Gracefully handle storage quota or privacy restrictions
  }
}

/**
 * Resolves a node's position by preferring any persisted drag coordinates
 * over its default layout fallback.
 */
export function resolveNodePosition(
  nodeId: string,
  fallbackPosition: { x: number; y: number },
  persistedPositions: PositionMap,
): { x: number; y: number } {
  return persistedPositions[nodeId] ?? fallbackPosition;
}

/**
 * Clears persisted node positions, resetting to default calculated layout.
 */
export function clearPersistedPositions(
  viewMode?: CanvasViewMode,
  storage: Storage | null = typeof window !== 'undefined' ? window.localStorage : null,
  workspaceId?: string,
): void {
  if (!storage) return;
  try {
    if (viewMode) {
      storage.removeItem(getStorageKey(viewMode, workspaceId));
    } else {
      storage.removeItem(getStorageKey('cards', workspaceId));
      storage.removeItem(getStorageKey('memory', workspaceId));
      storage.removeItem(GRAPH_POSITIONS_STORAGE_KEY);
    }
  } catch {
    // Ignore
  }
}

function isValidGraphPayload(data: unknown): data is { nodes: WorkspaceNode[]; edges: WorkspaceEdge[] } {
  if (!data || typeof data !== 'object') return false;
  const candidate = data as Record<string, unknown>;
  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) return false;

  const nodesValid = candidate.nodes.every(
    (n) =>
      n &&
      typeof n === 'object' &&
      typeof (n as any).id === 'string' &&
      typeof (n as any).type === 'string' &&
      (n as any).position &&
      typeof (n as any).position.x === 'number' &&
      typeof (n as any).position.y === 'number',
  );
  const edgesValid = candidate.edges.every(
    (e) =>
      e &&
      typeof e === 'object' &&
      typeof (e as any).id === 'string' &&
      typeof (e as any).source === 'string' &&
      typeof (e as any).target === 'string',
  );

  return nodesValid && edgesValid;
}

export interface WorkspaceGraphData {
  nodes: WorkspaceNode[];
  edges: WorkspaceEdge[];
  source: 'api' | 'fixture' | 'error';
}

/**
 * Fetches workspace graph from `/api/graph?workspaceId=...` when a workspace UUID
 * is provided (returning `source: 'error'` if the database fetch fails), or
 * returns the demo fixture when no UUID workspace is active.
 */
export async function fetchWorkspaceGraph(
  workspaceId?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WorkspaceGraphData> {
  if (workspaceId && UUID_PATTERN.test(workspaceId)) {
    try {
      const res = await fetchImpl(`/api/graph?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (isValidGraphPayload(data)) {
          return {
            nodes: data.nodes,
            edges: data.edges,
            source: 'api',
          };
        }
      }
    } catch {
      // Fall through to explicit error source
    }

    return {
      nodes: [],
      edges: [],
      source: 'error',
    };
  }

  return {
    nodes: DEMO_NODES,
    edges: DEMO_EDGES,
    source: 'fixture',
  };
}
