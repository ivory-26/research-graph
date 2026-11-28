import { describe, expect, it } from 'vitest'
import {
  GRAPH_CARD_HEIGHT,
  GRAPH_CARD_WIDTH,
  GRAPH_COLUMN_WIDTH,
  GRAPH_ROW_HEIGHT,
  layoutGraphNodes,
  type GraphLayoutNode,
  type GraphLayoutPosition,
} from './graph-layout'

function node(
  id: string,
  type: string,
  positionX = 0,
  positionY = 0,
): GraphLayoutNode {
  return { id, type, positionX, positionY }
}

function positionOf(
  layout: ReturnType<typeof layoutGraphNodes>,
  id: string,
): GraphLayoutPosition {
  const position = layout.get(id)
  if (!position) throw new Error(`node ${id} was not laid out`)
  return position
}

function cardsOverlap(a: GraphLayoutPosition, b: GraphLayoutPosition): boolean {
  return Math.abs(a.x - b.x) < GRAPH_CARD_WIDTH && Math.abs(a.y - b.y) < GRAPH_CARD_HEIGHT
}

function expectNoOverlap(nodes: readonly GraphLayoutNode[]): void {
  const layout = layoutGraphNodes(nodes)
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = positionOf(layout, nodes[i].id)
      const b = positionOf(layout, nodes[j].id)
      expect(
        cardsOverlap(a, b),
        `${nodes[i].id} ${JSON.stringify(a)} overlaps ${nodes[j].id} ${JSON.stringify(b)}`,
      ).toBe(false)
    }
  }
}

/** The seeded hero workspace: claim at the origin, both attempt-1 runs projected onto it. */
function seededRunPair(): GraphLayoutNode[] {
  return [
    node('claim', 'claim'),
    node('run-a', 'run', 260, 160),
    node('result-a', 'result', 520, 160),
    node('run-b', 'run', 260, 160),
    node('result-b', 'result', 520, 160),
  ]
}

describe('layoutGraphNodes', () => {
  it('preserves authored coordinates when they are unique', () => {
    const nodes = [
      node('claim', 'claim', 40, 120),
      node('method', 'method', 300, 120),
      node('run-a', 'run', 560, 160),
      node('result-a', 'result', 820, 160),
    ]

    const layout = layoutGraphNodes(nodes)

    expect(positionOf(layout, 'claim')).toEqual({ x: 40, y: 120 })
    expect(positionOf(layout, 'method')).toEqual({ x: 300, y: 120 })
    expect(positionOf(layout, 'run-a')).toEqual({ x: 560, y: 160 })
    expect(positionOf(layout, 'result-a')).toEqual({ x: 820, y: 160 })
  })

  it('separates the two stored attempt-1 runs and results projected from the same claim', () => {
    const nodes = seededRunPair()
    const layout = layoutGraphNodes(nodes)

    expect(positionOf(layout, 'run-a')).toEqual({ x: 260, y: 160 })
    expect(positionOf(layout, 'result-a')).toEqual({ x: 520, y: 160 })

    const runB = positionOf(layout, 'run-b')
    const resultB = positionOf(layout, 'result-b')
    expect(runB).not.toEqual({ x: 260, y: 160 })
    expect(resultB).not.toEqual({ x: 520, y: 160 })

    // Run and result stay on one row, one column stride apart.
    expect(runB.y).toBe(resultB.y)
    expect(resultB.x - runB.x).toBe(GRAPH_COLUMN_WIDTH)
    expect(runB.y - 160).toBeGreaterThanOrEqual(GRAPH_CARD_HEIGHT)

    expectNoOverlap(nodes)
  })

  it('is deterministic for the same rows in the same order', () => {
    const nodes = seededRunPair()
    const first = layoutGraphNodes(nodes)
    const second = layoutGraphNodes(nodes)
    expect([...second.entries()]).toEqual([...first.entries()])
  })

  it('starts fallback columns clear of every stored card', () => {
    const nodes = [
      node('run-a', 'run', 260, 160),
      node('result-a', 'result', 520, 160),
      node('claim', 'claim'),
      node('source', 'source'),
      node('method', 'method'),
    ]

    const layout = layoutGraphNodes(nodes)
    const fallback = ['claim', 'source', 'method'].map((id) => positionOf(layout, id))
    const storedRightEdge = 520 + GRAPH_CARD_WIDTH

    for (const position of fallback) {
      expect(position.x).toBeGreaterThanOrEqual(storedRightEdge)
    }
    expectNoOverlap(nodes)
  })

  it('keeps a 65-node seeded workspace narrow and overlap-free', () => {
    const nodes: GraphLayoutNode[] = [
      ...Array.from({ length: 3 }, (_, i) => node(`source-${i}`, 'source')),
      ...Array.from({ length: 35 }, (_, i) => node(`claim-${i}`, 'claim')),
      ...Array.from({ length: 3 }, (_, i) => node(`note-${i}`, 'note')),
      ...Array.from({ length: 13 }, (_, i) => node(`method-${i}`, 'method')),
      ...Array.from({ length: 7 }, (_, i) => node(`dataset-${i}`, 'dataset')),
      node('run-a', 'run', 260, 160),
      node('result-a', 'result', 520, 160),
      node('run-b', 'run', 260, 160),
      node('result-b', 'result', 520, 160),
    ]
    expect(nodes).toHaveLength(65)

    const layout = layoutGraphNodes(nodes)
    expect(layout.size).toBe(65)

    const xs = [...layout.values()].map((position) => position.x)
    const maxX = Math.max(...xs)
    const maxRightEdge = Math.max(
      ...[...layout.values()].map((p) => p.x + GRAPH_CARD_WIDTH),
    )

    // The pre-#18 grid used five rows per group and reached ~3930px. The
    // claim group dominates, so 13 rows per column keeps it well under that.
    expect(maxX).toBeLessThan(2250)
    expect(maxRightEdge).toBeLessThan(2500)

    const fallback = nodes.filter((n) => n.positionX === 0 && n.positionY === 0)
    for (const n of fallback) {
      expect(positionOf(layout, n.id).x).toBeGreaterThanOrEqual(520 + GRAPH_CARD_WIDTH)
    }

    expectNoOverlap(nodes)
  })

  it('gives wrapped claim cards a full card height of vertical room', () => {
    const claims = Array.from({ length: 13 }, (_, i) => node(`claim-${i}`, 'claim'))
    const layout = layoutGraphNodes(claims)

    const column = claims
      .map((claim) => ({ id: claim.id, ...positionOf(layout, claim.id) }))
      .filter((position) => position.x === positionOf(layout, 'claim-0').x)
      .sort((a, b) => a.y - b.y)

    expect(column.length).toBeGreaterThan(1)
    for (let i = 1; i < column.length; i += 1) {
      expect(column[i].y - column[i - 1].y).toBeGreaterThanOrEqual(GRAPH_CARD_HEIGHT)
    }
    expect(GRAPH_ROW_HEIGHT).toBeGreaterThanOrEqual(GRAPH_CARD_HEIGHT)
  })
})
