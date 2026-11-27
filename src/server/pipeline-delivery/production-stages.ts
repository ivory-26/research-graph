/**
 * The production `PipelineStages` provider.
 *
 * Issue #6 owns the SSE lifecycle; the stage work itself belongs to the
 * runtime modules that landed in #23/#24/#25:
 *
 * - PLAN_EXPERIMENT is the planner's deterministic validation
 *   (`validateExperimentSpec`, `src/server/planner.ts`) applied to the plan
 *   persisted in `experiments.spec`. The planner on `main` validates; it does
 *   not generate, so this provider never invents a plan.
 * - EXECUTE is the real `E2BRunner` from `src/server/runner.ts`. The run row is
 *   written before the sandbox starts and updated with the measured result, so
 *   a failed or aborted run is still auditable. `runs.spec` is a frozen copy of
 *   the plan the human approved. A what-if branch (#27) creates its child
 *   experiment and a `queued` attempt-1 run with `parentRunId` before execution;
 *   EXECUTE adopts that row instead of inserting a second, unlinked one, so the
 *   branch keeps its run id and lineage (#62).
 * - EVALUATE is `evaluateAndExplainExperiment` from `src/server/evaluate.ts`.
 *   The verdict is computed by `evaluateExperiment` before any model call; the
 *   model can only write the explanation. Every explain call goes through
 *   `callModel`, which writes exactly one `agent_tasks` row.
 *
 * What this provider deliberately does not do:
 *
 * - It does not run INGEST_SOURCE, EXTRACT_CLAIMS or PROPOSE_EDGES. Those
 *   stages produced the graph and the experiment row before this endpoint was
 *   called; emitting their events here would be fiction. Only stages that
 *   actually run in this request emit `stage.*`.
 * - It does not write graph rows inline. Once a run is terminal it calls
 *   `projectRunToGraph` from `src/server/pipeline.ts` (#7), which writes the
 *   run/result nodes and the `produced` edge in one transaction. The run row
 *   and the durable events remain the record this layer owns.
 * - It does not emit `node.upserted` / `edge.upserted`. The projection is a
 *   durable row write and also runs on abort paths, where `emit` refuses every
 *   event; the graph is read from `nodes` and `edges`, not the event log.
 * - It does not emit `run.stdout`. The only write path the transport has is
 *   the durable event log, so per-chunk stdout would create one row per line.
 *   `runs.stdout` remains the durable record.
 */
import { and, eq } from 'drizzle-orm'

import type { Database } from '../../db/client'
import { experiments, nodes, runs, sources } from '../../db/schema'
import type {
  ExperimentResult,
  ExperimentSpec,
  RunEnvironment,
} from '../../shared/types'
import {
  MAX_REPAIR_ATTEMPTS,
  createDrizzleRepairRunStore,
  executeApprovedRepairCandidate,
  repairAndRetryRun,
  type RepairPipelineEvent,
  type RepairRunRecord,
} from '../branch'
import { evaluateAndExplainExperiment } from '../evaluate'
import {
  callModel as productionCallModel,
  createDrizzleAgentTaskStore,
  type CallModel,
  type CallModelContext,
  type PersistedAgentTask,
} from '../model'
import { saveNotebookArtifact } from '../notebook'
import { projectRunToGraph } from '../pipeline'
import { validateExperimentSpec } from '../planner'
import { StreamBudgetExceededError } from '../pipeline-transport'
import {
  E2BRunner,
  SandboxTimeoutError,
  runnerErrorToFailedResult,
  type ExperimentRunner,
} from '../runner'
import { saveRunArtifacts } from './artifacts'
import {
  PipelineStageError,
  type PipelineStageContext,
  type PipelineStages,
} from './stages'

export type ProductionPipelineStageOptions = {
  db: Database
  /**
   * Defaults to the real E2B runner. Tests inject a deterministic runner so the
   * delivery layer can be exercised without a cloud sandbox.
   */
  runner?: ExperimentRunner
  /**
   * Defaults to the Gemini-backed `callModel` used by the evaluator. Tests
   * inject a call that still writes through the supplied `AgentTaskStore`.
   */
  callModel?: CallModel
  /** Tests only. */
  randomUUID?: () => string
  /** Tests only. */
  now?: () => Date
}

export type ProductionPipelineStages = PipelineStages & {
  /** Exposed for tests and for a future cancellation hook. */
  readonly runner: ExperimentRunner
}

/** A runner that can report its live sandboxes, as the E2B one does. */
type CancellableRunner = ExperimentRunner & {
  getActiveSandboxes?: () => ReadonlyMap<string, unknown>
}

/** The placeholder environment a `running` row starts with. */
function initialEnvironment(
  spec: ExperimentSpec,
  startedAt: string,
): RunEnvironment {
  return {
    imageDigest: 'unknown',
    python: 'unknown',
    packages: {},
    datasets: [],
    seeds:
      typeof spec.parameters.seed === 'number' ? [spec.parameters.seed] : [],
    startedAt,
  }
}

/**
 * A generic runner failure message is not safe to persist or stream: an SDK
 * error can carry a host, an API key fragment or a request id. The typed
 * runner errors carry sandbox output and no credentials, so they keep their
 * detail; everything else is replaced with a generic sentence and logged.
 */
function failedResultFromRunnerError(
  error: unknown,
  spec: ExperimentSpec,
  startedAt: string,
): ExperimentResult {
  const typed =
    error instanceof Error &&
    ['PackageVerificationError', 'MetricsExtractionError', 'SandboxTimeoutError'].includes(
      error.name,
    )

  if (typed) return runnerErrorToFailedResult(error, spec, startedAt)

  console.error('[pipeline-delivery] experiment runner failed', error)
  return {
    exitCode: 1,
    stdout: '',
    stderr: 'The experiment runner failed before producing a result',
    metrics: {},
    artifacts: [],
    durationMs: 0,
    environment: initialEnvironment(spec, startedAt),
  }
}

/**
 * The durable status of a run that was aborted mid-EXECUTE.
 *
 * The stage signal is `AbortSignal.any` over the request signal, a consumer
 * cancel and the stream budget. Only the budget is a timeout; the other two
 * mean the caller went away. Recording both as `timeout` would persist a
 * deadline that never fired and disagree with the event log, which appends no
 * terminal at all for a disconnect (ADR 0003).
 */
function abortedRunStatus(signal: AbortSignal): 'timeout' | 'cancelled' {
  return signal.reason instanceof StreamBudgetExceededError
    ? 'timeout'
    : 'cancelled'
}

/**
 * Projects a terminal run without masking the failure already on its way out.
 *
 * The abort path and the `finally` that owes the graph after an error use
 * this. Normal completion calls `projectRunToGraph` directly: there a
 * projection failure is the pipeline's failure, not something to log and
 * forget.
 */
async function projectRunToGraphSafely(
  db: Database,
  runId: string,
): Promise<void> {
  try {
    await projectRunToGraph(db, runId)
  } catch (error) {
    console.error(
      '[pipeline-delivery] could not project the terminal run onto the graph',
      error,
    )
  }
}

type StartedExecutionRun = {
  runId: string
  attempt: number
}

/**
 * Starts the durable run row for EXECUTE and returns its identity.
 *
 * A what-if branch (#27) creates its child experiment and a `queued` attempt-1
 * run with `parentRunId` in one transaction, before the child is ever executed.
 * EXECUTE adopts that row instead of inserting a second, unlinked one: the
 * branch keeps the run id and lineage it was created with. Adoption is a
 * conditional `queued -> running` update, so a row can be adopted once, and
 * the approved plan is written into it before the sandbox starts.
 *
 * The experiment row lock is the same serialization point the execution claim,
 * gate and event writers use. Two start attempts for one experiment therefore
 * cannot both adopt or both insert, and an experiment that already has a run
 * is refused instead of being given a duplicate.
 *
 * A non-branched experiment has no queued child and keeps Run A's behaviour: a
 * fresh attempt-1 row with no parent.
 */
async function startExecutionRun(
  db: Database,
  input: {
    experimentId: string
    workspaceId: string
    spec: ExperimentSpec
    startedAt: string
    newRunId: () => string
  },
): Promise<StartedExecutionRun> {
  return db.transaction(async (tx) => {
    const [experiment] = await tx
      .select({ id: experiments.id })
      .from(experiments)
      .where(
        and(
          eq(experiments.id, input.experimentId),
          eq(experiments.workspaceId, input.workspaceId),
        ),
      )
      .for('update')

    if (!experiment) {
      throw new PipelineStageError(
        `experiment ${input.experimentId} not found in workspace ${input.workspaceId}`,
        'The experiment could not be found',
      )
    }

    const existingRuns = await tx
      .select({
        id: runs.id,
        attempt: runs.attempt,
        status: runs.status,
        parentRunId: runs.parentRunId,
      })
      .from(runs)
      .where(eq(runs.experimentId, input.experimentId))
      .limit(2)
      .for('update')

    const [existing] = existingRuns
    if (
      existingRuns.length === 1 &&
      existing?.status === 'queued' &&
      existing.attempt === 1 &&
      existing.parentRunId !== null
    ) {
      const [adopted] = await tx
        .update(runs)
        .set({
          status: 'running',
          // Freeze what the human approved, not the branch's earlier copy.
          spec: input.spec,
          parameters: input.spec.parameters,
          environment: initialEnvironment(input.spec, input.startedAt),
          startedAt: new Date(input.startedAt),
        })
        .where(and(eq(runs.id, existing.id), eq(runs.status, 'queued')))
        .returning({ id: runs.id, attempt: runs.attempt })

      if (!adopted) {
        throw new PipelineStageError(
          `queued branch run ${existing.id} could not be adopted`,
          'The queued branch run could not be started',
        )
      }

      return { runId: adopted.id, attempt: adopted.attempt }
    }

    if (existing) {
      throw new PipelineStageError(
        `experiment ${input.experimentId} already has run ${existing.id}; refusing a duplicate`,
        'The experiment already has a run',
      )
    }

    const runId = input.newRunId()
    await tx.insert(runs).values({
      id: runId,
      experimentId: input.experimentId,
      attempt: 1,
      status: 'running',
      spec: input.spec,
      parameters: input.spec.parameters,
      environment: initialEnvironment(input.spec, input.startedAt),
      startedAt: new Date(input.startedAt),
    })

    return { runId, attempt: 1 }
  })
}

export function createProductionPipelineStages(
  options: ProductionPipelineStageOptions,
): ProductionPipelineStages {
  const { db } = options
  const runner = options.runner ?? new E2BRunner()
  const callModelFn = options.callModel ?? productionCallModel
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID())
  const now = options.now ?? (() => new Date())
  const taskStore = createDrizzleAgentTaskStore(db)
  const repairStore = createDrizzleRepairRunStore(db)

  async function loadStoredSpec(
    context: PipelineStageContext,
  ): Promise<ExperimentSpec> {
    const [row] = await db
      .select({ spec: experiments.spec })
      .from(experiments)
      .where(
        and(
          eq(experiments.id, context.experimentId),
          eq(experiments.workspaceId, context.workspaceId),
        ),
      )
      .limit(1)

    if (!row) {
      throw new PipelineStageError(
        `experiment ${context.experimentId} not found in workspace ${context.workspaceId}`,
        'The experiment could not be found',
      )
    }

    return row.spec
  }

  async function repair(
    context: PipelineStageContext,
    failedRun: RepairRunRecord,
    executionRunner: ExperimentRunner,
  ) {
    const modelContext = {
      workspaceId: context.workspaceId,
      store: taskStore,
      signal: context.signal,
    }
    const emitRepairEvent = async (event: RepairPipelineEvent): Promise<void> => {
      if (event.type === 'run.stdout') return
      const { at: _at, experimentId: _experimentId, ...input } = event
      await context.emit(input)
    }
    const repairOptions = {
      runStore: {
        ...repairStore,
        async updateRun(...args: Parameters<typeof repairStore.updateRun>) {
          const run = await repairStore.updateRun(...args)
          if (context.signal.aborted) {
            await projectRunToGraphSafely(db, run.id)
          } else {
            await projectRunToGraph(db, run.id)
          }
          return run
        },
      },
      runner: executionRunner,
      emitEvent: emitRepairEvent,
      signal: context.signal,
      abortedStatus: () => abortedRunStatus(context.signal),
      now,
    }

    let finalRun = failedRun
    let attemptsLeft = MAX_REPAIR_ATTEMPTS
    while (attemptsLeft > 0) {
      const result = await repairAndRetryRun(finalRun, {
        ...repairOptions,
        maxAttempts: attemptsLeft,
        modelContext,
        callModelFn,
        claimId: context.repairApproval.claimId,
        openApprovalGate: context.repairApproval.open,
      })
      finalRun = result.finalRun
      attemptsLeft -= result.attemptsUsed
      if (result.status !== 'awaiting_approval') break

      if (!result.candidateSpec || result.gateSeq === undefined) {
        throw new Error('repair awaiting approval did not return a candidate and gate')
      }
      const gate = await context.repairApproval.wait(result.gateSeq)
      if (gate.id !== result.gateId) throw new Error('the repair approval gate changed')
      if (gate.status === 'rejected') {
        return { runId: finalRun.id, repairRejected: true as const }
      }

      finalRun = await executeApprovedRepairCandidate(finalRun, result.candidateSpec, {
        ...repairOptions,
        gate,
      })
      if (finalRun.status === 'succeeded') break
    }
    return { runId: finalRun.id }
  }

  const stages: PipelineStages = {
    async plan(context) {
      await context.emit({ type: 'stage.started', stage: 'PLAN_EXPERIMENT' })

      const spec = await loadStoredSpec(context)
      const validation = validateExperimentSpec(spec)
      if (!validation.valid) {
        // Server log keeps the planner's reasons; the wire gets one sentence.
        console.error(
          '[pipeline-delivery] stored experiment spec failed validation',
          validation.errors,
        )
        await context.emit({
          type: 'stage.finished',
          stage: 'PLAN_EXPERIMENT',
          status: 'failed',
          taskId: null,
          error: 'The stored experiment plan failed validation',
        })
        throw new PipelineStageError(
          `stored experiment spec failed validation: ${validation.errors.join('; ')}`,
          'The stored experiment plan failed validation',
        )
      }

      await context.emit({
        type: 'stage.finished',
        stage: 'PLAN_EXPERIMENT',
        status: 'succeeded',
        taskId: null,
        error: null,
      })

      return { spec }
    },

    async execute(context, spec) {
      const startedAt = now().toISOString()
      const cancellable = runner as CancellableRunner

      await context.emit({ type: 'stage.started', stage: 'EXECUTE' })

      // The run exists before the sandbox does: if the provider dies, the row
      // still says a run was started, with the exact approved plan frozen in
      // `runs.spec`. For a what-if child this is the row the branch created;
      // for Run A it is a new unlinked attempt-1 row.
      const { runId, attempt } = await startExecutionRun(db, {
        experimentId: context.experimentId,
        workspaceId: context.workspaceId,
        spec,
        startedAt,
        newRunId: randomUUID,
      })

      await context.emit({
        type: 'run.started',
        runId,
        attempt,
        // E2BRunner does not expose the sandbox id to this layer; the run row
        // is the durable place for it once the runtime workstream provides it.
        sandboxId: null,
      })

      /** Stops remote work when the client disconnects or the budget expires. */
      const cancelActiveSandboxes = (): void => {
        const active = cancellable.getActiveSandboxes?.()
        if (!active) return
        for (const sandboxId of active.keys()) {
          void runner.cancel(sandboxId).catch((error: unknown) => {
            console.error(
              '[pipeline-delivery] could not cancel a sandbox after abort',
              error,
            )
          })
        }
      }
      const executionRunner: ExperimentRunner = {
        async run(spec, onStdout) {
          context.signal.throwIfAborted()
          context.signal.addEventListener('abort', cancelActiveSandboxes, { once: true })
          try {
            return await runner.run(spec, onStdout)
          } finally {
            context.signal.removeEventListener('abort', cancelActiveSandboxes)
          }
        },
        cancel: (sandboxId) => runner.cancel(sandboxId),
      }

      let result: ExperimentResult
      let runnerThrew = false
      let runnerTimedOut = false
      try {
        result = await executionRunner.run(spec, () => {
          // Durable stdout lives in `runs.stdout`; see the module header.
        })
      } catch (error) {
        runnerThrew = true
        runnerTimedOut = error instanceof SandboxTimeoutError
        result = failedResultFromRunnerError(error, spec, startedAt)
      }

      const finishedAt = now()

      if (context.signal.aborted) {
        // The transport owns any terminal event; best-effort mark the row so a
        // run killed mid-EXECUTE is not left looking alive. The status must
        // match why it stopped: budget expiry is `timeout`, a client
        // disconnect is `cancelled`.
        const status = abortedRunStatus(context.signal)
        try {
          await db
            .update(runs)
            .set({
              status,
              // Whatever the runner captured before the abort is still the
              // run's output. Metrics are deliberately not written: a result
              // obtained after cancellation is not trusted as a measurement.
              stdout: result.stdout,
              stderr: result.stderr,
              finishedAt,
            })
            .where(eq(runs.id, runId))
        } catch (error) {
          console.error(
            `[pipeline-delivery] could not mark an aborted run as ${status}`,
            error,
          )
        }

        // The row is terminal now, so the graph gets its nodes even though
        // this path ends in a throw. Best-effort: the abort reason is the
        // error the caller must see.
        await projectRunToGraphSafely(db, runId)

        throw context.signal.reason instanceof Error
          ? context.signal.reason
          : new Error('the pipeline was aborted')
      }

      const runStatus =
        result.exitCode === 0
          ? 'succeeded'
          : runnerTimedOut
            ? 'timeout'
            : 'failed'
      await db
        .update(runs)
        .set({
          status: runStatus,
          metrics: result.metrics,
          environment: result.environment,
          stdout: result.stdout,
          stderr: result.stderr,
          finishedAt,
        })
        .where(eq(runs.id, runId))

      // The run row is terminal from here on. Every exit from this block —
      // normal return, deadline, disconnect or an evaluation failure — owes
      // the graph its run/result nodes and `produced` edge. The normal path
      // projects after the verdict is persisted; the `finally` covers every
      // other exit and never masks the original error.
      let graphProjected = false
      try {
        if (result.artifacts.length > 0) {
          try {
            await saveRunArtifacts(db, runId, result.artifacts)
          } catch (error) {
            // Keep the measured run and project its verdict even if saving an
            // artifact fails. The seed separately verifies its required files.
            console.error('[pipeline-delivery] could not persist run artifacts', {
              runId,
              name: error instanceof Error ? error.name : 'UnknownError',
            })
          }
        }

        if (runnerThrew) {
          await context.emit({
            type: 'run.failed',
            runId,
            error: 'The experiment runner did not complete',
          })
        } else {
          await context.emit({ type: 'run.succeeded', runId, result })
        }

        await context.emit({
          type: 'stage.finished',
          stage: 'EXECUTE',
          // StageStatus has no `timeout`; the run row keeps that distinction.
          status: runStatus === 'succeeded' ? 'succeeded' : 'failed',
          taskId: null,
          error:
            runStatus === 'succeeded'
              ? null
              : runnerThrew
                ? 'The experiment runner did not complete'
                : 'The experiment script did not exit successfully',
        })

        await context.emit({ type: 'stage.started', stage: 'EVALUATE' })

        const callContext: CallModelContext = {
          workspaceId: context.workspaceId,
          taskKind: 'explain_gap',
          store: taskStore,
          inputRef: { experimentId: context.experimentId, runId },
          signal: context.signal,
        }

        // `evaluateAndExplainExperiment` returns only the verdict and detail,
        // so the rows its model call wrote are captured here and accounted for
        // on the stream. `callModel` persists a failed attempt and then throws
        // without returning the row; that row is still in `agent_tasks` and
        // the server log, but it cannot be emitted from this seam.
        const recordedTasks: PersistedAgentTask[] = []
        const capturingCallModel: CallModel = async (schema, prompt, ctx) => {
          const call = await callModelFn(schema, prompt, ctx)
          recordedTasks.push(...call.attempts)
          return call
        }

        const evaluated = await evaluateAndExplainExperiment(
          spec,
          result,
          callContext,
          { callModelFn: capturingCallModel },
        )

        // Persist the verdict before the abort check and before the event
        // writes. The verdict is arithmetic and belongs on the run row even if
        // the stream budget expires while its events are appended; the graph
        // then projects the same authoritative data instead of a null verdict.
        const [terminalRun] = await db
          .update(runs)
          .set({
            verdict: evaluated.verdict,
            verdictDetail: evaluated.detail,
          })
          .where(eq(runs.id, runId))
          .returning()
        if (!terminalRun) throw new Error('the terminal run could not be read back')

        if (runStatus === 'succeeded') {
          try {
            const [claim] = await db
              .select({
                data: nodes.data,
                paperTitle: sources.title,
                doi: sources.doi,
              })
              .from(nodes)
              .leftJoin(
                sources,
                and(
                  eq(sources.id, nodes.sourceId),
                  eq(sources.workspaceId, nodes.workspaceId),
                ),
              )
              .where(
                and(
                  eq(nodes.id, spec.claimNodeId),
                  eq(nodes.workspaceId, context.workspaceId),
                  eq(nodes.type, 'claim'),
                ),
              )

            if (claim?.data.type !== 'claim') {
              throw new Error('the run claim could not be loaded')
            }

            await saveNotebookArtifact(db, runId, {
              spec,
              environment: result.environment,
              paperTitle: claim.paperTitle,
              doi: claim.doi,
              claim: {
                text: claim.data.text,
                quote: claim.data.locator.quote,
                page: claim.data.locator.page,
                reported: claim.data.reported,
              },
              verdict: evaluated.verdict,
              verdictExplanation: evaluated.detail.explanation,
            })
          } catch (error) {
            console.error('[pipeline-delivery] could not save the run notebook', error)
          }
        }

        if (context.signal.aborted) {
          throw context.signal.reason instanceof Error
            ? context.signal.reason
            : new Error('the pipeline was aborted')
        }

        for (const task of recordedTasks) {
          await context.emit({
            type: 'agent_task.recorded',
            task: {
              id: task.id,
              taskKind: task.taskKind,
              strategyId: task.strategyId,
              model: task.model,
              status: task.status,
              promptTokens: task.promptTokens,
              completionTokens: task.completionTokens,
              // `numeric` is a string in Postgres; the event carries a number.
              costUsd: task.costUsd === null ? null : Number(task.costUsd),
              latencyMs: task.latencyMs,
              error: task.error,
            },
          })
        }

        await context.emit({
          type: 'verdict.computed',
          runId,
          verdict: evaluated.verdict,
          detail: evaluated.detail,
        })

        await context.emit({
          type: 'stage.finished',
          stage: 'EVALUATE',
          status: 'succeeded',
          taskId: recordedTasks.at(-1)?.id ?? null,
          error: null,
        })

        // Last write before completion: the result node carries the verdict
        // the row now holds. A failure here fails the pipeline rather than
        // reporting completion without the graph; a retry is idempotent.
        try {
          await projectRunToGraph(db, runId)
          graphProjected = true
        } catch (error) {
          // Driver detail stays in the server log; the durable/streamed text
          // is a product-authored sentence.
          console.error(
            '[pipeline-delivery] could not project the terminal run onto the graph',
            error,
          )
          throw new PipelineStageError(
            'the terminal run could not be written to the graph',
            'The completed run could not be written to the graph',
          )
        }

        if (runStatus === 'timeout' || (runStatus === 'failed' && !runnerThrew)) {
          return await repair(context, terminalRun, executionRunner)
        }
        return { runId }
      } finally {
        if (!graphProjected) {
          await projectRunToGraphSafely(db, runId)
        }
      }
    },
  }

  return Object.assign(stages, { runner })
}
