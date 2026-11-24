/**
 * The human approval gate: open it around an exact plan, decide it once.
 *
 * Gate identity is the persisted `approval.requested` seq. Opening the gate,
 * writing that event, and storing the offered spec happen in one transaction.
 * Deciding writes the gate, `experiments.approval_state` / `approved_by` /
 * `approved_at`, and the `approval.resolved` event in one transaction, so a
 * cross-request approval is either wholly visible or not visible at all.
 *
 * The layer records the actor id the transport supplies. It does not
 * authenticate anyone; auth is a route concern (#6 parent / #7).
 */
import { and, eq, sql } from 'drizzle-orm'
import type { Database } from './client'
import { approvalGates, experiments } from './schema'
import type {
  ApprovalGateView,
  DecideApprovalInput,
  DecideApprovalResult,
  ExperimentApprovalView,
  GetApprovalGateInput,
  GetExperimentApprovalStateInput,
  OpenApprovalGateInput,
  OpenApprovalGateResult,
} from './pipeline-types'
import {
  appendEventLocked,
  lockExecutionClaim,
  lockExperiment,
  readEventBySeq,
  selectApprovalGate,
  type PipelineDb,
} from './pipeline-internals'
import {
  PipelineDbError,
  requireActorId,
  requireApprovalDecision,
  requireClaimId,
  requireExperimentId,
  requireObjectInput,
  requireSequence,
  requireWorkspaceId,
  validateExperimentSpec,
} from './pipeline-validation'

/**
 * Opens (or idempotently returns) the gate for an active claim.
 *
 * Repeating the call with the same claim and the same offered spec returns the
 * existing gate and event with `created: false`; it does not append a second
 * `approval.requested`. A different spec against the same open gate is
 * `GATE_CONFLICT`, because the human is entitled to decide the plan that was
 * actually put in front of them.
 */
export async function openApprovalGate(
  db: Database,
  input: OpenApprovalGateInput,
): Promise<OpenApprovalGateResult> {
  const data = requireObjectInput(input, 'input')
  const experimentId = requireExperimentId(data.experimentId)
  const workspaceId = requireWorkspaceId(data.workspaceId)
  const claimId = requireClaimId(data.claimId)
  const spec = validateExperimentSpec(data.spec)

  return db.transaction(async (tx) => {
    const experiment = await lockExperiment(tx, experimentId, workspaceId)
    if (experiment.approvalState !== 'pending') {
      throw new PipelineDbError(
        'APPROVAL_STATE_CONFLICT',
        `experiment approval state is '${experiment.approvalState}', not 'pending'`,
      )
    }
    if (spec.claimNodeId !== experiment.claimNodeId) {
      throw new PipelineDbError(
        'SPEC_CLAIM_MISMATCH',
        'spec.claimNodeId does not match the experiment claim node',
      )
    }

    const { claim, claimId: storedClaimId } = await lockExecutionClaim(
      tx,
      experimentId,
      workspaceId,
    )
    if (storedClaimId !== claimId) {
      throw new PipelineDbError(
        'CLAIM_MISMATCH',
        'the supplied claimId does not own this experiment',
      )
    }
    if (claim.closedAt !== null) {
      throw new PipelineDbError(
        'CLAIM_CLOSED',
        'the execution claim has already ended',
      )
    }
    if (claim.expired) {
      throw new PipelineDbError(
        'CLAIM_EXPIRED',
        'the execution claim has expired; it is never renewed automatically',
      )
    }

    const existing = await selectApprovalGate(tx, {
      experimentId,
      workspaceId,
      executionClaimId: claim.id,
    })

    if (existing) {
      if (existing.status !== 'pending') {
        throw new PipelineDbError(
          'GATE_ALREADY_DECIDED',
          `the approval gate was already ${existing.status}`,
        )
      }

      // Compare JSONB structurally: key order is not part of the plan.
      const [sameSpec] = await tx
        .select({
          equal: sql<boolean>`${approvalGates.offeredSpec} = ${JSON.stringify(spec)}::jsonb`,
        })
        .from(approvalGates)
        .where(eq(approvalGates.id, existing.id))
        .limit(1)

      if (!sameSpec?.equal) {
        throw new PipelineDbError(
          'GATE_CONFLICT',
          'a different plan is already open at this gate',
        )
      }

      const event = await readEventBySeq(tx, experimentId, existing.gateSeq)
      if (event.type !== 'approval.requested') {
        throw new PipelineDbError(
          'DATA_CORRUPT',
          `gate seq ${existing.gateSeq} is not an approval.requested event`,
        )
      }
      return { gate: existing, event, created: false }
    }

    const event = await appendEventLocked(tx, {
      experimentId,
      workspaceId,
      input: { type: 'approval.requested', spec },
    })
    if (event.type !== 'approval.requested') {
      throw new PipelineDbError(
        'DATA_CORRUPT',
        'approval gate open wrote the wrong event type',
      )
    }

    await tx.insert(approvalGates).values({
      experimentId,
      workspaceId,
      executionClaimId: claim.id,
      gateSeq: event.seq,
      offeredSpec: spec,
      status: 'pending',
    })

    const gate = await selectApprovalGate(tx, {
      experimentId,
      workspaceId,
      gateSeq: event.seq,
    })
    if (!gate) {
      throw new PipelineDbError(
        'DATA_CORRUPT',
        'approval gate insert succeeded but the gate could not be read back',
      )
    }

    return { gate, event, created: true }
  })
}

/**
 * Records exactly one decision for one pending gate.
 *
 * The decision is scoped to the experiment/workspace, the exact gate seq, and
 * the active unexpired claim. Concurrent opposite decisions serialize on the
 * experiment row and the gate row; the loser sees the winner's status and gets
 * `GATE_ALREADY_DECIDED`.
 *
 * Repeating the identical decision (same decision, same actor) returns
 * `replayed` and writes nothing. Same decision with a different actor is not
 * treated as a replay: it would misattribute the approval.
 */
export async function decideApproval(
  db: Database,
  input: DecideApprovalInput,
): Promise<DecideApprovalResult> {
  const data = requireObjectInput(input, 'input')
  const experimentId = requireExperimentId(data.experimentId)
  const workspaceId = requireWorkspaceId(data.workspaceId)
  const gateSeq = requireSequence(data.gateSeq, 'gateSeq')
  const decision = requireApprovalDecision(data.decision)
  const actorId = requireActorId(data.actorId)

  return db.transaction(async (tx) => {
    const experiment = await lockExperiment(tx, experimentId, workspaceId)

    const [gateRow] = await tx
      .select({
        id: approvalGates.id,
        executionClaimId: approvalGates.executionClaimId,
        status: approvalGates.status,
        decidedBy: approvalGates.decidedBy,
        decisionEventSeq: approvalGates.decisionEventSeq,
      })
      .from(approvalGates)
      .where(
        and(
          eq(approvalGates.experimentId, experimentId),
          eq(approvalGates.workspaceId, workspaceId),
          eq(approvalGates.gateSeq, gateSeq),
        ),
      )
      .for('update')

    if (!gateRow) {
      throw new PipelineDbError(
        'GATE_NOT_FOUND',
        'no approval gate with that seq exists in this experiment',
      )
    }

    if (gateRow.status !== 'pending') {
      const identical =
        gateRow.status === decision && gateRow.decidedBy === actorId

      if (!identical) {
        throw new PipelineDbError(
          'GATE_ALREADY_DECIDED',
          `the approval gate was already ${gateRow.status}`,
        )
      }

      if (
        experiment.approvalState !== gateRow.status ||
        experiment.approvedBy !== actorId
      ) {
        throw new PipelineDbError(
          'APPROVAL_STATE_CONFLICT',
          'the gate and experiments.approval_state disagree about this decision',
        )
      }
      if (gateRow.decisionEventSeq === null) {
        throw new PipelineDbError(
          'DATA_CORRUPT',
          'a decided gate has no decision event seq',
        )
      }

      const event = await readEventBySeq(
        tx,
        experimentId,
        gateRow.decisionEventSeq,
      )
      if (
        event.type !== 'approval.resolved' ||
        event.state !== decision ||
        event.approvedBy !== actorId
      ) {
        throw new PipelineDbError(
          'DATA_CORRUPT',
          'the recorded decision event does not match the gate decision',
        )
      }

      const gate = await selectApprovalGate(tx, {
        experimentId,
        workspaceId,
        gateSeq,
      })
      if (!gate) {
        throw new PipelineDbError(
          'DATA_CORRUPT',
          'decided gate could not be read back',
        )
      }
      return { outcome: 'replayed', decision, gate, event }
    }

    // Pending gate: the decision must belong to the experiment's active,
    // unexpired claim and must not be applied after a terminal transition.
    const { claim } = await lockExecutionClaim(tx, experimentId, workspaceId)
    if (claim.id !== gateRow.executionClaimId) {
      // A gate from a superseded claim is not the outstanding gate.
      throw new PipelineDbError(
        'GATE_NOT_FOUND',
        'the gate does not belong to the current execution claim',
      )
    }
    if (claim.closedAt !== null) {
      throw new PipelineDbError(
        'CLAIM_CLOSED',
        'the execution claim has already ended',
      )
    }
    if (claim.expired) {
      throw new PipelineDbError(
        'CLAIM_EXPIRED',
        'the execution claim has expired; the gate can no longer be decided',
      )
    }
    if (experiment.approvalState !== 'pending') {
      throw new PipelineDbError(
        'APPROVAL_STATE_CONFLICT',
        `experiment approval state is '${experiment.approvalState}', not 'pending'`,
      )
    }

    // Append first so the event seq can be recorded on the gate in the same
    // transaction. Any later failure rolls the event back too.
    const event = await appendEventLocked(tx, {
      experimentId,
      workspaceId,
      input: {
        type: 'approval.resolved',
        state: decision,
        approvedBy: actorId,
      },
    })
    if (event.type !== 'approval.resolved') {
      throw new PipelineDbError(
        'DATA_CORRUPT',
        'approval decision wrote the wrong event type',
      )
    }

    const [updatedGate] = await tx
      .update(approvalGates)
      .set({
        status: decision,
        decidedBy: actorId,
        decidedAt: sql`clock_timestamp()`,
        decisionEventSeq: event.seq,
      })
      .where(
        and(
          eq(approvalGates.id, gateRow.id),
          eq(approvalGates.status, 'pending'),
        ),
      )
      .returning({ id: approvalGates.id })

    if (!updatedGate) {
      throw new PipelineDbError(
        'GATE_ALREADY_DECIDED',
        'the approval gate was decided concurrently',
      )
    }

    // The cross-request source the SSE handler polls. `approved_by` and
    // `approved_at` record the decider and time for a rejection too; the
    // column names are frozen by docs/02-data-model.md.
    const [updatedExperiment] = await tx
      .update(experiments)
      .set({
        approvalState: decision,
        approvedBy: actorId,
        approvedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(experiments.id, experimentId),
          eq(experiments.workspaceId, workspaceId),
          eq(experiments.approvalState, 'pending'),
        ),
      )
      .returning({ id: experiments.id })

    if (!updatedExperiment) {
      throw new PipelineDbError(
        'APPROVAL_STATE_CONFLICT',
        'experiments.approval_state was not pending when the decision committed',
      )
    }

    const gate = await selectApprovalGate(tx, {
      experimentId,
      workspaceId,
      gateSeq,
    })
    if (!gate) {
      throw new PipelineDbError(
        'DATA_CORRUPT',
        'decided gate could not be read back',
      )
    }

    return { outcome: 'decided', decision, gate, event }
  })
}

/** Latest gate, or one exact gate, scoped to the workspace. */
export async function getApprovalGate(
  db: PipelineDb,
  input: GetApprovalGateInput,
): Promise<ApprovalGateView | null> {
  const data = requireObjectInput(input, 'input')
  const experimentId = requireExperimentId(data.experimentId)
  const workspaceId = requireWorkspaceId(data.workspaceId)
  const gateSeq =
    data.gateSeq === undefined
      ? undefined
      : requireSequence(data.gateSeq, 'gateSeq')

  return selectApprovalGate(db, { experimentId, workspaceId, gateSeq })
}

/**
 * Reads the cross-request approval source. The transport polls this after it
 * opens a gate; the gate row remains the audit record of the decision.
 */
export async function getExperimentApprovalState(
  db: PipelineDb,
  input: GetExperimentApprovalStateInput,
): Promise<ExperimentApprovalView | null> {
  const data = requireObjectInput(input, 'input')
  const experimentId = requireExperimentId(data.experimentId)
  const workspaceId = requireWorkspaceId(data.workspaceId)

  const [row] = await db
    .select({
      approvalState: experiments.approvalState,
      approvedBy: experiments.approvedBy,
      approvedAt: experiments.approvedAt,
    })
    .from(experiments)
    .where(
      and(
        eq(experiments.id, experimentId),
        eq(experiments.workspaceId, workspaceId),
      ),
    )
    .limit(1)

  return row ?? null
}
