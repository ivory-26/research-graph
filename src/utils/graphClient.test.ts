import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadPersistedPositions,
  savePersistedPositions,
  clearPersistedPositions,
  fetchWorkspaceGraph,
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

    it('falls back cleanly to workspace fixture when UUID is absent, invalid, or endpoint fails', async () => {
      const resNoUuid = await fetchWorkspaceGraph(undefined);
      expect(resNoUuid.source).toBe('fixture');
      expect(resNoUuid.nodes).toEqual(DEMO_NODES);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });

      const res = await fetchWorkspaceGraph('11111111-1111-4111-8111-111111111111', mockFetch as any);
      expect(res.source).toBe('fixture');
      expect(res.nodes).toEqual(DEMO_NODES);
      expect(res.edges).toEqual(DEMO_EDGES);
    });
  });
});
