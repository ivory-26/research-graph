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
 *
 * Deadline semantics: the 240-second budget is enforced here, by the caller,
 * not only by the abort signal handed to the stages. A stage that ignores its
 * signal cannot keep heartbeats alive or keep the response open: when the
 * budget signal aborts, this module stops the heartbeat, appends the terminal
 * event itself (`run.timeout` when a run is still active, then `pipeline.failed`),
 * delivers it, and closes the writer without waiting for the stage promise.
 * `emit` refuses every event after the deadline, so a stage that returns late
 * cannot append `pipeline.completed` or anything else. The cooperative signal
 * is still passed to stages for real cleanup; it is no longer the only
 * guarantee.
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
import {
  PipelineStageError,
  type PipelineEmit,
  type PipelineStageContext,
  type PipelineStages,
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

/**
 * Per-stream mutable state. The stage runner and the caller-side deadline
 * supervisor share it so a single terminal event is written and every later
 * write is refused, whichever of them acts first.
 */
type StreamState = {
  /** Highest seq delivered to the client. */
  cursor: number
  /** True once a terminal event has been observed (durably or on the wire). */
  terminal: boolean
  /** True once the response is being finalized; no more work is accepted. */
  finalized: boolean
  /**
   * `runId` from the last delivered `run.started`. Cleared by a delivered
   * `run.succeeded`/`run.failed` so a later budget expiry cannot append a
   * `run.timeout` for a run whose row already has a terminal status.
   */
  activeRunId: string | null
}

type RunContext = {
  writer: StreamWriter
  signal: AbortSignal
  stopHeartbeat(): void
  cancelled(): boolean
  budgetExpired(): boolean
}

/**
 * The text persisted as `pipeline.failed.error`.
 *
 * A raw exception message is not safe here: a driver or provider error can
 * carry a connection string, a host, an API key fragment or a request id, and
 * this string is both stored durably and streamed to the client. Details stay
 * in the server log; the wire carries a code the database layer authored.
 */
export function describeStreamFailure(error: unknown): string {
  if (error instanceof PipelineDbError) {
    return `The pipeline database refused the operation (${error.code})`
  }
  // A provider supplies its own product-authored sentence; `Error.message`
  // stays in the server log.
  if (error instanceof PipelineStageError) return error.safeMessage
  return 'The pipeline failed unexpectedly'
}

function budgetFailureMessage(budgetMs: number): string {
  return `Pipeline stream budget of ${budgetMs} ms exhausted`
}

/** Resolves when the signal aborts. Never rejects and is not tied to a timer. */
function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

/** Writes one persisted event, refusing to deliver anything twice. */
function writeEvent(
  writer: StreamWriter,
  state: StreamState,
  event: PipelineEvent,
): void {
  if (event.seq <= state.cursor) return
  if (isTerminalEventType(event.type)) state.terminal = true
  if (event.type === 'run.started') state.activeRunId = event.runId
  // A run-level terminal means the sandbox is done. Without this, a budget
  // expiry during EVALUATE would append `run.timeout` after `run.succeeded`
  // for the same runId, contradicting `runs.status` in the durable log. Match
  // the id so a replayed terminal for an earlier run cannot clear a newer one.
  if (
    (event.type === 'run.succeeded' || event.type === 'run.failed') &&
    event.runId === state.activeRunId
  ) {
    state.activeRunId = null
  }
  state.cursor = event.seq
  writer.write(formatSseEvent(event))
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

      const state: StreamState = {
        cursor: input.cursor,
        terminal: false,
        finalized: false,
        activeRunId: null,
      }

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

      let released = false
      const release = (): void => {
        if (released) return
        released = true
        state.finalized = true
        stopHeartbeat?.()
        streamBudget.dispose()
        writer.close()
      }

      // Both outcomes are handled here, so the losing branch of the race can
      // never leave an unhandled rejection behind.
      const run = (
        input.mode === 'owner'
          ? runOwner(context, input, state)
          : runFollower(context, input, state)
      ).then(
        () => 'finished' as const,
        (error: unknown) => {
          console.error('[pipeline-delivery] stream failed', error)
          return 'finished' as const
        },
      )

      const finalize = async (outcome: 'finished' | 'aborted'): Promise<void> => {
        // The budget check comes first even for a finished run: a cooperative
        // stage rejects as soon as its signal aborts, so the run can settle
        // before the abort listener's microtask wins the race. The terminal is
        // still owed.
        if (streamBudget.signal.aborted && !state.terminal) {
          state.finalized = true
          stopHeartbeat?.()
          try {
            if (input.mode === 'owner') {
              await finalizeOwnerAtBudget(input, writer, state)
            } else {
              // A follower cannot write a terminal event: it does not own the
              // claim. A diagnostic comment is honest and changes no durable
              // state.
              writer.write(': stream budget exhausted\n\n')
            }
          } catch (error) {
            // Finalization failed (for example, the database is unreachable).
            // The response still closes; the claim then expires on its lease.
            console.error(
              '[pipeline-delivery] stream finalization failed',
              error,
            )
          } finally {
            release()
          }
          return
        }

        if (outcome === 'finished') {
          release()
          return
        }

        // A request abort (client disconnect) is not a terminal result
        // (ADR 0003): no event is appended, and the claim expires on its own
        // lease.
        state.finalized = true
        stopHeartbeat?.()
        release()
      }

      void Promise.race([
        run,
        waitForAbort(signal).then(() => 'aborted' as const),
      ])
        .then(finalize)
        .catch((error: unknown) => {
          // Finalization itself must never become an unhandled rejection.
          console.error('[pipeline-delivery] stream close failed', error)
          release()
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

/**
 * The terminal sequence for a budget expiry that the stage runner did not
 * reach. Runs only after the budget signal aborted.
 */
async function finalizeOwnerAtBudget(
  input: OpenPipelineStreamInput,
  writer: StreamWriter,
  state: StreamState,
): Promise<void> {
  const { data, experiment, timings } = input
  const scope = {
    experimentId: experiment.id,
    workspaceId: experiment.workspaceId,
  }

  /** Delivers every persisted event the client has not seen yet. */
  const replayUnseen = async (): Promise<void> => {
    let after = state.cursor

    for (;;) {
      const page = await data.replayPipelineEvents({
        ...scope,
        afterSeq: after,
        limit: 200,
      })

      for (const event of page.events) {
        writeEvent(writer, state, event)
        if (state.terminal) return
      }

      if (!page.hasMore) return
      const last = page.events[page.events.length - 1]
      if (!last || last.seq <= after) return
      after = last.seq
    }
  }

  /**
   * Appends one event and delivers it. `EXPERIMENT_TERMINAL` means another
   * writer published the terminal first, which is a success for this stream:
   * the caller replays it rather than inventing a second one.
   */
  const appendEvent = async (
    eventInput: PipelineEventInput,
  ): Promise<'written' | 'terminal-exists' | 'failed'> => {
    try {
      const event = await data.appendPipelineEvent({
        ...scope,
        event: eventInput,
      })
      writeEvent(writer, state, event)
      return 'written'
    } catch (error) {
      if (
        error instanceof PipelineDbError &&
        error.code === 'EXPERIMENT_TERMINAL'
      ) {
        return 'terminal-exists'
      }
      console.error(
        '[pipeline-delivery] could not append the budget terminal event',
        error,
      )
      return 'failed'
    }
  }

  await replayUnseen()
  if (state.terminal) return

  if (state.activeRunId === null) {
    // A `run.started` append may have been in flight when the deadline fired.
    // One more read closes that window as far as the row lock ordering allows;
    // without it a run that started at the deadline could miss `run.timeout`.
    await replayUnseen()
    if (state.terminal) return
  }

  if (state.activeRunId !== null) {
    const outcome = await appendEvent({
      type: 'run.timeout',
      runId: state.activeRunId,
      budgetMs: timings.budgetMs,
    })
    if (outcome === 'terminal-exists') {
      await replayUnseen()
      return
    }
    if (state.terminal) return
  }

  const outcome = await appendEvent({
    type: 'pipeline.failed',
    error: budgetFailureMessage(timings.budgetMs),
  })
  if (outcome === 'terminal-exists') await replayUnseen()
}

async function runOwner(
  context: RunContext,
  input: OpenPipelineStreamInput,
  state: StreamState,
): Promise<void> {
  const stages = input.stages
  const ownerClaimId = input.ownerClaimId
  if (!stages || !ownerClaimId) {
    throw new Error('owner stream requires a stage provider and a claim id')
  }

  const { experiment, data, timings } = input
  const experimentId = experiment.id
  const workspaceId = experiment.workspaceId

  /**
   * No stage work is accepted after the deadline or after finalization. This
   * is what prevents a slow provider from appending `pipeline.completed` or
   * anything else once the budget is gone.
   */
  const stopped = (): boolean =>
    context.cancelled() || context.budgetExpired() || state.finalized

  /**
   * Writes every persisted event after the cursor. Used at the gate and after
   * the decision so events written by another request (the approval POST) are
   * delivered with their real, persisted seq.
   */
  const flushPersisted = async (): Promise<void> => {
    if (state.terminal || state.finalized) return
    let after = state.cursor

    for (;;) {
      const page = await data.replayPipelineEvents({
        experimentId,
        workspaceId,
        afterSeq: after,
        limit: 200,
      })

      for (const event of page.events) {
        writeEvent(context.writer, state, event)
        if (state.terminal) return
      }

      if (!page.hasMore) return
      const last = page.events[page.events.length - 1]
      if (!last || last.seq <= after) return
      after = last.seq
    }
  }

  const emit: PipelineEmit = async (eventInput) => {
    if (stopped() || state.terminal) throw new StreamCancelledError()
    const event = await data.appendPipelineEvent({
      experimentId,
      workspaceId,
      event: eventInput,
    })
    // The deadline may have passed while the append was in flight. The row is
    // already committed; the budget finalizer replays it, so do not write it
    // here and do not let the stage continue.
    if (stopped() || state.terminal) throw new StreamCancelledError()
    writeEvent(context.writer, state, event)
    return event
  }

  /** Best-effort terminal append. A failure means a terminal already exists. */
  const safeEmit = async (eventInput: PipelineEventInput): Promise<void> => {
    if (stopped() || state.terminal) return
    try {
      await emit(eventInput)
    } catch {
      // Do not mask the original failure with a failed failure write.
    }
  }

  try {
    for (const event of input.initialEvents) {
      writeEvent(context.writer, state, event)
      if (state.terminal) return
    }
    if (state.terminal) return

    await emit({ type: 'pipeline.started', mode: experiment.mode })

    const stageContext: PipelineStageContext = {
      experimentId,
      workspaceId,
      actorId: input.actor.id,
      signal: context.signal,
      emit,
      repairApproval: {
        claimId: ownerClaimId,
        async open(input) {
          context.signal.throwIfAborted()
          const opened = await data.openApprovalGate(input)
          await flushPersisted()
          context.signal.throwIfAborted()
          return opened
        },
        async wait(gateSeq) {
          const readGate = async () => {
            const gate = await data.getApprovalGate({ experimentId, workspaceId, gateSeq })
            if (!gate) throw new Error('the repair approval gate could not be found')
            return gate
          }
          await waitForApproval(async () => {
            const gate = await readGate()
            return { state: gate.status, approvedBy: gate.decidedBy }
          }, {
            signal: context.signal,
            intervalMs: timings.approvalPollIntervalMs,
          })
          const gate = await readGate()
          await flushPersisted()
          context.signal.throwIfAborted()
          return gate
        },
      },
    }

    const plan = await stages.plan(stageContext)
    if (stopped() || state.terminal) throw new StreamCancelledError()

    const opened = await data.openApprovalGate({
      experimentId,
      workspaceId,
      claimId: ownerClaimId,
      spec: plan.spec,
    })

    // Deliver the persisted approval.requested event.
    await flushPersisted()
    if (stopped() || state.terminal) return

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
    if (stopped() || state.terminal) return

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
    if (stopped() || state.terminal) return

    if (execution.repairRejected) {
      await emit({ type: 'pipeline.cancelled', reason: 'rejected' })
      return
    }
    await emit({ type: 'pipeline.completed', runId: execution.runId })
  } catch (error) {
    if (state.terminal || state.finalized || context.cancelled()) return

    if (error instanceof StreamCancelledError) return

    // The deadline supervisor owns the terminal event at expiry; it writes
    // `run.timeout` (when a run is still active) and `pipeline.failed`.
    if (context.budgetExpired()) return

    if (
      error instanceof PipelineDbError &&
      error.code === 'EXPERIMENT_TERMINAL'
    ) {
      // Another writer published a terminal event first. Deliver it; do not
      // invent a second one.
      await flushPersisted()
      return
    }

    // Full detail stays in the log; the durable/streamed text is generic.
    console.error('[pipeline-delivery] pipeline failed', error)
    await safeEmit({
      type: 'pipeline.failed',
      error: describeStreamFailure(error),
    })
  }
}

async function runFollower(
  context: RunContext,
  input: OpenPipelineStreamInput,
  state: StreamState,
): Promise<void> {
  const { experiment, data, timings } = input
  const experimentId = experiment.id
  const workspaceId = experiment.workspaceId

  try {
    for (const event of input.initialEvents) {
      writeEvent(context.writer, state, event)
      if (state.terminal) return
    }
    if (state.terminal) return

    for (;;) {
      const page = await data.replayPipelineEvents({
        experimentId,
        workspaceId,
        afterSeq: state.cursor,
        limit: 200,
      })

      for (const event of page.events) {
        writeEvent(context.writer, state, event)
        if (state.terminal) return
      }
      if (state.terminal) return
      if (context.cancelled()) return

      if (context.budgetExpired()) {
        // The caller-side supervisor writes the diagnostic comment and closes
        // the response; a follower cannot write a terminal event because it
        // does not own the claim.
        return
      }

      await abortableSleep(timings.eventPollIntervalMs, context.signal)
    }
  } catch {
    if (state.terminal || state.finalized) return
    if (context.cancelled() || context.budgetExpired()) return

    // A durable read failure means this follower cannot know whether more
    // events exist. Close without fabricating an event.
    context.writer.write(': stream ended: durable read failed\n\n')
  }
}
