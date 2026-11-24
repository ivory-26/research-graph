import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Pull the reviewer's final answer out of an `opencode run --format json`
 * stream. Text events carry the text at `part.text`; the outer event type is
 * `text`. Narration before the final answer is dropped by starting at the last
 * text part that contains a `GATE:` line.
 */
export function extractReview(raw) {
  const texts = []

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue // progress or warning lines, not events
    }
    if (event.type === "error") {
      console.error("opencode error:", event.error?.message ?? JSON.stringify(event.error))
    }
    if (event.type === "text" && typeof event.part?.text === "string") {
      texts.push(event.part.text)
    }
  }

  const gateIndex = texts.findLastIndex((text) => /^GATE:/m.test(text))
  return (gateIndex >= 0 ? texts.slice(gateIndex) : texts).join("\n").trim()
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]
  if (!file) {
    console.error("usage: extract-review.mjs <events.ndjson>")
    process.exit(2)
  }
  const raw = existsSync(file) ? readFileSync(file, "utf8") : ""
  process.stdout.write(extractReview(raw) + "\n")
}
