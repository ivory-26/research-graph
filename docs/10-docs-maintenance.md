# Documentation maintenance

The docs are a manually refreshed snapshot of `main`. There is deliberately no CI gate that forces a docs update, decided on 25 November 2026. That means drift is a process risk, not a build failure; this page is the process.

## Source of truth

`main` is the source of truth for code. A `docs/current-state-<date>` branch is a patch set against `main`, not a parallel truth.

The current snapshot is `docs/current-state-25-nov`, pushed on 25 November 2026 and not merged at the time of writing. Until it is merged:

- Base the next documentation update on the newest `docs/current-state-*` branch, never on an older docs snapshot.
- Rebase that branch onto `main` before editing, so the diff stays reviewable.
- Record the refresh date in the README status line and in each document's status section.
- Do not create a pull request unless asked; the branch is the handoff.

Once a snapshot is merged, main becomes the base again and the next snapshot branches from it.

## When to refresh

Refresh after any merge that changes one of these, and before the recording or a milestone:

| Change | Documents to re-check |
|---|---|
| Tables, enums, constraints, migrations | `02-data-model.md`, `03-agent-pipeline.md` |
| Pipeline stage behaviour, model pins, pricing | `03-agent-pipeline.md`, `04-experiment-runtime.md`, `CLAUDE.md` |
| Routes, SSE events, approval flow | `01-architecture.md`, `09-pipeline-delivery-handoff.md` |
| Commands, environment variables, CI | `README.md`, `CLAUDE.md`, `01-architecture.md`, `08-auth.md` |
| Auth, workspace membership | `08-auth.md`, `02-data-model.md` |
| Ownership or file layout | `07-workstreams.md`, `.github/CODEOWNERS` |
| A new surprising decision | a new ADR in `docs/adr/`, plus an update note in the ADR it changes |
| Anything that changes "what works on main" | the status section of `README.md`, `00-scope.md`, `05-plan.md`, `06-risks.md` |

## Refresh procedure

1. `git fetch origin` and fast-forward `main`.
2. Switch to the newest `docs/current-state-*` branch, or create one from `main`: `git switch -c docs/current-state-<date>`.
3. Rebase onto `main` before editing.
4. Run `pnpm typecheck`, `pnpm test`, and `pnpm db:check`; record the result in the branch description or the status section.
5. Walk the trigger table above. Update every claim that is now false, including the dated status lines.
6. Re-check every relative link and every ADR reference.
7. Commit with a `docs:` message and push the branch. Do not open a PR unless asked.

## What "manual" costs

This process cannot guarantee that another developer updates the docs. It only makes the obligation visible and cheap to perform. The failure mode is a stale status section that still says a feature is missing after it lands, or still says it works after it is removed.

If drift becomes a recurring problem, the cheapest upgrade is a CI job that fails a PR touching `src/`, the schema, `scripts/` or `package.json` unless it also touches `docs/`, or carries a `docs:not-needed` label. That is a deliberate deferred decision, not an oversight.

## Earlier docs branches

These are fully merged into `main` (zero commits ahead) and are kept as history. Do not reopen them or base new work on them:

- `docs/merged-state-31-32`
- `docs/merged-state-34-38`
- `docs/29-demo-deck`
- `docs/30-demo-recording`
