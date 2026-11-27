import { createHash } from 'node:crypto'
import type { Database } from '../db/client'
import { runArtifacts } from '../db/schema'
import { buildParameterEnvironmentSource } from '../shared/notebook-parameters'
import type {
  CriteriaOp,
  ExperimentSpec,
  ReportedValue,
  RunEnvironment,
  Verdict,
} from '../shared/types'
import { extractEntrypointFile } from './planner'
import {
  ALLOWED_DATASET_DOMAINS,
  MAX_DATASET_BYTES,
  SANDBOX_METRICS_PATH,
} from './runner'

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
      version?: string
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

const TOOLING_PACKAGES = new Set([
  'pip',
  'setuptools',
  'wheel',
  'distribute',
  'pkg-resources',
])

/**
 * Converts text into nbformat's array of newline-terminated strings, preserving
 * the script's original line endings (CRLF or LF) verbatim to satisfy reproducibility.
 */
function toNbformatLines(text: string): string[] {
  if (text.length === 0) return []
  const matched = text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)
  if (!matched) return [text]
  if (matched.length > 0 && matched[matched.length - 1] === '') {
    matched.pop()
  }
  return matched
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
  const compStr = reported.comparator ? formatOp(reported.comparator) : null
  const comparisonSuffix =
    reported.against !== null
      ? compStr
        ? ` (${compStr} ${reported.against})`
        : ` (against ${reported.against})`
      : ''
  const valueStr =
    reported.value === null
      ? `null (qualitative)${comparisonSuffix}`
      : `${reported.value}${comparisonSuffix}`
  return `\`${reported.metric}\` = ${valueStr} — "${reported.quote}"`
}

function buildMetadataMarkdownCell(input: BuildNotebookInput): NbformatMarkdownCell {
  const title = input.paperTitle?.trim() || 'Reproducibility Record'
  const doi = input.doi?.trim() || 'N/A'
  const pageSuffix =
    typeof input.claim.page === 'number' ? ` (p. ${input.claim.page})` : ''
  const verdictStr = input.verdict
    ? `\`${input.verdict}\``
    : 'not evaluated (specification preview)'

  const lines = [
    `# Reproducibility Record: ${title}`,
    '',
    `- **Paper:** ${title}`,
    `- **DOI:** \`${doi}\``,
    `- **Claim:** ${input.claim.text}`,
    `- **Claim Quote${pageSuffix}:** "${input.claim.quote}"`,
    `- **Reported Value:** ${formatReportedValue(input.claim.reported)}`,
    `- **Mode:** \`${input.spec.mode}\``,
    `- **Verdict:** ${verdictStr}`,
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
): NbformatCodeCell | null {
  if (!packages || Object.keys(packages).length === 0) {
    return null
  }

  const filtered: Record<string, string> = {}
  const unknownPackages: string[] = []
  for (const [pkg, ver] of Object.entries(packages)) {
    if (pkg.startsWith('__') || TOOLING_PACKAGES.has(pkg.toLowerCase())) {
      continue
    }
    if (!ver || ver === 'unknown') {
      unknownPackages.push(pkg)
      continue
    }
    filtered[pkg] = ver
  }

  if (Object.keys(filtered).length === 0) {
    throw new Error(
      'Cannot build notebook dependencies install cell: no valid package versions found in environment.packages (if pip list failed during run execution, a valid reproducible notebook cannot be built)',
    )
  }

  const pkgArgs = Object.entries(filtered)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([pkg, ver]) => `"${pkg}==${ver}"`)
    .join(' ')

  const codeLines = ['# Install pinned runtime dependencies from run environment']
  if (unknownPackages.length > 0) {
    codeLines.push(
      `# Note: omitted packages with unknown version: ${unknownPackages.sort().join(', ')}`,
    )
  }
  codeLines.push(`!pip install -q ${pkgArgs}`)

  return {
    cell_type: 'code',
    id: 'cell-2-dependencies',
    execution_count: null,
    metadata: {},
    outputs: [],
    source: toNbformatLines(codeLines.join('\n')),
  }
}

function buildDatasetDownloadCell(
  spec: ExperimentSpec,
  environment?: Partial<RunEnvironment> | null,
): NbformatCodeCell {
  const lines: string[] = [
    '# Download datasets and verify SHA-256 checksums',
    'import hashlib',
    'import ipaddress',
    'import pathlib',
    'import time',
    'import urllib.parse',
    'import urllib.request',
    '',
    `ALLOWED_DATASET_DOMAINS = tuple(${JSON.stringify(ALLOWED_DATASET_DOMAINS)})`,
    '',
    'def validate_dataset_url(url_str: str) -> None:',
    '    parsed = urllib.parse.urlparse(url_str)',
    "    if parsed.scheme not in ('http', 'https'):",
    '        raise ValueError(f"Dataset URL protocol must be http or https, got {parsed.scheme!r}")',
    '    host = (parsed.hostname or "").lower()',
    '    if not host or host == "localhost" or host.endswith((".localhost", ".local", ".internal")):',
    '        raise ValueError(f"Dataset URL host {host!r} is disallowed (SSRF protection)")',
    '    try:',
    '        ip = ipaddress.ip_address(host.strip("[]"))',
    '    except ValueError:',
    '        ip = None',
    '    if ip is not None and (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_unspecified or ip.is_reserved):',
    '        raise ValueError(f"Dataset URL IP {host!r} is forbidden (SSRF protection)")',
    '    if not any(host == d or host.endswith("." + d) for d in ALLOWED_DATASET_DOMAINS):',
    '        raise ValueError(f"Dataset host {host!r} is not in ALLOWED_DATASET_DOMAINS")',
    '',
    'class SafeDatasetRedirectHandler(urllib.request.HTTPRedirectHandler):',
    '    def __init__(self, max_redirects: int = 3) -> None:',
    '        self.max_redirects = max_redirects',
    '        self._redirects = 0',
    '    def redirect_request(self, req, fp, code, msg, headers, newurl):',
    '        self._redirects += 1',
    '        if self._redirects > self.max_redirects:',
    '            raise ValueError(f"Exceeded maximum redirects ({self.max_redirects})")',
    '        validate_dataset_url(newurl)',
    '        return super().redirect_request(req, fp, code, msg, headers, newurl)',
    '',
  ]

  if (spec.datasets.length === 0) {
    lines.push('print("No external datasets configured for this experiment.")')
  } else {
    const capMb = Math.round(MAX_DATASET_BYTES / (1024 * 1024))
    lines.push(`MAX_DOWNLOAD_BYTES = ${MAX_DATASET_BYTES}  # ${capMb} MiB cap matching runner.ts`)
    lines.push('DATASETS = [')
    for (const ref of spec.datasets) {
      const envSha =
        environment?.datasets?.find((d) => d.name === ref.name)?.sha256 ?? null
      const sha256ToUse = ref.sha256 ?? envSha
      lines.push(
        `    {"name": ${JSON.stringify(ref.name)}, "url": ${JSON.stringify(ref.url)}, "path": ${JSON.stringify(ref.path)}, "sha256": ${sha256ToUse ? JSON.stringify(sha256ToUse) : 'None'}, "max_bytes": ${typeof ref.bytes === 'number' ? ref.bytes : 'MAX_DOWNLOAD_BYTES'}},`,
      )
    }
    lines.push(']')
    lines.push('')
    lines.push('for ds in DATASETS:')
    lines.push('    validate_dataset_url(ds["url"])')
    lines.push('    dataset_opener = urllib.request.build_opener(SafeDatasetRedirectHandler(max_redirects=3))')
    lines.push('    dest = pathlib.Path(ds["path"])')
    lines.push('    if dest.is_absolute() or ".." in dest.parts:')
    lines.push('        raise ValueError(f"Disallowed traversal or absolute dataset path: {ds[\'path\']!r}")')
    lines.push('    dest.parent.mkdir(parents=True, exist_ok=True)')
    lines.push('    if not dest.exists():')
    lines.push('        limit = min(ds["max_bytes"], MAX_DOWNLOAD_BYTES)')
    lines.push('        total = 0')
    lines.push('        deadline = time.time() + 30')
    lines.push('        with dataset_opener.open(ds["url"], timeout=30) as resp, dest.open("wb") as out:')
    lines.push('            while True:')
    lines.push('                if time.time() > deadline:')
    lines.push('                    dest.unlink(missing_ok=True)')
    lines.push('                    raise TimeoutError(f"Download exceeded 30s wall-clock deadline for {ds[\'name\']}")')
    lines.push('                chunk = resp.read(65536)')
    lines.push('                if not chunk:')
    lines.push('                    break')
    lines.push('                total += len(chunk)')
    lines.push('                if total > limit:')
    lines.push('                    dest.unlink(missing_ok=True)')
    lines.push('                    raise ValueError(f"Download exceeded {limit} bytes cap for {ds[\'name\']}")')
    lines.push('                out.write(chunk)')
    lines.push('    actual_sha256 = hashlib.sha256(dest.read_bytes()).hexdigest()')
    lines.push('    expected_sha256 = ds["sha256"]')
    lines.push('    if expected_sha256 is not None:')
    lines.push('        if actual_sha256 != expected_sha256:')
    lines.push(
      '            raise ValueError(f"SHA-256 mismatch for {ds[\'name\']}: expected {expected_sha256}, got {actual_sha256}")',
    )
    lines.push(
      '        print(f"Verified {ds[\'name\']} at {dest} ({dest.stat().st_size} bytes, sha256={actual_sha256})")',
    )
    lines.push('    else:')
    lines.push(
      '        raise ValueError(f"Unpinned dataset {ds[\'name\']}: no SHA-256 digest recorded in spec or environment")',
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

function buildVerbatimScriptCell(spec: ExperimentSpec): NbformatCodeCell[] {
  const entrypointFile = extractEntrypointFile(spec.entrypoint)
  if (!entrypointFile) {
    throw new Error(`Invalid entrypoint "${spec.entrypoint}" in ExperimentSpec`)
  }

  const cells: NbformatCodeCell[] = []

  // If there are auxiliary files besides the entrypoint, write them to disk in separate cells
  const auxiliaryFiles = Object.entries(spec.files).filter(
    ([p]) => p !== entrypointFile,
  )
  for (const [filePath, content] of auxiliaryFiles) {
    const safeContent = JSON.stringify(content)
    const writeScript = [
      `# Auxiliary file: ${JSON.stringify(filePath)}`,
      'import pathlib',
      `target_path = pathlib.Path(${JSON.stringify(filePath)})`,
      'if target_path.is_absolute() or ".." in target_path.parts:',
      '    raise ValueError(f"Disallowed traversal or absolute path: {target_path}")',
      'target_path.parent.mkdir(parents=True, exist_ok=True)',
      `target_path.write_text(${safeContent}, encoding="utf-8")`,
      `print(f"Wrote {target_path} ({len(target_path.read_text())} characters)")`,
    ].join('\n')

    const shortHash = createHash('sha256')
      .update(filePath)
      .digest('hex')
      .slice(0, 8)
    const sanitizedName = filePath
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 30)
      .replace(/^_+|_+$/g, '')

    cells.push({
      cell_type: 'code',
      id: `cell-aux-${sanitizedName || 'file'}-${shortHash}`,
      execution_count: null,
      metadata: {},
      outputs: [],
      source: toNbformatLines(writeScript),
    })
  }

  // The script is verbatim, and the hero script reads this variable on one of
  // its first lines. The production runner supplies it; a notebook must too.
  cells.push({
    cell_type: 'code',
    id: 'cell-4-parameters',
    execution_count: null,
    metadata: {},
    outputs: [],
    source: toNbformatLines(
      buildParameterEnvironmentSource(spec.parameters),
    ),
  })

  const mainScript = spec.files[entrypointFile]
  if (typeof mainScript !== 'string') {
    throw new Error(
      `Entrypoint script "${entrypointFile}" not found in ExperimentSpec.files`,
    )
  }

  cells.push({
    cell_type: 'code',
    id: 'cell-5-script',
    execution_count: null,
    metadata: {},
    outputs: [],
    source: toNbformatLines(mainScript),
  })

  return cells
}

function buildMetricsDisplayCell(): NbformatCodeCell {
  const lines = [
    '# Read and display measured metrics',
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
    id: 'cell-6-metrics',
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
    `- **\`mismatch\`**: Exit code is \`0\` and all required metrics are present, but ${spec.criteria.mode === 'any' ? 'no required criterion passed' : 'one or more required criteria failed'}.`,
    '- **`inconclusive`**: `criteria.checks` is empty (regardless of exit code), or exit code is `0` and a criterion references a metric missing or non-finite (NaN/Infinity) from `/output/metrics.json`.',
    '- **`failed`**: Non-zero exit code, missing/unparseable `/output/metrics.json`, or sandbox timeout.',
  ]

  return {
    cell_type: 'markdown',
    id: 'cell-7-criteria',
    metadata: {},
    source: toNbformatLines(lines.join('\n')),
  }
}

/**
 * Builds an nbformat v4 document deterministically from the frozen ExperimentSpec
 * and run metadata (docs/04-experiment-runtime.md:236-249). Never calls a model.
 */
export function buildNotebookDocument(
  input: BuildNotebookInput,
): NbformatV4Document {
  const rawPy = input.environment?.python?.replace(/^Python\s+/i, '').trim()
  const languageInfo: NbformatV4Document['metadata']['language_info'] =
    rawPy && rawPy !== 'unknown'
      ? { name: 'python', version: rawPy }
      : { name: 'python' }

  const installCell = buildPipInstallCell(input.environment?.packages)

  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3',
      },
      language_info: languageInfo,
    },
    cells: [
      buildMetadataMarkdownCell(input),
      ...(installCell ? [installCell] : []),
      buildDatasetDownloadCell(input.spec, input.environment),
      ...buildVerbatimScriptCell(input.spec),
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

/** Persists an exported notebook artifact into the `run_artifacts` table. */
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
