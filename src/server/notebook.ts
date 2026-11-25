import { createHash } from 'node:crypto'
import type { Database } from '../db/client'
import { runArtifacts } from '../db/schema'
import type {
  CriteriaOp,
  ExperimentSpec,
  ReportedValue,
  RunEnvironment,
  Verdict,
} from '../shared/types'
import { extractEntrypointFile } from './planner'
import { PINNED_IMAGE_PACKAGES, SANDBOX_METRICS_PATH } from './runner'

export type NbformatOutput = {
  output_type: string
  [key: string]: unknown
}

export type NbformatMarkdownCell = {
  cell_type: 'markdown'
  id: string
  metadata: Record<string, unknown>
  source: string[]
}

export type NbformatCodeCell = {
  cell_type: 'code'
  id: string
  execution_count: null
  metadata: Record<string, unknown>
  outputs: NbformatOutput[]
  source: string[]
}

export type NbformatCell = NbformatMarkdownCell | NbformatCodeCell

export type NbformatV4Document = {
  nbformat: 4
  nbformat_minor: 5
  metadata: {
    kernelspec: {
      display_name: string
      language: string
      name: string
    }
    language_info: {
      name: string
      version: string
    }
  }
  cells: NbformatCell[]
}

export type NotebookClaimInfo = {
  text: string
  quote: string
  page?: number | null
  reported: ReportedValue | null
}

export type BuildNotebookInput = {
  spec: ExperimentSpec
  environment?: Partial<RunEnvironment> | null
  paperTitle?: string | null
  doi?: string | null
  claim: NotebookClaimInfo
  verdict?: Verdict | null
  verdictExplanation?: string | null
}

export type NotebookArtifactPayload = {
  kind: 'notebook'
  path: string
  sha256: string
  bytes: number
  content: string
  notebook: NbformatV4Document
}

function toNbformatLines(text: string): string[] {
  if (text.length === 0) return []
  const normalized = text.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n')
  return parts.map((line, idx) => (idx < parts.length - 1 ? `${line}\n` : line))
}

function formatOp(op: CriteriaOp): string {
  switch (op) {
    case 'lt':
      return '<'
    case 'lte':
      return '<='
    case 'gt':
      return '>'
    case 'gte':
      return '>='
    case 'eq':
      return '=='
    case 'neq':
      return '!='
    case 'within':
      return 'within'
  }
}

function formatReportedValue(reported: ReportedValue | null): string {
  if (!reported) {
    return 'None (qualitative claim; no reported numeric threshold)'
  }
  const valueStr =
    reported.value === null
      ? 'null (qualitative)'
      : `${reported.value}${reported.comparator && reported.against !== null ? ` (${reported.comparator} ${reported.against})` : ''}`
  return `\`${reported.metric}\` = ${valueStr} — "${reported.quote}"`
}

function buildMetadataMarkdownCell(input: BuildNotebookInput): NbformatMarkdownCell {
  const title = input.paperTitle?.trim() || 'Reproducibility Record'
  const doi = input.doi?.trim() || 'N/A'
  const pageSuffix =
    typeof input.claim.page === 'number' ? ` (p. ${input.claim.page})` : ''
  const verdict = input.verdict ?? 'pending'

  const lines = [
    `# Reproducibility Record: ${title}`,
    '',
    `- **Paper:** ${title}`,
    `- **DOI:** \`${doi}\``,
    `- **Claim:** ${input.claim.text}`,
    `- **Claim Quote${pageSuffix}:** "${input.claim.quote}"`,
    `- **Reported Value:** ${formatReportedValue(input.claim.reported)}`,
    `- **Mode:** \`${input.spec.mode}\``,
    `- **Verdict:** \`${verdict}\``,
  ]

  if (input.verdictExplanation) {
    lines.push(`- **Explanation:** ${input.verdictExplanation}`)
  }

  return {
    cell_type: 'markdown',
    id: 'cell-1-metadata',
    metadata: {},
    source: toNbformatLines(lines.join('\n')),
  }
}

function buildPipInstallCell(
  packages: Record<string, string> | undefined,
): NbformatCodeCell {
  // Filter out any pip error sentinels or empty values, and restrict to known valid pinned packages
  const candidate = packages && Object.keys(packages).length > 0 ? packages : PINNED_IMAGE_PACKAGES
  const filtered: Record<string, string> = {}

  for (const [pkg, ver] of Object.entries(candidate)) {
    if (pkg.startsWith('__') || !ver || ver === 'unknown') continue
    // Only pin packages that match the pinned runtime libraries
    if (pkg in PINNED_IMAGE_PACKAGES) {
      filtered[pkg] = ver
    }
  }

  const effectivePackages = Object.keys(filtered).length > 0 ? filtered : PINNED_IMAGE_PACKAGES

  const pkgArgs = Object.entries(effectivePackages)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pkg, ver]) => `"${pkg}==${ver}"`)
    .join(' ')

  const code = [
    '# 1. Install pinned runtime dependencies',
    `!pip install -q ${pkgArgs}`,
  ].join('\n')

  return {
    cell_type: 'code',
    id: 'cell-2-dependencies',
    execution_count: null,
    metadata: {},
    outputs: [],
    source: toNbformatLines(code),
  }
}

function buildDatasetDownloadCell(spec: ExperimentSpec): NbformatCodeCell {
  const lines: string[] = [
    '# 2. Download datasets and verify SHA-256 checksums',
    'import hashlib',
    'import pathlib',
    'import urllib.request',
    '',
  ]

  if (spec.datasets.length === 0) {
    lines.push('print("No external datasets configured for this experiment.")')
  } else {
    lines.push('DATASETS = [')
    for (const ref of spec.datasets) {
      lines.push(
        `    {"name": ${JSON.stringify(ref.name)}, "url": ${JSON.stringify(ref.url)}, "path": ${JSON.stringify(ref.path)}, "sha256": ${ref.sha256 ? JSON.stringify(ref.sha256) : 'None'}},`,
      )
    }
    lines.push(']')
    lines.push('')
    lines.push('for ds in DATASETS:')
    lines.push('    dest = pathlib.Path(ds["path"])')
    lines.push('    dest.parent.mkdir(parents=True, exist_ok=True)')
    lines.push('    if not dest.exists():')
    lines.push('        urllib.request.urlretrieve(ds["url"], dest)')
    lines.push('    actual_sha256 = hashlib.sha256(dest.read_bytes()).hexdigest()')
    lines.push('    expected_sha256 = ds["sha256"]')
    lines.push('    if expected_sha256 is not None and actual_sha256 != expected_sha256:')
    lines.push(
      '        raise ValueError(f"SHA-256 mismatch for {ds[\'name\']}: expected {expected_sha256}, got {actual_sha256}")',
    )
    lines.push(
      '    print(f"Verified {ds[\'name\']} at {dest} ({dest.stat().st_size} bytes, sha256={actual_sha256})")',
    )
  }

  return {
    cell_type: 'code',
    id: 'cell-3-dataset',
    execution_count: null,
    metadata: {},
    outputs: [],
    source: toNbformatLines(lines.join('\n')),
  }
}

function buildVerbatimScriptCell(spec: ExperimentSpec): NbformatCodeCell {
  const entrypointFile = extractEntrypointFile(spec.entrypoint)
  if (!entrypointFile) {
    throw new Error(`Invalid entrypoint "${spec.entrypoint}" in ExperimentSpec`)
  }

  const script = spec.files[entrypointFile]
  if (typeof script !== 'string') {
    throw new Error(
      `Entrypoint script "${entrypointFile}" not found in ExperimentSpec.files`,
    )
  }

  return {
    cell_type: 'code',
    id: 'cell-4-script',
    execution_count: null,
    metadata: {},
    outputs: [],
    source: toNbformatLines(script),
  }
}

function buildMetricsDisplayCell(): NbformatCodeCell {
  const lines = [
    '# 5. Read and display measured metrics',
    'import json',
    'import pathlib',
    '',
    `metrics_path = pathlib.Path(${JSON.stringify(SANDBOX_METRICS_PATH)})`,
    'if not metrics_path.exists():',
    '    raise FileNotFoundError(f"Expected metrics file not found at {metrics_path}")',
    '',
    'with open(metrics_path, "r", encoding="utf-8") as f:',
    '    metrics = json.load(f)',
    '',
    'print(json.dumps(metrics, indent=2))',
  ]

  return {
    cell_type: 'code',
    id: 'cell-5-metrics',
    execution_count: null,
    metadata: {},
    outputs: [],
    source: toNbformatLines(lines.join('\n')),
  }
}

function buildCriteriaMarkdownCell(spec: ExperimentSpec): NbformatMarkdownCell {
  const checkLines = spec.criteria.checks.map((c) => {
    const tol =
      c.op === 'within' && c.tolerance !== undefined
        ? ` (tolerance ±${c.tolerance})`
        : ''
    return `- \`${c.metric}\` ${formatOp(c.op)} \`${c.value}\`${tol}`
  })

  const lines = [
    '## Evaluation Criteria & Pass/Fail Semantics',
    '',
    `Criteria mode: **\`${spec.criteria.mode}\`** (${spec.criteria.mode === 'all' ? 'every check must pass' : 'at least one check must pass'})`,
    '',
    ...checkLines,
    '',
    '### What the verdict means',
    '- **`match`**: Exit code is `0`, all required metrics are present in `/output/metrics.json`, and the criteria pass.',
    '- **`mismatch`**: Exit code is `0` and all required metrics are present, but one or more required criteria failed.',
    '- **`inconclusive`**: Exit code is `0`, but a criterion references a metric missing from `/output/metrics.json`.',
    '- **`failed`**: Non-zero exit code, missing/unparseable `/output/metrics.json`, or sandbox timeout.',
  ]

  return {
    cell_type: 'markdown',
    id: 'cell-6-criteria',
    metadata: {},
    source: toNbformatLines(lines.join('\n')),
  }
}

/**
 * Builds an nbformat v4 document deterministically from the frozen ExperimentSpec
 * and run metadata (docs/04-experiment-runtime.md:211-223). Never calls a model.
 */
export function buildNotebookDocument(
  input: BuildNotebookInput,
): NbformatV4Document {
  const pythonVersion =
    input.environment?.python?.replace(/^Python\s+/i, '').trim() || '3.12'

  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3',
      },
      language_info: {
        name: 'python',
        version: pythonVersion,
      },
    },
    cells: [
      buildMetadataMarkdownCell(input),
      buildPipInstallCell(input.environment?.packages),
      buildDatasetDownloadCell(input.spec),
      buildVerbatimScriptCell(input.spec),
      buildMetricsDisplayCell(),
      buildCriteriaMarkdownCell(input.spec),
    ],
  }
}

/**
 * Builds the nbformat v4 JSON payload and metadata needed for `run_artifacts`
 * with `kind = 'notebook'`.
 */
export function buildNotebookArtifact(
  input: BuildNotebookInput,
  path = 'reproducibility-record.ipynb',
): NotebookArtifactPayload {
  const notebook = buildNotebookDocument(input)
  const content = JSON.stringify(notebook, null, 2)
  const buf = Buffer.from(content, 'utf8')
  const sha256 = createHash('sha256').update(buf).digest('hex')

  return {
    kind: 'notebook',
    path,
    sha256,
    bytes: buf.byteLength,
    content,
    notebook,
  }
}

export async function saveNotebookArtifact(
  db: Pick<Database, 'insert'>,
  runId: string,
  input: BuildNotebookInput,
  path = 'reproducibility-record.ipynb',
): Promise<{ id: string } & NotebookArtifactPayload> {
  const artifact = buildNotebookArtifact(input, path)
  const [row] = await db
    .insert(runArtifacts)
    .values({
      runId,
      kind: artifact.kind,
      path: artifact.path,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
      content: artifact.content,
    })
    .returning({ id: runArtifacts.id })

  if (!row) {
    throw new Error('run_artifacts insert returned no row')
  }

  return { id: row.id, ...artifact }
}
