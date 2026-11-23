import { STREAM_BUDGET_MS } from './constants.ts'

/** The reason carried by `signal.reason` when the 240s budget runs out. */
export class StreamBudgetExceededError extends Error {
  readonly budgetMs: number

  constructor(budgetMs: number) {
    super(`pipeline stream budget of ${budgetMs} ms exhausted`)
    this.name = 'StreamBudgetExceededError'
    this.budgetMs = budgetMs
  }
}

export type StreamBudget = {
  readonly budgetMs: number
  /** Epoch milliseconds at which the signal aborts. */
  readonly deadline: number
  /** Aborts with `StreamBudgetExceededError` at the deadline. */
  readonly signal: AbortSignal
  /** Clock check, independent of whether the timer already fired. */
  expired(): boolean
  /** Clears the timer. Does not abort the signal: use on normal completion. */
  dispose(): void
}

/**
 * Tracks the response-lifetime budget for one pipeline stream.
 *
 * The signal is meant to be combined with the request's abort signal
 * (`AbortSignal.any`) and handed to whatever waits. It does not emit
 * `run.timeout` or mark the run failed: that is the pipeline's job, because
 * only the pipeline knows which run the budget expired under.
 */
export function createStreamBudget(budgetMs: number = STREAM_BUDGET_MS): StreamBudget {
  const deadline = Date.now() + budgetMs
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new StreamBudgetExceededError(budgetMs))
  }, budgetMs)
  let disposed = false

  return {
    budgetMs,
    deadline,
    signal: controller.signal,
    expired: () => Date.now() >= deadline,
    dispose: () => {
      if (disposed) return
      disposed = true
      clearTimeout(timer)
    },
  }
}
