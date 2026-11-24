import { describe, expect, it, vi } from 'vitest'
import { E2BRunner, fetchDataset, SANDBOX_METRICS_PATH } from './runner'
import { HERO_EXPERIMENT_SPEC_RUN_A } from './planner'
import type { DatasetRef } from '../shared/types'

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
  it('executes spec with dynamic paths and returns ExperimentResult', async () => {
    const writtenFiles = new Map<string, string | Buffer>()
    let killed = false

    const fakeSandbox = {
      sandboxId: 'test-sandbox-id',
      files: {
        write: vi.fn(async (path: string, content: string | Buffer) => {
          writtenFiles.set(path, content)
        }),
        read: vi.fn(async (path: string) => {
          if (path === SANDBOX_METRICS_PATH || path === '/output/metrics.json') {
            return JSON.stringify({ rank_impurity_noise_20: 1 })
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
    expect(result.metrics).toEqual({ rank_impurity_noise_20: 1 })
    expect(result.environment.packages['scikit-learn']).toBe('1.9.1')
    expect(writtenFiles.has('data/breast-w.csv')).toBe(true)
    expect(writtenFiles.has('main.py')).toBe(true)
    expect(killed).toBe(true)
  })

  it('supports custom output directory configuration without hardcoded path dependencies', async () => {
    const customOutputDir = '/custom/workspace/artifacts'
    const customMetricsPath = '/custom/workspace/artifacts/metrics.json'

    const fakeSandbox = {
      sandboxId: 'custom-sandbox',
      files: {
        write: vi.fn(async () => {}),
        read: vi.fn(async (path: string) => {
          if (path === customMetricsPath) {
            return JSON.stringify({ rank_impurity_noise_20: 2 })
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
      datasetFetcher: vi.fn().mockResolvedValue({ bytes: Buffer.from(''), sha256: 'x' }),
      outputDir: customOutputDir,
      metricsPath: customMetricsPath,
    })

    const result = await runner.run(HERO_EXPERIMENT_SPEC_RUN_A)
    expect(result.metrics).toEqual({ rank_impurity_noise_20: 2 })
  })

  it('fails the run with exitCode 1 when metrics file is missing', async () => {
    const fakeSandbox = {
      sandboxId: 'test-sandbox',
      files: {
        write: vi.fn(async () => {}),
        read: vi.fn(async () => {
          throw new Error('File not found')
        }),
        list: vi.fn(async () => []),
      },
      commands: {
        run: vi.fn(async (cmd: string) => {
          if (cmd.includes('main.py')) return { exitCode: 0, stdout: 'Done', stderr: '' }
          return { exitCode: 0, stdout: '', stderr: '' }
        }),
      },
      kill: vi.fn(async () => {}),
    }

    const runner = new E2BRunner({
      sandboxFactory: vi.fn().mockResolvedValue(fakeSandbox as any),
      datasetFetcher: vi.fn().mockResolvedValue({ bytes: Buffer.from(''), sha256: 'x' }),
    })

    const result = await runner.run(HERO_EXPERIMENT_SPEC_RUN_A)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Metrics file missing')
  })

  it('fails the run with exitCode 1 when metrics file is unparseable', async () => {
    const fakeSandbox = {
      sandboxId: 'test-sandbox',
      files: {
        write: vi.fn(async () => {}),
        read: vi.fn(async (path: string) => {
          if (path.includes('metrics.json')) return 'invalid-json{'
          return ''
        }),
        list: vi.fn(async () => []),
      },
      commands: {
        run: vi.fn(async (cmd: string) => {
          if (cmd.includes('main.py')) return { exitCode: 0, stdout: 'Done', stderr: '' }
          return { exitCode: 0, stdout: '', stderr: '' }
        }),
      },
      kill: vi.fn(async () => {}),
    }

    const runner = new E2BRunner({
      sandboxFactory: vi.fn().mockResolvedValue(fakeSandbox as any),
      datasetFetcher: vi.fn().mockResolvedValue({ bytes: Buffer.from(''), sha256: 'x' }),
    })

    const result = await runner.run(HERO_EXPERIMENT_SPEC_RUN_A)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Metrics file unparseable')
  })
})
