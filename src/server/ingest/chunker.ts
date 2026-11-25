import type { Chunk, ChunkOptions, ExtractedPage } from './types'

const DEFAULT_TARGET_TOKENS = 800
const DEFAULT_OVERLAP_RATIO = 0.15
const DEFAULT_CHARS_PER_TOKEN = 4

/**
 * Estimates the token count of a given string using the standard heuristic (~4 chars/token).
 */
export function estimateTokens(text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / charsPerToken))
}

/**
 * Splits document text into overlapping chunks (~800 tokens with 15% overlap)
 * while preserving paragraph and sentence boundaries and mapping chunks to their source pages.
 *
 * Implements Issue #10 contract rules:
 * - Target ~800 tokens per chunk
 * - 15% overlap between consecutive chunks (~120 tokens)
 * - Records `page`, `charStart`, `charEnd`, and sequential `ordinal`
 * - Clean semantic boundaries (never splits words or sentences unnecessarily)
 */
export function chunkDocument(
  fullText: string,
  pages: ExtractedPage[],
  options: ChunkOptions = {},
): Chunk[] {
  const targetTokens = options.targetTokens ?? DEFAULT_TARGET_TOKENS
  const overlapRatio = options.overlapRatio ?? DEFAULT_OVERLAP_RATIO
  const charsPerToken = options.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN

  const targetChars = targetTokens * charsPerToken
  const overlapChars = Math.round(targetChars * overlapRatio)

  if (!fullText || fullText.trim().length === 0) {
    return []
  }

  const chunks: Chunk[] = []
  let charStart = 0
  let ordinal = 0

  while (charStart < fullText.length) {
    // Tentative end boundary
    let charEnd = Math.min(charStart + targetChars, fullText.length)

    // If we haven't reached the end of the text, look for a clean boundary
    if (charEnd < fullText.length) {
      const boundary = findBestSplitBoundary(fullText, charStart, charEnd, targetChars)
      charEnd = boundary
    }

    const rawSlice = fullText.slice(charStart, charEnd)
    const leadingMatch = rawSlice.match(/^\s+/)
    const leadingOffset = leadingMatch ? leadingMatch[0].length : 0
    const trailingMatch = rawSlice.match(/\s+$/)
    const trailingOffset = trailingMatch ? trailingMatch[0].length : 0

    const chunkText = rawSlice.trim()
    // docs/03: "if a chunk contains no alphanumeric content it is dropped, not embedded"
    const hasAlphanumeric = /[a-zA-Z0-9]/.test(chunkText)
    if (chunkText.length > 0 && hasAlphanumeric) {
      const actualStart = charStart + leadingOffset
      const actualEnd = charEnd - trailingOffset
      const page = findPageForCharOffset(actualStart, pages)
      const tokenCount = estimateTokens(chunkText, charsPerToken)

      chunks.push({
        ordinal,
        text: chunkText,
        page,
        charStart: actualStart,
        charEnd: actualEnd,
        tokenCount,
      })
      ordinal++
    }

    if (charEnd >= fullText.length) {
      break
    }

    // Advance start position with overlap
    let nextStart = charEnd - overlapChars
    if (nextStart <= charStart) {
      nextStart = charStart + 1
    }

    // Snap nextStart forward to the next sentence or word boundary so the chunk starts cleanly
    const snappedStart = snapForwardToBoundary(fullText, nextStart, charEnd)
    charStart = snappedStart > charStart && snappedStart < charEnd ? snappedStart : nextStart
  }

  return chunks
}

/**
 * Finds the cleanest split point near targetEnd:
 * 1. Double newline (paragraph boundary)
 * 2. Sentence boundary (. ! ?)
 * 3. Word boundary (whitespace)
 */
function findBestSplitBoundary(
  text: string,
  start: number,
  tentativeEnd: number,
  targetLength: number,
): number {
  const minSearch = Math.max(start + Math.floor(targetLength * 0.7), start)
  const maxSearch = Math.min(start + Math.floor(targetLength * 1.3), text.length)
  const windowText = text.slice(minSearch, maxSearch)

  // 1. Search for paragraph boundary
  const paraMatch = windowText.lastIndexOf('\n\n')
  if (paraMatch !== -1) {
    return minSearch + paraMatch + 2
  }

  // 2. Search for sentence boundary (. ! ?) followed by whitespace or newline
  const sentenceRegex = /[.!?]\s+/g
  let match: RegExpExecArray | null
  let lastSentenceIndex = -1
  while ((match = sentenceRegex.exec(windowText)) !== null) {
    lastSentenceIndex = match.index + match[0].length
  }
  if (lastSentenceIndex !== -1) {
    return minSearch + lastSentenceIndex
  }

  // 3. Fall back to word boundary
  const spaceIndex = windowText.lastIndexOf(' ')
  if (spaceIndex !== -1) {
    return minSearch + spaceIndex + 1
  }

  return tentativeEnd
}

/**
 * Snaps a backward overlap start position forward to the next sentence or word start.
 */
function snapForwardToBoundary(text: string, tentativeStart: number, maxStart: number): number {
  const lookahead = text.slice(tentativeStart, Math.min(tentativeStart + 120, maxStart))

  // Check for sentence end followed by space
  const sentenceMatch = /[.!?]\s+/.exec(lookahead)
  if (sentenceMatch) {
    return tentativeStart + sentenceMatch.index + sentenceMatch[0].length
  }

  // Fall back to space
  const spaceIndex = lookahead.indexOf(' ')
  if (spaceIndex !== -1) {
    return tentativeStart + spaceIndex + 1
  }

  return tentativeStart
}

/**
 * Maps a character offset in the document to its 1-indexed page number.
 * Offsets falling inside an inter-page `\n\n` separator resolve to the nearest preceding page.
 */
function findPageForCharOffset(charOffset: number, pages: ExtractedPage[]): number {
  if (pages.length === 0) return 1

  let nearestPrecedingPage = pages[0].page
  for (const page of pages) {
    if (charOffset >= page.charStart && charOffset <= page.charEnd) {
      return page.page
    }
    if (charOffset > page.charEnd) {
      nearestPrecedingPage = page.page
    }
  }

  return nearestPrecedingPage
}
