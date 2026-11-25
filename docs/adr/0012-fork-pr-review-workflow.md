# Review fork pull requests from a trusted base, never by running fork code

The automated PR reviewer runs on every same-repository pull request and on pull requests from one approved fork (`yashhh-23/research-graph`, repository id `1468841894`). For a fork PR it checks out the **base branch**, reads the fork diff through the GitHub API, and never executes the fork's code, install scripts or tests.

GitHub disables `pull_request` workflows for forks of private repositories unless the repository opts in to running fork workflows, and the original reviewer also required the head branch to come from the base repository. GitGuardian still reported on those PRs because it is a separate GitHub App reacting to its own events, which made the gap look inconsistent. Enabling fork workflow execution globally would have put the `OPENCODE_GO_API_KEY` job within reach of unreviewed fork code; admitting the fork by repository id keeps the review working without that exposure.

## How the trust boundary is drawn

- **Two events, one allowlist.** Same-repository PRs use `pull_request`. Fork PRs use `pull_request_target`, which runs in the base repository's context, and are admitted only when `head.repo.id` is the approved fork, the base is `main`, the PR is open and it is not a draft. The resolved head SHA must match the event's SHA.
- **Checks are separate from review.** The `checks` job runs `pnpm typecheck`, `pnpm test` and `pnpm db:check` only for same-repository PRs, with no repository secrets and no persisted git credentials. Fork PRs report every check as `NOT RUN`.
- **The reviewer is restored from the base.** For a same-repository PR, `docs/`, `CLAUDE.md`, `GLOSSARY.md`, every `AGENTS.md`, `.opencode/`, `.npmrc` and the review scripts are checked out from the base branch. The reviewer reads the PR's code, but its instructions and tooling are the trusted ones.
- **The workflow is not PR-editable.** A PR that changes `.github/workflows/pr-review.yml` fails the review with an instruction for a maintainer. The introducing PR is the one exception and only warns.
- **Transitional pins.** While the base branch cannot supply the reviewer and scripts, their sha256 values are pinned in the workflow; changing them requires changing the pins in the same PR. Once the base supplies them, that restore is the trust boundary.
- **The model cannot post.** The reviewer is read-only: no edit, shell, web or subagent permissions. The workflow parses its `GATE:` line, requires the definition-of-done and checks sections, downgrades a `READY` to `FINDINGS` if checks failed or a human requested changes, strips notification mentions, and posts one comment with a hidden hash header so a later run edits rather than duplicates it.

## Consequences

- A fork PR cannot be declared ready by the bot. Its checks are `NOT RUN`, which the gate treats as a blocker; a maintainer must run them locally or on a branch in the base repository before merging.
- The review is a second opinion, not an approval. A `READY` comment never replaces human review, and a workflow change always requires a human.
- The repository-id allowlist is deliberately narrow. Adding a fork means editing and reviewing the workflow; it is not a setting someone can flip.
- If the base branch ever loses the reviewer or scripts, the transitional pins become load-bearing again. Updating the reviewer then means updating the pins in the same PR.
