import { describe, it, expect, vi } from 'vitest';
import {
  PREVIEW_AGENT_TASKS,
  aggregateAgentTasks,
  fetchAgentTasks,
} from './strategyClient';

describe('strategyClient', () => {
  it('aggregates attempts, wins, failures, successRate, avgLatency, and avgCost per strategy', () => {
    const stats = aggregateAgentTasks(PREVIEW_AGENT_TASKS, 'all');
    const singlePass = stats.find(
      (s) => s.taskKind === 'extract_claims' && s.strategyId === 'single_pass',
    );
    expect(singlePass).toBeDefined();
    expect(singlePass!.attempts).toBe(4);
    expect(singlePass!.successes).toBe(1);
    expect(singlePass!.failures).toBe(3);
    expect(singlePass!.successRate).toBe(25);
    expect(singlePass!.avgLatencyMs).toBeGreaterThan(0);
    expect(singlePass!.avgCostUsd).toBeGreaterThan(0);
  });

  it('produces visibly different counts between run-1 and run-2', () => {
    const run1 = aggregateAgentTasks(PREVIEW_AGENT_TASKS, 'run-1');
    const run2 = aggregateAgentTasks(PREVIEW_AGENT_TASKS, 'run-2');

    const tf1 = run1.find((s) => s.strategyId === 'table_first');
    const tf2 = run2.find((s) => s.strategyId === 'table_first');
    expect(tf1?.attempts).toBe(1);
    expect(tf2?.attempts).toBe(2);

    const sp1 = run1.find((s) => s.strategyId === 'single_pass');
    const sp2 = run2.find((s) => s.strategyId === 'single_pass');
    expect(sp1?.successes).toBe(1);
    expect(sp2?.successes).toBe(0);
    expect(sp2?.failures).toBe(2);
  });

  it('fetches from /api/strategies and falls back to preview tasks on failure', async () => {
    const okFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tasks: [PREVIEW_AGENT_TASKS[0]] }),
    });
    const res1 = await fetchAgentTasks('/api/strategies', okFetch as any);
    expect(res1.source).toBe('api');
    expect(res1.tasks).toHaveLength(1);

    const errFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const res2 = await fetchAgentTasks('/api/strategies', errFetch as any);
    expect(res2.source).toBe('preview');
    expect(res2.tasks.length).toBe(PREVIEW_AGENT_TASKS.length);
  });
});
