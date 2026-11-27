#!/usr/bin/env node

/**
 * Reproducible verification script for the hero experiment run (docs/04-experiment-runtime.md).
 *
 * What this verifies, in the hardened local Docker path:
 *
 * 1. The pinned dataset is fetched app-side and matches `HERO_EXPERIMENT_SPEC_RUN_A`'s
 *    sha256 and byte count.
 * 2. The approved spec parameters travel to the Python entrypoint as JSON in
 *    `RESEARCHGRAPH_PARAMETERS`. Each container receives the JSON as one Docker `-e`
 *    argument through `spawnSync`'s argument array; no shell is involved.
 * 3. Run A executes the approved parameters (`importance_method = impurity`) in a fresh
 *    workspace and fresh output directory.
 * 4. Run B executes the one-leaf what-if (`importance_method = permutation`) in a
 *    separate fresh workspace and fresh output directory. Only that leaf differs from
 *    the approved spec.
 * 5. An invalid `importance_method` exits non-zero and writes neither `/output/metrics.json`
 *    nor `/output/importance.csv`. A silent success with no metrics is a failure.
 * 6. Both valid runs still write `rank_impurity_noise_20` and
 *    `rank_permutation_noise_20`. Both ranks are compared with
 *    `HERO_RECORDED_RUN_RESULT.metrics`, and `evaluateExperiment` must return `match`
 *    (the spec criteria are unchanged for both runs).
 * 7. The real `/output/importance.csv` artifact contains the selected method's complete
 *    ranking with the header `method,feature,rank,importance`. Ranks are contiguous
 *    1..N, sorted ascending, importances non-increasing, and the 20-level noise row is
 *    at the rank the run measured for that method.
 * 8. The two valid runs are not metric-identical. The seed requires a genuinely distinct
 *    Run B (`RUNS_NOT_DISTINCT`); the selected rank must therefore be reported as a
 *    numeric metric in addition to the two existing rank metrics.
 *
 * The recorded stdout string is logged but not byte-compared: the runtime change that
 * adds the selected metric necessarily changes the printed dict. The measured
 * `/output/metrics.json` values are the authoritative comparison, and both rank metrics
 * are still checked exactly against `HERO_RECORDED_RUN_RESULT`.
 *
 * Usage: `pnpm verify:hero` (or `node scripts/verify-hero-run.mjs`) with a running Docker
 * daemon and the `researchgraph-python:locked` image built from `Dockerfile.template`.
 */

import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  HERO_EXPERIMENT_SPEC_RUN_A,
  HERO_RECORDED_RUN_RESULT,
} from '../fixtures/hero-spec.ts'
import { evaluateExperiment } from '../src/server/evaluate-verdict.ts'

const SPEC = HERO_EXPERIMENT_SPEC_RUN_A
const RECORDED = HERO_RECORDED_RUN_RESULT
const IMAGE_NAME = SPEC.image
const DATASET = SPEC.datasets[0]
const APPROVED_METHOD = 'impurity'
const PERMUTATION_METHOD = 'permutation'
const INVALID_METHOD = 'invalid-importance-method'
const METRICS_JSON = 'metrics.json'
const IMPORTANCE_CSV = 'importance.csv'
const IMPORTANCE_CSV_HEADER = ['method', 'feature', 'rank', 'importance']
const DOCKER_TIMEOUT_MARGIN_MS = 30_000
const MAX_BUFFER = 16 * 1024 * 1024

/**
 * The hardening flags from docs/04-experiment-runtime.md:201-207 and ADR 0005.
 * `--network none` is the product invariant, not a tunable. `--memory=512m` is the
 * documented laptop-CPU limit; the E2B spec's `memoryMb` is a template property.
 */
const HARDENED_RUN_ARGS = [
  'run',
  '--rm',
  '--network',
  'none',
  '--cpus=1',
  '--memory=512m',
  '--pids-limit=64',
  '--read-only',
  '--cap-drop=ALL',
  '--security-opt=no-new-privileges',
  '--user=10001:10001',
  '--tmpfs',
  '/tmp:rw,size=64m',
]

function docker(args, timeoutMs) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  })

  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error(`docker ${args[0]} timed out after ${timeoutMs}ms`)
    }
    throw new Error(`failed to run docker ${args[0]}: ${result.error.message}`)
  }

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function assertDockerReady() {
  const info = docker(['info', '--format', '{{.ServerVersion}}'], 15_000)
  if (info.status !== 0) {
    throw new Error(
      `Docker is unavailable or the daemon is not running: ${(info.stderr || info.stdout).trim()}. ` +
        `Reproducible verification requires an active Docker daemon with the ${IMAGE_NAME} image.`,
    )
  }

  const image = docker(
    ['image', 'inspect', IMAGE_NAME, '--format', '{{.Id}}'],
    15_000,
  )
  if (image.status !== 0) {
    throw new Error(
      `Docker image ${IMAGE_NAME} is not available locally. Build it from Dockerfile.template ` +
        `before running pnpm verify:hero: ${(image.stderr || image.stdout).trim()}`,
    )
  }

  console.log(`   Docker ${info.stdout.trim()}, image ${image.stdout.trim()}`)
}

function resolveSandboxPath(root, sandboxPath) {
  if (typeof sandboxPath !== 'string' || sandboxPath.trim() === '') {
    throw new Error('the hero spec contains an empty sandbox path')
  }
  if (isAbsolute(sandboxPath) || /^[A-Za-z]:/.test(sandboxPath)) {
    throw new Error(
      `the hero spec path ${JSON.stringify(sandboxPath)} must be relative to the workspace`,
    )
  }

  const fullPath = resolve(root, sandboxPath)
  const relativePath = relative(root, fullPath)
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(
      `the hero spec path ${JSON.stringify(sandboxPath)} escapes the workspace`,
    )
  }
  return fullPath
}

function prepareRunWorkspace(runDir, datasetBytes) {
  if (!SPEC.files['main.py']) {
    throw new Error("missing 'main.py' in HERO_EXPERIMENT_SPEC_RUN_A.files")
  }

  const workspaceDir = join(runDir, 'workspace')
  const outputDir = join(runDir, 'output')
  mkdirSync(workspaceDir, { recursive: true })
  mkdirSync(outputDir, { recursive: true })
  // The container runs as 10001:10001. Docker Desktop bind mounts normally honour
  // this, but chmod keeps the path writable on hosts where the mount preserves
  // the directory mode. It is the same precaution the verifier used before.
  chmodSync(outputDir, 0o777)

  for (const [sandboxPath, source] of Object.entries(SPEC.files)) {
    if (typeof source !== 'string') {
      throw new Error(`the hero spec file ${JSON.stringify(sandboxPath)} is not text`)
    }
    const target = resolveSandboxPath(workspaceDir, sandboxPath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, source, 'utf8')
  }

  const datasetTarget = resolveSandboxPath(workspaceDir, DATASET.path)
  mkdirSync(dirname(datasetTarget), { recursive: true })
  writeFileSync(datasetTarget, datasetBytes)

  return { workspaceDir, outputDir }
}

function buildDockerRunArgs({ workspaceDir, outputDir, parameters }) {
  const entrypoint = SPEC.entrypoint.trim().split(/\s+/)
  if (entrypoint.length !== 2 || entrypoint[0] !== 'python') {
    throw new Error(
      `unsupported hero entrypoint ${JSON.stringify(SPEC.entrypoint)}; expected "python <file>"`,
    )
  }

  const parameterJson = JSON.stringify(parameters)

  return [
    ...HARDENED_RUN_ARGS,
    // One Docker argv element. spawnSync does not invoke a shell, so the JSON is
    // never parsed as shell syntax and no host environment is copied into the
    // container beyond this explicitly named variable.
    '-e',
    `RESEARCHGRAPH_PARAMETERS=${parameterJson}`,
    '-v',
    `${workspaceDir}:/workspace:ro`,
    '-v',
    `${outputDir}:/output`,
    '--entrypoint',
    entrypoint[0],
    IMAGE_NAME,
    ...entrypoint.slice(1),
  ]
}

function executeSpec({ label, parameters, datasetBytes }) {
  const runDir = mkdtempSync(join(tmpdir(), `researchgraph-hero-${label}-`))
  const startedAt = new Date().toISOString()

  try {
    const { workspaceDir, outputDir } = prepareRunWorkspace(runDir, datasetBytes)
    const args = buildDockerRunArgs({ workspaceDir, outputDir, parameters })

    console.log(`   Parameters: ${JSON.stringify(parameters)}`)
    console.log(`   Workspace:  ${workspaceDir} (read-only)`)
    console.log(`   Output:     ${outputDir} (fresh)`)

    const started = Date.now()
    const result = docker(
      args,
      SPEC.timeoutSeconds * 1000 + DOCKER_TIMEOUT_MARGIN_MS,
    )
    const durationMs = Date.now() - started

    return {
      runDir,
      workspaceDir,
      outputDir,
      startedAt,
      durationMs,
      ...result,
    }
  } catch (error) {
    cleanupRunDir(runDir)
    throw error
  }
}

function cleanupRunDir(runDir) {
  try {
    rmSync(runDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  } catch (error) {
    // A failed cleanup must not mask the verification result.
    console.warn(
      `warning: could not remove temporary directory ${runDir}: ${error.message}`,
    )
  }
}

function readMetrics(outputDir, label) {
  const metricsPath = join(outputDir, METRICS_JSON)
  if (!existsSync(metricsPath)) {
    throw new Error(
      `${label}: /output/${METRICS_JSON} was not created. ` +
        `Per docs/04-experiment-runtime.md an absent metrics file fails the run regardless of exit code.`,
    )
  }

  const raw = readFileSync(metricsPath, 'utf8')
  let metrics
  try {
    metrics = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      `${label}: /output/${METRICS_JSON} is not valid JSON: ${error.message}\n${raw}`,
    )
  }

  if (metrics === null || typeof metrics !== 'object' || Array.isArray(metrics)) {
    throw new Error(`${label}: /output/${METRICS_JSON} must be a JSON object`)
  }
  for (const [name, value] of Object.entries(metrics)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(
        `${label}: metric ${JSON.stringify(name)} must be a finite number, got ${JSON.stringify(value)}`,
      )
    }
  }

  return metrics
}

/**
 * Strict parser for the deterministic importance artifact. Python's csv module emits
 * CRLF by default, so both CRLF and LF records are accepted. Quoted fields are
 * handled; duplicate or malformed columns are rejected rather than repaired.
 *
 * Exported for the local non-Docker parser check.
 */
export function parseImportanceCsv(text) {
  const input = text.replace(/^\uFEFF/, '')
  const records = []
  let record = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
      continue
    }
    if (char === ',') {
      record.push(field)
      field = ''
      continue
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && input[index + 1] === '\n') index += 1
      record.push(field)
      records.push(record)
      record = []
      field = ''
      continue
    }

    field += char
  }

  if (inQuotes) {
    throw new Error('/output/importance.csv has an unterminated quoted field')
  }
  if (field !== '' || record.length > 0) {
    record.push(field)
    records.push(record)
  }
  while (
    records.length > 0 &&
    records[records.length - 1].length === 1 &&
    records[records.length - 1][0] === ''
  ) {
    records.pop()
  }

  if (records.length === 0) {
    throw new Error('/output/importance.csv is empty')
  }

  const header = records[0]
  if (
    header.length !== IMPORTANCE_CSV_HEADER.length ||
    header.some((name, index) => name !== IMPORTANCE_CSV_HEADER[index])
  ) {
    throw new Error(
      `/output/importance.csv header must be exactly ${IMPORTANCE_CSV_HEADER.join(',')}; ` +
        `got ${header.join(',')}`,
    )
  }

  const rows = []
  for (let index = 1; index < records.length; index += 1) {
    const record = records[index]
    if (record.length !== IMPORTANCE_CSV_HEADER.length) {
      throw new Error(
        `/output/importance.csv row ${index + 1} has ${record.length} columns; expected ${IMPORTANCE_CSV_HEADER.length}`,
      )
    }

    const [method, feature, rankText, importanceText] = record
    if (method.trim() === '' || feature.trim() === '') {
      throw new Error(`/output/importance.csv row ${index + 1} has an empty method or feature`)
    }
    if (!/^[1-9]\d*$/.test(rankText)) {
      throw new Error(
        `/output/importance.csv row ${index + 1} has a non-integer rank ${JSON.stringify(rankText)}`,
      )
    }
    const rank = Number(rankText)
    if (!Number.isSafeInteger(rank)) {
      throw new Error(
        `/output/importance.csv row ${index + 1} has an unsafe rank ${JSON.stringify(rankText)}`,
      )
    }
    if (importanceText.trim() === '') {
      throw new Error(`/output/importance.csv row ${index + 1} has an empty importance`)
    }
    const importance = Number(importanceText)
    if (!Number.isFinite(importance)) {
      throw new Error(
        `/output/importance.csv row ${index + 1} has a non-numeric importance ${JSON.stringify(importanceText)}`,
      )
    }

    rows.push({ method, feature, rank, importance })
  }

  if (rows.length === 0) {
    throw new Error('/output/importance.csv has no data rows')
  }

  return { header, rows }
}

function nearlyEqual(left, right) {
  return Math.abs(left - right) <= Math.max(1e-12, Math.abs(right) * 1e-6)
}

function isNoise20Label(feature) {
  const normalized = feature.toLowerCase().replace(/[^a-z0-9]/g, '')
  return (
    normalized === 'noise20' ||
    normalized === 'noisec20' ||
    normalized.endsWith('noise20') ||
    normalized.endsWith('noisec20')
  )
}

/**
 * Proves that the CSV is the selected method's full deterministic ranking and that
 * the 20-level noise feature sits at the rank the run measured for that method.
 *
 * The noise row is identified by its feature label when possible (`noise_20`,
 * `noise_c20`, ...). If the runtime uses positional labels, the row is identified by
 * matching the measured `noise_20_*_importance` value; that fallback must be
 * unambiguous. No metric value is hardcoded here.
 *
 * Exported for the local non-Docker ranking check.
 */
export function assertImportanceRanking({ rows, method, metrics, label }) {
  for (const row of rows) {
    if (row.method !== method) {
      throw new Error(
        `${label}: /output/importance.csv row for ${JSON.stringify(row.feature)} has method ` +
          `${JSON.stringify(row.method)}, expected ${JSON.stringify(method)}`,
      )
    }
  }

  const seenFeatures = new Set()
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (seenFeatures.has(row.feature)) {
      throw new Error(
        `${label}: duplicate feature ${JSON.stringify(row.feature)} in /output/importance.csv`,
      )
    }
    seenFeatures.add(row.feature)

    if (row.rank !== index + 1) {
      throw new Error(
        `${label}: /output/importance.csv ranks must be contiguous 1..N sorted ascending; ` +
          `row ${index + 1} has rank ${row.rank}`,
      )
    }
    if (index > 0 && row.importance > rows[index - 1].importance) {
      throw new Error(
        `${label}: /output/importance.csv is not sorted by descending importance at rank ${row.rank}`,
      )
    }
  }

  const nFeatures = metrics.n_features
  if (
    !Number.isInteger(nFeatures) ||
    nFeatures !== rows.length
  ) {
    throw new Error(
      `${label}: /output/importance.csv has ${rows.length} rows but metrics.n_features is ` +
        `${JSON.stringify(nFeatures)}; the CSV must rank every feature`,
    )
  }

  const rankKey = `rank_${method}_noise_20`
  const measuredRank = metrics[rankKey]
  if (
    !Number.isInteger(measuredRank) ||
    measuredRank < 1 ||
    measuredRank > rows.length
  ) {
    throw new Error(
      `${label}: metrics.${rankKey} is ${JSON.stringify(measuredRank)}, not an integer rank in 1..${rows.length}`,
    )
  }

  const importanceKey =
    method === 'impurity'
      ? 'noise_20_gini_importance'
      : 'noise_20_perm_importance'
  const measuredImportance = metrics[importanceKey]
  if (measuredImportance !== undefined && !Number.isFinite(measuredImportance)) {
    throw new Error(
      `${label}: metrics.${importanceKey} is not finite: ${JSON.stringify(measuredImportance)}`,
    )
  }

  const byLabel = rows.filter((row) => isNoise20Label(row.feature))
  let noiseRow

  if (byLabel.length === 1) {
    noiseRow = byLabel[0]
    if (
      measuredImportance !== undefined &&
      !nearlyEqual(noiseRow.importance, measuredImportance)
    ) {
      throw new Error(
        `${label}: /output/importance.csv ${JSON.stringify(noiseRow.feature)} importance ` +
          `${noiseRow.importance} does not match metrics.${importanceKey} ${measuredImportance}`,
      )
    }
  } else if (byLabel.length > 1) {
    throw new Error(
      `${label}: /output/importance.csv has multiple noise_20-like feature labels: ` +
        byLabel.map((row) => JSON.stringify(row.feature)).join(', '),
    )
  } else if (measuredImportance !== undefined) {
    const byValue = rows.filter((row) =>
      nearlyEqual(row.importance, measuredImportance),
    )
    if (byValue.length !== 1) {
      throw new Error(
        `${label}: cannot identify the noise_20 row in /output/importance.csv: ` +
          `${byValue.length} rows match metrics.${importanceKey}=${measuredImportance}. ` +
          `Use a stable feature label such as noise_20.`,
      )
    }
    noiseRow = byValue[0]
  } else {
    throw new Error(
      `${label}: cannot identify the noise_20 row in /output/importance.csv; ` +
        `use a stable feature label such as noise_20`,
    )
  }

  const rowAtMeasuredRank = rows[measuredRank - 1]
  if (noiseRow.rank !== measuredRank) {
    throw new Error(
      `${label}: /output/importance.csv puts ${JSON.stringify(noiseRow.feature)} at rank ` +
        `${noiseRow.rank}, but metrics.${rankKey} is ${measuredRank}; the CSV does not contain the selected ranking`,
    )
  }
  if (rowAtMeasuredRank !== noiseRow) {
    throw new Error(
      `${label}: rank ${measuredRank} belongs to ${JSON.stringify(rowAtMeasuredRank.feature)}, ` +
        `not ${JSON.stringify(noiseRow.feature)}`,
    )
  }

  // The runtime reports the selected rank separately so Run A and Run B have
  // distinct metrics. When present, it must agree with the artifact it selected.
  const selectedRank = metrics.rank_noise_20
  if (selectedRank !== undefined) {
    if (!Number.isInteger(selectedRank) || selectedRank !== noiseRow.rank) {
      throw new Error(
        `${label}: metrics.rank_noise_20 is ${JSON.stringify(selectedRank)}, but ` +
          `/output/importance.csv puts ${JSON.stringify(noiseRow.feature)} at rank ${noiseRow.rank}`,
      )
    }
  }

  return {
    rowCount: rows.length,
    noiseRow,
    measuredRank,
    measuredImportance,
    selectedRank,
  }
}

function verifyRecordedRanks(metrics, label) {
  const expectedImpurity = RECORDED.metrics.rank_impurity_noise_20
  const expectedPermutation = RECORDED.metrics.rank_permutation_noise_20

  if (
    metrics.rank_impurity_noise_20 !== expectedImpurity ||
    metrics.rank_permutation_noise_20 !== expectedPermutation
  ) {
    throw new Error(
      `${label}: measured ranks differ from HERO_RECORDED_RUN_RESULT. ` +
        `Measured (impurity=${metrics.rank_impurity_noise_20}, permutation=${metrics.rank_permutation_noise_20}); ` +
        `recorded (impurity=${expectedImpurity}, permutation=${expectedPermutation})`,
    )
  }
}

function verifyVerdict({ metrics, execution, environment, label }) {
  const evaluated = evaluateExperiment(SPEC, {
    exitCode: execution.status ?? 1,
    stdout: execution.stdout,
    stderr: execution.stderr,
    metrics,
    artifacts: [],
    durationMs: execution.durationMs,
    environment,
  })

  if (evaluated.verdict !== 'match') {
    const checks = evaluated.detail.checks
      .map(
        (check) =>
          `${check.metric} ${check.op} ${check.threshold}: ` +
          `${check.passed ? 'pass' : 'fail'} (measured ${check.measured})`,
      )
      .join('; ')
    throw new Error(
      `${label}: evaluateExperiment produced verdict '${evaluated.verdict}', expected 'match'. ${checks}`,
    )
  }

  return evaluated
}

function verifyImageEnvironment() {
  console.log('3. Verifying the pinned container environment...')

  const python = docker(
    [...HARDENED_RUN_ARGS, IMAGE_NAME, 'python', '--version'],
    30_000,
  )
  if (python.status !== 0) {
    throw new Error(
      `could not read the container Python version: ${(python.stderr || python.stdout).trim()}`,
    )
  }
  const pythonVersion = (python.stdout || python.stderr).trim()
  console.log(`   Python: ${pythonVersion}`)
  if (pythonVersion !== RECORDED.environment.python) {
    throw new Error(
      `Python version mismatch! Expected ${RECORDED.environment.python}, got ${pythonVersion}`,
    )
  }

  const pip = docker(
    [...HARDENED_RUN_ARGS, IMAGE_NAME, 'pip', 'list', '--format=json'],
    30_000,
  )
  if (pip.status !== 0) {
    throw new Error(
      `could not read the container package list: ${(pip.stderr || pip.stdout).trim()}`,
    )
  }

  let installedPackages
  try {
    installedPackages = JSON.parse(pip.stdout)
  } catch (error) {
    throw new Error(`pip list did not return valid JSON: ${error.message}\n${pip.stdout}`)
  }
  if (!Array.isArray(installedPackages)) {
    throw new Error('pip list did not return a JSON array')
  }

  const packageMap = Object.fromEntries(
    installedPackages.map((entry) => [
      String(entry.name).toLowerCase(),
      String(entry.version),
    ]),
  )

  for (const [name, expectedVersion] of Object.entries(
    RECORDED.environment.packages,
  )) {
    const actualVersion = packageMap[name.toLowerCase()]
    if (actualVersion !== expectedVersion) {
      throw new Error(
        `Package version mismatch for ${name}! Expected ${expectedVersion}, got ${actualVersion}`,
      )
    }
    console.log(`   ${name}==${actualVersion} (matches the recorded environment)`)
  }

  return { pythonVersion, packageMap }
}

function approvedParameters() {
  if (SPEC.parameters.importance_method !== APPROVED_METHOD) {
    throw new Error(
      `the approved hero spec must use importance_method=${JSON.stringify(APPROVED_METHOD)}; ` +
        `got ${JSON.stringify(SPEC.parameters.importance_method)}`,
    )
  }
  return { ...SPEC.parameters }
}

/**
 * Derives Run B's parameters as the approved object with exactly one leaf changed.
 * This is the structural contract the what-if branch records; it must never quietly
 * alter n_estimators, the seed, or any other approved value.
 */
export function parametersWithOnlyImportanceMethod(method) {
  const parameters = { ...SPEC.parameters, importance_method: method }
  const changedKeys = Object.keys(parameters).filter(
    (key) => parameters[key] !== SPEC.parameters[key],
  )
  if (
    changedKeys.length !== 1 ||
    changedKeys[0] !== 'importance_method'
  ) {
    throw new Error(
      `deriving parameters for ${JSON.stringify(method)} changed ` +
        `${changedKeys.join(', ') || 'nothing'}; expected only importance_method`,
    )
  }
  return parameters
}

function buildRunEnvironment({
  pythonVersion,
  packageMap,
  datasetSha256,
  datasetBytes,
  parameters,
  startedAt,
}) {
  const seed = parameters.seed
  return {
    imageDigest: 'unknown',
    python: pythonVersion,
    packages: packageMap,
    datasets: [
      {
        name: DATASET.name,
        sha256: datasetSha256,
        bytes: datasetBytes,
      },
    ],
    seeds:
      typeof seed === 'number' && Number.isFinite(seed) ? [seed] : [],
    startedAt,
  }
}

function runValidMethod({
  method,
  parameters,
  datasetBytes,
  datasetSha256,
  pythonVersion,
  packageMap,
  step,
}) {
  const label = `Run ${method === APPROVED_METHOD ? 'A' : 'B'} (${method})`
  console.log(`${step}. ${label} in a fresh output directory...`)

  const execution = executeSpec({
    label: method,
    parameters,
    datasetBytes,
  })

  try {
    if (execution.status !== 0) {
      throw new Error(
        `${label}: container exited with code ${execution.status}.\n` +
          `stdout:\n${execution.stdout}\nstderr:\n${execution.stderr}`,
      )
    }

    console.log(`   Exit: ${execution.status} (${execution.durationMs}ms)`)
    if (execution.stdout.trim() !== '') {
      console.log(`   stdout: ${execution.stdout.trim()}`)
    }
    if (execution.stderr.trim() !== '') {
      console.log(`   stderr: ${execution.stderr.trim()}`)
    }

    const metrics = readMetrics(execution.outputDir, label)
    console.log(`   Metrics: ${JSON.stringify(metrics)}`)

    // Both existing ranks are regression assertions against the recorded run.
    verifyRecordedRanks(metrics, label)

    const environment = buildRunEnvironment({
      pythonVersion,
      packageMap,
      datasetSha256,
      datasetBytes,
      parameters,
      startedAt: execution.startedAt,
    })
    const evaluated = verifyVerdict({
      metrics,
      execution,
      environment,
      label,
    })
    console.log(`   Verdict: ${evaluated.verdict.toUpperCase()}`)

    const csvPath = join(execution.outputDir, IMPORTANCE_CSV)
    if (!existsSync(csvPath)) {
      throw new Error(
        `${label}: /output/${IMPORTANCE_CSV} was not created. ` +
          `The hero script must write the selected ranking to /output/${IMPORTANCE_CSV}.`,
      )
    }
    let csvBytes
    let csv
    try {
      csvBytes = readFileSync(csvPath)
      csv = parseImportanceCsv(csvBytes.toString('utf8'))
    } catch (error) {
      throw new Error(`${label}: ${error.message}`)
    }
    const csvSha256 = createHash('sha256').update(csvBytes).digest('hex')
    const ranking = assertImportanceRanking({
      rows: csv.rows,
      method,
      metrics,
      label,
    })

    console.log(
      `   /output/${IMPORTANCE_CSV}: ${ranking.rowCount} rows, ` +
        `${ranking.noiseRow.feature} rank=${ranking.noiseRow.rank}, ` +
        `importance=${ranking.noiseRow.importance}, sha256=${csvSha256}`,
    )

    return {
      method,
      parameters,
      metrics,
      verdict: evaluated.verdict,
      csvSha256,
      csvRows: ranking.rowCount,
      noiseFeature: ranking.noiseRow.feature,
      noiseRank: ranking.noiseRow.rank,
      noiseImportance: ranking.noiseRow.importance,
    }
  } finally {
    cleanupRunDir(execution.runDir)
  }
}

function runInvalidMethod({ parameters, datasetBytes, step }) {
  console.log(`${step}. Invalid importance_method must fail...`)

  const execution = executeSpec({
    label: 'invalid',
    parameters,
    datasetBytes,
  })

  try {
    const metricsPath = join(execution.outputDir, METRICS_JSON)
    const csvPath = join(execution.outputDir, IMPORTANCE_CSV)

    console.log(`   Exit: ${execution.status} (${execution.durationMs}ms)`)
    if (execution.stderr.trim() !== '') {
      const stderrLines = execution.stderr
        .trim()
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '')
      console.log(`   stderr: ${stderrLines[stderrLines.length - 1]}`)
    }

    if (execution.status === 0) {
      throw new Error(
        `invalid importance_method ${JSON.stringify(parameters.importance_method)} was accepted ` +
          `(exit 0); the script must reject unknown methods`,
      )
    }
    if (execution.status === null) {
      throw new Error(
        `the invalid-method container was killed before exiting: ${execution.stderr.trim()}`,
      )
    }
    if ([125, 126, 127].includes(execution.status)) {
      throw new Error(
        `the container did not run the entrypoint (exit ${execution.status}); ` +
          `docker stderr: ${execution.stderr.trim()}`,
      )
    }
    if (existsSync(csvPath)) {
      throw new Error(
        `invalid importance_method wrote /output/${IMPORTANCE_CSV}; it must fail before ` +
          `producing a selected ranking`,
      )
    }
    if (existsSync(metricsPath)) {
      throw new Error(
        `invalid importance_method wrote /output/${METRICS_JSON}; it must fail before ` +
          `producing metrics`,
      )
    }

    console.log('   Rejected with no metrics and no importance artifact.')
    return {
      parameters,
      exitCode: execution.status,
      stderr: execution.stderr.trim(),
    }
  } finally {
    cleanupRunDir(execution.runDir)
  }
}

function canonicalMetrics(metrics) {
  return JSON.stringify(
    Object.keys(metrics)
      .sort()
      .map((key) => [key, metrics[key]]),
  )
}

function assertRunsDistinct(runA, runB) {
  if (canonicalMetrics(runA.metrics) === canonicalMetrics(runB.metrics)) {
    throw new Error(
      'Run A and Run B produced identical metrics. The what-if parameter must be consumed: ' +
        'the hero script must additionally report the selected rank as a numeric metric ' +
        '(for example rank_noise_20) while keeping rank_impurity_noise_20 and ' +
        'rank_permutation_noise_20 unchanged. Without that, the seed fails with RUNS_NOT_DISTINCT.',
    )
  }
}

async function fetchPinnedDataset() {
  if (!DATASET) {
    throw new Error('HERO_EXPERIMENT_SPEC_RUN_A has no dataset')
  }
  if (DATASET.sha256 === null || DATASET.bytes === null) {
    throw new Error(
      `the hero dataset ${JSON.stringify(DATASET.name)} is not pinned (sha256/bytes are null)`,
    )
  }

  console.log(`1. Fetching the pinned dataset from ${DATASET.url}...`)

  let response
  try {
    response = await fetch(DATASET.url, { signal: AbortSignal.timeout(30_000) })
  } catch (error) {
    throw new Error(`failed to fetch ${DATASET.url}: ${error.message}`)
  }
  if (!response.ok) {
    throw new Error(`failed to fetch ${DATASET.url}: HTTP ${response.status}`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  console.log(`   Bytes:  ${bytes.byteLength} (expected ${DATASET.bytes})`)
  console.log(`   SHA256: ${sha256}`)

  if (sha256 !== DATASET.sha256 || bytes.byteLength !== DATASET.bytes) {
    throw new Error(
      `dataset pin mismatch! Expected (${DATASET.sha256}, ${DATASET.bytes}), ` +
        `got (${sha256}, ${bytes.byteLength})`,
    )
  }
  console.log('   Checksum and byte count match the pinned DatasetRef.')

  return { bytes, sha256 }
}

export async function runHeroVerification() {
  console.log('=== ResearchGraph Hero Spec Verification ===')
  console.log(`Image: ${IMAGE_NAME}`)
  console.log(
    `Spec: ${SPEC.claimNodeId} (${SPEC.mode}); approved importance_method=` +
      `${JSON.stringify(SPEC.parameters.importance_method)}`,
  )

  if (SPEC.datasets.length !== 1) {
    throw new Error(
      `expected exactly one hero dataset, found ${SPEC.datasets.length}`,
    )
  }
  if (SPEC.parameters.importance_method !== APPROVED_METHOD) {
    throw new Error(
      `the approved hero spec must use importance_method=${JSON.stringify(APPROVED_METHOD)}; ` +
        `got ${JSON.stringify(SPEC.parameters.importance_method)}`,
    )
  }

  const { bytes, sha256 } = await fetchPinnedDataset()

  console.log('2. Checking Docker availability and the pinned image...')
  assertDockerReady()

  const { pythonVersion, packageMap } = verifyImageEnvironment()

  const runA = runValidMethod({
    method: APPROVED_METHOD,
    parameters: approvedParameters(),
    datasetBytes: bytes,
    datasetSha256: sha256,
    pythonVersion,
    packageMap,
    step: 4,
  })

  const runB = runValidMethod({
    method: PERMUTATION_METHOD,
    parameters: parametersWithOnlyImportanceMethod(PERMUTATION_METHOD),
    datasetBytes: bytes,
    datasetSha256: sha256,
    pythonVersion,
    packageMap,
    step: 5,
  })

  console.log('6. Comparing Run A and Run B metrics...')
  assertRunsDistinct(runA, runB)
  console.log('   The selected parameter changes the measured metrics.')

  const invalid = runInvalidMethod({
    parameters: parametersWithOnlyImportanceMethod(INVALID_METHOD),
    datasetBytes: bytes,
    step: 7,
  })

  console.log('=== Verification successful ===')

  return {
    dataset: { name: DATASET.name, sha256, bytes: bytes.byteLength },
    environment: { python: pythonVersion, packages: packageMap },
    runs: [runA, runB],
    invalid,
  }
}

const isDirectCli =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectCli) {
  runHeroVerification().catch((error) => {
    console.error(
      'Verification failed:',
      error instanceof Error ? error.message : error,
    )
    process.exitCode = 1
  })
}
