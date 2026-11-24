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
 *   the plan the human approved.
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
 * - It does not write result/run graph nodes or the `produced` edge. That is
 *   `src/server/pipeline.ts` (#7), which has not landed. The run row and the
 *   durable events are the record this layer owns.
 * - It does not emit `run.stdout`. The only write path the transport has is
 *   the durable event log, so per-chunk stdout would create one row per line.
 *   `runs.stdout` remains the durable record.
 */
import { and, eq } from 'drizzle-orm'

import type { Database } from '../../db/client'
import { experiments, runs } from '../../db/schema'
import type {
  ExperimentResult,
  ExperimentSpec,
  RunEnvironment,
} from '../../shared/types'
import { evaluateAndExplainExperiment } from '../evaluate'
import {
  callModel as productionCallModel,
  createDrizzleAgentTaskStore,
  type CallModel,
  type CallModelContext,
} from '../model'
import { validateExperimentSpec } from '../planner'
import {
  E2BRunner,
  runnerErrorToFailedResult,
  type ExperimentRunner,
} from '../runner'
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

export function createProductionPipelineStages(
  options: ProductionPipelineStageOptions,
): ProductionPipelineStages {
  const { db } = options
  const runner = options.runner ?? new E2BRunner()
  const callModelFn = options.callModel ?? productionCallModel
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID())
  const now = options.now ?? (() => new Date())
  const taskStore = createDrizzleAgentTaskStore(db)

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
      const runId = randomUUID()
      const startedAt = now().toISOString()
      const cancellable = runner as CancellableRunner

      await context.emit({ type: 'stage.started', stage: 'EXECUTE' })

      // The run exists before the sandbox does: if the provider dies, the row
      // still says a run was started, with the exact approved plan frozen in
      // `runs.spec`.
      await db.insert(runs).values({
        id: runId,
        experimentId: context.experimentId,
        attempt: 1,
        status: 'running',
        spec,
        parameters: spec.parameters,
        environment: initialEnvironment(spec, startedAt),
        startedAt: new Date(startedAt),
      })

      await context.emit({
        type: 'run.started',
        runId,
        attempt: 1,
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
      context.signal.addEventListener('abort', cancelActiveSandboxes, {
        once: true,
      })

      let result: ExperimentResult
      let runnerThrew = false
      try {
        result = await runner.run(spec, () => {
          // Durable stdout lives in `runs.stdout`; see the module header.
        })
      } catch (error) {
        runnerThrew = true
        result = failedResultFromRunnerError(error, spec, startedAt)
      } finally {
        context.signal.removeEventListener('abort', cancelActiveSandboxes)
      }

      const finishedAt = now()

      if (context.signal.aborted) {
        // The transport owns the timeout terminal; best-effort mark the row so
        // a run killed by the deadline is not left looking alive.
        try {
          await db
            .update(runs)
            .set({ status: 'timeout', finishedAt })
            .where(eq(runs.id, runId))
        } catch (error) {
          console.error(
            '[pipeline-delivery] could not mark an aborted run as timeout',
            error,
          )
        }
        throw context.signal.reason instanceof Error
          ? context.signal.reason
          : new Error('the pipeline was aborted')
      }

      const runStatus = result.exitCode === 0 ? 'succeeded' : 'failed'
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
        status: runStatus,
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

      const evaluated = await evaluateAndExplainExperiment(
        spec,
        result,
        callContext,
        { callModelFn },
      )

      if (context.signal.aborted) {
        throw context.signal.reason instanceof Error
          ? context.signal.reason
          : new Error('the pipeline was aborted')
      }

      await db
        .update(runs)
        .set({
          verdict: evaluated.verdict,
          verdictDetail: evaluated.detail,
        })
        .where(eq(runs.id, runId))

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
        taskId: null,
        error: null,
      })

      return { runId }
    },
  }

  return Object.assign(stages, { runner })
}
