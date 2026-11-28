import type { AgentTaskStatus, TaskKind } from './types';

export interface AgentTaskRow {
  id: string;
  taskKind: TaskKind;
  strategyId: string;
  /**
   * The run this task belongs to. Extraction writers record a stable
   * `inputRef.extractionRunId`; older rows may carry an experiment `runId`,
   * and pre-attribution rows have `null`.
   */
  runId: string | null;
  /** Optional human-readable label recorded beside the run id by the writer. */
  runLabel?: string | null;
  /**
   * The model that produced this attempt, as recorded on `agent_tasks.model`.
   * Makes the optional Meta provider observable in the actual workflow instead
   * of an environment variable nobody can see from the UI.
   */
  model?: string | null;
  status: AgentTaskStatus;
  latencyMs: number | null;
  costUsd: number | null;
  error?: string | null;
}
