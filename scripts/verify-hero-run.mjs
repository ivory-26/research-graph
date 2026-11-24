#!/usr/bin/env node

/**
 * Reproducible verification script for the hero experiment run (docs/04-experiment-runtime.md).
 *
 * Verifies that HERO_EXPERIMENT_SPEC_RUN_A reproduces Strobl et al. 2007's RF impurity bias
 * when executed against the pinned container runtime:
 * 1. Fetches breast-w.arff from OpenML 52350 and verifies sha256 checksum (19,177 bytes).
 * 2. Writes main.py directly from HERO_EXPERIMENT_SPEC_RUN_A.files['main.py'].
 * 3. Checks Docker availability and executes the container run command verbatim per docs/04:201-207.
 * 4. Ensures /output is writable by container user 10001 (chmodSync 0o777).
 * 5. Validates /output/metrics.json, verifies criteria via evaluateExperiment, and asserts
 *    stdout, python version, and installed packages against HERO_RECORDED_RUN_RESULT.
 */

import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { HERO_EXPERIMENT_SPEC_RUN_A, HERO_RECORDED_RUN_RESULT } from '../fixtures/hero-spec.ts'
import { evaluateExperiment } from '../src/server/evaluate-verdict.ts'

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

  try {
    mkdirSync(dataDir, { recursive: true })
    mkdirSync(outDir, { recursive: true })
    chmodSync(outDir, 0o777)

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

    // Compare stdout computed line against reference record
    const computedStdoutLine = stdout.split('\n').find((l) => l.startsWith('Computed metrics:'))?.trim()
    const expectedStdoutLine = HERO_RECORDED_RUN_RESULT.stdout.split('\n').find((l) => l.startsWith('Computed metrics:'))?.trim()
    if (!computedStdoutLine || computedStdoutLine !== expectedStdoutLine) {
      throw new Error(
        `Output stdout does not match reference record!\nExpected: ${expectedStdoutLine}\nGot: ${computedStdoutLine}`
      )
    }
    console.log('   Stdout matches reference record.')

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

    // Step 6: Verify environment (python version and pinned packages) from container
    console.log('5. Verifying container environment (python and pinned packages)...')
    const pythonVersion = execSync(`docker run --rm ${IMAGE_NAME} python --version`, { encoding: 'utf-8' }).trim()
    console.log(`   Python version: ${pythonVersion}`)
    if (pythonVersion !== HERO_RECORDED_RUN_RESULT.environment.python) {
      throw new Error(
        `Python version mismatch! Expected ${HERO_RECORDED_RUN_RESULT.environment.python}, got ${pythonVersion}`
      )
    }

    const pipListRaw = execSync(`docker run --rm ${IMAGE_NAME} pip list --format=json`, { encoding: 'utf-8' }).trim()
    const installedPkgs = JSON.parse(pipListRaw)
    const pkgMap = Object.fromEntries(installedPkgs.map((p) => [p.name.toLowerCase(), p.version]))

    for (const [pkg, expectedVersion] of Object.entries(HERO_RECORDED_RUN_RESULT.environment.packages)) {
      const actualVersion = pkgMap[pkg.toLowerCase()]
      if (actualVersion !== expectedVersion) {
        throw new Error(
          `Package version mismatch for ${pkg}! Expected ${expectedVersion}, got ${actualVersion}`
        )
      }
      console.log(`   ${pkg}==${actualVersion} (verified against pinned package)`)
    }

    // Step 7: Evaluate criteria via evaluateExperiment
    const evaluated = evaluateExperiment(HERO_EXPERIMENT_SPEC_RUN_A, {
      exitCode: 0,
      stdout,
      stderr: '',
      metrics,
      artifacts: [],
      durationMs: measuredDurationMs,
      environment: {
        imageDigest: 'unknown',
        python: pythonVersion,
        packages: pkgMap,
        datasets: [
          {
            name: HERO_EXPERIMENT_SPEC_RUN_A.datasets[0].name,
            sha256,
            bytes: bytes.byteLength,
          },
        ],
        seeds: [42],
        startedAt: new Date(startTime).toISOString(),
      },
    })

    console.log(`6. Criteria Evaluation:`)
    console.log(`   Verdict: ${evaluated.verdict.toUpperCase()}`)
    if (evaluated.verdict !== 'match') {
      throw new Error(`evaluateExperiment produced verdict '${evaluated.verdict}', expected 'match'`)
    }

    const expectedImpurity = HERO_RECORDED_RUN_RESULT.metrics.rank_impurity_noise_20
    const expectedPerm = HERO_RECORDED_RUN_RESULT.metrics.rank_permutation_noise_20
    if (metrics.rank_impurity_noise_20 !== expectedImpurity || metrics.rank_permutation_noise_20 !== expectedPerm) {
      throw new Error(
        `Measured metrics differ from HERO_RECORDED_RUN_RESULT! ` +
        `Measured: (impurity=${metrics.rank_impurity_noise_20}, perm=${metrics.rank_permutation_noise_20}), ` +
        `Recorded: (impurity=${expectedImpurity}, perm=${expectedPerm})`
      )
    }

    console.log(`   Duration: ${measuredDurationMs}ms`)
    console.log('=== Verification successful ===')

    return {
      metrics,
      durationMs: measuredDurationMs,
      stdout,
    }
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {}
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
