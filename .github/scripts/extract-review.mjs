import { existsSync, readFileSync } from "node:fs"

const file = process.argv[2]
if (!file) {
  console.error("usage: extract-review.mjs <events.ndjson>")
  process.exit(2)
}

const raw = existsSync(file) ? readFileSync(file, "utf8") : ""
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
  if (event.type === "text" && event.part?.kind === "text" && typeof event.part.text === "string") {
    texts.push(event.part.text)
  }
}

process.stdout.write(texts.join("\n").trim() + "\n")
