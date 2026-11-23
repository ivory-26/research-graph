/**
 * Durable, ordered pipeline event append and replay.
 *
 * The caller owns event meaning; the database owns order. `seq` is assigned
 * under the experiment row lock, so concurrent appends cannot duplicate a
 * sequence, leave a committed gap, or commit out of order. Replay is strictly
 * `seq > afterSeq`, which is exactly Last-Event-ID semantics.
 */
import { and, eq, gt, sql } from 'drizzle-orm'
import type { PipelineEvent } from '../shared/events'
import type { Database } from './client'
import { experiments, pipelineEvents } from './schema'
import type {
  AppendPipelineEventInput,
  ReplayPipelineEventsInput,
  ReplayPipelineEventsResult,
} from './pipeline-types'
import {
  appendEventLocked,
  lockExperiment,
  type PipelineDb,
} from './pipeline-internals'
import {
  PipelineDbError,
  RESERVED_APPEND_EVENT_TYPES,
  requireCursor,
  requireExperimentId,
  requireLimit,
  requireObjectInput,
  requireWorkspaceId,
  validatePipelineEventInput,
  validateStoredPipelineEvent,
} from './pipeline-validation'

/**
 * Appends one event to the experiment's log and returns the complete event,
 * including the assigned `seq` and `at`.
 *
 * `approval.requested` and `approval.resolved` are refused here: they are only
 * written by `openApprovalGate` / `decideApproval`, which write the gate row
 * and the experiment approval state in the same transaction.
 */
export async function appendPipelineEvent(
  db: Database,
  input: AppendPipelineEventInput,
): Promise<PipelineEvent> {
  const data = requireObjectInput(input, 'input')
  const experimentId = requireExperimentId(data.experimentId)
  const workspaceId = requireWorkspaceId(data.workspaceId)

  const eventInput: unknown = data.event
  validatePipelineEventInput(eventInput)

  if (
    (RESERVED_APPEND_EVENT_TYPES as readonly string[]).includes(
      eventInput.type,
    )
  ) {
    throw new PipelineDbError(
      'INVALID_EVENT',
      `${eventInput.type} must be written by openApprovalGate or decideApproval`,
    )
  }

  return db.transaction(async (tx) => {
    await lockExperiment(tx, experimentId, workspaceId)
    return appendEventLocked(tx, {
      experimentId,
      workspaceId,
      input: eventInput,
    })
  })
}

/**
 * Replays persisted events after an exclusive cursor.
 *
 * `afterSeq` defaults to 0 (everything). A cursor ahead of the persisted head
 * is rejected rather than silently returning an empty page: that cursor came
 * from another experiment or a corrupted client, and the transport should
 * know.
 */
export async function replayPipelineEvents(
  db: PipelineDb,
  input: ReplayPipelineEventsInput,
): Promise<ReplayPipelineEventsResult> {
  const data = requireObjectInput(input, 'input')
  const experimentId = requireExperimentId(data.experimentId)
  const workspaceId = requireWorkspaceId(data.workspaceId)
  const afterSeq =
    data.afterSeq === undefined ? 0 : requireCursor(data.afterSeq)
  const limit = data.limit === undefined ? 500 : requireLimit(data.limit)

  const [experiment] = await db
    .select({ id: experiments.id })
    .from(experiments)
    .where(
      and(
        eq(experiments.id, experimentId),
        eq(experiments.workspaceId, workspaceId),
      ),
    )
    .limit(1)

  if (!experiment) {
    throw new PipelineDbError(
      'EXPERIMENT_NOT_FOUND',
      'experiment not found in this workspace',
    )
  }

  const [head] = await db
    .select({
      seq: sql<number>`coalesce(max(${pipelineEvents.seq}), 0)`,
    })
    .from(pipelineEvents)
    .where(
      and(
        eq(pipelineEvents.experimentId, experimentId),
        eq(pipelineEvents.workspaceId, workspaceId),
      ),
    )

  const headSeq = Number(head?.seq ?? 0)
  if (afterSeq > headSeq) {
    throw new PipelineDbError(
      'INVALID_CURSOR',
      `afterSeq ${afterSeq} is ahead of the persisted head ${headSeq}`,
    )
  }

  const rows = await db
    .select({
      seq: pipelineEvents.seq,
      type: pipelineEvents.type,
      event: pipelineEvents.event,
      // Window max is computed over the whole filtered set before LIMIT, so
      // the returned head cannot disagree with the returned page even if
      // another append commits between the head query above and this query.
      pageHeadSeq: sql<number>`max(${pipelineEvents.seq}) over ()`,
    })
    .from(pipelineEvents)
    .where(
      and(
        eq(pipelineEvents.experimentId, experimentId),
        eq(pipelineEvents.workspaceId, workspaceId),
        gt(pipelineEvents.seq, afterSeq),
      ),
    )
    .orderBy(pipelineEvents.seq)
    .limit(limit + 1)

  const events = rows
    .slice(0, limit)
    .map((row) =>
      validateStoredPipelineEvent(row.event, {
        experimentId,
        seq: row.seq,
        type: row.type,
      }),
    )

  // No rows means the cursor is already at the head (the ahead check above
  // rejected cursors beyond it), so afterSeq is the head.
  const pageHeadSeq =
    rows.length === 0 ? afterSeq : Number(rows[0].pageHeadSeq)

  return {
    events,
    headSeq: pageHeadSeq,
    hasMore: rows.length > limit,
  }
}
