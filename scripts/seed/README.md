# Seed — issue #8

`pnpm seed` rebuilds the recorded workspace from an empty application database
through the real production paths. It ingests the three checked-in PDFs,
extracts a claim and the method/dataset nodes, proposes evidenced edges,
executes Run A and Run B through the production claim → approval gate →
plan → E2B → evaluate pipeline, and writes the run-lineage edges and graph
projection. It never replays a fixture and never writes a metric, verdict or
artifact of its own.

`pnpm seed:compare` reads two independently seeded databases and checks them
as the same logical workspace. `fixtures/workspace.json` is a UI fixture with
known stale chunk text and metrics; it is not a baseline and is never read by
the seed.

## Commands

```bash
pnpm seed                 # complete seed; review both exact specs interactively
pnpm seed --non-interactive
                          # replay a reviewed pair of logical spec hashes
pnpm seed --graph-only    # sources, chunks and graph only; no experiments
pnpm seed --print-approval
                          # print the frozen logical specs + hashes; no DB needed
pnpm seed:compare         # compare two seeded databases; read-only
pnpm seed:check           # typecheck this directory's owned files
pnpm seed:test            # pure unit tests: assets, selector, comparison, edges
```

The package `typecheck` script runs `pnpm seed:check` after the app typecheck;
`pnpm test` runs the seed tests after the app suite.

### Loader

`loader.mjs` and `compare-loader.mjs` are thin wrappers over `ssr.mjs`, which
loads the TypeScript entrypoint through Vite's SSR module loader. Vite is
already a declared repo dependency and the app/Vitest toolchain. Node 26 can
strip types, but it cannot resolve the extensionless relative imports used by
`src/`; adding `tsx` or `vite-node` would be an undeclared runner dependency.

`.env` at the repository root is loaded for the process, with existing
environment variables taking precedence. Nothing secret is printed.

## What the seed writes

For each of the three checked-in PDFs, in fixed order (Strobl 2007, Strobl
2008, Kursa 2010), `ingestSourceToGraphForWorkspace` from
`src/server/extract/pipeline.ts`:

1. reads the PDF, chunks it, embeds with `gemini-embedding-2` at 768
   dimensions, and stores `sources` + `source_chunks`;
2. calls the real claim extractor (`single_pass`) and validates every quote
   verbatim against the persisted chunk;
3. persists `source`, `claim`, `method` and `dataset` nodes; and
4. proposes edges with pgvector retrieval, validates every quote, and stores
   them with the production confidence threshold (`accepted`/`suggested`).

The run half then executes the recorded experiment through the production
pipeline:

- Run A with the frozen hero spec, then Run B through the real what-if branch
  (`src/server/branch.ts`, one `importance_method` leaf changed);
- the real execution claim, approval gate and decision rows;
- E2B execution, verified artifacts with hashes/sizes/content, and the
  deterministic evaluator's verdict;
- the `run`/`result` nodes and `run → result` `produced` edge from
  `projectRunToGraph` (#7); and
- the five run-lineage edges described below.

The seed does **not** write a metric, verdict, artifact or approval decision on
its own. Every one of those is read back from a `runs`/`run_artifacts` row or
recorded by the production gate. Node positions remain at the schema default
`(0, 0)`; the canvas/force layout owns placement.

## Required environment

| Variable | Why |
|---|---|
| `DATABASE_URL` | Fresh, migrated application database. The seed refuses a non-empty schema and runs the committed migrations itself. |
| `MODEL_API_KEY` | Meta Model API key for every text call (claim extraction, edge proposal, planning, `explain_gap`). Contributor mode is the pinned `muse-spark-1.3-contributor` model. |
| `GOOGLE_GENERATIVE_AI_API_KEY` or `GEMINI_API_KEY` | Gemini embeddings only (`gemini-embedding-2`). |
| `SEED_ACTOR_USER_ID` | Verified Neon Auth user id. Graph-only mode uses it directly; the complete seed derives it from the signed-in session and requires any supplied value to match. |
| `E2B_API_KEY` | The pinned sandbox template for Run A and Run B. |
| `NEON_AUTH_BASE_URL` | The workspace account's Neon Auth service. |
| `NEON_AUTH_COOKIE_SECRET` | The app's Neon Auth cookie secret. |
| `SEED_AUTH_COOKIE` | Cookie header from a signed-in workspace account; verified again at each gate. |
| `SEED_APPROVED_LOGICAL_SPEC_HASHES` | `--non-interactive` only; see below. |

Optional: `SEED_ALLOW_EXISTING_DATA=1` allows adding this workspace to a
database that already has other workspaces. It does not allow overwriting an
existing workspace with the seed slug.

## Persisted identifiers

| Thing | Value |
|---|---|
| Workspace id | `5eed0000-0000-4000-8000-000000000008` |
| Workspace slug | `random-forest-study` |
| Workspace name | `Random Forest Study` |
| Actor | the verified Neon Auth user id |

`SEED_WORKSPACE_ID` is exported from `contracts.ts`. Source/chunk/node/edge ids
are database-generated UUIDs and are not stable across seeds; `compare.ts`
uses logical keys instead.

## Execution flow

1. `openSeedDatabase(DATABASE_URL)` selects node-postgres for a loopback host
   and the Neon WebSocket driver for a hosted database, then applies the
   committed migrations.
2. `seedWorkspaceGraph` performs the ingestion/extraction/edge steps, resolves
   the hero claim, and returns a `SeedGraphResult`.
3. `scripts/seed.ts` rebinds `HERO_EXPERIMENT_SPEC_RUN_A.claimNodeId` to the
   real claim UUID and computes both exact candidates (Run B is the same
   one-leaf transform the what-if service must produce).
4. `ensureRunGraphAnchors` selects or creates the method and dataset nodes
   **before** the review and before any E2B spend.
5. The exact specs are reviewed:
   - interactive: the terminal prints each spec, its exact SHA-256 and its
     logical SHA-256, and requires typing the exact hash;
   - `--non-interactive`: the operator supplies the logical SHA-256 pair
     reviewed earlier (see below); the seed still verifies the live Neon Auth
     session at each gate.
6. `seedRuns` opens and decides the production gates, branches Run B, adopts
   the queued child run (#62), executes both runs, verifies artifacts and the
   verdict, and captures the run baseline.
7. `writeRunGraphEdges` writes the five run-lineage edges after both runs are
   terminal.
8. The CLI prints `{ graph, runAnchors, runs, runEdges, timing }`. `timing`
   excludes human review time, and `underOneMinute` is a measurement, not a
   claim.

## Non-interactive approval

The exact spec hash embeds the per-database claim UUID, so it cannot be known
before a fresh seed. The **logical** hash replaces only that UUID with the
documented token `claim:recorded`; everything else (files, parameters,
criteria, dataset pins) is part of the hash. The same reviewed pair is
therefore valid for both fresh databases the canonical baseline requires.

```bash
# 1. Review the two frozen logical specs (no DB and no credentials needed).
pnpm seed --print-approval

# 2. After reviewing both JSON specs, replay that review on a fresh database.
SEED_APPROVED_LOGICAL_SPEC_HASHES="run-a=<64 hex>,run-b=<64 hex>" \
DATABASE_URL=... MODEL_API_KEY=... GOOGLE_GENERATIVE_AI_API_KEY=... E2B_API_KEY=... \
SEED_AUTH_COOKIE=... NEON_AUTH_BASE_URL=... NEON_AUTH_COOKIE_SECRET=... \
  pnpm seed --non-interactive
```

Both hashes must match the offered gate specs; a missing, malformed or
mismatched value refuses before any approval or execution. There is no default
approval path. The decision row still records the concrete offered spec hash
and the verified actor id.

## Hero-claim selector contract

`resolveHeroClaim(db, workspaceId)` in `hero-claim.ts` returns a selection or a
typed problem. Version 1 rules:

- scope to the hero source by DOI `10.1186/1471-2105-8-25`;
- compare with production `normalizeQuote` only (whitespace + smart quotes; no
  case folding, no fuzzy match, no dash folding);
- accept a claim whose quote equals the anchor, contains it, or is a contiguous
  fragment of at least 80 characters;
- collapse byte-identical `(text, quote)` duplicates to the lowest claim node
  id; every other multi-match is `HERO_CLAIM_AMBIGUOUS`;
- never guess and never fabricate a claim.

The anchor is verified against the real Strobl 2007 PDF, not the UI fixture:

> random forest variable importance measures are a sensible means for variable
> selection in many applications, but are not reliable in situations where
> potential predictor variables vary in their scale of measurement or their
> number of categories.

Provenance: production `extractPdf` over `fixtures/papers/strobl-2007.pdf`
(sha256 `07c2801d84b912e97fede1fcf8d31dcda15cf63520054a29561b7b38fa1f74b5`),
page 1. The same sentence is present in chunk ordinals 0 and 2 because chunks
overlap, which is why duplicate claims are tolerated.

If the selector returns a problem, the graph seed still completes and prints
the candidates; the entrypoint refuses to attach Run A until it is resolved.

## Run-lineage edge contract

`projectRunToGraph` already writes `run → result`. `scripts/seed/run-edges.ts`
adds exactly five deterministic edges, all `accepted`, confidence 1, each
evidenced by a terminal run:

| Source | Relation | Target | Evidence |
|---|---|---|---|
| method (`impurity`) | `produced` | Run A node | Run A |
| method (`permutation`) | `produced` | Run B node | Run B |
| dataset | `uses_dataset` | Run A node | Run A |
| dataset | `uses_dataset` | Run B node | Run B |
| Run A node | `derived_from` | Run B node | Run B |

Anchor selection is exact and fails closed:

- Normalise with NFKC, lowercase, and fold every non-letter/digit run to one
  space. `impurity` matches titles containing `impurity` or `gini`;
  `permutation` matches titles containing `permutation`. An exact normalised
  title outranks containment; earliest `created_at` breaks the next tie; a
  remaining tie is an ambiguity error.
- The three papers do not mention `breast-w` (verified against the PDFs), so
  when no extracted dataset node matches, the dataset anchor is created from
  `runASpec.datasets[0]`, copying `name`, `url` and `sha256` and never
  inventing rows or hashes.
- When no extracted method node matches, a spec-derived method node is created
  with title `Impurity importance` / `Permutation importance` and a factual
  summary. It claims no paper provenance and carries no metric.

The database check `edges_have_evidence` is never bypassed: every edge has a
`evidence_run_id` (these five) or an `evidence_chunk_id` (knowledge edges).

## Canonical baseline: two live seeds

Run two live end-to-end seeds on separate fresh databases and require them to
match. `pnpm seed:compare` reads both without writing and checks:

- **Real asset hashes** — each source DOI has the checked-in PDF's sha256 and
  byte count; extra or missing demo sources fail.
- **Semantic evidence/locators** — every claim quote is verbatim in a chunk of
  its source at the recorded page; chunk ordinals are contiguous; every chunk
  has an embedding and a valid character span; knowledge edges carry chunk
  evidence; run-touching edges carry terminal-run evidence; result/run nodes
  agree with their `runs` row.
- **Logical graph equality** — sources, chunks, nodes, edges, experiments and
  runs are compared as canonical JSON with every DB-generated UUID and
  timestamp removed. Source identity is DOI (or sha256); chunk identity is
  `source#ordinal`; node/edge/run keys derive from content and lineage.
- **Runs, artifacts and lineage** — spec hash with `claimNodeId` normalised to
  the logical claim, parameters, exact metrics, verdict and verdict checks,
  normalized environment, artifact bytes/sha256/content, attempt and parent
  chain. `stdout`/`stderr`, sandbox ids, durations and timestamps are
  excluded. The model-written verdict explanation is compared by presence only.
- **Concrete spec hashes** — each database's per-experiment SHA-256 over the
  exact stored spec (UUID claim included) is printed for the approval record.
  These differ between databases because the claim UUID differs; the logical
  spec hash is what must match.

## Database transport

`scripts/seed/database.ts` owns the seam:

```ts
const opened = openSeedDatabase(connectionString)
await opened.migrate()
// opened.db is the production Database alias
await opened.close()
```

Loopback hosts (`localhost`, `127.0.0.1`, `[::1]`) use node-postgres; a hosted
database uses the Neon WebSocket driver. Production and seed logic stay typed
against the production `Database`; the loopback cast is confined to this file.

## Migrations

The seed needs no migration of its own; it applies every committed migration
to the fresh database automatically:

- `0000_initial_schema.sql` creates the pgvector extension
  (`CREATE EXTENSION IF NOT EXISTS vector`) and the graph/run tables.
- `0001_pipeline_foundation.sql` adds pipeline events, claims and approval
  gates.
- `0002_repair_approval_gates.sql` adds the repair-gate linkage merged from
  the repair loop.

Use the `pgvector/pgvector:pg18` image (or any Postgres with the `vector`
extension available). `pnpm db:push` is the disposable-branch alternative but
does not record migration history; `db:migrate` is the repeatable path.

## Exercising on a fresh disposable database

The existing `.env` database is not empty, so do not point the seed at it. Use
a disposable pgvector Postgres. The seed applies migrations itself:

```bash
# 1. Fresh database
PGPASSWORD="$(openssl rand -hex 16)"
docker run --rm -d --name rg-seed-pg \
  -e POSTGRES_PASSWORD="$PGPASSWORD" \
  -p 127.0.0.1:55433:5432 \
  pgvector/pgvector:pg18

# 2. Review the frozen logical specs once (no DB needed).
pnpm seed --print-approval

# 3. Complete seed, replaying that review.
DATABASE_URL="postgresql://postgres:$PGPASSWORD@127.0.0.1:55433/postgres" \
MODEL_API_KEY="<Meta Model API key>" \
GOOGLE_GENERATIVE_AI_API_KEY="<Gemini embedding key>" \
E2B_API_KEY="<key>" \
NEON_AUTH_BASE_URL="<url>" \
NEON_AUTH_COOKIE_SECRET="<secret>" \
SEED_AUTH_COOKIE="<cookie header>" \
SEED_APPROVED_LOGICAL_SPEC_HASHES="run-a=<hex>,run-b=<hex>" \
  pnpm seed --non-interactive

# 4. Second fresh database, same hash pair, different port/name
# 5. Compare the two canonical baselines (read-only)
SEED_BASELINE_DATABASE_URL="postgresql://...first..." \
SEED_CANDIDATE_DATABASE_URL="postgresql://...second..." \
  pnpm seed:compare
```

Graph-only mode is useful when only the extraction half is being exercised:

```bash
DATABASE_URL=... MODEL_API_KEY=... GOOGLE_GENERATIVE_AI_API_KEY=... \
SEED_ACTOR_USER_ID=... \
  pnpm seed --graph-only
```

If the seed fails after writing, it leaves the partial workspace in place by
design. Recreate the disposable database (or drop its schema manually); the
seed never resets it for you.

## Remaining decisions / blockers

1. **Live capacity and provider.** Credentials and the reviewed logical hash
   pair were supplied for the 27 November live attempt, and the Neon Auth/E2B
   preflight passed. Gemini returned 503 "high demand" on both text models, so
   text generation moved to Meta Model API's `muse-spark-1.3-contributor`
   (Contributor mode); Gemini remains the embedding provider. The Meta adapter
   was verified with a real structured `{ "ok": true }` call. The live pair
   still needs to complete on the new provider; no credential is committed.
   Contributor mode permits Meta to train on prompts and responses; the seed
   sends only public paper text and generated specs.
2. **Exactness of two live seeds.** Live model extraction can vary between
   runs. The baseline requires the two seeds to match; if `seed:compare`
   reports node/edge differences, the project must accept process-level
   reproducibility or add recorded model outputs. Do not paper over it with
   fixture rows.
3. **Runtime budget.** The issue's "under a minute" is unverified. The CLI
   prints measured `elapsedMs` excluding human review; measure a real live
   seed before claiming the budget.
4. **Node positions.** The seed leaves `nodes.position_x/y` at `(0, 0)`. The
   canvas/force layout owns placement.
5. **Merged dependencies.** The what-if branch (#66), repair loop (#65) and
   notebook export (#67) are now on `main`; this branch merges them and no
   longer depends on unmerged PRs. The seed still refuses with
   `WHAT_IF_UNAVAILABLE` rather than stubbing the what-if service.
6. **Repairs.** A successful hero run never repairs. If the production
   pipeline opens a repair gate during EXECUTE, the seed fails closed with
   `REPAIR_APPROVAL_UNAVAILABLE`; it has no operator in the execution loop and
   will not fabricate a decision.

## Verified in this worktree

- `pnpm typecheck` — pass (app + seed config).
- `pnpm seed:test` — 6 files, 90 pure tests pass.
- `scripts/seed/run-edges.integration.test.ts` — 4 real-Postgres tests pass:
  selector/fallback anchors, the five persisted edges, non-terminal-run
  refusal, foreign-workspace refusal.
- `pnpm test` with `TEST_DATABASE_URL` pointing at a disposable pgvector
  container — 436 tests pass, 7 skipped, exit 0 (29 files), after merging
  current `main` (#65/#66/#67) and adding the 429/503 retry matrix.
- `pnpm build` — pass; `pnpm db:check` — pass.
- `pnpm verify:hero` — pass in Docker: Run A and Run B execute the frozen
  parameters, produce distinct measured metrics, write `importance.csv`, match
  the recorded rank values, and reject an invalid `importance_method`.
- `pnpm seed --print-approval` — prints both logical specs and hashes without
  a database or credential.
- Live attempts on 27 November: the Gemini/E2B/Neon Auth preflight passed,
  but Gemini returned 503 "high demand" on both `gemini-3.8-flash` and
  `gemini-4-hydrogen`. One hydrogen attempt completed extraction and six
  embedding calls before the edge call returned 503; one attempt failed
  structured-output validation. No complete pair was produced, so
  `pnpm seed:compare` was not reached.
- On the 429/503-retry build (`2b6a0ae`), the seed ran for 2m05s and
  exhausted three hydrogen attempts at `extract_claims` (two `retried` rows,
  one `failed` row, one row per physical attempt); `seed_b` was untouched.
  A direct 1-token probe at 13:32 UTC returned 503 for both pinned models,
  while `gemini-3.6-flash`, `gemini-3.5-flash` and `gemini-2.5-flash`
  returned 200 and `gemini-4-argon` returned a 429 quota error. The capacity
  block is model-specific and temporary; the pinned pair is still blocked.
- Text generation moved from Gemini to Meta Model API's
  `muse-spark-1.3-contributor` after the 503s. The OpenAI-compatible adapter
  was verified against the real API (`https://api.meta.ai/v1`) with both a
  plain completion and a schema-constrained `{ "ok": true }` response;
  embeddings remain `gemini-embedding-2`.
- The first Meta live attempt (`2b1e7f1`) failed before generation: Meta's
  strict schema mode rejected `ExtractionResultSchema` because optional
  properties such as `codeUrls` were not in `required`. The Meta generator now
  sends the schema with `strictJsonSchema: false` and revalidates with the
  original Zod schema. A real call using the production extraction schema
  returned `claims`/`datasets`/`methods`/`codeUrls` successfully.
- The live two-seed baseline remains the outstanding gate; the "under one
  minute" budget is not yet measured.
