/**
 * Unit coverage for the abort → sandbox-disposal wrapper.
 *
 * No Postgres and no E2B: the fake runner records `cancel` calls and reports
 * the sandboxes it holds. The real `E2BRunner` disposal paths are covered in
 * `src/server/runner.test.ts`; the full ABORT → durable-row path is covered by
 * `production-stages.integration.test.ts` when `TEST_DATABASE_URL` is set.
 */
import { describe, expect, it, vi } from 'vitest'

import type { ExperimentResult, ExperimentSpec } from '../../shared/types'
import type { ExperimentRunner } from '../runner'
import { createSandboxCancellingRunner } from './production-stages'

const SPEC = {} as ExperimentSpec

function fakeResult(): ExperimentResult {
  return {
    exitCode: 0,
    sandboxId: 'late-sandbox',
    stdout: '',
    stderr: '',
    metrics: { score: 0.9 },
    artifacts: [],
    durationMs: 1,
    environment: {
      imageDigest: 'unknown',
      python: 'unknown',
      packages: {},
      datasets: [],
      seeds: [],
      startedAt: new Date(0).toISOString(),
    },
  }
}

type FakeRunner = ExperimentRunner & {
  getActiveSandboxes(): ReadonlyMap<string, unknown>
}

function createFakeRunner(run: ExperimentRunner['run']) {
  const active = new Map<string, unknown>()
  const cancelCalls: string[] = []
  const runner: FakeRunner = {
    run,
    async cancel(sandboxId) {
      cancelCalls.push(sandboxId)
      active.delete(sandboxId)
    },
    getActiveSandboxes: () => active,
  }
  return { runner, active, cancelCalls }
}

describe('createSandboxCancellingRunner', () => {
  it('does not cancel anything when the run completes without an abort', async () => {
    const { runner, cancelCalls } = createFakeRunner(async () => fakeResult())
    const wrapped = createSandboxCancellingRunner(
      runner,
      new AbortController().signal,
    )

    await expect(wrapped.run(SPEC, () => {})).resolves.toEqual(fakeResult())
    expect(cancelCalls).toEqual([])
  })

  it('cancels the live sandbox once when the signal aborts during the run', async () => {
    const controller = new AbortController()
    const { runner, active, cancelCalls } = createFakeRunner(async () => {
      active.set('live-sandbox', {})
      controller.abort(new Error('budget expired'))
      return fakeResult()
    })
    const wrapped = createSandboxCancellingRunner(runner, controller.signal)

    await expect(wrapped.run(SPEC, () => {})).resolves.toEqual(fakeResult())

    // One sweep cancels it; the settle sweep must not cancel it twice.
    expect(cancelCalls).toEqual(['live-sandbox'])
    expect(active.size).toBe(0)
  })

  it('sweeps again after settlement for a sandbox created after the abort fired', async () => {
    const controller = new AbortController()
    const { runner, active, cancelCalls } = createFakeRunner(async () => {
      // The abort lands while `Sandbox.create` is still in flight: the
      // listener's sweep runs now and finds an empty map.
      controller.abort(new Error('budget expired'))
      expect(cancelCalls).toEqual([])
      // `Sandbox.create` then resolves and the runner registers its sandbox.
      active.set('late-sandbox', {})
      return fakeResult()
    })
    const wrapped = createSandboxCancellingRunner(runner, controller.signal)

    await expect(wrapped.run(SPEC, () => {})).resolves.toEqual(fakeResult())

    // Without the settle sweep this sandbox would live until the E2B timeout.
    expect(cancelCalls).toEqual(['late-sandbox'])
    expect(active.size).toBe(0)
  })

  it('does not re-cancel a sandbox the abort sweep already saw', async () => {
    const controller = new AbortController()
    const active = new Map<string, unknown>([['sticky-sandbox', {}]])
    const cancelCalls: string[] = []
    const runner: FakeRunner = {
      async run() {
        controller.abort(new Error('budget expired'))
        return fakeResult()
      },
      async cancel(sandboxId) {
        // A runner may still report an id whose kill is in flight.
        cancelCalls.push(sandboxId)
      },
      getActiveSandboxes: () => active,
    }
    const wrapped = createSandboxCancellingRunner(runner, controller.signal)

    await expect(wrapped.run(SPEC, () => {})).resolves.toEqual(fakeResult())
    expect(cancelCalls).toEqual(['sticky-sandbox'])
  })

  it('still sweeps after the runner rejects', async () => {
    const controller = new AbortController()
    const failure = new Error('runner failed')
    const { runner, active, cancelCalls } = createFakeRunner(async () => {
      controller.abort(failure)
      active.set('late-sandbox', {})
      throw failure
    })
    const wrapped = createSandboxCancellingRunner(runner, controller.signal)

    await expect(wrapped.run(SPEC, () => {})).rejects.toBe(failure)
    expect(cancelCalls).toEqual(['late-sandbox'])
    expect(active.size).toBe(0)
  })

  it('refuses to start a run on an already-aborted signal', async () => {
    const run = vi.fn(async () => fakeResult())
    const { runner, cancelCalls } = createFakeRunner(run)
    const controller = new AbortController()
    const reason = new Error('client disconnected')
    controller.abort(reason)
    const wrapped = createSandboxCancellingRunner(runner, controller.signal)

    await expect(wrapped.run(SPEC, () => {})).rejects.toBe(reason)
    expect(run).not.toHaveBeenCalled()
    expect(cancelCalls).toEqual([])
  })

  it('does not throw on abort when the runner cannot report active sandboxes', async () => {
    const controller = new AbortController()
    const cancel = vi.fn(async () => {})
    const runner: ExperimentRunner = {
      async run() {
        controller.abort(new Error('budget expired'))
        return fakeResult()
      },
      cancel,
    }
    const wrapped = createSandboxCancellingRunner(runner, controller.signal)

    await expect(wrapped.run(SPEC, () => {})).resolves.toEqual(fakeResult())
    expect(cancel).not.toHaveBeenCalled()
  })

  it('delegates cancel to the wrapped runner', async () => {
    const { runner, cancelCalls } = createFakeRunner(async () => fakeResult())
    const wrapped = createSandboxCancellingRunner(
      runner,
      new AbortController().signal,
    )

    await wrapped.cancel('sb-1')
    expect(cancelCalls).toEqual(['sb-1'])
  })
})
