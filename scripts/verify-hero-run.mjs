#!/usr/bin/env node

/**
 * Reproducible verification script for the hero experiment run (docs/04-experiment-runtime.md).
 *
 * Verifies that HERO_EXPERIMENT_SPEC_RUN_A reproduces Strobl et al. 2007's RF impurity bias
 * when executed against the pinned container runtime:
 * 1. Fetches breast-w.arff from OpenML 52350 and verifies sha256 checksum (19,177 bytes).
 * 2. Writes main.py directly from HERO_EXPERIMENT_SPEC_RUN_A.files['main.py'].
 * 3. Checks Docker availability and executes the container run command verbatim per docs/04:201-207.
 * 4. Validates /output/metrics.json, verifies criteria (rank_impurity <= 5, rank_permutation > 5),
 *    and compares measured values against HERO_RECORDED_RUN_RESULT.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import {
  HERO_EXPERIMENT_SPEC_RUN_A,
  HERO_RECORDED_RUN_RESULT,
  evaluateHeroRunMetrics,
} from '../fixtures/hero-spec.ts'

const DATASET_URL = HERO_EXPERIMENT_SPEC_RUN_A.datasets[0].url
const EXPECTED_DATASET_SHA256 = HERO_EXPERIMENT_SPEC_RUN_A.datasets[0].sha256
const EXPECTED_DATASET_BYTES = HERO_EXPERIMENT_SPEC_RUN_A.datasets[0].bytes
const IMAGE_NAME = 'researchgraph-python:locked'

export async function runHeroVerification() {
  console.log('=== ResearchGraph Hero Spec Verification ===')

  // Step 1: Pre-fetch dataset and verify pin
  console.log(`1. Fetching dataset from ${DATASET_URL}...`)
  const res = await fetch(DATASET_URL)
  if (!res.ok) {
    throw new Error(`Failed to fetch dataset: HTTP ${res.status}`)
  }
  const bytes = Buffer.from(await res.arrayBuffer())
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  console.log(`   Bytes: ${bytes.byteLength} (expected ${EXPECTED_DATASET_BYTES})`)
  console.log(`   SHA256: ${sha256}`)
  if (sha256 !== EXPECTED_DATASET_SHA256 || bytes.byteLength !== EXPECTED_DATASET_BYTES) {
    throw new Error(
      `Dataset checksum/bytes mismatch! Expected (${EXPECTED_DATASET_SHA256}, ${EXPECTED_DATASET_BYTES}), got (${sha256}, ${bytes.byteLength})`
    )
  }
  console.log('   Checksum matches pinned DatasetRef.')

  // Step 2: Check Docker availability
  console.log('2. Checking Docker daemon availability...')
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 10000 })
  } catch (err) {
    throw new Error(
      `Docker is unavailable or daemon is not running: ${err.message?.split('\n')[0]}. ` +
      `Reproducible verification requires an active Docker daemon with the ${IMAGE_NAME} image.`
    )
  }

  // Step 3: Prepare execution workspace
  const workDir = join(tmpdir(), `hero-run-${Date.now()}`)
  const dataDir = join(workDir, 'data')
  const outDir = join(workDir, 'output')
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(outDir, { recursive: true, mode: 0o777 })

  writeFileSync(join(dataDir, 'breast-w.arff'), bytes)

  const pythonScript = HERO_EXPERIMENT_SPEC_RUN_A.files['main.py']
  if (!pythonScript) {
    throw new Error("Missing 'main.py' in HERO_EXPERIMENT_SPEC_RUN_A.files")
  }
  writeFileSync(join(workDir, 'main.py'), pythonScript, 'utf-8')

  // Step 4: Execute container command with full hardening per docs/04:201-207
  const dockerCmd = [
    'docker run --rm',
    '--network none',
    '--cpus=1',
    '--memory=512m',
    '--pids-limit=64',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--user=10001:10001',
    '--tmpfs /tmp:rw,size=64m',
    `-v "${dataDir}:/workspace/data:ro"`,
    `-v "${join(workDir, 'main.py')}:/workspace/main.py:ro"`,
    `-v "${outDir}:/output"`,
    '--entrypoint python',
    IMAGE_NAME,
    'main.py',
  ].join(' ')

  console.log(`3. Executing container per docs/04:201-207:`)
  console.log(`   ${dockerCmd}`)

  const startTime = Date.now()
  let stdout = ''
  try {
    stdout = execSync(dockerCmd, { encoding: 'utf-8', timeout: 60000 })
    console.log(`   Stdout: ${stdout.trim()}`)
  } catch (err) {
    throw new Error(
      `Container execution failed with exit code ${err.status ?? 'unknown'}: ${err.stderr || err.message}`
    )
  }
  const measuredDurationMs = Date.now() - startTime

  // Step 5: Read and parse /output/metrics.json
  const metricsPath = join(outDir, 'metrics.json')
  if (!existsSync(metricsPath)) {
    throw new Error(`Execution completed, but /output/metrics.json was not created.`)
  }
  const metricsContent = readFileSync(metricsPath, 'utf-8')
  let metrics
  try {
    metrics = JSON.parse(metricsContent)
  } catch {
    throw new Error(`/output/metrics.json does not contain valid JSON: ${metricsContent}`)
  }
  console.log('4. Measured Metrics:', JSON.stringify(metrics, null, 2))

  // Step 6: Evaluate criteria and compare against reference fixture
  const evalResult = evaluateHeroRunMetrics(metrics)
  console.log('5. Criteria Evaluation:')
  console.log(`   rank_impurity_noise_20 <= 5: ${evalResult.satisfiesImpurity} (measured: ${evalResult.impurity})`)
  console.log(`   rank_permutation_noise_20 > 5: ${evalResult.satisfiesPermutation} (measured: ${evalResult.permutation})`)

  if (!evalResult.matchesClaim) {
    throw new Error(
      `Experiment criteria failed! Expected rank_impurity <= 5 and rank_permutation > 5, got (${evalResult.impurity}, ${evalResult.permutation})`
    )
  }

  const expectedImpurity = HERO_RECORDED_RUN_RESULT.metrics.rank_impurity_noise_20
  const expectedPerm = HERO_RECORDED_RUN_RESULT.metrics.rank_permutation_noise_20
  if (evalResult.impurity !== expectedImpurity || evalResult.permutation !== expectedPerm) {
    throw new Error(
      `Measured metrics differ from HERO_RECORDED_RUN_RESULT! ` +
      `Measured: (impurity=${evalResult.impurity}, perm=${evalResult.permutation}), ` +
      `Recorded: (impurity=${expectedImpurity}, perm=${expectedPerm})`
    )
  }

  console.log('   Verdict: MATCH (verified against claim and HERO_RECORDED_RUN_RESULT)')
  console.log(`   Duration: ${measuredDurationMs}ms`)

  try {
    rmSync(workDir, { recursive: true, force: true })
  } catch {}

  console.log('=== Verification successful ===')
  return {
    metrics,
    durationMs: measuredDurationMs,
    stdout,
  }
}

// When executed directly as CLI script
const isDirectCli = process.argv[1] && (
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')) ||
  process.argv[1].endsWith('verify-hero-run.mjs')
)

if (isDirectCli) {
  runHeroVerification().catch((err) => {
    console.error('Verification failed:', err.message)
    process.exit(1)
  })
}
