import { describe, expect, it, vi } from 'vitest'
import { embedChunks, embedQuery, DEFAULT_EMBEDDING_DIMENSIONS } from './embed'
import { searchSimilarChunks, storeChunks } from './store'
import type { Chunk } from './types'
import type { Database } from '../../db/client'

describe('embedChunks (Batching and dimensions per Issue #11)', () => {
  it('batches requests into groups of at most 20 chunks', async () => {
    // 45 dummy chunks
    const chunks: Chunk[] = Array.from({ length: 45 }, (_, i) => ({
      ordinal: i,
      text: `Chunk text ${i}`,
      page: Math.floor(i / 2) + 1,
      charStart: i * 100,
      charEnd: (i + 1) * 100,
      tokenCount: 25,
    }))

    const batchCalls: number[] = []

    const mockEmbedMany = vi.fn(async ({ values }: { values: string[] }) => {
      batchCalls.push(values.length)
      return {
        embeddings: values.map(() => new Array(768).fill(0.01)),
      }
    })

    const embeddings = await embedChunks(chunks, { batchSize: 20 }, {
      // @ts-expect-error test mock injection
      embedManyFn: mockEmbedMany,
      resolveModel: () => ({} as any),
    })

    expect(embeddings.length).toBe(45)
    // 45 items with batchSize 20 should produce 3 batches: 20, 20, 5
    expect(batchCalls).toEqual([20, 20, 5])
    expect(mockEmbedMany).toHaveBeenCalledTimes(3)

    // Verify all returned vectors are 768 dimensions
    for (const vec of embeddings) {
      expect(vec.length).toBe(DEFAULT_EMBEDDING_DIMENSIONS)
    }
  })

  it('rejects embeddings with mismatched dimensionality', async () => {
    const mockEmbedMany = vi.fn(async ({ values }: { values: string[] }) => ({
      embeddings: values.map(() => new Array(512).fill(0.01)), // 512 instead of 768
    }))

    await expect(
      embedChunks(['sample text'], { dimensions: 768 }, {
        // @ts-expect-error test mock injection
        embedManyFn: mockEmbedMany,
        resolveModel: () => ({} as any),
      }),
    ).rejects.toThrow(/Embedding returned 512 dimensions, expected 768/)
  })

  it('returns empty array when given empty list without calling model', async () => {
    const mockEmbedMany = vi.fn()
    const result = await embedChunks([], {}, {
      embedManyFn: mockEmbedMany,
    })
    expect(result).toEqual([])
    expect(mockEmbedMany).not.toHaveBeenCalled()
  })

  it('embedQuery embeds a single query string', async () => {
    const mockEmbed = vi.fn(async () => ({
      embedding: new Array(768).fill(0.05),
    }))

    const queryVec = await embedQuery('how does impurity bias occur', {}, {
      // @ts-expect-error test mock injection
      embedFn: mockEmbed,
      resolveModel: () => ({} as any),
    })

    expect(queryVec.length).toBe(768)
    expect(mockEmbed).toHaveBeenCalledTimes(1)
  })

  it('embedQuery throws on empty or whitespace query', async () => {
    await expect(embedQuery('   ')).rejects.toThrow(/Query string cannot be empty/)
  })
})

describe('storeChunks (Database persistence validation)', () => {
  it('throws when chunk count and embedding count do not match', async () => {
    const fakeDb = {} as Database
    const chunks: Chunk[] = [
      { ordinal: 0, text: 'a', page: 1, charStart: 0, charEnd: 1, tokenCount: 1 },
    ]
    const embeddings: number[][] = [] // 0 embeddings

    await expect(storeChunks(fakeDb, 'fake-source-id', chunks, embeddings)).rejects.toThrow(
      /Chunk count \(1\) does not match embedding count \(0\)/,
    )
  })

  it('inserts chunks into source_chunks in batches', async () => {
    const insertedRows: any[] = []

    const fakeDb = {
      insert: vi.fn(() => ({
        values: vi.fn((batch: any[]) => ({
          returning: vi.fn(async () => {
            insertedRows.push(...batch)
            return batch.map((r, idx) => ({ id: `uuid-${idx}`, ...r }))
          }),
        })),
      })),
    } as unknown as Database

    const chunks: Chunk[] = [
      { ordinal: 0, text: 'chunk 0', page: 1, charStart: 0, charEnd: 7, tokenCount: 2 },
      { ordinal: 1, text: 'chunk 1', page: 1, charStart: 8, charEnd: 15, tokenCount: 2 },
    ]
    const embeddings = [
      new Array(768).fill(0.1),
      new Array(768).fill(0.2),
    ]

    const result = await storeChunks(fakeDb, 'source-123', chunks, embeddings)

    expect(result.length).toBe(2)
    expect(insertedRows.length).toBe(2)
    expect(insertedRows[0].sourceId).toBe('source-123')
    expect(insertedRows[0].ordinal).toBe(0)
    expect(insertedRows[0].text).toBe('chunk 0')
    expect(insertedRows[0].embedding).toEqual(embeddings[0])
    expect(insertedRows[1].ordinal).toBe(1)
  })
})

describe('searchSimilarChunks (Vector search query builder)', () => {
  it('validates queryEmbedding is provided', async () => {
    const fakeDb = {} as Database
    await expect(
      searchSimilarChunks(fakeDb, { queryEmbedding: [] }),
    ).rejects.toThrow(/queryEmbedding is required/)
  })

  it('queries database with cosine distance and returns scored chunks', async () => {
    const mockRows = [
      {
        chunk: { id: 'c1', text: 'high-cardinality bias', page: 4, ordinal: 5 },
        similarity: 0.92,
      },
      {
        chunk: { id: 'c2', text: 'permutation importance', page: 7, ordinal: 9 },
        similarity: 0.81,
      },
    ]

    const fakeDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(async () => mockRows),
            })),
          })),
        })),
      })),
    } as unknown as Database

    const queryVec = new Array(768).fill(0.01)
    const results = await searchSimilarChunks(fakeDb, {
      queryEmbedding: queryVec,
      sourceId: 'src-1',
      topK: 2,
    })

    expect(results.length).toBe(2)
    expect(results[0].chunk.id).toBe('c1')
    expect(results[0].similarity).toBe(0.92)
    expect(results[1].similarity).toBe(0.81)
  })
})
