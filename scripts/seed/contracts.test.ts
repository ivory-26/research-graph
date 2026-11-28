import { describe, expect, it } from 'vitest'

import {
  HERO_CLAIM_QUOTE_ANCHOR,
  SEED_WORKSPACE_ID,
  SEED_WORKSPACE_SLUG,
  SeedError,
  extractionRunId,
  extractionRunLabel,
  resolveSeedActor,
} from './contracts.ts'

describe('seed contracts', () => {
  it('pins a valid deterministic workspace identity', () => {
    expect(SEED_WORKSPACE_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(SEED_WORKSPACE_SLUG).toBe('random-forest-study')
  })

  it('requires the verified actor instead of inventing one', () => {
    let error: unknown
    try {
      resolveSeedActor({})
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(SeedError)
    expect((error as SeedError).code).toBe('MISSING_ACTOR')
  })

  it('trims and persists the supplied actor as owner', () => {
    expect(resolveSeedActor({ SEED_ACTOR_USER_ID: '  auth-user-1  ' })).toEqual({
      userId: 'auth-user-1',
      role: 'owner',
    })
  })

  it('keeps the hero anchor a substantial sentence', () => {
    expect(HERO_CLAIM_QUOTE_ANCHOR.length).toBeGreaterThan(200)
    expect(HERO_CLAIM_QUOTE_ANCHOR).toContain('not reliable')
  })

  it('derives stable extraction run ids from the asset and strategy, not ingestion order', () => {
    expect(extractionRunId('strobl-2007', 'single_pass')).toBe(
      'extract:strobl-2007:single_pass',
    )
    // Same inputs, same id; a different asset or strategy never collides.
    expect(extractionRunId('strobl-2007', 'single_pass')).toBe(
      extractionRunId('strobl-2007', 'single_pass'),
    )
    expect(extractionRunId('strobl-2008', 'single_pass')).not.toBe(
      extractionRunId('strobl-2007', 'single_pass'),
    )
    expect(extractionRunId('strobl-2007', 'sectioned')).not.toBe(
      extractionRunId('strobl-2007', 'single_pass'),
    )
  })

  it('builds a readable run label without inventing metrics', () => {
    const label = extractionRunLabel('Feature Selection with the Boruta Package', 'single_pass')
    expect(label).toBe('Feature Selection with the Boruta Package · single_pass')
    expect(label).not.toMatch(/\d+(?:\.\d+)?\s*(?:ms|s|%|\$)/)
  })
})
