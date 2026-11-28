import { describe, it, expect } from 'vitest';
import {
  formatGraphEdge,
  formatGraphEdges,
  type GraphEdgeRow,
  type GraphEdgeSourceRow,
} from './graph-evidence';

const CHUNK_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';

function edgeRow(overrides: Partial<GraphEdgeRow> = {}): GraphEdgeRow {
  return {
    id: 'edge-1',
    sourceNodeId: 'node-source',
    targetNodeId: 'node-target',
    relation: 'supports',
    status: 'accepted',
    confidence: 0.82,
    evidenceChunkId: null,
    evidenceRunId: null,
    ...overrides,
  };
}

function sourceRow(overrides: Partial<GraphEdgeSourceRow> = {}): GraphEdgeSourceRow {
  return {
    edge: edgeRow(),
    chunkText: null,
    chunkPage: null,
    chunkOrdinal: null,
    chunkCharStart: null,
    chunkCharEnd: null,
    runAttempt: null,
    runStatus: null,
    ...overrides,
  };
}

describe('formatGraphEdge (#19 evidence projection)', () => {
  it('projects the joined chunk verbatim text, page and span', () => {
    const formatted = formatGraphEdge(
      sourceRow({
        edge: edgeRow({ evidenceChunkId: CHUNK_ID }),
        chunkText: 'A variable with more categories has a higher probability.',
        chunkPage: 4,
        chunkOrdinal: 1,
        chunkCharStart: 3810,
        chunkCharEnd: 4220,
      }),
      new Map([
        ['node-source', 'Strobl et al. 2007'],
        ['node-target', 'Claim'],
      ]),
    );

    expect(formatted.quote).toBe('A variable with more categories has a higher probability.');
    expect(formatted.page).toBe(4);
    expect(formatted.chunkNumber).toBe(1);
    expect(formatted.charStart).toBe(3810);
    expect(formatted.charEnd).toBe(4220);
    expect(formatted.evidenceChunkId).toBe(CHUNK_ID);
    expect(formatted.evidenceRun).toBeUndefined();
    expect(formatted.sourceTitle).toBe('Strobl et al. 2007');
    expect(formatted.targetTitle).toBe('Claim');
  });

  it('projects the run id, attempt and status for a run-grounded edge', () => {
    const formatted = formatGraphEdge(
      sourceRow({
        edge: edgeRow({ evidenceRunId: RUN_ID, relation: 'produced', confidence: 1 }),
        runAttempt: 2,
        runStatus: 'succeeded',
      }),
      new Map(),
    );

    expect(formatted.evidenceRunId).toBe(RUN_ID);
    expect(formatted.evidenceRun).toEqual({
      id: RUN_ID,
      attempt: 2,
      status: 'succeeded',
    });
    // A run-grounded edge carries no chunk payload.
    expect(formatted.quote).toBeUndefined();
    expect(formatted.page).toBeUndefined();
    expect(formatted.evidenceChunkId).toBeUndefined();
  });

  it('does not invent evidence when the joins return nothing', () => {
    const formatted = formatGraphEdge(sourceRow(), new Map());

    expect(formatted.evidenceChunkId).toBeUndefined();
    expect(formatted.evidenceRunId).toBeUndefined();
    expect(formatted.evidenceRun).toBeUndefined();
    expect(formatted.quote).toBeUndefined();
    expect(formatted.page).toBeUndefined();
    expect(formatted.chunkNumber).toBeUndefined();
    expect(formatted.charStart).toBeUndefined();
    expect(formatted.charEnd).toBeUndefined();
    expect(formatted.sourceTitle).toBeUndefined();
    expect(formatted.targetTitle).toBeUndefined();
  });

  it('keeps null run metadata null instead of filling it in', () => {
    const formatted = formatGraphEdge(
      sourceRow({
        edge: edgeRow({ evidenceRunId: RUN_ID }),
        runAttempt: null,
        runStatus: null,
      }),
      new Map(),
    );

    expect(formatted.evidenceRun).toEqual({
      id: RUN_ID,
      attempt: null,
      status: null,
    });
  });

  it('formats every row in order', () => {
    const formatted = formatGraphEdges(
      [
        sourceRow({ edge: edgeRow({ id: 'edge-1', evidenceChunkId: CHUNK_ID }), chunkText: 'one', chunkPage: 1 }),
        sourceRow({ edge: edgeRow({ id: 'edge-2', evidenceRunId: RUN_ID }), runAttempt: 1, runStatus: 'failed' }),
      ],
      new Map(),
    );

    expect(formatted.map((edge) => edge.id)).toEqual(['edge-1', 'edge-2']);
    expect(formatted[0].page).toBe(1);
    expect(formatted[1].evidenceRun?.status).toBe('failed');
  });
});
