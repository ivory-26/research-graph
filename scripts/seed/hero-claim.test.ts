import { describe, expect, it } from 'vitest'

import { HERO_CLAIM_QUOTE_ANCHOR } from './contracts.ts'
import { pickHeroClaim, type RawHeroClaimCandidate } from './hero-claim.ts'

const BASE = {
  sourceId: 'source-hero',
  title: 'Gini importance favours high-cardinality features',
  text: 'Gini importance favours high-cardinality features; permutation does not',
  page: 1,
} as const

function candidate(
  claimNodeId: string,
  overrides: Partial<RawHeroClaimCandidate> = {},
): RawHeroClaimCandidate {
  return { ...BASE, claimNodeId, quote: HERO_CLAIM_QUOTE_ANCHOR, ...overrides }
}

describe('hero claim selector', () => {
  it('selects an exact verbatim quote', () => {
    const { selection, problem } = pickHeroClaim([candidate('claim-1')])

    expect(problem).toBeNull()
    expect(selection).toMatchObject({
      claimNodeId: 'claim-1',
      match: 'exact',
      sourceId: 'source-hero',
      page: 1,
    })
  })

  it('normalises whitespace and non-breaking spaces before comparing', () => {
    const spaced = HERO_CLAIM_QUOTE_ANCHOR.replace(/ /g, '\n   ')
    const whitespace = pickHeroClaim([
      candidate('claim-1', { quote: `  ${spaced}  ` }),
    ])
    expect(whitespace.selection?.match).toBe('exact')

    const nbsp = HERO_CLAIM_QUOTE_ANCHOR.replace(
      'random forest',
      'random forest',
    )
    const normalised = pickHeroClaim([
      candidate('claim-1', { quote: nbsp }),
    ])
    expect(normalised.selection?.match).toBe('exact')
  })

  it('accepts a longer quote that contains the anchor', () => {
    const { selection } = pickHeroClaim([
      candidate('claim-1', { quote: `Abstract. ${HERO_CLAIM_QUOTE_ANCHOR} End.` }),
    ])

    expect(selection?.match).toBe('contains-anchor')
  })

  it('accepts a contiguous fragment of at least 80 characters', () => {
    const fragment = HERO_CLAIM_QUOTE_ANCHOR.slice(20, 150)
    expect(fragment.length).toBeGreaterThanOrEqual(80)

    const { selection } = pickHeroClaim([
      candidate('claim-1', { quote: fragment }),
    ])
    expect(selection?.match).toBe('anchor-fragment')
  })

  it('rejects a too-short fragment instead of guessing', () => {
    const { selection, problem } = pickHeroClaim([
      candidate('claim-1', { quote: 'random forest variable importance' }),
    ])

    expect(selection).toBeNull()
    expect(problem?.code).toBe('HERO_CLAIM_NOT_FOUND')
  })

  it('collapses byte-identical duplicates to the lowest node id', () => {
    const { selection, problem } = pickHeroClaim([
      candidate('claim-2'),
      candidate('claim-1'),
    ])

    expect(problem).toBeNull()
    expect(selection?.claimNodeId).toBe('claim-1')
    expect(selection?.duplicateClaimNodeIds).toEqual(['claim-2'])
  })

  it('refuses two distinct matching claims', () => {
    const { selection, problem } = pickHeroClaim([
      candidate('claim-1'),
      candidate('claim-2', { text: 'A different claim text' }),
    ])

    expect(selection).toBeNull()
    expect(problem?.code).toBe('HERO_CLAIM_AMBIGUOUS')
    expect(problem?.candidates).toHaveLength(2)
  })

  it('reports candidates that did not match at all', () => {
    const { problem } = pickHeroClaim([
      candidate('claim-1', { quote: 'unrelated sentence' }),
    ])

    expect(problem?.code).toBe('HERO_CLAIM_NOT_FOUND')
    expect(problem?.candidates[0]?.match).toBeNull()
  })
})
