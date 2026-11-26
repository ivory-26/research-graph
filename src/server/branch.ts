import { eq } from 'drizzle-orm'
import type { Database } from '../db/client'
import { experiments, runs } from '../db/schema'
import type {
  ApprovalState,
  ExperimentSpec,
  Mode,
  RunEnvironment,
  RunStatus,
} from '../shared/types'
import { validateExperimentSpec } from './planner'

export type SpecLeafDiff = {
  path: string
  before: unknown
  after: unknown
}

export type BranchValidationErrorCode =
  | 'PARENT_NOT_FOUND'
  | 'PARENT_NOT_COMPLETED'
  | 'PARENT_WORKSPACE_MISMATCH'
  | 'NO_CHANGES'
  | 'MULTIPLE_CHANGES'
  | 'FILES_CHANGE_NOT_ALLOWED'
  | 'INVALID_SPEC'
  | 'INVALID_PATH'

export class BranchValidationError extends Error {
  constructor(
    message: string,
    public readonly code: BranchValidationErrorCode,
    public readonly diffs: SpecLeafDiff[] = [],
  ) {
    super(message)
    this.name = 'BranchValidationError'
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

function assertJsonSafe(val: unknown, path = ''): void {
  if (val === undefined) {
    throw new BranchValidationError(
      `Value at "${path || 'root'}" cannot be undefined`,
      'INVALID_SPEC',
    )
  }
  if (typeof val === 'number' && !Number.isFinite(val)) {
    throw new BranchValidationError(
      `Numeric value at "${path || 'root'}" must be finite, got ${val}`,
      'INVALID_SPEC',
    )
  }
  if (typeof val === 'function' || typeof val === 'symbol' || typeof val === 'bigint') {
    throw new BranchValidationError(
      `Value at "${path || 'root'}" cannot be ${typeof val}`,
      'INVALID_SPEC',
    )
  }
  if (Array.isArray(val)) {
    val.forEach((item, idx) =>
      assertJsonSafe(item, path ? `${path}.${idx}` : String(idx)),
    )
  } else if (isPlainObject(val)) {
    for (const [k, v] of Object.entries(val)) {
      assertJsonSafe(v, path ? `${path}.${k}` : k)
    }
  }
}

function collectLeafDiffs(
  before: unknown,
  after: unknown,
  prefix: string,
  out: SpecLeafDiff[],
): void {
  if (Object.is(before, after)) {
    return
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    for (const key of keys) {
      const nextPath = prefix ? `${prefix}.${key}` : key
      collectLeafDiffs(before[key], after[key], nextPath, out)
    }
    return
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const maxLen = Math.max(before.length, after.length)
    for (let i = 0; i < maxLen; i++) {
      const nextPath = prefix ? `${prefix}.${i}` : String(i)
      collectLeafDiffs(before[i], after[i], nextPath, out)
    }
    return
  }

  if (isPlainObject(before) && after === undefined) {
    for (const key of Object.keys(before)) {
      const nextPath = prefix ? `${prefix}.${key}` : key
      collectLeafDiffs(before[key], undefined, nextPath, out)
    }
    return
  }

  if (before === undefined && isPlainObject(after)) {
    for (const key of Object.keys(after)) {
      const nextPath = prefix ? `${prefix}.${key}` : key
      collectLeafDiffs(undefined, after[key], nextPath, out)
    }
    return
  }

  out.push({ path: prefix, before, after })
}

/**
 * Computes all differing leaf paths between two ExperimentSpec objects.
 */
export function diffSpecLeaves(
  parentSpec: ExperimentSpec,
  childSpec: ExperimentSpec,
): SpecLeafDiff[] {
  const diffs: SpecLeafDiff[] = []
  collectLeafDiffs(parentSpec, childSpec, '', diffs)
  return diffs
}

/**
 * Returns a deep-cloned ExperimentSpec with a single dot-separated leaf path updated.
 * Supports `files.<filename>` where `<filename>` may contain dots (e.g. `files.main.py`).
 * Never mutates the input spec.
 */
export function applySingleLeafChange(
  spec: ExperimentSpec,
  leafPath: string,
  value: unknown,
): ExperimentSpec {
  assertJsonSafe(value, leafPath)
  const trimmedPath = leafPath.trim()
  if (trimmedPath.startsWith('files.')) {
    const fileKey = trimmedPath.slice('files.'.length)
    if (!fileKey || !Object.hasOwn(spec.files, fileKey)) {
      throw new BranchValidationError(
        `File "${fileKey}" does not exist in spec.files for path "${leafPath}"`,
        'INVALID_PATH',
      )
    }
    const cloned = structuredClone(spec)
    cloned.files[fileKey] = structuredClone(value) as string
    return cloned
  }

  if (!trimmedPath) {
    throw new BranchValidationError(
      'Leaf path must not be empty',
      'INVALID_PATH',
    )
  }

  const segments = trimmedPath.split('.').map((s) => s.trim())
  if (segments.some((s) => s.length === 0)) {
    throw new BranchValidationError(
      `Malformed path "${leafPath}" contains empty segments`,
      'INVALID_PATH',
    )
  }

  const cloned = structuredClone(spec)
  let cursor: unknown = cloned

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!
    if (Array.isArray(cursor)) {
      const idx = Number(seg)
      if (!Number.isInteger(idx) || idx < 0 || idx >= cursor.length) {
        throw new BranchValidationError(
          `Invalid array index "${seg}" in path "${leafPath}"`,
          'INVALID_PATH',
        )
      }
      cursor = cursor[idx]
    } else if (isPlainObject(cursor)) {
      if (!Object.hasOwn(cursor, seg)) {
        throw new BranchValidationError(
          `Segment "${seg}" does not exist in path "${leafPath}"`,
          'INVALID_PATH',
        )
      }
      cursor = cursor[seg]
    } else {
      throw new BranchValidationError(
        `Cannot traverse non-container at "${seg}" in path "${leafPath}"`,
        'INVALID_PATH',
      )
    }
  }

  const last = segments[segments.length - 1]!
  if (Array.isArray(cursor)) {
    const idx = Number(last)
    if (!Number.isInteger(idx) || idx < 0 || idx >= cursor.length) {
      throw new BranchValidationError(
        `Invalid array index "${last}" in path "${leafPath}"`,
        'INVALID_PATH',
      )
    }
    cursor[idx] = structuredClone(value)
  } else if (isPlainObject(cursor)) {
    if (!Object.hasOwn(cursor, last)) {
      throw new BranchValidationError(
        `Leaf "${last}" does not exist in path "${leafPath}"`,
        'INVALID_PATH',
      )
    }
    cursor[last] = structuredClone(value)
  } else {
    throw new BranchValidationError(
      `Cannot set leaf "${last}" on non-container in path "${leafPath}"`,
      'INVALID_PATH',
    )
  }

  return cloned
}

export type ParentRunSnapshot = {
  id: string
  experimentId: string
  workspaceId: string
  status: RunStatus
  spec: ExperimentSpec
}

export type BranchedExperimentRecord = {
  id: string
  workspaceId: string
  claimNodeId: string
  spec: ExperimentSpec
  mode: Mode
  approvalState: ApprovalState
}

export type BranchedRunRecord = {
  id: string
  experimentId: string
  parentRunId: string
  attempt: number
  status: RunStatus
  spec: ExperimentSpec
  parameters: Record<string, unknown>
  environment: RunEnvironment
}

export type NewWhatIfBranchInput = {
  workspaceId: string
  claimNodeId: string
  parentRunId: string
  spec: ExperimentSpec
  environment: RunEnvironment
}

export interface WhatIfBranchStore {
  getParentRun(runId: string): Promise<ParentRunSnapshot | null>
  createExperimentAndRun(input: NewWhatIfBranchInput): Promise<{
    experiment: BranchedExperimentRecord
    run: BranchedRunRecord
  }>
}

export function createDrizzleWhatIfBranchStore(
  db: Pick<Database, 'transaction' | 'select'>,
): WhatIfBranchStore {
  return {
    async getParentRun(runId: string): Promise<ParentRunSnapshot | null> {
      const [row] = await db
        .select({
          id: runs.id,
          experimentId: runs.experimentId,
          workspaceId: experiments.workspaceId,
          status: runs.status,
          spec: runs.spec,
        })
        .from(runs)
        .innerJoin(experiments, eq(experiments.id, runs.experimentId))
        .where(eq(runs.id, runId))

      if (!row) return null
      return row as ParentRunSnapshot
    },

    async createExperimentAndRun(input: NewWhatIfBranchInput) {
      return db.transaction(async (tx) => {
        const [exp] = await tx
          .insert(experiments)
          .values({
            workspaceId: input.workspaceId,
            claimNodeId: input.claimNodeId,
            spec: input.spec,
            mode: input.spec.mode,
            approvalState: 'pending',
          })
          .returning()

        if (!exp) {
          throw new Error('experiments insert returned no row')
        }

        // Follow-up owned by ivory-26: tracked in issue #62
        // (https://github.com/ivory-26/research-graph/issues/62) for docs/05-plan.md:73
        // and docs/07-workstreams.md:25 to adopt this queued `runs` row in
        // `src/server/pipeline-delivery/production-stages.ts:233-242` during EXECUTE.
        // Keep `Related to #27` until wired.
        const [run] = await tx
          .insert(runs)
          .values({
            experimentId: exp.id,
            parentRunId: input.parentRunId,
            attempt: 1,
            status: 'queued',
            spec: input.spec,
            parameters: input.spec.parameters,
            environment: input.environment,
          })
          .returning()

        if (!run) {
          throw new Error('runs insert returned no row')
        }

        if (!run.parentRunId) {
          throw new Error('runs insert failed to persist parentRunId')
        }

        return {
          experiment: {
            id: exp.id,
            workspaceId: exp.workspaceId,
            claimNodeId: exp.claimNodeId,
            spec: exp.spec,
            mode: exp.mode,
            approvalState: exp.approvalState,
          },
          run: {
            id: run.id,
            experimentId: run.experimentId,
            parentRunId: run.parentRunId,
            attempt: run.attempt,
            status: run.status,
            spec: run.spec,
            parameters: run.parameters,
            environment: run.environment,
          },
        }
      })
    },
  }
}

/**
 * What-if branch modification input.
 *
 * Shape difference:
 * - `path` requires the full dotted spec path (so `{ path: 'importance_method' }` is rejected as `INVALID_PATH`).
 * - `parameterName` auto-prefixes `'parameters.'` when omitted, so `{ parameterName: 'importance_method' }`
 *   and `{ path: 'parameters.importance_method' }` are equivalent.
 */
export type WhatIfBranchChange =
  | {
      /** Full dot-separated spec path, e.g. `'parameters.importance_method'` (never bare leaf names). */
      path: string
      value: unknown
    }
  | {
      /** Parameter leaf name (automatically prefixed with `'parameters.'` if not already present). */
      parameterName: string
      value: unknown
    }
  | { candidateSpec: ExperimentSpec }

export type BranchWhatIfOptions = {
  store: WhatIfBranchStore
}

export type BranchWhatIfResult = {
  experiment: BranchedExperimentRecord
  run: BranchedRunRecord
  diff: SpecLeafDiff
}

/**
 * Local copy of `initialEnvironment` from `src/server/pipeline-delivery/production-stages.ts:92-105`
 * (kept local per `docs/07-workstreams.md` file ownership; records empty placeholders while `status` is `'queued'`).
 */
function initialBranchEnvironment(spec: ExperimentSpec): RunEnvironment {
  return {
    imageDigest: 'unknown',
    python: 'unknown',
    packages: {},
    datasets: [],
    seeds:
      typeof spec.parameters.seed === 'number' ? [spec.parameters.seed] : [],
    startedAt: '',
  }
}

/**
 * Clones a completed run's frozen spec, applies exactly one parameter leaf change,
 * rejects any 0-leaf, multi-leaf, or non-`parameters.*` diff, re-runs PLAN_EXPERIMENT validation,
 * and creates a new experiment + child run with `parentRunId` set.
 * The parent run and experiment are never touched.
 *
 * `parentRun` provides the target parent run id and caller's asserted workspaceId.
 * The parent's frozen spec, status, and workspace are structurally re-read from the
 * store via `getParentRun` and verified before any branch is persisted.
 */
export async function branchWhatIf(
  parentRun: ParentRunSnapshot,
  change: WhatIfBranchChange,
  options: BranchWhatIfOptions,
): Promise<BranchWhatIfResult> {
  const loaded = await options.store.getParentRun(parentRun.id)
  if (!loaded) {
    throw new BranchValidationError(
      `Parent run ${parentRun.id} not found in store`,
      'PARENT_NOT_FOUND',
    )
  }
  // Consistency guard comparing the stored parent workspace against the caller-supplied workspaceId
  // (not an authorization boundary — callers must enforce auth before invoking branchWhatIf;
  // persistence always writes into `activeParent.workspaceId`).
  if (loaded.workspaceId !== parentRun.workspaceId) {
    throw new BranchValidationError(
      `Parent run ${parentRun.id} does not belong to workspace ${parentRun.workspaceId}`,
      'PARENT_WORKSPACE_MISMATCH',
    )
  }
  const activeParent = loaded

  if (activeParent.status !== 'succeeded') {
    throw new BranchValidationError(
      `Cannot branch from run ${activeParent.id} with status "${activeParent.status}"; parent run must be completed ("succeeded")`,
      'PARENT_NOT_COMPLETED',
    )
  }

  let childSpec: ExperimentSpec
  if ('candidateSpec' in change) {
    if (!isPlainObject(change.candidateSpec)) {
      throw new BranchValidationError(
        'Branched candidateSpec must be a non-null plain object',
        'INVALID_SPEC',
      )
    }
    assertJsonSafe(change.candidateSpec)
    childSpec = structuredClone(change.candidateSpec)
  } else if ('path' in change && typeof change.path === 'string') {
    childSpec = applySingleLeafChange(activeParent.spec, change.path, change.value)
  } else if ('parameterName' in change && typeof change.parameterName === 'string') {
    const path = change.parameterName.startsWith('parameters.')
      ? change.parameterName
      : `parameters.${change.parameterName}`
    childSpec = applySingleLeafChange(activeParent.spec, path, change.value)
  } else {
    throw new BranchValidationError(
      'What-if branch change must specify candidateSpec, path, or parameterName',
      'INVALID_SPEC',
    )
  }

  // Ensure childSpec is round-tripped through JSON so in-memory diffs and JSONB persistence are strictly identical
  childSpec = JSON.parse(JSON.stringify(childSpec)) as ExperimentSpec

  const diffs = diffSpecLeaves(activeParent.spec, childSpec)
  if (diffs.length === 0) {
    throw new BranchValidationError(
      'What-if branch must change exactly one leaf of the spec; no changes were made',
      'NO_CHANGES',
      diffs,
    )
  }

  if (diffs.length > 1) {
    const changedPaths = diffs.map((d) => d.path).join(', ')
    throw new BranchValidationError(
      `What-if branch must change exactly one leaf of the spec; found ${diffs.length} changes (${changedPaths})`,
      'MULTIPLE_CHANGES',
      diffs,
    )
  }

  if (childSpec.claimNodeId !== activeParent.spec.claimNodeId) {
    throw new BranchValidationError(
      'What-if branch cannot change claimNodeId',
      'INVALID_SPEC',
      diffs,
    )
  }

  if (childSpec.mode !== activeParent.spec.mode) {
    throw new BranchValidationError(
      'What-if branch cannot change execution mode',
      'INVALID_SPEC',
      diffs,
    )
  }

  const changedLeaf = diffs[0]!
  if (changedLeaf.path.startsWith('files.')) {
    throw new BranchValidationError(
      `What-if branch cannot modify script files ("${changedLeaf.path}"); script edits belong to the repair path`,
      'FILES_CHANGE_NOT_ALLOWED',
      diffs,
    )
  }
  if (!changedLeaf.path.startsWith('parameters.')) {
    throw new BranchValidationError(
      `What-if branch can only modify parameters.* leaves, got "${changedLeaf.path}"`,
      'INVALID_SPEC',
      diffs,
    )
  }
  if (changedLeaf.before === undefined || changedLeaf.after === undefined) {
    throw new BranchValidationError(
      changedLeaf.before === undefined
        ? `What-if branch cannot introduce new parameter "${changedLeaf.path}" not present in parent spec`
        : `What-if branch cannot delete parameter "${changedLeaf.path}" present in parent spec`,
      'INVALID_PATH',
      diffs,
    )
  }

  const validation = validateExperimentSpec(childSpec)
  if (!validation.valid) {
    throw new BranchValidationError(
      `Branched experiment spec failed validation: ${validation.errors.join('; ')}`,
      'INVALID_SPEC',
      diffs,
    )
  }

  const { experiment, run } = await options.store.createExperimentAndRun({
    workspaceId: activeParent.workspaceId,
    claimNodeId: activeParent.spec.claimNodeId,
    parentRunId: activeParent.id,
    spec: childSpec,
    environment: initialBranchEnvironment(childSpec),
  })

  return {
    experiment,
    run,
    diff: diffs[0]!,
  }
}
