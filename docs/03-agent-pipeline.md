# Agent pipeline

Eight stages, fixed order. Each stage is one recorded task. The model makes judgements at each stage; the code decides which stage runs next.

```
INGEST_SOURCE → EXTRACT_CLAIMS → PROPOSE_EDGES → PLAN_EXPERIMENT
      → AWAIT_APPROVAL → EXECUTE → EVALUATE → (BRANCH_WHAT_IF)
```

`AWAIT_APPROVAL` is the only stage that waits on a human. `BRANCH_WHAT_IF` starts a second pass from `PLAN_EXPERIMENT`.

## Stage contracts

### INGEST_SOURCE

Deterministic. No model call.

- PDF → text with `unpdf`, reconstructing reading order from text-item coordinates.
- Split into ~800-token chunks with 15% overlap; record `page`, `charStart`, `charEnd`.
- Embed with `gemini-embedding-2` at 768 dimensions. Passing multiple strings in a single request produces one aggregated vector, so each chunk must be sent as its own `Content` item via the batch endpoint (or sequentially through the rate-limiter) to get one 768-dim vector per chunk. Note that `gemini-embedding-2` does not support `task_type` and auto-normalizes 768-dim outputs.
- Store `sources` and `source_chunks`.

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
  quote: z.string().max(400),        // must appear verbatim in the chunk
  chunkId: z.string(),
});

const ExtractionResult = z.object({
  claims: z.array(ExtractedClaim).max(12),
  datasets: z.array(z.object({ name: z.string(), url: z.string().nullable() })).max(8),
  methods: z.array(z.object({ name: z.string(), summary: z.string().max(300) })).max(8),
  codeUrls: z.array(z.string()).max(8),
});
```

**Validation that rejects rather than repairs.** For every claim, `quote` is normalised (whitespace collapsed, unicode quotes folded) and searched for in the referenced chunk. A claim whose quote is absent is dropped and counted as a rejected task. No fuzzy matching, no "close enough" — a claim with an unverifiable quote is exactly the artifact the product exists to prevent.

Strategies for this stage:
- `single_pass` — first 30k characters, one call.
- `sectioned` — Methods/Results sections located by heading, one call each.
- `table_first` — one call for tables, one for the rest.

### PROPOSE_EDGES

Input is node summaries plus the top-k chunks retrieved for each node pair, not the whole document. Output:

```ts
const ProposedEdge = z.object({
  fromNodeId: z.string(),
  toNodeId: z.string(),
  relation: z.enum(['supports', 'contradicts', 'cites', 'uses_dataset', 'tests', 'derived_from']),
  confidence: z.number().min(0).max(1),
  evidenceChunkId: z.string(),
  quote: z.string().max(400),
  rationale: z.string().max(240),
});
```

Same verbatim-quote validation. `confidence < 0.65` → `status = 'suggested'`; otherwise `accepted`. `contradicts` always lands as `suggested`, regardless of confidence — a machine should not assert that two researchers disagree without a human agreeing.

### PLAN_EXPERIMENT

Input: the claim node, the method node, the dataset node, and any code URLs. Output is an `ExperimentSpec` ([04](./04-experiment-runtime.md)) minus resolved dataset hashes, which the application fills in by fetching the file.

Hard rules the planner must satisfy, checked in code before the approval screen:

- `mode` is present and is not `exact`.
- Exactly one `entrypoint`, and it exists in `files`.
- Every dataset has a resolvable URL.
- The script writes its metrics as `json.dump` to `/output/metrics.json`. This is not optional: the evaluator reads nothing else.
- Estimated runtime under 60 seconds.
- No `pip install` inside the script; the image already has the libraries.

A spec that violates any rule goes back to the model once with the violation appended. A second violation fails the stage.

### AWAIT_APPROVAL

The approval screen shows, in this order: the full script, the dataset URLs and sizes, the resource limits, and the fact that networking is disabled. Approve or reject. Rejection ends the run as `cancelled` and is recorded as a task.

### EXECUTE

One `runner.run(spec)` call. Details in [04](./04-experiment-runtime.md).

### EVALUATE

Deterministic. The verdict is computed by evaluating `spec.criteria` against `result.metrics`:

```
exitCode !== 0                                    → 'failed'
any required metric missing                       → 'inconclusive'
every check passes                                → 'match'
every check fails                                 → 'mismatch'
some pass, some fail                              → 'mismatch' with per-check detail
```

The model is then called **only** to write a two-sentence explanation of the gap, given the spec, the metrics and the criteria. It cannot change the verdict; the verdict is already a row by the time the explanation is requested.

This is worth restating because it is the cheapest possible defence against the thing that makes AI research tools untrustworthy: the explanation is prose, the verdict is arithmetic.

### BRANCH_WHAT_IF

Input: a completed run and a parameter name. The branch copies the frozen `spec`, applies exactly one change, re-runs `PLAN_EXPERIMENT`'s validation (not its generation), and creates a new `experiment` with `parentRunId` pointing at the ancestor. The parent row is never touched.

One parameter, enforced: the diff between parent and child `spec` must have exactly one changed leaf path. A two-parameter change is rejected with an error the UI shows.

## Retry and repair

On `failed`, up to **two** repair attempts:

1. `REPAIR_SCRIPT` receives the script, the spec, and the last 4,000 characters of stderr.
2. It returns a full replacement script, not a diff.
3. The new script re-enters validation and is re-approved automatically only if the repair changed nothing but imports, column names, or paths. Any other change re-opens the approval gate.

Every attempt is its own `runs` row with `attempt` incremented and `parentRunId` chained. The graph shows the chain, which is the visual form of the demo's "errors and fixes appear as linked nodes" beat.

The two-attempt ceiling is not a safety measure, it is a demo measure. An unbounded loop can burn a recording session.

## Strategy selection

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

A strategy that produces a claim with a fabricated quote is not a partial success. It is a failure with a longer explanation.

The dashboard is a `GROUP BY` over `agent_tasks`; there is no separate score to keep in sync. The visible adaptation in the demo is one line in that table changing order between two extraction runs.

## Model discipline

Because of Gemini's structured-output subset ([ADR 0009](./adr/0009-gemini-only.md)):

- Every schema is flat or one level of nesting. No recursive `$ref`.
- Never rely on `minLength`, `maxLength`, `uniqueItems` — they are silently ignored. Enforce in Zod after the call, not in the schema before it.
- Never exceed 12 items in a top-level array; large arrays increase truncation risk and make validation all-or-nothing.

Every call is sequential. Gemini's free-tier quotas are per project and unpublished, so the pipeline never issues parallel requests, and every call site goes through one `callModel()` wrapper that implements exponential backoff with jitter on 429 and records cost, tokens and latency on the task row.
