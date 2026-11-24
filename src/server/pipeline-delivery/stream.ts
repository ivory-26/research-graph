/**
 * The pipeline SSE response.
 *
 * One HTTP response is one pipeline attempt (ADR 0003). Two modes share the
 * transport:
 *
 * - **owner** — this request won `claimExecutionStart`. It runs the stages,
 *   opens the approval gate, polls `experiments.approval_state` every 500 ms,
 *   executes only after an approval, and is the only writer allowed to append
 *   a terminal event.
 * - **follower** — a reconnect (Last-Event-ID) or a second GET while a claim
 *   exists. It replays durable events strictly after its cursor and tails the
 *   log. It never starts a run and never appends a terminal event, because it
 *   does not own the claim. If the owner died, ADR 0003 says the run is lost;
 *   the follower must not invent a resumption.
 *
 * Terminal semantics are the database's: appending `pipeline.completed`,
 * `pipeline.failed` or `pipeline.cancelled` closes the claim. A rejection
 * therefore ends as `pipeline.cancelled`, and EXECUTE is never reached.
 */
import type { PipelineEvent } from '../../shared/events'
import type { PipelineEventInput } from '../../db/pipeline-validation'
import {
  PipelineDbError,
  isTerminalEventType,
} from '../../db/pipeline-validation'
import {
  SSE_HEADERS,
  SSE_HEARTBEAT_FRAME,
  abortableSleep,
  createStreamBudget,
  formatSseEvent,
  startHeartbeat,
  waitForApproval,
  type StreamBudget,
} from '../pipeline-transport'
import type { VerifiedActor } from './authorization'
import type { ExperimentScope, PipelineData } from './data'
import type {
  PipelineEmit,
  PipelineStageContext,
  PipelineStages,
} from './stages'
import type { PipelineTimings } from './timings'

export type PipelineStreamMode = 'owner' | 'follower'

export type OpenPipelineStreamInput = {
  request: Request
  experiment: ExperimentScope
  actor: VerifiedActor
  data: PipelineData
  stages: PipelineStages | null
  mode: PipelineStreamMode
  /** The caller-supplied idempotency key, present only for the owner. */
  ownerClaimId: string | null
  /** Exclusive replay cursor from Last-Event-ID; 0 for a fresh stream. */
  cursor: number
  /** Events already persisted at or before the cursor. */
  initialEvents: PipelineEvent[]
  timings: PipelineTimings
}

class StreamCancelledError extends Error {
  constructor() {
    super('pipeline stream cancelled')
    this.name = 'StreamCancelledError'
  }
}

type StreamWriter = {
  write(frame: string): void
  close(): void
}

function createWriter(
  controller: ReadableStreamDefaultController<Uint8Array>,
): StreamWriter {
  const encoder = new TextEncoder()
  let closed = false

  return {
    write(frame) {
      if (closed) return
      try {
        controller.enqueue(encoder.encode(frame))
      } catch {
        // The consumer went away; treat the writer as closed and let the
        // abort signal stop the pipeline work.
        closed = true
      }
    },
    close() {
      if (closed) return
      closed = true
      try {
        controller.close()
      } catch {
        // Already closed or errored.
      }
    },
  }
}

type RunContext = {
  writer: StreamWriter
  signal: AbortSignal
  stopHeartbeat(): void
  cancelled(): boolean
  budgetExpired(): boolean
}

function describeError(error: unknown): string {
  if (error instanceof PipelineDbError) {
    return `${error.code}: ${error.message}`
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/**
 * Builds the SSE `Response`. Authorization and the claim decision have already
 * happened; this function only runs the chosen mode over the wire.
 */
export function openPipelineStream(
  input: OpenPipelineStreamInput,
): Response {
  let internal: AbortController | null = null
  let budget: StreamBudget | null = null
  let stopHeartbeat: (() => void) | null = null

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const writer = createWriter(controller)
      const internalController = new AbortController()
      const streamBudget = createStreamBudget(input.timings.budgetMs)
      internal = internalController
      budget = streamBudget

      const signal = AbortSignal.any([
        input.request.signal,
        internalController.signal,
        streamBudget.signal,
      ])

      stopHeartbeat = startHeartbeat(
        (frame) => writer.write(frame),
        { intervalMs: input.timings.heartbeatIntervalMs },
      )
      // Flush headers and prove the connection is live before the first DB
      // round-trip. A comment is ignored by every SSE client.
      writer.write(SSE_HEARTBEAT_FRAME)

      const context: RunContext = {
        writer,
        signal,
        stopHeartbeat: () => {
          stopHeartbeat?.()
        },
        cancelled: () =>
          input.request.signal.aborted || internalController.signal.aborted,
        budgetExpired: () => streamBudget.signal.aborted,
      }

      const run =
        input.mode === 'owner'
          ? runOwner(context, input)
          : runFollower(context, input)

      void run
        .catch((error) => {
          // Last-resort boundary: never let an exception escape into the
          // stream without closing the response.
          console.error('[pipeline-delivery] stream failed', error)
        })
        .finally(() => {
          stopHeartbeat?.()
          streamBudget.dispose()
          writer.close()
        })
    },

    cancel(reason) {
      // A consumer cancel is not a terminal pipeline result. Abort the work;
      // do not append an event. The claim expires on its own lease (ADR 0003).
      internal?.abort(reason ?? new Error('pipeline stream cancelled'))
      stopHeartbeat?.()
      budget?.dispose()
    },
  })

  return new Response(body, {
    status: 200,
    headers: SSE_HEADERS,
  })
}

async function runOwner(
  context: RunContext,
  input: OpenPipelineStreamInput,
): Promise<void> {
  const stages = input.stages
  const ownerClaimId = input.ownerClaimId
  if (!stages || !ownerClaimId) {
    throw new Error('owner stream requires a stage provider and a claim id')
  }

  const { experiment, data, timings } = input
  const experimentId = experiment.id
  const workspaceId = experiment.workspaceId

  let cursor = input.cursor
  let terminal = false
  let activeRunId: string | null = null

  const writeEvent = (event: PipelineEvent): void => {
    if (event.seq <= cursor) return
    if (isTerminalEventType(event.type)) context.stopHeartbeat()
    context.writer.write(formatSseEvent(event))
    cursor = event.seq
    if (isTerminalEventType(event.type)) terminal = true
    if (event.type === 'run.started') activeRunId = event.runId
  }

  /**
   * Writes every persisted event after the cursor. Used at the gate and after
   * the decision so events written by another request (the approval POST) are
   * delivered with their real, persisted seq.
   */
  const flushPersisted = async (): Promise<void> => {
    if (terminal) return
    let after = cursor

    for (;;) {
      const page = await data.replayPipelineEvents({
        experimentId,
        workspaceId,
        afterSeq: after,
        limit: 200,
      })

      for (const event of page.events) {
        writeEvent(event)
        if (terminal) return
      }

      if (!page.hasMore) return
      const last = page.events[page.events.length - 1]
      if (!last || last.seq <= after) return
      after = last.seq
    }
  }

  const emit: PipelineEmit = async (eventInput) => {
    if (context.cancelled()) throw new StreamCancelledError()
    const event = await data.appendPipelineEvent({
      experimentId,
      workspaceId,
      event: eventInput,
    })
    if (context.cancelled()) throw new StreamCancelledError()
    writeEvent(event)
    return event
  }

  /** Best-effort terminal append. A failure means a terminal already exists. */
  const safeEmit = async (eventInput: PipelineEventInput): Promise<void> => {
    if (context.cancelled() || terminal) return
    try {
      await emit(eventInput)
    } catch {
      // Do not mask the original failure with a failed failure write.
    }
  }

  try {
    for (const event of input.initialEvents) {
      writeEvent(event)
      if (terminal) return
    }
    if (terminal) return

    await emit({ type: 'pipeline.started', mode: experiment.mode })

    const stageContext: PipelineStageContext = {
      experimentId,
      workspaceId,
      actorId: input.actor.id,
      signal: context.signal,
      emit,
    }

    const plan = await stages.plan(stageContext)
    if (context.cancelled()) throw new StreamCancelledError()

    const opened = await data.openApprovalGate({
      experimentId,
      workspaceId,
      claimId: ownerClaimId,
      spec: plan.spec,
    })

    // Deliver the persisted approval.requested event.
    await flushPersisted()
    if (terminal || context.cancelled()) return

    const resolved = await waitForApproval(
      async () => {
        const view = await data.getExperimentApprovalState({
          experimentId,
          workspaceId,
        })
        if (!view) {
          throw new Error(
            'the experiment disappeared while waiting for approval',
          )
        }
        return { state: view.approvalState, approvedBy: view.approvedBy }
      },
      {
        signal: context.signal,
        intervalMs: timings.approvalPollIntervalMs,
      },
    )

    // Deliver the approval.resolved event written by the other request.
    await flushPersisted()
    if (terminal || context.cancelled()) return

    if (resolved.state === 'rejected') {
      // A rejection ends the run as cancelled. EXECUTE is never called.
      await emit({ type: 'pipeline.cancelled', reason: 'rejected' })
      return
    }

    const execution = await stages.execute(
      stageContext,
      // The human decided this exact plan, not whatever is current later.
      opened.gate.offeredSpec,
    )

    await flushPersisted()
    if (terminal || context.cancelled()) return

    await emit({ type: 'pipeline.completed', runId: execution.runId })
  } catch (error) {
    if (terminal || context.cancelled()) return

    if (error instanceof StreamCancelledError) return

    if (
      error instanceof PipelineDbError &&
      error.code === 'EXPERIMENT_TERMINAL'
    ) {
      // Another writer published a terminal event first. Deliver it; do not
      // invent a second one.
      await flushPersisted()
      return
    }

    if (context.budgetExpired()) {
      if (activeRunId !== null) {
        await safeEmit({
          type: 'run.timeout',
          runId: activeRunId,
          budgetMs: timings.budgetMs,
        })
      }
      await safeEmit({
        type: 'pipeline.failed',
        error: `Pipeline stream budget of ${timings.budgetMs} ms exhausted`,
      })
      return
    }

    await safeEmit({ type: 'pipeline.failed', error: describeError(error) })
  }
}

async function runFollower(
  context: RunContext,
  input: OpenPipelineStreamInput,
): Promise<void> {
  const { experiment, data, timings } = input
  const experimentId = experiment.id
  const workspaceId = experiment.workspaceId

  let cursor = input.cursor
  let terminal = false

  const writeEvent = (event: PipelineEvent): void => {
    if (event.seq <= cursor) return
    if (isTerminalEventType(event.type)) context.stopHeartbeat()
    context.writer.write(formatSseEvent(event))
    cursor = event.seq
    if (isTerminalEventType(event.type)) terminal = true
  }

  try {
    for (const event of input.initialEvents) {
      writeEvent(event)
      if (terminal) return
    }
    if (terminal) return

    for (;;) {
      const page = await data.replayPipelineEvents({
        experimentId,
        workspaceId,
        afterSeq: cursor,
        limit: 200,
      })

      for (const event of page.events) {
        writeEvent(event)
        if (terminal) return
      }
      if (terminal) return
      if (context.cancelled()) return

      if (context.budgetExpired()) {
        // A follower cannot write a terminal event: it does not own the claim.
        // A diagnostic comment is honest and changes no durable state.
        context.writer.write(': stream budget exhausted\n\n')
        return
      }

      await abortableSleep(timings.eventPollIntervalMs, context.signal)
    }
  } catch {
    if (context.cancelled()) return
    if (context.budgetExpired()) {
      context.writer.write(': stream budget exhausted\n\n')
      return
    }
    // A durable read failure means this follower cannot know whether more
    // events exist. Close without fabricating an event.
    context.writer.write(': stream ended: durable read failed\n\n')
  }
}
