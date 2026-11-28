/**
 * Deterministic placement for persisted graph nodes (#18).
 *
 * `nodes.position_x/y` default to `(0, 0)`, and the seed leaves most rows there.
 * `projectRunToGraph` writes each run/result node from the claim's *stored*
 * position, so two attempt-1 runs projected from the same unpositioned claim
 * land on exactly the same coordinates. Keeping the first row and moving the
 * rest is therefore not enough: stored rows can coincide with stored rows.
 *
 * This module turns the raw rows into positions that:
 *
 * - keep every authored (non-zero) position as-is, so a dragged layout is never
 *   rewritten;
 * - move a stored node only when it sits exactly on an earlier stored node, and
 *   only as far down as needed to clear every card it would otherwise touch;
 * - place origin nodes in deterministic columns grouped by node type, starting
 *   clear of every stored card's right edge;
 * - size the grid from the real cards in `src/components/canvas/CustomNodes.tsx`.
 *   The claim card is both the widest (230px) and the tallest (its title wraps),
 *   so a multi-line claim cannot run into the row below it.
 *
 * Pure and order-driven: the same rows in the same order always produce the
 * same positions.
 */

/** Widest card: the claim card renders at `w-[230px]`. */
export const GRAPH_CARD_WIDTH = 230
/** Tallest card: the claim card's wrapping title, measured at up to ~190px. */
export const GRAPH_CARD_HEIGHT = 200
/** Column stride: card width plus a readable gap. */
export const GRAPH_COLUMN_WIDTH = 260
/** Row stride: card height plus a readable gap. */
export const GRAPH_ROW_HEIGHT = 220
/** Rows per fallback column. Taller columns keep a 65-node seed narrow. */
export const GRAPH_MAX_ROWS_PER_COLUMN = 13

/** Space after the last stored card before the first fallback column. */
const STORED_GAP = 60
/** Gap between one type group's columns and the next group's first column. */
const GROUP_GAP = 40
const ORIGIN_X = 40
const ORIGIN_Y = 80

const GROUP_ORDER = ['source', 'claim', 'method_dataset', 'run', 'result'] as const
type NodeGroup = (typeof GROUP_ORDER)[number]

export interface GraphLayoutNode {
  id: string
  type: string
  positionX: number
  positionY: number
}

export interface GraphLayoutPosition {
  x: number
  y: number
}

export type GraphLayout = Map<string, GraphLayoutPosition>

function groupOf(type: string): NodeGroup {
  if (type === 'source') return 'source'
  if (type === 'method' || type === 'dataset') return 'method_dataset'
  if (type === 'run') return 'run'
  if (type === 'result') return 'result'
  return 'claim'
}

function hasStoredPosition(node: GraphLayoutNode): boolean {
  return node.positionX !== 0 || node.positionY !== 0
}

function overlaps(a: GraphLayoutPosition, b: GraphLayoutPosition): boolean {
  return (
    Math.abs(a.x - b.x) < GRAPH_CARD_WIDTH && Math.abs(a.y - b.y) < GRAPH_CARD_HEIGHT
  )
}

/**
 * Places every node, preserving stored positions where they are unique.
 *
 * Stored nodes are handled first because the fallback columns must clear their
 * right edge. A duplicate is pushed straight down in `GRAPH_ROW_HEIGHT` steps;
 * runs and results projected from the same claim therefore move together and
 * stay on the same row.
 */
export function layoutGraphNodes(nodes: readonly GraphLayoutNode[]): GraphLayout {
  const positions: GraphLayout = new Map()
  const occupied: GraphLayoutPosition[] = []
  const storedOriginals: GraphLayoutPosition[] = []

  for (const node of nodes) {
    if (hasStoredPosition(node)) {
      storedOriginals.push({ x: node.positionX, y: node.positionY })
    }
  }

  for (const node of nodes) {
    if (!hasStoredPosition(node)) continue

    let candidate: GraphLayoutPosition = { x: node.positionX, y: node.positionY }
    // Only an exact coincidence is rearranged. Two authored positions that
    // merely sit close together are left where their author put them.
    const coincident = occupied.some(
      (placed) => placed.x === candidate.x && placed.y === candidate.y,
    )
    if (coincident) {
      let step = 0
      do {
        step += 1
        candidate = {
          x: node.positionX,
          y: node.positionY + step * GRAPH_ROW_HEIGHT,
        }
      } while (
        occupied.some((placed) => overlaps(candidate, placed)) ||
        storedOriginals.some(
          (original) =>
            !(original.x === node.positionX && original.y === node.positionY) &&
            overlaps(candidate, original),
        )
      )
    }

    positions.set(node.id, candidate)
    occupied.push(candidate)
  }

  const originCounts = new Map<NodeGroup, number>()
  for (const node of nodes) {
    if (hasStoredPosition(node)) continue
    const group = groupOf(node.type)
    originCounts.set(group, (originCounts.get(group) ?? 0) + 1)
  }

  let storedRightEdge = -Infinity
  for (const positioned of positions.values()) {
    storedRightEdge = Math.max(storedRightEdge, positioned.x + GRAPH_CARD_WIDTH)
  }

  const groupStartX = new Map<NodeGroup, number>()
  let cursorX = Number.isFinite(storedRightEdge)
    ? storedRightEdge + STORED_GAP
    : ORIGIN_X
  for (const group of GROUP_ORDER) {
    const count = originCounts.get(group) ?? 0
    if (count === 0) continue
    groupStartX.set(group, cursorX)
    const columns = Math.ceil(count / GRAPH_MAX_ROWS_PER_COLUMN)
    cursorX += columns * GRAPH_COLUMN_WIDTH + GROUP_GAP
  }

  const placedInGroup = new Map<NodeGroup, number>()
  for (const node of nodes) {
    if (hasStoredPosition(node)) continue
    const group = groupOf(node.type)
    const index = placedInGroup.get(group) ?? 0
    placedInGroup.set(group, index + 1)
    const column = Math.floor(index / GRAPH_MAX_ROWS_PER_COLUMN)
    const row = index % GRAPH_MAX_ROWS_PER_COLUMN
    positions.set(node.id, {
      x: (groupStartX.get(group) ?? ORIGIN_X) + column * GRAPH_COLUMN_WIDTH,
      y: ORIGIN_Y + row * GRAPH_ROW_HEIGHT,
    })
  }

  return positions
}
