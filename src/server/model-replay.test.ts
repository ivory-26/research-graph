import { describe, expect, it } from 'vitest'

import {
  modelOutputKey,
  normalizeModelPrompt,
  rewriteRecordedOutput,
} from './model-replay'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const D = '44444444-4444-4444-8444-444444444444'

describe('recorded model-output replay', () => {
  it('normalises prompts that differ only in database UUIDs', () => {
    const first = normalizeModelPrompt(`chunk ${A} follows ${B}; again ${A}`)
    const second = normalizeModelPrompt(`chunk ${C} follows ${D}; again ${C}`)

    expect(first.normalized).toBe(second.normalized)
    expect(first.normalized).toBe(
      'chunk __rg_uuid_1__ follows __rg_uuid_2__; again __rg_uuid_1__',
    )
    expect(first.ids.size).toBe(2)
  })

  it('keys the same model request identically across seeds, and differs by model', () => {
    expect(
      modelOutputKey({ modelId: 'muse', prompt: `chunk ${A}` }),
    ).toBe(modelOutputKey({ modelId: 'muse', prompt: `chunk ${B}` }))
    expect(
      modelOutputKey({ modelId: 'muse', prompt: `chunk ${A}` }),
    ).not.toBe(modelOutputKey({ modelId: 'other', prompt: `chunk ${A}` }))
  })

  it('rewrites nested recorded UUIDs to the current seed UUIDs', () => {
    const rewritten = rewriteRecordedOutput(
      {
        edges: [
          { fromNodeId: A, toNodeId: B, evidenceChunkId: C },
          'again ' + A,
        ],
        untouched: 'no id here',
      },
      new Map([
        [A, C],
        [B, D],
      ]),
    )

    expect(rewritten).toEqual({
      edges: [
        { fromNodeId: C, toNodeId: D, evidenceChunkId: C },
        'again ' + C,
      ],
      untouched: 'no id here',
    })
  })
})
