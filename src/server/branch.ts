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

export class BranchValidationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'PARENT_NOT_COMPLETED'
      | 'NO_CHANGES'
      | 'MULTIPLE_CHANGES'
      | 'INVALID_SPEC'
      | 'INVALID_PATH',
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

  const segments = trimmedPath
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean)

  if (segments.length === 0) {
    throw new BranchValidationError(
      'Leaf path must not be empty',
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
  approvalState?: ApprovalState
  environment: RunEnvironment
}

export interface WhatIfBranchStore {
  createExperimentAndRun(input: NewWhatIfBranchInput): Promise<{
    experiment: BranchedExperimentRecord
    run: BranchedRunRecord
  }>
}

export function createDrizzleWhatIfBranchStore(
  db: Pick<Database, 'transaction'>,
): WhatIfBranchStore {
  return {
    async createExperimentAndRun(input: NewWhatIfBranchInput) {
      return db.transaction(async (tx) => {
        const [exp] = await tx
          .insert(experiments)
          .values({
            workspaceId: input.workspaceId,
            claimNodeId: input.claimNodeId,
            spec: input.spec,
            mode: input.spec.mode,
            approvalState: input.approvalState ?? 'pending',
          })
          .returning()

        if (!exp) {
          throw new Error('experiments insert returned no row')
        }

        // Note: pipeline wiring must adopt this queued row (matching experimentId + attempt 1)
        // when EXECUTE runs the branched experiment rather than inserting a duplicate row.
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

export type WhatIfBranchChange =
  | { path: string; value: unknown }
  | { parameterName: string; value: unknown }
  | { candidateSpec: ExperimentSpec }

export type BranchWhatIfOptions = {
  store: WhatIfBranchStore
  approvalState?: ApprovalState
  now?: () => Date
}

export type BranchWhatIfResult = {
  experiment: BranchedExperimentRecord
  run: BranchedRunRecord
  diff: SpecLeafDiff
}

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
 * Clones a completed run's frozen spec, applies exactly one leaf change,
 * rejects any 0-leaf or multi-leaf diff, re-runs PLAN_EXPERIMENT validation,
 * and creates a new experiment + child run with `parentRunId` set.
 * The parent run and experiment are never touched.
 */
export async function branchWhatIf(
  parentRun: ParentRunSnapshot,
  change: WhatIfBranchChange,
  options: BranchWhatIfOptions,
): Promise<BranchWhatIfResult> {
  if (parentRun.status !== 'succeeded') {
    throw new BranchValidationError(
      `Cannot branch from run ${parentRun.id} with status "${parentRun.status}"; parent run must be completed ("succeeded")`,
      'PARENT_NOT_COMPLETED',
    )
  }

  let childSpec: ExperimentSpec
  if ('candidateSpec' in change) {
    childSpec = structuredClone(change.candidateSpec)
  } else if ('path' in change) {
    childSpec = applySingleLeafChange(parentRun.spec, change.path, change.value)
  } else {
    const path = change.parameterName.startsWith('parameters.')
      ? change.parameterName
      : `parameters.${change.parameterName}`
    childSpec = applySingleLeafChange(parentRun.spec, path, change.value)
  }

  const diffs = diffSpecLeaves(parentRun.spec, childSpec)
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

  if (childSpec.claimNodeId !== parentRun.spec.claimNodeId) {
    throw new BranchValidationError(
      'What-if branch cannot change claimNodeId',
      'INVALID_SPEC',
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
    workspaceId: parentRun.workspaceId,
    claimNodeId: parentRun.spec.claimNodeId,
    parentRunId: parentRun.id,
    spec: childSpec,
    approvalState: options.approvalState ?? 'pending',
    environment: initialBranchEnvironment(childSpec),
  })

  return {
    experiment,
    run,
    diff: diffs[0]!,
  }
}
