import type {
  CriteriaOp,
  ExperimentSpec,
  ReportedValue,
  RunEnvironment,
  Verdict,
} from './types'

export const SANDBOX_METRICS_PATH = '/output/metrics.json'

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

const TOOLING_PACKAGES = new Set([
  'pip',
  'setuptools',
  'wheel',
  'distribute',
  'pkg-resources',
])

/**
 * Normalizes CRLF to LF before splitting into nbformat line-terminated strings.
 * nbformat v4 stores `source` as a list of `\n`-terminated lines (no trailing `\n` on the last line).
 */
function toNbformatLines(text: string): string[] {
  if (text.length === 0) return []
  const normalized = text.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n')
  return parts.map((line, idx) => (idx < parts.length - 1 ? `${line}\n` : line))
}

function shortStableHexHash(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function extractEntrypointFile(entrypoint: string): string | null {
  const parts = entrypoint.trim().split(/\s+/)
  if (parts.length < 2) return null
  return parts[parts.length - 1] ?? null
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
  const compStr = reported.comparator ? formatOp(reported.comparator) : ''
  const valueStr =
    reported.value === null
      ? 'null (qualitative)'
      : `${reported.value}${compStr && reported.against !== null ? ` (${compStr} ${reported.against})` : ''}`
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
): NbformatCodeCell {
  if (!packages || Object.keys(packages).length === 0) {
    throw new Error(
      'Cannot build notebook dependencies install cell: run environment.packages is required to prevent unpinned drift',
    )
  }

  const filtered: Record<string, string> = {}
  for (const [pkg, ver] of Object.entries(packages)) {
    if (
      pkg.startsWith('__') ||
      TOOLING_PACKAGES.has(pkg.toLowerCase()) ||
      !ver ||
      ver === 'unknown'
    ) {
      continue
    }
    filtered[pkg] = ver
  }

  if (Object.keys(filtered).length === 0) {
    throw new Error(
      'Cannot build notebook dependencies install cell: no valid package versions found in environment.packages',
    )
  }

  const pkgArgs = Object.entries(filtered)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pkg, ver]) => `"${pkg}==${ver}"`)
    .join(' ')

  const code = [
    '# Install pinned runtime dependencies from run environment',
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
    '# Download datasets and verify SHA-256 checksums',
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
      '        print(f"Downloaded {ds[\'name\']} at {dest} ({dest.stat().st_size} bytes, unpinned sha256={actual_sha256})")',
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
      `# Auxiliary file: ${filePath}`,
      'import pathlib',
      `target_path = pathlib.Path(${JSON.stringify(filePath)})`,
      'target_path.parent.mkdir(parents=True, exist_ok=True)',
      `target_path.write_text(${safeContent}, encoding="utf-8")`,
      `print(f"Wrote {target_path} ({len(target_path.read_text())} characters)")`,
    ].join('\n')

    const shortHash = shortStableHexHash(filePath)
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

  const mainScript = spec.files[entrypointFile]
  if (typeof mainScript !== 'string') {
    throw new Error(
      `Entrypoint script "${entrypointFile}" not found in ExperimentSpec.files`,
    )
  }

  cells.push({
    cell_type: 'code',
    id: 'cell-4-script',
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
    `- **\`mismatch\`**: Exit code is \`0\` and all required metrics are present, but ${spec.criteria.mode === 'any' ? 'no required criterion passed' : 'one or more required criteria failed'}.`,
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
  const rawPy = input.environment?.python?.replace(/^Python\s+/i, '').trim()
  const languageInfo: NbformatV4Document['metadata']['language_info'] =
    rawPy && rawPy !== 'unknown'
      ? { name: 'python', version: rawPy }
      : { name: 'python' }

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
      buildPipInstallCell(input.environment?.packages),
      buildDatasetDownloadCell(input.spec),
      ...buildVerbatimScriptCell(input.spec),
      buildMetricsDisplayCell(),
      buildCriteriaMarkdownCell(input.spec),
    ],
  }
}
