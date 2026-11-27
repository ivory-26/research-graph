/**
 * Real-asset loading shared by the seed and the two-database comparison.
 *
 * The sha256 and byte count always come from the checked-in bytes. The UI
 * fixture's `sources[].sha256` / `bytes` values are not used: they describe a
 * different download of the papers and are already known to be wrong.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  SEED_ASSETS,
  SeedError,
  type SeedAsset,
} from './contracts.ts'

export interface LocalAsset {
  asset: SeedAsset
  bytes: Buffer
  sha256: string
}

export function loadLocalAssets(repoRoot: string): LocalAsset[] {
  return SEED_ASSETS.map((asset) => {
    const fullPath = join(repoRoot, asset.path)
    let bytes: Buffer
    try {
      bytes = readFileSync(fullPath)
    } catch {
      throw new SeedError(
        'MISSING_ASSET',
        `Required demo asset is missing: ${asset.path}`,
        fullPath,
      )
    }

    if (bytes.length === 0 || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new SeedError(
        'ASSET_NOT_PDF',
        `Required demo asset is not a PDF: ${asset.path}`,
        `${bytes.length} bytes`,
      )
    }

    return {
      asset,
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  })
}
