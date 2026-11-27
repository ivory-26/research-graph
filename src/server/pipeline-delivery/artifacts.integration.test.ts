/**
 * `run_artifacts` persistence over a real Postgres database.
 *
 * The SQL, migrations, constraints and transaction are the real ones; no
 * runner is involved. The artifacts are built exactly as
 * `defaultCollectArtifacts` returns them (canonical base64 plus a sha256 and
 * byte count over the same bytes), so the verification path under test is the
 * path a completed E2B run exercises.
 *
 * Skipped unless `TEST_DATABASE_URL` is set. The URL names a *server*; the
 * harness creates a uniquely named, disposable database on it, migrates only
 * that database, and drops only that database. See `test-support/pg.ts`.
 */
import { createHash, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'

import { runArtifacts, runs } from '../../db/schema'
import type { RunStatus } from '../../shared/types'
import {
  MAX_INLINE_ARTIFACT_BYTES,
  RunArtifactError,
  saveRunArtifacts,
  type RunArtifactErrorCode,
  type RunArtifactInput,
} from './artifacts'
import {
  createTestDatabase,
  seedWorkspace,
  type SeededWorkspace,
  type TestDatabase,
} from './test-support/pg'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function runnerArtifact(
  path: string,
  bytes: Buffer,
  overrides: Partial<RunArtifactInput> = {},
): RunArtifactInput {
  return {
    path,
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
    content: bytes.toString('base64'),
    ...overrides,
  }
}

async function expectCode(
  promise: Promise<unknown>,
  code: RunArtifactErrorCode,
): Promise<void> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(RunArtifactError)
    expect((error as RunArtifactError).code).toBe(code)
    return
  }
  throw new Error(`expected a RunArtifactError with code ${code}`)
}

describeIntegration('run artifact persistence over real Postgres', () => {
  let testDb: TestDatabase
  let seed: SeededWorkspace

  beforeAll(async () => {
    testDb = await createTestDatabase(TEST_DATABASE_URL as string)
  })

  afterAll(async () => {
    await testDb.close()
  })

  beforeEach(async () => {
    await testDb.reset()
    seed = await seedWorkspace(testDb.pool)
  })

  async function insertRun(status: RunStatus = 'succeeded'): Promise<string> {
    const [row] = await testDb.db
      .insert(runs)
      .values({
        experimentId: seed.experimentId,
        attempt: 1,
        status,
        spec: seed.spec,
        parameters: seed.spec.parameters,
        environment: {
          imageDigest: 'sha256:test-image',
          python: 'Python 3.12.16',
          packages: {},
          datasets: [],
          seeds: [42],
          startedAt: '2026-11-25T12:00:00.000Z',
        },
      })
      .returning({ id: runs.id })

    return row.id
  }

  async function rowsFor(runId: string) {
    return testDb.db
      .select()
      .from(runArtifacts)
      .where(eq(runArtifacts.runId, runId))
      .orderBy(runArtifacts.path)
  }

  it('persists verified artifacts with their full metadata', async () => {
    const runId = await insertRun()
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const csv = Buffer.from('rank,importance\n1,0.4\n')

    const saved = await saveRunArtifacts(testDb.db, runId, [
      runnerArtifact('/output/importance.png', png),
      runnerArtifact('/output/ranks.csv', csv),
    ])

    expect(saved.inserted).toBe(2)
    expect(saved.existing).toBe(0)
    expect(saved.omitted).toEqual([])

    const rows = await rowsFor(runId)
    expect(rows.map((row) => row.path)).toEqual([
      '/output/importance.png',
      '/output/ranks.csv',
    ])
    expect(rows.map((row) => row.kind)).toEqual(['figure', 'table'])
    expect(rows[0]).toMatchObject({
      sha256: sha256(png),
      bytes: png.byteLength,
      content: png.toString('base64'),
    })
    expect(rows[1]).toMatchObject({
      sha256: sha256(csv),
      bytes: csv.byteLength,
      content: csv.toString('base64'),
    })
  })

  it('keeps metadata but stores no content when content is missing or too large', async () => {
    const runId = await insertRun()
    const small = Buffer.from('rank,importance\n1,0.4\n')
    const large = Buffer.alloc(MAX_INLINE_ARTIFACT_BYTES + 1, 0x61)

    const saved = await saveRunArtifacts(testDb.db, runId, [
      { path: '/output/small.csv', sha256: sha256(small), bytes: small.byteLength },
      runnerArtifact('/output/large.png', large),
    ])

    expect(saved.omitted).toEqual([
      { path: '/output/large.png', reason: 'too-large' },
      { path: '/output/small.csv', reason: 'missing' },
    ])

    const rows = await rowsFor(runId)
    expect(rows.map((row) => row.content)).toEqual([null, null])
    expect(rows.map((row) => row.sha256)).toEqual([sha256(large), sha256(small)])
    expect(rows.map((row) => row.bytes)).toEqual([
      large.byteLength,
      small.byteLength,
    ])
  })

  it('refuses a corrupt payload and writes none of the batch', async () => {
    const runId = await insertRun()
    const valid = Buffer.from('valid\n')
    const corrupt = Buffer.from('corrupt\n')

    await expectCode(
      saveRunArtifacts(testDb.db, runId, [
        runnerArtifact('/output/valid.log', valid),
        runnerArtifact('/output/corrupt.log', corrupt, {
          sha256: sha256(Buffer.from('other')),
        }),
      ]),
      'ARTIFACT_INTEGRITY',
    )

    expect(await rowsFor(runId)).toHaveLength(0)
  })

  it('is idempotent for the same run and artifact set', async () => {
    const runId = await insertRun()
    const bytes = Buffer.from('measured\n')
    const artifact = runnerArtifact('/output/ranks.csv', bytes)

    const first = await saveRunArtifacts(testDb.db, runId, [artifact])
    const second = await saveRunArtifacts(testDb.db, runId, [artifact])

    expect(first.inserted).toBe(1)
    expect(second.inserted).toBe(0)
    expect(second.existing).toBe(1)
    expect(second.artifacts[0]?.id).toBe(first.artifacts[0]?.id)

    const rows = await rowsFor(runId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(first.artifacts[0]?.id)
  })

  it('completes a row that an earlier call stored with metadata only', async () => {
    const runId = await insertRun()
    const bytes = Buffer.from('measured\n')
    const metadataOnly = {
      path: '/output/ranks.csv',
      sha256: sha256(bytes),
      bytes: bytes.byteLength,
    }

    const first = await saveRunArtifacts(testDb.db, runId, [metadataOnly])
    expect(first.artifacts[0]?.content).toBeNull()

    const second = await saveRunArtifacts(testDb.db, runId, [
      runnerArtifact('/output/ranks.csv', bytes),
    ])

    expect(second.inserted).toBe(0)
    expect(second.existing).toBe(1)
    expect(second.artifacts[0]?.id).toBe(first.artifacts[0]?.id)
    expect(second.artifacts[0]?.content).toBe(bytes.toString('base64'))

    const rows = await rowsFor(runId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.content).toBe(bytes.toString('base64'))
  })

  it('refuses to overwrite an artifact whose bytes changed', async () => {
    const runId = await insertRun()
    const original = Buffer.from('original\n')
    const replacement = Buffer.from('replacement\n')

    const first = await saveRunArtifacts(testDb.db, runId, [
      runnerArtifact('/output/ranks.csv', original),
    ])

    await expectCode(
      saveRunArtifacts(testDb.db, runId, [
        runnerArtifact('/output/ranks.csv', replacement),
      ]),
      'ARTIFACT_CONFLICT',
    )

    const rows = await rowsFor(runId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: first.artifacts[0]?.id,
      sha256: sha256(original),
      bytes: original.byteLength,
      content: original.toString('base64'),
    })
  })

  it('rolls back an earlier insert when a later artifact conflicts', async () => {
    const runId = await insertRun()
    const kept = Buffer.from('kept\n')
    const conflicting = Buffer.from('changed\n')

    await saveRunArtifacts(testDb.db, runId, [
      runnerArtifact('/output/z-conflict.csv', kept),
    ])

    // `/output/a-new.csv` sorts first, so it is inserted before the conflict
    // on `/output/z-conflict.csv` is detected. The transaction must undo it.
    await expectCode(
      saveRunArtifacts(testDb.db, runId, [
        runnerArtifact('/output/a-new.csv', Buffer.from('new\n')),
        runnerArtifact('/output/z-conflict.csv', conflicting),
      ]),
      'ARTIFACT_CONFLICT',
    )

    const rows = await rowsFor(runId)
    expect(rows.map((row) => row.path)).toEqual(['/output/z-conflict.csv'])
    expect(rows[0]?.sha256).toBe(sha256(kept))
  })

  it('refuses a missing run and a run that is not terminal', async () => {
    const bytes = Buffer.from('measured\n')
    const artifact = runnerArtifact('/output/ranks.csv', bytes)

    await expectCode(
      saveRunArtifacts(testDb.db, randomUUID(), [artifact]),
      'RUN_NOT_FOUND',
    )

    const runningId = await insertRun('running')
    await expectCode(
      saveRunArtifacts(testDb.db, runningId, [artifact]),
      'RUN_NOT_TERMINAL',
    )
    expect(await rowsFor(runningId)).toHaveLength(0)
  })
})
