/**
 * The read-side contract for persisted `run_artifacts`.
 *
 * These types are shared by the authorized artifact endpoint
 * (`src/server/run-artifacts.ts`), the browser client
 * (`src/utils/artifactClient.ts`) and `ExportModal`. They carry no database
 * import, so the client bundle never pulls in Drizzle or a connection string.
 *
 * A manifest describes one terminal run and the artifacts written for it. It is
 * not a second source of truth: every value comes from the `runs` and
 * `run_artifacts` rows, and `runs.metrics` remains the measured result.
 */
import type { RunStatus, Verdict } from './types'

export type RunArtifactKind = 'figure' | 'table' | 'notebook' | 'log'

export type RunArtifactManifestEntry = {
  id: string
  kind: RunArtifactKind
  /** Sandbox path the runner recorded, e.g. `/output/importance.csv`. */
  path: string
  sha256: string
  bytes: number
  /** False when the row is metadata-only (`content` is null). */
  hasContent: boolean
  /** Same-origin URL that returns the artifact bytes. */
  downloadUrl: string
}

export type RunArtifactManifest = {
  runId: string
  experimentId: string
  workspaceId: string
  attempt: number
  /** Set for a repaired run: the failed attempt it was chained from. */
  parentRunId: string | null
  status: RunStatus
  /** The measured metrics on the run row. Never a reported paper value. */
  metrics: Record<string, number>
  verdict: Verdict | null
  artifacts: RunArtifactManifestEntry[]
}

/**
 * The manifest endpoint. `runId` is a UUID path segment, and the endpoint
 * answers only after authenticated workspace membership is proved.
 */
export function runArtifactManifestPath(runId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/artifacts`
}

/**
 * One artifact's download URL. `artifactId` is the row id, or the literal
 * `notebook` to select the run's reproducibility notebook.
 */
export function runArtifactDownloadPath(
  runId: string,
  artifactId: string,
): string {
  return `${runArtifactManifestPath(runId)}?artifact=${encodeURIComponent(artifactId)}`
}

/**
 * Picks the reproducibility notebook to offer first. The persisted export is
 * named `reproducibility-record.ipynb`; a runner-produced notebook remains a
 * valid fallback because the manifest carries the actual kind.
 */
export function findNotebookArtifact(
  manifest: Pick<RunArtifactManifest, 'artifacts'> | null | undefined,
): RunArtifactManifestEntry | null {
  if (!manifest) return null
  const notebooks = manifest.artifacts.filter(
    (artifact) => artifact.kind === 'notebook',
  )
  return (
    notebooks.find(
      (artifact) => artifact.path.endsWith('reproducibility-record.ipynb'),
    ) ??
    notebooks[0] ??
    null
  )
}
