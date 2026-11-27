/**
 * Two-database seed comparison for the canonical baseline decision.
 *
 * The baseline is the result of two live, end-to-end seeds on separate fresh
 * databases. This tool reads both databases and compares them as **logical**
 * workspaces:
 *
 * - no DB-generated UUID (source, chunk, node, edge, experiment, run, artifact)
 *   appears in a comparison key;
 * - no timestamp, sandbox id or duration is compared;
 * - asset sha256/bytes are checked against the checked-in PDF bytes, not the
 *   UI fixture;
 * - claim quotes are re-checked against the stored chunks and page anchors;
 * - run metrics, stdout/stderr, verdict checks, artifacts and parent lineage
 *   are compared exactly, while the model-written verdict explanation prose is
 *   compared only by presence.
 *
 * It never writes to either database. The two URLs are supplied as
 * `SEED_BASELINE_DATABASE_URL` and `SEED_CANDIDATE_DATABASE_URL` and are never
 * printed.
 */
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { eq, inArray, sql } from 'drizzle-orm'

import type { Database } from '../../src/db/client.ts'
import { openSeedDatabase } from './database.ts'
import {
  edges as edgesTable,
  experiments as experimentsTable,
  nodes as nodesTable,
  runArtifacts as runArtifactsTable,
  runs as runsTable,
  sourceChunks as sourceChunksTable,
  sources as sourcesTable,
  workspaces,
} from '../../src/db/schema.ts'
import type {
  ExperimentSpec,
  NodeData,
  RunEnvironment,
  Verdict,
  VerdictCheck,
} from '../../src/shared/types.ts'
import { normalizeQuote } from '../../src/server/extract/quote.ts'
import { loadLocalAssets, type LocalAsset } from './assets.ts'
import { SEED_WORKSPACE_SLUG } from './contracts.ts'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'timeout', 'cancelled'])

export type CompareErrorCode =
  | 'MISSING_BASELINE_URL'
  | 'MISSING_CANDIDATE_URL'
  | 'WORKSPACE_NOT_FOUND'
  | 'SNAPSHOT_FAILED'

export class CompareError extends Error {
  readonly code: CompareErrorCode

  constructor(code: CompareErrorCode, message: string) {
    super(message)
    this.name = 'CompareError'
    this.code = code
  }
}

export interface ComparisonCheck {
  name: string
  ok: boolean
  details: string[]
}

export interface SnapshotSummary {
  label: string
  workspaceSlug: string
  sources: number
  chunks: number
  nodes: number
  edges: number
  experiments: number
  runs: number
  artifacts: number
  concreteSpecs: Array<{
    experimentKey: string
    concreteSpecHash: string
    approvalState: string
    approvedBy: string | null
  }>
}

export interface SeedComparisonResult {
  ok: boolean
  baseline: SnapshotSummary
  candidate: SnapshotSummary
  checks: ComparisonCheck[]
}

interface RawSource {
  id: string
  workspaceId: string
  kind: string
  title: string
  url: string | null
  doi: string | null
  sha256: string
  bytes: number
  meta: Record<string, unknown>
}

interface RawChunk {
  id: string
  sourceId: string
  ordinal: number
  text: string
  page: number | null
  charStart: number
  charEnd: number
  hasEmbedding: boolean
}

interface RawNode {
  id: string
  workspaceId: string
  type: string
  title: string
  data: NodeData
  sourceId: string | null
}

interface RawEdge {
  id: string
  workspaceId: string
  sourceNodeId: string
  targetNodeId: string
  relation: string
  status: string
  evidenceChunkId: string | null
  evidenceRunId: string | null
  confidence: number | null
}

interface RawExperiment {
  id: string
  workspaceId: string
  claimNodeId: string
  spec: ExperimentSpec
  mode: string
  approvalState: string
  approvedBy: string | null
  approvedAt: Date | null
}

interface RawRun {
  id: string
  experimentId: string
  parentRunId: string | null
  attempt: number
  status: string
  runner: string
  spec: ExperimentSpec
  parameters: Record<string, unknown>
  metrics: Record<string, number>
  environment: RunEnvironment
  verdict: Verdict | null
  verdictDetail: {
    checks?: VerdictCheck[]
    explanation?: string | null
  } | null
  stdout: string
  stderr: string
}

interface RawArtifact {
  id: string
  runId: string
  kind: string
  path: string
  sha256: string
  bytes: number
  content: string | null
}

export interface RawSnapshot {
  label: string
  workspace: { id: string; name: string; slug: string }
  sources: RawSource[]
  chunks: RawChunk[]
  nodes: RawNode[]
  edges: RawEdge[]
  experiments: RawExperiment[]
  runs: RawRun[]
  artifacts: RawArtifact[]
}

export interface LogicalSource {
  key: string
  kind: string
  title: string
  url: string | null
  doi: string | null
  sha256: string
  bytes: number
  meta: Record<string, unknown>
  chunks: Array<{
    ordinal: number
    text: string
    page: number | null
    charStart: number
    charEnd: number
    hasEmbedding: boolean
  }>
}

export interface LogicalNode {
  key: string
  type: string
  title: string
  data: unknown
  sourceKey: string | null
}

export interface LogicalEdge {
  key: string
  from: string
  relation: string
  to: string
  status: string
  evidence: string
  confidence: number | null
}

export interface LogicalExperiment {
  key: string
  claimKey: string
  mode: string
  approvalState: string
  approvedBy: string | null
  specHash: string
  spec: unknown
}

export interface LogicalRun {
  key: string
  experimentKey: string
  parentRunKey: string | null
  attempt: number
  status: string
  runner: string
  specHash: string
  parameters: Record<string, unknown>
  metrics: Record<string, number>
  verdict: Verdict | null
  verdictChecks: VerdictCheck[]
  hasExplanation: boolean
  environment: unknown
  artifacts: Array<{
    kind: string
    path: string
    sha256: string
    bytes: number
    /** SHA-256 of the decoded content bytes; null when content is external. */
    contentSha256: string | null
  }>
}

export interface LogicalSnapshot {
  workspace: { name: string; slug: string }
  sources: LogicalSource[]
  nodes: LogicalNode[]
  edges: LogicalEdge[]
  experiments: LogicalExperiment[]
  runs: LogicalRun[]
  concreteSpecs: SnapshotSummary['concreteSpecs']
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      const item = source[key]
      if (item !== undefined) result[key] = canonicalize(item)
    }
    return result
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value)) ?? 'undefined'
}

function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value))
}

function normaliseText(value: string | null | undefined): string {
  return normalizeQuote(value ?? '')
}

function sourceKeyOf(source: RawSource): string {
  const doi = source.doi?.trim().toLowerCase()
  return doi ? `doi:${doi}` : `sha256:${source.sha256}`
}

function sortedByCanonical<T>(items: T[]): T[] {
  return items
    .map((item) => ({ item, json: canonicalJson(item) }))
    .sort((a, b) => a.json.localeCompare(b.json))
    .map(({ item }) => item)
}

function normaliseSpec(spec: ExperimentSpec, claimKey: string): unknown {
  const copy = JSON.parse(JSON.stringify(spec)) as ExperimentSpec
  copy.claimNodeId = claimKey
  return copy
}

/**
 * Decode an inline artifact the same way the E2B runner and a text writer can
 * produce it: canonical base64 bytes first, then UTF-8. The returned digest is
 * over decoded bytes, so two seeds agree even if one stores base64 and the
 * other stores UTF-8.
 */
export function decodeArtifactContent(
  content: string,
  expectedSha256: string,
  expectedBytes: number,
): {
  encoding: 'base64' | 'utf8'
  sha256: string
  bytes: number
  valid: boolean
} {
  const isCanonicalBase64 =
    content.length > 0 &&
    content.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(content)

  if (isCanonicalBase64) {
    const decoded = Buffer.from(content, 'base64')
    const sha256 = createHash('sha256').update(decoded).digest('hex')
    if (sha256 === expectedSha256 && decoded.byteLength === expectedBytes) {
      return {
        encoding: 'base64',
        sha256,
        bytes: decoded.byteLength,
        valid: true,
      }
    }
  }

  const bytes = Buffer.from(content, 'utf8')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return {
    encoding: 'utf8',
    sha256,
    bytes: bytes.byteLength,
    valid: sha256 === expectedSha256 && bytes.byteLength === expectedBytes,
  }
}

function normaliseEnvironment(environment: RunEnvironment): unknown {
  return {
    imageDigest: environment.imageDigest,
    python: environment.python,
    packages: environment.packages,
    datasets: [...environment.datasets].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    seeds: environment.seeds,
  }
}

async function withDatabase<T>(
  url: string,
  fn: (db: Database) => Promise<T>,
): Promise<T> {
  const opened = openSeedDatabase(url)
  try {
    return await fn(opened.db)
  } finally {
    await opened.close()
  }
}

async function readRawSnapshot(
  db: Database,
  label: string,
): Promise<RawSnapshot> {
  const [workspace] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
    })
    .from(workspaces)
    .where(eq(workspaces.slug, SEED_WORKSPACE_SLUG))
    .limit(1)

  if (!workspace) {
    throw new CompareError(
      'WORKSPACE_NOT_FOUND',
      `The ${label} database has no workspace with slug ${SEED_WORKSPACE_SLUG}.`,
    )
  }

  const sources = await db
    .select({
      id: sourcesTable.id,
      workspaceId: sourcesTable.workspaceId,
      kind: sourcesTable.kind,
      title: sourcesTable.title,
      url: sourcesTable.url,
      doi: sourcesTable.doi,
      sha256: sourcesTable.sha256,
      bytes: sourcesTable.bytes,
      meta: sourcesTable.meta,
    })
    .from(sourcesTable)
    .where(eq(sourcesTable.workspaceId, workspace.id))

  const chunks = await db
    .select({
      id: sourceChunksTable.id,
      sourceId: sourceChunksTable.sourceId,
      ordinal: sourceChunksTable.ordinal,
      text: sourceChunksTable.text,
      page: sourceChunksTable.page,
      charStart: sourceChunksTable.charStart,
      charEnd: sourceChunksTable.charEnd,
      hasEmbedding: sql<boolean>`${sourceChunksTable.embedding} is not null`,
    })
    .from(sourceChunksTable)
    .innerJoin(sourcesTable, eq(sourceChunksTable.sourceId, sourcesTable.id))
    .where(eq(sourcesTable.workspaceId, workspace.id))

  const nodes = await db
    .select({
      id: nodesTable.id,
      workspaceId: nodesTable.workspaceId,
      type: nodesTable.type,
      title: nodesTable.title,
      data: nodesTable.data,
      sourceId: nodesTable.sourceId,
    })
    .from(nodesTable)
    .where(eq(nodesTable.workspaceId, workspace.id))

  const edges = await db
    .select({
      id: edgesTable.id,
      workspaceId: edgesTable.workspaceId,
      sourceNodeId: edgesTable.sourceNodeId,
      targetNodeId: edgesTable.targetNodeId,
      relation: edgesTable.relation,
      status: edgesTable.status,
      evidenceChunkId: edgesTable.evidenceChunkId,
      evidenceRunId: edgesTable.evidenceRunId,
      confidence: edgesTable.confidence,
    })
    .from(edgesTable)
    .where(eq(edgesTable.workspaceId, workspace.id))

  const experiments = await db
    .select({
      id: experimentsTable.id,
      workspaceId: experimentsTable.workspaceId,
      claimNodeId: experimentsTable.claimNodeId,
      spec: experimentsTable.spec,
      mode: experimentsTable.mode,
      approvalState: experimentsTable.approvalState,
      approvedBy: experimentsTable.approvedBy,
      approvedAt: experimentsTable.approvedAt,
    })
    .from(experimentsTable)
    .where(eq(experimentsTable.workspaceId, workspace.id))

  const runs = await db
    .select({
      id: runsTable.id,
      experimentId: runsTable.experimentId,
      parentRunId: runsTable.parentRunId,
      attempt: runsTable.attempt,
      status: runsTable.status,
      runner: runsTable.runner,
      spec: runsTable.spec,
      parameters: runsTable.parameters,
      metrics: runsTable.metrics,
      environment: runsTable.environment,
      verdict: runsTable.verdict,
      verdictDetail: runsTable.verdictDetail,
      stdout: runsTable.stdout,
      stderr: runsTable.stderr,
    })
    .from(runsTable)
    .innerJoin(experimentsTable, eq(runsTable.experimentId, experimentsTable.id))
    .where(eq(experimentsTable.workspaceId, workspace.id))

  const runIds = runs.map((run) => run.id)
  const artifacts = runIds.length
    ? await db
        .select({
          id: runArtifactsTable.id,
          runId: runArtifactsTable.runId,
          kind: runArtifactsTable.kind,
          path: runArtifactsTable.path,
          sha256: runArtifactsTable.sha256,
          bytes: runArtifactsTable.bytes,
          content: runArtifactsTable.content,
        })
        .from(runArtifactsTable)
        .where(inArray(runArtifactsTable.runId, runIds))
    : []

  return {
    label,
    workspace,
    sources,
    chunks,
    nodes,
    edges,
    experiments,
    runs,
    artifacts,
  }
}

function buildLogicalSnapshot(raw: RawSnapshot): LogicalSnapshot {
  const sourceKeyById = new Map<string, string>()
  for (const source of raw.sources) {
    sourceKeyById.set(source.id, sourceKeyOf(source))
  }

  const chunksBySourceId = new Map<string, RawChunk[]>()
  for (const chunk of raw.chunks) {
    const list = chunksBySourceId.get(chunk.sourceId) ?? []
    list.push(chunk)
    chunksBySourceId.set(chunk.sourceId, list)
  }

  const sources: LogicalSource[] = raw.sources.map((source) => ({
    key: sourceKeyById.get(source.id)!,
    kind: source.kind,
    title: source.title,
    url: source.url,
    doi: source.doi?.trim().toLowerCase() ?? null,
    sha256: source.sha256,
    bytes: source.bytes,
    meta: source.meta,
    chunks: [...(chunksBySourceId.get(source.id) ?? [])]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((chunk) => ({
        ordinal: chunk.ordinal,
        text: chunk.text,
        page: chunk.page,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        hasEmbedding: Boolean(chunk.hasEmbedding),
      })),
  }))

  const baseNodeKey = (node: RawNode): string => {
    const sourceKey = node.sourceId
      ? sourceKeyById.get(node.sourceId) ?? 'source:unresolved'
      : 'source:none'

    switch (node.type) {
      case 'source':
        return `node:source:${sourceKey}`
      case 'claim':
        if (node.data.type !== 'claim') {
          return `node:claim:malformed:${hashCanonical(node.data)}`
        }
        return `node:claim:${sourceKey}:${hashCanonical({
          title: normaliseText(node.title),
          text: normaliseText(node.data.text),
          quote: normaliseText(node.data.locator.quote),
          page: node.data.locator.page,
        })}`
      case 'method':
        if (node.data.type !== 'method') {
          return `node:method:malformed:${hashCanonical(node.data)}`
        }
        return `node:method:${sourceKey}:${hashCanonical({
          title: normaliseText(node.title),
          summary: normaliseText(node.data.summary),
          library: node.data.library,
        })}`
      case 'dataset':
        if (node.data.type !== 'dataset') {
          return `node:dataset:malformed:${hashCanonical(node.data)}`
        }
        return `node:dataset:${sourceKey}:${hashCanonical({
          title: normaliseText(node.title),
          name: normaliseText(node.data.name),
          url: node.data.url,
          sha256: node.data.sha256,
          rows: node.data.rows,
        })}`
      case 'note':
        if (node.data.type !== 'note') {
          return `node:note:malformed:${hashCanonical(node.data)}`
        }
        return `node:note:${hashCanonical({
          title: normaliseText(node.title),
          body: normaliseText(node.data.body),
        })}`
      default:
        return `node:${node.type}:${hashCanonical(node.data)}`
    }
  }

  const nodeKeyById = new Map<string, string>()
  for (const node of raw.nodes) {
    if (node.type !== 'run' && node.type !== 'result') {
      nodeKeyById.set(node.id, baseNodeKey(node))
    }
  }

  const experimentKeyById = new Map<string, string>()
  const experimentClaimKeyById = new Map<string, string>()
  for (const experiment of raw.experiments) {
    const claimKey =
      nodeKeyById.get(experiment.claimNodeId) ?? 'node:claim:unresolved'
    experimentClaimKeyById.set(experiment.id, claimKey)
    const spec = normaliseSpec(experiment.spec, claimKey)
    experimentKeyById.set(
      experiment.id,
      `experiment:${claimKey}:${hashCanonical(spec)}:${experiment.mode}`,
    )
  }

  const runById = new Map(raw.runs.map((run) => [run.id, run]))
  const runKeyMemo = new Map<string, string>()
  const visiting = new Set<string>()
  const runKey = (runId: string): string => {
    const memo = runKeyMemo.get(runId)
    if (memo) return memo
    const run = runById.get(runId)
    if (!run) return 'run:unresolved'
    if (visiting.has(runId)) return 'run:cycle'
    visiting.add(runId)
    const experimentKey =
      experimentKeyById.get(run.experimentId) ?? 'experiment:unresolved'
    const parentKey = run.parentRunId ? runKey(run.parentRunId) : null
    visiting.delete(runId)
    const key = `run:${experimentKey}:attempt:${run.attempt}:parent:${parentKey ?? 'root'}`
    runKeyMemo.set(runId, key)
    return key
  }
  for (const run of raw.runs) runKey(run.id)

  const nodeKeyOf = (node: RawNode): string => {
    const base = nodeKeyById.get(node.id)
    if (base) return base
    if ((node.type === 'run' || node.type === 'result') && node.data.type === node.type) {
      return `node:${node.type}:${runKey(node.data.runId)}`
    }
    return `node:${node.type}:unresolved`
  }

  const chunkKeyById = new Map<string, string>()
  for (const chunk of raw.chunks) {
    chunkKeyById.set(
      chunk.id,
      `${sourceKeyById.get(chunk.sourceId) ?? 'source:unresolved'}#chunk:${chunk.ordinal}`,
    )
  }

  const logicalNodeData = (node: RawNode): unknown => {
    switch (node.data.type) {
      case 'source':
        return {
          ...node.data,
          sourceId:
            sourceKeyById.get(node.data.sourceId) ?? 'source:unresolved',
        }
      case 'run':
        return {
          ...node.data,
          runId: runKey(node.data.runId),
        }
      case 'result':
        return {
          ...node.data,
          runId: runKey(node.data.runId),
        }
      default:
        return node.data
    }
  }

  const nodes: LogicalNode[] = raw.nodes.map((node) => ({
    key: nodeKeyOf(node),
    type: node.type,
    title: node.title,
    data: logicalNodeData(node),
    sourceKey: node.sourceId
      ? sourceKeyById.get(node.sourceId) ?? 'source:unresolved'
      : null,
  }))

  const edges: LogicalEdge[] = raw.edges.map((edge) => {
    const from = nodeKeyOf(
      raw.nodes.find((node) => node.id === edge.sourceNodeId) ?? {
        id: edge.sourceNodeId,
        workspaceId: edge.workspaceId,
        type: 'unresolved',
        title: '',
        data: { type: 'note', body: '' },
        sourceId: null,
      },
    )
    const to = nodeKeyOf(
      raw.nodes.find((node) => node.id === edge.targetNodeId) ?? {
        id: edge.targetNodeId,
        workspaceId: edge.workspaceId,
        type: 'unresolved',
        title: '',
        data: { type: 'note', body: '' },
        sourceId: null,
      },
    )
    const evidenceParts: string[] = []
    if (edge.evidenceChunkId) {
      evidenceParts.push(
        `chunk:${chunkKeyById.get(edge.evidenceChunkId) ?? 'unresolved'}`,
      )
    }
    if (edge.evidenceRunId) {
      evidenceParts.push(`run:${runKey(edge.evidenceRunId)}`)
    }
    const evidence = evidenceParts.join('+') || 'none'
    return {
      key: `edge:${from}|${edge.relation}|${to}|${edge.status}|${evidence}|confidence:${edge.confidence ?? 'null'}`,
      from,
      relation: edge.relation,
      to,
      status: edge.status,
      evidence,
      confidence: edge.confidence,
    }
  })

  const experiments: LogicalExperiment[] = raw.experiments.map((experiment) => {
    const claimKey =
      experimentClaimKeyById.get(experiment.id) ?? 'node:claim:unresolved'
    const spec = normaliseSpec(experiment.spec, claimKey)
    return {
      key:
        experimentKeyById.get(experiment.id) ??
        `experiment:${claimKey}:${hashCanonical(spec)}:${experiment.mode}`,
      claimKey,
      mode: experiment.mode,
      approvalState: experiment.approvalState,
      approvedBy: experiment.approvedBy,
      specHash: hashCanonical(spec),
      spec,
    }
  })

  const artifactsByRunId = new Map<string, RawArtifact[]>()
  for (const artifact of raw.artifacts) {
    const list = artifactsByRunId.get(artifact.runId) ?? []
    list.push(artifact)
    artifactsByRunId.set(artifact.runId, list)
  }

  const runs: LogicalRun[] = raw.runs.map((run) => {
    const claimKey =
      experimentClaimKeyById.get(run.experimentId) ?? 'node:claim:unresolved'
    const spec = normaliseSpec(run.spec, claimKey)
    const verdictChecks = run.verdictDetail?.checks ?? []
    return {
      key: runKey(run.id),
      experimentKey:
        experimentKeyById.get(run.experimentId) ?? 'experiment:unresolved',
      parentRunKey: run.parentRunId ? runKey(run.parentRunId) : null,
      attempt: run.attempt,
      status: run.status,
      runner: run.runner,
      specHash: hashCanonical(spec),
      parameters: run.parameters,
      metrics: run.metrics,
      verdict: run.verdict,
      verdictChecks,
      // The explanation is model prose and is deliberately not compared.
      hasExplanation: Boolean(run.verdictDetail?.explanation),
      environment: normaliseEnvironment(run.environment),
      artifacts: (artifactsByRunId.get(run.id) ?? [])
        .map((artifact) => {
          const decoded =
            artifact.content === null
              ? null
              : decodeArtifactContent(
                  artifact.content,
                  artifact.sha256,
                  artifact.bytes,
                )
          return {
            kind: artifact.kind,
            path: artifact.path,
            sha256: artifact.sha256,
            bytes: artifact.bytes,
            contentSha256: decoded?.sha256 ?? null,
          }
        })
        .sort((a, b) =>
          `${a.kind}\u0000${a.path}`.localeCompare(`${b.kind}\u0000${b.path}`),
        ),
    }
  })

  return {
    workspace: { name: raw.workspace.name, slug: raw.workspace.slug },
    sources: sortedByCanonical(sources),
    nodes: sortedByCanonical(nodes),
    edges: sortedByCanonical(edges),
    experiments: sortedByCanonical(experiments),
    runs: sortedByCanonical(runs),
    concreteSpecs: raw.experiments
      .map((experiment) => ({
        experimentKey:
          experimentKeyById.get(experiment.id) ?? 'experiment:unresolved',
        // Approval is against the exact stored spec, UUID claim included.
        concreteSpecHash: hashCanonical(experiment.spec),
        approvalState: experiment.approvalState,
        approvedBy: experiment.approvedBy,
      }))
      .sort((a, b) =>
        `${a.experimentKey}\u0000${a.concreteSpecHash}`.localeCompare(
          `${b.experimentKey}\u0000${b.concreteSpecHash}`,
        ),
      ),
  }
}

function checkAssets(
  raw: RawSnapshot,
  localAssets: readonly LocalAsset[],
  label: string,
): ComparisonCheck {
  const details: string[] = []
  const sourceByDoi = new Map<string, RawSource>()
  for (const source of raw.sources) {
    if (source.doi) sourceByDoi.set(source.doi.trim().toLowerCase(), source)
  }

  for (const local of localAssets) {
    const doi = local.asset.doi.toLowerCase()
    const source = sourceByDoi.get(doi)
    if (!source) {
      details.push(`${label}: missing source for DOI ${local.asset.doi}`)
      continue
    }
    if (source.kind !== 'paper') {
      details.push(`${label}: ${local.asset.key} kind is ${source.kind}, expected paper`)
    }
    if (source.sha256 !== local.sha256) {
      details.push(
        `${label}: ${local.asset.key} sha256 is ${source.sha256}, local bytes are ${local.sha256}`,
      )
    }
    if (source.bytes !== local.bytes.length) {
      details.push(
        `${label}: ${local.asset.key} bytes is ${source.bytes}, local bytes are ${local.bytes.length}`,
      )
    }
  }

  const knownDois = new Set(localAssets.map((local) => local.asset.doi.toLowerCase()))
  for (const source of raw.sources) {
    const doi = source.doi?.trim().toLowerCase()
    if (!doi || !knownDois.has(doi)) {
      details.push(
        `${label}: unexpected source ${source.title} (doi ${source.doi ?? 'none'})`,
      )
    }
  }

  return {
    name: `${label}.asset-hashes`,
    ok: details.length === 0,
    details,
  }
}

export function checkSemantics(
  raw: RawSnapshot,
  label: string,
): ComparisonCheck {
  const details: string[] = []
  const sourceById = new Map(raw.sources.map((source) => [source.id, source]))
  const sourceKeyById = new Map(
    raw.sources.map((source) => [source.id, sourceKeyOf(source)]),
  )
  const nodeById = new Map(raw.nodes.map((node) => [node.id, node]))
  const chunkById = new Map(raw.chunks.map((chunk) => [chunk.id, chunk]))
  const runById = new Map(raw.runs.map((run) => [run.id, run]))
  const experimentById = new Map(
    raw.experiments.map((experiment) => [experiment.id, experiment]),
  )
  const chunksBySourceId = new Map<string, RawChunk[]>()
  for (const chunk of raw.chunks) {
    const list = chunksBySourceId.get(chunk.sourceId) ?? []
    list.push(chunk)
    chunksBySourceId.set(chunk.sourceId, list)
  }

  for (const source of raw.sources) {
    const chunks = [...(chunksBySourceId.get(source.id) ?? [])].sort(
      (a, b) => a.ordinal - b.ordinal,
    )
    if (chunks.length === 0) {
      details.push(`${label}: source ${source.title} has no chunks`)
    }
    chunks.forEach((chunk, index) => {
      const key = `${sourceKeyById.get(source.id)}#${chunk.ordinal}`
      if (chunk.ordinal !== index) {
        details.push(`${label}: ${key} ordinal gap (expected ${index})`)
      }
      if (!chunk.hasEmbedding) {
        details.push(`${label}: ${key} has no embedding`)
      }
      if (chunk.charEnd <= chunk.charStart) {
        details.push(
          `${label}: ${key} has invalid char span ${chunk.charStart}..${chunk.charEnd}`,
        )
      }
      if (!chunk.text.trim()) {
        details.push(`${label}: ${key} has empty text`)
      }
    })
  }

  for (const node of raw.nodes) {
    if (node.type !== 'claim') continue
    if (node.data.type !== 'claim') {
      details.push(`${label}: claim node ${node.title} has non-claim data`)
      continue
    }
    const source = node.sourceId ? sourceById.get(node.sourceId) : undefined
    if (!source) {
      details.push(`${label}: claim ${node.title} has no resolvable source`)
      continue
    }
    const quote = normaliseText(node.data.locator.quote)
    if (!quote) {
      details.push(`${label}: claim ${node.title} has an empty quote`)
      continue
    }
    const chunks = chunksBySourceId.get(source.id) ?? []
    const page = node.data.locator.page
    const found = chunks.some(
      (chunk) =>
        (page === null || chunk.page === page) &&
        normaliseText(chunk.text).includes(quote),
    )
    if (!found) {
      details.push(
        `${label}: claim ${node.title} quote is not verbatim in ${sourceKeyById.get(source.id)} page ${page}`,
      )
    }
  }

  for (const node of raw.nodes) {
    if (node.type === 'run') {
      if (node.data.type !== 'run') {
        details.push(`${label}: run node ${node.title} has non-run data`)
        continue
      }
      const run = runById.get(node.data.runId)
      if (!run) {
        details.push(`${label}: run node ${node.title} references a missing run`)
        continue
      }
      if (node.data.status !== run.status) {
        details.push(
          `${label}: run node ${node.title} status differs from runs.status`,
        )
      }
      if (node.data.mode !== run.spec.mode) {
        details.push(
          `${label}: run node ${node.title} mode differs from the frozen spec`,
        )
      }
    }

    if (node.type !== 'result') continue
    if (node.data.type !== 'result') {
      details.push(`${label}: result node ${node.title} has non-result data`)
      continue
    }
    const run = runById.get(node.data.runId)
    if (!run) {
      details.push(`${label}: result node ${node.title} references a missing run`)
      continue
    }
    if (canonicalJson(node.data.metrics) !== canonicalJson(run.metrics)) {
      details.push(
        `${label}: result node ${node.title} metrics differ from runs.metrics`,
      )
    }
    if (node.data.verdict !== run.verdict) {
      details.push(
        `${label}: result node ${node.title} verdict differs from runs.verdict`,
      )
    }
  }

  const workspaceId = raw.workspace.id

  for (const edge of raw.edges) {
    const source = nodeById.get(edge.sourceNodeId)
    const target = nodeById.get(edge.targetNodeId)
    if (!source || !target) {
      details.push(`${label}: edge ${edge.relation} has a missing endpoint node`)
    }

    // Run evidence is required for every `produced` edge and for any edge that
    // touches a run node (dataset --uses_dataset--> run,
    // run --derived_from--> run). All other edges are knowledge edges over
    // source/claim/method/dataset nodes and are anchored in a source chunk.
    const requiresRunEvidence =
      edge.relation === 'produced' ||
      source?.type === 'run' ||
      target?.type === 'run'

    if (!edge.evidenceChunkId && !edge.evidenceRunId) {
      details.push(`${label}: edge ${edge.id} has no evidence reference`)
    }
    if (requiresRunEvidence && !edge.evidenceRunId) {
      details.push(
        `${label}: ${edge.relation} edge ${edge.id} has no evidence run`,
      )
    }
    if (!requiresRunEvidence && !edge.evidenceChunkId) {
      details.push(
        `${label}: ${edge.relation} edge ${edge.id} has no evidence chunk`,
      )
    }

    if (edge.evidenceChunkId) {
      const chunk = chunkById.get(edge.evidenceChunkId)
      if (!chunk) {
        details.push(`${label}: edge ${edge.id} cites a missing chunk`)
      } else {
        const chunkSource = sourceById.get(chunk.sourceId)
        if (!chunkSource || chunkSource.workspaceId !== workspaceId) {
          details.push(
            `${label}: edge ${edge.id} cites a chunk outside the workspace`,
          )
        }
      }
    }

    if (edge.evidenceRunId) {
      const run = runById.get(edge.evidenceRunId)
      if (!run) {
        details.push(`${label}: edge ${edge.id} cites a missing run`)
      } else {
        const experiment = experimentById.get(run.experimentId)
        if (!experiment || experiment.workspaceId !== workspaceId) {
          details.push(
            `${label}: edge ${edge.id} cites a run outside the workspace`,
          )
        }
        if (!TERMINAL_STATUSES.has(run.status)) {
          details.push(
            `${label}: edge ${edge.id} cites non-terminal run ${run.id} (${run.status})`,
          )
        }
      }
    }
  }

  for (const experiment of raw.experiments) {
    if (!nodeById.has(experiment.claimNodeId)) {
      details.push(`${label}: experiment ${experiment.id} has no claim node`)
    }
    if (experiment.spec.claimNodeId !== experiment.claimNodeId) {
      details.push(
        `${label}: experiment ${experiment.id} spec claimNodeId does not match row`,
      )
    }
    if (experiment.spec.mode !== experiment.mode) {
      details.push(
        `${label}: experiment ${experiment.id} spec mode does not match row`,
      )
    }
    if (experiment.approvalState !== 'pending') {
      if (!experiment.approvedBy || !experiment.approvedAt) {
        details.push(
          `${label}: experiment ${experiment.id} is ${experiment.approvalState} without actor/timestamp`,
        )
      }
    } else if (experiment.approvedBy || experiment.approvedAt) {
      details.push(
        `${label}: pending experiment ${experiment.id} carries approval fields`,
      )
    }
  }

  const lineageSeen = new Set<string>()
  const walkParents = (runId: string, chain: Set<string>): void => {
    if (lineageSeen.has(runId)) return
    lineageSeen.add(runId)
    const run = runById.get(runId)
    if (!run) return
    const experiment = experimentById.get(run.experimentId)
    if (!experiment) {
      details.push(`${label}: run ${run.id} has no experiment`)
    } else if (run.spec.claimNodeId !== experiment.claimNodeId) {
      details.push(
        `${label}: run ${run.id} frozen spec claimNodeId does not match experiment`,
      )
    }
    if (!run.parentRunId) return
    if (chain.has(run.parentRunId)) {
      details.push(`${label}: run ${run.id} has a parent cycle`)
      return
    }
    if (!runById.has(run.parentRunId)) {
      details.push(`${label}: run ${run.id} has a missing parent run`)
      return
    }
    const next = new Set(chain)
    next.add(run.id)
    walkParents(run.parentRunId, next)
  }
  for (const run of raw.runs) walkParents(run.id, new Set())

  for (const artifact of raw.artifacts) {
    if (artifact.content === null) {
      details.push(`${label}: artifact ${artifact.path} has no inline content`)
      continue
    }
    const decoded = decodeArtifactContent(
      artifact.content,
      artifact.sha256,
      artifact.bytes,
    )
    if (!decoded.valid) {
      details.push(
        `${label}: artifact ${artifact.path} content (${decoded.encoding}) is ` +
          `${decoded.bytes} bytes / ${decoded.sha256}, row says ` +
          `${artifact.bytes} / ${artifact.sha256}`,
      )
    }
  }

  return {
    name: `${label}.semantics`,
    ok: details.length === 0,
    details,
  }
}

function multisetDiff(
  baseline: readonly string[],
  candidate: readonly string[],
): { baselineOnly: string[]; candidateOnly: string[] } {
  const counts = new Map<string, number>()
  for (const value of baseline) counts.set(value, (counts.get(value) ?? 0) + 1)
  for (const value of candidate) counts.set(value, (counts.get(value) ?? 0) - 1)

  const baselineOnly: string[] = []
  const candidateOnly: string[] = []
  for (const [value, count] of counts) {
    if (count > 0) baselineOnly.push(...Array<string>(count).fill(value))
    else if (count < 0) candidateOnly.push(...Array<string>(-count).fill(value))
  }
  return { baselineOnly, candidateOnly }
}

function truncate(value: string, max = 300): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`
}

function collectionCheck(
  name: string,
  baseline: readonly unknown[],
  candidate: readonly unknown[],
): ComparisonCheck {
  const baselineJson = baseline.map(canonicalJson).sort()
  const candidateJson = candidate.map(canonicalJson).sort()
  const { baselineOnly, candidateOnly } = multisetDiff(
    baselineJson,
    candidateJson,
  )

  const details: string[] = []
  if (baselineOnly.length > 0) {
    details.push(
      `baseline-only ${baselineOnly.length}: ${baselineOnly
        .slice(0, 5)
        .map((value) => truncate(value))
        .join(' | ')}`,
    )
  }
  if (candidateOnly.length > 0) {
    details.push(
      `candidate-only ${candidateOnly.length}: ${candidateOnly
        .slice(0, 5)
        .map((value) => truncate(value))
        .join(' | ')}`,
    )
  }

  return {
    name,
    ok: baselineOnly.length === 0 && candidateOnly.length === 0,
    details,
  }
}

export function compareSnapshots(
  baseline: LogicalSnapshot,
  candidate: LogicalSnapshot,
): ComparisonCheck[] {
  return [
    {
      name: 'workspace',
      ok: canonicalJson(baseline.workspace) === canonicalJson(candidate.workspace),
      details:
        canonicalJson(baseline.workspace) === canonicalJson(candidate.workspace)
          ? []
          : [
              `baseline ${truncate(canonicalJson(baseline.workspace))}`,
              `candidate ${truncate(canonicalJson(candidate.workspace))}`,
            ],
    },
    collectionCheck('sources+chunks', baseline.sources, candidate.sources),
    collectionCheck('nodes', baseline.nodes, candidate.nodes),
    collectionCheck('edges', baseline.edges, candidate.edges),
    collectionCheck('experiments', baseline.experiments, candidate.experiments),
    collectionCheck('runs+artifacts', baseline.runs, candidate.runs),
  ]
}

function summarise(
  raw: RawSnapshot,
  logical: LogicalSnapshot,
  label: string,
): SnapshotSummary {
  return {
    label,
    workspaceSlug: logical.workspace.slug,
    sources: raw.sources.length,
    chunks: raw.chunks.length,
    nodes: raw.nodes.length,
    edges: raw.edges.length,
    experiments: raw.experiments.length,
    runs: raw.runs.length,
    artifacts: raw.artifacts.length,
    concreteSpecs: logical.concreteSpecs,
  }
}

async function readDatabase(
  url: string,
  label: string,
): Promise<RawSnapshot> {
  try {
    return await withDatabase(url, (db) => readRawSnapshot(db, label))
  } catch (error) {
    if (error instanceof CompareError) throw error
    if (process.env.SEED_DEBUG === '1' && error instanceof Error) {
      console.error(`${label} database read failed: ${error.message}`)
    }
    throw new CompareError(
      'SNAPSHOT_FAILED',
      `Could not read the ${label} database. Check the URL, connectivity and migrations.`,
    )
  }
}

function printCheck(check: ComparisonCheck): void {
  console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}`)
  for (const detail of check.details.slice(0, 10)) {
    console.log(`      ${detail}`)
  }
  if (check.details.length > 10) {
    console.log(`      … ${check.details.length - 10} more`)
  }
}

function printReport(result: SeedComparisonResult): void {
  console.log('')
  console.log('=== ResearchGraph two-seed comparison ===')
  for (const summary of [result.baseline, result.candidate]) {
    console.log(
      `${summary.label}: ${summary.workspaceSlug} · ${summary.sources} sources · ` +
        `${summary.chunks} chunks · ${summary.nodes} nodes · ${summary.edges} edges · ` +
        `${summary.experiments} experiments · ${summary.runs} runs · ${summary.artifacts} artifacts`,
    )
    for (const spec of summary.concreteSpecs) {
      console.log(
        `  spec ${spec.concreteSpecHash} · ${spec.approvalState} · ` +
          `approvedBy ${spec.approvedBy ?? 'none'} · ${spec.experimentKey}`,
      )
    }
  }
  console.log('')
  for (const check of result.checks) printCheck(check)
  console.log('')
  console.log(result.ok ? 'RESULT: MATCH' : 'RESULT: DIFFERENCE')
  console.log('')
  console.log('SEED_COMPARISON_JSON_BEGIN')
  console.log(JSON.stringify(result, null, 2))
  console.log('SEED_COMPARISON_JSON_END')
}

function printUsage(): void {
  console.log(`Usage: pnpm seed:compare

Reads two seeded databases and compares them as logical workspaces. It never
writes to either database and never prints a connection string.

Required environment:
  SEED_BASELINE_DATABASE_URL     first fresh-database seed
  SEED_CANDIDATE_DATABASE_URL    second fresh-database seed

Checks:
  - source sha256/bytes against the checked-in PDF bytes
  - claim quotes against stored chunks and page anchors
  - chunk ordinals, embeddings and character spans
  - edge evidence, result-node metrics and run lineage
  - artifact bytes/sha256 against inline content
  - logical graph, experiments, runs, artifacts and lineage across the two DBs
    with DB-generated ids and timestamps removed
  - model-written verdict explanations by presence only
`)
}

export async function main(argv: string[] = []): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage()
    return 0
  }

  const baselineUrl = process.env.SEED_BASELINE_DATABASE_URL?.trim()
  const candidateUrl = process.env.SEED_CANDIDATE_DATABASE_URL?.trim()

  if (!baselineUrl) {
    throw new CompareError(
      'MISSING_BASELINE_URL',
      'SEED_BASELINE_DATABASE_URL is required.',
    )
  }
  if (!candidateUrl) {
    throw new CompareError(
      'MISSING_CANDIDATE_URL',
      'SEED_CANDIDATE_DATABASE_URL is required.',
    )
  }

  const localAssets = loadLocalAssets(REPO_ROOT)
  const baselineRaw = await readDatabase(baselineUrl, 'baseline')
  const candidateRaw = await readDatabase(candidateUrl, 'candidate')
  const baseline = buildLogicalSnapshot(baselineRaw)
  const candidate = buildLogicalSnapshot(candidateRaw)

  const checks: ComparisonCheck[] = [
    checkAssets(baselineRaw, localAssets, 'baseline'),
    checkAssets(candidateRaw, localAssets, 'candidate'),
    checkSemantics(baselineRaw, 'baseline'),
    checkSemantics(candidateRaw, 'candidate'),
    ...compareSnapshots(baseline, candidate),
  ]

  const result: SeedComparisonResult = {
    ok: checks.every((check) => check.ok),
    baseline: summarise(baselineRaw, baseline, 'baseline'),
    candidate: summarise(candidateRaw, candidate, 'candidate'),
    checks,
  }

  printReport(result)
  return result.ok ? 0 : 1
}
