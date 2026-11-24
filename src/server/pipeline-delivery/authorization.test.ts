import { describe, expect, it } from 'vitest'
import {
  assertSameOrigin,
  requireExperimentIdParam,
} from './authorization'
import { PipelineHttpError } from './errors'

const ORIGIN = 'https://research.example'
const URL = `${ORIGIN}/api/pipeline/11111111-1111-4111-8111-111111111111`

function request(headers: Record<string, string> = {}): Request {
  return new Request(URL, { headers })
}

function expectHttpError(
  run: () => void,
  status: number,
  code: string,
): void {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(PipelineHttpError)
    expect(error).toMatchObject({ status, code })
    return
  }
  throw new Error(`expected a ${status} ${code} refusal`)
}

describe('assertSameOrigin', () => {
  it('allows an absent Origin on a GET-style request', () => {
    expect(() => assertSameOrigin(request())).not.toThrow()
  })

  it('allows a matching Origin', () => {
    expect(() =>
      assertSameOrigin(request({ origin: ORIGIN })),
    ).not.toThrow()
  })

  it('rejects a foreign Origin', () => {
    expectHttpError(
      () => assertSameOrigin(request({ origin: 'https://evil.example' })),
      403,
      'ORIGIN_MISMATCH',
    )
  })

  it('requires an Origin for the state-changing approval POST', () => {
    expectHttpError(
      () => assertSameOrigin(request(), { requireOrigin: true }),
      403,
      'ORIGIN_REQUIRED',
    )
  })
})

describe('requireExperimentIdParam', () => {
  it('accepts a UUID and normalizes case', () => {
    expect(
      requireExperimentIdParam(
        'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE',
      ),
    ).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
  })

  it.each([
    undefined,
    '',
    'not-a-uuid',
    '11111111-1111-4111-8111-11111111111',
  ])('rejects %s', (value) => {
    expectHttpError(
      () => requireExperimentIdParam(value),
      400,
      'INVALID_EXPERIMENT_ID',
    )
  })
})
