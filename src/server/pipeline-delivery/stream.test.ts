import { describe, expect, it } from 'vitest'
import { PipelineDbError } from '../../db/pipeline-validation'
import { describeStreamFailure } from './stream'

/**
 * `pipeline.failed.error` is persisted durably and streamed to the browser.
 * A driver or provider error message is not safe to reuse there: it can carry
 * a host, a credential fragment or a request id.
 */
describe('describeStreamFailure', () => {
  it('does not copy a provider exception message onto the wire', () => {
    const text = describeStreamFailure(
      new Error('429 from https://provider.example sk-live-123'),
    )
    expect(text).toBe('The pipeline failed unexpectedly')
    expect(text).not.toContain('sk-live-123')
    expect(text).not.toContain('provider.example')
  })

  it('does not stringify a non-Error throwable', () => {
    expect(describeStreamFailure({ connectionString: 'postgres://u:p@h/db' }))
      .toBe('The pipeline failed unexpectedly')
  })

  it('keeps the coded refusal but drops the database message', () => {
    const text = describeStreamFailure(
      new PipelineDbError(
        'DATA_CORRUPT',
        'row 42 at host db.internal has a bad payload',
      ),
    )
    expect(text).toBe(
      'The pipeline database refused the operation (DATA_CORRUPT)',
    )
    expect(text).not.toContain('db.internal')
    expect(text).not.toContain('row 42')
  })
})
