import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { loadLocalAssets } from './assets.ts'
import { SeedError } from './contracts.ts'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

const EXPECTED = [
  {
    key: 'strobl-2007',
    sha256:
      '07c2801d84b912e97fede1fcf8d31dcda15cf63520054a29561b7b38fa1f74b5',
    bytes: 397660,
  },
  {
    key: 'strobl-2008',
    sha256:
      'c60f719b29b68807e2b47bd1f8b289f58f31e861b6bbec1c49f56905585c0539',
    bytes: 451013,
  },
  {
    key: 'kursa-2010',
    sha256:
      '4142662e9e94dadcfec9d07faabd6d40e5c447d02be1cb78ff66de69fcf61c45',
    bytes: 517768,
  },
] as const

describe('real demo PDF assets', () => {
  it('hashes the checked-in bytes, not the UI fixture metadata', () => {
    const assets = loadLocalAssets(REPO_ROOT)

    expect(
      assets.map(({ asset, sha256, bytes }) => ({
        key: asset.key,
        sha256,
        bytes: bytes.byteLength,
      })),
    ).toEqual(EXPECTED)
  })

  it('keeps the documented hero and support order', () => {
    const assets = loadLocalAssets(REPO_ROOT)

    expect(assets.map(({ asset }) => asset.hero)).toEqual([
      true,
      false,
      false,
    ])
    expect(assets.map(({ asset }) => asset.doi)).toEqual([
      '10.1186/1471-2105-8-25',
      '10.1186/1471-2105-9-307',
      '10.18637/jss.v036.i11',
    ])
  })

  it('fails closed when an asset is missing', () => {
    let error: unknown
    try {
      loadLocalAssets(`${REPO_ROOT}/scripts/seed/__missing_asset_dir__`)
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(SeedError)
    expect((error as SeedError).code).toBe('MISSING_ASSET')
  })
})
