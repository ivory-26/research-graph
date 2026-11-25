/**
 * HTTP error shaping for the pipeline delivery handlers.
 *
 * The database layer refuses bad writes with a coded `PipelineDbError`. The
 * transport must not turn those refusals into a 500 with a database message,
 * and must not turn them into a 200 either. This module is the one place that
 * decides the HTTP status for each refusal.
 *
 * Messages for 5xx responses are deliberately generic: a database error detail
 * is not a safe thing to put on the wire.
 */
import { PipelineDbError } from '../../db/pipeline-validation'

export type PipelineProblemBody = {
  error: {
    code: string
    message: string
  }
}

/** A refusal raised by the delivery layer itself, before or around the DB. */
export class PipelineHttpError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'PipelineHttpError'
    this.status = status
    this.code = code
  }
}

const BAD_REQUEST_CODES = new Set([
  'INVALID_ARGUMENT',
  'INVALID_EVENT',
  'INVALID_CURSOR',
  'INVALID_SPEC',
])

const NOT_FOUND_CODES = new Set([
  'EXPERIMENT_NOT_FOUND',
  'GATE_NOT_FOUND',
  'CLAIM_NOT_FOUND',
])

const CONFLICT_CODES = new Set([
  'EXPERIMENT_TERMINAL',
  'CLAIM_MISMATCH',
  'CLAIM_ID_CONFLICT',
  'CLAIM_EXPIRED',
  'CLAIM_CLOSED',
  'GATE_CONFLICT',
  'GATE_ALREADY_DECIDED',
  'APPROVAL_STATE_CONFLICT',
  'SPEC_CLAIM_MISMATCH',
])

/** Status for a `PipelineDbError` code. Unknown or corrupt states are 500. */
export function statusForPipelineDbCode(code: string): number {
  if (BAD_REQUEST_CODES.has(code)) return 400
  if (NOT_FOUND_CODES.has(code)) return 404
  if (CONFLICT_CODES.has(code)) return 409
  return 500
}

export function problemResponse(
  status: number,
  code: string,
  message: string,
): Response {
  const body: PipelineProblemBody = { error: { code, message } }
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

/** The single error boundary for both raw route handlers. */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof PipelineHttpError) {
    return problemResponse(error.status, error.code, error.message)
  }

  if (error instanceof PipelineDbError) {
    const status = statusForPipelineDbCode(error.code)
    const message =
      status >= 500
        ? 'The pipeline request failed'
        : error.message
    return problemResponse(status, error.code, message)
  }

  // Unexpected: log on the server, say nothing useful on the wire.
  console.error('[pipeline-delivery] unhandled request error', error)
  return problemResponse(500, 'INTERNAL_ERROR', 'The pipeline request failed')
}
