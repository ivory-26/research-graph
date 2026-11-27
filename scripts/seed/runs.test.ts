/**
 * Focused tests for the seed run orchestration's pure verification helpers.
 *
 * These do not need a database, E2B or Gemini. The live double-seed check is
 * the integration test for this module; these tests pin the arithmetic that
 * decides whether a captured baseline matches and whether an artifact's bytes
 * are what its hash says.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ExperimentSpec } from '../../src/shared/types.ts'
import {
  SEED_BASELINE_SCHEMA_VERSION,
  SeedRunError,
  assertSeedRunBaselinesMatch,
  canonicalJson,
  collectSpecLeafDiffs,
  compareSeedRunBaselines,
  hashExperimentSpec,
  hashLogicalExperimentSpec,
  seedRuns,
  verifyArtifactContent,
  type SeedBaselineRun,
  type SeedRunBaseline,
  type SeedRunsInput,
} from './runs.ts'

function minimalRun(label: 'run-a' | 'run-b'): SeedBaselineRun {
  return {
    label,
    parentLabel: label === 'run-b' ? 'run-a' : null,
    attempt: 1,
    status: 'succeeded',
    runner: 'e2b',
    mode: 'adapted',
    logicalSpecSha256: 'a'.repeat(64),
    parametersCanonical: '{"importance_method":"impurity"}',
    metrics: { rank_noise_20: 4 },
    verdict: 'match',
    verdictChecks: [
      {
        metric: 'rank_noise_20',
        op: 'lte',
        threshold: 5,
        tolerance: null,
        measured: 4,
        passed: true,
      },
    ],
    explanationPresent: true,
    environment: {
      imageDigest: 'unknown',
      python: 'Python 3.12.16',
      packages: { numpy: '2.5.5' },
      datasets: [{ name: 'breast-w', sha256: 'b'.repeat(64), bytes: 19177 }],
      seeds: [42],
    },
    artifacts: [
      {
        kind: 'table',
        path: '/output/importance_ranks.csv',
        sha256: 'c'.repeat(64),
        bytes: 32,
        contentSha256: 'c'.repeat(64),
        contentEncoding: 'utf8',
      },
    ],
    projection: {
      runNode: { title: 'Run · Gini Importance Bias', status: 'succeeded', mode: 'adapted' },
      resultNode: { title: 'Result · Gini Importance Bias', metrics: { rank_noise_20: 4 }, verdict: 'match' },
      producedEdge: { status: 'accepted', evidenceIsRun: true },
    },
    approval: {
      state: 'approved',
      offeredLogicalSpecSha256: 'd'.repeat(64),
      decidedBy: 'user-operator',
      decisionEventRecorded: true,
    },
    claimCloseReason: 'completed',
    eventTypes: ['pipeline.started', 'approval.requested', 'approval.resolved', 'pipeline.completed'],
  }
}

function baseline(): SeedRunBaseline {
  return {
    schemaVersion: SEED_BASELINE_SCHEMA_VERSION,
    runs: [minimalRun('run-a'), minimalRun('run-b')],
  }
}

describe('canonicalJson', () => {
  it('is independent of object key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    )
  })

  it('preserves array order', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
  })

  it('drops undefined object members rather than emitting invalid JSON', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
  })
})

describe('hashExperimentSpec', () => {
  it('hashes a spec identically regardless of key construction order', () => {
    const left = {
      claimNodeId: 'claim-1',
      mode: 'adapted',
      parameters: { importance_method: 'impurity', seed: 42 },
    }
    const right = {
      parameters: { seed: 42, importance_method: 'impurity' },
      mode: 'adapted',
      claimNodeId: 'claim-1',
    }
    expect(hashExperimentSpec(left as never)).toBe(
      hashExperimentSpec(right as never),
    )
  })

  it('changes when one leaf changes', () => {
    const left = { parameters: { importance_method: 'impurity' } }
    const right = { parameters: { importance_method: 'permutation' } }
    expect(hashExperimentSpec(left as never)).not.toBe(
      hashExperimentSpec(right as never),
    )
  })
})

describe('hashLogicalExperimentSpec', () => {
  it('ignores the per-database claim UUID', () => {
    const left = {
      claimNodeId: '11111111-1111-4111-8111-111111111111',
      mode: 'adapted',
      parameters: { importance_method: 'impurity' },
      files: { 'main.py': 'print(1)' },
    }
    const right = {
      ...left,
      claimNodeId: '22222222-2222-4222-8222-222222222222',
    }
    expect(hashLogicalExperimentSpec(left as never)).toBe(
      hashLogicalExperimentSpec(right as never),
    )
  })

  it('still hashes every other spec leaf', () => {
    const left = {
      claimNodeId: 'claim-any',
      parameters: { importance_method: 'impurity' },
    }
    const right = {
      claimNodeId: 'claim-any',
      parameters: { importance_method: 'permutation' },
    }
    expect(hashLogicalExperimentSpec(left as never)).not.toBe(
      hashLogicalExperimentSpec(right as never),
    )
  })
})

describe('collectSpecLeafDiffs', () => {
  it('reports exactly the changed parameter leaf', () => {
    const before = {
      parameters: { importance_method: 'impurity', seed: 42 },
      files: { 'main.py': 'print(1)' },
    }
    const after = structuredClone(before)
    after.parameters.importance_method = 'permutation'

    expect(collectSpecLeafDiffs(before, after)).toEqual([
      {
        path: 'parameters.importance_method',
        before: 'impurity',
        after: 'permutation',
      },
    ])
  })

  it('reports a script change as a files leaf, so the branch guard can reject it', () => {
    const before = { files: { 'main.py': 'print(1)' } }
    const after = { files: { 'main.py': 'print(2)' } }
    expect(collectSpecLeafDiffs(before, after)[0]?.path).toBe('files.main.py')
  })

  it('reports a whole array when its length changes', () => {
    expect(collectSpecLeafDiffs({ checks: [1] }, { checks: [1, 2] })).toEqual([
      { path: 'checks', before: [1], after: [1, 2] },
    ])
  })

  it('returns nothing for JSON-equal values with different key order', () => {
    expect(collectSpecLeafDiffs({ b: 2, a: 1 }, { a: 1, b: 2 })).toEqual([])
  })
})

describe('verifyArtifactContent', () => {
  const bytes = Buffer.from('metric,value\nrank_noise_20,4\n', 'utf8')
  const sha256 = createHashForTest(bytes)

  it('verifies base64-encoded bytes', () => {
    const check = verifyArtifactContent(
      bytes.toString('base64'),
      sha256,
      bytes.byteLength,
    )
    expect(check).toMatchObject({ valid: true, encoding: 'base64' })
  })

  it('verifies UTF-8 text artifacts', () => {
    const check = verifyArtifactContent(
      bytes.toString('utf8'),
      sha256,
      bytes.byteLength,
    )
    expect(check).toMatchObject({ valid: true, encoding: 'utf8' })
  })

  it('rejects a hash that does not match the bytes', () => {
    const check = verifyArtifactContent(
      bytes.toString('base64'),
      '0'.repeat(64),
      bytes.byteLength,
    )
    expect(check.valid).toBe(false)
  })

  it('rejects a byte count that does not match the bytes', () => {
    const check = verifyArtifactContent(
      bytes.toString('base64'),
      sha256,
      bytes.byteLength + 1,
    )
    expect(check.valid).toBe(false)
  })
})

describe('compareSeedRunBaselines', () => {
  it('treats two captured baselines as equal', () => {
    expect(compareSeedRunBaselines(baseline(), baseline()).equal).toBe(true)
  })

  it('does not hide a metric difference behind key order', () => {
    const right = baseline()
    right.runs[0]!.metrics = { rank_noise_20: 5 }
    const comparison = compareSeedRunBaselines(baseline(), right)
    expect(comparison.equal).toBe(false)
    expect(comparison.differences[0]?.path).toBe('$.runs[0].metrics.rank_noise_20')
  })

  it('reports artifact hash differences', () => {
    const right = baseline()
    right.runs[1]!.artifacts[0]!.sha256 = 'e'.repeat(64)
    const comparison = compareSeedRunBaselines(baseline(), right)
    expect(comparison.equal).toBe(false)
    expect(
      comparison.differences.some((diff) =>
        diff.path.endsWith('artifacts[0].sha256'),
      ),
    ).toBe(true)
  })

  it('reports lineage label differences', () => {
    const right = baseline()
    right.runs[1]!.parentLabel = null
    const comparison = compareSeedRunBaselines(baseline(), right)
    expect(
      comparison.differences.some((diff) =>
        diff.path.endsWith('parentLabel'),
      ),
    ).toBe(true)
  })
})

describe('assertSeedRunBaselinesMatch', () => {
  it('does not throw for matching baselines', () => {
    expect(() => assertSeedRunBaselinesMatch(baseline(), baseline())).not.toThrow()
  })

  it('throws a typed BASELINE_MISMATCH for differing baselines', () => {
    const right = baseline()
    right.runs[0]!.verdict = 'mismatch'

    try {
      assertSeedRunBaselinesMatch(baseline(), right)
      throw new Error('expected assertSeedRunBaselinesMatch to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(SeedRunError)
      expect((error as SeedRunError).code).toBe('BASELINE_MISMATCH')
    }
  })
})

function createHashForTest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function minimalSpec(claimNodeId: string): ExperimentSpec {
  return {
    claimNodeId,
    mode: 'adapted',
    language: 'python',
    image: 'researchgraph-python:locked',
    files: { 'main.py': 'print(1)\n' },
    entrypoint: 'python main.py',
    datasets: [],
    parameters: { importance_method: 'impurity', seed: 42 },
    criteria: { mode: 'all', checks: [] },
    timeoutSeconds: 30,
    memoryMb: 2048,
    cpuCount: 1,
    network: 'none',
  }
}

function failingSeedInput(
  overrides: Partial<SeedRunsInput> = {},
): SeedRunsInput {
  return {
    // These prerequisite and input checks must reject before the first query.
    db: {} as never,
    workspaceId: 'workspace-1',
    claimNodeId: 'claim-1',
    operatorUserId: 'operator-1',
    runASpec: minimalSpec('claim-1'),
    change: {
      parameterName: 'importance_method',
      runA: 'impurity',
      runB: 'permutation',
    },
    approve: async () => ({
      decision: 'approved',
      actorId: 'operator-1',
      specSha256: '0'.repeat(64),
    }),
    ...overrides,
  }
}

const unreachableBranch = async () => {
  throw new Error('the what-if branch must not be called in a preflight test')
}
const unreachableStore = {
  getParentRun: async () => null,
  createExperimentAndRun: unreachableBranch,
}

describe('seedRuns prerequisites', () => {
  it('distinguishes a missing what-if service from a verification failure', async () => {
    await expect(seedRuns(failingSeedInput())).rejects.toMatchObject({
      code: 'WHAT_IF_UNAVAILABLE',
    })
  })

  it('distinguishes a custom executor without queued-run adoption', async () => {
    await expect(
      seedRuns(
        failingSeedInput({
          whatIf: {
            branch: unreachableBranch as never,
            store: unreachableStore as never,
          },
          executor: {
            plan: async () => ({ spec: minimalSpec('claim-1') }),
            execute: async () => ({ runId: 'run-x' }),
            adoptsQueuedRun: false,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'QUEUED_RUN_ADOPTION_UNAVAILABLE' })
  })

  it('rejects a spec bound to a different claim node before any query', async () => {
    await expect(
      seedRuns(
        failingSeedInput({
          runASpec: minimalSpec('another-claim'),
          whatIf: {
            branch: unreachableBranch as never,
            store: unreachableStore as never,
          },
          executor: {
            plan: async () => ({ spec: minimalSpec('another-claim') }),
            execute: async () => ({ runId: 'run-x' }),
            adoptsQueuedRun: true,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('rejects a claim lease that expires before the execution budget', async () => {
    await expect(
      seedRuns(
        failingSeedInput({
          budgetMs: 10_000,
          claimTtlMs: 5_000,
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
})
