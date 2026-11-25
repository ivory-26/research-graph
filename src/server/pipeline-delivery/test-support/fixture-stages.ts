/**
 * TEST-ONLY stage provider.
 *
 * This is intentionally not production code and is never exported from the
 * delivery module. It exists so the transport suites need neither E2B nor
 * Gemini credentials; the real provider is exercised in
 * `production-stages.integration.test.ts`, and `#7` remains the one
 * integration seam outside this layer. These tests exercise the transport,
 * claim, gate, replay and terminal semantics against a real Postgres database
 * while supplying deterministic stage events through the same `PipelineStages`
 * port the real provider implements.
 *
 * It writes no `runs`, `nodes` or `edges` rows. Those belong to the runtime
 * and to `#7`.
 */
import type { ExperimentResult, ExperimentSpec } from '../../../shared/types'
import type {
  PipelineStageContext,
  PipelineStages,
} from '../stages'

export type FixtureStageOptions = {
  spec: ExperimentSpec
  runId?: string
  result?: ExperimentResult
  /** Hook after the last PLAN_EXPERIMENT emit, before `plan` returns. */
  duringPlan?: (context: PipelineStageContext) => Promise<void>
  /** Hook after `run.started`, before the result. Used to test aborts. */
  duringExecute?: (context: PipelineStageContext) => Promise<void>
  /**
   * Hook after the EVALUATE `stage.started`, which follows `run.succeeded`.
   * Used to test a budget expiry after the run has already settled.
   */
  duringEvaluate?: (context: PipelineStageContext) => Promise<void>
  /**
   * Defaults to true. With false the fixture never inspects `signal`, which
   * simulates a provider that ignores cancellation so the transport's own
   * deadline enforcement can be exercised.
   */
  cooperative?: boolean
}

export type FixtureStages = {
  stages: PipelineStages
  readonly planCalls: number
  readonly executeCalls: number
}

export function createFixtureStages(
  options: FixtureStageOptions,
): FixtureStages {
  const runId = options.runId ?? 'run-fixture-1'
  const result = options.result ?? fixtureResult()
  const cooperative = options.cooperative ?? true

  let planCalls = 0
  let executeCalls = 0

  const throwIfAborted = (context: PipelineStageContext): void => {
    if (!cooperative) return
    if (context.signal.aborted) throw context.signal.reason
  }

  const stages: PipelineStages = {
    async plan(context) {
      planCalls += 1

      await context.emit({ type: 'stage.started', stage: 'INGEST_SOURCE' })
      throwIfAborted(context)
      await context.emit({
        type: 'stage.finished',
        stage: 'INGEST_SOURCE',
        status: 'succeeded',
        taskId: null,
        error: null,
      })

      await context.emit({
        type: 'stage.started',
        stage: 'PLAN_EXPERIMENT',
      })
      throwIfAborted(context)
      await context.emit({
        type: 'stage.finished',
        stage: 'PLAN_EXPERIMENT',
        status: 'succeeded',
        taskId: null,
        error: null,
      })

      await options.duringPlan?.(context)

      return { spec: options.spec }
    },

    async execute(context) {
      executeCalls += 1

      await context.emit({ type: 'stage.started', stage: 'EXECUTE' })
      await context.emit({
        type: 'run.started',
        runId,
        attempt: 1,
        sandboxId: null,
      })

      await options.duringExecute?.(context)
      throwIfAborted(context)

      await context.emit({ type: 'run.succeeded', runId, result })
      await context.emit({
        type: 'stage.finished',
        stage: 'EXECUTE',
        status: 'succeeded',
        taskId: null,
        error: null,
      })

      await context.emit({ type: 'stage.started', stage: 'EVALUATE' })
      await options.duringEvaluate?.(context)
      throwIfAborted(context)
      await context.emit({
        type: 'verdict.computed',
        runId,
        verdict: 'match',
        detail: { checks: [], explanation: null },
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

  return {
    stages,
    get planCalls() {
      return planCalls
    },
    get executeCalls() {
      return executeCalls
    },
  }
}

export function fixtureResult(): ExperimentResult {
  return {
    exitCode: 0,
    stdout: 'fixture\n',
    stderr: '',
    metrics: { score: 0.9 },
    artifacts: [],
    durationMs: 12,
    environment: {
      imageDigest: 'sha256:fixture',
      python: '3.12',
      packages: {},
      datasets: [],
      seeds: [42],
      startedAt: new Date(0).toISOString(),
    },
  }
}
