export interface AgentTaskRow {
  id: string;
  taskKind: 'extract_claims' | 'propose_edges' | 'plan_experiment' | 'repair_code';
  strategyId: string;
  runId: string;
  status: 'succeeded' | 'failed';
  latencyMs: number;
  costUsd: number;
  error?: string | null;
}

export interface AggregatedStrategyStat {
  key: string;
  taskKind: string;
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
 * Preview task rows across two extraction runs (`run-1` and `run-2`),
 * including explicit failures so run-to-run differences are observable.
 */
export const PREVIEW_AGENT_TASKS: AgentTaskRow[] = [
  // Run 1: extract_claims
  { id: 'task-101', taskKind: 'extract_claims', strategyId: 'sectioned', runId: 'run-1', status: 'succeeded', latencyMs: 1420, costUsd: 0.008 },
  { id: 'task-102', taskKind: 'extract_claims', strategyId: 'sectioned', runId: 'run-1', status: 'succeeded', latencyMs: 1380, costUsd: 0.007 },
  { id: 'task-103', taskKind: 'extract_claims', strategyId: 'single_pass', runId: 'run-1', status: 'succeeded', latencyMs: 910, costUsd: 0.005 },
  { id: 'task-104', taskKind: 'extract_claims', strategyId: 'single_pass', runId: 'run-1', status: 'failed', latencyMs: 1120, costUsd: 0.005, error: 'Quote mismatch across column break on page 4' },
  { id: 'task-105', taskKind: 'extract_claims', strategyId: 'table_first', runId: 'run-1', status: 'succeeded', latencyMs: 1650, costUsd: 0.009 },
  // Run 2: extract_claims (visibly differs: table_first has 2/2 wins, single_pass fails 2/2)
  { id: 'task-201', taskKind: 'extract_claims', strategyId: 'table_first', runId: 'run-2', status: 'succeeded', latencyMs: 1510, costUsd: 0.009 },
  { id: 'task-202', taskKind: 'extract_claims', strategyId: 'table_first', runId: 'run-2', status: 'succeeded', latencyMs: 1490, costUsd: 0.008 },
  { id: 'task-203', taskKind: 'extract_claims', strategyId: 'sectioned', runId: 'run-2', status: 'succeeded', latencyMs: 1340, costUsd: 0.007 },
  { id: 'task-204', taskKind: 'extract_claims', strategyId: 'single_pass', runId: 'run-2', status: 'failed', latencyMs: 980, costUsd: 0.005, error: 'Context window truncation dropped Table 2 citation' },
  { id: 'task-205', taskKind: 'extract_claims', strategyId: 'single_pass', runId: 'run-2', status: 'failed', latencyMs: 1050, costUsd: 0.005, error: 'Unverified numeric claim rejected by verbatim guard' },
  // Propose edges & plan_experiment
  { id: 'task-301', taskKind: 'propose_edges', strategyId: 'citation_grounded', runId: 'run-1', status: 'succeeded', latencyMs: 1180, costUsd: 0.006 },
  { id: 'task-302', taskKind: 'propose_edges', strategyId: 'citation_grounded', runId: 'run-2', status: 'succeeded', latencyMs: 1140, costUsd: 0.006 },
  { id: 'task-303', taskKind: 'propose_edges', strategyId: 'citation_grounded', runId: 'run-2', status: 'failed', latencyMs: 1290, costUsd: 0.006, error: 'Proposed edge lacked valid evidenceChunkId' },
  { id: 'task-401', taskKind: 'plan_experiment', strategyId: 'sandbox_strict', runId: 'run-1', status: 'succeeded', latencyMs: 2100, costUsd: 0.014 },
  { id: 'task-402', taskKind: 'plan_experiment', strategyId: 'sandbox_strict', runId: 'run-2', status: 'succeeded', latencyMs: 1950, costUsd: 0.013 },
];

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
      taskKind: string;
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
    } else {
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
  const bestByKind = new Map<string, string>();
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

export async function fetchAgentTasks(
  endpoint = '/api/strategies',
  fetchImpl: typeof fetch = fetch,
): Promise<{ tasks: AgentTaskRow[]; source: 'api' | 'preview' }> {
  try {
    const res = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && Array.isArray(data.tasks) && data.tasks.length > 0) {
        return { tasks: data.tasks, source: 'api' };
      }
    }
  } catch {
    // Fall back to preview task rows
  }
  return { tasks: PREVIEW_AGENT_TASKS, source: 'preview' };
}
