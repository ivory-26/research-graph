import type { TaskKind } from '../shared/types';
import type { AgentTaskRow } from '../shared/strategies';

export type { AgentTaskRow };

export interface AggregatedStrategyStat {
  key: string;
  taskKind: TaskKind;
  strategyId: string;
  attempts: number;
  successes: number;
  failures: number;
  successRate: number; // 0..100
  avgLatencyMs: number | null;
  avgCostUsd: number | null;
  totalCostUsd: number;
  score: number; // (successes + 1) / (attempts + 2)
  preferred: boolean;
}

export interface AggregatedStrategyRunStat extends AggregatedStrategyStat {
  /** `null` is the legacy bucket: rows recorded before run attribution. */
  runId: string | null;
  runLabel: string | null;
}

export interface AgentTaskRunSummary {
  /** `null` is the legacy bucket: rows recorded before run attribution. */
  runId: string | null;
  label: string;
  attempts: number;
  successes: number;
  failures: number;
  successRate: number; // 0..100
  avgLatencyMs: number | null;
  avgCostUsd: number | null;
  totalCostUsd: number;
  /** Distinct task kinds recorded under this run, sorted for stable display. */
  taskKinds: TaskKind[];
}

/** Unattributed rows are always sorted after attributed runs. */
export const UNATTRIBUTED_RUN_LABEL = 'Unattributed';

function compareRunIds(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

function runGroupKey(runId: string | null, taskKind: TaskKind, strategyId: string): string {
  // JSON keeps a run id that itself contains separators from colliding with
  // another group's key.
  return JSON.stringify([runId, taskKind, strategyId]);
}

function summarizeGroup(group: {
  attempts: number;
  successes: number;
  failures: number;
  totalLatencyMs: number;
  latencyCount: number;
  totalCostUsd: number;
  costCount: number;
}): Pick<
  AggregatedStrategyStat,
  'attempts' | 'successes' | 'failures' | 'successRate' | 'avgLatencyMs' | 'avgCostUsd' | 'totalCostUsd'
> {
  return {
    attempts: group.attempts,
    successes: group.successes,
    failures: group.failures,
    successRate: group.attempts > 0 ? (group.successes / group.attempts) * 100 : 0,
    avgLatencyMs: group.latencyCount > 0 ? group.totalLatencyMs / group.latencyCount : null,
    avgCostUsd: group.costCount > 0 ? group.totalCostUsd / group.costCount : null,
    totalCostUsd: group.totalCostUsd,
  };
}

/**
 * The strategies that win a task kind across every run in `tasks`.
 *
 * A run is a batch, not a competing strategy: a strategy marked preferred in
 * one batch must not lose that label merely because a second batch exists.
 */
function preferredStrategyByTaskKind(tasks: AgentTaskRow[]): Map<TaskKind, string> {
  const preferred = new Map<TaskKind, string>();
  for (const stat of aggregateAgentTasks(tasks, 'all')) {
    if (stat.preferred) preferred.set(stat.taskKind, stat.strategyId);
  }
  return preferred;
}

/**
 * Aggregates `agent_tasks` rows by `(taskKind, strategyId)` optionally filtered by `runId`
 * (or `'unattributed'` for rows with `runId === null`).
 * Rows with missing telemetry (`null` latency or cost) are excluded from those averages.
 */
export function aggregateAgentTasks(
  tasks: AgentTaskRow[],
  runFilter: string = 'all',
): AggregatedStrategyStat[] {
  const filtered =
    runFilter === 'all'
      ? tasks
      : runFilter === 'unattributed'
        ? tasks.filter((t) => t.runId === null)
        : tasks.filter((t) => t.runId === runFilter);

  const groups = new Map<
    string,
    {
      taskKind: TaskKind;
      strategyId: string;
      attempts: number;
      successes: number;
      failures: number;
      totalLatencyMs: number;
      latencyCount: number;
      totalCostUsd: number;
      costCount: number;
    }
  >();

  for (const t of filtered) {
    const key = `${t.taskKind}::${t.strategyId}`;
    const existing = groups.get(key) ?? {
      taskKind: t.taskKind,
      strategyId: t.strategyId,
      attempts: 0,
      successes: 0,
      failures: 0,
      totalLatencyMs: 0,
      latencyCount: 0,
      totalCostUsd: 0,
      costCount: 0,
    };

    existing.attempts += 1;
    if (t.status === 'succeeded') {
      existing.successes += 1;
    } else if (t.status === 'failed' || t.status === 'rejected') {
      existing.failures += 1;
    }
    if (typeof t.latencyMs === 'number' && Number.isFinite(t.latencyMs)) {
      existing.totalLatencyMs += t.latencyMs;
      existing.latencyCount += 1;
    }
    if (typeof t.costUsd === 'number' && Number.isFinite(t.costUsd)) {
      existing.totalCostUsd += t.costUsd;
      existing.costCount += 1;
    }
    groups.set(key, existing);
  }

  const stats: AggregatedStrategyStat[] = Array.from(groups.entries()).map(
    ([key, g]) => ({
      key,
      taskKind: g.taskKind,
      strategyId: g.strategyId,
      attempts: g.attempts,
      successes: g.successes,
      failures: g.failures,
      successRate: g.attempts > 0 ? (g.successes / g.attempts) * 100 : 0,
      avgLatencyMs: g.latencyCount > 0 ? g.totalLatencyMs / g.latencyCount : null,
      avgCostUsd: g.costCount > 0 ? g.totalCostUsd / g.costCount : null,
      totalCostUsd: g.totalCostUsd,
      score: (g.successes + 1) / (g.attempts + 2),
      preferred: false,
    }),
  );

  // Mark the highest-scoring assigned strategy per task kind as preferred.
  const bestByKind = new Map<TaskKind, string>();
  for (const stat of stats) {
    if (stat.strategyId === 'unassigned' || stat.strategyId === 'unattributed') continue;
    const currentBestKey = bestByKind.get(stat.taskKind);
    const currentBest = currentBestKey
      ? stats.find((s) => s.key === currentBestKey)
      : undefined;
    if (!currentBest || stat.score > currentBest.score) {
      bestByKind.set(stat.taskKind, stat.key);
    }
  }

  for (const stat of stats) {
    if (bestByKind.get(stat.taskKind) === stat.key) {
      stat.preferred = true;
    }
  }

  return stats.sort((a, b) => {
    if (a.taskKind !== b.taskKind) return a.taskKind.localeCompare(b.taskKind);
    return b.score - a.score;
  });
}

/**
 * Aggregates `agent_tasks` by `(runId, taskKind, strategyId)`.
 *
 * Unlike `aggregateAgentTasks`, this keeps two extraction batches apart, so a
 * row from Run 1 and the equivalent row from Run 2 are both displayed instead
 * of being merged into one average. Rows with no run id are kept in a legacy
 * `runId === null` bucket so pre-attribution task history remains visible.
 */
export function aggregateAgentTasksByRun(
  tasks: AgentTaskRow[],
  runFilter: string = 'all',
): AggregatedStrategyRunStat[] {
  const filtered =
    runFilter === 'all'
      ? tasks
      : runFilter === 'unattributed'
        ? tasks.filter((t) => t.runId === null)
        : tasks.filter((t) => t.runId === runFilter);

  const preferredByKind = preferredStrategyByTaskKind(filtered);

  const groups = new Map<
    string,
    {
      runId: string | null;
      runLabel: string | null;
      taskKind: TaskKind;
      strategyId: string;
      attempts: number;
      successes: number;
      failures: number;
      totalLatencyMs: number;
      latencyCount: number;
      totalCostUsd: number;
      costCount: number;
    }
  >();

  for (const t of filtered) {
    const key = runGroupKey(t.runId, t.taskKind, t.strategyId);
    const existing = groups.get(key) ?? {
      runId: t.runId,
      runLabel: t.runLabel?.trim() || null,
      taskKind: t.taskKind,
      strategyId: t.strategyId,
      attempts: 0,
      successes: 0,
      failures: 0,
      totalLatencyMs: 0,
      latencyCount: 0,
      totalCostUsd: 0,
      costCount: 0,
    };

    if (!existing.runLabel && t.runLabel?.trim()) {
      existing.runLabel = t.runLabel.trim();
    }

    existing.attempts += 1;
    if (t.status === 'succeeded') {
      existing.successes += 1;
    } else if (t.status === 'failed' || t.status === 'rejected') {
      existing.failures += 1;
    }
    if (typeof t.latencyMs === 'number' && Number.isFinite(t.latencyMs)) {
      existing.totalLatencyMs += t.latencyMs;
      existing.latencyCount += 1;
    }
    if (typeof t.costUsd === 'number' && Number.isFinite(t.costUsd)) {
      existing.totalCostUsd += t.costUsd;
      existing.costCount += 1;
    }
    groups.set(key, existing);
  }

  const stats: AggregatedStrategyRunStat[] = Array.from(groups.entries()).map(
    ([key, g]) => ({
      key,
      runId: g.runId,
      runLabel: g.runLabel,
      taskKind: g.taskKind,
      strategyId: g.strategyId,
      ...summarizeGroup(g),
      score: (g.successes + 1) / (g.attempts + 2),
      preferred: preferredByKind.get(g.taskKind) === g.strategyId,
    }),
  );

  return stats.sort((a, b) => {
    const runOrder = compareRunIds(a.runId, b.runId);
    if (runOrder !== 0) return runOrder;
    if (a.taskKind !== b.taskKind) return a.taskKind.localeCompare(b.taskKind);
    return b.score - a.score;
  });
}

/**
 * One KPI summary per attributed run, plus a final bucket for rows recorded
 * before run attribution existed. Counters come from the same rows the table
 * aggregates; nothing here invents a success, latency or cost.
 */
export function summarizeAgentTaskRuns(tasks: AgentTaskRow[]): AgentTaskRunSummary[] {
  const groups = new Map<
    string,
    {
      runId: string | null;
      label: string | null;
      attempts: number;
      successes: number;
      failures: number;
      totalLatencyMs: number;
      latencyCount: number;
      totalCostUsd: number;
      costCount: number;
      taskKinds: Set<TaskKind>;
    }
  >();

  for (const t of tasks) {
    const key = t.runId ?? UNATTRIBUTED_RUN_LABEL;
    const existing = groups.get(key) ?? {
      runId: t.runId,
      label: null,
      attempts: 0,
      successes: 0,
      failures: 0,
      totalLatencyMs: 0,
      latencyCount: 0,
      totalCostUsd: 0,
      costCount: 0,
      taskKinds: new Set<TaskKind>(),
    };

    if (existing.label === null && t.runLabel?.trim()) {
      existing.label = t.runLabel.trim();
    }

    existing.attempts += 1;
    existing.taskKinds.add(t.taskKind);
    if (t.status === 'succeeded') {
      existing.successes += 1;
    } else if (t.status === 'failed' || t.status === 'rejected') {
      existing.failures += 1;
    }
    if (typeof t.latencyMs === 'number' && Number.isFinite(t.latencyMs)) {
      existing.totalLatencyMs += t.latencyMs;
      existing.latencyCount += 1;
    }
    if (typeof t.costUsd === 'number' && Number.isFinite(t.costUsd)) {
      existing.totalCostUsd += t.costUsd;
      existing.costCount += 1;
    }
    groups.set(key, existing);
  }

  return Array.from(groups.values())
    .map((g) => ({
      runId: g.runId,
      label: g.label ?? g.runId ?? UNATTRIBUTED_RUN_LABEL,
      ...summarizeGroup(g),
      taskKinds: Array.from(g.taskKinds).sort(),
    }))
    .sort((a, b) => compareRunIds(a.runId, b.runId));
}
