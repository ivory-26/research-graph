# ResearchGraph

An AI research workspace that turns a paper's claim into a connected, executable and auditable experiment.

Drop in a paper. The system extracts what it asserts, cites the passage, plans a minimal repro, runs it on a CPU, and tells you how far your result is from theirs — then lets you change one parameter and see what moves.

## Why this is not another research chatbot

The graph is the presentation, not the product. The product is the claim:

- every relationship in the workspace carries the quote that justifies it
- every result is compared against the number the paper reported, under a declared reproduction mode
- the verdict is computed by code, not written by a model

## Status

Pre-build. The architecture is decided; nothing is implemented. Start with [docs/00-scope.md](./docs/00-scope.md).

| Document | Contents |
|---|---|
| [00-scope](./docs/00-scope.md) | product brief, the demo, non-goals, success criteria |
| [01-architecture](./docs/01-architecture.md) | system shape and the trust boundary |
| [02-data-model](./docs/02-data-model.md) | schema, and the rules the database enforces |
| [03-agent-pipeline](./docs/03-agent-pipeline.md) | the eight deterministic stages |
| [04-experiment-runtime](./docs/04-experiment-runtime.md) | spec, result, E2B adapter, notebook export |
| [05-plan](./docs/05-plan.md) | ten days to 30 November |
| [06-risks](./docs/06-risks.md) | what breaks, and the honest answers |
| [GLOSSARY](./GLOSSARY.md) | the vocabulary |
| [ADRs](./docs/adr/) | why the surprising decisions were made |

## Stack

TanStack Start · React · TypeScript · Neon Postgres (pgvector) · Drizzle · Vercel AI SDK 7 · Google Gemini · E2B · Firecrawl · `@xyflow/react`

## Credit

The node/edge vocabulary and the `command_receipts` idea are borrowed from [FOREST](https://github.com/mikamikasuki/FOREST) (Apache-2.0). No code is copied.
