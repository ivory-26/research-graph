# Gemini is the only model provider

Both text generation and embeddings come from Google Gemini through the Vercel AI SDK's Google provider. There is one API key and one account.

pgvector needs an embedding model, and Anthropic does not make one. Choosing Claude would therefore mean two providers, two keys, two rate limits and two failure modes inside a ten-day window. Gemini's free tier covers the models we need, and Gemini is supported in India. The cost is extraction quality: Gemini is a step below Claude on long, structured, instruction-heavy extraction.

## Consequences

- Free-tier quotas are unpublished, applied per project rather than per key, and explicitly "not guaranteed". Every model call needs 429 backoff with jitter, and the demo must not depend on a burst of parallel calls.
- Free-tier prompts may be used to improve Google's products. No secrets, no personal data, and no user-supplied private documents go into a prompt.
- Structured output is a JSON Schema subset: `minLength`, `maxLength`, `uniqueItems` and similar keywords are silently ignored, and recursive `$ref` is restricted. Every schema in the pipeline must stay flat and non-recursive, which is a real constraint on the experiment specification.
