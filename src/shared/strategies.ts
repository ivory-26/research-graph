import type { AgentTaskStatus, TaskKind } from './types';

export interface AgentTaskRow {
  id: string;
  taskKind: TaskKind;
  strategyId: string;
  runId: string | null;
  status: AgentTaskStatus;
  latencyMs: number | null;
  costUsd: number | null;
  error?: string | null;
}
