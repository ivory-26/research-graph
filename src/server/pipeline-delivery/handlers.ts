/**
 * The two raw `Request -> Response` handlers.
 *
 * They are deliberately framework-free: the TanStack Start route adapters in
 * `src/routes` only forward `{ request, params }` into these functions. That
 * keeps the security-relevant logic testable against a real Postgres database
 * without a router, and keeps the route files one line of wiring.
 *
 * Nothing here runs a stage. `stages` is a required dependency for a stream
 * that has to start work; when it is absent the GET returns 503 before it
 * claims anything. There is no built-in fake provider.
 */
import type { PipelineEvent } from '../../shared/events'
import {
  PipelineDbError,
  isTerminalEventType,
} from '../../db/pipeline-validation'
import { parseLastEventId } from '../pipeline-transport'
import {
  assertSameOrigin,
  authorizePipelineExperiment,
  requireExperimentIdParam,
  type ReadVerifiedActor,
} from './authorization'
import type { PipelineData } from './data'
import { PipelineHttpError, toErrorResponse } from './errors'
import type { PipelineStages } from './stages'
import {
  openPipelineStream,
  type PipelineStreamMode,
} from './stream'
import { resolveTimings, type PipelineTimings } from './timings'

export type PipelineRouteParams = {
  experimentId: string
}

export type PipelineHandlerDeps = {
  data: PipelineData
  readActor: ReadVerifiedActor
  /**
   * `./production` supplies the real provider in production. Null only for a
   * caller that deliberately runs without stages; the GET then returns 503
   * before claiming, so the experiment is not burned by a pipeline that
   * cannot run.
   */
  stages: PipelineStages | null
  /** Tests only. Production uses the docs/01 mandates. */
  timings?: Partial<PipelineTimings>
  /** Tests only; defaults to `crypto.randomUUID`. */
  randomUUID?: () => string
}

export type PipelineHandlers = {
  stream(request: Request, params: PipelineRouteParams): Promise<Response>
  approve(request: Request, params: PipelineRouteParams): Promise<Response>
}

const MAX_APPROVAL_BODY_BYTES = 4_096
const INITIAL_REPLAY_PAGE = 500
const INITIAL_REPLAY_MAX_PAGES = 20

type ApprovalBody = {
  gateSeq: number
  decision: 'approved' | 'rejected'
}

function requireMethod(request: Request, expected: string): void {
  if (request.method.toUpperCase() !== expected) {
    throw new PipelineHttpError(
      405,
      'METHOD_NOT_ALLOWED',
      `Use ${expected}`,
    )
  }
}

/** Reads every persisted event after the cursor, bounded for safety. */
async function replayBeforeStream(
  data: PipelineData,
  experimentId: string,
  workspaceId: string,
  cursor: number,
): Promise<PipelineEvent[]> {
  const events: PipelineEvent[] = []
  let after = cursor

  for (let page = 0; page < INITIAL_REPLAY_MAX_PAGES; page += 1) {
    const result = await data.replayPipelineEvents({
      experimentId,
      workspaceId,
      afterSeq: after,
      limit: INITIAL_REPLAY_PAGE,
    })
    events.push(...result.events)
    if (!result.hasMore) return events

    const last = result.events[result.events.length - 1]
    if (!last || last.seq <= after) return events
    after = last.seq
  }

  return events
}

async function readApprovalBody(request: Request): Promise<ApprovalBody> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new PipelineHttpError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Content-Type must be application/json',
    )
  }

  const declaredLength = request.headers.get('content-length')
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > MAX_APPROVAL_BODY_BYTES)
  ) {
    throw new PipelineHttpError(
      413,
      'BODY_TOO_LARGE',
      'Approval body is too large',
    )
  }

  const text = await request.text()
  if (text.length > MAX_APPROVAL_BODY_BYTES) {
    throw new PipelineHttpError(
      413,
      'BODY_TOO_LARGE',
      'Approval body is too large',
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new PipelineHttpError(
      400,
      'INVALID_BODY',
      'Approval body must be valid JSON',
    )
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new PipelineHttpError(
      400,
      'INVALID_BODY',
      'Approval body must be a JSON object',
    )
  }

  const record = parsed as Record<string, unknown>
  const gateSeq = record.gateSeq
  if (
    typeof gateSeq !== 'number' ||
    !Number.isSafeInteger(gateSeq) ||
    gateSeq <= 0
  ) {
    throw new PipelineHttpError(
      400,
      'INVALID_BODY',
      'gateSeq must be a positive integer',
    )
  }

  const decision = record.decision
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new PipelineHttpError(
      400,
      'INVALID_BODY',
      "decision must be 'approved' or 'rejected'",
    )
  }

  return { gateSeq, decision }
}

export function createPipelineHandlers(
  deps: PipelineHandlerDeps,
): PipelineHandlers {
  const timings = resolveTimings(deps.timings)
  const randomUUID = deps.randomUUID ?? (() => crypto.randomUUID())

  return {
    /**
     * `GET /api/pipeline/:experimentId`
     *
     * A fresh request without Last-Event-ID may claim the experiment's one
     * execution start. A reconnect, or any request that observes an existing
     * claim, replays and tails instead. Only the claim owner runs stages.
     */
    async stream(request, params) {
      try {
        requireMethod(request, 'GET')
        assertSameOrigin(request)

        const experimentId = requireExperimentIdParam(params.experimentId)
        const { experiment, actor } = await authorizePipelineExperiment({
          request,
          experimentId,
          data: deps.data,
          readActor: deps.readActor,
        })

        const lastEventIdHeader = request.headers.get('last-event-id')
        // EventSource cannot send custom headers; the client encodes the cursor
        // as `?seq=N` on a manual re-open. Treat it as an equivalent of the
        // Last-Event-ID header when the header itself is absent.
        const seqParam = lastEventIdHeader === null
          ? new URL(request.url).searchParams.get('seq')
          : null
        const rawCursor = lastEventIdHeader ?? seqParam
        const parsedCursor = parseLastEventId(rawCursor)
        if (rawCursor !== null && parsedCursor === null) {
          throw new PipelineHttpError(
            400,
            'INVALID_LAST_EVENT_ID',
            'Last-Event-ID must be a non-negative integer',
          )
        }

        // Only an explicit Last-Event-ID header suppresses execution claiming.
        // The client-internal `?seq=N` fallback still sets the replay cursor so
        // seen events are skipped, while allowing a fresh claim if none exists.
        const isReconnect = lastEventIdHeader !== null
        const cursor = parsedCursor ?? 0

        // Validates the cursor against the persisted head before any claim:
        // a cursor from another experiment is a 400, not an empty stream.
        const initialEvents = await replayBeforeStream(
          deps.data,
          experimentId,
          experiment.workspaceId,
          cursor,
        )
        const initialTerminal = initialEvents.some((event) =>
          isTerminalEventType(event.type),
        )

        let mode: PipelineStreamMode = 'follower'
        let ownerClaimId: string | null = null

        if (
          !isReconnect &&
          !initialTerminal &&
          experiment.approvalState === 'pending'
        ) {
          const existingClaim = await deps.data.getExecutionClaim({
            experimentId,
            workspaceId: experiment.workspaceId,
          })

          if (!existingClaim) {
            if (!deps.stages) {
              // This process has no stage provider configured. Refuse before
              // claiming so the experiment is not burned by a pipeline that
              // cannot run.
              throw new PipelineHttpError(
                503,
                'PIPELINE_STAGES_UNAVAILABLE',
                'The pipeline stage provider is not configured',
              )
            }

            const claimId = randomUUID()
            try {
              const claim = await deps.data.claimExecutionStart({
                experimentId,
                workspaceId: experiment.workspaceId,
                claimId,
                ttlMs: timings.claimTtlMs,
              })
              if (claim.outcome === 'claimed') {
                mode = 'owner'
                ownerClaimId = claimId
              }
            } catch (error) {
              if (
                !(
                  error instanceof PipelineDbError &&
                  error.code === 'EXPERIMENT_TERMINAL'
                )
              ) {
                throw error
              }
              // A terminal event won the race: replay it as a follower.
            }
          }
        }

        return openPipelineStream({
          request,
          experiment,
          actor,
          data: deps.data,
          stages: deps.stages,
          mode,
          ownerClaimId,
          cursor,
          initialEvents,
          timings,
        })
      } catch (error) {
        return toErrorResponse(error)
      }
    },

    /**
     * `POST /api/pipeline/:experimentId/approve`
     *
     * Writes exactly one decision to the durable gate, bound to the persisted
     * `approval.requested` seq and to the verified actor. It only updates
     * rows. It never runs a stage, a script, or a sandbox.
     */
    async approve(request, params) {
      try {
        requireMethod(request, 'POST')
        assertSameOrigin(request, { requireOrigin: true })

        const experimentId = requireExperimentIdParam(params.experimentId)
        const { experiment, actor } = await authorizePipelineExperiment({
          request,
          experimentId,
          data: deps.data,
          readActor: deps.readActor,
        })

        const body = await readApprovalBody(request)

        const result = await deps.data.decideApproval({
          experimentId,
          workspaceId: experiment.workspaceId,
          gateSeq: body.gateSeq,
          decision: body.decision,
          actorId: actor.id,
        })

        return Response.json(
          {
            experimentId,
            gateSeq: result.gate.gateSeq,
            decision: result.decision,
            outcome: result.outcome,
            approvedBy: result.gate.decidedBy,
            approvedAt: result.gate.decidedAt?.toISOString() ?? null,
            decisionEventSeq: result.gate.decisionEventSeq,
          },
          {
            status: 200,
            headers: {
              'cache-control': 'no-store',
              'x-content-type-options': 'nosniff',
            },
          },
        )
      } catch (error) {
        return toErrorResponse(error)
      }
    },
  }
}
