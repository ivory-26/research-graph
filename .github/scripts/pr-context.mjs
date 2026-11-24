import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"

const pr = process.argv[2]
if (!pr) {
  console.error("usage: pr-context.mjs <pr-number>")
  process.exit(2)
}

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
const api = (path) => JSON.parse(gh("api", "--paginate", "--slurp", path)).flat()

const repo =
  process.env.GH_REPO ??
  JSON.parse(gh("repo", "view", "--json", "nameWithOwner")).nameWithOwner

const meta = JSON.parse(
  gh(
    "pr",
    "view",
    pr,
    "--json",
    "number,title,body,author,baseRefName,headRefName,headRefOid,url,isDraft,reviewDecision,files,commits,closingIssuesReferences",
  ),
)

// Reviews, review bodies, inline comments and issue comments are all input to
// the cross-verification step. Keep only the fields the reviewer needs.
meta.reviews = api(`repos/${repo}/pulls/${pr}/reviews`).map((review) => ({
  id: review.id,
  author: review.user?.login ?? null,
  state: review.state,
  body: review.body ?? "",
  submittedAt: review.submitted_at ?? null,
  url: review.html_url ?? null,
}))

meta.inlineReviewComments = api(`repos/${repo}/pulls/${pr}/comments`).map((comment) => ({
  id: comment.id,
  author: comment.user?.login ?? null,
  path: comment.path,
  line: comment.line ?? comment.original_line ?? null,
  body: comment.body ?? "",
  createdAt: comment.created_at ?? null,
  inReplyToId: comment.in_reply_to_id ?? null,
  url: comment.html_url ?? null,
}))

meta.issueComments = api(`repos/${repo}/issues/${pr}/comments`).map((comment) => ({
  id: comment.id,
  author: comment.user?.login ?? null,
  body: comment.body ?? "",
  createdAt: comment.created_at ?? null,
  url: comment.html_url ?? null,
}))

const botMarker =
  /<!--\s*research-graph-pr-review hash=([0-9a-f]+) (?:gate|verdict)=([A-Z]+)\s*-->/
meta.botReview =
  meta.issueComments
    .filter(
      (comment) =>
        (comment.author === "github-actions[bot]" || comment.author === "github-actions") &&
        botMarker.test(comment.body),
    )
    .at(-1) ?? null

writeFileSync("pr-context.json", JSON.stringify(meta, null, 2) + "\n")
writeFileSync("pr-body.md", (meta.body ?? "") + "\n")

// The JSON keeps the structured data, but long bodies arrive as one line and
// can be truncated by a reader. The Markdown copies preserve line breaks.
const discussion = []
for (const review of meta.reviews) {
  discussion.push(
    `## Review by @${review.author ?? "unknown"} — ${review.state} — ${review.submittedAt ?? ""}\n\n${review.body || "(no body)"}\n`,
  )
}
for (const comment of meta.inlineReviewComments) {
  discussion.push(
    `## Inline review comment by @${comment.author ?? "unknown"} on \`${comment.path}:${comment.line ?? "?"}\` — ${comment.createdAt ?? ""}\n\n${comment.body || "(no body)"}\n`,
  )
}
for (const comment of meta.issueComments) {
  discussion.push(
    `## Comment by @${comment.author ?? "unknown"} — ${comment.createdAt ?? ""}\n\n${comment.body || "(no body)"}\n`,
  )
}
writeFileSync("pr-discussion.md", discussion.join("\n---\n\n") || "No reviews or comments.\n")

// The model has a 1M-token window; a 1MB diff is a safe ceiling and leaves room for the repo.
const MAX_DIFF = 1_000_000
let diff = gh("pr", "diff", pr)
if (diff.length > MAX_DIFF) {
  diff =
    diff.slice(0, MAX_DIFF) +
    "\n\n[DIFF TRUNCATED AT 1,000,000 CHARACTERS — review the file list in pr-context.json too]\n"
}
writeFileSync("pr.diff", diff)

const numbers = new Set()
for (const issue of meta.closingIssuesReferences ?? []) numbers.add(issue.number)
for (const match of (meta.body ?? "").matchAll(/#(\d+)\b/g)) numbers.add(Number(match[1]))
numbers.delete(meta.number)

const issues = [...numbers].slice(0, 10)
let markdown = ""
for (const number of issues) {
  try {
    const issue = JSON.parse(
      gh("issue", "view", String(number), "--json", "number,title,body,state,labels"),
    )
    markdown += `## Issue #${issue.number} — ${issue.title} (${issue.state})\n\n`
    markdown += `Labels: ${issue.labels.map((label) => label.name).join(", ") || "(none)"}\n\n`
    markdown += `${(issue.body ?? "(no body)").slice(0, 20_000)}\n\n---\n\n`
  } catch {
    markdown += `## Issue #${number}\n\n(Could not be loaded; it may be a pull request or in another repository.)\n\n---\n\n`
  }
}

writeFileSync(
  "linked-issues.md",
  markdown || "No linked issues were found. Judge the PR against the project plan and the PR body.\n",
)

console.log(
  `PR #${meta.number}: ${meta.files.length} changed file(s), ${issues.length} linked issue(s), ` +
    `${meta.reviews.length} review(s), ${meta.inlineReviewComments.length} inline review comment(s), ` +
    `${meta.issueComments.length} issue comment(s), ${diff.length} diff characters`,
)
