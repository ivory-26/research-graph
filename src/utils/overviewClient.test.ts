import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceActivity,
  flattenRunArtifacts,
  latestExperiment,
  resolveResearchQuestion,
  summarizeOverviewCounts,
  type OverviewExperimentRow,
  type OverviewSourceRow,
} from './overviewClient';

const SOURCES: OverviewSourceRow[] = [
  { id: 's-1', title: 'Strobl et al. 2007', kind: 'paper', createdAt: '2026-11-20T09:00:00.000Z' },
  { id: 's-2', title: 'Kursa et al. 2010', kind: 'paper', createdAt: '2026-11-20T11:00:00.000Z' },
];

const EXPERIMENTS: OverviewExperimentRow[] = [
  {
    id: 'e-1',
    claimTitle: 'Gini importance overvalues noise',
    claimText: 'Impurity-based importance is biased toward high-cardinality features.',
    approvalState: 'approved',
    createdAt: '2026-11-20T10:00:00.000Z',
    approvedAt: '2026-11-20T10:30:00.000Z',
    runs: [
      {
        id: 'run-1',
        attempt: 1,
        status: 'succeeded',
        verdict: 'match',
        createdAt: '2026-11-20T10:31:00.000Z',
        finishedAt: '2026-11-20T10:40:00.000Z',
        artifacts: [
          { id: 'a-1', kind: 'metrics', path: 'outputs/metrics.json', bytes: 2048 },
          { id: 'a-2', kind: 'plot', path: 'outputs/importance.png', bytes: 40960 },
        ],
      },
    ],
  },
  {
    id: 'e-2',
    claimTitle: 'Older plan',
    claimText: null,
    approvalState: 'pending',
    createdAt: '2026-11-19T08:00:00.000Z',
    approvedAt: null,
    runs: [],
  },
];

describe('summarizeOverviewCounts', () => {
  it('counts source rows, claim nodes and every nested run', () => {
    const counts = summarizeOverviewCounts(SOURCES, EXPERIMENTS, [
      { id: 'c-1', title: 'Claim 1', text: 'text' },
      { id: 'c-2', title: 'Claim 2', text: null },
      { id: 'c-3', title: 'Claim 3', text: null },
    ]);
    expect(counts).toEqual({ sources: 2, claims: 3, runs: 1 });
  });

  it('is zero for an empty workspace rather than falling back to a fixture', () => {
    expect(summarizeOverviewCounts([], [], [])).toEqual({ sources: 0, claims: 0, runs: 0 });
  });
});

describe('latestExperiment / resolveResearchQuestion', () => {
  it('picks the newest plan even when the array is not sorted', () => {
    expect(latestExperiment([...EXPERIMENTS].reverse())?.id).toBe('e-1');
    expect(latestExperiment([])).toBeNull();
  });

  it('prefers the latest experiment claim, then the first claim node, then nothing', () => {
    const fromExperiment = resolveResearchQuestion(EXPERIMENTS, [
      { id: 'c-1', title: 'Fallback claim', text: 'fallback text' },
    ]);
    expect(fromExperiment).toEqual({
      title: 'Gini importance overvalues noise',
      text: 'Impurity-based importance is biased toward high-cardinality features.',
      from: 'experiment',
    });

    const fromClaim = resolveResearchQuestion([], [
      { id: 'c-1', title: 'Fallback claim', text: 'fallback text' },
    ]);
    expect(fromClaim).toEqual({
      title: 'Fallback claim',
      text: 'fallback text',
      from: 'claim',
    });

    expect(resolveResearchQuestion([], [])).toBeNull();
  });

  it('keeps a missing claim text null instead of substituting copy', () => {
    const question = resolveResearchQuestion([EXPERIMENTS[1]!], []);
    expect(question?.title).toBe('Older plan');
    expect(question?.text).toBeNull();
    expect(question?.from).toBe('experiment');
  });
});

describe('flattenRunArtifacts', () => {
  it('flattens nested artifacts with their run status and verdict', () => {
    const artifacts = flattenRunArtifacts(EXPERIMENTS);
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]).toMatchObject({
      id: 'a-1',
      path: 'outputs/metrics.json',
      kind: 'metrics',
      bytes: 2048,
      runStatus: 'succeeded',
      runVerdict: 'match',
      attempt: 1,
      claimTitle: 'Gini importance overvalues noise',
      at: '2026-11-20T10:40:00.000Z',
    });
    expect(artifacts[1]?.id).toBe('a-2');
  });

  it('returns nothing when no run wrote artifacts', () => {
    expect(flattenRunArtifacts([])).toEqual([]);
    expect(flattenRunArtifacts([EXPERIMENTS[1]!])).toEqual([]);
  });
});

describe('buildWorkspaceActivity', () => {
  it('derives at most three entries, newest first, from real rows', () => {
    const activity = buildWorkspaceActivity(SOURCES, EXPERIMENTS);
    expect(activity.map((item) => item.badge)).toEqual(['SOURCE', 'RUN', 'APPROVED']);
    expect(activity[0]?.detail).toBe('Kursa et al. 2010');
    expect(activity[1]?.title).toBe('Run succeeded');
    expect(activity[1]?.detail).toBe('Gini importance overvalues noise · verdict match');
    expect(activity[2]?.title).toBe('Experiment plan approved');
  });

  it('surfaces the latest approval even when a newer plan is still pending', () => {
    const newerPending: OverviewExperimentRow = {
      ...EXPERIMENTS[1]!,
      id: 'e-3',
      claimTitle: 'Newer pending plan',
      createdAt: '2026-11-21T09:00:00.000Z',
    };
    const activity = buildWorkspaceActivity([], [EXPERIMENTS[0]!, newerPending]);
    expect(activity.some((item) => item.badge === 'APPROVED')).toBe(true);
    expect(
      activity.find((item) => item.badge === 'APPROVED')?.detail,
    ).toBe('Gini importance overvalues noise');
  });

  it('returns no entries for a workspace with no rows', () => {
    expect(buildWorkspaceActivity([], [])).toEqual([]);
  });
});
