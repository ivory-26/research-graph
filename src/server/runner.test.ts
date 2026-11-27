import { describe, expect, it, vi } from 'vitest'
import {
  E2BRunner,
  MetricsExtractionError,
  PackageVerificationError,
  PINNED_IMAGE_PACKAGES,
  SANDBOX_METRICS_PATH,
  SandboxTimeoutError,
  defaultCollectArtifacts,
  defaultReadEnvironment,
  fetchDataset,
  runnerErrorToFailedResult,
  sanitizeSandboxPath,
  validateDatasetUrl,
  validateMetricsPayload,
  verifyEnvironmentPackages,
} from './runner'
import { evaluateExperiment } from './evaluate'
import { HERO_EXPERIMENT_SPEC_RUN_A, HERO_RECORDED_RUN_RESULT } from '../../fixtures/hero-spec'
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
  it('validates matching packages including matplotlib', () => {
    const discovered = { ...PINNED_IMAGE_PACKAGES }
    const result = verifyEnvironmentPackages(discovered)
    expect(result.valid).toBe(true)
    expect(result.missing).toHaveLength(0)
    expect(result.mismatched).toHaveLength(0)
  })

  it('detects missing and mismatched package versions', () => {
    const discovered = {
      numpy: '2.0.0', // mismatched
      pandas: '2.3.3',
      // scikit-learn missing
      // matplotlib missing
    }
    const result = verifyEnvironmentPackages(discovered)
    expect(result.valid).toBe(false)
    expect(result.missing).toContain('scikit-learn')
    expect(result.missing).toContain('matplotlib')
    expect(result.mismatched.some((m) => m.includes('numpy'))).toBe(true)
  })
})

describe('runnerErrorToFailedResult mapping', () => {
  it('maps MetricsExtractionError into a failed ExperimentResult with exit code and error detail', () => {
    const err = new MetricsExtractionError('metrics.json was missing', 0, 'stdout output', 'stderr output', 1200)
    const failedResult = runnerErrorToFailedResult(err, HERO_EXPERIMENT_SPEC_RUN_A)

    expect(failedResult.exitCode).toBe(1) // Mapped to non-zero failure
    expect(failedResult.stdout).toBe('stdout output')
    expect(failedResult.stderr).toContain('metrics.json was missing')
    expect(failedResult.durationMs).toBe(1200)
    expect(failedResult.metrics).toEqual({})
    expect(failedResult.environment?.imageDigest).toBe('unknown')

    // Persisted evaluation must return verdict 'failed'
    const evalOutcome = evaluateExperiment(HERO_EXPERIMENT_SPEC_RUN_A, failedResult)
    expect(evalOutcome.verdict).toBe('failed')
  })

  it('maps SandboxTimeoutError into a failed ExperimentResult with exit code 124', () => {
    const err = new SandboxTimeoutError('Execution timed out after 60s', 60, '', 'DeadlineExceeded', 60000)
    const failedResult = runnerErrorToFailedResult(err, HERO_EXPERIMENT_SPEC_RUN_A)

    expect(failedResult.exitCode).toBe(124) // Standard timeout exit code
    expect(failedResult.stderr).toContain('timed out')
    expect(failedResult.durationMs).toBe(60000)

    // Persisted evaluation must return verdict 'failed'
    const evalOutcome = evaluateExperiment(HERO_EXPERIMENT_SPEC_RUN_A, failedResult)
    expect(evalOutcome.verdict).toBe('failed')
  })

  it('maps PackageVerificationError into a failed ExperimentResult while retaining stdout, duration, and metrics', () => {
    const err = new PackageVerificationError(
      'Sandbox environment failed package verification: missing matplotlib',
      0,
      'computed output',
      '',
      1500,
      undefined,
      { accuracy: 0.92 },
    )
    const failedResult = runnerErrorToFailedResult(err, HERO_EXPERIMENT_SPEC_RUN_A)

    expect(failedResult.exitCode).toBe(1)
    expect(failedResult.stdout).toBe('computed output')
    expect(failedResult.stderr).toContain('failed package verification')
    expect(failedResult.durationMs).toBe(1500)
    expect(failedResult.metrics).toEqual({ accuracy: 0.92 })

    const evalOutcome = evaluateExperiment(HERO_EXPERIMENT_SPEC_RUN_A, failedResult)
    expect(evalOutcome.verdict).toBe('failed')
  })

  it('records imageDigest as unknown when /etc/image-digest is absent', async () => {
    const mockSandbox = {
      commands: {
        run: vi.fn().mockImplementation(async (cmd: string) => {
          if (cmd.includes('cat /etc/image-digest')) {
            return { exitCode: 0, stdout: '', stderr: '' }
          }
          if (cmd.includes('python --version')) {
            return { exitCode: 0, stdout: 'Python 3.12.0', stderr: '' }
          }
          if (cmd.includes('pip list')) {
            return { exitCode: 0, stdout: '[]', stderr: '' }
          }
          return { exitCode: 0, stdout: '', stderr: '' }
        }),
      },
    } as any

    const env = await defaultReadEnvironment(mockSandbox, HERO_EXPERIMENT_SPEC_RUN_A, '2026-11-24T12:00:00Z')
    expect(env.imageDigest).toBe('unknown')
  })
})

describe('validateDatasetUrl & SSRF protection', () => {
  it('allows trusted domains', () => {
    expect(() => validateDatasetUrl('https://www.openml.org/data/download/52350/breast-w.arff')).not.toThrow()
    expect(() => validateDatasetUrl('https://raw.githubusercontent.com/org/repo/main/data.csv')).not.toThrow()
    expect(() => validateDatasetUrl('https://archive.ics.uci.edu/dataset.arff')).not.toThrow()
  })

  it('rejects loopback, internal, private addresses, and untrusted domains', () => {
    expect(() => validateDatasetUrl('http://localhost/data.csv')).toThrow(/SSRF/)
    expect(() => validateDatasetUrl('http://127.0.0.1/data.csv')).toThrow(/SSRF/)
    expect(() => validateDatasetUrl('http://169.254.169.254/latest/meta-data')).toThrow(/SSRF/)
    expect(() => validateDatasetUrl('http://10.0.0.1/private.csv')).toThrow(/SSRF/)
    expect(() => validateDatasetUrl('http://192.168.1.1/data.csv')).toThrow(/SSRF/)
    expect(() => validateDatasetUrl('http://untrusted-attacker.com/data.csv')).toThrow(/allowed dataset domains/)
    expect(() => validateDatasetUrl('ftp://openml.org/data.csv')).toThrow(/protocol must be http or https/)
  })
})

describe('sanitizeSandboxPath', () => {
  it('allows safe relative paths', () => {
    expect(sanitizeSandboxPath('data/breast-w.arff')).toBe('data/breast-w.arff')
    expect(sanitizeSandboxPath('main.py')).toBe('main.py')
  })

  it('rejects directory traversal and absolute paths', () => {
    expect(() => sanitizeSandboxPath('../../etc/passwd')).toThrow(/forbidden/)
    expect(() => sanitizeSandboxPath('../escape.py')).toThrow(/forbidden/)
    expect(() => sanitizeSandboxPath('/etc/shadow')).toThrow(/forbidden/)
  })
})

describe('fetchDataset', () => {
  it('hashes downloaded bytes and succeeds', async () => {
    const mockData = 'col1,col2\n1,2\n3,4'
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([['content-length', String(mockData.length)]]),
      arrayBuffer: async () => Buffer.from(mockData),
    })

    const ref: DatasetRef = {
      name: 'test',
      url: 'https://raw.githubusercontent.com/test/data.csv',
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
      headers: new Map(),
      arrayBuffer: async () => Buffer.from('different content'),
    })

    const ref: DatasetRef = {
      name: 'test',
      url: 'https://raw.githubusercontent.com/test/data.csv',
      path: 'data/test.csv',
      sha256: 'pinned-hash-12345',
      bytes: 100,
    }

    await expect(fetchDataset(ref, fakeFetch as unknown as typeof fetch)).rejects.toThrow(
      'dataset changed upstream — refusing to run against unpinned bytes',
    )
  })

  it('rejects datasets exceeding MAX_DATASET_BYTES', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([['content-length', String(60 * 1024 * 1024)]]),
      arrayBuffer: async () => Buffer.alloc(10),
    })

    const ref: DatasetRef = {
      name: 'huge',
      url: 'https://raw.githubusercontent.com/test/huge.csv',
      path: 'data/huge.csv',
      sha256: null,
      bytes: null,
    }

    await expect(fetchDataset(ref, fakeFetch as unknown as typeof fetch)).rejects.toThrow(
      'dataset too large',
    )
  })
})

describe('defaultCollectArtifacts with binary content', () => {
  it('reads binary files as bytes and encodes content as base64', async () => {
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const fakeSandbox = {
      files: {
        list: vi.fn().mockResolvedValue([{ name: 'plot.png' }, { name: 'metrics.json' }]),
        read: vi.fn(async (path: string, opts?: any) => {
          if (opts?.format === 'bytes') {
            return new Uint8Array(fakePng)
          }
          return fakePng.toString()
        }),
      },
    }

    const artifacts = await defaultCollectArtifacts(fakeSandbox as any)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]!.path).toBe('/output/plot.png')
    expect(artifacts[0]!.bytes).toBe(fakePng.byteLength)
    expect(artifacts[0]!.content).toBe(fakePng.toString('base64'))
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
            return JSON.stringify({ rank_impurity_noise_20: 4, rank_permutation_noise_20: 11 })
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
                { name: 'pandas', version: '2.3.3' },
                { name: 'scikit-learn', version: '1.9.1' },
                { name: 'matplotlib', version: '3.10.0' },
                { name: 'scipy', version: '1.17.1' },
              ]),
              stderr: '',
              exitCode: 0,
            }
          }
          if (cmd.includes('cat /etc/image-digest')) {
            return { stdout: 'sha256:a1b2c3d4e5f6', stderr: '', exitCode: 0 }
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
      verifyPackages: true,
    })

    const stdoutChunks: string[] = []
    const result = await runner.run(HERO_EXPERIMENT_SPEC_RUN_A, (chunk) => {
      stdoutChunks.push(chunk)
    })

    expect(result.exitCode).toBe(0)
    expect(result.metrics).toEqual({ rank_impurity_noise_20: 4, rank_permutation_noise_20: 11 })
    expect(result.environment.packages['scikit-learn']).toBe('1.9.1')
    expect(result.environment.packages['matplotlib']).toBe('3.10.0')
    expect(result.environment.imageDigest).toBe('sha256:a1b2c3d4e5f6')
    expect(writtenFiles.has('/workspace/data/breast-w.arff')).toBe(true)
    expect(writtenFiles.has('/workspace/main.py')).toBe(true)
    expect(killed).toBe(true)
  })

  it('respects cwd option by writing files into cwd and passing cwd to commands.run', async () => {
    const writtenFiles = new Map<string, string | Buffer>()
    let receivedCwd: string | undefined
    let receivedParameters: string | undefined

    const fakeSandbox = {
      sandboxId: 'test-sandbox-cwd',
      files: {
        write: vi.fn(async (path: string, content: string | Buffer) => {
          writtenFiles.set(path, content)
        }),
        read: vi.fn(async (path: string) => {
          if (path === SANDBOX_METRICS_PATH) {
            return JSON.stringify({ rank_impurity_noise_20: 4, rank_permutation_noise_20: 11 })
          }
          throw new Error('Not found')
        }),
        list: vi.fn(async () => []),
      },
      commands: {
        run: vi.fn(async (cmd: string, opts?: any) => {
          if (cmd.includes('main.py')) {
            receivedCwd = opts?.cwd
            receivedParameters = opts?.envs?.RESEARCHGRAPH_PARAMETERS
            return { exitCode: 0, stdout: 'Done', stderr: '' }
          }
          if (cmd.includes('python --version')) {
            return { stdout: 'Python 3.12.0', stderr: '', exitCode: 0 }
          }
          if (cmd.includes('pip list')) {
            return {
              stdout: JSON.stringify([
                { name: 'numpy', version: '2.5.5' },
                { name: 'pandas', version: '2.3.3' },
                { name: 'scikit-learn', version: '1.9.1' },
                { name: 'matplotlib', version: '3.10.0' },
                { name: 'scipy', version: '1.17.1' },
              ]),
              stderr: '',
              exitCode: 0,
            }
          }
          if (cmd.includes('cat /etc/image-digest')) {
            return { stdout: 'sha256:digest123', stderr: '', exitCode: 0 }
          }
          return { stdout: '', stderr: '', exitCode: 0 }
        }),
      },
      kill: vi.fn(async () => {}),
    }

    const runner = new E2BRunner({
      cwd: '/workspace',
      sandboxFactory: vi.fn().mockResolvedValue(fakeSandbox as any),
      datasetFetcher: vi.fn().mockResolvedValue({ bytes: Buffer.from('data'), sha256: 'h1' }),
      verifyPackages: true,
    })

    const result = await runner.run(HERO_EXPERIMENT_SPEC_RUN_A)
    expect(result.exitCode).toBe(0)
    expect(writtenFiles.has('/workspace/data/breast-w.arff')).toBe(true)
    expect(writtenFiles.has('/workspace/main.py')).toBe(true)
    expect(receivedCwd).toBe('/workspace')
    expect(receivedParameters).toBe(JSON.stringify(HERO_EXPERIMENT_SPEC_RUN_A.parameters))
  })

  it('throws PackageVerificationError during runner.run when sandbox packages are mismatched', async () => {
    const fakeSandbox = {
      sandboxId: 'test-sandbox-mismatch',
      files: {
        write: vi.fn(async () => {}),
        read: vi.fn(async (path: string) => {
          if (path === SANDBOX_METRICS_PATH) {
            return JSON.stringify({ rank_impurity_noise_20: 4, rank_permutation_noise_20: 11 })
          }
          throw new Error('Not found')
        }),
        list: vi.fn(async () => []),
      },
      commands: {
        run: vi.fn(async (cmd: string) => {
          if (cmd.includes('main.py')) {
            return { exitCode: 0, stdout: 'Computed with mismatched numpy', stderr: '' }
          }
          if (cmd.includes('python --version')) {
            return { stdout: 'Python 3.12.0', stderr: '', exitCode: 0 }
          }
          if (cmd.includes('pip list')) {
            return {
              stdout: JSON.stringify([
                { name: 'numpy', version: '2.0.0' },
                { name: 'pandas', version: '2.3.3' },
                { name: 'scikit-learn', version: '1.9.1' },
                { name: 'matplotlib', version: '3.10.0' },
                { name: 'scipy', version: '1.17.1' },
              ]),
              stderr: '',
              exitCode: 0,
            }
          }
          return { stdout: '', stderr: '', exitCode: 0 }
        }),
      },
      kill: vi.fn(async () => {}),
    }

    const runner = new E2BRunner({
      sandboxFactory: vi.fn().mockResolvedValue(fakeSandbox as any),
      datasetFetcher: vi.fn().mockResolvedValue({ bytes: Buffer.from('data'), sha256: 'h1' }),
      verifyPackages: true,
    })

    await expect(runner.run(HERO_EXPERIMENT_SPEC_RUN_A)).rejects.toThrow(PackageVerificationError)
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

  it('handles sandbox timeout and throws SandboxTimeoutError', async () => {
    const fakeSandbox = {
      sandboxId: 'test-sandbox-timeout',
      files: {
        write: vi.fn(async () => {}),
        read: vi.fn(async () => {
          throw new Error('Not found')
        }),
        list: vi.fn(async () => []),
      },
      commands: {
        run: vi.fn(async (cmd: string) => {
          if (cmd.includes('main.py')) {
            throw new Error('Execution timeout: DeadlineExceeded')
          }
          return { stdout: '', stderr: '', exitCode: 0 }
        }),
      },
      kill: vi.fn(async () => {}),
    }

    const runner = new E2BRunner({
      sandboxFactory: vi.fn().mockResolvedValue(fakeSandbox as any),
      datasetFetcher: vi.fn().mockResolvedValue({ bytes: Buffer.from(''), sha256: 'xyz' }),
    })

    await expect(runner.run(HERO_EXPERIMENT_SPEC_RUN_A)).rejects.toThrow(SandboxTimeoutError)
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
    ;(runner as any).activeSandboxes.set('active-sb-1', fakeSandbox)
    expect(runner.getActiveSandboxes().has('active-sb-1')).toBe(true)

    await runner.cancel('active-sb-1')
    expect(sandboxKilled).toBe(true)
    expect(runner.getActiveSandboxes().has('active-sb-1')).toBe(false)
  })
})

describe('HERO_RECORDED_RUN_RESULT', () => {
  it('contains verified environment and genuine measured metrics matching criteria and verification script', () => {
    expect(HERO_RECORDED_RUN_RESULT.exitCode).toBe(0)
    expect(HERO_RECORDED_RUN_RESULT.durationMs).toBeGreaterThan(0)
    expect(HERO_RECORDED_RUN_RESULT.environment.imageDigest).toBe('unknown')
    expect(HERO_RECORDED_RUN_RESULT.environment.python).toMatch(/^Python 3\.12/)
    const pkgCheck = verifyEnvironmentPackages(HERO_RECORDED_RUN_RESULT.environment.packages)
    expect(pkgCheck.valid).toBe(true)

    // Assert every pinned package is matched
    for (const [pkg, pinnedVersion] of Object.entries(PINNED_IMAGE_PACKAGES)) {
      expect(HERO_RECORDED_RUN_RESULT.environment.packages[pkg]).toBe(pinnedVersion)
    }

    // Assert recorded dataset matches pinned DatasetRef
    expect(HERO_RECORDED_RUN_RESULT.environment.datasets).toEqual([
      {
        name: HERO_EXPERIMENT_SPEC_RUN_A.datasets[0].name,
        sha256: HERO_EXPERIMENT_SPEC_RUN_A.datasets[0].sha256,
        bytes: HERO_EXPERIMENT_SPEC_RUN_A.datasets[0].bytes,
      },
    ])

    // Verify metrics against claim criteria
    expect(HERO_RECORDED_RUN_RESULT.metrics.rank_impurity_noise_20).toBeLessThanOrEqual(5)
    expect(HERO_RECORDED_RUN_RESULT.metrics.rank_permutation_noise_20).toBeGreaterThan(5)
    expect(HERO_RECORDED_RUN_RESULT.metrics.rank_impurity_noise_20).toBe(4)
    expect(HERO_RECORDED_RUN_RESULT.metrics.rank_permutation_noise_20).toBe(11)

    // Assert against evaluateExperiment contract
    const verdict = evaluateExperiment(
      HERO_EXPERIMENT_SPEC_RUN_A,
      HERO_RECORDED_RUN_RESULT,
    )
    expect(verdict.verdict).toBe('match')
  })

  it('guarantees verification reproducer script is loadable by Node ESM without rot', async () => {
    const reproducerModule = (await import(
      '../../scripts/verify-hero-run.mjs' as unknown as string
    )) as { runHeroVerification: () => Promise<unknown> }
    expect(typeof reproducerModule.runHeroVerification).toBe('function')
  })
})
