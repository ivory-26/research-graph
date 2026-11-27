/**
 * Hero-claim selector contract for issue #8.
 *
 * The run orchestrator needs the real UUID of the claim node extracted from
 * Strobl 2007. The hand-written `HERO_EXPERIMENT_SPEC_RUN_A` uses the slug
 * `claim-strobl-2007-gini-bias`, which the database cannot store as
 * `experiments.claim_node_id`; after real ingestion the anchor is a random
 * UUID. This module resolves that UUID without inventing a claim and without
 * accepting a paraphrased quote.
 *
 * Matching rules (version 1):
 * - Compare with the production `normalizeQuote` only: collapse whitespace and
 *   fold smart quotes. No case folding, no fuzzy matching, no dash folding.
 * - A claim qualifies when its verbatim quote is exactly the verified anchor,
 *   contains the anchor, or is a contiguous fragment of the anchor of at least
 *   `HERO_CLAIM_MIN_FRAGMENT_LENGTH` characters.
 * - Identical `(normalised text, normalised quote)` duplicates collapse to the
 *   lowest claim node id; that is overlap duplication, not ambiguity.
 * - More than one distinct qualifying claim is an error, not a guess.
 *
 * The selector does not decide that a claim is true, only which extracted
 * claim is the hero. The quote was already accepted by the production
 * verbatim validator before it reached the `nodes` table.
 */
import { and, eq } from 'drizzle-orm'

import type { Database } from '../../src/db/client.ts'
import { nodes as nodesTable, sources as sourcesTable } from '../../src/db/schema.ts'
import { normalizeQuote } from '../../src/server/extract/quote.ts'
import {
  HERO_CLAIM_MIN_FRAGMENT_LENGTH,
  HERO_CLAIM_QUOTE_ANCHOR,
  HERO_CLAIM_SELECTOR_VERSION,
  HERO_SOURCE_DOI,
  type SeedHeroClaimCandidate,
  type SeedHeroClaimMatch,
  type SeedHeroClaimProblem,
  type SeedHeroClaimResolution,
  type SeedHeroClaimSelection,
} from './contracts.ts'

export interface RawHeroClaimCandidate {
  claimNodeId: string
  sourceId: string
  title: string
  text: string
  quote: string
  page: number
}

const MATCH_RANK: Record<SeedHeroClaimMatch, number> = {
  exact: 0,
  'contains-anchor': 1,
  'anchor-fragment': 2,
}

function classifyQuote(
  quote: string,
  anchor: string,
): SeedHeroClaimMatch | null {
  const normalised = normalizeQuote(quote)
  if (!normalised) return null
  if (normalised === anchor) return 'exact'
  if (normalised.includes(anchor)) return 'contains-anchor'
  if (
    anchor.includes(normalised) &&
    normalised.length >= HERO_CLAIM_MIN_FRAGMENT_LENGTH
  ) {
    return 'anchor-fragment'
  }
  return null
}

/**
 * Pure selector, exported so the same rules can be exercised without a
 * database. `raw` must already be scoped to the hero source by the caller.
 */
export function pickHeroClaim(
  raw: readonly RawHeroClaimCandidate[],
  anchor: string = HERO_CLAIM_QUOTE_ANCHOR,
): {
  selection: SeedHeroClaimSelection | null
  problem: SeedHeroClaimProblem | null
} {
  const candidates: SeedHeroClaimCandidate[] = raw.map((candidate) => ({
    ...candidate,
    match: classifyQuote(candidate.quote, anchor),
  }))

  const matched = candidates.filter(
    (candidate): candidate is SeedHeroClaimCandidate & {
      match: SeedHeroClaimMatch
    } => candidate.match !== null,
  )

  if (matched.length === 0) {
    return {
      selection: null,
      problem: {
        code: 'HERO_CLAIM_NOT_FOUND',
        message:
          'No extracted claim from the hero source quotes the verified Strobl 2007 sentence.',
        candidates,
      },
    }
  }

  const bestRank = Math.min(...matched.map((candidate) => MATCH_RANK[candidate.match]))
  const best = matched.filter(
    (candidate) => MATCH_RANK[candidate.match] === bestRank,
  )

  // Collapse exact duplicates by normalised text + quote. A retry of the same
  // extraction over overlapping chunks can produce two node rows for one claim.
  const groups = new Map<string, Array<SeedHeroClaimCandidate & { match: SeedHeroClaimMatch }>>()
  for (const candidate of best) {
    const key = `${normalizeQuote(candidate.text)}\u0000${normalizeQuote(candidate.quote)}`
    const group = groups.get(key) ?? []
    group.push(candidate)
    groups.set(key, group)
  }

  if (groups.size > 1) {
    return {
      selection: null,
      problem: {
        code: 'HERO_CLAIM_AMBIGUOUS',
        message: `${groups.size} distinct extracted claims match the hero quote anchor; refusing to guess.`,
        candidates: matched,
      },
    }
  }

  const group = [...groups.values()][0]!
  const ordered = [...group].sort((a, b) =>
    a.claimNodeId.localeCompare(b.claimNodeId),
  )
  const chosen = ordered[0]!

  return {
    selection: {
      claimNodeId: chosen.claimNodeId,
      sourceId: chosen.sourceId,
      title: chosen.title,
      text: chosen.text,
      quote: chosen.quote,
      page: chosen.page,
      match: chosen.match,
      selectorVersion: HERO_CLAIM_SELECTOR_VERSION,
      anchor,
      duplicateClaimNodeIds: ordered.slice(1).map((c) => c.claimNodeId),
    },
    problem: null,
  }
}

/**
 * Resolve the hero source by DOI and then select its claim node. The caller
 * passes the workspace id; the function never crosses a workspace boundary.
 */
export async function resolveHeroClaim(
  db: Database,
  workspaceId: string,
): Promise<SeedHeroClaimResolution> {
  const [heroSource] = await db
    .select({ id: sourcesTable.id, title: sourcesTable.title })
    .from(sourcesTable)
    .where(
      and(
        eq(sourcesTable.workspaceId, workspaceId),
        eq(sourcesTable.doi, HERO_SOURCE_DOI),
      ),
    )
    .limit(1)

  if (!heroSource) {
    return {
      heroSourceId: null,
      selection: null,
      problem: {
        code: 'HERO_SOURCE_NOT_FOUND',
        message: `No source with DOI ${HERO_SOURCE_DOI} exists in workspace ${workspaceId}.`,
        candidates: [],
      },
    }
  }

  const rows = await db
    .select({
      id: nodesTable.id,
      title: nodesTable.title,
      data: nodesTable.data,
      sourceId: nodesTable.sourceId,
    })
    .from(nodesTable)
    .where(
      and(
        eq(nodesTable.workspaceId, workspaceId),
        eq(nodesTable.type, 'claim'),
        eq(nodesTable.sourceId, heroSource.id),
      ),
    )

  const candidates: RawHeroClaimCandidate[] = []
  for (const row of rows) {
    if (row.data.type !== 'claim') continue
    candidates.push({
      claimNodeId: row.id,
      sourceId: heroSource.id,
      title: row.title,
      text: row.data.text,
      quote: row.data.locator.quote,
      page: row.data.locator.page,
    })
  }

  const { selection, problem } = pickHeroClaim(candidates)
  return {
    heroSourceId: heroSource.id,
    selection,
    problem,
  }
}
