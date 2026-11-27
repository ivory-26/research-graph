import { describe, expect, it } from 'vitest'

import type {
  ExperimentSpec,
  NodeData,
  RunMode,
  RunStatus,
} from '../../src/shared/types.ts'
import {
  canonicalJson,
  checkSemantics,
  compareSnapshots,
  decodeArtifactContent,
  type ComparisonCheck,
  type LogicalNode,
  type LogicalRun,
  type LogicalSnapshot,
  type RawSnapshot,
} from './compare.ts'

const HELLO_SHA256 =
  '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

function snapshot(
  overrides: Partial<LogicalSnapshot> = {},
): LogicalSnapshot {
  return {
    workspace: { name: 'Random Forest Study', slug: 'random-forest-study' },
    sources: [],
    nodes: [],
    edges: [],
    experiments: [],
    runs: [],
    concreteSpecs: [],
    ...overrides,
  }
}

function byName(
  checks: ComparisonCheck[],
  name: string,
): ComparisonCheck {
  const check = checks.find((candidate) => candidate.name === name)
  if (!check) throw new Error(`missing comparison check: ${name}`)
  return check
}

const RUN: LogicalRun = {
  key: 'run:experiment:claim:h:adapted:attempt:1:parent:root',
  experimentKey: 'experiment:claim:h:adapted',
  parentRunKey: null,
  attempt: 1,
  status: 'succeeded',
  runner: 'e2b',
  specHash: 'spec-hash',
  parameters: { importance_method: 'impurity' },
  metrics: { rank_impurity_noise_20: 4 },
  verdict: 'match',
  verdictChecks: [
    {
      metric: 'rank_impurity_noise_20',
      op: 'lte',
      threshold: 5,
      tolerance: null,
      measured: 4,
      passed: true,
    },
  ],
  hasExplanation: true,
  environment: {
    imageDigest: 'unknown',
    python: 'Python 3.12.16',
    packages: { numpy: '2.5.5' },
    datasets: [],
    seeds: [42],
  },
  artifacts: [
    {
      kind: 'table',
      path: '/output/metrics.json',
      sha256: HELLO_SHA256,
      bytes: 5,
      contentSha256: HELLO_SHA256,
    },
  ],
}

describe('logical seed comparison', () => {
  it('canonicalises object key order and Dates', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    )
    expect(canonicalJson({ at: new Date('2026-11-27T00:00:00.000Z') })).toBe(
      '{"at":"2026-11-27T00:00:00.000Z"}',
    )
  })

  it('matches identical logical snapshots', () => {
    const checks = compareSnapshots(snapshot(), snapshot())
    expect(checks).toHaveLength(6)
    expect(checks.every((check) => check.ok)).toBe(true)
  })

  it('ignores concrete spec hashes, which contain DB-generated claim ids', () => {
    const left = snapshot({
      concreteSpecs: [
        {
          experimentKey: 'experiment:claim:h:adapted',
          concreteSpecHash: 'hash-from-database-a',
          approvalState: 'approved',
          approvedBy: 'auth-user-1',
        },
      ],
    })
    const right = snapshot({
      concreteSpecs: [
        {
          experimentKey: 'experiment:claim:h:adapted',
          concreteSpecHash: 'hash-from-database-b',
          approvalState: 'approved',
          approvedBy: 'auth-user-1',
        },
      ],
    })

    expect(compareSnapshots(left, right).every((check) => check.ok)).toBe(true)
  })

  it('detects a graph difference by logical identity', () => {
    const node: LogicalNode = {
      key: 'node:claim:doi:10.1186/1471-2105-8-25:h',
      type: 'claim',
      title: 'claim',
      data: { type: 'claim', text: 'text' },
      sourceKey: 'doi:10.1186/1471-2105-8-25',
    }

    const changed = compareSnapshots(
      snapshot(),
      snapshot({ nodes: [node] }),
    )

    expect(byName(changed, 'nodes').ok).toBe(false)
    expect(byName(changed, 'nodes').details.join(' ')).toContain('candidate-only')
  })

  it('detects a workspace metadata difference', () => {
    const changed = compareSnapshots(
      snapshot(),
      snapshot({
        workspace: { name: 'Other', slug: 'random-forest-study' },
      }),
    )

    expect(byName(changed, 'workspace').ok).toBe(false)
  })

  it('compares exact run fields, artifacts and lineage', () => {
    const same = compareSnapshots(
      snapshot({ runs: [RUN] }),
      snapshot({ runs: [structuredClone(RUN)] }),
    )
    expect(same.every((check) => check.ok)).toBe(true)

    const wrongParent = structuredClone(RUN)
    wrongParent.parentRunKey = 'run:unexpected-parent'
    const parentDiff = compareSnapshots(
      snapshot({ runs: [RUN] }),
      snapshot({ runs: [wrongParent] }),
    )
    expect(byName(parentDiff, 'runs+artifacts').ok).toBe(false)

    const wrongArtifact = structuredClone(RUN)
    wrongArtifact.artifacts[0]!.contentSha256 = 'different-content-hash'
    const artifactDiff = compareSnapshots(
      snapshot({ runs: [RUN] }),
      snapshot({ runs: [wrongArtifact] }),
    )
    expect(byName(artifactDiff, 'runs+artifacts').ok).toBe(false)
  })
})

describe('artifact content decoding', () => {
  it('accepts canonical base64 bytes and utf8 bytes for the same digest', () => {
    const base64 = Buffer.from('hello').toString('base64')

    expect(
      decodeArtifactContent(base64, HELLO_SHA256, 5),
    ).toMatchObject({ encoding: 'base64', valid: true, bytes: 5 })
    expect(
      decodeArtifactContent('hello', HELLO_SHA256, 5),
    ).toMatchObject({ encoding: 'utf8', valid: true, bytes: 5 })
  })

  it('rejects content whose bytes do not match the row', () => {
    expect(decodeArtifactContent('hello', 'deadbeef', 999).valid).toBe(false)
  })
})

type RawNodeFixture = RawSnapshot['nodes'][number]
type RawEdgeFixture = RawSnapshot['edges'][number]
type RawRunFixture = RawSnapshot['runs'][number]
type RawExperimentFixture = RawSnapshot['experiments'][number]
type RawSourceFixture = RawSnapshot['sources'][number]
type RawChunkFixture = RawSnapshot['chunks'][number]

const SEED_WORKSPACE_ID = 'workspace:seed'
const SEED_SOURCE_ID = 'source:strobl-2007'
const SEED_CHUNK_ID = 'chunk:strobl-2007:0'
const SEED_CLAIM_NODE_ID = 'node:claim:hero'
const SEED_QUOTE = 'noise can outrank informative features'
const SEED_CHUNK_TEXT = `Random forest measures are biased: ${SEED_QUOTE}.`

function experimentSpec(claimNodeId: string): ExperimentSpec {
  return {
    claimNodeId,
    mode: 'adapted',
    language: 'python',
    image: 'researchgraph-seed',
    files: { 'main.py': 'print("ok")' },
    entrypoint: 'python main.py',
    datasets: [],
    parameters: { importance_method: 'impurity' },
    criteria: { mode: 'all', checks: [] },
    timeoutSeconds: 120,
    memoryMb: 2048,
    cpuCount: 1,
    network: 'none',
  }
}

function rawSnapshot(overrides: Partial<RawSnapshot> = {}): RawSnapshot {
  return {
    label: 'test',
    workspace: {
      id: SEED_WORKSPACE_ID,
      name: 'Random Forest Study',
      slug: 'random-forest-study',
    },
    sources: [],
    chunks: [],
    nodes: [],
    edges: [],
    experiments: [],
    runs: [],
    artifacts: [],
    ...overrides,
  }
}

const SOURCE: RawSourceFixture = {
  id: SEED_SOURCE_ID,
  workspaceId: SEED_WORKSPACE_ID,
  kind: 'paper',
  title: 'Bias in random forest variable importance measures',
  url: null,
  doi: '10.1186/1471-2105-8-25',
  sha256: 'a'.repeat(64),
  bytes: 1024,
  meta: {},
}

const CHUNK: RawChunkFixture = {
  id: SEED_CHUNK_ID,
  sourceId: SEED_SOURCE_ID,
  ordinal: 0,
  text: SEED_CHUNK_TEXT,
  page: 1,
  charStart: 0,
  charEnd: SEED_CHUNK_TEXT.length,
  hasEmbedding: true,
}

function claimNode(): RawNodeFixture {
  return {
    id: SEED_CLAIM_NODE_ID,
    workspaceId: SEED_WORKSPACE_ID,
    type: 'claim',
    title: 'Gini importance is biased',
    data: {
      type: 'claim',
      text: SEED_QUOTE,
      reported: null,
      datasetName: null,
      methodName: null,
      locator: { page: 1, quote: SEED_QUOTE },
    },
    sourceId: SEED_SOURCE_ID,
  }
}

function methodNode(id = 'node:method:rf'): RawNodeFixture {
  return {
    id,
    workspaceId: SEED_WORKSPACE_ID,
    type: 'method',
    title: 'Random forest importance',
    data: {
      type: 'method',
      summary: 'Gini importance',
      library: 'randomForest',
    },
    sourceId: SEED_SOURCE_ID,
  }
}

function datasetNode(id = 'node:dataset:breast-w'): RawNodeFixture {
  return {
    id,
    workspaceId: SEED_WORKSPACE_ID,
    type: 'dataset',
    title: 'Breast cancer',
    data: {
      type: 'dataset',
      name: 'breast-w',
      url: null,
      sha256: null,
      rows: null,
    },
    sourceId: SEED_SOURCE_ID,
  }
}

function runNode(
  id: string,
  runId: string,
  status: RunStatus = 'succeeded',
  mode: RunMode = 'adapted',
): RawNodeFixture {
  const data: Extract<NodeData, { type: 'run' }> = {
    type: 'run',
    runId,
    status,
    mode,
  }
  return {
    id,
    workspaceId: SEED_WORKSPACE_ID,
    type: 'run',
    title: `Run ${runId}`,
    data,
    sourceId: null,
  }
}

function makeExperiment(
  id: string,
  claimNodeId = SEED_CLAIM_NODE_ID,
  workspaceId = SEED_WORKSPACE_ID,
): RawExperimentFixture {
  return {
    id,
    workspaceId,
    claimNodeId,
    spec: experimentSpec(claimNodeId),
    mode: 'adapted',
    approvalState: 'pending',
    approvedBy: null,
    approvedAt: null,
  }
}

function makeRun(
  id: string,
  experimentId: string,
  overrides: Partial<RawRunFixture> = {},
): RawRunFixture {
  return {
    id,
    experimentId,
    parentRunId: null,
    attempt: 1,
    status: 'succeeded',
    runner: 'e2b',
    spec: experimentSpec(SEED_CLAIM_NODE_ID),
    parameters: { importance_method: 'impurity' },
    metrics: {},
    environment: {
      imageDigest: 'unknown',
      python: 'Python 3.12.16',
      packages: {},
      datasets: [],
      seeds: [42],
      startedAt: '2026-11-27T00:00:00.000Z',
    },
    verdict: null,
    verdictDetail: null,
    stdout: '',
    stderr: '',
    ...overrides,
  }
}

function makeEdge(
  input: Pick<RawEdgeFixture, 'sourceNodeId' | 'targetNodeId' | 'relation'> &
    Partial<RawEdgeFixture>,
): RawEdgeFixture {
  return {
    id: 'edge:1',
    workspaceId: SEED_WORKSPACE_ID,
    status: 'accepted',
    evidenceChunkId: null,
    evidenceRunId: null,
    confidence: 1,
    ...input,
  }
}

/** An otherwise-valid workspace containing one terminal run. */
function graphWithRun(overrides: Partial<RawSnapshot> = {}): RawSnapshot {
  return rawSnapshot({
    sources: [SOURCE],
    chunks: [CHUNK],
    nodes: [claimNode()],
    experiments: [makeExperiment('experiment:run-a')],
    runs: [makeRun('run:a', 'experiment:run-a')],
    ...overrides,
  })
}

function semantics(raw: RawSnapshot): ComparisonCheck {
  return checkSemantics(raw, 'test')
}

function datasetToRunEdge(
  overrides: Partial<RawEdgeFixture> = {},
): RawEdgeFixture {
  return makeEdge({
    sourceNodeId: 'node:dataset:breast-w',
    targetNodeId: 'node:run:a',
    relation: 'uses_dataset',
    ...overrides,
  })
}

describe('edge evidence rule', () => {
  it('accepts run evidence on a dataset -> run uses_dataset edge', () => {
    const check = semantics(
      graphWithRun({
        nodes: [claimNode(), datasetNode(), runNode('node:run:a', 'run:a')],
        edges: [datasetToRunEdge({ evidenceRunId: 'run:a' })],
      }),
    )

    expect(check.ok).toBe(true)
  })

  it('accepts run evidence on a run -> run derived_from edge', () => {
    const check = semantics(
      graphWithRun({
        nodes: [
          claimNode(),
          runNode('node:run:a', 'run:a'),
          runNode('node:run:b', 'run:b'),
        ],
        runs: [
          makeRun('run:a', 'experiment:run-a'),
          makeRun('run:b', 'experiment:run-a', {
            attempt: 2,
            parentRunId: 'run:a',
          }),
        ],
        edges: [
          makeEdge({
            sourceNodeId: 'node:run:b',
            targetNodeId: 'node:run:a',
            relation: 'derived_from',
            evidenceRunId: 'run:b',
          }),
        ],
      }),
    )

    expect(check.ok).toBe(true)
  })

  it('accepts run evidence on a method -> run produced edge', () => {
    const check = semantics(
      graphWithRun({
        nodes: [claimNode(), methodNode(), runNode('node:run:a', 'run:a')],
        edges: [
          makeEdge({
            sourceNodeId: 'node:method:rf',
            targetNodeId: 'node:run:a',
            relation: 'produced',
            evidenceRunId: 'run:a',
          }),
        ],
      }),
    )

    expect(check.ok).toBe(true)
  })

  it('rejects a claim -> method knowledge edge with only run evidence', () => {
    const check = semantics(
      graphWithRun({
        nodes: [claimNode(), methodNode()],
        edges: [
          makeEdge({
            sourceNodeId: SEED_CLAIM_NODE_ID,
            targetNodeId: 'node:method:rf',
            relation: 'supports',
            evidenceRunId: 'run:a',
          }),
        ],
      }),
    )

    expect(check.ok).toBe(false)
    expect(check.details.join(' ')).toContain('has no evidence chunk')
  })

  it('rejects a run edge with only chunk evidence', () => {
    const check = semantics(
      graphWithRun({
        nodes: [claimNode(), datasetNode(), runNode('node:run:a', 'run:a')],
        edges: [datasetToRunEdge({ evidenceChunkId: SEED_CHUNK_ID })],
      }),
    )

    expect(check.ok).toBe(false)
    expect(check.details.join(' ')).toContain('has no evidence run')
  })

  it('rejects an edge with no evidence reference at all', () => {
    const check = semantics(
      graphWithRun({
        nodes: [claimNode(), methodNode()],
        edges: [
          makeEdge({
            sourceNodeId: SEED_CLAIM_NODE_ID,
            targetNodeId: 'node:method:rf',
            relation: 'supports',
          }),
        ],
      }),
    )

    expect(check.ok).toBe(false)
    expect(check.details.join(' ')).toContain('has no evidence reference')
  })

  it('rejects run evidence that is not terminal', () => {
    const check = semantics(
      graphWithRun({
        nodes: [
          claimNode(),
          datasetNode(),
          runNode('node:run:a', 'run:a', 'running'),
        ],
        runs: [makeRun('run:a', 'experiment:run-a', { status: 'running' })],
        edges: [datasetToRunEdge({ evidenceRunId: 'run:a' })],
      }),
    )

    expect(check.ok).toBe(false)
    expect(check.details.join(' ')).toContain('non-terminal')
  })

  it('rejects run evidence from another workspace', () => {
    const check = semantics(
      graphWithRun({
        nodes: [claimNode(), datasetNode(), runNode('node:run:a', 'run:a')],
        experiments: [
          makeExperiment(
            'experiment:run-a',
            SEED_CLAIM_NODE_ID,
            'workspace:other',
          ),
        ],
        edges: [datasetToRunEdge({ evidenceRunId: 'run:a' })],
      }),
    )

    expect(check.ok).toBe(false)
    expect(check.details.join(' ')).toContain(
      'cites a run outside the workspace',
    )
  })

  it('rejects chunk evidence from another workspace', () => {
    const check = semantics(
      graphWithRun({
        sources: [{ ...SOURCE, workspaceId: 'workspace:other' }],
        nodes: [claimNode(), methodNode()],
        edges: [
          makeEdge({
            sourceNodeId: SEED_CLAIM_NODE_ID,
            targetNodeId: 'node:method:rf',
            relation: 'supports',
            evidenceChunkId: SEED_CHUNK_ID,
          }),
        ],
      }),
    )

    expect(check.ok).toBe(false)
    expect(check.details.join(' ')).toContain(
      'cites a chunk outside the workspace',
    )
  })
})
