/**
 * Shared internals for the pipeline DB operations.
 *
 * The one rule every write path follows: take the experiment row lock first
 * (`lockExperiment`). That lock is the per-experiment serialization point for
 * event append, claim creation, gate opening and gate decision. Because a
 * waiting transaction acquires the lock only after the previous writer
 * commits, sequence order and commit order cannot disagree.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from './client'
import type { PipelineEvent } from '../shared/events'
import type { ApprovalState } from '../shared/types'
import {
  approvalGates,
  executionClaims,
  experiments,
  pipelineEvents,
  type ApprovalGateStatus,
  type ExecutionClaimCloseReason,
} from './schema'
import type { ApprovalGateView, ExecutionClaimView } from './pipeline-types'
import type { PipelineEventInput } from './pipeline-validation'
import {
  PipelineDbError,
  TERMINAL_PIPELINE_EVENT_TYPES,
  isTerminalEventType,
  validatePipelineEvent,
  validateStoredPipelineEvent,
} from './pipeline-validation'

/**
 * The query surface shared by `Database` and a transaction. Reads accept this
 * so they can run both inside and outside a transaction.
 */
export type PipelineDb = Pick<
  Database,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>

/** The transaction handle produced by `Database['transaction']`. */
export type Transaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0]

// ---------------------------------------------------------------------------
// Experiment lock
// ---------------------------------------------------------------------------

export type LockedExperiment = {
  id: string
  workspaceId: string
  claimNodeId: string
  approvalState: ApprovalState
  approvedBy: string | null
}

/**
 * Locks and returns the experiment, scoped to its workspace. A missing id and
 * an id from another workspace produce the same error on purpose: existence
 * in another workspace is not disclosed.
 */
export async function lockExperiment(
  db: PipelineDb,
  experimentId: string,
  workspaceId: string,
): Promise<LockedExperiment> {
  const [row] = await db
    .select({
      id: experiments.id,
      workspaceId: experiments.workspaceId,
      claimNodeId: experiments.claimNodeId,
      approvalState: experiments.approvalState,
      approvedBy: experiments.approvedBy,
    })
    .from(experiments)
    .where(
      and(
        eq(experiments.id, experimentId),
        eq(experiments.workspaceId, workspaceId),
      ),
    )
    .for('update')

  if (!row) {
    throw new PipelineDbError(
      'EXPERIMENT_NOT_FOUND',
      'experiment not found in this workspace',
    )
  }
  return row
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

const claimViewSelection = {
  id: executionClaims.id,
  experimentId: executionClaims.experimentId,
  workspaceId: executionClaims.workspaceId,
  claimId: executionClaims.claimId,
  claimedAt: executionClaims.claimedAt,
  expiresAt: executionClaims.expiresAt,
  closedAt: executionClaims.closedAt,
  closeReason: executionClaims.closeReason,
  expired: sql<boolean>`${executionClaims.closedAt} is null and ${executionClaims.expiresAt} <= clock_timestamp()`,
}

type ClaimViewRow = {
  id: string
  experimentId: string
  workspaceId: string
  claimedAt: Date
  expiresAt: Date
  closedAt: Date | null
  closeReason: ExecutionClaimCloseReason | null
  expired: boolean
}

export function toExecutionClaimView(
  row: ClaimViewRow,
): ExecutionClaimView {
  return {
    id: row.id,
    experimentId: row.experimentId,
    workspaceId: row.workspaceId,
    claimedAt: row.claimedAt,
    expiresAt: row.expiresAt,
    closedAt: row.closedAt,
    closeReason: row.closeReason,
    // One database-clock comparison decides both flags; reading them from two
    // SQL expressions could straddle the expiry instant and report neither.
    active: row.closedAt === null && !row.expired,
    expired: row.expired,
  }
}

export async function selectExecutionClaim(
  db: PipelineDb,
  experimentId: string,
  workspaceId: string,
): Promise<ExecutionClaimView | null> {
  const [row] = await db
    .select(claimViewSelection)
    .from(executionClaims)
    .where(
      and(
        eq(executionClaims.experimentId, experimentId),
        eq(executionClaims.workspaceId, workspaceId),
      ),
    )
    .limit(1)
  return row ? toExecutionClaimView(row) : null
}

export async function lockExecutionClaim(
  db: PipelineDb,
  experimentId: string,
  workspaceId: string,
): Promise<{ claim: ExecutionClaimView; claimId: string }> {
  const [row] = await db
    .select(claimViewSelection)
    .from(executionClaims)
    .where(
      and(
        eq(executionClaims.experimentId, experimentId),
        eq(executionClaims.workspaceId, workspaceId),
      ),
    )
    .for('update')

  if (!row) {
    throw new PipelineDbError(
      'CLAIM_NOT_FOUND',
      'no execution claim exists for this experiment',
    )
  }
  return { claim: toExecutionClaimView(row), claimId: row.claimId }
}

// ---------------------------------------------------------------------------
// Event append
// ---------------------------------------------------------------------------

export type AppendEventLockedParams = {
  experimentId: string
  workspaceId: string
  input: PipelineEventInput
}

/**
 * Appends one event. The caller must already hold the experiment row lock.
 *
 * - `seq` is `max(seq) + 1`, which is safe because the experiment lock
 *   serializes appends for this experiment.
 * - A terminal event is refused once any terminal event exists, so a stale
 *   writer cannot publish after the pipeline ended.
 * - Appending a terminal event closes the claim in the same transaction.
 */
export async function appendEventLocked(
  db: PipelineDb,
  params: AppendEventLockedParams,
): Promise<PipelineEvent> {
  const { experimentId, workspaceId, input } = params

  const [terminal] = await db
    .select({ id: pipelineEvents.id })
    .from(pipelineEvents)
    .where(
      and(
        eq(pipelineEvents.experimentId, experimentId),
        inArray(pipelineEvents.type, [...TERMINAL_PIPELINE_EVENT_TYPES]),
      ),
    )
    .limit(1)

  if (terminal) {
    throw new PipelineDbError(
      'EXPERIMENT_TERMINAL',
      'the pipeline for this experiment has already reached a terminal event',
    )
  }

  const [head] = await db
    .select({
      seq: sql<number>`coalesce(max(${pipelineEvents.seq}), 0)`,
    })
    .from(pipelineEvents)
    .where(eq(pipelineEvents.experimentId, experimentId))

  const nextSeq = Number(head?.seq ?? 0) + 1
  if (nextSeq > 2_147_483_647) {
    throw new PipelineDbError(
      'SEQUENCE_EXHAUSTED',
      'pipeline event sequence exceeded the int4 range',
    )
  }

  const at = input.at ?? new Date().toISOString()
  const event = {
    ...input,
    seq: nextSeq,
    experimentId,
    at,
  } as PipelineEvent

  // Final guard over the complete event, including the fields assigned here.
  validatePipelineEvent(event)

  await db.insert(pipelineEvents).values({
    experimentId,
    workspaceId,
    seq: event.seq,
    type: event.type,
    event,
  })

  if (isTerminalEventType(event.type)) {
    await db
      .update(executionClaims)
      .set({
        closedAt: sql`clock_timestamp()`,
        closeReason: closeReasonForTerminal(event.type),
      })
      .where(
        and(
          eq(executionClaims.experimentId, experimentId),
          eq(executionClaims.workspaceId, workspaceId),
          sql`${executionClaims.closedAt} is null`,
        ),
      )
  }

  return event
}

export function closeReasonForTerminal(
  type: 'pipeline.completed' | 'pipeline.failed' | 'pipeline.cancelled',
): ExecutionClaimCloseReason {
  switch (type) {
    case 'pipeline.completed':
      return 'completed'
    case 'pipeline.failed':
      return 'failed'
    case 'pipeline.cancelled':
      return 'cancelled'
  }
}

export async function readEventBySeq(
  db: PipelineDb,
  experimentId: string,
  seq: number,
): Promise<PipelineEvent> {
  const [row] = await db
    .select({
      seq: pipelineEvents.seq,
      type: pipelineEvents.type,
      event: pipelineEvents.event,
    })
    .from(pipelineEvents)
    .where(
      and(
        eq(pipelineEvents.experimentId, experimentId),
        eq(pipelineEvents.seq, seq),
      ),
    )
    .limit(1)

  if (!row) {
    throw new PipelineDbError(
      'DATA_CORRUPT',
      `event seq ${seq} referenced by an approval gate does not exist`,
    )
  }
  return validateStoredPipelineEvent(row.event, {
    experimentId,
    seq: row.seq,
    type: row.type,
  })
}

// ---------------------------------------------------------------------------
// Approval gate read
// ---------------------------------------------------------------------------

export type ApprovalGateFilter = {
  experimentId: string
  workspaceId: string
  gateSeq?: number
  executionClaimId?: string
  repairParentRunId?: string | null
}

export async function selectApprovalGate(
  db: PipelineDb,
  filter: ApprovalGateFilter,
): Promise<ApprovalGateView | null> {
  const [row] = await db
    .select({
      id: approvalGates.id,
      experimentId: approvalGates.experimentId,
      workspaceId: approvalGates.workspaceId,
      executionClaimId: approvalGates.executionClaimId,
      gateSeq: approvalGates.gateSeq,
      status: approvalGates.status,
      offeredSpec: approvalGates.offeredSpec,
      repairParentRunId: approvalGates.repairParentRunId,
      decidedBy: approvalGates.decidedBy,
      decidedAt: approvalGates.decidedAt,
      decisionEventSeq: approvalGates.decisionEventSeq,
      createdAt: approvalGates.createdAt,
      claimClosedAt: executionClaims.closedAt,
      claimCloseReason: executionClaims.closeReason,
      claimExpired: sql<boolean>`${executionClaims.closedAt} is null and ${executionClaims.expiresAt} <= clock_timestamp()`,
    })
    .from(approvalGates)
    .innerJoin(
      executionClaims,
      eq(executionClaims.id, approvalGates.executionClaimId),
    )
    .where(
      and(
        eq(approvalGates.experimentId, filter.experimentId),
        eq(approvalGates.workspaceId, filter.workspaceId),
        filter.gateSeq === undefined
          ? undefined
          : eq(approvalGates.gateSeq, filter.gateSeq),
        filter.executionClaimId === undefined
          ? undefined
          : eq(approvalGates.executionClaimId, filter.executionClaimId),
        filter.repairParentRunId === null
          ? isNull(approvalGates.repairParentRunId)
          : filter.repairParentRunId === undefined
            ? undefined
            : eq(approvalGates.repairParentRunId, filter.repairParentRunId),
      ),
    )
    .orderBy(desc(approvalGates.gateSeq))
    .limit(1)

  if (!row) return null

  return {
    id: row.id,
    experimentId: row.experimentId,
    workspaceId: row.workspaceId,
    executionClaimId: row.executionClaimId,
    gateSeq: row.gateSeq,
    status: row.status as ApprovalGateStatus,
    offeredSpec: row.offeredSpec,
    repairParentRunId: row.repairParentRunId,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionEventSeq: row.decisionEventSeq,
    createdAt: row.createdAt,
    claim: {
      active: row.claimClosedAt === null && !row.claimExpired,
      expired: row.claimExpired,
      closedAt: row.claimClosedAt,
      closeReason: row.claimCloseReason,
    },
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** True for a PostgreSQL unique-violation, including Drizzle-wrapped causes. */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current !== null && depth < 6; depth += 1) {
    if (typeof current === 'object' && 'code' in current) {
      if ((current as { code?: unknown }).code === '23505') return true
    }
    if (typeof current !== 'object' || !('cause' in current)) break
    current = (current as { cause?: unknown }).cause
  }
  return false
}
