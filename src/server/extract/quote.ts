import type { ChunkRef, ExtractedClaim, RejectedClaim, ValidatedClaim } from './types'

/**
 * Normalises text for verbatim quote comparison.
 *
 * Rules (docs/03-agent-pipeline.md):
 * - Collapses consecutive whitespace (spaces, newlines, tabs) into a single space
 * - Folds unicode smart quotes/apostrophes to ASCII equivalents
 * - Folds dashes/hyphens to ASCII '-'
 * - Trims leading and trailing whitespace
 */
export function normalizeQuote(text: string): string {
  if (!text) return ''

  return text
    // Replace non-breaking spaces
    .replace(/\u00A0/g, ' ')
    // Replace unicode single quotes / apostrophes
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    // Replace unicode double quotes
    .replace(/[\u201C\u201D\u201E\u201F«»]/g, '"')
    // Replace unicode dashes
    .replace(/[\u2013\u2014]/g, '-')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Verifies that a quote appears verbatim in the referenced chunk text
 * after whitespace and quote normalisation.
 *
 * No fuzzy matching or semantic guessing — if the exact characters do not exist
 * in the source chunk, the quote is invalid.
 */
export function verifyVerbatimQuote(quote: string, chunkText: string): boolean {
  const normQuote = normalizeQuote(quote)
  const normChunk = normalizeQuote(chunkText)

  if (normQuote.length === 0) {
    return false
  }

  // Exact normalized match first, followed by case-insensitive fallback for sentence-initial capitalization
  return (
    normChunk.includes(normQuote) ||
    normChunk.toLowerCase().includes(normQuote.toLowerCase())
  )
}

/**
 * Validates a list of extracted claims against source chunks.
 *
 * A claim whose quote is absent from its chunk is dropped and categorized as rejected.
 */
export function validateClaimQuotes(
  claims: ExtractedClaim[],
  chunks: ChunkRef[],
): { accepted: ValidatedClaim[]; rejected: RejectedClaim[] } {
  const accepted: ValidatedClaim[] = []
  const rejected: RejectedClaim[] = []

  // Create lookup maps by id and by ordinal
  const chunkMap = new Map<string, ChunkRef>()
  for (const chunk of chunks) {
    if (chunk.id) chunkMap.set(chunk.id, chunk)
    chunkMap.set(String(chunk.ordinal), chunk)
  }

  for (const claim of claims) {
    const rawQuote = claim.quote?.trim()
    if (!rawQuote) {
      rejected.push({ claim, reason: 'QUOTE_EMPTY' })
      continue
    }

    // Locate the referenced chunk
    let targetChunk = chunkMap.get(claim.chunkId)

    // Fallback: if not found by exact key, search by ordinal match or scan chunks
    if (!targetChunk) {
      const parsedOrdinal = parseInt(claim.chunkId, 10)
      if (!Number.isNaN(parsedOrdinal)) {
        targetChunk = chunks.find((c) => c.ordinal === parsedOrdinal)
      }
    }

    // If still not matched to a chunk, search if the quote uniquely exists in any chunk
    if (!targetChunk) {
      const matchingChunk = chunks.find((c) => verifyVerbatimQuote(claim.quote, c.text))
      if (matchingChunk) {
        targetChunk = matchingChunk
      }
    }

    if (!targetChunk) {
      rejected.push({ claim, reason: 'CHUNK_NOT_FOUND' })
      continue
    }

    // Strict verbatim validation in the target chunk
    const isVerbatim = verifyVerbatimQuote(claim.quote, targetChunk.text)

    if (isVerbatim) {
      accepted.push({
        ...claim,
        chunkOrdinal: targetChunk.ordinal,
        page: targetChunk.page ?? null,
        matchedQuote: normalizeQuote(claim.quote),
      })
    } else {
      rejected.push({ claim, reason: 'VERBATIM_QUOTE_NOT_FOUND' })
    }
  }

  return { accepted, rejected }
}
