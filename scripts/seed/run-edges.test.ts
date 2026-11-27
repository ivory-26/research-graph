/**
 * Pure tests for the seed's run-lineage anchors and five-edge plan.
 *
 * No database, model or E2B is involved. The database write paths
 * (`ensureRunGraphAnchors`, `writeRunGraphEdges`) call these helpers; the live
 * double-seed comparison is their integration test.
 */
import { describe, expect, it } from 'vitest'

import {
  RunEdgeError,
  SPEC_METHOD_SUMMARY,
  buildDatasetAnchorNode,
  buildMethodAnchorNode,
  checkRunGraphEdgeInputs,
  importanceMethodTitle,
  isTerminalEvidenceRunStatus,
  normalizeRunAnchorName,
  parseImportanceMethod,
  planRunGraphEdges,
  selectExtractedDatasetAnchor,
  selectExtractedMethodAnchor,
  type ExtractedDatasetRow,
  type ExtractedMethodRow,
  type RunGraphAnchors,
  type RunGraphEdgesInput,
  type RunGraphEndpointNode,
  type RunGraphEvidenceRun,
} from './run-edges.ts'

const WORKSPACE_ID = 'workspace-1'
const EARLY = '2026-01-01T00:00:00.000Z'
const LATE = '2026-01-01T00:00:01.000Z'

const RUN_A = { runId: 'run-row-a', runNodeId: 'node-run-a' }
const RUN_B = { runId: 'run-row-b', runNodeId: 'node-run-b' }

function anchors(): RunGraphAnchors {
  return {
    workspaceId: WORKSPACE_ID,
    method: {
      runA: {
        nodeId: 'node-method-impurity',
        title: 'Impurity importance',
        origin: 'extracted',
      },
      runB: {
        nodeId: 'node-method-permutation',
        title: 'Permutation importance',
        origin: 'extracted',
      },
    },
    dataset: {
      nodeId: 'node-dataset',
      title: 'breast-w',
      origin: 'extracted',
    },
  }
}

function edgeInput(): RunGraphEdgesInput {
  return {
    workspaceId: WORKSPACE_ID,
    anchors: anchors(),
    runs: { runA: { ...RUN_A }, runB: { ...RUN_B } },
  }
}

function endpointNodes(): RunGraphEndpointNode[] {
  return [
    {
      id: 'node-method-impurity',
      workspaceId: WORKSPACE_ID,
      type: 'method',
      data: { type: 'method', summary: SPEC_METHOD_SUMMARY, library: null },
    },
    {
      id: 'node-method-permutation',
      workspaceId: WORKSPACE_ID,
      type: 'method',
      data: { type: 'method', summary: SPEC_METHOD_SUMMARY, library: null },
    },
    {
      id: 'node-dataset',
      workspaceId: WORKSPACE_ID,
      type: 'dataset',
      data: {
        type: 'dataset',
        name: 'breast-w',
        url: 'https://example.test/breast-w.arff',
        sha256: null,
        rows: null,
      },
    },
    {
      id: RUN_A.runNodeId,
      workspaceId: WORKSPACE_ID,
      type: 'run',
      data: {
        type: 'run',
        runId: RUN_A.runId,
        status: 'succeeded',
        mode: 'adapted',
      },
    },
    {
      id: RUN_B.runNodeId,
      workspaceId: WORKSPACE_ID,
      type: 'run',
      data: {
        type: 'run',
        runId: RUN_B.runId,
        status: 'succeeded',
        mode: 'adapted',
      },
    },
  ]
}

function evidenceRuns(): RunGraphEvidenceRun[] {
  return [
    { id: RUN_A.runId, workspaceId: WORKSPACE_ID, status: 'succeeded' },
    { id: RUN_B.runId, workspaceId: WORKSPACE_ID, status: 'succeeded' },
  ]
}

function method(
  nodeId: string,
  title: string,
  createdAt: string,
): ExtractedMethodRow {
  return { nodeId, title, createdAt }
}

function dataset(
  nodeId: string,
  name: string,
  createdAt: string,
  title = name,
): ExtractedDatasetRow {
  return { nodeId, name, title, createdAt }
}

function catchError(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  return undefined
}

describe('normalizeRunAnchorName', () => {
  it('folds case, punctuation and whitespace', () => {
    expect(normalizeRunAnchorName('  Impurity-based\tImportance ')).toBe(
      'impurity based importance',
    )
    expect(normalizeRunAnchorName('impurity_importance')).toBe(
      'impurity importance',
    )
    expect(normalizeRunAnchorName('IMPURITY  IMPORTANCE')).toBe(
      'impurity importance',
    )
  })

  it('returns an empty string for input with no letters or digits', () => {
    expect(normalizeRunAnchorName(' — ')).toBe('')
  })
})

describe('parseImportanceMethod', () => {
  it('accepts the two spec values case-insensitively', () => {
    expect(parseImportanceMethod('impurity')).toBe('impurity')
    expect(parseImportanceMethod('Permutation')).toBe('permutation')
  })

  it('fails closed for any other value', () => {
    const error = catchError(() => parseImportanceMethod('gain'))
    expect(error).toBeInstanceOf(RunEdgeError)
    expect((error as RunEdgeError).code).toBe(
      'IMPORTANCE_METHOD_UNSUPPORTED',
    )
  })

  it('fails closed when the value is not a string', () => {
    const error = catchError(() => parseImportanceMethod(42))
    expect(error).toBeInstanceOf(RunEdgeError)
    expect((error as RunEdgeError).code).toBe(
      'IMPORTANCE_METHOD_UNSUPPORTED',
    )
  })
})

describe('selectExtractedMethodAnchor', () => {
  it('prefers an exact normalised title over an earlier containment match', () => {
    const { selection, problem } = selectExtractedMethodAnchor(
      [
        method('method-gini', 'Gini importance', EARLY),
        method('method-impurity', 'Impurity importance', LATE),
      ],
      'impurity',
    )

    expect(problem).toBeNull()
    expect(selection).toEqual({
      nodeId: 'method-impurity',
      title: 'Impurity importance',
    })
  })

  it('matches impurity titles through gini, punctuation and hyphens', () => {
    expect(
      selectExtractedMethodAnchor(
        [method('method-1', 'Gini-based importance (MDI)', EARLY)],
        'impurity',
      ).selection?.nodeId,
    ).toBe('method-1')
    expect(
      selectExtractedMethodAnchor(
        [method('method-2', 'IMPURITY_IMPORTANCE', EARLY)],
        'impurity',
      ).selection?.nodeId,
    ).toBe('method-2')
  })

  it('prefers the exact permutation title', () => {
    const { selection } = selectExtractedMethodAnchor(
      [
        method('method-other', 'Permutation-based measure', EARLY),
        method('method-exact', 'Permutation importance', LATE),
      ],
      'permutation',
    )
    expect(selection?.nodeId).toBe('method-exact')
  })

  it('falls back to the earliest created node within the best rank', () => {
    const { selection, problem } = selectExtractedMethodAnchor(
      [
        method('method-late', 'Gini importance', LATE),
        method('method-early', 'Impurity-based importance', EARLY),
      ],
      'impurity',
    )

    expect(problem).toBeNull()
    expect(selection?.nodeId).toBe('method-early')
  })

  it('returns no selection when nothing matches, so the caller creates one', () => {
    const { selection, problem } = selectExtractedMethodAnchor(
      [
        method('method-rf', 'Random forest', EARLY),
        method('method-boruta', 'Boruta feature selection', LATE),
      ],
      'permutation',
    )

    expect(selection).toBeNull()
    expect(problem).toBeNull()
  })

  it('fails closed when two equally ranked candidates share created_at', () => {
    const { selection, problem } = selectExtractedMethodAnchor(
      [
        method('method-gini', 'Gini importance', EARLY),
        method('method-impurity', 'Impurity measure', EARLY),
      ],
      'impurity',
    )

    expect(selection).toBeNull()
    expect(problem?.code).toBe('METHOD_ANCHOR_AMBIGUOUS')
    expect(problem?.candidates).toHaveLength(2)
  })

  it('fails closed when two exact titles share created_at', () => {
    const { selection, problem } = selectExtractedMethodAnchor(
      [
        method('method-a', 'Impurity importance', EARLY),
        method('method-b', 'Impurity importance', EARLY),
      ],
      'impurity',
    )

    expect(selection).toBeNull()
    expect(problem?.code).toBe('METHOD_ANCHOR_AMBIGUOUS')
  })

  it('picks the earliest of two exact titles when created_at differs', () => {
    const { selection } = selectExtractedMethodAnchor(
      [
        method('method-late', 'Impurity importance', LATE),
        method('method-early', 'Impurity importance', EARLY),
      ],
      'impurity',
    )
    expect(selection?.nodeId).toBe('method-early')
  })
})

describe('selectExtractedDatasetAnchor', () => {
  it('matches the spec name through normalisation', () => {
    const { selection, problem } = selectExtractedDatasetAnchor(
      [dataset('dataset-1', 'Breast-W', EARLY)],
      'breast-w',
    )

    expect(problem).toBeNull()
    expect(selection).toEqual({ nodeId: 'dataset-1', title: 'Breast-W' })
  })

  it('matches the title when data.name differs', () => {
    const { selection } = selectExtractedDatasetAnchor(
      [dataset('dataset-1', 'OpenML corpus', EARLY, 'breast-w')],
      'breast-w',
    )
    expect(selection?.nodeId).toBe('dataset-1')
  })

  it('returns no selection when the papers contain no such dataset', () => {
    const { selection, problem } = selectExtractedDatasetAnchor(
      [dataset('dataset-1', 'iris', EARLY)],
      'breast-w',
    )

    expect(selection).toBeNull()
    expect(problem).toBeNull()
  })

  it('fails closed when two matches share created_at', () => {
    const { selection, problem } = selectExtractedDatasetAnchor(
      [
        dataset('dataset-a', 'breast-w', EARLY),
        dataset('dataset-b', 'Breast-W', EARLY),
      ],
      'breast-w',
    )

    expect(selection).toBeNull()
    expect(problem?.code).toBe('DATASET_ANCHOR_AMBIGUOUS')
  })
})

describe('spec-derived anchor nodes', () => {
  it('titles the impurity fallback without claiming paper provenance', () => {
    expect(importanceMethodTitle('impurity')).toBe('Impurity importance')
    expect(importanceMethodTitle('permutation')).toBe(
      'Permutation importance',
    )
    expect(buildMethodAnchorNode('workspace-1', 'impurity')).toEqual({
      workspaceId: 'workspace-1',
      type: 'method',
      title: 'Impurity importance',
      data: {
        type: 'method',
        summary: SPEC_METHOD_SUMMARY,
        library: null,
      },
      sourceId: null,
    })
  })

  it('copies the spec dataset ref and leaves rows unmeasured', () => {
    expect(
      buildDatasetAnchorNode('workspace-1', {
        name: 'breast-w',
        url: 'https://www.openml.org/data/download/52350/breast-w.arff',
        path: 'data/breast-w.arff',
        sha256: 'cb44e7f62f4a962881147264e5f985eacc13256712e7a4b9d1731ced05f3ee9b',
        bytes: 19177,
      }),
    ).toEqual({
      workspaceId: 'workspace-1',
      type: 'dataset',
      title: 'breast-w',
      data: {
        type: 'dataset',
        name: 'breast-w',
        url: 'https://www.openml.org/data/download/52350/breast-w.arff',
        sha256:
          'cb44e7f62f4a962881147264e5f985eacc13256712e7a4b9d1731ced05f3ee9b',
        rows: null,
      },
      sourceId: null,
    })
  })

  it('copies a null sha256 rather than inventing one', () => {
    const node = buildDatasetAnchorNode('workspace-1', {
      name: 'breast-w',
      url: 'https://example.test/breast-w.arff',
      path: 'data/breast-w.arff',
      sha256: null,
      bytes: null,
    })
    expect(node.data).toMatchObject({ sha256: null, rows: null })
  })

  it('refuses a dataset ref without a name or url', () => {
    const error = catchError(() =>
      buildDatasetAnchorNode('workspace-1', {
        name: ' ',
        url: 'https://example.test/breast-w.arff',
        path: 'data/breast-w.arff',
        sha256: null,
        bytes: null,
      }),
    )
    expect(error).toBeInstanceOf(RunEdgeError)
    expect((error as RunEdgeError).code).toBe('DATASET_SPEC_MISSING')
  })
})

describe('planRunGraphEdges', () => {
  it('plans exactly the five recorded edges with run evidence', () => {
    expect(planRunGraphEdges(edgeInput())).toEqual([
      {
        workspaceId: WORKSPACE_ID,
        sourceNodeId: 'node-method-impurity',
        targetNodeId: 'node-run-a',
        relation: 'produced',
        evidenceRunId: 'run-row-a',
        status: 'accepted',
        confidence: 1,
      },
      {
        workspaceId: WORKSPACE_ID,
        sourceNodeId: 'node-method-permutation',
        targetNodeId: 'node-run-b',
        relation: 'produced',
        evidenceRunId: 'run-row-b',
        status: 'accepted',
        confidence: 1,
      },
      {
        workspaceId: WORKSPACE_ID,
        sourceNodeId: 'node-dataset',
        targetNodeId: 'node-run-a',
        relation: 'uses_dataset',
        evidenceRunId: 'run-row-a',
        status: 'accepted',
        confidence: 1,
      },
      {
        workspaceId: WORKSPACE_ID,
        sourceNodeId: 'node-dataset',
        targetNodeId: 'node-run-b',
        relation: 'uses_dataset',
        evidenceRunId: 'run-row-b',
        status: 'accepted',
        confidence: 1,
      },
      {
        workspaceId: WORKSPACE_ID,
        sourceNodeId: 'node-run-a',
        targetNodeId: 'node-run-b',
        relation: 'derived_from',
        evidenceRunId: 'run-row-b',
        status: 'accepted',
        confidence: 1,
      },
    ])
  })
})

describe('isTerminalEvidenceRunStatus', () => {
  it('accepts every terminal status and rejects queued/running', () => {
    for (const status of [
      'succeeded',
      'failed',
      'timeout',
      'cancelled',
    ] as const) {
      expect(isTerminalEvidenceRunStatus(status)).toBe(true)
    }
    expect(isTerminalEvidenceRunStatus('queued')).toBe(false)
    expect(isTerminalEvidenceRunStatus('running')).toBe(false)
  })
})

describe('checkRunGraphEdgeInputs', () => {
  it('accepts the recorded shape', () => {
    expect(
      checkRunGraphEdgeInputs(edgeInput(), endpointNodes(), evidenceRuns()),
    ).toEqual([])
  })

  it('rejects anchors from another workspace', () => {
    const input = edgeInput()
    input.anchors = { ...input.anchors, workspaceId: 'other-workspace' }

    const problems = checkRunGraphEdgeInputs(
      input,
      endpointNodes(),
      evidenceRuns(),
    )
    expect(problems.map((problem) => problem.code)).toContain(
      'EDGE_ENDPOINT_INVALID',
    )
    expect(problems[0]?.message).toContain('anchors belong to workspace')
  })

  it('rejects a missing endpoint node', () => {
    const problems = checkRunGraphEdgeInputs(
      edgeInput(),
      endpointNodes().filter((node) => node.id !== 'node-dataset'),
      evidenceRuns(),
    )
    expect(problems).toEqual([
      {
        code: 'EDGE_ENDPOINT_INVALID',
        message: 'dataset node node-dataset was not found',
      },
    ])
  })

  it('rejects an endpoint node from another workspace', () => {
    const nodes = endpointNodes().map((node) =>
      node.id === 'node-method-impurity'
        ? { ...node, workspaceId: 'other-workspace' }
        : node,
    )
    const problems = checkRunGraphEdgeInputs(
      edgeInput(),
      nodes,
      evidenceRuns(),
    )
    expect(problems[0]?.code).toBe('EDGE_ENDPOINT_INVALID')
    expect(problems[0]?.message).toContain(
      'belongs to workspace other-workspace',
    )
  })

  it('rejects an endpoint with the wrong node type', () => {
    const nodes = endpointNodes().map((node) =>
      node.id === 'node-dataset'
        ? {
            ...node,
            type: 'note' as const,
            data: { type: 'note' as const, body: 'not a dataset' },
          }
        : node,
    )
    const problems = checkRunGraphEdgeInputs(
      edgeInput(),
      nodes,
      evidenceRuns(),
    )
    expect(problems[0]?.code).toBe('EDGE_ENDPOINT_INVALID')
    expect(problems[0]?.message).toContain('is note, expected dataset')
  })

  it('rejects a run node that projects a different run', () => {
    const nodes = endpointNodes().map((node) =>
      node.id === RUN_A.runNodeId
        ? {
            ...node,
            data: {
              type: 'run' as const,
              runId: 'some-other-run',
              status: 'succeeded' as const,
              mode: 'adapted' as const,
            },
          }
        : node,
    )
    const problems = checkRunGraphEdgeInputs(
      edgeInput(),
      nodes,
      evidenceRuns(),
    )
    expect(problems[0]?.code).toBe('EDGE_ENDPOINT_INVALID')
    expect(problems[0]?.message).toContain(
      'projects run some-other-run, not evidence run run-row-a',
    )
  })

  it('rejects a missing evidence run', () => {
    const problems = checkRunGraphEdgeInputs(
      edgeInput(),
      endpointNodes(),
      evidenceRuns().filter((run) => run.id !== RUN_B.runId),
    )
    expect(problems).toEqual([
      {
        code: 'EDGE_EVIDENCE_RUN_INVALID',
        message: 'Run B evidence run run-row-b was not found',
      },
    ])
  })

  it('rejects a non-terminal evidence run', () => {
    const runs = evidenceRuns().map((run) =>
      run.id === RUN_B.runId ? { ...run, status: 'running' as const } : run,
    )
    const problems = checkRunGraphEdgeInputs(
      edgeInput(),
      endpointNodes(),
      runs,
    )
    expect(problems[0]?.code).toBe('EDGE_EVIDENCE_RUN_INVALID')
    expect(problems[0]?.message).toContain('is running, not terminal')
  })

  it('rejects evidence from another workspace', () => {
    const runs = evidenceRuns().map((run) =>
      run.id === RUN_A.runId
        ? { ...run, workspaceId: 'other-workspace' }
        : run,
    )
    const problems = checkRunGraphEdgeInputs(
      edgeInput(),
      endpointNodes(),
      runs,
    )
    expect(problems[0]?.code).toBe('EDGE_EVIDENCE_RUN_INVALID')
    expect(problems[0]?.message).toContain(
      'belongs to workspace other-workspace',
    )
  })

  it('rejects reusing one run row or one run node for both runs', () => {
    const input = edgeInput()
    input.runs = {
      runA: { ...RUN_A },
      runB: { ...RUN_A },
    }
    const problems = checkRunGraphEdgeInputs(
      input,
      endpointNodes(),
      evidenceRuns(),
    )
    expect(
      problems.filter(
        (problem) => problem.code === 'EDGE_EVIDENCE_RUN_INVALID',
      ),
    ).not.toHaveLength(0)
    expect(
      problems.some((problem) =>
        problem.message.includes('must be different run rows'),
      ),
    ).toBe(true)
  })
})
