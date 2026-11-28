import { describe, it, expect } from 'vitest';
import {
  DEMO_CHUNKS,
  DEMO_EDGES,
  DEMO_NODES,
  type WorkspaceEdge,
  type WorkspaceNode,
} from '../../data/demoWorkspace';
import {
  resolveEdgeEvidence,
  type EdgeWithRunProjection,
  type RunEvidence,
  type QuoteEvidence,
} from './evidence-view';

const ACCEPTED = DEMO_EDGES.filter((edge) => edge.status === 'accepted');

/** The five text-grounded accepted edges the fixture records (#19). */
const TEXT_GROUNDED_IDS = [
  'e-src1-claim',
  'e-src2-claim',
  'e-claim-method-1',
  'e-claim-method-2',
  'e-claim-dataset',
];

/** The seven run-grounded accepted edges the owner review named. */
const RUN_GROUNDED_IDS = [
  'e-method1-run1',
  'e-method2-run2',
  'e-dataset-run1',
  'e-dataset-run2',
  'e-run1-result1',
  'e-run2-result2',
  'e-run1-run2-whatif',
];

function edgeById(id: string): WorkspaceEdge {
  const edge = DEMO_EDGES.find((candidate) => candidate.id === id);
  if (!edge) throw new Error(`fixture edge ${id} is missing`);
  return edge;
}

function runNodeById(id: string): WorkspaceNode {
  const node = DEMO_NODES.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`fixture node ${id} is missing`);
  return node;
}

function minimalEdge(overrides: Partial<WorkspaceEdge>): WorkspaceEdge {
  return {
    id: 'e-test',
    source: 'node-a',
    target: 'node-b',
    relation: 'supports',
    status: 'accepted',
    ...overrides,
  };
}

function runNode(
  id: string,
  runId: string,
  title: string,
  extra: Record<string, unknown> = {},
): WorkspaceNode {
  return {
    id,
    type: 'run',
    title,
    position: { x: 0, y: 0 },
    data: { type: 'run', runId, status: 'succeeded', mode: 'adapted', ...extra },
  };
}

describe('resolveEdgeEvidence (#19 acceptance)', () => {
  it('covers every accepted fixture edge with exactly one of the two evidence states', () => {
    expect(ACCEPTED).toHaveLength(12);
    expect(new Set(TEXT_GROUNDED_IDS).size).toBe(5);
    expect(new Set(RUN_GROUNDED_IDS).size).toBe(7);

    const textIds: string[] = [];
    const runIds: string[] = [];

    for (const edge of ACCEPTED) {
      const evidence = resolveEdgeEvidence(edge, DEMO_NODES);
      if (evidence.kind === 'quote') textIds.push(edge.id);
      else if (evidence.kind === 'run') runIds.push(edge.id);
      else throw new Error(`${edge.id} has no accepted evidence state: ${evidence.reason}`);
    }

    expect(textIds.sort()).toEqual([...TEXT_GROUNDED_IDS].sort());
    expect(runIds.sort()).toEqual([...RUN_GROUNDED_IDS].sort());
  });

  it('shows a verbatim quote with the chunk page for every text-grounded edge', () => {
    for (const id of TEXT_GROUNDED_IDS) {
      const edge = edgeById(id);
      const evidence = resolveEdgeEvidence(edge, DEMO_NODES);
      expect(evidence.kind).toBe('quote');
      const quote = evidence as QuoteEvidence;

      const chunkId = edge.evidenceChunkId;
      expect(chunkId).toBeDefined();
      const chunk = DEMO_CHUNKS[chunkId as string];
      expect(chunk).toBeDefined();

      // No invented citation: the displayed quote is in the cited chunk and the
      // page is the chunk's page.
      expect(chunk.text).toContain(quote.quote);
      expect(quote.page).toBe(chunk.page);
      expect(Number.isInteger(quote.page)).toBe(true);
      expect(quote.chunkId).toBe(chunkId);
    }
  });

  it('names the run node for every run-grounded edge, with its own run id', () => {
    const labels = new Set<string>();

    for (const id of RUN_GROUNDED_IDS) {
      const edge = edgeById(id);
      const evidence = resolveEdgeEvidence(edge, DEMO_NODES);
      expect(evidence.kind).toBe('run');
      const run = evidence as RunEvidence;

      expect(edge.evidenceRunId).toBeDefined();
      expect(run.runId).toBe(edge.evidenceRunId);

      const node = DEMO_NODES.find((candidate) => candidate.data?.runId === run.runId);
      expect(node).toBeDefined();
      expect(run.nodeId).toBe(node?.id);
      expect(run.label).toBe(node?.data.title);
      expect(run.label.length).toBeGreaterThan(0);
      labels.add(run.label);
    }

    // Run A and Run B are named differently, and each label is the run node's
    // own title rather than a method name shared by both.
    expect(labels.size).toBe(2);
    for (const nodeId of ['run-a', 'run-b']) {
      const node = runNodeById(nodeId);
      const label = node.data.title ?? node.title;
      expect(labels.has(label)).toBe(true);
    }
  });

  it('does not present a quote without a page as verified evidence', () => {
    const evidence = resolveEdgeEvidence(
      minimalEdge({ evidenceChunkId: 'chunk-1', quote: 'a real quote', page: undefined }),
      DEMO_NODES,
    );
    expect(evidence).toEqual({
      kind: 'unresolved',
      reason: 'quote_without_page',
      reference: 'chunk-1',
    });

    const zeroPage = resolveEdgeEvidence(
      minimalEdge({ evidenceChunkId: 'chunk-1', quote: 'a real quote', page: 0 }),
      DEMO_NODES,
    );
    expect(zeroPage.kind).toBe('unresolved');
  });

  it('does not name a run the loaded graph cannot identify', () => {
    const evidence = resolveEdgeEvidence(
      minimalEdge({ evidenceRunId: 'run-missing' }),
      DEMO_NODES,
    );
    expect(evidence).toEqual({
      kind: 'unresolved',
      reason: 'run_not_in_graph',
      reference: 'run-missing',
    });
  });

  it('names the run from the API projection when the run node is absent', () => {
    const edge = minimalEdge({
      evidenceRunId: 'run-9',
    }) as EdgeWithRunProjection;
    edge.evidenceRun = {
      id: 'run-9',
      attempt: 2,
      status: 'succeeded',
    };

    const evidence = resolveEdgeEvidence(edge, []) as RunEvidence;
    expect(evidence.kind).toBe('run');
    expect(evidence.runId).toBe('run-9');
    expect(evidence.nodeId).toBeNull();
    expect(evidence.label).toBe('Run attempt 2');
    expect(evidence.status).toBe('succeeded');
    expect(evidence.attempt).toBe(2);
  });

  it('ignores a run node that binds a different run', () => {
    const evidence = resolveEdgeEvidence(
      minimalEdge({ evidenceRunId: 'run-1' }),
      [runNode('run-node-other', 'run-2', 'Other run')],
    );
    expect(evidence.kind).toBe('unresolved');
  });

  it('treats an edge with no locator as a visible defect, never a structural state', () => {
    const evidence = resolveEdgeEvidence(minimalEdge({ status: 'accepted' }), DEMO_NODES);
    expect(evidence).toEqual({
      kind: 'unresolved',
      reason: 'no_locator',
      reference: null,
    });
  });

  it('drops a malformed character range instead of printing it', () => {
    const evidence = resolveEdgeEvidence(
      edgeById('e-src1-claim'),
      DEMO_NODES,
    ) as QuoteEvidence;
    expect(evidence.charStart).not.toBeNull();
    expect(evidence.charEnd).not.toBeNull();

    const inverted = resolveEdgeEvidence(
      minimalEdge({
        evidenceChunkId: 'chunk-1',
        quote: 'a real quote',
        page: 1,
        charStart: 20,
        charEnd: 10,
      }),
      DEMO_NODES,
    ) as QuoteEvidence;
    expect(inverted.kind).toBe('quote');
    expect(inverted.charStart).toBeNull();
    expect(inverted.charEnd).toBeNull();
  });
});
