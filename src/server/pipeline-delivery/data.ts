/**
 * The delivery layer's data port, and its production Drizzle adapter.
 *
 * Everything the stream and approval handlers need from Postgres is named
 * here. The production adapter is a thin pass-through to the merged `#37`
 * contracts in `src/db/pipeline.ts`; it adds only the two reads that layer
 * deliberately does not own (the experiment scope and workspace membership).
 *
 * The port exists so the app layer can be exercised against a real Postgres
 * database with the `pg` driver in tests. The SQL is the same; only the client
 * class differs, which is why the test adapter casts the client type and why
 * the cast is visible in `test-support/pg.ts` rather than hidden here.
 */
import { and, eq } from 'drizzle-orm'
import type { Database } from '../../db/client'
import {
  appendPipelineEvent,
  claimExecutionStart,
  decideApproval,
  getApprovalGate,
  getExecutionClaim,
  getExperimentApprovalState,
  openApprovalGate,
  replayPipelineEvents,
} from '../../db/pipeline'
import type {
  AppendPipelineEventInput,
  ApprovalGateView,
  ClaimExecutionStartInput,
  ClaimExecutionStartResult,
  DecideApprovalInput,
  DecideApprovalResult,
  ExecutionClaimView,
  ExperimentApprovalView,
  GetApprovalGateInput,
  GetExecutionClaimInput,
  GetExperimentApprovalStateInput,
  OpenApprovalGateInput,
  OpenApprovalGateResult,
  ReplayPipelineEventsInput,
  ReplayPipelineEventsResult,
} from '../../db/pipeline'
import { experiments, workspaceMembers } from '../../db/schema'
import type { PipelineEvent } from '../../shared/events'
import type { ApprovalState, Mode } from '../../shared/types'

/** The experiment fields a stream needs before it has any claim. */
export type ExperimentScope = {
  id: string
  workspaceId: string
  claimNodeId: string
  mode: Mode
  approvalState: ApprovalState
}

export type WorkspaceMemberView = {
  workspaceId: string
  userId: string
  role: string
}

/**
 * The complete data surface of the pipeline transport.
 *
 * Deliberately no `runs` or `nodes` writes: those belong to the runtime
 * workstream and to `#7`'s integration seam. This layer only moves pipeline
 * events, the execution claim, and the approval gate.
 */
export type PipelineData = {
  findExperiment(experimentId: string): Promise<ExperimentScope | null>
  findWorkspaceMember(input: {
    userId: string
    workspaceId: string
  }): Promise<WorkspaceMemberView | null>
  claimExecutionStart(
    input: ClaimExecutionStartInput,
  ): Promise<ClaimExecutionStartResult>
  getExecutionClaim(
    input: GetExecutionClaimInput,
  ): Promise<ExecutionClaimView | null>
  appendPipelineEvent(
    input: AppendPipelineEventInput,
  ): Promise<PipelineEvent>
  replayPipelineEvents(
    input: ReplayPipelineEventsInput,
  ): Promise<ReplayPipelineEventsResult>
  openApprovalGate(
    input: OpenApprovalGateInput,
  ): Promise<OpenApprovalGateResult>
  getApprovalGate(input: GetApprovalGateInput): Promise<ApprovalGateView | null>
  decideApproval(input: DecideApprovalInput): Promise<DecideApprovalResult>
  getExperimentApprovalState(
    input: GetExperimentApprovalStateInput,
  ): Promise<ExperimentApprovalView | null>
}

/** The production adapter over the Neon/Drizzle client. */
export function createDrizzlePipelineData(db: Database): PipelineData {
  return {
    async findExperiment(experimentId) {
      const [row] = await db
        .select({
          id: experiments.id,
          workspaceId: experiments.workspaceId,
          claimNodeId: experiments.claimNodeId,
          mode: experiments.mode,
          approvalState: experiments.approvalState,
        })
        .from(experiments)
        .where(eq(experiments.id, experimentId))
        .limit(1)

      return row ?? null
    },

    async findWorkspaceMember({ userId, workspaceId }) {
      const [row] = await db
        .select({
          workspaceId: workspaceMembers.workspaceId,
          userId: workspaceMembers.userId,
          role: workspaceMembers.role,
        })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, userId),
          ),
        )
        .limit(1)

      return row ?? null
    },

    claimExecutionStart: (input) => claimExecutionStart(db, input),
    getExecutionClaim: (input) => getExecutionClaim(db, input),
    appendPipelineEvent: (input) => appendPipelineEvent(db, input),
    replayPipelineEvents: (input) => replayPipelineEvents(db, input),
    openApprovalGate: (input) => openApprovalGate(db, input),
    getApprovalGate: (input) => getApprovalGate(db, input),
    decideApproval: (input) => decideApproval(db, input),
    getExperimentApprovalState: (input) =>
      getExperimentApprovalState(db, input),
  }
}
