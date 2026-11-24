import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  embedChunks,
  embedChunksForWorkspace,
  embedQuery,
  embedQueryForWorkspace,
  DEFAULT_EMBEDDING_DIMENSIONS,
} from './embed'
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
      transaction: vi.fn(async (cb) => cb(fakeDb)),
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

  it('joins sources table when workspaceId is supplied for isolation', async () => {
    const mockInnerJoin = vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(async () => []),
        })),
      })),
    }))

    const fakeDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          innerJoin: mockInnerJoin,
        })),
      })),
    } as unknown as Database

    const queryVec = new Array(768).fill(0.01)
    await searchSimilarChunks(fakeDb, {
      queryEmbedding: queryVec,
      workspaceId: 'ws-tenant-1',
      topK: 3,
    })

    expect(mockInnerJoin).toHaveBeenCalled()
  })

  it('records agent_tasks rows when workspaceId is provided, estimates tokens when usage is undefined, and passes maxRetries: 0', async () => {
    const insertedTasks: any[] = []
    const fakeStore = {
      insert: vi.fn(async (task) => {
        insertedTasks.push(task)
        return { id: 'task-1' }
      }),
    }

    let capturedArgs: any = null
    const fakeEmbedMany = vi.fn(async (args) => {
      capturedArgs = args
      return {
        embeddings: [new Array(768).fill(0.1)],
        usage: undefined, // Google doEmbed returns usage: void 0 in production
      }
    })

    const fakeResolveModel = vi.fn((): any => ({ modelId: 'gemini-embedding-2' }))

    await embedChunks(
      ['Text to embed with length of 30 characters'],
      {
        workspaceId: 'ws-record-1',
        taskStore: fakeStore,
      },
      {
        embedManyFn: fakeEmbedMany as any,
        resolveModel: fakeResolveModel,
      },
    )

    // ADR 0009 invariant: maxRetries: 0 so AI SDK does not generate multiple physical calls for one row
    expect(capturedArgs?.maxRetries).toBe(0)

    expect(fakeStore.insert).toHaveBeenCalledTimes(1)
    expect(insertedTasks[0].taskKind).toBe('ingest')
    expect(insertedTasks[0].status).toBe('succeeded')
    expect(insertedTasks[0].model).toBe('gemini-embedding-2')
    // Estimated tokens from text length: ceil(43 / 4) = 11
    expect(insertedTasks[0].promptTokens).toBeGreaterThan(0)
    expect(insertedTasks[0].costUsd).toBeDefined()
  })

  it('records failed task row and throws when returned embedding has mismatched dimensions', async () => {
    const insertedTasks: any[] = []
    const fakeStore = {
      insert: vi.fn(async (task) => {
        insertedTasks.push(task)
        return { id: 'task-err-1' }
      }),
    }

    const fakeEmbedMany = vi.fn(async () => ({
      embeddings: [new Array(512).fill(0.1)], // 512 dimensions instead of 768
      usage: undefined,
    }))

    await expect(
      embedChunks(
        ['Some chunk'],
        {
          dimensions: 768,
          workspaceId: 'ws-dim-fail',
          taskStore: fakeStore,
        },
        {
          embedManyFn: fakeEmbedMany as any,
          resolveModel: () => ({} as any),
        },
      ),
    ).rejects.toThrow(/Embedding returned 512 dimensions, expected 768/)

    // Invariant: failure row is recorded, never a success row!
    expect(fakeStore.insert).toHaveBeenCalledTimes(1)
    expect(insertedTasks[0].status).toBe('failed')
    expect(insertedTasks[0].error).toContain('Embedding returned 512 dimensions, expected 768')
  })

  it('surfaces taskStore insertion errors rather than silently swallowing them', async () => {
    const fakeStore = {
      insert: vi.fn(async () => {
        throw new Error('Database connection down')
      }),
    }

    const fakeEmbedMany = vi.fn(async () => ({
      embeddings: [new Array(768).fill(0.1)],
      usage: undefined,
    }))

    await expect(
      embedChunks(
        ['Some text'],
        {
          workspaceId: 'ws-store-fail',
          taskStore: fakeStore,
        },
        {
          embedManyFn: fakeEmbedMany as any,
          resolveModel: () => ({} as any),
        },
      ),
    ).rejects.toThrow('Database connection down')
  })

  it('provides production workspace wrappers requiring workspaceId', async () => {
    const fakeStore = {
      insert: vi.fn(async () => ({ id: 'task-wrap-1' })),
    }

    const fakeEmbedMany = vi.fn(async () => ({
      embeddings: [new Array(768).fill(0.1)],
      usage: undefined,
    }))

    const results = await embedChunksForWorkspace(
      'ws-mandatory',
      ['Text wrapped'],
      { taskStore: fakeStore },
      {
        embedManyFn: fakeEmbedMany as any,
        resolveModel: () => ({} as any),
      },
    )

    expect(results).toHaveLength(1)
    expect(fakeStore.insert).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-mandatory' }),
    )
  })
})

/**
 * Acceptance test verifying real embedding & stored vector search across Strobl 2007 chunks.
 *
 * How to run live against Neon database:
 * DATABASE_URL="postgresql://..." GEMINI_API_KEY="AIza..." pnpm vitest run src/server/ingest/embed.test.ts
 */
describe('Issue #11 Acceptance Test: Real Embedding & Stored Vector Search', () => {
  const hasDb = Boolean(process.env.DATABASE_URL)
  const hasKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY)
  const stroblPdf = path.resolve(process.cwd(), 'fixtures/papers/strobl-2007.pdf')
  const canRun = hasDb && hasKey && fs.existsSync(stroblPdf)

  it.skipIf(!canRun)(
    'embeds real chunks from Strobl 2007, stores in Neon, and searches for permutation vs impurity importance',
    async () => {
      const { getDb } = await import('../../db/client')
      const { sources, sourceChunks, workspaces } = await import('../../db/schema')
      const { eq } = await import('drizzle-orm')
      const { ingestPdf } = await import('./pdf')

      const db = getDb()
      const testWsId = crypto.randomUUID()
      const testSourceId = crypto.randomUUID()

      try {
        // 1. Ingest real Strobl 2007 chunks
        const buf = fs.readFileSync(stroblPdf)
        const { chunks } = await ingestPdf(buf)
        expect(chunks.length).toBeGreaterThan(0)

        // Take first 5 chunks to keep test fast and conservative on credits
        const testChunks = chunks.slice(0, 5)

        // 2. Insert test workspace and source
        await db.insert(workspaces).values({
          id: testWsId,
          name: 'Issue 11 Test Workspace',
          slug: `test-ws-${Date.now()}`,
        })

        await db.insert(sources).values({
          id: testSourceId,
          workspaceId: testWsId,
          kind: 'paper',
          title: 'Strobl 2007 Bias in Random Forest Importance',
          url: 'https://bmcbioinformatics.biomedcentral.com/articles/10.1186/1471-2105-8-25',
          sha256: 'test-sha256',
          bytes: buf.length,
          meta: {},
        })

        // 3. Embed real chunks with gemini-embedding-2 (768d)
        const embeddings = await embedChunks(testChunks, { workspaceId: testWsId })
        expect(embeddings.length).toBe(testChunks.length)
        expect(embeddings[0].length).toBe(768)

        // 4. Store chunks in database
        const stored = await storeChunks(db, testSourceId, testChunks, embeddings)
        expect(stored.length).toBe(testChunks.length)

        // 5. Embed query and search similar chunks
        const query = 'permutation versus impurity importance'
        const queryEmbedding = await embedQuery(query, { workspaceId: testWsId })
        expect(queryEmbedding.length).toBe(768)

        const searchResults = await searchSimilarChunks(db, {
          queryEmbedding,
          workspaceId: testWsId,
          topK: 3,
        })

        expect(searchResults.length).toBeGreaterThan(0)
        expect(searchResults[0].similarity).toBeGreaterThan(0.5)
        expect(searchResults[0].chunk.sourceId).toBe(testSourceId)
        expect(searchResults[0].chunk.page).toBeGreaterThanOrEqual(1)

        // Content relevance assertion: top returned passage must discuss variable importance in random forests
        const topChunkText = searchResults[0].chunk.text.toLowerCase()
        expect(topChunkText).toMatch(/importance|variable|forest|rf/)
      } finally {
        // Cleanup test data
        await db.delete(sourceChunks).where(eq(sourceChunks.sourceId, testSourceId)).catch(() => {})
        await db.delete(sources).where(eq(sources.id, testSourceId)).catch(() => {})
        await db.delete(workspaces).where(eq(workspaces.id, testWsId)).catch(() => {})
      }
    },
    30000,
  )
})
