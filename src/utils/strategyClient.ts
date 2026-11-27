import type { AgentTaskStatus, TaskKind } from '../shared/types';

export interface AgentTaskRow {
  id: string;
  taskKind: TaskKind;
  strategyId: string;
  runId: string;
  status: AgentTaskStatus;
  latencyMs: number;
  costUsd: number;
  error?: string | null;
}

export interface AggregatedStrategyStat {
  key: string;
  taskKind: TaskKind;
  strategyId: string;
  attempts: number;
  successes: number;
  failures: number;
  successRate: number; // 0..100
  avgLatencyMs: number;
  avgCostUsd: number;
  totalCostUsd: number;
  score: number; // (successes + 1) / (attempts + 2)
  preferred: boolean;
}

/**
 * Aggregates `agent_tasks` rows by `(taskKind, strategyId)` optionally filtered by `runId`.
 */
export function aggregateAgentTasks(
  tasks: AgentTaskRow[],
  runFilter: string = 'all',
): AggregatedStrategyStat[] {
  const filtered =
    runFilter === 'all' ? tasks : tasks.filter((t) => t.runId === runFilter);

  const groups = new Map<
    string,
    {
      taskKind: TaskKind;
      strategyId: string;
      attempts: number;
      successes: number;
      failures: number;
      totalLatencyMs: number;
      totalCostUsd: number;
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
      totalCostUsd: 0,
    };

    existing.attempts += 1;
    if (t.status === 'succeeded') {
      existing.successes += 1;
    } else if (t.status === 'failed' || t.status === 'rejected') {
      existing.failures += 1;
    }
    existing.totalLatencyMs += t.latencyMs;
    existing.totalCostUsd += t.costUsd;
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
      avgLatencyMs: g.attempts > 0 ? g.totalLatencyMs / g.attempts : 0,
      avgCostUsd: g.attempts > 0 ? g.totalCostUsd / g.attempts : 0,
      totalCostUsd: g.totalCostUsd,
      score: (g.successes + 1) / (g.attempts + 2),
      preferred: false,
    }),
  );

  // Mark highest-scoring strategy per taskKind as preferred
  const bestByKind = new Map<TaskKind, string>();
  for (const stat of stats) {
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
