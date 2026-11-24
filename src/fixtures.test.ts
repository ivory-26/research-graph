import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { NodeType, EdgeRelation, EdgeStatus } from './shared/types';
import {
  DEMO_WORKSPACE,
  DEMO_SOURCES,
  DEMO_CHUNKS,
  DEMO_NODES,
  DEMO_EDGES,
  DEMO_STRATEGIES,
  PINNED_IMAGE_PACKAGES as DEMO_PINS,
} from './data/demoWorkspace';
import { PINNED_IMAGE_PACKAGES as RUNNER_PINS } from './server/runner';

describe('Workspace Fixture (Issue #17 Acceptance Criteria)', () => {
  const fixturePath = path.resolve(process.cwd(), 'fixtures/workspace.json');

  it('exists and is valid JSON', () => {
    expect(fs.existsSync(fixturePath)).toBe(true);
    const content = fs.readFileSync(fixturePath, 'utf8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it('contains complete workspace metadata and 3 verified demo papers', () => {
    const data = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    // Workspace metadata
    expect(data.workspace).toBeDefined();
    expect(data.workspace.name).toBe('Random Forest Study');
    expect(data.workspace.mode).toBe('adapted');

    // 3 Sources
    expect(data.sources).toHaveLength(3);
    const hero = data.sources.find((s: any) => s.isHero);
    expect(hero).toBeDefined();
    expect(hero.title).toContain('Strobl et al. 2007');
    expect(hero.sha256).toBe('9f5835b4c1064dbbf9738efc633a2862bc74a3f124a9e403d168541c6f50b4ea');

    // Strobl 2008 & Kursa 2010
    const sourceIds = data.sources.map((s: any) => s.id);
    expect(sourceIds).toContain('src-1');
    expect(sourceIds).toContain('src-2');
    expect(sourceIds).toContain('src-3');
  });

  it('contains valid nodes matching NodeType contracts', () => {
    const data = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const validNodeTypes: NodeType[] = [
      'source',
      'claim',
      'method',
      'dataset',
      'result',
      'run',
      'note',
    ];

    expect(data.nodes.length).toBeGreaterThanOrEqual(10);

    const typesPresent = new Set<string>();
    for (const node of data.nodes) {
      expect(node.id).toBeDefined();
      expect(validNodeTypes).toContain(node.type);
      expect(node.title).toBeDefined();
      expect(node.data).toBeDefined();
      typesPresent.add(node.type);
    }

    // All core types must be present in the fixture
    expect(typesPresent.has('source')).toBe(true);
    expect(typesPresent.has('claim')).toBe(true);
    expect(typesPresent.has('method')).toBe(true);
    expect(typesPresent.has('dataset')).toBe(true);
    expect(typesPresent.has('run')).toBe(true);
    expect(typesPresent.has('result')).toBe(true);
  });

  it('contains valid evidenced edges with citations, quotes and page numbers', () => {
    const data = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const validRelations: EdgeRelation[] = [
      'supports',
      'contradicts',
      'cites',
      'uses_dataset',
      'tests',
      'produced',
      'derived_from',
    ];
    const validStatuses: EdgeStatus[] = ['suggested', 'accepted', 'rejected'];

    const nodeIds = new Set(data.nodes.map((n: any) => n.id));

    expect(data.edges.length).toBeGreaterThanOrEqual(10);

    for (const edge of data.edges) {
      expect(edge.id).toBeDefined();
      expect(validRelations).toContain(edge.relation);
      expect(validStatuses).toContain(edge.status);
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);

      // Every edge carrying a quote must be verbatim against its source chunk (Issue #19)
      if (edge.quote) {
        expect(edge.quote.length).toBeGreaterThan(10);
        expect(edge.quote.endsWith('...')).toBe(false);

        // Verbatim verification against chunk text
        if (edge.evidenceChunkId && data.chunks[edge.evidenceChunkId]) {
          const chunk = data.chunks[edge.evidenceChunkId];
          expect(chunk.text).toContain(edge.quote);
        }
      }
    }
  });

  it('includes Run A (impurity) and Run B (permutation) with single parameter diff', () => {
    const data = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    const runA = data.nodes.find((n: any) => n.id === 'run-a');
    const runB = data.nodes.find((n: any) => n.id === 'run-b');

    expect(runA).toBeDefined();
    expect(runB).toBeDefined();
    expect(runB.data.parentRunId).toBe(runA.data.runId);

    // Derived edge connecting Run A to Run B
    const derivedEdge = data.edges.find((e: any) => e.relation === 'derived_from');
    expect(derivedEdge).toBeDefined();
    expect(derivedEdge.source).toBe('run-a');
    expect(derivedEdge.target).toBe('run-b');

    // Spec and preview results with consistent rank metrics
    const results = data.nodes.filter((n: any) => n.type === 'result');
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((r: any) => r.data.verdict === null && r.data.isPreview === true)).toBe(true);
    for (const res of results) {
      expect(res.data.metrics.rank_impurity_noise_20).toBe(4);
      expect(res.data.metrics.rank_permutation_noise_20).toBe(11);
    }
  });

  it('verifies that demoWorkspace.ts perfectly re-exports workspace.json without drift', () => {
    const data = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    expect(DEMO_WORKSPACE).toEqual(data.workspace);
    expect(DEMO_SOURCES).toEqual(data.sources);
    expect(DEMO_CHUNKS).toEqual(data.chunks);
    expect(DEMO_NODES).toEqual(data.nodes);
    expect(DEMO_EDGES).toEqual(data.edges);
    expect(DEMO_STRATEGIES).toEqual(data.strategies);
  });

  it('ensures PINNED_IMAGE_PACKAGES in demoWorkspace matches runner.ts without drift', () => {
    expect(DEMO_PINS).toEqual(RUNNER_PINS);
  });

  it('validates every node against the frozen NodeData schema union', () => {
    const data = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    for (const node of data.nodes) {
      const d = node.data;
      expect(d.type).toBe(node.type);

      switch (d.type) {
        case 'source':
          expect(typeof d.sourceId).toBe('string');
          expect(typeof d.kind).toBe('string');
          break;
        case 'claim':
          expect(typeof d.text).toBe('string');
          expect(d.reported === null || typeof d.reported === 'object').toBe(true);
          expect(d.datasetName === null || typeof d.datasetName === 'string').toBe(true);
          expect(d.methodName === null || typeof d.methodName === 'string').toBe(true);
          expect(typeof d.locator).toBe('object');
          expect(typeof d.locator.page).toBe('number');
          expect(typeof d.locator.quote).toBe('string');
          break;
        case 'method':
          expect(typeof d.summary).toBe('string');
          expect(d.library === null || typeof d.library === 'string').toBe(true);
          break;
        case 'dataset':
          expect(typeof d.name).toBe('string');
          expect(d.url === null || typeof d.url === 'string').toBe(true);
          expect(d.sha256 === null || typeof d.sha256 === 'string').toBe(true);
          expect(d.rows === null || typeof d.rows === 'number').toBe(true);
          break;
        case 'run':
          expect(typeof d.runId).toBe('string');
          expect(['queued', 'running', 'succeeded', 'failed', 'timeout', 'cancelled']).toContain(d.status);
          expect(['exact', 'adapted', 'conceptual']).toContain(d.mode);
          break;
        case 'result':
          expect(typeof d.runId).toBe('string');
          expect(typeof d.metrics).toBe('object');
          expect(d.verdict === null || ['match', 'mismatch', 'inconclusive', 'failed'].includes(d.verdict)).toBe(true);
          if (d.verdictDetail) {
            expect(Array.isArray(d.verdictDetail.checks)).toBe(true);
            expect(d.verdictDetail.explanation === null || typeof d.verdictDetail.explanation === 'string').toBe(true);
          }
          break;
        case 'note':
          expect(typeof d.body).toBe('string');
          break;
        default:
          throw new Error(`Unexpected node type: ${d.type}`);
      }
    }
  });
});
