import { describe, it, expect } from 'vitest';
import { aggregateAgentTasks, type AgentTaskRow } from './strategyClient';

const SAMPLE_TASKS: AgentTaskRow[] = [
  { id: 't1', taskKind: 'extract_claims', strategyId: 'sectioned', runId: 'run-1', status: 'succeeded', latencyMs: 1400, costUsd: 0.008 },
  { id: 't2', taskKind: 'extract_claims', strategyId: 'single_pass', runId: 'run-1', status: 'succeeded', latencyMs: 900, costUsd: 0.005 },
  { id: 't3', taskKind: 'extract_claims', strategyId: 'single_pass', runId: 'run-1', status: 'failed', latencyMs: null, costUsd: null, error: 'quote mismatch' },
  { id: 't4', taskKind: 'extract_claims', strategyId: 'table_first', runId: 'run-1', status: 'succeeded', latencyMs: 1600, costUsd: 0.009 },
  { id: 't5', taskKind: 'extract_claims', strategyId: 'table_first', runId: 'run-2', status: 'succeeded', latencyMs: 1500, costUsd: 0.008 },
  { id: 't6', taskKind: 'extract_claims', strategyId: 'single_pass', runId: 'run-2', status: 'failed', latencyMs: 1100, costUsd: 0.005, error: 'truncated' },
  { id: 't7', taskKind: 'propose_edges', strategyId: 'unassigned', runId: null, status: 'succeeded', latencyMs: null, costUsd: null },
];

describe('strategyClient', () => {
  it('aggregates attempts, wins, failures, and excludes null telemetry from averages', () => {
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

    const unassigned = stats.find((s) => s.strategyId === 'unassigned');
    expect(unassigned?.avgLatencyMs).toBeNull();
    expect(unassigned?.avgCostUsd).toBeNull();
  });

  it('supports filtering by runId and unattributed bucket', () => {
    const run1 = aggregateAgentTasks(SAMPLE_TASKS, 'run-1');
    const run2 = aggregateAgentTasks(SAMPLE_TASKS, 'run-2');
    const unattributed = aggregateAgentTasks(SAMPLE_TASKS, 'unattributed');

    expect(run1.find((s) => s.strategyId === 'single_pass')?.successes).toBe(1);
    expect(run2.find((s) => s.strategyId === 'single_pass')?.successes).toBe(0);
    expect(unattributed).toHaveLength(1);
    expect(unattributed[0].strategyId).toBe('unassigned');
    expect(unattributed[0].preferred).toBe(false);
    expect(aggregateAgentTasks([
      { ...SAMPLE_TASKS[0], strategyId: 'unattributed' },
      SAMPLE_TASKS[1],
    ]).map(({ strategyId, preferred }) => ({ strategyId, preferred }))).toEqual([
      { strategyId: 'unattributed', preferred: false },
      { strategyId: 'single_pass', preferred: true },
    ]);
  });
});
