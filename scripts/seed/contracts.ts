/**
 * Seed-only contracts for issue #8 (workspace graph setup).
 *
 * These are persisted identifiers, not preferences. `scripts/seed/runs.ts`,
 * the artifact writer and tests can depend on them instead of re-deriving an
 * id from a previous seed. The graph seed never resets or deletes data and
 * only runs against an empty application schema (see `scripts/seed/README.md`).
 *
 * Nothing in this file contains a paper-reported number or a measured metric.
 * The three assets are the real, checked-in PDFs; their sha256 and byte count
 * are computed from the file bytes by `scripts/seed.ts`, never copied from a
 * fixture.
 */
import type { NodeType } from '../../src/shared/types.ts'
import type { AgentTaskRunSummary } from '../../src/utils/strategyClient.ts'

/**
 * Deterministic workspace identity. A fixed id lets the run orchestrator and
 * the artifact writer address the same workspace without a lookup table, and
 * makes an accidental second seed fail on the unique slug instead of creating
 * a duplicate demo workspace.
 */
export const SEED_WORKSPACE_ID = '5eed0000-0000-4000-8000-000000000008'
export const SEED_WORKSPACE_NAME = 'Random Forest Study'
export const SEED_WORKSPACE_SLUG = 'random-forest-study'

/**
 * Neon Auth owns identity (`docs/adr/0008-neon-auth.md`). The seed refuses to
 * invent one: the verified user id is supplied by the operator and persisted
 * as the workspace owner so the real approval gate can record that actor.
 */
export const SEED_ACTOR_ENV = 'SEED_ACTOR_USER_ID'

/**
 * The seed's normal target is an empty application schema. Set this to `1`
 * only when intentionally adding the demo workspace to a database that
 * already contains other workspaces.
 */
export const SEED_ALLOW_EXISTING_DATA_ENV = 'SEED_ALLOW_EXISTING_DATA'

export type SeedAssetKey = 'strobl-2007' | 'strobl-2008' | 'kursa-2010'

export interface SeedAsset {
  key: SeedAssetKey
  /** Repo-relative path, resolved from the repository root. */
  path: string
  title: string
  url: string
  doi: string
  hero: boolean
}

/**
 * The three sources named by `docs/00-scope.md`. Bibliographic metadata comes
 * from the repo documentation, not from the UI fixture's source records; the
 * bytes and hashes come from the files themselves.
 */
export const SEED_ASSETS: readonly SeedAsset[] = [
  {
    key: 'strobl-2007',
    path: 'fixtures/papers/strobl-2007.pdf',
    title:
      'Bias in random forest variable importance measures: Illustrations, sources and a solution',
    url: 'https://bmcbioinformatics.biomedcentral.com/articles/10.1186/1471-2105-8-25',
    doi: '10.1186/1471-2105-8-25',
    hero: true,
  },
  {
    key: 'strobl-2008',
    path: 'fixtures/papers/strobl-2008.pdf',
    title: 'Conditional variable importance for random forests',
    url: 'https://bmcbioinformatics.biomedcentral.com/articles/10.1186/1471-2105-9-307',
    doi: '10.1186/1471-2105-9-307',
    hero: false,
  },
  {
    key: 'kursa-2010',
    path: 'fixtures/papers/kursa-2010.pdf',
    title: 'Feature Selection with the Boruta Package',
    url: 'https://www.jstatsoft.org/article/view/v036i11',
    doi: '10.18637/jss.v036.i11',
    hero: false,
  },
] as const

/** The hero source is selected by DOI, not by ingestion order. */
export const HERO_SOURCE_DOI = '10.1186/1471-2105-8-25'

/** Extraction strategies the seed is allowed to request from the production extractor. */
export type SeedExtractionStrategy = 'single_pass' | 'sectioned' | 'table_first'

/**
 * Stable identifier for one extraction batch.
 *
 * It is derived from the checked-in asset key and the chosen strategy, never
 * from ingestion order, database UUIDs or a model output, so two independent
 * seeds attribute the same paper's extraction to the same run id. The value is
 * a slug rather than an experiment `runs.id`; extraction batches are not runs
 * in the `runs` table and must not be confused with Run A / Run B.
 */
export function extractionRunId(
  key: SeedAssetKey,
  strategy: SeedExtractionStrategy,
): string {
  return `extract:${key}:${strategy}`
}

/** Display label recorded beside a stable extraction run id. */
export function extractionRunLabel(
  title: string,
  strategy: SeedExtractionStrategy,
): string {
  return `${title} · ${strategy}`
}

/**
 * A sentence that exists verbatim in the checked-in Strobl 2007 PDF.
 *
 * Provenance: verified 2026-11-27 by running the production `extractPdf`
 * reader over `fixtures/papers/strobl-2007.pdf`
 * (sha256 07c2801d84b912e97fede1fcf8d31dcda15cf63520054a29561b7b38fa1f74b5)
 * and locating this normalised sentence on PDF page 1 (chunk ordinals 0 and 2
 * carry it because chunks overlap). It is not copied from
 * `fixtures/workspace.json`; that fixture's chunk text and source metadata do
 * not match the checked-in PDF bytes.
 *
 * The selector accepts a claim whose verbatim quote is this sentence, contains
 * it, or is a contiguous fragment of at least `HERO_CLAIM_MIN_FRAGMENT_LENGTH`
 * characters. Comparison uses the production `normalizeQuote` (whitespace and
 * smart quotes only); there is no case folding or fuzzy matching.
 */
export const HERO_CLAIM_QUOTE_ANCHOR =
  'random forest variable importance measures are a sensible means for variable selection in many applications, but are not reliable in situations where potential predictor variables vary in their scale of measurement or their number of categories.'

export const HERO_CLAIM_MIN_FRAGMENT_LENGTH = 80

/** Bump only when the matching rules in `hero-claim.ts` change shape. */
export const HERO_CLAIM_SELECTOR_VERSION = 1

export type SeedHeroClaimMatch =
  | 'exact'
  | 'contains-anchor'
  | 'anchor-fragment'

export interface SeedHeroClaimCandidate {
  claimNodeId: string
  sourceId: string
  title: string
  text: string
  quote: string
  page: number
  /** `null` when the candidate did not match the anchor at all. */
  match: SeedHeroClaimMatch | null
}

export interface SeedHeroClaimSelection
  extends Omit<SeedHeroClaimCandidate, 'match'> {
  match: SeedHeroClaimMatch
  selectorVersion: number
  anchor: string
  /**
   * Other claim nodes with the same normalised text and quote. The production
   * extractor can emit the same claim twice when overlapping chunks both
   * carry the sentence; that is duplication, not ambiguity.
   */
  duplicateClaimNodeIds: string[]
}

export type SeedHeroClaimProblemCode =
  | 'HERO_SOURCE_NOT_FOUND'
  | 'HERO_CLAIM_NOT_FOUND'
  | 'HERO_CLAIM_AMBIGUOUS'

export interface SeedHeroClaimProblem {
  code: SeedHeroClaimProblemCode
  message: string
  candidates: SeedHeroClaimCandidate[]
}

export interface SeedHeroClaimResolution {
  heroSourceId: string | null
  selection: SeedHeroClaimSelection | null
  problem: SeedHeroClaimProblem | null
}

export interface SeedSourceReport {
  key: SeedAssetKey
  title: string
  doi: string
  sourceId: string
  sha256: string
  bytes: number
  chunkCount: number
  acceptedClaims: number
  rejectedClaims: number
  methods: number
  datasets: number
  createdNodeIds: {
    source: string
    claim: string[]
    method: string[]
    dataset: string[]
  }
  proposedEdges: number
  /** Validated edges the production threshold persisted as `accepted`. */
  acceptedStatusEdges: number
  /** Validated edges persisted as `suggested` (including every `contradicts`). */
  suggestedStatusEdges: number
  rejectedEdges: number
  persisted: boolean
}

export type SeedNodeCounts = Record<NodeType, number>

export interface SeedEdgeCounts {
  total: number
  accepted: number
  suggested: number
  rejected: number
}

export interface SeedGraphResult {
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
  actorUserId: string
  heroSourceId: string
  sources: SeedSourceReport[]
  heroClaim: SeedHeroClaimSelection | null
  heroClaimProblem: SeedHeroClaimProblem | null
  counts: {
    sources: number
    chunks: number
    nodes: SeedNodeCounts
    edges: SeedEdgeCounts
  }
  startedAt: string
  finishedAt: string
  elapsedMs: number
}

/**
 * The run slice's error codes. They live here, with the other seed contracts,
 * so `runs.ts` and `run-edges.ts` cannot drift apart; both modules re-export
 * the types they use.
 *
 * Prerequisite codes (`WHAT_IF_UNAVAILABLE`, `QUEUED_RUN_ADOPTION_UNAVAILABLE`)
 * are detected before any write and mean an owner integration is missing.
 * Every other code is a verification failure: the seed ran, but what it read
 * back is not the recorded workspace this issue promises.
 */
export type SeedRunErrorCode =
  | 'INVALID_INPUT'
  | 'WORKSPACE_NOT_FRESH'
  | 'APPROVER_NOT_WORKSPACE_MEMBER'
  | 'APPROVER_NOT_OPERATOR'
  | 'APPROVAL_SPEC_MISMATCH'
  | 'APPROVAL_REJECTED'
  | 'CLAIM_NOT_ACQUIRED'
  | 'PLAN_SPEC_MISMATCH'
  | 'REPAIR_APPROVAL_UNAVAILABLE'
  | 'PIPELINE_STAGE_FAILED'
  | 'PIPELINE_DB_FAILED'
  | 'RUN_NOT_CREATED'
  | 'RUN_ABORTED'
  | 'RUN_NOT_FOUND'
  | 'RUN_NOT_SUCCEEDED'
  | 'RUN_APPROVAL_MISMATCH'
  | 'RUN_SPEC_MISMATCH'
  | 'RUN_METRICS_INVALID'
  | 'RUN_VERDICT_MISMATCH'
  | 'RUN_ENVIRONMENT_MISMATCH'
  | 'RUN_ARTIFACTS_MISSING'
  | 'RUN_ARTIFACT_HASH_MISMATCH'
  | 'RUN_PROJECTION_MISMATCH'
  | 'RUN_LINEAGE_MISMATCH'
  | 'RUNS_NOT_DISTINCT'
  | 'WHAT_IF_UNAVAILABLE'
  | 'QUEUED_RUN_ADOPTION_UNAVAILABLE'
  | 'WHAT_IF_CONTRACT_VIOLATION'
  | 'BASELINE_SHAPE_MISMATCH'
  | 'BASELINE_MISMATCH'

/** A refused anchor or run-lineage edge write; the message is operator-safe. */
export type RunEdgeErrorCode =
  | 'INVALID_INPUT'
  | 'WORKSPACE_NOT_FOUND'
  | 'IMPORTANCE_METHOD_UNSUPPORTED'
  | 'METHOD_ANCHOR_AMBIGUOUS'
  | 'DATASET_SPEC_MISSING'
  | 'DATASET_ANCHOR_AMBIGUOUS'
  | 'EDGE_ENDPOINT_INVALID'
  | 'EDGE_EVIDENCE_RUN_INVALID'

export type SeedErrorCode =
  | 'MISSING_DATABASE_URL'
  | 'MISSING_GEMINI_KEY'
  | 'MISSING_META_API_KEY'
  | 'INVALID_EMBEDDING_PACING'
  | 'MISSING_ACTOR'
  | 'MISSING_ASSET'
  | 'ASSET_NOT_PDF'
  | 'ASSET_HASH_MISMATCH'
  | 'SCHEMA_NOT_MIGRATED'
  | 'DATABASE_NOT_EMPTY'
  | 'WORKSPACE_EXISTS'
  | 'SOURCE_NEEDS_OCR'
  | 'SOURCE_HAS_NO_CHUNKS'
  | 'SOURCE_NODE_MISSING'
  | 'EXTRACTION_RUN_ATTRIBUTION_MISSING'
  | 'HERO_SOURCE_HAS_NO_CLAIMS'
  | 'NO_METHOD_NODES'
  | 'NO_ACCEPTED_EDGES'

export class SeedError extends Error {
  readonly code: SeedErrorCode
  readonly details: string | null

  constructor(code: SeedErrorCode, message: string, details: string | null = null) {
    super(message)
    this.name = 'SeedError'
    this.code = code
    this.details = details
  }
}

/** The seeded dashboard needs two distinct batches with persisted extraction tasks. */
export function assertExtractionRunAttribution(
  runs: readonly Pick<AgentTaskRunSummary, 'runId' | 'taskKinds'>[],
): void {
  const attributedIds = new Set(
    runs.filter((run) => run.runId !== null && run.taskKinds.includes('extract_claims'))
      .map((run) => run.runId),
  )
  if (attributedIds.size < 2) {
    throw new SeedError(
      'EXTRACTION_RUN_ATTRIBUTION_MISSING',
      `Expected at least two attributed extract_claims runs; found ${attributedIds.size}.`,
      'Record input_ref.extractionRunId for every extraction batch.',
    )
  }
}

export interface SeedActor {
  userId: string
  role: 'owner'
}

/**
 * Resolve the verified Neon Auth user id supplied by the operator.
 *
 * There is deliberately no fallback identity. A synthetic member id would let
 * the seed finish while the real approval gate could never record that actor,
 * which is exactly the kind of quiet mismatch this contract exists to prevent.
 */
export function resolveSeedActor(
  env: NodeJS.ProcessEnv = process.env,
): SeedActor {
  const userId = env[SEED_ACTOR_ENV]?.trim()
  if (!userId) {
    throw new SeedError(
      'MISSING_ACTOR',
      `${SEED_ACTOR_ENV} is required: set it to the verified Neon Auth user id that owns the demo workspace.`,
      'The seed does not invent an identity. Real approval gates must record the same verified actor.',
    )
  }
  return { userId, role: 'owner' }
}
