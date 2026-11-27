# Meta `muse-spark-1.3-contributor` text generation inside `callModel()`

Gemini remains the provider for embeddings (`gemini-embedding-2`) and the Stage 7 `explain_gap` evaluator call (`gemini-4-hydrogen`), and `gemini-3.8-flash` remains `DEFAULT_MODEL_ID` when no Meta key is configured. However, live free-tier/high-demand runs on `gemini-3.8-flash` have experienced recurring upstream `503 UNAVAILABLE` and quota limits.

To support reliable live extraction, edge proposal, cross-source retrieval synthesis, and repair runs without proliferating a second wrapper module, Meta's Chat Completions API (`https://api.meta.ai/v1/chat/completions`) is integrated directly inside the single `callModel()` wrapper (`src/server/model.ts`), controlled by an explicit `META_API_KEY` environment variable or an explicit `modelId: 'muse-spark-1.3-contributor'`.

## Model pin and routing

- **Pinned Meta model:** `muse-spark-1.3-contributor` (`DEFAULT_META_MODEL_ID`). Non-contributor Meta tiers (such as `muse-spark-1.3`) are rejected before any HTTP call.
- **Explicit replacement switch (`META_API_KEY`):** When `META_API_KEY` is non-empty and callers omit `ctx.modelId`, `callModel()` defaults to `muse-spark-1.3-contributor`. When `META_API_KEY` is unset, `callModel()` continues defaulting to `gemini-3.8-flash` (`DEFAULT_MODEL_ID`). There is no cross-provider fallback on failure: if Meta returns an error (other than `429` retried up to `DEFAULT_MAX_ATTEMPTS = 3`), the call fails without silently switching back to Gemini.
- **Explicit Gemini pins preserved:** `evaluate.ts` passes `modelId: EXPLAIN_GAP_MODEL_ID` (`gemini-4-hydrogen`), which routes explicitly to `@ai-sdk/google` regardless of `META_API_KEY`. `src/server/ingest/embed.ts` remains on `gemini-embedding-2` (768 dimensions) because Meta Model API has no embedding endpoint.
- **Shared invariants:** Meta calls execute inside the same process-wide sequential queue (`enqueueProcessTask`), disable provider auto-retries (`maxRetries` replaced by direct `fetch` per physical attempt), retry only HTTP `429` with jittered exponential backoff up to `DEFAULT_MAX_ATTEMPTS = 3`, measure latency before `schema.parse()`, persist one `agent_tasks` row per physical attempt, and redact the sent API key from error text before persistence.

## Structured output adapter (`strict: true`)

`createMetaGenerator()` uses `response_format: { type: 'json_schema', json_schema: { strict: true, schema } }`, built by `toMetaStrictJsonSchema(schema)`:

- Converts flat/1-level Zod schemas via `z.toJSONSchema(schema)`.
- Sets `additionalProperties: false` and `required = Object.keys(properties)` on object nodes.
- Strips JSON Schema keywords unsupported by Meta's strict grammar (`$schema`, `$id`, `default`, `minLength`, `maxLength`, `minItems`, `maxItems`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `pattern`, `format`). Full Zod validation still runs post-call in `executeCall`, matching [ADR 0009](./0009-gemini-only.md).
- Expects `completion_tokens` to include internal reasoning tokens and rejects explicit refusal payloads cleanly.

## Pricing and data policy consequences

- **Published Contributor rate:** `DEFAULT_PRICING['muse-spark-1.3-contributor']` records Meta's published Contributor list rate of **$0.10 per 1M input tokens** and **$0.20 per 1M output tokens** (reasoning tokens included in output; cached-input token accounting is not modeled in `computeCostUsd`). As with Gemini, this populates `agent_tasks.cost_usd` as an accounting estimate, not billing telemetry.
- **Contributor data-usage policy:** Meta's Contributor tier grants Meta permission to train on prompts and completions in exchange for lower token rates. Just as under Gemini's free tier, **no secrets, personal data, or user-supplied private documents** may enter pipeline prompts, and `createMetaGenerator()` redacts the sent `META_API_KEY` / Bearer header before throwing errors.
