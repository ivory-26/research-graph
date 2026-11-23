import { describe, expect, it, vi } from 'vitest'
import {
  E2BRunner,
  MetricsExtractionError,
  SANDBOX_METRICS_PATH,
  fetchDataset,
  validateMetricsPayload,
  verifyEnvironmentPackages,
} from './runner'
import { HERO_EXPERIMENT_SPEC_RUN_A } from '../../fixtures/hero-spec'
import type { DatasetRef } from '../shared/types'

describe('validateMetricsPayload', () => {
  it('accepts valid record of finite numbers', () => {
    expect(validateMetricsPayload({ a: 1, b: 2.5, c: -10 })).toEqual({
      a: 1,
      b: 2.5,
      c: -10,
    })
  })

  it('rejects arrays, null, strings, NaN, and Infinity', () => {
    expect(validateMetricsPayload([1, 2, 3])).toBeNull()
    expect(validateMetricsPayload(null)).toBeNull()
    expect(validateMetricsPayload('string')).toBeNull()
    expect(validateMetricsPayload({ a: '1' })).toBeNull()
    expect(validateMetricsPayload({ a: null })).toBeNull()
    expect(validateMetricsPayload({ a: NaN })).toBeNull()
    expect(validateMetricsPayload({ a: Infinity })).toBeNull()
  })
})

describe('verifyEnvironmentPackages', () => {
  it('validates matching packages', () => {
    const discovered = {
      numpy: '2.5.5',
      pandas: '2.3.4',
      'scikit-learn': '1.9.1',
    }
    const result = verifyEnvironmentPackages(discovered)
    expect(result.valid).toBe(true)
    expect(result.missing).toHaveLength(0)
    expect(result.mismatched).toHaveLength(0)
  })

  it('detects missing and mismatched package versions', () => {
    const discovered = {
      numpy: '2.0.0', // mismatched
      pandas: '2.3.4',
      // scikit-learn missing
    }
    const result = verifyEnvironmentPackages(discovered)
    expect(result.valid).toBe(false)
    expect(result.missing).toContain('scikit-learn')
    expect(result.mismatched.some((m) => m.includes('numpy'))).toBe(true)
  })
})

describe('fetchDataset', () => {
  it('hashes downloaded bytes and succeeds', async () => {
    const mockData = 'col1,col2\n1,2\n3,4'
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from(mockData),
    })

    const ref: DatasetRef = {
      name: 'test',
      url: 'https://example.com/test.csv',
      path: 'data/test.csv',
      sha256: null,
      bytes: null,
    }

    const { bytes, sha256 } = await fetchDataset(ref, fakeFetch as unknown as typeof fetch)
    expect(bytes.toString()).toBe(mockData)
    expect(sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects if dataset sha256 does not match pinned sha256', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from('different content'),
    })

    const ref: DatasetRef = {
      name: 'test',
      url: 'https://example.com/test.csv',
      path: 'data/test.csv',
      sha256: 'pinned-hash-12345',
      bytes: 100,
    }

    await expect(fetchDataset(ref, fakeFetch as unknown as typeof fetch)).rejects.toThrow(
      'dataset changed upstream — refusing to run against unpinned bytes',
    )
  })
})

describe('E2BRunner with mocked sandbox', () => {
  it('executes spec, writes files and datasets, and returns ExperimentResult with strict /output/metrics.json contract', async () => {
    const writtenFiles = new Map<string, string | Buffer>()
    let killed = false

    const fakeSandbox = {
      sandboxId: 'test-sandbox-id',
      files: {
        write: vi.fn(async (path: string, content: string | Buffer) => {
          writtenFiles.set(path, content)
        }),
        read: vi.fn(async (path: string) => {
          if (path === SANDBOX_METRICS_PATH) {
            return JSON.stringify({ rank_impurity_noise_20: 1, rank_permutation_noise_20: 6 })
          }
          throw new Error('Not found')
        }),
        list: vi.fn(async () => []),
      },
      commands: {
        run: vi.fn(async (cmd: string) => {
          if (cmd.includes('main.py')) {
            return { exitCode: 0, stdout: 'Executed experiment', stderr: '' }
          }
          if (cmd.includes('python --version')) {
            return { stdout: 'Python 3.12.0', stderr: '', exitCode: 0 }
          }
          if (cmd.includes('pip list')) {
            return {
              stdout: JSON.stringify([
                { name: 'numpy', version: '2.5.5' },
                { name: 'pandas', version: '2.3.4' },
                { name: 'scikit-learn', version: '1.9.1' },
              ]),
              stderr: '',
              exitCode: 0,
            }
          }
          return { stdout: '', stderr: '', exitCode: 0 }
        }),
      },
      kill: vi.fn(async () => {
        killed = true
      }),
    }

    const fakeDatasetFetcher = vi.fn().mockResolvedValue({
      bytes: Buffer.from('a,b,c\n1,2,3'),
      sha256: 'sha256-mock-dataset',
    })

    const runner = new E2BRunner({
      sandboxFactory: vi.fn().mockResolvedValue(fakeSandbox as any),
      datasetFetcher: fakeDatasetFetcher,
    })

    const stdoutChunks: string[] = []
    const result = await runner.run(HERO_EXPERIMENT_SPEC_RUN_A, (chunk) => {
      stdoutChunks.push(chunk)
    })

    expect(result.exitCode).toBe(0)
    expect(result.metrics).toEqual({ rank_impurity_noise_20: 1, rank_permutation_noise_20: 6 })
    expect(result.environment.packages['scikit-learn']).toBe('1.9.1')
    expect(writtenFiles.has('data/breast-w.arff')).toBe(true)
    expect(writtenFiles.has('main.py')).toBe(true)
    expect(killed).toBe(true)
  })

  it('throws MetricsExtractionError when /output/metrics.json is missing', async () => {
    const fakeSandbox = {
      sandboxId: 'test-sandbox-fail',
      files: {
        write: vi.fn(async () => {}),
        read: vi.fn(async () => {
          throw new Error('File not found')
        }),
        list: vi.fn(async () => []),
      },
      commands: {
        run: vi.fn(async () => ({ exitCode: 0, stdout: 'Success but no metrics', stderr: '' })),
      },
      kill: vi.fn(async () => {}),
    }

    const runner = new E2BRunner({
      sandboxFactory: vi.fn().mockResolvedValue(fakeSandbox as any),
      datasetFetcher: vi.fn().mockResolvedValue({ bytes: Buffer.from(''), sha256: 'xyz' }),
    })

    await expect(runner.run(HERO_EXPERIMENT_SPEC_RUN_A)).rejects.toThrow(MetricsExtractionError)
  })

  it('throws MetricsExtractionError when /output/metrics.json contains invalid/non-numeric JSON', async () => {
    const fakeSandbox = {
      sandboxId: 'test-sandbox-bad-json',
      files: {
        write: vi.fn(async () => {}),
        read: vi.fn(async (path: string) => {
          if (path === SANDBOX_METRICS_PATH) {
            return JSON.stringify({ rank: 'not-a-number' })
          }
          throw new Error('Not found')
        }),
        list: vi.fn(async () => []),
      },
      commands: {
        run: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
      },
      kill: vi.fn(async () => {}),
    }

    const runner = new E2BRunner({
      sandboxFactory: vi.fn().mockResolvedValue(fakeSandbox as any),
      datasetFetcher: vi.fn().mockResolvedValue({ bytes: Buffer.from(''), sha256: 'xyz' }),
    })

    await expect(runner.run(HERO_EXPERIMENT_SPEC_RUN_A)).rejects.toThrow(MetricsExtractionError)
  })

  it('tracks and cancels active sandboxes', async () => {
    let sandboxKilled = false
    const fakeSandbox = {
      sandboxId: 'active-sb-1',
      kill: vi.fn(async () => {
        sandboxKilled = true
      }),
    }

    const runner = new E2BRunner()
    // Inject active sandbox
    ;(runner as any).activeSandboxes.set('active-sb-1', fakeSandbox)
    expect(runner.getActiveSandboxes().has('active-sb-1')).toBe(true)

    await runner.cancel('active-sb-1')
    expect(sandboxKilled).toBe(true)
    expect(runner.getActiveSandboxes().has('active-sb-1')).toBe(false)
  })
})
