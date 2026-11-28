import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DEMO_EDGES,
  DEMO_NODES,
  type WorkspaceEdge,
  type WorkspaceNode,
} from '../../data/demoWorkspace';
import { EvidencePanel } from './EvidencePanel';
import type { EdgeWithRunProjection } from './evidence-view';

function render(edge: WorkspaceEdge, nodes: WorkspaceNode[] = DEMO_NODES): string {
  return renderToStaticMarkup(
    React.createElement(EvidencePanel, {
      edge,
      allNodes: nodes,
      allEdges: [edge],
    }),
  );
}

/** Visible text of the rendered panel, with HTML entities decoded. */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

function edgeById(id: string): WorkspaceEdge {
  const edge = DEMO_EDGES.find((candidate) => candidate.id === id);
  if (!edge) throw new Error(`fixture edge ${id} is missing`);
  return edge;
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

describe('EvidencePanel presentation (#19)', () => {
  it('renders the verbatim quote, its source edge and page for a text-grounded edge', () => {
    const edge = edgeById('e-src1-claim');
    const html = render(edge);
    const quote = edge.quote as string;

    expect(html).toContain('CITATION &amp; EVIDENCE INSPECTOR');
    // Derived from the fixture so a re-recorded workspace (#17) cannot make
    // this test assert a stale page or character span.
    expect(html).toContain(`EVIDENCE CHUNK · PAGE ${edge.page}`);
    expect(html).toContain(`CHARS ${edge.charStart}–${edge.charEnd}`);
    expect(visibleText(html)).toContain(quote.slice(0, 60));
    expect(html).not.toContain('Run-Evidenced Relation');
    expect(html).not.toContain('Evidence unavailable');
  });

  it('renders a distinct run-evidence state that names the run', () => {
    const edge = edgeById('e-method1-run1');
    const runNode = DEMO_NODES.find(
      (node) => node.type === 'run' && node.data?.runId === edge.evidenceRunId,
    );
    expect(runNode).toBeDefined();

    const html = render(edge);
    expect(html).toContain('Run-Evidenced Relation');
    expect(html).toContain(runNode?.data.title as string);
    if (runNode?.data.sublabel) {
      expect(html).toContain(runNode.data.sublabel);
    }
    expect(html).toContain('This relation rests on run');
    expect(html).toContain(edge.evidenceRunId as string);
    expect(html).toContain('Inspect run node');
    expect(html).not.toContain('EVIDENCE CHUNK');
    expect(html).not.toContain('Structural relation without direct text quotation');
  });

  it('names a run from the API projection when the run node is not loaded', () => {
    const edge = minimalEdge({ evidenceRunId: 'run-9' }) as EdgeWithRunProjection;
    edge.evidenceRun = { id: 'run-9', attempt: 2, status: 'succeeded' };

    const html = render(edge, []);
    expect(html).toContain('Run attempt 2');
    expect(html).toContain('attempt 2');
    expect(html).toContain('succeeded');
    expect(html).toContain('its node is not in the loaded graph');
  });

  it('never prints a quote without a page as verified evidence', () => {
    const edge = minimalEdge({
      evidenceChunkId: 'chunk-1',
      quote: 'A cited passage without a locator.',
      page: undefined,
    });

    const html = render(edge);
    expect(html).toContain('Evidence unavailable');
    expect(html).toContain('no page number');
    expect(html).toContain('An accepted edge must open to a quote with a page, or to a named run.');
    expect(html).not.toContain('EVIDENCE CHUNK');
    expect(html).not.toContain('PAGE undefined');
    expect(html).not.toContain('A cited passage without a locator.');
  });

  it('shows the cited run id when the run cannot be named', () => {
    const html = render(minimalEdge({ evidenceRunId: 'run-missing' }));
    expect(html).toContain('Evidence unavailable');
    expect(html).toContain('run-missing');
    expect(html).not.toContain('Run-Evidenced Relation');
  });

  it('marks an accepted edge with no locator as a data defect', () => {
    const html = render(minimalEdge({}));
    expect(html).toContain('Evidence unavailable');
    expect(html).toContain('No quote, page or run is recorded for this edge.');
    expect(html).toContain('An accepted edge must open to a quote with a page, or to a named run.');
  });
});
