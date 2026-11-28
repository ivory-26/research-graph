# Deploy configuration (Vercel)

Status: deployed to production at <https://research-graph-sage.vercel.app>
(Vercel project `research-graph`, team `sahil-64d5`; app commit `33d9933`). The
public URL redirects to `/sign-in`; Google sign-in completes and the signed-in
user lands in their workspace. This document records what the deploy needs and
which values are deliberately not in the repository.

## Runtime

| Piece | Value | Why |
|---|---|---|
| Nitro preset | `vercel` when `VERCEL` is set | `vite.config.ts` selects it; TanStack Start has no Vercel-specific preset. |
| Node | `26.x` | Vercel's current default is Node 26. `.nvmrc` / `.node-version` pin `26.13.1` locally. |
| Function duration | 300 s on `/api/pipeline/**` | Vercel Hobby caps a function at 300 s and streamed time counts. The SSE budget is 240 s, so the terminal append still fits. |
| Package manager | `pnpm@12.23.0` | `packageManager` is pinned; Vercel reads it through corepack. |

`vercel.json` keeps only `buildCommand` and `installCommand`. The duration is
set through Nitro's `vercel.functions` / `functionRules` because Nitro emits the
Build Output API config per function (`maxDuration` in each `.vc-config.json`),
so the value travels with the function rather than depending on a separate
`vercel.json` mapping.

## Request limits

Vercel caps a serverless request body near 4.5 MB. Source ingestion therefore
accepts PDFs up to **3 MB** (`MAX_PDF_BYTES`, `src/shared/source-limits.ts`,
re-exported by `src/server/source-input.ts`). A PDF travels base64-encoded
(about a third larger) inside a multipart or JSON envelope, so a larger
advertised cap would be rejected by the platform before it reached the
validator. The `413`/`400` messages and the upload label derive their text from
the same constant.

## Environment variables

Set every value below in the Vercel project (Production and Preview). They are
server-only; none should be prefixed with `VITE_`.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Neon Postgres connection string for the migrated branch. Use the pooled string in a serverless deploy. |
| `NEON_AUTH_BASE_URL` | yes | Managed Better Auth URL, including the database path. HTTPS is required outside loopback. |
| `NEON_AUTH_COOKIE_SECRET` | yes | At least 32 characters; signs the cached session cookie. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | yes | Gemini text calls and `gemini-embedding-2` embeddings. |
| `META_API_KEY` | no | Switches general text calls to `muse-spark-1.3-contributor`. `explain_gap` stays on `gemini-4-hydrogen`. |
| `E2B_API_KEY` | yes for runs | Creates the `researchgraph-python:locked` sandbox. |
| `FIRECRAWL_API_KEY` | only for Firecrawl ingestion | Project pages and repository READMEs. |
| `FIRECRAWL_API_URL` | no | Firecrawl-compatible base URL override. |

`GEMINI_API_KEY` is accepted as an alias for `GOOGLE_GENERATIVE_AI_API_KEY` in
both embeddings and text generation (`resolveGeminiApiKey`), but the documented
name above is the one to set.

The committed `.env.example` is the canonical list.

## Database

The deployed branch must run the committed migrations:

```bash
pnpm db:migrate
```

`pnpm seed` rebuilds the recorded demo workspace from an empty database. It is a
local/operator command, not part of the build, and it must point at the intended
branch. The seed pins Meta's `muse-spark-1.3-contributor` for its recorded
baseline even when `META_API_KEY` is absent (the recording is keyed to it).

## What the deploy still needs

- A Neon branch with the migrations applied and at least one workspace the
  signed-in user belongs to. The `/api/workspaces` route creates the user's
  personal owner workspace on first visit; it does not seed papers or runs.
- The E2B template published in the same E2B team as `E2B_API_KEY`
  (`node scripts/build-e2b-template.mjs`).
- Vercel environment variables set from `.env.example` (production and preview
  are configured; see the deployed status above).

## Not fixes, and why

- **No job engine.** A pipeline is one SSE request (ADR 0003). A 300 s function
  limit is therefore a hard ceiling on a run plus repair, not a queue delay.
- **`imageDigest` stays `unknown` on E2B.** The published template does not
  write `/etc/image-digest`; the template id and build id are the durable
  identity.
- **Function memory is a dashboard setting.** Fluid compute makes memory a
  project setting rather than a `vercel.json` field; the sandbox's own memory is
  baked into the E2B template (2048 MB).
