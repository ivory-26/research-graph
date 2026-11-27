# Gemini is the only model provider

Both text generation and embeddings come from Google Gemini through the Vercel AI SDK's Google provider. There is one API key and one account.

pgvector needs an embedding model, and Anthropic does not make one. Choosing Claude would therefore mean two providers, two keys, two rate limits and two failure modes inside a ten-day window. Gemini's free tier covers the models we need, and Gemini is supported in India. The cost is extraction quality: Gemini is a step below Claude on long, structured, instruction-heavy extraction.

## Consequences

- Free-tier quotas are unpublished, applied per project rather than per key, and explicitly "not guaranteed". Every model call needs 429/503 backoff with jitter, and the demo must not depend on a burst of parallel calls.
- Free-tier prompts may be used to improve Google's products. No secrets, no personal data, and no user-supplied private documents go into a prompt.
- Structured output is a JSON Schema subset: `minLength`, `maxLength`, `uniqueItems` and similar keywords are silently ignored, and recursive `$ref` is restricted. Every schema in the pipeline must stay flat and non-recursive, which is a real constraint on the experiment specification.

## Update — 25 November 2026

The "one provider, one key" decision still holds, with one pinned model exception: the Stage 7 `explain_gap` call uses `gemini-4-hydrogen` while every other text call site uses `gemini-3.8-flash`, and embeddings stay on `gemini-embedding-2`. The verdict is computed by `evaluateExperiment` before that call, so the exception cannot change an outcome. `DEFAULT_PRICING` costs the evaluator call at the published Standard paid rate ($1.50 input / $7.50 output per million tokens, thinking billed as output); that is an accounting estimate, not billing telemetry.

## Update — 27 November 2026

The wrapper now retries 503 provider-capacity responses (`high demand`) with the same bounded backoff and jitter as 429. Every physical attempt still writes exactly one `agent_tasks` row; a capacity retry is `retried`, not hidden.

The seed (`scripts/seed/model.ts`) may inject Meta Model API's `muse-spark-1.3-contributor` through the OpenAI-compatible provider for its recorded text baseline, because sustained Gemini 503s blocked the live capture. This is a seed-only exception, not a new application provider: `DEFAULT_MODEL_ID` remains `gemini-3.8-flash`, the evaluator's `explain_gap` pin remains `gemini-4-hydrogen`, embeddings remain `gemini-embedding-2`, and the application runtime never reads the seed's record/replay variables. See [ADR 0013](./0013-seed-only-text-provider.md) for the exception's scope and data boundary. Contributor mode permits Meta to use prompts and responses to train future models; the seed sends only public paper text and generated specs, never a secret, personal data or a user-supplied private document. Contributor pricing ($0.10 input / $0.20 output per million tokens) is an accounting estimate, not billing telemetry. Meta's strict JSON-schema mode rejects optional object properties, and the extraction contract legitimately has them (`codeUrls`, `datasets`, ...), so the seed sends its text schemas with `strictJsonSchema: false` and revalidates every result with the original Zod schema.
