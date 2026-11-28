import type { AgentTaskStatus, TaskKind } from '../shared/types';
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

/** Totals for one workspace's live `agent_tasks` rows. */
export interface AgentTaskOverview {
  totalTasks: number;
  succeeded: number;
  failed: number;
  rejected: number;
  retried: number;
  /** Mean `latencyMs` over rows that recorded it; `null` when none did. */
  avgLatencyMs: number | null;
  latencySamples: number;
  /** Sum of `costUsd` over rows that recorded it; an estimate, not billing. */
  totalCostUsd: number;
  costSamples: number;
  /** Distinct non-blank `model` values, sorted for stable display. */
  models: string[];
}

/** One row of the grouped-by-taskKind table on the Agent Monitor. */
export interface AgentTaskKindSummary {
  taskKind: TaskKind;
  count: number;
  succeeded: number;
  failed: number;
  rejected: number;
  retried: number;
  /** Status of the most recent row for this kind (a row, never an aggregate). */
  latestStatus: AgentTaskStatus;
  latestTaskId: string | null;
  models: string[];
  avgLatencyMs: number | null;
  totalCostUsd: number;
  costSamples: number;
}

function taskTimestamp(task: AgentTaskRow): number | null {
  if (!task.createdAt) return null;
  const parsed = Date.parse(task.createdAt);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Picks the later of two rows. A row without `createdAt` sorts before any
 * timestamped row, and later array positions win ties (the route returns rows
 * newest-first, so this keeps the answer honest for legacy rows too).
 */
function laterTask(current: AgentTaskRow | null, candidate: AgentTaskRow): AgentTaskRow {
  if (!current) return candidate;
  const currentAt = taskTimestamp(current);
  const candidateAt = taskTimestamp(candidate);
  if (candidateAt === null) return currentAt === null ? candidate : current;
  if (currentAt === null) return candidate;
  return candidateAt >= currentAt ? candidate : current;
}

/** The most recent recorded task, or `null` when there are no rows. */
export function latestAgentTask(tasks: AgentTaskRow[]): AgentTaskRow | null {
  return tasks.reduce<AgentTaskRow | null>(laterTask, null);
}

function addModel(models: Set<string>, model: string | null | undefined): void {
  const trimmed = typeof model === 'string' ? model.trim() : '';
  if (trimmed) models.add(trimmed);
}

function statusCounts(statuses: AgentTaskStatus[]) {
  const counts = { succeeded: 0, failed: 0, rejected: 0, retried: 0 };
  for (const status of statuses) counts[status] += 1;
  return counts;
}

/**
 * Summarizes live `agent_tasks` rows for the Agent Monitor KPIs. Counters and
 * averages come from the rows themselves; a missing latency or cost is
 * excluded rather than counted as zero.
 */
export function summarizeAgentTasks(tasks: AgentTaskRow[]): AgentTaskOverview {
  let totalLatencyMs = 0;
  let latencySamples = 0;
  let totalCostUsd = 0;
  let costSamples = 0;
  const models = new Set<string>();

  for (const task of tasks) {
    if (typeof task.latencyMs === 'number' && Number.isFinite(task.latencyMs)) {
      totalLatencyMs += task.latencyMs;
      latencySamples += 1;
    }
    if (typeof task.costUsd === 'number' && Number.isFinite(task.costUsd)) {
      totalCostUsd += task.costUsd;
      costSamples += 1;
    }
    addModel(models, task.model);
  }

  return {
    totalTasks: tasks.length,
    ...statusCounts(tasks.map((task) => task.status)),
    avgLatencyMs: latencySamples > 0 ? totalLatencyMs / latencySamples : null,
    latencySamples,
    totalCostUsd,
    costSamples,
    models: Array.from(models).sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * Groups live rows by `taskKind` for the Agent Monitor table. Each group's
 * `latestStatus` is read from its most recent row, never inferred from counts.
 */
export function summarizeAgentTasksByKind(tasks: AgentTaskRow[]): AgentTaskKindSummary[] {
  interface Group {
    statuses: AgentTaskStatus[];
    latest: AgentTaskRow;
    totalLatencyMs: number;
    latencySamples: number;
    totalCostUsd: number;
    costSamples: number;
    models: Set<string>;
  }

  const groups = new Map<TaskKind, Group>();

  for (const task of tasks) {
    const existing = groups.get(task.taskKind) ?? {
      statuses: [],
      latest: task,
      totalLatencyMs: 0,
      latencySamples: 0,
      totalCostUsd: 0,
      costSamples: 0,
      models: new Set<string>(),
    };

    existing.statuses.push(task.status);
    existing.latest = laterTask(existing.latest, task);
    if (typeof task.latencyMs === 'number' && Number.isFinite(task.latencyMs)) {
      existing.totalLatencyMs += task.latencyMs;
      existing.latencySamples += 1;
    }
    if (typeof task.costUsd === 'number' && Number.isFinite(task.costUsd)) {
      existing.totalCostUsd += task.costUsd;
      existing.costSamples += 1;
    }
    addModel(existing.models, task.model);
    groups.set(task.taskKind, existing);
  }

  return Array.from(groups.entries())
    .map(([taskKind, group]) => {
      const counts = statusCounts(group.statuses);
      return {
        taskKind,
        count: group.statuses.length,
        ...counts,
        latestStatus: group.latest.status,
        latestTaskId: group.latest.id,
        models: Array.from(group.models).sort((a, b) => a.localeCompare(b)),
        avgLatencyMs:
          group.latencySamples > 0 ? group.totalLatencyMs / group.latencySamples : null,
        totalCostUsd: group.totalCostUsd,
        costSamples: group.costSamples,
      };
    })
    .sort((a, b) => a.taskKind.localeCompare(b.taskKind));
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
