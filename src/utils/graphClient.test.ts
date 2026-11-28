import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadPersistedPositions,
  savePersistedPositions,
  clearPersistedPositions,
  resolveNodePosition,
  fetchWorkspaceGraph,
  isDatabaseWorkspaceId,
  selectWorkspaceGraph,
  GRAPH_POSITIONS_STORAGE_KEY,
} from './graphClient';
import { DEMO_NODES, DEMO_EDGES } from '../data/demoWorkspace';

describe('graphClient', () => {
  let mockStorage: Record<string, string>;
  let storageAdapter: Storage;

  beforeEach(() => {
    mockStorage = {};
    storageAdapter = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, val: string) => {
        mockStorage[key] = val;
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
      clear: () => {
        mockStorage = {};
      },
      key: () => null,
      length: 0,
    };
  });

  describe('coordinate persistence', () => {
    it('returns empty position map when nothing is stored', () => {
      const positions = loadPersistedPositions('cards', storageAdapter);
      expect(positions).toEqual({});
    });

    it('persists and restores dragged node coordinates scoped by view mode', () => {
      savePersistedPositions(
        {
          'node-claim': { x: 420, y: 180 },
          'node-method-1': { x: 600, y: 350 },
        },
        'cards',
        storageAdapter,
      );

      expect(mockStorage[`${GRAPH_POSITIONS_STORAGE_KEY}_cards`]).toBeDefined();
      expect(mockStorage[`${GRAPH_POSITIONS_STORAGE_KEY}_memory`]).toBeUndefined();

      const loadedCards = loadPersistedPositions('cards', storageAdapter);
      expect(loadedCards['node-claim']).toEqual({ x: 420, y: 180 });
      expect(loadedCards['node-method-1']).toEqual({ x: 600, y: 350 });
      expect(loadPersistedPositions('memory', storageAdapter)).toEqual({});
    });

    it('discards tampered non-coordinate entries in localStorage', () => {
      mockStorage[`${GRAPH_POSITIONS_STORAGE_KEY}_cards`] = JSON.stringify({
        'node-1': 'bad',
        'node-2': { x: NaN, y: 10 },
        'node-3': { x: 100, y: 200 },
      });
      const loaded = loadPersistedPositions('cards', storageAdapter);
      expect(loaded).toEqual({ 'node-3': { x: 100, y: 200 } });
    });

    it('clears persisted positions', () => {
      savePersistedPositions({ 'node-1': { x: 10, y: 20 } }, 'memory', storageAdapter);
      clearPersistedPositions('memory', storageAdapter);
      expect(loadPersistedPositions('memory', storageAdapter)).toEqual({});
    });

    it('restores loaded position over default fallback when resolving node coordinates', () => {
      savePersistedPositions({ 'node-claim': { x: 777, y: 333 } }, 'cards', storageAdapter, 'ws-1');
      const loaded = loadPersistedPositions('cards', storageAdapter, 'ws-1');
      expect(resolveNodePosition('node-claim', { x: 10, y: 20 }, loaded)).toEqual({ x: 777, y: 333 });
      expect(resolveNodePosition('node-other', { x: 10, y: 20 }, loaded)).toEqual({ x: 10, y: 20 });
    });
  });

  describe('workspace identity', () => {
    const wsId = '11111111-1111-4111-8111-111111111111';

    it('only treats canonical UUIDs as database workspaces', () => {
      expect(isDatabaseWorkspaceId(wsId)).toBe(true);
      expect(isDatabaseWorkspaceId(wsId.toUpperCase())).toBe(true);
      expect(isDatabaseWorkspaceId('research-graph')).toBe(false);
      expect(isDatabaseWorkspaceId('11111111-1111-4111-8111')).toBe(false);
      expect(isDatabaseWorkspaceId('')).toBe(false);
      expect(isDatabaseWorkspaceId(undefined)).toBe(false);
    });

    it('never shows another workspace’s rows under a UUID workspace', () => {
      const fixtureState = {
        workspaceId: 'research-graph',
        nodes: DEMO_NODES,
        edges: DEMO_EDGES,
        source: 'fixture' as const,
      };

      const pending = selectWorkspaceGraph(fixtureState, wsId);
      expect(pending).toEqual({ workspaceId: wsId, nodes: [], edges: [], source: 'loading' });

      const loadedState = {
        workspaceId: wsId,
        nodes: [DEMO_NODES[0]],
        edges: [DEMO_EDGES[0]],
        source: 'api' as const,
      };
      expect(selectWorkspaceGraph(loadedState, wsId)).toBe(loadedState);
    });

    it('keeps the intentional fixture route synchronous, including SSR', () => {
      const loadedState = {
        workspaceId: '11111111-1111-4111-8111-111111111111',
        nodes: [DEMO_NODES[0]],
        edges: [DEMO_EDGES[0]],
        source: 'api' as const,
      };

      const fixture = selectWorkspaceGraph(loadedState, 'research-graph');
      expect(fixture.source).toBe('fixture');
      expect(fixture.nodes).toEqual(DEMO_NODES);
      expect(fixture.edges).toEqual(DEMO_EDGES);
    });
  });

  describe('fetchWorkspaceGraph', () => {
    it('returns API nodes and edges when a valid workspace UUID returns database rows', async () => {
      const customNodes = [{ id: 'n1', type: 'claim', position: { x: 0, y: 0 }, data: {} }];
      const customEdges = [{ id: 'e1', source: 'n1', target: 'n2', relation: 'supports' }];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: customNodes, edges: customEdges }),
      });

      const wsId = '11111111-1111-4111-8111-111111111111';
      const res = await fetchWorkspaceGraph(wsId, mockFetch as any);
      expect(res.source).toBe('api');
      expect(res.nodes).toEqual(customNodes);
      expect(res.edges).toEqual(customEdges);

      const emptyFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: [], edges: [] }),
      });
      const resEmpty = await fetchWorkspaceGraph(wsId, emptyFetch as any);
      expect(resEmpty.source).toBe('api');
      expect(resEmpty.nodes).toEqual([]);
    });

    it('returns fixture when UUID is absent or invalid, and explicit error when database fetch fails', async () => {
      const resNoUuid = await fetchWorkspaceGraph(undefined);
      expect(resNoUuid.source).toBe('fixture');
      expect(resNoUuid.nodes).toEqual(DEMO_NODES);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });

      const res = await fetchWorkspaceGraph('11111111-1111-4111-8111-111111111111', mockFetch as any);
      expect(res.source).toBe('error');
      expect(res.nodes).toEqual([]);
      expect(res.edges).toEqual([]);
    });
  });
});
