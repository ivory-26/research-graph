import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { StreamBudgetExceededError, createStreamBudget } from './budget.ts'
import { STREAM_BUDGET_MS } from './constants.ts'

test('the prescribed stream budget is 240 seconds', () => {
  assert.equal(STREAM_BUDGET_MS, 240_000)
})

test('aborts the signal when the budget is exhausted', (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })

  const budget = createStreamBudget()

  assert.equal(budget.budgetMs, STREAM_BUDGET_MS)
  assert.equal(budget.deadline, 1_000 + STREAM_BUDGET_MS)
  assert.equal(budget.signal.aborted, false)
  assert.equal(budget.expired(), false)

  mock.timers.tick(STREAM_BUDGET_MS - 1)
  assert.equal(budget.signal.aborted, false)
  assert.equal(budget.expired(), false)

  mock.timers.tick(1)
  assert.equal(budget.signal.aborted, true)
  assert.equal(budget.expired(), true)
  assert.ok(budget.signal.reason instanceof StreamBudgetExceededError)
  assert.equal(budget.signal.reason.budgetMs, STREAM_BUDGET_MS)
  assert.equal(budget.signal.reason.name, 'StreamBudgetExceededError')

  budget.dispose()
})

test('dispose clears the timer without aborting the signal', (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })

  const budget = createStreamBudget(5_000)
  mock.timers.tick(4_000)
  budget.dispose()
  budget.dispose()
  mock.timers.tick(10_000)

  assert.equal(budget.signal.aborted, false)
  // The clock still passes the deadline; expiry is a predicate, not an event.
  assert.equal(budget.expired(), true)
})
