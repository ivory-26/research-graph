import { posix } from 'node:path'
import type { ExperimentSpec } from '../shared/types'

/**
 * Hard rules that an ExperimentSpec must satisfy, as specified in docs/03-agent-pipeline.md
 * and Issue #23:
 * - mode is present and is not 'exact' (current product only produces 'adapted' or 'conceptual').
 * - Exactly one entrypoint, and it must exist in files (e.g. entrypoint "python main.py" -> "main.py" exists in files).
 * - Every dataset has a valid, resolvable URL (http/https).
 * - The script writes its metrics as json.dump to /output/metrics.json in executable code.
 * - Estimated runtime (parameters.estimatedRuntimeSeconds or spec constraint) is under 60 seconds (Issue #23 / docs/03:83).
 * - timeoutSeconds is bounded at 120 seconds (docs/04-experiment-runtime.md:18).
 * - No `pip install` or `pip3 install` inside executable script files.
 * - Structural: network is 'none', language is 'python'.
 */

export interface SpecValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Extracts the normalized file path from an entrypoint command string like "python main.py" or "python3 script.py"
 * Strictly requires python or python3 invocation of a .py file, or a direct .py script.
 * Rejects shell wrappers and non-python entrypoints.
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
 * Strips comments, single-line string literals, and multi-line docstrings from Python source code
 * so string literals, print statements, comments and docstrings cannot satisfy executable code checks.
 */
export function stripPythonLiteralsAndComments(source: string): string {
  let result = ''
  let i = 0
  const n = source.length

  while (i < n) {
    // 1. Single line comment
    if (source[i] === '#') {
      while (i < n && source[i] !== '\n') {
        i++
      }
      continue
    }

    // 2. Triple quoted docstrings: """ or '''
    if (
      (source.slice(i, i + 3) === '"""' || source.slice(i, i + 3) === "'''") &&
      (i === 0 || source[i - 1] !== '\\')
    ) {
      const quote = source.slice(i, i + 3)
      i += 3
      while (i < n && source.slice(i, i + 3) !== quote) {
        if (source[i] === '\\') {
          i += 2
        } else {
          i++
        }
      }
      i += 3
      result += ' '
      continue
    }

    // 3. Regular string literals: "..." or '...'
    if (
      (source[i] === '"' || source[i] === "'") &&
      (i === 0 || source[i - 1] !== '\\')
    ) {
      const quote = source[i]
      i++
      while (i < n && source[i] !== quote && source[i] !== '\n') {
        if (source[i] === '\\') {
          i += 2
        } else {
          i++
        }
      }
      if (i < n && source[i] === quote) {
        i++
      }
      result += ' '
      continue
    }

    result += source[i]
    i++
  }

  return result
}

/**
 * Checks whether Python source code contains an executable pip/pip3 install command.
 * Inspects both stripped code (for inline execution) and raw code (for os.system / subprocess calls).
 */
export function hasProhibitedPipInstall(source: string): boolean {
  // Check for pip / pip3 invocation in executable code or string arguments passed to system/subprocess
  const pipPattern = /\b(pip|pip3)\s+install\b/i
  const lines = source.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) continue // Pure comments ignored
    if (pipPattern.test(line)) {
      return true
    }
  }
  return false
}

/**
 * Validates that an executable module actually writes metrics to /output/metrics.json via json.dump.
 * Ensures the call is not enclosed inside a string literal, print statement, or docstring.
 */
export function validateScriptMetricsOutput(source: string): boolean {
  // 1. Must contain json.dump call in executable code (outside strings and comments)
  const executableCode = stripPythonLiteralsAndComments(source)
  const hasExecutableJsonDump = /\bjson\.dump\s*\(/.test(executableCode)
  if (!hasExecutableJsonDump) {
    return false
  }

  // 2. Must contain the fixed /output/metrics.json target path in code (or pathlib / os.path construction)
  const hasMetricsTargetPath =
    /\/output\/metrics\.json/.test(source) ||
    (/(['"])\/output\1/.test(source) && /(['"])metrics\.json\1/.test(source))

  return hasMetricsTargetPath
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
  let entryFile: string | null = null
  if (!s.entrypoint || typeof s.entrypoint !== 'string') {
    errors.push('entrypoint must be a non-empty string')
  } else {
    entryFile = extractEntrypointFile(s.entrypoint)
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

  // 7. No pip/pip3 install in files, and entrypoint file must write to /output/metrics.json via json.dump
  if (s.files && typeof s.files === 'object') {
    for (const [filename, source] of Object.entries(s.files)) {
      if (typeof source !== 'string') {
        errors.push(`file '${filename}' content must be a string`)
        continue
      }
      if (hasProhibitedPipInstall(source)) {
        errors.push(`file '${filename}' contains prohibited 'pip install' or 'pip3 install'. Base image already includes required libraries.`)
      }
    }

    // Require entrypoint file itself to write /output/metrics.json (or call a function that writes it)
    if (entryFile && s.files[entryFile]) {
      const entrySource = s.files[entryFile]
      if (!validateScriptMetricsOutput(entrySource)) {
        errors.push(`Entrypoint file '${entryFile}' must write metrics as json.dump to /output/metrics.json in executable code`)
      }
    } else if (!entryFile) {
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

  // 9. Runtime constraints:
  // - timeoutSeconds <= 120 per docs/04-experiment-runtime.md:18
  // - estimated runtime under 60 seconds per docs/03-agent-pipeline.md:83 and Issue #23
  if (typeof s.timeoutSeconds !== 'number' || s.timeoutSeconds <= 0) {
    errors.push('timeoutSeconds must be a positive number')
  } else if (s.timeoutSeconds > 120) {
    errors.push('timeoutSeconds cannot exceed 120 seconds (docs/04 contract bound)')
  }

  const estimatedRuntime = (s.parameters as Record<string, unknown> | undefined)?.estimatedRuntimeSeconds
  if (typeof estimatedRuntime === 'number' && estimatedRuntime >= 60) {
    errors.push('estimatedRuntimeSeconds must be under 60 seconds (docs/03 rule)')
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
