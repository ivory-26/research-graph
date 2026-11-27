# Gemini is the only model provider

Both text generation and embeddings come from Google Gemini through the Vercel AI SDK's Google provider. There is one API key and one account.

pgvector needs an embedding model, and Anthropic does not make one. Choosing Claude would therefore mean two providers, two keys, two rate limits and two failure modes inside a ten-day window. Gemini's free tier covers the models we need, and Gemini is supported in India. The cost is extraction quality: Gemini is a step below Claude on long, structured, instruction-heavy extraction.

## Consequences

- Free-tier quotas are unpublished, applied per project rather than per key, and explicitly "not guaranteed". Every model call needs 429 backoff with jitter, and the demo must not depend on a burst of parallel calls.
- Free-tier prompts may be used to improve Google's products. No secrets, no personal data, and no user-supplied private documents go into a prompt.
- Structured output is a JSON Schema subset: `minLength`, `maxLength`, `uniqueItems` and similar keywords are silently ignored, and recursive `$ref` is restricted. Every schema in the pipeline must stay flat and non-recursive, which is a real constraint on the experiment specification.

## Update — 25 November 2026

The "one provider, one key" decision still holds, with one pinned model exception: the Stage 7 `explain_gap` call uses `gemini-4-hydrogen` while every other text call site uses `gemini-3.8-flash`, and embeddings stay on `gemini-embedding-2`. The verdict is computed by `evaluateExperiment` before that call, so the exception cannot change an outcome. `DEFAULT_PRICING` costs the evaluator call at the published Standard paid rate ($1.50 input / $7.50 output per million tokens, thinking billed as output); that is an accounting estimate, not billing telemetry.

## Update — 27 November 2026

Amended by [ADR 0014](./0014-meta-muse-spark-contributor-provider.md): setting an explicit `META_API_KEY` routes general text calls through Meta Model API's `muse-spark-1.3-contributor` inside `src/server/model.ts` (`$0.10` / `$0.20` per million tokens Contributor list rate), while `gemini-3.8-flash` remains `DEFAULT_MODEL_ID` when `META_API_KEY` is unset, `gemini-4-hydrogen` remains pinned for `explain_gap`, and `gemini-embedding-2` remains the sole embedding model.
