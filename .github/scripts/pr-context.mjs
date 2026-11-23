import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"

const pr = process.argv[2]
if (!pr) {
  console.error("usage: pr-context.mjs <pr-number>")
  process.exit(2)
}

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })

const meta = JSON.parse(
  gh(
    "pr",
    "view",
    pr,
    "--json",
    "number,title,body,author,baseRefName,headRefName,headRefOid,url,isDraft,files,commits,closingIssuesReferences,comments,reviews",
  ),
)

writeFileSync("pr-context.json", JSON.stringify(meta, null, 2) + "\n")

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
  `PR #${meta.number}: ${meta.files.length} changed file(s), ${issues.length} linked issue(s), ${diff.length} diff characters`,
)
