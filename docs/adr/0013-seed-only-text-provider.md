# The seed's text provider is injected, not the application's

> **Superseded by [ADR 0014](./0014-meta-muse-spark-contributor-provider.md).** Meta was subsequently adopted as the application's text provider when `META_API_KEY` is set; this ADR records the earlier seed-only scope and the reasons it was chosen first.

The application's text provider stays Google Gemini ([ADR 0009](./0009-gemini-only.md)). The seed (`scripts/seed/model.ts`) is the one caller that injects a different generator: Meta Model API's `muse-spark-1.3-contributor` through the OpenAI-compatible provider.

## Context

The live capture on 27 November was blocked by sustained Gemini 503 "high demand" responses on both `gemini-3.8-flash` and `gemini-4-hydrogen`, across two keys and projects. A seed that cannot complete a live capture cannot produce the recorded baseline issue #8 needs. Meta's Contributor-mode model was available, cheap, and returned structured output reliably. The application, however, has a documented "one provider, one key" decision and a demo whose trust boundary must not change because a seed needed a fallback.

## Decision

- The application runtime keeps the pinned stack: `DEFAULT_MODEL_ID` is `gemini-3.8-flash`, the evaluator's `explain_gap` pin is `gemini-4-hydrogen`, embeddings are `gemini-embedding-2`, and `DEFAULT_RUNTIME.generate` is the Gemini generator.
- Only `scripts/seed/model.ts` selects Meta and the seed's record/replay wrapper. It builds an isolated `createCallModel` with the Meta generator, the Meta default model, and `DEFAULT_PRICING`. The wrapper remaps the evaluator's explicit Gemini pin to the seed model so the `agent_tasks` row records the model that actually answered.
- The application never reads `SEED_RECORD_MODEL_OUTPUTS` or `SEED_REPLAY_MODEL_OUTPUTS`. A stray variable in a deployed environment cannot make the app serve recorded output or write task rows for calls that never happened.
- Meta runs the text schemas in non-strict mode because its strict validator rejects the extraction contract's optional properties. The wrapper re-parses every result with the original Zod schema, so an optional field cannot skip validation.
- The seed sends only public paper text, generated experiment specs and measured values. It never sends a credential, personal data or a private user document.

## Consequences

- The seed has a second provider and a second key (`MODEL_API_KEY`) in addition to the Gemini embedding key. The application does not.
- Contributor mode permits Meta to use prompts and responses to train future models. That is acceptable for the seed's public-paper corpus and is stated in `scripts/seed/README.md`; it would not be acceptable for arbitrary user documents.
- A captured recording is tied to the seed model and the production prompts. When either changes, the recording must be recaptured; a changed prompt is a hard error, not a fuzzy match.
- The seed's `agent_tasks` rows record `muse-spark-1.3-contributor`, which is why the seeded workspace's dashboard labels that model. The application's own rows continue to record Gemini models.
