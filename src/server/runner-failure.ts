/**
 * Turns a thrown runner error into the three things the pipeline needs:
 *
 * - **whether the experiment script caused it** (a repairable failure),
 * - **a product-authored sentence** safe to persist and stream, and
 * - **a stable classification** tests can assert without matching prose.
 *
 * The distinction matters more than it looks. `docs/03-agent-pipeline.md:148`
 * lets a failed or timed-out run enter the bounded repair loop; a missing or
 * invalid `metrics.json` is a script bug and belongs there. A sandbox whose
 * pinned packages do not match, or a provider/SDK failure before the script
 * ran, is an environment or infrastructure problem: asking a text model to
 * rewrite the script would not fix it and would burn the two-attempt ceiling.
 *
 * Everything that is not a typed runner failure is `infrastructure`. The raw
 * message is never returned here; it can carry a host, a connection string or
 * an API key fragment. The caller keeps it in the server log.
 */
import {
  MetricsExtractionError,
  PackageVerificationError,
  SandboxTimeoutError,
} from './runner'

export type RunnerFailureKind =
  | 'script'
  | 'metrics'
  | 'environment'
  | 'timeout'
  | 'infrastructure'

/** A typed runner error name survives a cross-realm/`instanceof` miss. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : ''
}

export function classifyRunnerFailure(error: unknown): RunnerFailureKind {
  if (error instanceof MetricsExtractionError || errorName(error) === 'MetricsExtractionError') {
    return 'metrics'
  }
  if (error instanceof SandboxTimeoutError || errorName(error) === 'SandboxTimeoutError') {
    return 'timeout'
  }
  if (
    error instanceof PackageVerificationError ||
    errorName(error) === 'PackageVerificationError'
  ) {
    return 'environment'
  }
  return 'infrastructure'
}

/**
 * Only a script-caused failure is repairable. A timeout is repairable as well,
 * but the caller already routes `runs.status = 'timeout'` into the loop; this
 * predicate exists for the `failed` branch, where a metrics-extraction error
 * used to be refused because the runner had thrown.
 */
export function isRepairableRunnerFailure(kind: RunnerFailureKind): boolean {
  return kind === 'script' || kind === 'metrics' || kind === 'timeout'
}

/**
 * The durable/streamed sentence for a runner failure. No raw `Error.message`
 * ever appears here: `describeStreamFailure` relies on the same rule.
 */
export function safeRunnerFailureMessage(kind: RunnerFailureKind): string {
  switch (kind) {
    case 'metrics':
      return 'The experiment did not produce valid metrics'
    case 'environment':
      return 'The experiment environment failed pinned-package verification'
    case 'timeout':
      return 'The experiment timed out before completing'
    case 'script':
      return 'The experiment script did not exit successfully'
    case 'infrastructure':
      return 'The experiment runner did not complete'
  }
}
