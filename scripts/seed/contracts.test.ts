import { describe, expect, it } from 'vitest'

import {
  HERO_CLAIM_QUOTE_ANCHOR,
  SEED_WORKSPACE_ID,
  SEED_WORKSPACE_SLUG,
  SeedError,
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
})
