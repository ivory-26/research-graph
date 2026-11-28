import type { EdgeRelation, EdgeStatus, RunStatus } from '../shared/types';

/**
 * `/api/graph` edge projection (#19).
 *
 * A chunk-grounded edge leaves the route with the chunk's verbatim text, page
 * and character span. A run-grounded edge leaves with the run's id plus the
 * run row's attempt and status, so the inspector can name the run even when
 * the run node's title is shared by two runs of the same claim.
 *
 * Every field is copied from the joined row. Nothing here derives a quote, a
 * page, a run id or a run status that the database did not return.
 */

export type GraphEdgeRow = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relation: EdgeRelation;
  status: EdgeStatus;
  confidence: number | null;
  evidenceChunkId: string | null;
  evidenceRunId: string | null;
};

export type GraphEdgeSourceRow = {
  edge: GraphEdgeRow;
  chunkText: string | null;
  chunkPage: number | null;
  chunkOrdinal: number | null;
  chunkCharStart: number | null;
  chunkCharEnd: number | null;
  runAttempt: number | null;
  runStatus: RunStatus | null;
};

export type GraphEvidenceRun = {
  id: string;
  attempt: number | null;
  status: RunStatus | null;
};

export type FormattedGraphEdge = {
  id: string;
  source: string;
  target: string;
  relation: EdgeRelation;
  status: EdgeStatus;
  confidence: number | undefined;
  evidenceChunkId: string | undefined;
  evidenceRunId: string | undefined;
  evidenceRun: GraphEvidenceRun | undefined;
  quote: string | undefined;
  page: number | undefined;
  chunkNumber: number | undefined;
  charStart: number | undefined;
  charEnd: number | undefined;
  sourceTitle: string | undefined;
  targetTitle: string | undefined;
};

export function formatGraphEdge(
  row: GraphEdgeSourceRow,
  nodeTitleById: ReadonlyMap<string, string>,
): FormattedGraphEdge {
  const evidenceRunId = row.edge.evidenceRunId ?? undefined;
  return {
    id: row.edge.id,
    source: row.edge.sourceNodeId,
    target: row.edge.targetNodeId,
    relation: row.edge.relation,
    status: row.edge.status,
    confidence: row.edge.confidence ?? undefined,
    evidenceChunkId: row.edge.evidenceChunkId ?? undefined,
    evidenceRunId,
    evidenceRun: evidenceRunId
      ? {
          id: evidenceRunId,
          attempt: row.runAttempt,
          status: row.runStatus,
        }
      : undefined,
    quote: row.chunkText ?? undefined,
    page: row.chunkPage ?? undefined,
    chunkNumber: row.chunkOrdinal ?? undefined,
    charStart: row.chunkCharStart ?? undefined,
    charEnd: row.chunkCharEnd ?? undefined,
    sourceTitle: nodeTitleById.get(row.edge.sourceNodeId),
    targetTitle: nodeTitleById.get(row.edge.targetNodeId),
  };
}

export function formatGraphEdges(
  rows: readonly GraphEdgeSourceRow[],
  nodeTitleById: ReadonlyMap<string, string>,
): FormattedGraphEdge[] {
  return rows.map((row) => formatGraphEdge(row, nodeTitleById));
}
