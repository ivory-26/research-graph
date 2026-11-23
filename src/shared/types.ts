/**
 * Frozen workspace contracts.
 *
 * These types are the vocabulary every workstream codes against. They mirror
 * docs/02-data-model.md and docs/04-experiment-runtime.md; changing one here is
 * a contract change that needs a heads-up before it lands.
 */

// ---------------------------------------------------------------------------
// Graph vocabulary (docs/02-data-model.md)
// ---------------------------------------------------------------------------

export type NodeType =
  | 'source'
  | 'claim'
  | 'method'
  | 'dataset'
  | 'result'
  | 'run'
  | 'note'

export type EdgeRelation =
  | 'supports'
  | 'contradicts'
  | 'cites'
  | 'uses_dataset'
  | 'tests'
  | 'produced'
  | 'derived_from'

export type EdgeStatus = 'suggested' | 'accepted' | 'rejected'

/** An edge with neither a chunk nor a run behind it is not representable. */
export type GraphEdge = {
  id: string
  sourceNodeId: string
  targetNodeId: string
  relation: EdgeRelation
  status: EdgeStatus
  evidenceChunkId: string | null
  evidenceRunId: string | null
  confidence: number | null
}

export type GraphNode = {
  id: string
  type: NodeType
  title: string
  data: NodeData
  sourceId: string | null
}

/**
 * A number as the paper published it. Never written from a measurement.
 * `value: null` is legal and load-bearing: the hero claim is qualitative.
 */
export type ReportedValue = {
  metric: string
  value: number | null
  comparator: 'gt' | 'lt' | 'eq' | null
  against: number | null
  quote: string
}

export type NodeData =
  | {
      type: 'claim'
      text: string
      reported: ReportedValue | null
      datasetName: string | null
      methodName: string | null
      locator: { page: number; quote: string }
    }
  | { type: 'method'; summary: string; library: string | null }
  | {
      type: 'dataset'
      name: string
      url: string | null
      sha256: string | null
      rows: number | null
    }
  | {
      type: 'result'
      metrics: Record<string, number>
      runId: string
      verdict: Verdict | null
    }
  | { type: 'run'; runId: string; status: RunStatus; mode: RunMode }
  | { type: 'note'; body: string }
  | { type: 'source'; sourceId: string; kind: string }

/**
 * Free-form metadata on a source row. The ingestion workstream owns the keys;
 * the contract fixes only that the column is a JSON object.
 */
export type SourceMeta = Record<string, unknown>

// ---------------------------------------------------------------------------
// Agent and approval vocabulary (docs/02-data-model.md, docs/03-agent-pipeline.md)
// ---------------------------------------------------------------------------

/** `agent_strategies.task_kind` / `agent_tasks.task_kind` values. */
export type TaskKind =
  | 'ingest'
  | 'extract_claims'
  | 'propose_edges'
  | 'plan_experiment'
  | 'repair_script'
  | 'explain_gap'

/** `agent_tasks.status` values. A failed call still has a row. */
export type AgentTaskStatus = 'succeeded' | 'failed' | 'rejected' | 'retried'

export type ApprovalState = 'pending' | 'approved' | 'rejected'

// ---------------------------------------------------------------------------
// Reproduction vocabulary (docs/04-experiment-runtime.md)
// ---------------------------------------------------------------------------

/**
 * `exact` exists so a future exact reproduction is a value change rather than a
 * migration. The current product only ever produces `adapted`.
 */
export type Mode = 'exact' | 'adapted' | 'conceptual'

/** Name used by the `run_mode` database enum. */
export type RunMode = Mode

export type RunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timeout'
  | 'cancelled'

export type Verdict = 'match' | 'mismatch' | 'inconclusive' | 'failed'

export type ExperimentSpec = {
  claimNodeId: string
  mode: Mode
  language: 'python'
  /** E2B template id. */
  image: string
  /** path → source text */
  files: Record<string, string>
  /** e.g. "python main.py" */
  entrypoint: string
  datasets: DatasetRef[]
  parameters: Record<string, unknown>
  criteria: Criteria
  /** ≤ 120 */
  timeoutSeconds: number
  /** 2048 */
  memoryMb: number
  /** 1 */
  cpuCount: number
  /** Structural, not a setting: no code path may set it to anything else. */
  network: 'none'
}

export type DatasetRef = {
  name: string
  url: string
  /** Where the bytes land inside the sandbox. */
  path: string
  /** null on first fetch, pinned afterwards. */
  sha256: string | null
  bytes: number | null
}

export type CriteriaOp = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq' | 'within'

export type Criteria = {
  mode: 'all' | 'any'
  checks: Array<{
    metric: string
    op: CriteriaOp
    value: number
    /** Used by 'within'. */
    tolerance?: number
  }>
}

export type ExperimentResult = {
  exitCode: number
  stdout: string
  stderr: string
  metrics: Record<string, number>
  artifacts: Array<{
    path: string
    sha256: string
    bytes: number
    content?: string
  }>
  durationMs: number
  environment: RunEnvironment
}

export type RunEnvironment = {
  imageDigest: string
  python: string
  /** name → version, read from the sandbox */
  packages: Record<string, string>
  datasets: Array<{ name: string; sha256: string; bytes: number }>
  seeds: number[]
  startedAt: string
}

/**
 * Per-check outcome of deterministic criteria evaluation.
 * `measured` is null when the criterion names a metric the run did not write.
 */
export type VerdictCheck = {
  metric: string
  op: CriteriaOp
  threshold: number
  tolerance: number | null
  measured: number | null
  passed: boolean
}

/**
 * Stored on `runs.verdict_detail`. The verdict itself is computed by code from
 * `VerdictCheck[]`; `explanation` is prose added by the model afterwards and
 * can never change a check or the verdict.
 */
export type VerdictDetail = {
  checks: VerdictCheck[]
  explanation: string | null
}
