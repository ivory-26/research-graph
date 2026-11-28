/**
 * TEST-ONLY fixtures for the production stage-provider tests.
 *
 * `makeValidSpec` is a plan the real planner accepts. The runner and the model
 * call are deterministic stand-ins at their respective seams: they are used
 * because this suite must not need E2B or Gemini credentials. The delivery
 * handlers, the database, the planner validation, the run row and the
 * evaluator are real.
 */
import type { z } from 'zod'

import type {
  ExperimentResult,
  ExperimentSpec,
} from '../../../shared/types'
import type {
  AgentTaskInsert,
  CallModel,
  CallModelContext,
  CallModelResult,
} from '../../model'
import {
  PINNED_E2B_TEMPLATE,
  type ExperimentRunner,
} from '../../runner'

/** A plan the real planner accepts, bound to the seeded claim node. */
export function makeValidSpec(claimNodeId: string): ExperimentSpec {
  return {
    claimNodeId,
    mode: 'adapted',
    language: 'python',
    image: PINNED_E2B_TEMPLATE,
    entrypoint: 'python main.py',
    files: {
      'main.py': [
        'import json',
        '',
        'metrics = {"score": 0.9}',
        'with open("/output/metrics.json", "w") as handle:',
        '    json.dump(metrics, handle)',
        '',
      ].join('\n'),
    },
    datasets: [],
    parameters: { seed: 42, estimatedRuntimeSeconds: 5 },
    criteria: {
      mode: 'all',
      checks: [{ metric: 'score', op: 'gte', value: 0.5 }],
    },
    timeoutSeconds: 30,
    memoryMb: 2048,
    cpuCount: 1,
    network: 'none',
  }
}

export function measuredResult(
  overrides: Partial<ExperimentResult> = {},
): ExperimentResult {
  return {
    exitCode: 0,
    sandboxId: 'sandbox-test-1',
    stdout: 'computed metrics\n',
    stderr: '',
    metrics: { score: 0.9 },
    artifacts: [],
    durationMs: 25,
    environment: {
      imageDigest: 'sha256:test-image',
      python: 'Python 3.12.16',
      packages: {},
      datasets: [],
      seeds: [42],
      startedAt: new Date(0).toISOString(),
    },
    ...overrides,
  }
}

/**
 * The evaluator's model call, replaced by a deterministic one that still writes
 * exactly one `agent_tasks` row through the supplied store. That keeps the
 * "every model call is recorded" invariant without network access.
 */
export function createRecordedCallModel(): CallModel {
  return async function recordedCallModel<T>(
    _schema: z.ZodType<T>,
    _prompt: string,
    context: CallModelContext,
  ): Promise<CallModelResult<T>> {
    const explanation =
      'The measured score exceeded the published threshold.'
    const task: AgentTaskInsert = {
      workspaceId: context.workspaceId,
      strategyId: null,
      taskKind: context.taskKind,
      model: 'deterministic-test-model',
      status: 'succeeded',
      inputRef: context.inputRef ?? {},
      output: { explanation },
      error: null,
      promptTokens: 12,
      completionTokens: 9,
      costUsd: null,
      latencyMs: 1,
    }
    const { id } = await context.store.insert(task)
    return {
      output: { explanation } as unknown as T,
      task: { ...task, id },
      attempts: [{ ...task, id }],
    }
  }
}

export type StubRunnerMode = 'succeed' | 'throw' | 'hangUntilCancel'

export type StubRunner = ExperimentRunner & {
  runCalls: number
  cancelCalls: string[]
  getActiveSandboxes(): ReadonlyMap<string, unknown>
}

export function createStubRunner(mode: StubRunnerMode): StubRunner {
  let release: () => void = () => undefined
  const active = new Map<string, unknown>([['sandbox-test-1', {}]])

  return {
    runCalls: 0,
    cancelCalls: [],
    getActiveSandboxes: () => active,
    async run(_spec, _onStdout) {
      this.runCalls += 1
      if (mode === 'succeed') return measuredResult()
      if (mode === 'throw') {
        throw new Error(
          'provider rejected: postgres://user:secret@db.internal:5432/app sk-test-secret',
        )
      }
      return new Promise<ExperimentResult>((resolve) => {
        release = () => resolve(measuredResult())
      })
    },
    async cancel(sandboxId) {
      this.cancelCalls.push(sandboxId)
      release()
    },
  }
}
