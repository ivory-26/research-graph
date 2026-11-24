import { posix } from 'node:path'
import type { ExperimentSpec } from '../shared/types'
import { PINNED_E2B_TEMPLATE } from './runner'

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
 * Rejects shell wrappers, shell operators (&&, ;, |, >, <), flags, and non-python entrypoints.
 */
export function extractEntrypointFile(entrypoint: string): string | null {
  const trimmed = entrypoint.trim()
  // Reject shell operators, pipes, redirects, subshells, chaining
  if (/[;&|><\n\r`$()]/.test(trimmed)) {
    return null
  }
  const parts = trimmed.split(/\s+/)
  if (parts.length === 2 && (parts[0] === 'python' || parts[0] === 'python3')) {
    const raw = parts[1]
    if (raw && raw.endsWith('.py') && !raw.startsWith('-')) {
      return posix.normalize(raw.replace(/\\/g, '/'))
    }
    return null
  }
  if (parts.length === 1 && parts[0] && parts[0].endsWith('.py') && !parts[0].startsWith('-')) {
    return posix.normalize(parts[0].replace(/\\/g, '/'))
  }
  return null
}

/**
 * Strips single-line comments from Python source code, preserving line structure and string literals.
 */
export function stripPythonComments(source: string): string {
  let result = ''
  let i = 0
  const n = source.length
  let inSingle = false
  let inDouble = false
  let inTripleSingle = false
  let inTripleDouble = false

  while (i < n) {
    if (inTripleDouble) {
      if (source.slice(i, i + 3) === '"""' && source[i - 1] !== '\\') {
        inTripleDouble = false
        result += '"""'
        i += 3
        continue
      }
      result += source[i]
      i++
      continue
    }
    if (inTripleSingle) {
      if (source.slice(i, i + 3) === "'''" && source[i - 1] !== '\\') {
        inTripleSingle = false
        result += "'''"
        i += 3
        continue
      }
      result += source[i]
      i++
      continue
    }
    if (inDouble) {
      if (source[i] === '"' && source[i - 1] !== '\\') {
        inDouble = false
      }
      result += source[i]
      i++
      continue
    }
    if (inSingle) {
      if (source[i] === "'" && source[i - 1] !== '\\') {
        inSingle = false
      }
      result += source[i]
      i++
      continue
    }

    if (source.slice(i, i + 3) === '"""' && (i === 0 || source[i - 1] !== '\\')) {
      inTripleDouble = true
      result += '"""'
      i += 3
      continue
    }
    if (source.slice(i, i + 3) === "'''" && (i === 0 || source[i - 1] !== '\\')) {
      inTripleSingle = true
      result += "'''"
      i += 3
      continue
    }
    if (source[i] === '"' && (i === 0 || source[i - 1] !== '\\')) {
      inDouble = true
      result += '"'
      i++
      continue
    }
    if (source[i] === "'" && (i === 0 || source[i - 1] !== '\\')) {
      inSingle = true
      result += "'"
      i++
      continue
    }
    if (source[i] === '#') {
      while (i < n && source[i] !== '\n') {
        i++
      }
      continue
    }

    result += source[i]
    i++
  }
  return result
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
 * Inspects both stripped code (for inline shell/magic invocation) and string arguments
 * passed to os.system or subprocess calls.
 * Ignores comments, docstrings, and non-execution print statements.
 */
export function hasProhibitedPipInstall(source: string): boolean {
  // 1. Direct executable invocation (e.g. !pip install or direct CLI syntax)
  const executableCode = stripPythonLiteralsAndComments(source)
  const pipPattern = /\b(pip|pip3)\s+install\b/i
  if (pipPattern.test(executableCode)) {
    return true
  }

  // 2. Prohibited pip invocation passed to os.system or subprocess
  const codeWithoutComments = stripPythonComments(source)
  const systemSubprocessPipPattern =
    /(?:os\.system|subprocess\.(?:run|call|Popen|check_call|check_output))\s*\(\s*(?:\[\s*)?['"][^'"]*\b(pip|pip3)\s+install\b/i
  const listArgSubprocessPipPattern =
    /subprocess\.(?:run|call|Popen|check_call|check_output)\s*\(\s*\[[^\]]*['"](?:pip|pip3)['"]\s*,\s*['"]install['"]/i

  if (
    systemSubprocessPipPattern.test(codeWithoutComments) ||
    listArgSubprocessPipPattern.test(codeWithoutComments)
  ) {
    return true
  }

  return false
}

/**
 * Validates that an executable module actually writes metrics to /output/metrics.json via json.dump.
 * Ensures the target path is checked inside the json.dump/open call and rejects string/comment/decoy occurrences.
 * All json.dump calls in the module must target /output/metrics.json, and at least one must be present.
 */
export function validateScriptMetricsOutput(source: string): boolean {
  // 1. Must contain json.dump call in executable code (outside strings and comments)
  const executableCode = stripPythonLiteralsAndComments(source)
  const hasExecutableJsonDump = /\bjson\.dump\s*\(/.test(executableCode)
  if (!hasExecutableJsonDump) {
    return false
  }

  // 2. Strip comments to ensure comments cannot satisfy the target path check
  const codeWithoutComments = stripPythonComments(source)

  // 3. Collect variables representing the output directory (/output)
  // Matches out = pathlib.Path("/output"), out_dir = Path('/output'), out = "/output", etc.
  const outDirVars = new Set<string>()
  const outDirRegex =
    /\b([a-zA-Z_]\w*)\s*=\s*(?:(?:pathlib\.)?Path\s*\(\s*['"]\/output['"]\s*\)|['"]\/output['"])\s*(?:$|;|\n)/g
  let dirMatch: RegExpExecArray | null
  while ((dirMatch = outDirRegex.exec(codeWithoutComments)) !== null) {
    if (dirMatch[1]) {
      outDirVars.add(dirMatch[1])
    }
  }

  // 4. Collect variables assigned directly to the metrics file path
  const metricsFileVars = new Set<string>()
  const metricsFileRegex =
    /\b([a-zA-Z_]\w*)\s*=\s*(?:(?:pathlib\.)?Path\s*\(\s*['"]\/output\/metrics\.json['"]\s*\)|['"]\/output\/metrics\.json['"]|(?:os\.path\.)?join\s*\(\s*['"]\/output['"]\s*,\s*['"]metrics\.json['"]\s*\))\s*(?:$|;|\n)/g
  let fileVarMatch: RegExpExecArray | null
  while ((fileVarMatch = metricsFileRegex.exec(codeWithoutComments)) !== null) {
    if (fileVarMatch[1]) {
      metricsFileVars.add(fileVarMatch[1])
    }
  }
  for (const d of outDirVars) {
    const slashRegex = new RegExp(
      `\\b([a-zA-Z_]\\w*)\\s*=\\s*${d}\\s*\\/\\s*['"]metrics\\.json['"]\\s*(?:$|;|\\n)`,
      'g',
    )
    let sm: RegExpExecArray | null
    while ((sm = slashRegex.exec(codeWithoutComments)) !== null) {
      if (sm[1]) {
        metricsFileVars.add(sm[1])
      }
    }
    const joinRegex = new RegExp(
      `\\b([a-zA-Z_]\\w*)\\s*=\\s*(?:os\\.path\\.)?join\\s*\\(\\s*${d}\\s*,\\s*['"]metrics\\.json['"]\\s*\\)\\s*(?:$|;|\\n)`,
      'g',
    )
    let jm: RegExpExecArray | null
    while ((jm = joinRegex.exec(codeWithoutComments)) !== null) {
      if (jm[1]) {
        metricsFileVars.add(jm[1])
      }
    }
  }

  const isValidMetricsTargetPath = (rawExpr: string): boolean => {
    let expr = rawExpr.trim()
    while (expr.startsWith('(') && expr.endsWith(')')) {
      expr = expr.slice(1, -1).trim()
    }
    if (
      /^['"]\/output\/metrics\.json['"]$/.test(expr) ||
      /^(?:pathlib\.)?Path\s*\(\s*['"]\/output\/metrics\.json['"]\s*\)$/.test(expr) ||
      /^(?:os\.path\.)?join\s*\(\s*['"]\/output['"]\s*,\s*['"]metrics\.json['"]\s*\)$/.test(expr)
    ) {
      return true
    }
    if (metricsFileVars.has(expr)) {
      return true
    }
    for (const d of outDirVars) {
      if (
        new RegExp(`^${d}\\s*\\/\\s*['"]metrics\\.json['"]$`).test(expr) ||
        new RegExp(`^(?:os\\.path\\.)?join\\s*\\(\\s*${d}\\s*,\\s*['"]metrics\\.json['"]\\s*\\)$`).test(expr)
      ) {
        return true
      }
    }
    return false
  }

  const isValidFileHandle = (fileArg: string): boolean => {
    const trimmed = fileArg.trim()
    // Pattern 1: Inline open(...)
    const openMatch = /^open\s*\((.*)\)$/s.exec(trimmed)
    if (openMatch && openMatch[1]) {
      const inside = openMatch[1].trim()
      const firstArg = inside.split(',')[0]?.trim() ?? ''
      return isValidMetricsTargetPath(firstArg)
    }

    // Pattern 2: Inline (...).open(...)
    const dotOpenMatch = /^(.*)\.open\s*\([^)]*\)$/s.exec(trimmed)
    if (dotOpenMatch && dotOpenMatch[1]) {
      return isValidMetricsTargetPath(dotOpenMatch[1])
    }

    // Pattern 3: Variable handle like f or fp
    if (/^[a-zA-Z_]\w*$/.test(trimmed)) {
      const varName = trimmed
      const withFullRegex = new RegExp(
        `with\\s+open\\s*\\(([^,)]+)[^)]*\\)\\s+as\\s+${varName}\\b`,
        'g',
      )
      let wm: RegExpExecArray | null
      while ((wm = withFullRegex.exec(codeWithoutComments)) !== null) {
        if (wm[1] && isValidMetricsTargetPath(wm[1])) {
          return true
        }
      }

      const withDotOpenRegex = new RegExp(
        `with\\s+([^\\s]+)\\.open\\s*\\([^)]*\\)\\s+as\\s+${varName}\\b`,
        'g',
      )
      let wdm: RegExpExecArray | null
      while ((wdm = withDotOpenRegex.exec(codeWithoutComments)) !== null) {
        if (wdm[1] && isValidMetricsTargetPath(wdm[1])) {
          return true
        }
      }

      const assignOpenRegex = new RegExp(
        `\\b${varName}\\s*=\\s*open\\s*\\(([^,)]+)`,
        'g',
      )
      let am: RegExpExecArray | null
      while ((am = assignOpenRegex.exec(codeWithoutComments)) !== null) {
        if (am[1] && isValidMetricsTargetPath(am[1])) {
          return true
        }
      }

      const assignDotOpenRegex = new RegExp(
        `\\b${varName}\\s*=\\s*([^\\s]+)\\.open\\s*\\(`,
        'g',
      )
      let adm: RegExpExecArray | null
      while ((adm = assignDotOpenRegex.exec(codeWithoutComments)) !== null) {
        if (adm[1] && isValidMetricsTargetPath(adm[1])) {
          return true
        }
      }
    }

    return false
  }

  // 5. Inspect all json.dump calls in executable code
  const dumpCallRegex = /\bjson\.dump\s*\(/g
  let totalDumps = 0
  let validDumps = 0
  let match: RegExpExecArray | null

  while ((match = dumpCallRegex.exec(codeWithoutComments)) !== null) {
    totalDumps++
    const startIdx = match.index + match[0].length
    let parenDepth = 1
    let endIdx = startIdx
    let inString: string | null = null

    while (endIdx < codeWithoutComments.length && parenDepth > 0) {
      const char = codeWithoutComments[endIdx]
      if (inString) {
        if (char === inString && codeWithoutComments[endIdx - 1] !== '\\') {
          inString = null
        }
      } else if (char === '"' || char === "'") {
        inString = char
      } else if (char === '(' || char === '[' || char === '{') {
        parenDepth++
      } else if (char === ')' || char === ']' || char === '}') {
        parenDepth--
      }
      endIdx++
    }

    if (parenDepth === 0) {
      const argsStr = codeWithoutComments.slice(startIdx, endIdx - 1).trim()
      let depth = 0
      let splitIdx = -1
      let strChar: string | null = null
      for (let k = 0; k < argsStr.length; k++) {
        const c = argsStr[k]
        if (strChar) {
          if (c === strChar && argsStr[k - 1] !== '\\') strChar = null
        } else if (c === '"' || c === "'") {
          strChar = c
        } else if (c === '(' || c === '[' || c === '{') {
          depth++
        } else if (c === ')' || c === ']' || c === '}') {
          depth--
        } else if (c === ',' && depth === 0) {
          splitIdx = k
          break
        }
      }

      if (splitIdx !== -1) {
        const remainder = argsStr.slice(splitIdx + 1).trim()
        let fpDepth = 0
        let fpEnd = remainder.length
        let fpStrChar: string | null = null
        for (let k = 0; k < remainder.length; k++) {
          const c = remainder[k]
          if (fpStrChar) {
            if (c === fpStrChar && remainder[k - 1] !== '\\') fpStrChar = null
          } else if (c === '"' || c === "'") {
            fpStrChar = c
          } else if (c === '(' || c === '[' || c === '{') {
            fpDepth++
          } else if (c === ')' || c === ']' || c === '}') {
            fpDepth--
          } else if (c === ',' && fpDepth === 0) {
            fpEnd = k
            break
          }
        }
        const fileArg = remainder.slice(0, fpEnd).trim()
        if (isValidFileHandle(fileArg)) {
          validDumps++
        }
      }
    }
  }

  return totalDumps > 0 && validDumps === totalDumps
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
  const normalizedFilesMap = new Map<string, string>()
  if (!s.files || typeof s.files !== 'object' || Array.isArray(s.files)) {
    errors.push('files must be a Record<string, string>')
  } else if (Object.keys(s.files).length === 0) {
    errors.push('files cannot be empty: must provide at least the entrypoint script')
  } else {
    for (const [key, content] of Object.entries(s.files)) {
      if (typeof content !== 'string') {
        errors.push(`file '${key}' content must be a string`)
        continue
      }
      // Check for path traversal or absolute paths in file keys
      const normalizedKey = posix.normalize(key.replace(/\\/g, '/'))
      if (
        normalizedKey.startsWith('../') ||
        normalizedKey === '..' ||
        posix.isAbsolute(key) ||
        key.startsWith('/') ||
        key.startsWith('\\')
      ) {
        errors.push(`file '${key}' has invalid path: path traversal or absolute paths are prohibited`)
        continue
      }
      normalizedFilesMap.set(normalizedKey, content)

      if (hasProhibitedPipInstall(content)) {
        errors.push(
          `file '${key}' contains prohibited 'pip install' or 'pip3 install'. Base image already includes required libraries.`,
        )
      }
    }
  }

  // 6. entrypoint exists in files (normalized via posix)
  let entryFile: string | null = null
  if (!s.entrypoint || typeof s.entrypoint !== 'string') {
    errors.push('entrypoint must be a non-empty string')
  } else {
    if (hasProhibitedPipInstall(s.entrypoint)) {
      errors.push("entrypoint cannot contain prohibited 'pip install' or 'pip3 install'")
    }
    entryFile = extractEntrypointFile(s.entrypoint)
    if (!entryFile) {
      errors.push(
        `entrypoint '${s.entrypoint}' must invoke python with a .py script (shell wrappers, operators, and additional arguments are prohibited)`,
      )
    } else if (!normalizedFilesMap.has(entryFile)) {
      errors.push(`entrypoint '${s.entrypoint}' references file '${entryFile}', which does not exist in files`)
    }
  }

  // 7. Entrypoint file must write to /output/metrics.json via json.dump
  if (entryFile && normalizedFilesMap.has(entryFile)) {
    const entrySource = normalizedFilesMap.get(entryFile)!
    if (!validateScriptMetricsOutput(entrySource)) {
      errors.push(
        `Entrypoint file '${entryFile}' must write metrics as json.dump to /output/metrics.json in executable code`,
      )
    }
  } else if (!entryFile) {
    errors.push('Script must write metrics as json.dump to /output/metrics.json')
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
      } else {
        const normPath = posix.normalize(d.path.replace(/\\/g, '/'))
        if (
          normPath.startsWith('../') ||
          normPath === '..' ||
          posix.isAbsolute(d.path) ||
          d.path.startsWith('/') ||
          d.path.startsWith('\\')
        ) {
          errors.push(`dataset[${i}].path '${d.path}' cannot contain path traversal or absolute paths`)
        }
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

  const params =
    s.parameters && typeof s.parameters === 'object' && !Array.isArray(s.parameters)
      ? (s.parameters as Record<string, unknown>)
      : null

  const estimatedRuntime = params?.estimatedRuntimeSeconds
  if (
    typeof estimatedRuntime !== 'number' ||
    !Number.isFinite(estimatedRuntime) ||
    estimatedRuntime <= 0
  ) {
    errors.push(
      'parameters.estimatedRuntimeSeconds must be a positive finite number under 60 seconds (Issue #23 / docs/03 rule)',
    )
  } else if (estimatedRuntime >= 60) {
    errors.push(
      `parameters.estimatedRuntimeSeconds is ${estimatedRuntime}s, but must be under 60 seconds (Issue #23 / docs/03 rule)`,
    )
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

  // 11. image
  if (s.image !== undefined) {
    if (typeof s.image !== 'string' || s.image.trim() === '') {
      errors.push('image must be a non-empty string')
    } else if (s.image !== PINNED_E2B_TEMPLATE && s.image !== 'default') {
      errors.push(
        `image '${s.image}' is not supported. Must be '${PINNED_E2B_TEMPLATE}' or 'default'`,
      )
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
