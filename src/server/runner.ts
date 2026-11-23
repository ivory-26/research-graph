import type { ExperimentResult, ExperimentSpec } from '../shared/types'

/**
 * The one boundary between the application and generated Python.
 *
 * An implementation must create a network-disabled sandbox, write only the
 * files in the spec and datasets the application already fetched and hashed,
 * and never hand the sandbox a credential or a host path. The sandbox is
 * untrusted; everything that calls this interface is not.
 *
 * Declared here as a frozen contract (docs/07-workstreams.md). The runtime
 * workstream implements it in this file.
 */
export interface ExperimentRunner {
  run(
    spec: ExperimentSpec,
    onStdout: (chunk: string) => void,
  ): Promise<ExperimentResult>

  cancel(sandboxId: string): Promise<void>
}
