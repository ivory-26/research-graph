import type { WorkspaceEdge, WorkspaceNode } from '../../data/demoWorkspace';

/**
 * Presentation contract for the edge evidence inspector (#19).
 *
 * The inspector may only show evidence the graph actually carries:
 *
 * - a chunk-grounded edge needs its chunk id, the verbatim quote and an integer
 *   page number before it is shown as a citation;
 * - a run-grounded edge needs to name the run node (or the run row projected by
 *   `/api/graph`) before it is shown as run evidence;
 * - anything else is an explicit unresolved state. It is never rendered as a
 *   quote, a citation or a run name we inferred.
 *
 * Pure so the fixture, the live API payload and the panel all agree.
 */

/** Optional run metadata `/api/graph` projects for run-evidenced edges. */
export type EvidenceRunProjection = {
  id: string;
  attempt: number | null;
  status: string | null;
};

/** The shape the panel receives; the API adds `evidenceRun` to a plain edge. */
export type EdgeWithRunProjection = WorkspaceEdge & {
  evidenceRun?: EvidenceRunProjection | null;
};

export type QuoteEvidence = {
  kind: 'quote';
  quote: string;
  page: number;
  chunkId: string;
  chunkNumber: number | null;
  charStart: number | null;
  charEnd: number | null;
};

export type RunEvidence = {
  kind: 'run';
  runId: string;
  /** The projected run node's id, when the loaded graph carries it. */
  nodeId: string | null;
  /** The run's own label: its node title, never a re-worded sentence. */
  label: string;
  sublabel: string | null;
  status: string | null;
  mode: string | null;
  attempt: number | null;
};

export type UnresolvedEvidenceReason =
  | 'quote_without_page'
  | 'run_not_in_graph'
  | 'no_locator';

export type UnresolvedEvidence = {
  kind: 'unresolved';
  reason: UnresolvedEvidenceReason;
  /** The locator we do have, so a reviewer can chase the defect. */
  reference: string | null;
};

export type EdgeEvidence = QuoteEvidence | RunEvidence | UnresolvedEvidence;

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
    ? value
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function readRunProjection(
  edge: WorkspaceEdge,
  runId: string,
): EvidenceRunProjection | null {
  const projection = (edge as EdgeWithRunProjection).evidenceRun;
  if (!projection || projection.id !== runId) return null;
  return projection;
}

/**
 * Finds the node that projects this run. A run node binds the run through
 * `data.runId`; older fixture rows also use the run id as the node id. A node
 * that binds a different run is never accepted as evidence for this one.
 */
function findRunNode(
  nodes: readonly WorkspaceNode[],
  runId: string,
): WorkspaceNode | null {
  const byId = nodes.find(
    (node) => node.type === 'run' && node.id === runId,
  );
  if (byId) return byId;
  return (
    nodes.find(
      (node) => node.type === 'run' && node.data?.runId === runId,
    ) ?? null
  );
}

function runNodeLabel(node: WorkspaceNode): string | null {
  return nonEmptyString(node.data?.title) ?? nonEmptyString(node.title);
}

/**
 * Resolves what an edge actually rests on.
 *
 * Chunk evidence wins only when the quote, chunk id and page are all present.
 * Otherwise a run reference is used if it can be named. An edge that claims to
 * be accepted but carries no complete locator resolves to `unresolved`, which
 * the panel renders as a data defect rather than as a benign "structural"
 * relation. That case is unreachable through the database constraint; it is
 * kept visible in case a fixture or an API payload regresses.
 */
export function resolveEdgeEvidence(
  edge: WorkspaceEdge | null | undefined,
  nodes: readonly WorkspaceNode[] = [],
): EdgeEvidence {
  if (!edge) {
    return { kind: 'unresolved', reason: 'no_locator', reference: null };
  }

  const chunkId = nonEmptyString(edge.evidenceChunkId);
  const quote = nonEmptyString(edge.quote);
  const page = positiveInteger(edge.page);

  if (chunkId && quote && page !== null) {
    let charStart = nonNegativeInteger(edge.charStart);
    let charEnd = nonNegativeInteger(edge.charEnd);
    if (charStart === null || charEnd === null || charEnd < charStart) {
      charStart = null;
      charEnd = null;
    }
    return {
      kind: 'quote',
      quote,
      page,
      chunkId,
      chunkNumber: nonNegativeInteger(edge.chunkNumber),
      charStart,
      charEnd,
    };
  }

  const runId = nonEmptyString(edge.evidenceRunId);
  if (runId) {
    const projection = readRunProjection(edge, runId);
    const runNode = findRunNode(nodes, runId);
    const attempt = projection ? positiveInteger(projection.attempt) : null;
    const label =
      (runNode && runNodeLabel(runNode)) ??
      (attempt !== null ? `Run attempt ${attempt}` : null);

    if (!label) {
      return { kind: 'unresolved', reason: 'run_not_in_graph', reference: runId };
    }

    const nodeData = runNode?.data;
    return {
      kind: 'run',
      runId,
      nodeId: runNode?.id ?? null,
      label,
      sublabel: nonEmptyString(nodeData?.sublabel),
      // The run row is authoritative when the API projected it; the node's
      // data is the older projection of the same run.
      status:
        nonEmptyString(projection?.status) ?? nonEmptyString(nodeData?.status),
      mode: nonEmptyString(nodeData?.mode),
      attempt,
    };
  }

  if (chunkId && quote) {
    return {
      kind: 'unresolved',
      reason: 'quote_without_page',
      reference: chunkId,
    };
  }

  return { kind: 'unresolved', reason: 'no_locator', reference: chunkId };
}
