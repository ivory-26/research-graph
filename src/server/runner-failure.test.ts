import { describe, expect, it } from 'vitest'

import {
  MetricsExtractionError,
  PackageVerificationError,
  SandboxTimeoutError,
} from './runner'
import {
  classifyRunnerFailure,
  isRepairableRunnerFailure,
  safeRunnerFailureMessage,
} from './runner-failure'

describe('classifyRunnerFailure', () => {
  it('treats a missing/invalid metrics file as a repairable script bug', () => {
    const error = new MetricsExtractionError(
      'metrics.json missing',
      0,
      'stdout',
      '',
    )

    expect(classifyRunnerFailure(error)).toBe('metrics')
    expect(isRepairableRunnerFailure(classifyRunnerFailure(error))).toBe(true)
    expect(safeRunnerFailureMessage('metrics')).toBe(
      'The experiment did not produce valid metrics',
    )
  })

  it('keeps a pinned-package mismatch out of the repair loop', () => {
    const error = new PackageVerificationError(
      'numpy: expected 2.5.5, found 2.4.0',
      0,
      'stdout',
      '',
    )

    expect(classifyRunnerFailure(error)).toBe('environment')
    expect(isRepairableRunnerFailure(classifyRunnerFailure(error))).toBe(false)
  })

  it('treats a sandbox timeout as repairable and names it', () => {
    const error = new SandboxTimeoutError('timed out', 30)

    expect(classifyRunnerFailure(error)).toBe('timeout')
    expect(isRepairableRunnerFailure(classifyRunnerFailure(error))).toBe(true)
    expect(safeRunnerFailureMessage('timeout')).toBe(
      'The experiment timed out before completing',
    )
  })

  it('falls back to infrastructure for an untyped provider failure', () => {
    const error = new Error(
      'provider rejected: postgres://user:secret@db.internal:5432/app sk-live-secret',
    )

    expect(classifyRunnerFailure(error)).toBe('infrastructure')
    expect(isRepairableRunnerFailure(classifyRunnerFailure(error))).toBe(false)
    expect(safeRunnerFailureMessage('infrastructure')).toBe(
      'The experiment runner did not complete',
    )
    expect(safeRunnerFailureMessage('infrastructure')).not.toContain('secret')
  })

  it('still classifies a cross-realm error by its name', () => {
    const error = new Error('metrics missing')
    error.name = 'MetricsExtractionError'

    expect(classifyRunnerFailure(error)).toBe('metrics')
  })
})
