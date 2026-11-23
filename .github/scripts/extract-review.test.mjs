import assert from "node:assert/strict"
import test from "node:test"

import { extractReview } from "./extract-review.mjs"

test("uses the final text part and ignores narration", () => {
  const raw = [
    JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
    JSON.stringify({ type: "text", part: { type: "text", text: "I'll read the files first." } }),
    JSON.stringify({ type: "tool_use", part: { type: "tool", tool: "read" } }),
    JSON.stringify({
      type: "text",
      part: { type: "text", text: "VERDICT: FINDINGS\n## Definition of done\n- [ ] x" },
    }),
    JSON.stringify({ type: "step_finish", part: { type: "step-finish" } }),
  ].join("\n")

  assert.equal(extractReview(raw), "VERDICT: FINDINGS\n## Definition of done\n- [ ] x")
})

test("ignores malformed lines and reports error events without failing", () => {
  const raw = [
    "not json",
    JSON.stringify({ type: "error", error: { message: "boom" } }),
    JSON.stringify({
      type: "text",
      part: { type: "text", text: "VERDICT: READY\n## Definition of done\n- [x] done" },
    }),
  ].join("\n")

  assert.equal(extractReview(raw), "VERDICT: READY\n## Definition of done\n- [x] done")
})
