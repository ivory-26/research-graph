import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { NodeType, EdgeRelation, EdgeStatus } from './shared/types';

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

      // Accepted literature edges must have grounding evidence (Issue #19)
      if (edge.relation === 'supports' || edge.relation === 'cites') {
        expect(edge.quote).toBeDefined();
        expect(edge.quote.length).toBeGreaterThan(10);
        expect(edge.page).toBeGreaterThan(0);
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

    // Verified results
    const results = data.nodes.filter((n: any) => n.type === 'result');
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((r: any) => r.data.verdict === 'match')).toBe(true);
  });
});
