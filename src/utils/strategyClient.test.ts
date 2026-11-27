import { describe, it, expect } from 'vitest';
import { aggregateAgentTasks, type AgentTaskRow } from './strategyClient';

const SAMPLE_TASKS: AgentTaskRow[] = [
  { id: 't1', taskKind: 'extract_claims', strategyId: 'sectioned', runId: 'run-1', status: 'succeeded', latencyMs: 1400, costUsd: 0.008 },
  { id: 't2', taskKind: 'extract_claims', strategyId: 'single_pass', runId: 'run-1', status: 'succeeded', latencyMs: 900, costUsd: 0.005 },
  { id: 't3', taskKind: 'extract_claims', strategyId: 'single_pass', runId: 'run-1', status: 'failed', latencyMs: 1100, costUsd: 0.005, error: 'quote mismatch' },
  { id: 't4', taskKind: 'extract_claims', strategyId: 'table_first', runId: 'run-1', status: 'succeeded', latencyMs: 1600, costUsd: 0.009 },
  { id: 't5', taskKind: 'extract_claims', strategyId: 'table_first', runId: 'run-2', status: 'succeeded', latencyMs: 1500, costUsd: 0.008 },
  { id: 't6', taskKind: 'extract_claims', strategyId: 'single_pass', runId: 'run-2', status: 'failed', latencyMs: 1000, costUsd: 0.005, error: 'truncated' },
];

describe('strategyClient', () => {
  it('aggregates attempts, wins, failures, successRate, avgLatency, and avgCost per strategy', () => {
    const stats = aggregateAgentTasks(SAMPLE_TASKS, 'all');
    const singlePass = stats.find(
      (s) => s.taskKind === 'extract_claims' && s.strategyId === 'single_pass',
    );
    expect(singlePass).toBeDefined();
    expect(singlePass!.attempts).toBe(3);
    expect(singlePass!.successes).toBe(1);
    expect(singlePass!.failures).toBe(2);
    expect(Math.round(singlePass!.successRate)).toBe(33);
    expect(singlePass!.avgLatencyMs).toBe(1000);
    expect(singlePass!.avgCostUsd).toBeCloseTo(0.005);
  });

  it('produces visibly different counts between run-1 and run-2', () => {
    const run1 = aggregateAgentTasks(SAMPLE_TASKS, 'run-1');
    const run2 = aggregateAgentTasks(SAMPLE_TASKS, 'run-2');

    const sp1 = run1.find((s) => s.strategyId === 'single_pass');
    const sp2 = run2.find((s) => s.strategyId === 'single_pass');
    expect(sp1?.successes).toBe(1);
    expect(sp1?.failures).toBe(1);
    expect(sp2?.successes).toBe(0);
    expect(sp2?.failures).toBe(1);
  });
});
