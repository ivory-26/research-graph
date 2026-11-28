import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  artifactContentType,
  artifactDownloadName,
  decodeArtifactContent,
  RunArtifactReadError,
} from './run-artifacts'

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('decodeArtifactContent', () => {
  const bytes = Buffer.from('{"score": 0.9}\n', 'utf8')

  it('decodes the canonical base64 written by saveRunArtifacts', () => {
    const decoded = decodeArtifactContent(
      bytes.toString('base64'),
      sha256(bytes),
      bytes.byteLength,
    )

    expect(decoded.equals(bytes)).toBe(true)
  })

  it('decodes the UTF-8 JSON written by saveNotebookArtifact', () => {
    const decoded = decodeArtifactContent(
      bytes.toString('utf8'),
      sha256(bytes),
      bytes.byteLength,
    )

    expect(decoded.equals(bytes)).toBe(true)
  })

  it('refuses content that does not reproduce the recorded hash', () => {
    expect(() =>
      decodeArtifactContent(
        bytes.toString('base64'),
        '0'.repeat(64),
        bytes.byteLength,
      ),
    ).toThrow(RunArtifactReadError)

    try {
      decodeArtifactContent(
        bytes.toString('base64'),
        '0'.repeat(64),
        bytes.byteLength,
      )
    } catch (error) {
      expect((error as RunArtifactReadError).code).toBe('ARTIFACT_INTEGRITY')
    }
  })

  it('refuses content whose byte count disagrees with the row', () => {
    expect(() =>
      decodeArtifactContent(
        bytes.toString('base64'),
        sha256(bytes),
        bytes.byteLength + 1,
      ),
    ).toThrow(RunArtifactReadError)
  })
})

describe('artifactContentType', () => {
  it('serves notebooks as Colab-compatible nbformat JSON', () => {
    expect(
      artifactContentType({
        kind: 'notebook',
        path: 'reproducibility-record.ipynb',
      }),
    ).toBe('application/x-ipynb+json; charset=utf-8')
  })

  it('serves figures and tables with their real media types', () => {
    expect(artifactContentType({ kind: 'figure', path: '/output/p.png' })).toBe(
      'image/png',
    )
    expect(artifactContentType({ kind: 'table', path: '/output/r.csv' })).toBe(
      'text/csv; charset=utf-8',
    )
    expect(artifactContentType({ kind: 'table', path: '/output/r.json' })).toBe(
      'application/json; charset=utf-8',
    )
    expect(artifactContentType({ kind: 'log', path: '/output/run.log' })).toBe(
      'text/plain; charset=utf-8',
    )
  })

  it('falls back to octet-stream for an unknown non-notebook file', () => {
    expect(artifactContentType({ kind: 'log', path: '/output/blob.bin' })).toBe(
      'application/octet-stream',
    )
  })
})

describe('artifactDownloadName', () => {
  it('uses the stored basename', () => {
    expect(
      artifactDownloadName({
        id: 'artifact-1',
        kind: 'table',
        path: '/output/importance_ranks.csv',
      }),
    ).toBe('importance_ranks.csv')
  })

  it('cannot inject a header or path separator', () => {
    const name = artifactDownloadName({
      id: 'artifact-2',
      kind: 'log',
      path: '/output/evil"name\r\ninjection.log',
    })

    expect(name).not.toContain('"')
    expect(name).not.toContain('\r')
    expect(name).not.toContain('\n')
    expect(name).not.toContain('/')
  })

  it('falls back to a kind/id name when the path has no basename', () => {
    expect(
      artifactDownloadName({ id: 'artifact-3', kind: 'log', path: '/' }),
    ).toBe('log-artifact-3')
  })
})
