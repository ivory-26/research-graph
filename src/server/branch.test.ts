import { describe, expect, it } from 'vitest'
import {
  HERO_EXPERIMENT_SPEC_RUN_A,
  HERO_RECORDED_RUN_RESULT,
} from '../../fixtures/hero-spec'
import { experiments, runs } from '../db/schema'
import type { ExperimentSpec } from '../shared/types'
import {
  BranchValidationError,
  applySingleLeafChange,
  branchWhatIf,
  createDrizzleWhatIfBranchStore,
  diffSpecLeaves,
  type BranchedExperimentRecord,
  type BranchedRunRecord,
  type NewWhatIfBranchInput,
  type ParentRunSnapshot,
  type WhatIfBranchStore,
} from './branch'
import {
  createTestDatabase,
  seedWorkspace,
  type TestDatabase,
} from './pipeline-delivery/test-support/pg'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip

class MemoryWhatIfBranchStore implements WhatIfBranchStore {
  readonly experiments: BranchedExperimentRecord[] = []
  readonly runs: BranchedRunRecord[] = []
  readonly parentRuns = new Map<string, ParentRunSnapshot>()

  constructor(initialParentRuns?: ParentRunSnapshot[]) {
    const list = initialParentRuns ?? [makeCompletedParentRun()]
    for (const pr of list) {
      this.parentRuns.set(pr.id, structuredClone(pr))
    }
  }

  async getParentRun(runId: string): Promise<ParentRunSnapshot | null> {
    const found = this.parentRuns.get(runId)
    return found ? structuredClone(found) : null
  }

  async createExperimentAndRun(input: NewWhatIfBranchInput) {
    const experiment: BranchedExperimentRecord = {
      id: `exp-branch-${this.experiments.length + 1}`,
      workspaceId: input.workspaceId,
      claimNodeId: input.claimNodeId,
      spec: structuredClone(input.spec),
      mode: input.spec.mode,
      approvalState: 'pending',
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
    const store = new MemoryWhatIfBranchStore([parentRun])

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
      branchWhatIf(
        parentRun,
        { parameterName: 'estimatedRuntimeSeconds', value: 120 },
        { store },
      ),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_SPEC',
    })
    expect(store.experiments).toHaveLength(0)
  })

  it('rejects candidateSpec introducing a new parameter key not present in parent with INVALID_PATH', async () => {
    const parentRun = makeCompletedParentRun()
    const store = new MemoryWhatIfBranchStore()
    const withNewParam = structuredClone(parentRun.spec)
    withNewParam.parameters.unseen_param = 42

    await expect(
      branchWhatIf(parentRun, { candidateSpec: withNewParam }, { store }),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_PATH',
    })
  })

  it('rejects candidateSpec deleting an existing parameter key with INVALID_PATH', async () => {
    const parentRun = makeCompletedParentRun()
    const store = new MemoryWhatIfBranchStore()
    const withDeletedParam = structuredClone(parentRun.spec)
    delete withDeletedParam.parameters.importance_method

    await expect(
      branchWhatIf(parentRun, { candidateSpec: withDeletedParam }, { store }),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_PATH',
    })
  })

  it('rejects cyclic candidateSpec with INVALID_SPEC', async () => {
    const parentRun = makeCompletedParentRun()
    const store = new MemoryWhatIfBranchStore()
    const cyclicSpec: any = structuredClone(parentRun.spec)
    cyclicSpec.parameters.self = cyclicSpec

    await expect(
      branchWhatIf(parentRun, { candidateSpec: cyclicSpec }, { store }),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_SPEC',
    })
  })

  it('rejects non-string or empty importance_method value with INVALID_SPEC', async () => {
    const parentRun = makeCompletedParentRun()
    const store = new MemoryWhatIfBranchStore()

    await expect(
      branchWhatIf(
        parentRun,
        { path: 'parameters.importance_method', value: 123 },
        { store },
      ),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_SPEC',
    })

    await expect(
      branchWhatIf(
        parentRun,
        { path: 'parameters.importance_method', value: '' },
        { store },
      ),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_SPEC',
    })
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

  it('rejects prototype-pollution paths like __proto__ and restricts what-if branches from modifying files.*', async () => {
    const parentRun = makeCompletedParentRun()
    const store = new MemoryWhatIfBranchStore()

    await expect(
      branchWhatIf(parentRun, { path: 'parameters.__proto__', value: {} }, { store }),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_PATH',
    })

    await expect(
      branchWhatIf(
        parentRun,
        { path: 'parameters..importance_method', value: 'permutation' },
        { store },
      ),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_PATH',
    })

    // Unprefixed `path` is rejected as INVALID_PATH (unlike `parameterName`, which auto-prefixes `parameters.`)
    await expect(
      branchWhatIf(
        parentRun,
        { path: 'importance_method', value: 'permutation' },
        { store },
      ),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_PATH',
    })

    // applySingleLeafChange still handles dot-containing file keys, while branchWhatIf rejects files.*
    const editedFileSpec = applySingleLeafChange(
      parentRun.spec,
      'files.main.py',
      `${parentRun.spec.files['main.py']!}\n# what-if comment`,
    )
    expect(editedFileSpec.files['main.py']).toContain('# what-if comment')

    await expect(
      branchWhatIf(
        parentRun,
        {
          path: 'files.main.py',
          value: `${parentRun.spec.files['main.py']!}\n# what-if comment`,
        },
        { store },
      ),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'FILES_CHANGE_NOT_ALLOWED',
    })

    await expect(
      branchWhatIf(parentRun, { candidateSpec: editedFileSpec }, { store }),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'FILES_CHANGE_NOT_ALLOWED',
    })
    expect(store.experiments).toHaveLength(0)
    expect(store.runs).toHaveLength(0)
  })

  it('rejects candidateSpec that changes claimNodeId', async () => {
    const parentRun = makeCompletedParentRun()
    const store = new MemoryWhatIfBranchStore()
    const modified = structuredClone(parentRun.spec)
    modified.claimNodeId = 'other-claim-node'

    await expect(
      branchWhatIf(parentRun, { candidateSpec: modified }, { store }),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_SPEC',
    })
  })

  it('persists experiment and queued child run atomically inside db.transaction', async () => {
    const insertedTables: unknown[] = []
    let txCalls = 0
    const parentRun = makeCompletedParentRun()

    const fakeDb = {
      select() {
        return {
          from() {
            return {
              innerJoin() {
                return {
                  async where() {
                    return [
                      {
                        id: parentRun.id,
                        experimentId: parentRun.experimentId,
                        workspaceId: parentRun.workspaceId,
                        status: parentRun.status,
                        spec: parentRun.spec,
                      },
                    ]
                  },
                }
              },
            }
          },
        }
      },
      async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
        txCalls++
        const tx = {
          insert(table: unknown) {
            insertedTables.push(table)
            return {
              values(val: Record<string, unknown>) {
                return {
                  async returning() {
                    if (table === experiments) {
                      return [
                        {
                          id: 'exp-tx-1',
                          workspaceId: val.workspaceId,
                          claimNodeId: val.claimNodeId,
                          spec: val.spec,
                          mode: val.mode,
                          approvalState: val.approvalState,
                        },
                      ]
                    }
                    if (table === runs) {
                      return [
                        {
                          id: 'run-tx-1',
                          experimentId: val.experimentId,
                          parentRunId: val.parentRunId,
                          attempt: val.attempt,
                          status: val.status,
                          spec: val.spec,
                          parameters: val.parameters,
                          environment: val.environment,
                        },
                      ]
                    }
                    return []
                  },
                }
              },
            }
          },
        }
        return fn(tx)
      },
    }

    const store = createDrizzleWhatIfBranchStore(fakeDb as any)
    const result = await branchWhatIf(
      parentRun,
      { parameterName: 'importance_method', value: 'permutation' },
      { store },
    )

    expect(txCalls).toBe(1)
    expect(insertedTables).toEqual([experiments, runs])
    expect(result.experiment.id).toBe('exp-tx-1')
    expect(result.run.id).toBe('run-tx-1')
    expect(result.run.parentRunId).toBe(parentRun.id)
    expect(result.run.environment.startedAt).toBe('')
  })

  it('verifies parent run structurally and rejects cross-workspace parent runs', async () => {
    const parentRun = makeCompletedParentRun()
    const memoryStore = new MemoryWhatIfBranchStore([parentRun])
    const store: WhatIfBranchStore = {
      async createExperimentAndRun(input) {
        return memoryStore.createExperimentAndRun(input)
      },
      async getParentRun(runId: string) {
        if (runId !== parentRun.id) return null
        return {
          ...parentRun,
          workspaceId: 'other-workspace',
        }
      },
    }

    await expect(
      branchWhatIf(
        parentRun,
        { parameterName: 'importance_method', value: 'permutation' },
        { store },
      ),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'PARENT_WORKSPACE_MISMATCH',
    })
  })

  it('rejects missing parent runs with PARENT_NOT_FOUND', async () => {
    const parentRun = makeCompletedParentRun()
    const store = new MemoryWhatIfBranchStore([])

    await expect(
      branchWhatIf(
        parentRun,
        { parameterName: 'importance_method', value: 'permutation' },
        { store },
      ),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'PARENT_NOT_FOUND',
    })
  })

  it('rejects non-object candidateSpec with INVALID_SPEC instead of throwing TypeError', async () => {
    const parentRun = makeCompletedParentRun()
    const store = new MemoryWhatIfBranchStore([parentRun])

    await expect(
      branchWhatIf(
        parentRun,
        { candidateSpec: null as unknown as ExperimentSpec },
        { store },
      ),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_SPEC',
    })
  })

  it('rejects undefined leaf value with INVALID_SPEC', async () => {
    const parentRun = makeCompletedParentRun()
    const store = new MemoryWhatIfBranchStore([parentRun])

    await expect(
      branchWhatIf(
        parentRun,
        { parameterName: 'importance_method', value: undefined },
        { store },
      ),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_SPEC',
    })
  })

  it('rejects non-finite numeric leaf value with INVALID_SPEC', async () => {
    const parentRun = makeCompletedParentRun()
    const store = new MemoryWhatIfBranchStore([parentRun])

    await expect(
      branchWhatIf(
        parentRun,
        { parameterName: 'estimatedRuntimeSeconds', value: NaN },
        { store },
      ),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_SPEC',
    })

    await expect(
      branchWhatIf(
        parentRun,
        { parameterName: 'estimatedRuntimeSeconds', value: Infinity },
        { store },
      ),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_SPEC',
    })
  })

  it('rejects candidateSpec containing undefined with INVALID_SPEC', async () => {
    const parentRun = makeCompletedParentRun()
    const store = new MemoryWhatIfBranchStore([parentRun])
    const candidate = structuredClone(parentRun.spec) as Record<string, unknown>
    candidate.badField = undefined

    await expect(
      branchWhatIf(
        parentRun,
        { candidateSpec: candidate as unknown as ExperimentSpec },
        { store },
      ),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_SPEC',
    })
  })

  it('rejects changing mode to conceptual or modifying non-parameter/non-file leaves with INVALID_SPEC', async () => {
    const parentRun = makeCompletedParentRun()
    const store = new MemoryWhatIfBranchStore([parentRun])

    await expect(
      branchWhatIf(parentRun, { path: 'mode', value: 'conceptual' }, { store }),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_SPEC',
    })

    await expect(
      branchWhatIf(
        parentRun,
        { path: 'criteria.checks.0.value', value: 99 },
        { store },
      ),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_SPEC',
    })

    await expect(
      branchWhatIf(parentRun, { path: 'timeoutSeconds', value: 300 }, { store }),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_SPEC',
    })
  })

  it('rejects bigint leaf values with INVALID_SPEC instead of JSON.stringify TypeError', async () => {
    const parentRun = makeCompletedParentRun()
    const store = new MemoryWhatIfBranchStore([parentRun])

    await expect(
      branchWhatIf(
        parentRun,
        { parameterName: 'n_estimators', value: BigInt(100) },
        { store },
      ),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_SPEC',
    })
  })

  it('rejects change objects lacking candidateSpec, path, or parameterName with INVALID_SPEC', async () => {
    const parentRun = makeCompletedParentRun()
    const store = new MemoryWhatIfBranchStore([parentRun])

    await expect(
      branchWhatIf(parentRun, {} as any, { store }),
    ).rejects.toMatchObject({
      name: 'BranchValidationError',
      code: 'INVALID_SPEC',
    })
  })
})

describeIntegration('createDrizzleWhatIfBranchStore over real Postgres', () => {
  let testDb: TestDatabase

  it('persists branched experiment and child run with real FK and parentRunId constraints', async () => {
    testDb = await createTestDatabase(TEST_DATABASE_URL as string)
    try {
      const seed = await seedWorkspace(testDb.pool, {
        spec: HERO_EXPERIMENT_SPEC_RUN_A,
      })
      const parentInsert = await testDb.pool.query<{ id: string }>(
        `INSERT INTO runs (experiment_id, attempt, status, spec, parameters, environment)
         VALUES ($1, 1, 'succeeded', $2, $3, $4)
         RETURNING id`,
        [
          seed.experimentId,
          JSON.stringify(seed.spec),
          JSON.stringify(seed.spec.parameters),
          JSON.stringify(HERO_RECORDED_RUN_RESULT.environment),
        ],
      )
      const parentRunId = parentInsert.rows[0]!.id
      const store = createDrizzleWhatIfBranchStore(testDb.db)

      const parentSnapshot: ParentRunSnapshot = {
        id: parentRunId,
        experimentId: seed.experimentId,
        workspaceId: seed.workspaceId,
        status: 'succeeded',
        spec: seed.spec,
      }

      await expect(
        branchWhatIf(
          { ...parentSnapshot, workspaceId: seed.otherWorkspaceId },
          { parameterName: 'importance_method', value: 'permutation' },
          { store },
        ),
      ).rejects.toMatchObject({
        name: 'BranchValidationError',
        code: 'PARENT_WORKSPACE_MISMATCH',
      })

      const result = await branchWhatIf(
        parentSnapshot,
        { parameterName: 'importance_method', value: 'permutation' },
        { store },
      )

      expect(result.experiment.workspaceId).toBe(seed.workspaceId)
      expect(result.experiment.claimNodeId).toBe(seed.claimNodeId)
      expect(result.experiment.approvalState).toBe('pending')
      expect(result.run.parentRunId).toBe(parentRunId)
      expect(result.run.attempt).toBe(1)
      expect(result.run.status).toBe('queued')
      expect(result.run.parameters.importance_method).toBe('permutation')
    } finally {
      await testDb.close()
    }
  })
})
