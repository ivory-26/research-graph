import type { TextItem } from './types'

interface Line {
  y: number
  items: TextItem[]
  minX: number
  maxX: number
  centerX: number
}

/**
 * Reconstructs visual reading order from raw PDF text-item coordinates.
 *
 * Handles:
 * - Running headers and footers filtering
 * - Automatic 2-column vs single-column page detection
 * - Top-spanning banners (title, abstract) before columns
 * - Natural column reading order: Left Column (top to bottom) -> Right Column (top to bottom)
 * - Horizontal line clustering with baseline alignment tolerance
 * - De-hyphenation across line breaks (e.g. "sta-\ntistical" -> "statistical")
 * - Paragraph separation based on vertical line gaps
 */
export function extractPageReadingOrder(items: TextItem[]): string {
  // 1. Filter out empty whitespace items and page-edge running header/footer artifacts
  // PDF coordinate origin is bottom-left (y=0 at bottom, y=792+ at top of standard letter/A4)
  const valid = items.filter(
    (i) => i.str && i.str.trim().length > 0 && i.y > 32 && i.y < 735,
  )

  if (valid.length === 0) {
    return ''
  }

  // 2. Multi-column detection
  // In typical two-column papers (A4 width 595pt, margin ~50pt):
  // Left column items have maxX < 305pt, Right column items have minX > 295pt.
  const gutterX = 300
  const leftItems = valid.filter((i) => i.x + (i.width || 0) < 305)
  const rightItems = valid.filter((i) => i.x > 295)
  const spanningItems = valid.filter(
    (i) => i.x < 240 && i.x + (i.width || 0) > 360,
  )

  const isTwoCol =
    leftItems.length >= 15 &&
    rightItems.length >= 15 &&
    spanningItems.length < valid.length * 0.2

  let orderedLines: Line[] = []

  if (isTwoCol) {
    // If top spanning items exist (e.g. title/authors on page 1), find their lowest y
    const topSpanning = spanningItems.filter((i) => i.y > 500)
    const topCutoffY =
      topSpanning.length > 0 ? Math.min(...topSpanning.map((i) => i.y)) : Infinity

    const topLines = groupItemsIntoLines(
      valid.filter((i) => i.y >= topCutoffY),
    )
    const col1Lines = groupItemsIntoLines(
      valid.filter((i) => i.x < gutterX && i.y < topCutoffY),
    )
    const col2Lines = groupItemsIntoLines(
      valid.filter((i) => i.x >= gutterX && i.y < topCutoffY),
    )

    orderedLines = [...topLines, ...col1Lines, ...col2Lines]
  } else {
    orderedLines = groupItemsIntoLines(valid)
  }

  return formatLinesToText(orderedLines)
}

/**
 * Clusters text items into horizontal lines based on y-coordinate proximity.
 */
function groupItemsIntoLines(items: TextItem[], baselineTolerance = 3.5): Line[] {
  const lines: Line[] = []
  // Sort items top-to-bottom
  const sorted = [...items].sort((a, b) => b.y - a.y)

  for (const item of sorted) {
    const matchingLine = lines.find(
      (l) => Math.abs(l.y - item.y) <= baselineTolerance,
    )
    if (matchingLine) {
      matchingLine.items.push(item)
    } else {
      lines.push({
        y: item.y,
        items: [item],
        minX: 0,
        maxX: 0,
        centerX: 0,
      })
    }
  }

  // Sort each line horizontally (left-to-right) and compute bounds
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x)
    line.minX = Math.min(...line.items.map((i) => i.x))
    line.maxX = Math.max(...line.items.map((i) => i.x + (i.width || 0)))
    line.centerX = (line.minX + line.maxX) / 2
  }

  // Sort lines top-to-bottom
  lines.sort((a, b) => b.y - a.y)
  return lines
}

/**
 * Formats structured lines into coherent paragraph text with de-hyphenation.
 */
function formatLinesToText(lines: Line[]): string {
  if (lines.length === 0) return ''

  const output: string[] = []
  let currentParagraph = ''

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]
    const nextLine = lines[idx + 1]

    // Join text items on the line with spaces if needed
    let lineStr = ''
    for (let i = 0; i < line.items.length; i++) {
      const item = line.items[i]
      const prev = line.items[i - 1]
      if (prev) {
        const gap = item.x - (prev.x + (prev.width || 0))
        // Add a space if there's a positive gap between items
        if (gap > 1.5 && !prev.str.endsWith(' ') && !item.str.startsWith(' ')) {
          lineStr += ' '
        }
      }
      lineStr += item.str
    }
    lineStr = lineStr.trim().replace(/\s+/g, ' ')
    if (!lineStr) continue

    // Handle line joining and hyphenation
    if (!currentParagraph) {
      currentParagraph = lineStr
    } else if (currentParagraph.endsWith('-') && /^[a-z]/.test(lineStr)) {
      // De-hyphenate: "sta-" + "tistical" -> "statistical"
      currentParagraph = currentParagraph.slice(0, -1) + lineStr
    } else {
      currentParagraph += ' ' + lineStr
    }

    // Determine if this line ends a paragraph
    if (nextLine) {
      const verticalGap = line.y - nextLine.y
      // If there is an abnormally large gap (> 18pt) between consecutive lines,
      // or if line was in col1 and next is in col2, flush paragraph.
      const columnChange = Math.abs(line.centerX - nextLine.centerX) > 100
      if (verticalGap > 18 || columnChange) {
        output.push(currentParagraph.trim())
        currentParagraph = ''
      }
    } else {
      output.push(currentParagraph.trim())
    }
  }

  return output.filter(Boolean).join('\n\n')
}
