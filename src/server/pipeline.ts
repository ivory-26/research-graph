/**
 * The run → graph integration seam (#7).
 *
 * One persisted terminal run becomes two nodes and one edge:
 *
 *   (run) --produced--> (result)
 *
 * The run node is the audit handle. Its `data.runId` resolves to the `runs`
 * row, which stays the only place stdout, stderr, environment and verdict
 * detail live; the frozen `NodeData` contract is not widened to copy them into
 * the graph. The result node carries the measured metrics and the verdict that
 * `evaluateExperiment` computed. Neither node holds a reported value: reported
 * values stay on claim nodes (ADR 0006).
 *
 * Rules this module keeps:
 *
 * - **Workspace comes from the experiment.** The caller supplies only a run
 *   id. The run's experiment decides the workspace, so a run cannot be
 *   projected into a graph it does not belong to.
 * - **Terminal runs only.** `queued` and `running` runs have no result yet; the
 *   projection refuses them rather than writing a node that claims otherwise.
 *   A rejected approval creates no run at all, so there is nothing to project.
 * - **One row set per run.** The function locks the run row, reuses the nodes
 *   and edge already written for that run, and never duplicates them on a
 *   replay. Existing positions are preserved; a repeat updates only data that
 *   the run row now holds (for example a verdict persisted after an abort).
 * - **Atomic.** Both nodes and the edge are written in one transaction. A
 *   failure after a node insert rolls the whole projection back, so a reader
 *   never sees a half-graph.
 * - **Evidence is the run.** The `produced` edge is `accepted` and carries
 *   `evidenceRunId = runId`, so it satisfies `edges_have_evidence` without a
 *   source chunk and the graph can open the run it came from.
 *
 * The projection writes rows, not `node.upserted` / `edge.upserted` events.
 * It also runs on abort paths where the transport refuses every later event,
 * and the graph is read from `nodes` and `edges` rather than from the event
 * log. Those two event types stay in the frozen contract for a live UI bridge
 * to emit when one exists.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'

import type { Database } from '../db/client'
import { edges, experiments, nodes, runs } from '../db/schema'
import type {
  EdgeRelation,
  EdgeStatus,
  GraphEdge,
  GraphNode,
  NodeData,
  RunStatus,
} from '../shared/types'

/** Statuses that mean the run will never produce another measurement. */
const TERMINAL_RUN_STATUSES = [
  'succeeded',
  'failed',
  'timeout',
  'cancelled',
] as const satisfies readonly RunStatus[]

/** Seed layout only; the canvas owns positions once the nodes exist. */
const RUN_NODE_OFFSET = { x: 260, y: 160 } as const
const RESULT_NODE_OFFSET = { x: 520, y: 160 } as const
const ATTEMPT_ROW_GAP = 140
const MAX_TITLE_LENGTH = 180

export type RunGraphErrorCode =
  | 'RUN_NOT_FOUND'
  | 'RUN_NOT_TERMINAL'
  | 'EXPERIMENT_NOT_FOUND'

/**
 * A refused or impossible projection.
 *
 * The message is for the server log; the stage layer turns any unexpected
 * throw into a generic `pipeline.failed` sentence, so no raw text from here is
 * persisted or streamed.
 */
export class RunGraphError extends Error {
  readonly code: RunGraphErrorCode

  constructor(code: RunGraphErrorCode, message: string) {
    super(message)
    this.name = 'RunGraphError'
    this.code = code
  }
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(status)
}

export type RunGraphProjection = {
  runId: string
  workspaceId: string
  runNode: GraphNode
  resultNode: GraphNode
  edge: GraphEdge
  /** True when this call inserted at least one of the three rows. */
  created: boolean
}

type NodeRowShape = {
  id: string
  type: GraphNode['type']
  title: string
  data: NodeData
  sourceId: string | null
}

type EdgeRowShape = {
  id: string
  sourceNodeId: string
  targetNodeId: string
  relation: EdgeRelation
  status: EdgeStatus
  evidenceChunkId: string | null
  evidenceRunId: string | null
  confidence: number | null
}

const nodeReturning = {
  id: nodes.id,
  type: nodes.type,
  title: nodes.title,
  data: nodes.data,
  sourceId: nodes.sourceId,
} as const

const edgeReturning = {
  id: edges.id,
  sourceNodeId: edges.sourceNodeId,
  targetNodeId: edges.targetNodeId,
  relation: edges.relation,
  status: edges.status,
  evidenceChunkId: edges.evidenceChunkId,
  evidenceRunId: edges.evidenceRunId,
  confidence: edges.confidence,
} as const

function toGraphNode(row: NodeRowShape): GraphNode {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    data: row.data,
    sourceId: row.sourceId,
  }
}

function toGraphEdge(row: EdgeRowShape): GraphEdge {
  return {
    id: row.id,
    sourceNodeId: row.sourceNodeId,
    targetNodeId: row.targetNodeId,
    relation: row.relation,
    status: row.status,
    evidenceChunkId: row.evidenceChunkId,
    evidenceRunId: row.evidenceRunId,
    confidence: row.confidence,
  }
}

function projectionTitle(prefix: 'Run' | 'Result', claimTitle: string): string {
  const trimmed = claimTitle.trim()
  if (trimmed.length === 0) return prefix
  return `${prefix} · ${trimmed}`.slice(0, MAX_TITLE_LENGTH)
}

/**
 * Projects one persisted terminal run into the graph.
 *
 * Idempotent by run id: a serial replay or two concurrent callers observe the
 * same `runNode.id`, `resultNode.id` and `edge.id`. The run row lock is the
 * serialization point, because the rows being written belong to the run rather
 * than to the experiment's event sequence.
 *
 * Throws `RunGraphError` for a missing run or a run that is not terminal. A
 * database failure inside the transaction propagates unchanged after rollback.
 */
export async function projectRunToGraph(
  db: Database,
  runId: string,
): Promise<RunGraphProjection> {
  return db.transaction(async (tx) => {
    // Lock the run before reading it. A concurrent projection for the same run
    // waits here and then observes the rows the first transaction committed.
    const [run] = await tx
      .select({
        id: runs.id,
        experimentId: runs.experimentId,
        attempt: runs.attempt,
        status: runs.status,
        metrics: runs.metrics,
        verdict: runs.verdict,
        spec: runs.spec,
      })
      .from(runs)
      .where(eq(runs.id, runId))
      .for('update')

    if (!run) {
      throw new RunGraphError('RUN_NOT_FOUND', `run ${runId} does not exist`)
    }
    if (!isTerminalRunStatus(run.status)) {
      throw new RunGraphError(
        'RUN_NOT_TERMINAL',
        `run ${runId} is ${run.status}; only a terminal run has a graph projection`,
      )
    }

    // Workspace and the claim anchor come from the run's experiment, never
    // from the caller. The claim node supplies the title and the seed position.
    const [scope] = await tx
      .select({
        workspaceId: experiments.workspaceId,
        claimTitle: nodes.title,
        claimPositionX: nodes.positionX,
        claimPositionY: nodes.positionY,
      })
      .from(experiments)
      .innerJoin(nodes, eq(nodes.id, experiments.claimNodeId))
      .where(eq(experiments.id, run.experimentId))
      .limit(1)

    if (!scope) {
      throw new RunGraphError(
        'EXPERIMENT_NOT_FOUND',
        `experiment ${run.experimentId} for run ${runId} has no claim node`,
      )
    }

    // Authoritative run data, in the frozen shapes. The mode is the frozen
    // spec's mode: what executed, not what the experiment says today.
    const runNodeData: NodeData = {
      type: 'run',
      runId: run.id,
      status: run.status,
      mode: run.spec.mode,
    }
    const resultNodeData: NodeData = {
      type: 'result',
      metrics: run.metrics,
      runId: run.id,
      verdict: run.verdict,
    }

    const runTitle = projectionTitle('Run', scope.claimTitle)
    const resultTitle = projectionTitle('Result', scope.claimTitle)

    // Earliest first: if an older version of this seam ever left a duplicate,
    // the first row remains the stable identity and the extras are left alone
    // rather than deleted behind a user's back.
    const existingRows = await tx
      .select({
        id: nodes.id,
        type: nodes.type,
        data: nodes.data,
      })
      .from(nodes)
      .where(
        and(
          eq(nodes.workspaceId, scope.workspaceId),
          inArray(nodes.type, ['run', 'result']),
          sql`${nodes.data} ->> 'runId' = ${run.id}`,
        ),
      )
      .orderBy(nodes.createdAt, nodes.id)

    const existingRun = existingRows.find((row) => row.type === 'run')
    const existingResult = existingRows.find((row) => row.type === 'result')

    let created = false

    let runNodeRow: NodeRowShape
    if (existingRun) {
      const [updated] = await tx
        .update(nodes)
        .set({ title: runTitle, data: runNodeData })
        .where(eq(nodes.id, existingRun.id))
        .returning(nodeReturning)
      runNodeRow = updated
    } else {
      const attemptOffset = Math.max(0, run.attempt - 1) * ATTEMPT_ROW_GAP
      const [inserted] = await tx
        .insert(nodes)
        .values({
          workspaceId: scope.workspaceId,
          type: 'run',
          title: runTitle,
          data: runNodeData,
          positionX: scope.claimPositionX + RUN_NODE_OFFSET.x,
          positionY:
            scope.claimPositionY + RUN_NODE_OFFSET.y + attemptOffset,
        })
        .returning(nodeReturning)
      runNodeRow = inserted
      created = true
    }

    let resultNodeRow: NodeRowShape
    if (existingResult) {
      const [updated] = await tx
        .update(nodes)
        .set({ title: resultTitle, data: resultNodeData })
        .where(eq(nodes.id, existingResult.id))
        .returning(nodeReturning)
      resultNodeRow = updated
    } else {
      const attemptOffset = Math.max(0, run.attempt - 1) * ATTEMPT_ROW_GAP
      const [inserted] = await tx
        .insert(nodes)
        .values({
          workspaceId: scope.workspaceId,
          type: 'result',
          title: resultTitle,
          data: resultNodeData,
          positionX: scope.claimPositionX + RESULT_NODE_OFFSET.x,
          positionY:
            scope.claimPositionY + RESULT_NODE_OFFSET.y + attemptOffset,
        })
        .returning(nodeReturning)
      resultNodeRow = inserted
      created = true
    }

    // The edge identity is the pair plus the relation. `evidenceRunId` alone
    // is not unique: the fixture also records method --produced--> run with
    // the same run as evidence.
    const [existingEdge] = await tx
      .select(edgeReturning)
      .from(edges)
      .where(
        and(
          eq(edges.workspaceId, scope.workspaceId),
          eq(edges.sourceNodeId, runNodeRow.id),
          eq(edges.targetNodeId, resultNodeRow.id),
          eq(edges.relation, 'produced'),
        ),
      )
      .orderBy(edges.createdAt, edges.id)
      .limit(1)

    let edgeRow: EdgeRowShape
    if (existingEdge) {
      const [updated] = await tx
        .update(edges)
        .set({
          status: 'accepted',
          evidenceRunId: run.id,
          confidence: 1,
        })
        .where(eq(edges.id, existingEdge.id))
        .returning(edgeReturning)
      edgeRow = updated
    } else {
      const [inserted] = await tx
        .insert(edges)
        .values({
          workspaceId: scope.workspaceId,
          sourceNodeId: runNodeRow.id,
          targetNodeId: resultNodeRow.id,
          relation: 'produced',
          status: 'accepted',
          evidenceRunId: run.id,
          confidence: 1,
        })
        .returning(edgeReturning)
      edgeRow = inserted
      created = true
    }

    return {
      runId: run.id,
      workspaceId: scope.workspaceId,
      runNode: toGraphNode(runNodeRow),
      resultNode: toGraphNode(resultNodeRow),
      edge: toGraphEdge(edgeRow),
      created,
    }
  })
}
