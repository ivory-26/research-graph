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
  // PDF coordinate origin is bottom-left (y=0 at bottom).
  // Dynamic geometry: derive margins adaptively from item coordinates rather than hardcoding 792pt Letter.
  const nonEmpty = items.filter((i) => i.str && i.str.trim().length > 0)
  if (nonEmpty.length === 0) {
    return ''
  }

  const minY = Math.min(...nonEmpty.map((i) => i.y))
  const maxY = Math.max(...nonEmpty.map((i) => i.y))

  // Footers sit in the lower 30pt; running headers sit in the topmost band above 735pt
  const footerThreshold = Math.max(30, minY < 45 ? minY + 10 : 30)

  const valid = nonEmpty.filter((i) => {
    if (i.y < footerThreshold && i.y < 45) return false
    // Filter extreme running headers (above 735pt and near maxY) while preserving body text on taller A4 pages
    if (i.y > 735 && i.y >= maxY - 15) return false
    return true
  })

  if (valid.length === 0) {
    return ''
  }

  // 2. Multi-column and regional layout analysis
  // In typical two-column papers (A4 width 595pt, margin ~50pt):
  // Left column items have maxX < 305pt, Right column items have minX > 295pt.
  const gutterX = 300
  const isLeft = (i: TextItem) => i.x + (i.width || 0) < 305
  const isRight = (i: TextItem) => i.x > 295
  const isSpanning = (i: TextItem) => i.x < 240 && i.x + (i.width || 0) > 360

  const allLeft = valid.filter(isLeft)
  const allRight = valid.filter(isRight)
  const allSpanning = valid.filter(isSpanning)

  let orderedLines: Line[] = []

  // Check 1: Does the page have a top banner (title/abstract/spanning items) with two columns below?
  // We identify the lowest y of the spanning header/abstract block.
  let hasTwoColBelowBanner = false
  let bannerCutoffY = Infinity

  if (allSpanning.length > 0) {
    const minSpanningY = Math.min(...allSpanning.map((i) => i.y))
    const bodyItems = valid.filter((i) => i.y < minSpanningY - 1)
    const bodyLeft = bodyItems.filter(isLeft)
    const bodyRight = bodyItems.filter(isRight)
    const bodySpanning = bodyItems.filter(isSpanning)

    if (
      bodyLeft.length >= 6 &&
      bodyRight.length >= 6 &&
      bodySpanning.length <= Math.max(1, bodyItems.length * 0.05)
    ) {
      hasTwoColBelowBanner = true
      bannerCutoffY = minSpanningY - 1
    }
  }

  // Check 2: Is the entire page a standard two-column layout (e.g. page 2+ of two-column paper)?
  const isFullTwoCol =
    !hasTwoColBelowBanner &&
    allLeft.length >= 15 &&
    allRight.length >= 15 &&
    allSpanning.length < valid.length * 0.15

  if (hasTwoColBelowBanner) {
    // Top banner items (title, authors, abstract) read first across the full width
    const topLines = groupItemsIntoLines(valid.filter((i) => i.y >= bannerCutoffY))
    // Below banner: column 1 read top-to-bottom, then column 2 read top-to-bottom
    const col1Lines = groupItemsIntoLines(
      valid.filter((i) => i.x < gutterX && i.y < bannerCutoffY),
    )
    const col2Lines = groupItemsIntoLines(
      valid.filter((i) => i.x >= gutterX && i.y < bannerCutoffY),
    )
    orderedLines = [...topLines, ...col1Lines, ...col2Lines]
  } else if (isFullTwoCol) {
    // If there are any top-spanning items (e.g. section header), keep them on top
    const topCutoffY =
      allSpanning.length > 0
        ? Math.min(...allSpanning.map((i) => i.y))
        : Infinity

    if (topCutoffY < Infinity && topCutoffY > maxY - 150) {
      const topLines = groupItemsIntoLines(valid.filter((i) => i.y >= topCutoffY))
      const col1Lines = groupItemsIntoLines(
        valid.filter((i) => i.x < gutterX && i.y < topCutoffY),
      )
      const col2Lines = groupItemsIntoLines(
        valid.filter((i) => i.x >= gutterX && i.y < topCutoffY),
      )
      orderedLines = [...topLines, ...col1Lines, ...col2Lines]
    } else {
      const col1Lines = groupItemsIntoLines(valid.filter((i) => i.x < gutterX))
      const col2Lines = groupItemsIntoLines(valid.filter((i) => i.x >= gutterX))
      orderedLines = [...col1Lines, ...col2Lines]
    }
  } else {
    // Single column page (e.g. Kursa 2010 Boruta, or front-matter page with no columns)
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
