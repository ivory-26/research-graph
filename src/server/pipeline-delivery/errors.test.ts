import { describe, expect, it } from 'vitest'
import {
  PipelineDbError,
  type PipelineDbErrorCode,
} from '../../db/pipeline-validation'
import {
  PipelineHttpError,
  statusForPipelineDbCode,
  toErrorResponse,
} from './errors'

async function errorBody(response: Response): Promise<{
  error: { code: string; message: string }
}> {
  return (await response.json()) as {
    error: { code: string; message: string }
  }
}

describe('statusForPipelineDbCode', () => {
  it.each([
    ['INVALID_ARGUMENT', 400],
    ['INVALID_CURSOR', 400],
    ['INVALID_SPEC', 400],
    ['EXPERIMENT_NOT_FOUND', 404],
    ['GATE_NOT_FOUND', 404],
    ['GATE_ALREADY_DECIDED', 409],
    ['GATE_CONFLICT', 409],
    ['CLAIM_EXPIRED', 409],
    ['CLAIM_CLOSED', 409],
    ['APPROVAL_STATE_CONFLICT', 409],
    ['DATA_CORRUPT', 500],
    ['SEQUENCE_EXHAUSTED', 500],
  ] as const)('maps %s to %i', (code: PipelineDbErrorCode, status) => {
    expect(statusForPipelineDbCode(code)).toBe(status)
  })
})

describe('toErrorResponse', () => {
  it('passes a delivery refusal through unchanged', async () => {
    const response = toErrorResponse(
      new PipelineHttpError(401, 'UNAUTHENTICATED', 'sign in'),
    )
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await errorBody(response)).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'sign in' },
    })
  })

  it('maps a database refusal and keeps a safe message', async () => {
    const response = toErrorResponse(
      new PipelineDbError('GATE_NOT_FOUND', 'no gate at that seq'),
    )
    expect(response.status).toBe(404)
    expect(await errorBody(response)).toEqual({
      error: { code: 'GATE_NOT_FOUND', message: 'no gate at that seq' },
    })
  })

  it('does not leak a 5xx database detail', async () => {
    const response = toErrorResponse(
      new PipelineDbError('DATA_CORRUPT', 'row 42 is malformed'),
    )
    expect(response.status).toBe(500)
    expect(await errorBody(response)).toEqual({
      error: {
        code: 'DATA_CORRUPT',
        message: 'The pipeline request failed',
      },
    })
  })

  it('turns an unexpected error into a generic 500', async () => {
    const response = toErrorResponse(new Error('socket exploded'))
    expect(response.status).toBe(500)
    expect(await errorBody(response)).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The pipeline request failed',
      },
    })
  })
})
