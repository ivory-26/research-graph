/**
 * Runtime validation for the pipeline DB layer.
 *
 * The shared contracts in `src/shared/events.ts` and `src/shared/types.ts` are
 * TypeScript-only. This module is the runtime half of those contracts: every
 * event appended, replayed, or turned into an approval gate is checked here,
 * so a malformed value can never become a durable row merely by passing a
 * type assertion at a call site.
 *
 * Nothing in this file changes a shared contract; it only refuses values those
 * contracts do not describe.
 */
import { PIPELINE_STAGES } from '../shared/events'
import type { PipelineEvent, PipelineEventType } from '../shared/events'
import type {
  AgentTaskStatus,
  EdgeRelation,
  EdgeStatus,
  ExperimentSpec,
  Mode,
  NodeType,
  TaskKind,
  Verdict,
} from '../shared/types'

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const PIPELINE_DB_ERROR_CODES = [
  'INVALID_ARGUMENT',
  'INVALID_EVENT',
  'INVALID_CURSOR',
  'INVALID_SPEC',
  'SPEC_CLAIM_MISMATCH',
  'EXPERIMENT_NOT_FOUND',
  'EXPERIMENT_TERMINAL',
  'SEQUENCE_EXHAUSTED',
  'CLAIM_NOT_FOUND',
  'CLAIM_MISMATCH',
  'CLAIM_ID_CONFLICT',
  'CLAIM_EXPIRED',
  'CLAIM_CLOSED',
  'GATE_NOT_FOUND',
  'GATE_CONFLICT',
  'GATE_ALREADY_DECIDED',
  'APPROVAL_STATE_CONFLICT',
  'DATA_CORRUPT',
] as const

export type PipelineDbErrorCode = (typeof PIPELINE_DB_ERROR_CODES)[number]

/** A refusal by the pipeline DB layer, with a code the transport can branch on. */
export class PipelineDbError extends Error {
  readonly code: PipelineDbErrorCode

  constructor(
    code: PipelineDbErrorCode,
    message?: string,
    options?: ErrorOptions,
  ) {
    super(message ?? code, options)
    this.name = 'PipelineDbError'
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// Frozen event vocabulary
// ---------------------------------------------------------------------------

export const PIPELINE_EVENT_TYPES = [
  'pipeline.started',
  'stage.started',
  'stage.finished',
  'agent_task.recorded',
  'node.upserted',
  'edge.upserted',
  'approval.requested',
  'approval.resolved',
  'run.started',
  'run.stdout',
  'run.succeeded',
  'run.failed',
  'run.timeout',
  'verdict.computed',
  'pipeline.completed',
  'pipeline.failed',
  'pipeline.cancelled',
] as const satisfies readonly PipelineEventType[]

// If a member is added to PipelineEventType, this line stops compiling until
// the runtime list above is updated. That is the intended failure.
type MissingPipelineEventType = Exclude<
  PipelineEventType,
  (typeof PIPELINE_EVENT_TYPES)[number]
>
const pipelineEventTypesAreExhaustive: MissingPipelineEventType extends never
  ? true
  : never = true
void pipelineEventTypesAreExhaustive

const pipelineEventTypeSet = new Set<string>(PIPELINE_EVENT_TYPES)

export type TerminalPipelineEventType =
  | 'pipeline.completed'
  | 'pipeline.failed'
  | 'pipeline.cancelled'

export const TERMINAL_PIPELINE_EVENT_TYPES = [
  'pipeline.completed',
  'pipeline.failed',
  'pipeline.cancelled',
] as const satisfies readonly TerminalPipelineEventType[]

export function isTerminalEventType(
  type: PipelineEventType,
): type is TerminalPipelineEventType {
  return (TERMINAL_PIPELINE_EVENT_TYPES as readonly string[]).includes(type)
}

/**
 * The two approval events are written only by `openApprovalGate` and
 * `decideApproval`, which also write the gate row and the experiment state in
 * the same transaction. Letting `appendPipelineEvent` write one alone would
 * create an event with no gate, or a gate with no decision.
 */
export const RESERVED_APPEND_EVENT_TYPES = [
  'approval.requested',
  'approval.resolved',
] as const satisfies readonly PipelineEventType[]

/** A PipelineEvent without the three base fields the database assigns. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never

export type PipelineEventInput = DistributiveOmit<
  PipelineEvent,
  'seq' | 'experimentId' | 'at'
> & { at?: string }

// ---------------------------------------------------------------------------
// Field vocabulary
// ---------------------------------------------------------------------------

const MODES = ['exact', 'adapted', 'conceptual'] as const satisfies readonly Mode[]
const NODE_TYPES = [
  'source',
  'claim',
  'method',
  'dataset',
  'result',
  'run',
  'note',
] as const satisfies readonly NodeType[]
const EDGE_RELATIONS = [
  'supports',
  'contradicts',
  'cites',
  'uses_dataset',
  'tests',
  'produced',
  'derived_from',
] as const satisfies readonly EdgeRelation[]
const EDGE_STATUSES = [
  'suggested',
  'accepted',
  'rejected',
] as const satisfies readonly EdgeStatus[]
const TASK_KINDS = [
  'ingest',
  'extract_claims',
  'propose_edges',
  'plan_experiment',
  'repair_script',
  'explain_gap',
  'ask_across_sources',
] as const satisfies readonly TaskKind[]
const AGENT_TASK_STATUSES = [
  'succeeded',
  'failed',
  'rejected',
  'retried',
] as const satisfies readonly AgentTaskStatus[]
const STAGE_STATUSES = ['succeeded', 'failed', 'cancelled'] as const
const VERDICTS = [
  'match',
  'mismatch',
  'inconclusive',
  'failed',
] as const satisfies readonly Verdict[]
const CRITERIA_OPS = [
  'lt',
  'lte',
  'gt',
  'gte',
  'eq',
  'neq',
  'within',
] as const
const APPROVAL_DECISIONS = ['approved', 'rejected'] as const

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MAX_SEQ = 2_147_483_647
const MAX_CLAIM_TTL_MS = 86_400_000
const MAX_EVENT_PAGE = 1_000

// ---------------------------------------------------------------------------
// Primitive checks
// ---------------------------------------------------------------------------

type ValidationCode = 'INVALID_ARGUMENT' | 'INVALID_EVENT' | 'INVALID_SPEC'

function invalid(code: ValidationCode, message: string): never {
  throw new PipelineDbError(code, message)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Public entry points accept typed objects, but never trust a call site. */
export function requireObjectInput(
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    invalid('INVALID_ARGUMENT', `${path} must be an object`)
  }
  return value
}

function requireRecord(
  value: unknown,
  path: string,
  code: ValidationCode,
): Record<string, unknown> {
  if (!isRecord(value)) invalid(code, `${path} must be an object`)
  return value
}

function requireArray(
  value: unknown,
  path: string,
  code: ValidationCode,
): unknown[] {
  if (!Array.isArray(value)) invalid(code, `${path} must be an array`)
  return value
}

function requireString(
  value: unknown,
  path: string,
  code: ValidationCode,
  allowEmpty = false,
): string {
  if (typeof value !== 'string') invalid(code, `${path} must be a string`)
  if (!allowEmpty && value.length === 0) {
    invalid(code, `${path} must not be empty`)
  }
  return value
}

function requireNullableString(
  value: unknown,
  path: string,
  code: ValidationCode,
): string | null {
  if (value === null) return null
  return requireString(value, path, code)
}

function requireNumber(
  value: unknown,
  path: string,
  code: ValidationCode,
  options: { integer?: boolean; min?: number; positive?: boolean } = {},
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid(code, `${path} must be a finite number`)
  }
  if (options.integer && !Number.isInteger(value)) {
    invalid(code, `${path} must be an integer`)
  }
  if (options.min !== undefined && value < options.min) {
    invalid(code, `${path} must be >= ${options.min}`)
  }
  if (options.positive && value <= 0) {
    invalid(code, `${path} must be > 0`)
  }
  return value
}

function requireNullableNumber(
  value: unknown,
  path: string,
  code: ValidationCode,
  options: { integer?: boolean; min?: number } = {},
): number | null {
  if (value === null) return null
  return requireNumber(value, path, code, options)
}

function requireBoolean(
  value: unknown,
  path: string,
  code: ValidationCode,
): boolean {
  if (typeof value !== 'boolean') invalid(code, `${path} must be a boolean`)
  return value
}

function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  code: ValidationCode,
): T {
  if (
    typeof value !== 'string' ||
    !(allowed as readonly string[]).includes(value)
  ) {
    invalid(code, `${path} must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

export function requireUuid(
  value: unknown,
  path: string,
  code: ValidationCode = 'INVALID_ARGUMENT',
): string {
  const text = requireString(value, path, code)
  if (!UUID_RE.test(text)) invalid(code, `${path} must be a UUID`)
  return text
}

function requireIsoTimestamp(
  value: unknown,
  path: string,
  code: ValidationCode,
): string {
  const text = requireString(value, path, code)
  if (Number.isNaN(Date.parse(text))) {
    invalid(code, `${path} must be an ISO 8601 timestamp`)
  }
  return text
}

// ---------------------------------------------------------------------------
// Public input checks
// ---------------------------------------------------------------------------

export function requireExperimentId(value: unknown): string {
  return requireUuid(value, 'experimentId', 'INVALID_ARGUMENT')
}

export function requireWorkspaceId(value: unknown): string {
  return requireUuid(value, 'workspaceId', 'INVALID_ARGUMENT')
}

export function requireClaimId(value: unknown): string {
  return requireUuid(value, 'claimId', 'INVALID_ARGUMENT')
}

/** Positive int4: the range of `pipeline_events.seq` and `gate_seq`. */
export function requireSequence(value: unknown, path: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_SEQ
  ) {
    throw new PipelineDbError(
      'INVALID_ARGUMENT',
      `${path} must be a positive integer no greater than ${MAX_SEQ}`,
    )
  }
  return value
}

/** Exclusive replay cursor: 0 means "from the beginning". */
export function requireCursor(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_SEQ
  ) {
    throw new PipelineDbError(
      'INVALID_CURSOR',
      'afterSeq must be an integer between 0 and 2147483647',
    )
  }
  return value
}

export function requireLimit(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_EVENT_PAGE
  ) {
    throw new PipelineDbError(
      'INVALID_ARGUMENT',
      `limit must be an integer between 1 and ${MAX_EVENT_PAGE}`,
    )
  }
  return value
}

export function requireTtlMs(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_CLAIM_TTL_MS
  ) {
    throw new PipelineDbError(
      'INVALID_ARGUMENT',
      `ttlMs must be an integer between 1 and ${MAX_CLAIM_TTL_MS}`,
    )
  }
  return value
}

/**
 * The transport verifies the actor. This layer only records the verified id it
 * is handed; it never derives one from a request, a header, or a session.
 */
export function requireActorId(value: unknown): string {
  const actorId = requireString(
    value,
    'actorId',
    'INVALID_ARGUMENT',
  )
  if (
    actorId.trim() !== actorId ||
    actorId.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(actorId)
  ) {
    throw new PipelineDbError(
      'INVALID_ARGUMENT',
      'actorId must be a trimmed, printable string of at most 256 characters',
    )
  }
  return actorId
}

export function requireApprovalDecision(value: unknown): 'approved' | 'rejected' {
  return requireEnum(
    value,
    APPROVAL_DECISIONS,
    'decision',
    'INVALID_ARGUMENT',
  )
}

// ---------------------------------------------------------------------------
// ExperimentSpec (docs/04-experiment-runtime.md, src/shared/types.ts)
// ---------------------------------------------------------------------------

/**
 * Structural validation only. Product rules such as "estimated runtime under
 * 60 seconds" and "mode is not exact" belong to PLAN_EXPERIMENT; duplicating
 * them here would make the gate a second planner with different errors.
 */
export function validateExperimentSpec(value: unknown): ExperimentSpec {
  const code: ValidationCode = 'INVALID_SPEC'
  const spec = requireRecord(value, 'spec', code)

  requireUuid(spec.claimNodeId, 'spec.claimNodeId', code)
  requireEnum(spec.mode, MODES, 'spec.mode', code)
  if (spec.language !== 'python') {
    invalid(code, "spec.language must be 'python'")
  }
  requireString(spec.image, 'spec.image', code)

  const files = requireRecord(spec.files, 'spec.files', code)
  const fileNames = Object.keys(files)
  if (fileNames.length === 0) {
    invalid(code, 'spec.files must contain at least one file')
  }
  for (const [name, source] of Object.entries(files)) {
    requireString(source, `spec.files.${name}`, code, true)
  }

  requireString(spec.entrypoint, 'spec.entrypoint', code)

  const datasets = requireArray(spec.datasets, 'spec.datasets', code)
  datasets.forEach((entry, index) => {
    const path = `spec.datasets[${index}]`
    const dataset = requireRecord(entry, path, code)
    requireString(dataset.name, `${path}.name`, code)
    requireString(dataset.url, `${path}.url`, code)
    requireString(dataset.path, `${path}.path`, code)
    if (dataset.sha256 !== null) {
      requireString(dataset.sha256, `${path}.sha256`, code)
    }
    requireNullableNumber(dataset.bytes, `${path}.bytes`, code, { min: 0 })
  })

  requireRecord(spec.parameters, 'spec.parameters', code)

  const criteria = requireRecord(spec.criteria, 'spec.criteria', code)
  requireEnum(criteria.mode, ['all', 'any'] as const, 'spec.criteria.mode', code)
  const checks = requireArray(criteria.checks, 'spec.criteria.checks', code)
  checks.forEach((entry, index) => {
    const path = `spec.criteria.checks[${index}]`
    const check = requireRecord(entry, path, code)
    requireString(check.metric, `${path}.metric`, code)
    requireEnum(check.op, CRITERIA_OPS, `${path}.op`, code)
    requireNumber(check.value, `${path}.value`, code)
    if (check.tolerance !== undefined) {
      requireNumber(check.tolerance, `${path}.tolerance`, code, { min: 0 })
    }
  })

  requireNumber(spec.timeoutSeconds, 'spec.timeoutSeconds', code, {
    positive: true,
  })
  requireNumber(spec.memoryMb, 'spec.memoryMb', code, { positive: true })
  requireNumber(spec.cpuCount, 'spec.cpuCount', code, { positive: true })

  if (spec.network !== 'none') {
    invalid(code, "spec.network must be 'none'")
  }

  return value as ExperimentSpec
}

// ---------------------------------------------------------------------------
// PipelineEvent
// ---------------------------------------------------------------------------

function requireEventType(value: unknown, path: string): PipelineEventType {
  if (typeof value !== 'string' || !pipelineEventTypeSet.has(value)) {
    invalid('INVALID_EVENT', `${path} is not a PipelineEvent type`)
  }
  return value as PipelineEventType
}

function validateEventPayload(
  event: Record<string, unknown>,
  type: PipelineEventType,
  code: ValidationCode,
): void {
  switch (type) {
    case 'pipeline.started':
      requireEnum(event.mode, MODES, 'event.mode', code)
      return

    case 'stage.started':
      requireEnum(event.stage, PIPELINE_STAGES, 'event.stage', code)
      return

    case 'stage.finished': {
      requireEnum(event.stage, PIPELINE_STAGES, 'event.stage', code)
      requireEnum(event.status, STAGE_STATUSES, 'event.status', code)
      requireNullableString(event.taskId, 'event.taskId', code)
      requireNullableString(event.error, 'event.error', code)
      return
    }

    case 'agent_task.recorded': {
      const task = requireRecord(event.task, 'event.task', code)
      requireString(task.id, 'event.task.id', code)
      requireEnum(task.taskKind, TASK_KINDS, 'event.task.taskKind', code)
      requireNullableString(task.strategyId, 'event.task.strategyId', code)
      requireString(task.model, 'event.task.model', code)
      requireEnum(task.status, AGENT_TASK_STATUSES, 'event.task.status', code)
      requireNullableNumber(
        task.promptTokens,
        'event.task.promptTokens',
        code,
        { integer: true, min: 0 },
      )
      requireNullableNumber(
        task.completionTokens,
        'event.task.completionTokens',
        code,
        { integer: true, min: 0 },
      )
      requireNullableNumber(task.costUsd, 'event.task.costUsd', code, {
        min: 0,
      })
      requireNullableNumber(task.latencyMs, 'event.task.latencyMs', code, {
        integer: true,
        min: 0,
      })
      requireNullableString(task.error, 'event.task.error', code)
      return
    }

    case 'node.upserted': {
      const node = requireRecord(event.node, 'event.node', code)
      requireString(node.id, 'event.node.id', code)
      const nodeType = requireEnum(node.type, NODE_TYPES, 'event.node.type', code)
      requireString(node.title, 'event.node.title', code)
      const data = requireRecord(node.data, 'event.node.data', code)
      if (data.type !== nodeType) {
        invalid(
          code,
          'event.node.data.type must match event.node.type',
        )
      }
      requireNullableString(node.sourceId, 'event.node.sourceId', code)
      return
    }

    case 'edge.upserted': {
      const edge = requireRecord(event.edge, 'event.edge', code)
      const id = requireString(edge.id, 'event.edge.id', code)
      const sourceNodeId = requireString(
        edge.sourceNodeId,
        'event.edge.sourceNodeId',
        code,
      )
      const targetNodeId = requireString(
        edge.targetNodeId,
        'event.edge.targetNodeId',
        code,
      )
      if (sourceNodeId === targetNodeId) {
        invalid(code, `event.edge ${id} cannot be a self-loop`)
      }
      requireEnum(edge.relation, EDGE_RELATIONS, 'event.edge.relation', code)
      requireEnum(edge.status, EDGE_STATUSES, 'event.edge.status', code)
      const evidenceChunkId = requireNullableString(
        edge.evidenceChunkId,
        'event.edge.evidenceChunkId',
        code,
      )
      const evidenceRunId = requireNullableString(
        edge.evidenceRunId,
        'event.edge.evidenceRunId',
        code,
      )
      if (evidenceChunkId === null && evidenceRunId === null) {
        invalid(
          code,
          'event.edge must carry evidenceChunkId or evidenceRunId',
        )
      }
      requireNullableNumber(edge.confidence, 'event.edge.confidence', code)
      return
    }

    case 'approval.requested':
      validateExperimentSpec(event.spec)
      if (event.repair !== undefined) {
        const repair = requireRecord(event.repair, 'event.repair', code)
        requireUuid(repair.parentRunId, 'event.repair.parentRunId', code)
        if (repair.attempt !== undefined) {
          requireNumber(repair.attempt, 'event.repair.attempt', code, {
            integer: true,
            min: 1,
          })
        }
      }
      return

    case 'approval.resolved':
      requireEnum(
        event.state,
        APPROVAL_DECISIONS,
        'event.state',
        code,
      )
      requireNullableString(event.approvedBy, 'event.approvedBy', code)
      return

    case 'run.started':
      requireString(event.runId, 'event.runId', code)
      requireNumber(event.attempt, 'event.attempt', code, {
        integer: true,
        min: 1,
      })
      requireNullableString(event.sandboxId, 'event.sandboxId', code)
      return

    case 'run.stdout':
      requireString(event.runId, 'event.runId', code)
      requireString(event.chunk, 'event.chunk', code, true)
      return

    case 'run.succeeded': {
      requireString(event.runId, 'event.runId', code)
      validateExperimentResult(event.result, 'event.result', code)
      return
    }

    case 'run.failed':
      requireString(event.runId, 'event.runId', code)
      requireString(event.error, 'event.error', code)
      return

    case 'run.timeout':
      requireString(event.runId, 'event.runId', code)
      requireNumber(event.budgetMs, 'event.budgetMs', code, {
        integer: true,
        positive: true,
      })
      return

    case 'verdict.computed':
      requireString(event.runId, 'event.runId', code)
      requireEnum(event.verdict, VERDICTS, 'event.verdict', code)
      validateVerdictDetail(event.detail, 'event.detail', code)
      return

    case 'pipeline.completed':
      requireNullableString(event.runId, 'event.runId', code)
      return

    case 'pipeline.failed':
      requireString(event.error, 'event.error', code)
      return

    case 'pipeline.cancelled':
      if (event.reason !== 'rejected') {
        invalid(code, "event.reason must be 'rejected'")
      }
      return
  }
}

function validateExperimentResult(
  value: unknown,
  path: string,
  code: ValidationCode,
): void {
  const result = requireRecord(value, path, code)
  requireNumber(result.exitCode, `${path}.exitCode`, code, { integer: true })
  requireString(result.stdout, `${path}.stdout`, code, true)
  requireString(result.stderr, `${path}.stderr`, code, true)

  const metrics = requireRecord(result.metrics, `${path}.metrics`, code)
  for (const [name, metric] of Object.entries(metrics)) {
    requireNumber(metric, `${path}.metrics.${name}`, code)
  }

  const artifacts = requireArray(result.artifacts, `${path}.artifacts`, code)
  artifacts.forEach((entry, index) => {
    const artifactPath = `${path}.artifacts[${index}]`
    const artifact = requireRecord(entry, artifactPath, code)
    requireString(artifact.path, `${artifactPath}.path`, code)
    requireString(artifact.sha256, `${artifactPath}.sha256`, code)
    requireNumber(artifact.bytes, `${artifactPath}.bytes`, code, {
      integer: true,
      min: 0,
    })
    if (artifact.content !== undefined) {
      requireString(artifact.content, `${artifactPath}.content`, code, true)
    }
  })

  requireNumber(result.durationMs, `${path}.durationMs`, code, { min: 0 })

  const environment = requireRecord(
    result.environment,
    `${path}.environment`,
    code,
  )
  requireString(
    environment.imageDigest,
    `${path}.environment.imageDigest`,
    code,
  )
  requireString(environment.python, `${path}.environment.python`, code)
  requireRecord(environment.packages, `${path}.environment.packages`, code)

  const datasets = requireArray(
    environment.datasets,
    `${path}.environment.datasets`,
    code,
  )
  datasets.forEach((entry, index) => {
    const datasetPath = `${path}.environment.datasets[${index}]`
    const dataset = requireRecord(entry, datasetPath, code)
    requireString(dataset.name, `${datasetPath}.name`, code)
    requireString(dataset.sha256, `${datasetPath}.sha256`, code)
    requireNumber(dataset.bytes, `${datasetPath}.bytes`, code, {
      integer: true,
      min: 0,
    })
  })

  const seeds = requireArray(environment.seeds, `${path}.environment.seeds`, code)
  seeds.forEach((seed, index) => {
    requireNumber(seed, `${path}.environment.seeds[${index}]`, code, {
      integer: true,
    })
  })
  requireString(
    environment.startedAt,
    `${path}.environment.startedAt`,
    code,
  )
}

function validateVerdictDetail(
  value: unknown,
  path: string,
  code: ValidationCode,
): void {
  const detail = requireRecord(value, path, code)
  const checks = requireArray(detail.checks, `${path}.checks`, code)
  checks.forEach((entry, index) => {
    const checkPath = `${path}.checks[${index}]`
    const check = requireRecord(entry, checkPath, code)
    requireString(check.metric, `${checkPath}.metric`, code)
    requireEnum(check.op, CRITERIA_OPS, `${checkPath}.op`, code)
    requireNumber(check.threshold, `${checkPath}.threshold`, code)
    requireNullableNumber(check.tolerance, `${checkPath}.tolerance`, code, {
      min: 0,
    })
    requireNullableNumber(check.measured, `${checkPath}.measured`, code)
    requireBoolean(check.passed, `${checkPath}.passed`, code)
  })
  requireNullableString(detail.explanation, `${path}.explanation`, code)
}

/** Validates a complete event, including the base fields the database owns. */
export function validatePipelineEvent(
  value: unknown,
): asserts value is PipelineEvent {
  const event = requireRecord(value, 'event', 'INVALID_EVENT')
  const type = requireEventType(event.type, 'event.type')
  requireNumber(event.seq, 'event.seq', 'INVALID_EVENT', {
    integer: true,
    min: 1,
  })
  if ((event.seq as number) > MAX_SEQ) {
    invalid('INVALID_EVENT', `event.seq must be <= ${MAX_SEQ}`)
  }
  requireUuid(event.experimentId, 'event.experimentId', 'INVALID_EVENT')
  requireIsoTimestamp(event.at, 'event.at', 'INVALID_EVENT')
  validateEventPayload(event, type, 'INVALID_EVENT')
}

/**
 * Validates the caller's half of an event. `seq`, `experimentId` and `at` are
 * assigned by the database layer; accepting them from a caller would let a
 * stale writer choose its own order or write into another experiment.
 */
export function validatePipelineEventInput(
  value: unknown,
): asserts value is PipelineEventInput {
  const event = requireRecord(value, 'event', 'INVALID_EVENT')
  if ('seq' in event) {
    invalid('INVALID_EVENT', 'event.seq is assigned by the database')
  }
  if ('experimentId' in event) {
    invalid(
      'INVALID_EVENT',
      'event.experimentId is assigned by the database',
    )
  }
  if (event.at !== undefined) {
    requireIsoTimestamp(event.at, 'event.at', 'INVALID_EVENT')
  }
  const type = requireEventType(event.type, 'event.type')
  validateEventPayload(event, type, 'INVALID_EVENT')
}

/** Validates a stored event and proves it belongs to the row that carried it. */
export function validateStoredPipelineEvent(
  value: unknown,
  expected: {
    experimentId: string
    seq: number
    type?: PipelineEventType
  },
): PipelineEvent {
  try {
    validatePipelineEvent(value)
  } catch (error) {
    if (error instanceof PipelineDbError) {
      throw new PipelineDbError(
        'DATA_CORRUPT',
        `stored event failed validation (experiment ${expected.experimentId}, seq ${expected.seq}): ${error.message}`,
        { cause: error },
      )
    }
    throw error
  }
  if (
    value.seq !== expected.seq ||
    value.experimentId !== expected.experimentId ||
    (expected.type !== undefined && value.type !== expected.type)
  ) {
    throw new PipelineDbError(
      'DATA_CORRUPT',
      `stored event does not match its row (experiment ${expected.experimentId}, seq ${expected.seq})`,
    )
  }
  return value
}
