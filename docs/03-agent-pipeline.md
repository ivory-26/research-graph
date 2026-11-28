# Agent pipeline

Eight stages, fixed order. Each stage is one recorded task. The model makes judgements at each stage; the code decides which stage runs next.

```
INGEST_SOURCE → EXTRACT_CLAIMS → PROPOSE_EDGES → PLAN_EXPERIMENT
      → AWAIT_APPROVAL → EXECUTE → EVALUATE → (BRANCH_WHAT_IF)
```

`AWAIT_APPROVAL` is the only stage that waits on a human. `BRANCH_WHAT_IF` starts a second pass from `PLAN_EXPERIMENT`.

## What exists on `main`

| Stage | Module | State |
|---|---|---|
| `INGEST_SOURCE` | `src/server/ingest/`, `firecrawl.ts` | Built: reading order, chunking, embeddings, pgvector store, web/repo ingestion |
| `EXTRACT_CLAIMS` | `src/server/extract/claims.ts` | Built for `single_pass` only; `sectioned` and `table_first` throw |
| `PROPOSE_EDGES` | `src/server/extract/edges.ts` | Built: evidence validation and workspace-scoped storage |
| `PLAN_EXPERIMENT` | `src/server/planner.ts` | Validation only. There is no model-generated plan yet |
| `AWAIT_APPROVAL` | `src/server/pipeline-delivery/`, `src/db/pipeline-*` | Built: durable gate, same-origin POST, verified actor |
| `EXECUTE` | `src/server/runner.ts` | Built: real E2B runner with pinned-package verification |
| `EVALUATE` | `src/server/evaluate.ts`, `evaluate-verdict.ts` | Built: deterministic verdict, then `explain_gap` |
| `BRANCH_WHAT_IF` | `src/server/branch.ts` | Built; EXECUTE adopts the queued Run B (#62) |
| repair loop (`REPAIR_SCRIPT`) | `src/server/branch.ts` | Built; wired into EXECUTE after a failed run |
| strategy selection | — | Not built; `agent_strategies` exists but nothing picks a strategy |

The rest of this document is the contract each stage is held to, whether or not the stage exists yet.

## Stage contracts

### INGEST_SOURCE

Deterministic. No model call.

- PDF → text with `unpdf`, reconstructing reading order from text-item coordinates.
- Split into ~800-token chunks with 15% overlap; record `page`, `charStart`, `charEnd`.
- Embed with `gemini-embedding-2` at 768 dimensions in batches of up to 20 chunks (`embedMany`), one vector per chunk. The model does not support `task_type` and normalises 768-dim outputs. Embedding cost is recorded at $0.15 per million tokens on the `ingest` task row; the SDK's `NaN` usage value is normalised to zero rather than written as `NaN` (#55).
- Store `sources` and `source_chunks`. An embedding failure fails ingestion for that source; the nullable column and the `embedding is not null` filter exist so a partially backfilled workspace cannot break retrieval.

Failure handling: if a chunk contains no alphanumeric content it is dropped, not embedded. If a page yields fewer than 40 characters, the PDF is probably scanned — mark the source `needs_ocr` and stop, rather than pretending.

### EXTRACT_CLAIMS

```ts
const ExtractedClaim = z.object({
  text: z.string().max(600),
  metric: z.string().max(80).nullable(),
  reportedValue: z.number().nullable(),
  comparator: z.enum(['gt', 'lt', 'eq']).nullable(),
  againstValue: z.number().nullable(),
  datasetName: z.string().max(120).nullable(),
  methodName: z.string().max(120).nullable(),
  quote: z.string(),                   // must appear verbatim in the chunk; <= 400 chars enforced per claim (QUOTE_TOO_LONG)
  chunkId: z.string(),
});

const ExtractionResult = z.object({
  claims: z.array(ExtractedClaim).max(12),
  datasets: z.array(z.object({ name: z.string(), url: z.string().nullable() })).max(8),
  methods: z.array(z.object({ name: z.string(), summary: z.string().max(300) })).max(8),
  codeUrls: z.array(z.string()).max(8),
});
```

**Validation that rejects rather than repairs.** For every claim, `quote` is normalised (whitespace collapsed, unicode quotes folded) and searched for in the referenced chunk. Normalisation deliberately does **not** fold en/em dashes to hyphens or ignore case: a hyphen where the source has an em-dash is not a verbatim quote. A claim whose quote is absent is dropped and counted as a rejected task; when every claim is rejected, the `agent_tasks` row is updated to `rejected`. No fuzzy matching, no "close enough" — a claim with an unverifiable quote is exactly the artifact the product exists to prevent.

Strategies for this stage. Only the first is implemented on `main`; requesting another throws rather than silently falling back:
- `single_pass` — first 30,000 characters, one call. **Built.**
- `sectioned` — Methods/Results sections located by heading, one call each. Not built.
- `table_first` — one call for tables, one for the rest. Not built.

### PROPOSE_EDGES

Input is node summaries plus the top-k chunks retrieved for each node pair, not the whole document. Output:

```ts
const ProposedEdge = z.object({
  fromNodeId: z.string(),
  toNodeId: z.string(),
  relation: z.enum(['supports', 'contradicts', 'cites', 'uses_dataset', 'tests', 'derived_from']),
  confidence: z.number().min(0).max(1),
  evidenceChunkId: z.string(),
  quote: z.string(),                   // must appear verbatim in the chunk; <= 400 chars enforced per edge (QUOTE_TOO_LONG)
  rationale: z.string(),               // non-empty enforced per edge; bounded to 240 chars post-validation
});
```

Same verbatim-quote validation, plus: the cited chunk must resolve to a workspace the edge belongs to. Storage re-checks that the chunk's source is in the same workspace, so a valid quote from another workspace cannot become evidence (#56). `confidence < 0.65` → `status = 'suggested'`; otherwise `accepted`. `contradicts` always lands as `suggested`, regardless of confidence — a machine should not assert that two researchers disagree without a human agreeing.

### PLAN_EXPERIMENT

**Status on `main`: validation only.** There is no model call that generates an `ExperimentSpec`. The hero spec in `fixtures/hero-spec.ts` is hand-written, and `validateExperimentSpec` checks the stored plan before a gate opens. The generate-then-reprompt loop described below is the target, not current behaviour.

Input: the claim node, the method node, the dataset node, and any code URLs. Output is an `ExperimentSpec` ([04](./04-experiment-runtime.md)) minus resolved dataset hashes, which the application fills in by fetching the file.

Hard rules the planner enforces, checked in code before the approval screen:

- `mode` is present and is not `exact`; `network` is `none` and `language` is `python`.
- Exactly one `entrypoint`. It must be `python <file>.py`, `python3 <file>.py` or a bare `.py`, with no shell operators, pipes, redirects or flags; the file must exist in `files`.
- Every dataset has an http(s) URL on the allowed host list (OpenML, UCI, GitHub, Hugging Face) and no loopback, private-range or link-local host.
- Sandbox file paths cannot be absolute or traverse out of the workspace.
- The script writes metrics to `/output/metrics.json` in executable code — a mention inside a comment does not count. This is not optional: the evaluator reads nothing else.
- `timeoutSeconds` is at most 120, and the estimated runtime (`parameters.estimatedRuntimeSeconds`) is under 60 seconds.
- No `pip install` inside executable script code; the image already has the libraries.

A spec that violates a rule is rejected with the full list of errors. On `main` that rejection fails the stage; there is no re-prompt.

### AWAIT_APPROVAL

The approval screen shows the resource and isolation cards (network disabled, vCPU and memory, dataset mode), the dataset reference, URL and size, the criteria, and then the full generated script. Approve or reject.

On `main` the gate is durable: `approval_gates` binds the offered spec to the `approval.requested` seq, the execution claim and the experiment. The POST is same-origin and authenticated, checks workspace membership, and records the verified actor. Exactly one decision can be written, and it names the gate it decides, so it cannot be applied to a different plan. The executed run uses the offered spec, not a re-read of `experiments.spec`. A rejection of the initial plan emits `pipeline.cancelled` (`reason: 'rejected'`) and never calls `EXECUTE`; a rejected repair gate ends the pipeline without executing the candidate. The current approval *screen* is rendered from the hero fixture, not from a live gate.

### EXECUTE

One `runner.run(spec)` call. The run row is written with the approved, frozen spec **before** the sandbox exists, so a provider crash leaves a `running` row rather than no record. Details in [04](./04-experiment-runtime.md).

### EVALUATE

Deterministic. The verdict is computed by evaluating `spec.criteria` against `result.metrics`:

```
exitCode !== 0                                    → 'failed'
criteria.checks is empty                          → 'inconclusive'
any required metric missing or non-finite         → 'inconclusive'
mode 'all': every check passes                    → 'match', else 'mismatch'
mode 'any': at least one check passes             → 'match', else 'mismatch'
```

Every check is recorded in `verdict_detail.checks` with its measured value, threshold and pass flag, so per-check outcomes stay visible whatever the aggregate says.

The model is then called **only** to write a two-sentence explanation of the gap, given the spec, the metrics and the criteria. It cannot change the verdict; the verdict is already a row by the time the explanation is requested. On `main` that call is pinned to `gemini-4-hydrogen` (`EXPLAIN_GAP_MODEL_ID`), and its `agent_tasks` row id becomes the `taskId` on the `EVALUATE` `stage.finished` event.

This is worth restating because it is the cheapest possible defence against the thing that makes AI research tools untrustworthy: the explanation is prose, the verdict is arithmetic.

### BRANCH_WHAT_IF

**Status on `main`: built.** `src/server/branch.ts` clones the frozen spec, enforces the one-parameter diff and persists the branched experiment plus a queued Run B with `parentRunId`. EXECUTE adopts that queued attempt-1 row under the experiment row lock (#62) instead of inserting an unlinked run, freezes the approved spec and refuses a duplicate. The comparison view itself still renders the recorded fixture.

Input: a completed run and a parameter name. The branch copies the frozen `spec`, applies exactly one change, re-runs `PLAN_EXPERIMENT`'s validation (not its generation), and creates a new `experiment` with `parentRunId` pointing at the ancestor. The parent row is never touched.

One parameter, enforced: the diff between parent and child `spec` must have exactly one changed leaf path. A two-parameter change is rejected with an error the UI shows.

## Retry and repair

**Status on `main`: built.** `src/server/branch.ts` implements the loop and `src/server/pipeline-delivery/production-stages.ts` starts it after a failed or timed-out run. Bounded 429 backoff in `callModel` remains the only retry behaviour for other stages.

On `failed` or `timeout`, up to **two** repair attempts:

1. `REPAIR_SCRIPT` receives the script, the spec, and the last 4,000 characters of stderr.
2. It returns a full replacement script, not a diff.
3. The new script re-enters validation and is re-approved automatically only if the repair changed nothing but imports, column names, or paths. Any other change re-opens the approval gate.

Every executed repair candidate is its own `runs` row with `attempt` incremented and `parentRunId` chained. A `REPAIR_SCRIPT` call that never yields a valid replacement — a model failure, an empty or unchanged script, or a validation failure — consumes one of the two attempts but writes no run row, because no candidate was executed. The graph shows the chain, which is the visual form of the demo's "errors and fixes appear as linked nodes" beat.

The two-attempt ceiling is not a safety measure, it is a demo measure. An unbounded loop can burn a recording session.

**Known limits.** A repaired child is evaluated by code, but the two-sentence `explain_gap` explanation is produced for the initial EVALUATE only; a repaired run records the deterministic verdict without one. If the stream budget expires while a repair gate is pending, the gate is left undecided on a closed claim and the experiment keeps `approvalState = 'pending'`, the same failure mode as a pending initial gate. Both are follow-ups, not silent successes.

## Strategy selection

**Status:** `agent_strategies` and `agent_tasks` exist, `callModel` records every attempt, and `extractClaims` accepts an optional `strategyId` for the task row. `extractClaims` and `proposeEdges` also accept a stable `runId` / `runLabel` and write them as `input_ref.extractionRunId` / `input_ref.extractionRunLabel`; every pass of one batch shares the id, and a caller that omits it produces legacy unattributed rows rather than an invented id. Automated `pickStrategy` selection is not built; `GET /api/strategies` and `StrategyDashboard` aggregate `agent_tasks` per run when a database workspace UUID is active and render `DEMO_STRATEGIES` in demo fixture mode.

This is the entire "evolving agents" mechanism.

```ts
function pickStrategy(kind: TaskKind, rows: StrategyStat[]): Strategy {
  // Laplace-smoothed success rate, plus a fixed exploration floor.
  const scored = rows.map(s => ({
    ...s,
    score: (s.successes + 1) / (s.attempts + 2),
  }));
  scored.sort((a, b) => b.score - a.score);

  const floor = 0.10;
  const explore = Math.random() < floor;
  const pool = explore ? scored : scored.slice(0, 1);
  return weightedPick(pool);
}
```

Success is defined per task kind by verified outcomes only:

| Task kind | Success means |
|---|---|
| `extract_claims` | at least one claim survived quote validation |
| `propose_edges` | at least one edge was accepted by the user |
| `plan_experiment` | spec passed validation on the first attempt |
| `repair_script` | the repaired run exited 0 |
| `ask_across_sources` | synthesis returned with at least one verified citation |

A strategy that produces a claim with a fabricated quote is not a partial success. It is a failure with a longer explanation.

The dashboard is a `GROUP BY` over `agent_tasks`, with no separate score to keep in sync. `GET /api/strategies` and `StrategyDashboard` read `agent_tasks` rows when a database workspace UUID is active and group them by `(run, task_kind, strategy_id)`. Per-extraction-run attribution is recorded by `extract_claims` and `propose_edges`; rows without a run id, including embeddings and task history written before this convention, remain visible in the unattributed bucket. Automated strategy selection remains open: the seed records three real `single_pass` extraction batches (one per paper), not a second strategy over the same paper.

## Model discipline

Because of structured-output schema limits ([ADR 0009](./adr/0009-gemini-only.md), [ADR 0014](./adr/0014-meta-muse-spark-contributor-provider.md)):

- Every schema is flat or one level of nesting. No recursive `$ref`.
- Never rely on `minLength`, `maxLength`, `uniqueItems` (or Meta `minimum`/`maximum` grammar keywords) — they are ignored or stripped during generation. Enforce in Zod after the call, not in the schema before it.
- Never exceed 12 items in a top-level array; large arrays increase truncation risk and make validation all-or-nothing.

Every call is sequential. Quotas are project-wide, so the pipeline never issues parallel requests. Text calls go through one `callModel()` wrapper (`src/server/model.ts`) that implements exponential backoff with jitter on 429/503, disables provider auto-retries, redacts sent secrets on errors, and writes one `agent_tasks` row per **physical attempt** with cost, tokens and latency. Embeddings use the same queue and task-row helpers (`enqueueProcessTask`) via `embedMany`.

429 rate-limit and 503 provider-capacity responses (`high demand`) are retried with bounded exponential backoff and jitter; every other provider failure is persisted immediately and surfaces as a missing explanation. The deterministic verdict still completes. `DEFAULT_MAX_ATTEMPTS` and the 240-second stream budget bound the retry chain.

The one model exception is the Stage 7 `explain_gap` call, which pins `gemini-4-hydrogen` (`@ai-sdk/google`) for the two-sentence explanation (`src/server/evaluate.ts`). The verdict is computed by `evaluateExperiment` before that call and the model cannot alter it. Every other text call site uses `gemini-3.8-flash` (`DEFAULT_MODEL_ID`), or Meta Model API's `muse-spark-1.3-contributor` (`https://api.meta.ai/v1/chat/completions`) when `META_API_KEY` is explicitly configured or `DEFAULT_META_MODEL_ID` is pinned; embeddings stay on `gemini-embedding-2`. `DEFAULT_PRICING` records published list rates (`gemini-3.8-flash` $0.30/$2.50, `gemini-4-hydrogen` $1.50/$7.50 Standard paid rate, `muse-spark-1.3-contributor` $0.10/$0.20 Contributor list rate, reasoning/thinking included in output). The table is an accounting estimate from published prices, not billing telemetry or a statement about account entitlement.

The seed pins Meta's `muse-spark-1.3-contributor` for its recorded baseline even when `META_API_KEY` is absent, because the committed recording is keyed to that model. `SEED_RECORD_MODEL_OUTPUTS` and `SEED_REPLAY_MODEL_OUTPUTS` are seed-only; the application runtime never reads them. Contributor mode permits Meta to train on prompts and responses; the seed sends only public paper text and generated specs.
