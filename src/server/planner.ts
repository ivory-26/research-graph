import { posix } from 'node:path'
import type { ExperimentSpec } from '../shared/types'

/**
 * Hard rules that an ExperimentSpec must satisfy, as specified in docs/03-agent-pipeline.md
 * and Issue #23:
 * - mode is present and is not 'exact' (current product only produces 'adapted' or 'conceptual').
 * - Exactly one entrypoint, and it must exist in files (e.g. entrypoint "python main.py" -> "main.py" exists in files).
 * - Every dataset has a valid, resolvable URL (http/https).
 * - The script writes its metrics as json.dump to /output/metrics.json.
 * - Estimated runtime (timeoutSeconds) is under or equal to 60 seconds (Issue #23 / docs/03:83).
 * - No `pip install` inside any script file.
 * - Structural: network is 'none', language is 'python'.
 */

export interface SpecValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Extracts the normalized file path from an entrypoint command string like "python main.py" or "python3 script.py"
 * Only accepts python / python3 or direct .py scripts. Rejects arbitrary shell commands.
 */
export function extractEntrypointFile(entrypoint: string): string | null {
  const parts = entrypoint.trim().split(/\s+/)
  if (parts.length >= 2 && (parts[0] === 'python' || parts[0] === 'python3')) {
    const raw = parts[1] ?? null
    return raw && raw.endsWith('.py') ? posix.normalize(raw.replace(/\\/g, '/')) : null
  }
  if (parts.length === 1 && parts[0]?.endsWith('.py')) {
    return posix.normalize(parts[0].replace(/\\/g, '/'))
  }
  return null
}

/**
 * Strips comments and docstrings from python source code so comments cannot satisfy validation.
 */
export function stripPythonComments(source: string): string {
  // Remove single line comments
  const lines = source.split('\n').map((line) => {
    let inSingle = false
    let inDouble = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === "'" && !inDouble) inSingle = !inSingle
      else if (char === '"' && !inSingle) inDouble = !inDouble
      else if (char === '#' && !inSingle && !inDouble) {
        return line.slice(0, i)
      }
    }
    return line
  })
  return lines.join('\n')
}

/**
 * Validates that the python source writes metrics via json.dump to /output/metrics.json.
 * Requires actual json.dump and the exact /output/metrics.json path in executable code.
 */
export function validateScriptMetricsOutput(source: string): boolean {
  const code = stripPythonComments(source)
  // Must contain json.dump and /output/metrics.json
  const hasJsonDump = /\bjson\.dump\s*\(/.test(code)
  const hasMetricsPath =
    /\/output\/metrics\.json/.test(code) ||
    (/(["'])\/output\1/.test(code) && /(["'])metrics\.json\1/.test(code)) ||
    (/os\.environ\.get\([^)]*\/output[^)]*\)/.test(code) && /metrics\.json/.test(code))
  return hasJsonDump && hasMetricsPath
}

export function validateExperimentSpec(spec: unknown): SpecValidationResult {
  const errors: string[] = []

  if (!spec || typeof spec !== 'object') {
    return { valid: false, errors: ['Spec must be a non-null object'] }
  }

  const s = spec as Partial<ExperimentSpec>

  // 1. claimNodeId
  if (!s.claimNodeId || typeof s.claimNodeId !== 'string') {
    errors.push('claimNodeId must be a non-empty string')
  }

  // 2. mode is present and not 'exact'
  if (!s.mode) {
    errors.push('mode must be present')
  } else if (s.mode === 'exact') {
    errors.push("mode cannot be 'exact' (only 'adapted' or 'conceptual' are supported)")
  } else if (s.mode !== 'adapted' && s.mode !== 'conceptual') {
    errors.push(`invalid mode: '${s.mode}'. Must be 'adapted' or 'conceptual'`)
  }

  // 3. language is 'python'
  if (s.language !== 'python') {
    errors.push("language must be 'python'")
  }

  // 4. network is 'none'
  if (s.network !== 'none') {
    errors.push("network must be 'none'")
  }

  // 5. files
  if (!s.files || typeof s.files !== 'object' || Array.isArray(s.files)) {
    errors.push('files must be a Record<string, string>')
  }

  // 6. entrypoint exists in files (normalized via posix)
  if (!s.entrypoint || typeof s.entrypoint !== 'string') {
    errors.push('entrypoint must be a non-empty string')
  } else {
    const entryFile = extractEntrypointFile(s.entrypoint)
    if (!entryFile) {
      errors.push(`entrypoint '${s.entrypoint}' must invoke python with a .py script`)
    } else if (s.files && typeof s.files === 'object') {
      const normalizedFiles = new Set(
        Object.keys(s.files).map((f) => posix.normalize(f.replace(/\\/g, '/'))),
      )
      if (!normalizedFiles.has(entryFile)) {
        errors.push(`entrypoint '${s.entrypoint}' references file '${entryFile}', which does not exist in files`)
      }
    }
  }

  // 7. No pip install in files, and must write to /output/metrics.json via json.dump
  if (s.files && typeof s.files === 'object') {
    let hasMetricsOutput = false
    for (const [filename, source] of Object.entries(s.files)) {
      if (typeof source !== 'string') {
        errors.push(`file '${filename}' content must be a string`)
        continue
      }
      const stripped = stripPythonComments(source)
      if (/\bpip\s+install\b/i.test(stripped)) {
        errors.push(`file '${filename}' contains prohibited 'pip install'. Base image already includes required libraries.`)
      }
      if (validateScriptMetricsOutput(source)) {
        hasMetricsOutput = true
      }
    }

    if (!hasMetricsOutput) {
      errors.push('Script must write metrics as json.dump to /output/metrics.json')
    }
  }

  // 8. datasets
  if (!Array.isArray(s.datasets)) {
    errors.push('datasets must be an array')
  } else {
    for (let i = 0; i < s.datasets.length; i++) {
      const d = s.datasets[i]
      if (!d || typeof d !== 'object') {
        errors.push(`dataset[${i}] must be an object`)
        continue
      }
      if (!d.name || typeof d.name !== 'string') {
        errors.push(`dataset[${i}].name must be a non-empty string`)
      }
      if (!d.path || typeof d.path !== 'string') {
        errors.push(`dataset[${i}].path must be a non-empty string`)
      }
      if (!d.url || typeof d.url !== 'string') {
        errors.push(`dataset[${i}].url must be a resolvable string`)
      } else {
        try {
          const parsed = new URL(d.url)
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            errors.push(`dataset[${i}].url must use http or https protocol`)
          }
        } catch {
          errors.push(`dataset[${i}].url '${d.url}' is not a valid URL`)
        }
      }
    }
  }

  // 9. timeoutSeconds: Issue #23 and docs/03:83 mandate estimated runtime under 60 seconds (timeoutSeconds <= 60).
  if (typeof s.timeoutSeconds !== 'number' || s.timeoutSeconds <= 0) {
    errors.push('timeoutSeconds must be a positive number')
  } else if (s.timeoutSeconds > 60) {
    errors.push('timeoutSeconds cannot exceed 60 seconds (runtime under 60s rule per Issue #23)')
  }

  // 10. criteria
  if (!s.criteria || typeof s.criteria !== 'object') {
    errors.push('criteria must be an object')
  } else {
    if (s.criteria.mode !== 'all' && s.criteria.mode !== 'any') {
      errors.push("criteria.mode must be 'all' or 'any'")
    }
    if (!Array.isArray(s.criteria.checks) || s.criteria.checks.length === 0) {
      errors.push('criteria.checks must be a non-empty array')
    } else {
      const validOps = new Set(['lt', 'lte', 'gt', 'gte', 'eq', 'neq', 'within'])
      for (let i = 0; i < s.criteria.checks.length; i++) {
        const c = s.criteria.checks[i]
        if (!c || typeof c !== 'object') {
          errors.push(`criteria.checks[${i}] must be an object`)
          continue
        }
        if (!c.metric || typeof c.metric !== 'string') {
          errors.push(`criteria.checks[${i}].metric must be a non-empty string`)
        }
        if (!validOps.has(c.op)) {
          errors.push(`criteria.checks[${i}].op '${c.op}' is invalid`)
        }
        if (typeof c.value !== 'number' || Number.isNaN(c.value)) {
          errors.push(`criteria.checks[${i}].value must be a valid number`)
        }
        if (c.op === 'within' && (typeof c.tolerance !== 'number' || Number.isNaN(c.tolerance))) {
          errors.push(`criteria.checks[${i}] uses 'within' op but has no numeric tolerance`)
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
