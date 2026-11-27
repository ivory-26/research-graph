import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  MAX_INLINE_ARTIFACT_BYTES,
  RunArtifactError,
  classifyArtifactKind,
  prepareRunArtifacts,
  type RunArtifactErrorCode,
  type RunArtifactInput,
} from './artifacts'

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** The exact shape `defaultCollectArtifacts` returns for one file. */
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

function expectCode(fn: () => unknown, code: RunArtifactErrorCode): void {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(RunArtifactError)
    expect((error as RunArtifactError).code).toBe(code)
    return
  }
  throw new Error(`expected a RunArtifactError with code ${code}`)
}

describe('classifyArtifactKind', () => {
  it('maps the documented kinds from the sandbox path', () => {
    expect(classifyArtifactKind('/output/importance.png')).toBe('figure')
    expect(classifyArtifactKind('/output/plot.PDF')).toBe('figure')
    expect(classifyArtifactKind('/output/importances.csv')).toBe('table')
    expect(classifyArtifactKind('/output/metrics-summary.json')).toBe('table')
    expect(classifyArtifactKind('/output/notebook.ipynb')).toBe('notebook')
    expect(classifyArtifactKind('/output/run.log')).toBe('log')
  })

  it('falls back to log rather than inventing a fifth kind', () => {
    expect(classifyArtifactKind('/output/artifact.bin')).toBe('log')
    expect(classifyArtifactKind('/output/no-extension')).toBe('log')
  })
})

describe('prepareRunArtifacts', () => {
  it('keeps the runner metadata and verified content for a small artifact', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const [artifact] = prepareRunArtifacts([
      runnerArtifact('/output/importance.png', png),
    ])

    expect(artifact).toEqual({
      path: '/output/importance.png',
      kind: 'figure',
      sha256: sha256(png),
      bytes: png.byteLength,
      content: png.toString('base64'),
      contentOmitted: null,
    })
  })

  it('sorts by path so persistence order is stable', () => {
    const first = Buffer.from('a')
    const second = Buffer.from('b')
    const prepared = prepareRunArtifacts([
      runnerArtifact('/output/z.csv', second),
      runnerArtifact('/output/a.csv', first),
    ])

    expect(prepared.map((artifact) => artifact.path)).toEqual([
      '/output/a.csv',
      '/output/z.csv',
    ])
  })

  it('accepts an explicit kind and an explicit utf8 encoding', () => {
    const notebook = Buffer.from('{"cells":[]}', 'utf8')
    const [artifact] = prepareRunArtifacts([
      {
        path: '/output/export',
        sha256: sha256(notebook),
        bytes: notebook.byteLength,
        content: notebook.toString('utf8'),
        contentEncoding: 'utf8',
        kind: 'notebook',
      },
    ])

    expect(artifact?.kind).toBe('notebook')
    expect(artifact?.content).toBe('{"cells":[]}')
    expect(artifact?.contentOmitted).toBeNull()
  })

  it('records metadata only when the collector omitted content', () => {
    const bytes = Buffer.from('rank,importance\n1,0.4\n')
    const [artifact] = prepareRunArtifacts([
      { path: '/output/ranks.csv', sha256: sha256(bytes), bytes: bytes.byteLength },
    ])

    expect(artifact).toEqual({
      path: '/output/ranks.csv',
      kind: 'table',
      sha256: sha256(bytes),
      bytes: bytes.byteLength,
      content: null,
      contentOmitted: 'missing',
    })
  })

  it('stores content only below the inline cap and reports the omission', () => {
    const large = Buffer.alloc(MAX_INLINE_ARTIFACT_BYTES + 1, 0x61)
    const [artifact] = prepareRunArtifacts([
      runnerArtifact('/output/figure.png', large),
    ])

    expect(artifact?.bytes).toBe(large.byteLength)
    expect(artifact?.sha256).toBe(sha256(large))
    expect(artifact?.content).toBeNull()
    expect(artifact?.contentOmitted).toBe('too-large')
  })

  it('still verifies oversized content instead of trusting its metadata', () => {
    const large = Buffer.alloc(MAX_INLINE_ARTIFACT_BYTES + 1, 0x61)
    expectCode(
      () =>
        prepareRunArtifacts([
          runnerArtifact('/output/figure.png', large, {
            sha256: sha256(Buffer.from('something else')),
          }),
        ]),
      'ARTIFACT_INTEGRITY',
    )
  })

  it('refuses content whose size or hash disagrees with the metadata', () => {
    const bytes = Buffer.from('measured\n')
    expectCode(
      () =>
        prepareRunArtifacts([
          runnerArtifact('/output/a.csv', bytes, { bytes: bytes.byteLength + 1 }),
        ]),
      'ARTIFACT_INTEGRITY',
    )
    expectCode(
      () =>
        prepareRunArtifacts([
          runnerArtifact('/output/a.csv', bytes, {
            sha256: sha256(Buffer.from('different')),
          }),
        ]),
      'ARTIFACT_INTEGRITY',
    )
  })

  it('refuses non-canonical base64 instead of silently decoding it', () => {
    const bytes = Buffer.from('abc')
    expectCode(
      () =>
        prepareRunArtifacts([
          runnerArtifact('/output/a.csv', bytes, {
            content: ` ${bytes.toString('base64')}\n`,
          }),
        ]),
      'ARTIFACT_INTEGRITY',
    )
  })

  it('normalises an uppercase hash to the stored lowercase form', () => {
    const bytes = Buffer.from('abc')
    const [artifact] = prepareRunArtifacts([
      runnerArtifact('/output/a.csv', bytes, { sha256: sha256(bytes).toUpperCase() }),
    ])

    expect(artifact?.sha256).toBe(sha256(bytes))
  })

  it('refuses duplicate paths, bad hashes, bad sizes and unknown kinds', () => {
    const bytes = Buffer.from('abc')
    expectCode(
      () =>
        prepareRunArtifacts([
          runnerArtifact('/output/a.csv', bytes),
          runnerArtifact('/output/a.csv', bytes),
        ]),
      'INVALID_ARTIFACT',
    )
    expectCode(
      () => prepareRunArtifacts([runnerArtifact('/output/a.csv', bytes, { sha256: 'nope' })]),
      'INVALID_ARTIFACT',
    )
    expectCode(
      () => prepareRunArtifacts([runnerArtifact('/output/a.csv', bytes, { bytes: -1 })]),
      'INVALID_ARTIFACT',
    )
    expectCode(
      () =>
        prepareRunArtifacts([
          runnerArtifact('/output/a.csv', bytes, {
            kind: 'other' as unknown as RunArtifactInput['kind'],
          }),
        ]),
      'INVALID_ARTIFACT',
    )
  })

  it('keeps an empty verified file as inline empty content', () => {
    const [artifact] = prepareRunArtifacts([
      runnerArtifact('/output/empty.log', Buffer.alloc(0)),
    ])

    expect(artifact?.content).toBe('')
    expect(artifact?.contentOmitted).toBeNull()
  })
})
