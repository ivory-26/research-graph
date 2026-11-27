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

    it('clears persisted positions', () => {
      savePersistedPositions({ 'node-1': { x: 10, y: 20 } }, 'memory', storageAdapter);
      clearPersistedPositions('memory', storageAdapter);
      expect(loadPersistedPositions('memory', storageAdapter)).toEqual({});
    });
  });

  describe('fetchWorkspaceGraph', () => {
    it('returns API nodes and edges when the endpoint responds with valid shape', async () => {
      const customNodes = [{ id: 'n1', type: 'claim', position: { x: 0, y: 0 }, data: {} }];
      const customEdges = [{ id: 'e1', source: 'n1', target: 'n2', relation: 'supports' }];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: customNodes, edges: customEdges }),
      });

      const res = await fetchWorkspaceGraph('/api/graph', mockFetch as any);
      expect(res.source).toBe('api');
      expect(res.nodes).toEqual(customNodes);
      expect(res.edges).toEqual(customEdges);
    });

    it('falls back cleanly to workspace fixture when endpoint returns invalid shape or 404', async () => {
      const badFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: [{ invalid: true }], edges: [] }),
      });
      const resBad = await fetchWorkspaceGraph('/api/graph', badFetch as any);
      expect(resBad.source).toBe('fixture');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const res = await fetchWorkspaceGraph('/api/graph', mockFetch as any);
      expect(res.source).toBe('fixture');
      expect(res.nodes).toEqual(DEMO_NODES);
      expect(res.edges).toEqual(DEMO_EDGES);
    });
  });
});
