import { describe, it, expect } from 'vitest';
import {
  UNATTRIBUTED_RUN_LABEL,
  aggregateAgentTasks,
  aggregateAgentTasksByRun,
  latestAgentTask,
  summarizeAgentTaskRuns,
  summarizeAgentTasks,
  summarizeAgentTasksByKind,
  type AgentTaskRow,
} from './strategyClient';

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

describe('per-run strategy comparison', () => {
  const RUN_ONE = 'extract:strobl-2007:single_pass';
  const RUN_TWO = 'extract:kursa-2010:single_pass';

  const RUN_TASKS: AgentTaskRow[] = [
    {
      id: 'r1-extract', taskKind: 'extract_claims', strategyId: 'single_pass',
      runId: RUN_ONE, runLabel: 'Strobl 2007 · single_pass',
      status: 'succeeded', latencyMs: 1200, costUsd: 0.004,
    },
    {
      id: 'r1-edges', taskKind: 'propose_edges', strategyId: 'single_pass',
      runId: RUN_ONE, runLabel: 'Strobl 2007 · single_pass',
      status: 'succeeded', latencyMs: 800, costUsd: 0.002,
    },
    {
      id: 'r2-extract', taskKind: 'extract_claims', strategyId: 'single_pass',
      runId: RUN_TWO, runLabel: 'Kursa 2010 · single_pass',
      status: 'rejected', latencyMs: 3000, costUsd: 0.009,
      error: 'All proposed claims were rejected due to unverified verbatim quotes.',
    },
    {
      id: 'r2-edges', taskKind: 'propose_edges', strategyId: 'single_pass',
      runId: RUN_TWO, runLabel: 'Kursa 2010 · single_pass',
      status: 'failed', latencyMs: null, costUsd: null, error: 'provider 503',
    },
    {
      id: 'legacy', taskKind: 'extract_claims', strategyId: 'sectioned',
      runId: null, status: 'succeeded', latencyMs: 400, costUsd: 0.001,
    },
  ];

  it('keeps two runs apart instead of merging their rows', () => {
    const rows = aggregateAgentTasksByRun(RUN_TASKS);
    const extractRows = rows.filter((row) => row.taskKind === 'extract_claims');

    expect(extractRows.map((row) => row.runId)).toEqual([RUN_TWO, RUN_ONE, null]);
    expect(extractRows.map((row) => row.attempts)).toEqual([1, 1, 1]);
    expect(extractRows.map((row) => row.successes)).toEqual([0, 1, 1]);
    expect(extractRows.map((row) => row.failures)).toEqual([1, 0, 0]);
    expect(extractRows.map((row) => row.avgLatencyMs)).toEqual([3000, 1200, 400]);
    expect(extractRows.map((row) => row.runLabel)).toEqual([
      'Kursa 2010 · single_pass',
      'Strobl 2007 · single_pass',
      null,
    ]);
  });

  it('supports filtering to one run or the legacy bucket', () => {
    const runOne = aggregateAgentTasksByRun(RUN_TASKS, RUN_ONE);
    const legacy = aggregateAgentTasksByRun(RUN_TASKS, 'unattributed');

    expect(runOne).toHaveLength(2);
    expect(runOne.every((row) => row.runId === RUN_ONE)).toBe(true);
    expect(legacy).toHaveLength(1);
    expect(legacy[0].runId).toBeNull();
  });

  it('summarizes KPIs per run, including failures, without inventing telemetry', () => {
    const summaries = summarizeAgentTaskRuns(RUN_TASKS);
    expect(summaries).toHaveLength(3);
    expect(summaries.map((run) => run.runId)).toEqual([RUN_TWO, RUN_ONE, null]);

    const failed = summaries[0]!;
    expect(failed.label).toBe('Kursa 2010 · single_pass');
    expect(failed.attempts).toBe(2);
    expect(failed.successes).toBe(0);
    expect(failed.failures).toBe(2);
    expect(failed.successRate).toBe(0);
    // The failed edge attempt has no latency/cost; the averages cover the one
    // measured attempt and are not diluted with zeroes.
    expect(failed.avgLatencyMs).toBe(3000);
    expect(failed.avgCostUsd).toBeCloseTo(0.009);

    const succeeded = summaries[1]!;
    expect(succeeded.label).toBe('Strobl 2007 · single_pass');
    expect(succeeded.attempts).toBe(2);
    expect(succeeded.successes).toBe(2);
    expect(succeeded.failures).toBe(0);
    expect(succeeded.successRate).toBe(100);
    expect(succeeded.avgLatencyMs).toBe(1000);
    expect(succeeded.avgCostUsd).toBeCloseTo(0.003);
    expect(succeeded.totalCostUsd).toBeCloseTo(0.006);
    expect(succeeded.taskKinds).toEqual(['extract_claims', 'propose_edges']);

    const legacy = summaries[2]!;
    expect(legacy.label).toBe(UNATTRIBUTED_RUN_LABEL);
    expect(legacy.attempts).toBe(1);
    expect(legacy.runId).toBeNull();
  });

  it('returns empty summaries for no rows', () => {
    expect(summarizeAgentTaskRuns([])).toEqual([]);
    expect(aggregateAgentTasksByRun([])).toEqual([]);
  });

  it('keeps a run with no telemetry visible without inventing a zero average', () => {
    const [summary] = summarizeAgentTaskRuns([
      {
        id: 'no-telemetry', taskKind: 'propose_edges', strategyId: 'unassigned',
        runId: 'extract:no-telemetry:single_pass', status: 'failed',
        latencyMs: null, costUsd: null, error: 'provider error',
      },
    ]);

    expect(summary!.attempts).toBe(1);
    expect(summary!.failures).toBe(1);
    expect(summary!.avgLatencyMs).toBeNull();
    expect(summary!.avgCostUsd).toBeNull();
    expect(summary!.totalCostUsd).toBe(0);
  });
});

describe('live agent task summarizers', () => {
  const LIVE_TASKS: AgentTaskRow[] = [
    {
      id: 'live-1', taskKind: 'ingest', strategyId: 'sectioned',
      runId: 'extract:strobl-2007:single_pass', runLabel: 'Strobl 2007 · single_pass',
      model: 'gemini-3.8-flash', status: 'succeeded', latencyMs: 1000, costUsd: 0.002,
      createdAt: '2026-11-20T10:00:00.000Z',
    },
    {
      id: 'live-2', taskKind: 'extract_claims', strategyId: 'single_pass',
      runId: 'extract:strobl-2007:single_pass', runLabel: 'Strobl 2007 · single_pass',
      model: 'gemini-3.8-flash', status: 'failed', latencyMs: 500, costUsd: 0.001,
      error: 'quote mismatch', createdAt: '2026-11-20T10:05:00.000Z',
    },
    {
      id: 'live-3', taskKind: 'extract_claims', strategyId: 'single_pass',
      runId: 'extract:strobl-2007:single_pass', runLabel: 'Strobl 2007 · single_pass',
      model: 'muse-spark-1.3-contributor', status: 'retried', latencyMs: 1500, costUsd: 0.003,
      createdAt: '2026-11-20T10:06:00.000Z',
    },
    {
      id: 'live-4', taskKind: 'extract_claims', strategyId: 'single_pass',
      runId: null, model: '  ', status: 'succeeded', latencyMs: null, costUsd: null,
      createdAt: '2026-11-20T10:04:00.000Z',
    },
  ];

  it('counts statuses and averages only recorded telemetry', () => {
    const summary = summarizeAgentTasks(LIVE_TASKS);
    expect(summary.totalTasks).toBe(4);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.rejected).toBe(0);
    expect(summary.retried).toBe(1);
    expect(summary.latencySamples).toBe(3);
    expect(summary.avgLatencyMs).toBe(1000);
    expect(summary.costSamples).toBe(3);
    expect(summary.totalCostUsd).toBeCloseTo(0.006);
    expect(summary.models).toEqual(['gemini-3.8-flash', 'muse-spark-1.3-contributor']);
  });

  it('returns null averages and empty models for a workspace with no tasks', () => {
    const summary = summarizeAgentTasks([]);
    expect(summary.totalTasks).toBe(0);
    expect(summary.avgLatencyMs).toBeNull();
    expect(summary.totalCostUsd).toBe(0);
    expect(summary.models).toEqual([]);
    expect(latestAgentTask([])).toBeNull();
  });

  it('groups by taskKind with the latest row status, never an inferred one', () => {
    const summaries = summarizeAgentTasksByKind(LIVE_TASKS);
    expect(summaries.map((summary) => summary.taskKind)).toEqual([
      'extract_claims',
      'ingest',
    ]);

    const extraction = summaries[0]!;
    expect(extraction.count).toBe(3);
    expect(extraction.succeeded).toBe(1);
    expect(extraction.failed).toBe(1);
    expect(extraction.retried).toBe(1);
    expect(extraction.latestStatus).toBe('retried');
    expect(extraction.latestTaskId).toBe('live-3');
    expect(extraction.avgLatencyMs).toBe(1000);
    expect(extraction.totalCostUsd).toBeCloseTo(0.004);
    expect(extraction.models).toEqual(['gemini-3.8-flash', 'muse-spark-1.3-contributor']);

    const ingest = summaries[1]!;
    expect(ingest.count).toBe(1);
    expect(ingest.latestStatus).toBe('succeeded');
    expect(ingest.latestTaskId).toBe('live-1');
  });

  it('falls back to array order only when no row carries a timestamp', () => {
    const legacy: AgentTaskRow[] = [
      { id: 'old', taskKind: 'propose_edges', strategyId: 'unassigned', runId: null, status: 'failed', latencyMs: null, costUsd: null },
      { id: 'newer', taskKind: 'propose_edges', strategyId: 'unassigned', runId: null, status: 'succeeded', latencyMs: null, costUsd: null },
    ];
    expect(latestAgentTask(legacy)?.id).toBe('newer');
    expect(summarizeAgentTasksByKind(legacy)[0]!.latestStatus).toBe('succeeded');

    const mixed: AgentTaskRow[] = [
      { id: 'timestamped', taskKind: 'propose_edges', strategyId: 'unassigned', runId: null, status: 'succeeded', latencyMs: null, costUsd: null, createdAt: '2026-11-20T10:00:00.000Z' },
      { id: 'legacy-row', taskKind: 'propose_edges', strategyId: 'unassigned', runId: null, status: 'failed', latencyMs: null, costUsd: null },
    ];
    expect(latestAgentTask(mixed)?.id).toBe('timestamped');
  });
});
