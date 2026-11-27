# Gemini is the only model provider

Both text generation and embeddings come from Google Gemini through the Vercel AI SDK's Google provider. There is one API key and one account.

pgvector needs an embedding model, and Anthropic does not make one. Choosing Claude would therefore mean two providers, two keys, two rate limits and two failure modes inside a ten-day window. Gemini's free tier covers the models we need, and Gemini is supported in India. The cost is extraction quality: Gemini is a step below Claude on long, structured, instruction-heavy extraction.

## Consequences

- Free-tier quotas are unpublished, applied per project rather than per key, and explicitly "not guaranteed". Every model call needs 429/503 backoff with jitter, and the demo must not depend on a burst of parallel calls.
- Free-tier prompts may be used to improve Google's products. No secrets, no personal data, and no user-supplied private documents go into a prompt.
- Structured output is a JSON Schema subset: `minLength`, `maxLength`, `uniqueItems` and similar keywords are silently ignored, and recursive `$ref` is restricted. Every schema in the pipeline must stay flat and non-recursive, which is a real constraint on the experiment specification.

## Update — 25 November 2026

The "one provider, one key" decision still holds. On 25 November the Stage 7 `explain_gap` call was the only `gemini-4-hydrogen` call site, while every other text call used `gemini-3.8-flash`; embeddings stay on `gemini-embedding-2`. The verdict is computed by `evaluateExperiment` before that call, so the model cannot change an outcome.

## Update — 27 November 2026

`gemini-4-hydrogen` became the default for every text call site after `gemini-3.8-flash` repeatedly returned provider capacity errors during live seeding. The earlier evaluator exception is subsumed, not weakened: the evaluator still pins hydrogen and the verdict is still computed before the explanation call. `gemini-3.8-flash` remains in `DEFAULT_PRICING` for an explicit override. The pricing entry is the published Standard paid rate ($1.50 input / $7.50 output per million tokens, thinking billed as output); it is an accounting estimate, not billing telemetry.

Both models returned 503 "high demand" during the live seed, so the wrapper now retries 503 with the same bounded backoff and jitter as 429. Every physical attempt still writes exactly one `agent_tasks` row; a capacity retry is `retried`, not hidden.
