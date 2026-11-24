/**
 * Atomic, idempotent execution-start claims.
 *
 * One claim can ever exist per experiment. The claim is permission to start a
 * pipeline run, not a run row; this module never writes `runs`. A reconnect,
 * a replay after completion, or a reconnect after expiry observes the same
 * claim and is never allowed to start another run. An explicit retry is a
 * separate product decision and is deliberately not expressible here.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from './client'
import { executionClaims, pipelineEvents } from './schema'
import type {
  ClaimExecutionStartInput,
  ClaimExecutionStartResult,
  ExecutionClaimView,
  GetExecutionClaimInput,
} from './pipeline-types'
import {
  isUniqueViolation,
  lockExperiment,
  selectExecutionClaim,
  toExecutionClaimView,
  type PipelineDb,
} from './pipeline-internals'
import {
  PipelineDbError,
  TERMINAL_PIPELINE_EVENT_TYPES,
  requireClaimId,
  requireExperimentId,
  requireObjectInput,
  requireTtlMs,
  requireWorkspaceId,
} from './pipeline-validation'

/**
 * Attempts to create the experiment's one execution claim.
 *
 * Only `outcome: 'claimed'` authorizes a start. `duplicate` is the same
 * idempotency key and `already_claimed` is a different one; neither may start
 * a run, even when the existing claim is still active. That is what makes a
 * reconnect harmless.
 */
export async function claimExecutionStart(
  db: Database,
  input: ClaimExecutionStartInput,
): Promise<ClaimExecutionStartResult> {
  const data = requireObjectInput(input, 'input')
  const experimentId = requireExperimentId(data.experimentId)
  const workspaceId = requireWorkspaceId(data.workspaceId)
  const claimId = requireClaimId(data.claimId)
  const ttlMs = requireTtlMs(data.ttlMs)

  return db.transaction(async (tx) => {
    // The experiment lock serializes this against another claim attempt and
    // against event/gate writers for the same experiment.
    await lockExperiment(tx, experimentId, workspaceId)

    const [existing] = await tx
      .select({
        id: executionClaims.id,
        experimentId: executionClaims.experimentId,
        workspaceId: executionClaims.workspaceId,
        claimId: executionClaims.claimId,
        claimedAt: executionClaims.claimedAt,
        expiresAt: executionClaims.expiresAt,
        closedAt: executionClaims.closedAt,
        closeReason: executionClaims.closeReason,
        expired: sql<boolean>`${executionClaims.closedAt} is null and ${executionClaims.expiresAt} <= clock_timestamp()`,
      })
      .from(executionClaims)
      .where(
        and(
          eq(executionClaims.experimentId, experimentId),
          eq(executionClaims.workspaceId, workspaceId),
        ),
      )
      .limit(1)

    if (existing) {
      return {
        outcome:
          existing.claimId === claimId ? 'duplicate' : 'already_claimed',
        claim: toExecutionClaimView(existing),
      }
    }

    // Defensive: a terminal event without a claim should not happen (the
    // terminal append closes the claim), but if rows were written around this
    // layer, never start a new run after a terminal transition.
    const [terminal] = await tx
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

    try {
      await tx.insert(executionClaims).values({
        experimentId,
        workspaceId,
        claimId,
        // clock_timestamp(), not now(): a transaction that waited on the
        // experiment lock must not start its lease in the past.
        expiresAt: sql`clock_timestamp() + (${ttlMs}::double precision * interval '1 millisecond')`,
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        // The claimId is globally unique. Reusing someone else's key is a
        // caller bug, not a second start.
        throw new PipelineDbError(
          'CLAIM_ID_CONFLICT',
          'claimId is already used by another execution claim',
          { cause: error },
        )
      }
      throw error
    }

    const claim = await selectExecutionClaim(tx, experimentId, workspaceId)
    if (!claim) {
      throw new PipelineDbError(
        'DATA_CORRUPT',
        'execution claim insert succeeded but the claim could not be read back',
      )
    }
    return { outcome: 'claimed', claim }
  })
}

/**
 * Read-only observation. Returns `null` for both "no claim" and "experiment
 * not in this workspace", so a caller cannot probe another workspace.
 */
export async function getExecutionClaim(
  db: PipelineDb,
  input: GetExecutionClaimInput,
): Promise<ExecutionClaimView | null> {
  const data = requireObjectInput(input, 'input')
  const experimentId = requireExperimentId(data.experimentId)
  const workspaceId = requireWorkspaceId(data.workspaceId)
  return selectExecutionClaim(db, experimentId, workspaceId)
}
