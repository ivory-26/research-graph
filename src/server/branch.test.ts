import { describe, expect, it } from 'vitest'
import { HERO_EXPERIMENT_SPEC_RUN_A } from '../../fixtures/hero-spec'
import type { ExperimentSpec } from '../shared/types'
import {
  BranchValidationError,
  applySingleLeafChange,
  branchWhatIf,
  diffSpecLeaves,
  type BranchedExperimentRecord,
  type BranchedRunRecord,
  type NewWhatIfBranchInput,
  type ParentRunSnapshot,
  type WhatIfBranchStore,
} from './branch'

class MemoryWhatIfBranchStore implements WhatIfBranchStore {
  readonly experiments: BranchedExperimentRecord[] = []
  readonly runs: BranchedRunRecord[] = []

  async createExperimentAndRun(input: NewWhatIfBranchInput) {
    const experiment: BranchedExperimentRecord = {
      id: `exp-branch-${this.experiments.length + 1}`,
      workspaceId: input.workspaceId,
      claimNodeId: input.claimNodeId,
      spec: structuredClone(input.spec),
      mode: input.spec.mode,
      approvalState: input.approvalState ?? 'pending',
    }
    const run: BranchedRunRecord = {
      id: `run-branch-${this.runs.length + 1}`,
      experimentId: experiment.id,
      parentRunId: input.parentRunId,
      attempt: 1,
      status: 'queued',
      spec: structuredClone(input.spec),
      parameters: structuredClone(input.spec.parameters),
      environment: structuredClone(input.environment),
    }
    this.experiments.push(experiment)
    this.runs.push(run)
    return {
      experiment: structuredClone(experiment),
      run: structuredClone(run),
    }
  }
}

function makeCompletedParentRun(): ParentRunSnapshot {
  return {
    id: 'run-a-1',
    experimentId: 'exp-a-1',
    workspaceId: 'ws-1',
    status: 'succeeded',
    spec: structuredClone(HERO_EXPERIMENT_SPEC_RUN_A),
  }
}

describe('diffSpecLeaves', () => {
  it('detects a single leaf change in parameters', () => {
    const child = applySingleLeafChange(
      HERO_EXPERIMENT_SPEC_RUN_A,
      'parameters.importance_method',
      'permutation',
    )
    const diffs = diffSpecLeaves(HERO_EXPERIMENT_SPEC_RUN_A, child)
    expect(diffs).toEqual([
      {
        path: 'parameters.importance_method',
        before: 'impurity',
        after: 'permutation',
      },
    ])
  })

  it('detects multiple leaf changes when two parameters are edited', () => {
    const one = applySingleLeafChange(
      HERO_EXPERIMENT_SPEC_RUN_A,
      'parameters.importance_method',
      'permutation',
    )
    const two = applySingleLeafChange(one, 'parameters.n_estimators', 200)
    const diffs = diffSpecLeaves(HERO_EXPERIMENT_SPEC_RUN_A, two)
    expect(diffs).toHaveLength(2)
    expect(diffs.map((d) => d.path)).toEqual([
      'parameters.importance_method',
      'parameters.n_estimators',
    ])
  })
})

describe('branchWhatIf (Issue #27)', () => {
  it('switches importance_method from impurity to permutation, creates Run B with parentRunId set, and leaves parent untouched', async () => {
    const parentRun = makeCompletedParentRun()
    const parentSnapshotBefore = JSON.stringify(parentRun)
    const store = new MemoryWhatIfBranchStore()

    const result = await branchWhatIf(
      parentRun,
      { parameterName: 'importance_method', value: 'permutation' },
      { store },
    )

    // Parent run is completely untouched
    expect(JSON.stringify(parentRun)).toBe(parentSnapshotBefore)
    expect(parentRun.spec.parameters.importance_method).toBe('impurity')

    // New experiment + Run B created with parentRunId pointing to Run A
    expect(result.experiment.id).not.toBe(parentRun.experimentId)
    expect(result.run.parentRunId).toBe(parentRun.id)
    expect(result.run.experimentId).toBe(result.experiment.id)
    expect(result.run.spec.parameters.importance_method).toBe('permutation')
    expect(result.diff).toEqual({
      path: 'parameters.importance_method',
      before: 'impurity',
      after: 'permutation',
    })
  })

  it('refuses a two-parameter edit and persists nothing', async () => {
    const parentRun = makeCompletedParentRun()
    const store = new MemoryWhatIfBranchStore()

    const twoParamSpec: ExperimentSpec = structuredClone(parentRun.spec)
    twoParamSpec.parameters.importance_method = 'permutation'
    twoParamSpec.parameters.n_estimators = 250

    await expect(
      branchWhatIf(parentRun, { candidateSpec: twoParamSpec }, { store }),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'MULTIPLE_CHANGES',
    })

    expect(store.experiments).toHaveLength(0)
    expect(store.runs).toHaveLength(0)
  })

  it('refuses a zero-change branch', async () => {
    const parentRun = makeCompletedParentRun()
    const store = new MemoryWhatIfBranchStore()

    await expect(
      branchWhatIf(
        parentRun,
        { candidateSpec: structuredClone(parentRun.spec) },
        { store },
      ),
    ).rejects.toBeInstanceOf(BranchValidationError)
  })

  it('refuses branching from an incomplete run', async () => {
    const parentRun = makeCompletedParentRun()
    parentRun.status = 'failed'
    const store = new MemoryWhatIfBranchStore()

    await expect(
      branchWhatIf(
        parentRun,
        { parameterName: 'importance_method', value: 'permutation' },
        { store },
      ),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'PARENT_NOT_COMPLETED',
    })
  })

  it('re-runs PLAN_EXPERIMENT validation and rejects invalid spec changes', async () => {
    const parentRun = makeCompletedParentRun()
    const store = new MemoryWhatIfBranchStore()

    await expect(
      branchWhatIf(parentRun, { path: 'mode', value: 'exact' }, { store }),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_SPEC',
    })
    expect(store.experiments).toHaveLength(0)
  })

  it('rejects changes to non-existent path segments or misspelled parameters', async () => {
    const parentRun = makeCompletedParentRun()
    const store = new MemoryWhatIfBranchStore()

    await expect(
      branchWhatIf(parentRun, { path: 'paramters.importance_method', value: 'permutation' }, { store }),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_PATH',
    })

    await expect(
      branchWhatIf(parentRun, { path: 'parameters.non_existent_leaf', value: 'permutation' }, { store }),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_PATH',
    })
    expect(store.experiments).toHaveLength(0)
  })
})
