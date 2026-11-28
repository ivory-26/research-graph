import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { DEMO_SOURCES, DEMO_NODES } from '../../data/demoWorkspace';
import {
  buildWorkspaceActivity,
  flattenRunArtifacts,
  resolveResearchQuestion,
  summarizeOverviewCounts,
  type OverviewClaimRow,
  type OverviewExperimentRow,
  type OverviewSourceRow,
} from '../../utils/overviewClient';

interface OverviewPageProps {
  onOpenGraph: () => void;
  /** Active workspace id: a database UUID, or the fixture id when `isLive` is false. */
  workspaceId: string;
  /** True only when an authenticated database workspace is active. */
  isLive: boolean;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const padCount = (value: number): string => String(value).padStart(2, '0');

const ACTIVITY_DOT: Record<'emerald' | 'orange', string> = {
  emerald: 'bg-emerald-400 shadow-[0_0_8px_#34d399]',
  orange: 'bg-[#f97316]',
};

export const OverviewPage: React.FC<OverviewPageProps> = ({ onOpenGraph, workspaceId, isLive }) => {
  if (!isLive) return <DemoOverviewPage onOpenGraph={onOpenGraph} />;
  return <LiveOverviewPage workspaceId={workspaceId} onOpenGraph={onOpenGraph} />;
};

/** The intentional offline demo. Never presented as measured run output. */
const DemoOverviewPage: React.FC<{ onOpenGraph: () => void }> = ({ onOpenGraph }) => {
  const sourceCount = padCount(DEMO_SOURCES.length);
  const claimCount = padCount(DEMO_NODES.filter((n) => n.type === 'claim').length);
  const runCount = padCount(DEMO_NODES.filter((n) => n.type === 'run').length);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto animate-fade-in font-mono">
      <div className="border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 font-sans">
        <strong className="font-bold">Demo fixture · not measured.</strong> The counts, activity
        and artifacts below come from <span className="font-mono">fixtures/workspace.json</span>,
        not from a database workspace.
      </div>

      {/* 3 KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
            RESEARCH SOURCES
          </div>
          <div className="text-3xl font-extrabold text-[var(--text-primary)] my-2">
            {sourceCount}
          </div>
          <div className="text-[11px] text-[var(--text-dim)]">
            Configured in workspace
          </div>
        </div>

        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
            EVIDENCE-BACKED CLAIMS
          </div>
          <div className="text-3xl font-extrabold text-[#f97316] my-2">
            {claimCount}
          </div>
          <div className="text-[11px] text-[var(--text-dim)]">
            Evidence-grounded claims
          </div>
        </div>

        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
            EXPERIMENT RUNS
          </div>
          <div className="text-3xl font-extrabold text-[var(--text-primary)] my-2">
            {runCount}
          </div>
          <div className="text-[11px] text-[var(--text-dim)]">
            Adapted reproduction mode
          </div>
        </div>
      </div>

      {/* Grid 2: Workspace Activity & Research Question */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Workspace Activity Timeline */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
          <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
            Workspace activity
          </div>
          <div className="space-y-3 pt-1">
            <div className="flex items-start gap-3 border-b border-[var(--border-primary)] pb-3">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 mt-1 shadow-[0_0_8px_#34d399]" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[var(--text-primary)] font-semibold">
                  Evidence edge linked
                </div>
                <div className="text-[11px] text-[var(--text-dim)]">
                  Strobl et al. 2007 supports Gini bias claim
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">
                SEEDED
              </span>
            </div>

            <div className="flex items-start gap-3 border-b border-[var(--border-primary)] pb-3">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 mt-1" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[var(--text-primary)] font-semibold">
                  Experiment plan configured
                </div>
                <div className="text-[11px] text-[var(--text-dim)]">
                  Permutation importance · adapted specification
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">
                SPEC
              </span>
            </div>

            <div className="flex items-start gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-[#f97316] mt-1" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[var(--text-primary)] font-semibold">
                  Three sources configured
                </div>
                <div className="text-[11px] text-[var(--text-dim)]">
                  PDF extraction and chunking specification
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">
                SEEDED
              </span>
            </div>
          </div>
        </div>

        {/* Research Question Card */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
              Research question
            </div>
            <h2 className="text-base font-bold text-[var(--text-primary)] leading-snug">
              Does impurity-based feature importance overvalue high-cardinality noise features?
            </h2>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed font-sans">
              The workspace investigates a core reproducibility claim from the random forest literature (Strobl et al. 2007) and compares standard Gini impurity importance against permutation importance on an augmented OpenML benchmark.
            </p>
          </div>

          <button
            onClick={onOpenGraph}
            className="flex items-center justify-center gap-2 w-full py-2.5 bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] transition shadow-md mt-2"
          >
            <span>Open research graph</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Recent Artifacts Table */}
      <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
        <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
          Recent artifacts
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border-primary)] text-[10px] text-[var(--text-dim)] uppercase tracking-wider">
                <th className="pb-2">ARTIFACT</th>
                <th className="pb-2">TYPE</th>
                <th className="pb-2">STATUS</th>
                <th className="pb-2 text-right">UPDATED</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-primary)]">
              <tr className="hover:bg-[var(--bg-surface-hover)]">
                <td className="py-3 font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-sky-400" />
                  <span>Strobl et al. 2007</span>
                </td>
                <td className="py-3 text-[var(--text-muted)]">Source Paper</td>
                <td className="py-3">
                  <span className="badge-solid-white !text-[8px] rounded-none">
                    SEEDED
                  </span>
                </td>
                <td className="py-3 text-right text-[var(--text-dim)]">Seeded</td>
              </tr>
              <tr className="hover:bg-[var(--bg-surface-hover)]">
                <td className="py-3 font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#f97316]" />
                  <span>Gini importance bias</span>
                </td>
                <td className="py-3 text-[var(--text-muted)]">Claim</td>
                <td className="py-3">
                  <span className="badge-solid-white !text-[8px] rounded-none">
                    SEEDED
                  </span>
                </td>
                <td className="py-3 text-right text-[var(--text-dim)]">Seeded</td>
              </tr>
              <tr className="hover:bg-[var(--bg-surface-hover)]">
                <td className="py-3 font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Run B — permutation</span>
                </td>
                <td className="py-3 text-[var(--text-muted)]">Experiment Run</td>
                <td className="py-3">
                  <span className="border border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-dim)] text-[8px] px-1.5 py-0.5">
                    SPEC
                  </span>
                </td>
                <td className="py-3 text-right text-[var(--text-dim)]">Template</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

interface LiveOverviewState {
  workspaceId: string;
  status: 'loading' | 'ready' | 'error';
  sources: OverviewSourceRow[];
  experiments: OverviewExperimentRow[];
  claims: OverviewClaimRow[];
  error: string | null;
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {
    signal,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      data && typeof (data as { error?: unknown }).error === 'string'
        ? String((data as { error: string }).error)
        : `HTTP ${res.status}`,
    );
  }
  return data;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeSources(data: unknown): OverviewSourceRow[] {
  const rows = asRecord(data)?.sources;
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    const row = asRecord(value) ?? {};
    return {
      id: String(row.id ?? ''),
      title: String(row.title ?? 'Untitled source'),
      kind: String(row.kind ?? 'source'),
      createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
    };
  });
}

function normalizeClaims(data: unknown): OverviewClaimRow[] {
  const rows = asRecord(data)?.claims;
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    const row = asRecord(value) ?? {};
    return {
      id: String(row.id ?? ''),
      title: String(row.title ?? 'Untitled claim'),
      text: typeof row.text === 'string' ? row.text : null,
    };
  });
}

function normalizeExperiments(data: unknown): OverviewExperimentRow[] {
  const rows = asRecord(data)?.experiments;
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    const row = asRecord(value) ?? {};
    const runs = Array.isArray(row.runs) ? row.runs : [];
    return {
      id: String(row.id ?? ''),
      claimTitle: String(row.claimTitle ?? 'Unknown claim'),
      claimText: typeof row.claimText === 'string' ? row.claimText : null,
      approvalState: String(row.approvalState ?? 'pending'),
      createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
      approvedAt: typeof row.approvedAt === 'string' ? row.approvedAt : null,
      runs: runs.map((runValue) => {
        const run = asRecord(runValue) ?? {};
        const artifacts = Array.isArray(run.artifacts) ? run.artifacts : [];
        return {
          id: String(run.id ?? ''),
          attempt: Number(run.attempt) || 0,
          status: String(run.status ?? 'unknown'),
          verdict: typeof run.verdict === 'string' ? run.verdict : null,
          createdAt: typeof run.createdAt === 'string' ? run.createdAt : null,
          finishedAt: typeof run.finishedAt === 'string' ? run.finishedAt : null,
          artifacts: artifacts.map((artifactValue) => {
            const artifact = asRecord(artifactValue) ?? {};
            return {
              id: String(artifact.id ?? ''),
              kind: String(artifact.kind ?? 'file'),
              path: String(artifact.path ?? ''),
              bytes: Number(artifact.bytes) || 0,
            };
          }),
        };
      }),
    };
  });
}

function verdictTone(verdict: string | null): string {
  if (verdict === 'match') return 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10';
  if (verdict === 'mismatch' || verdict === 'failed') {
    return 'text-red-300 border-red-500/40 bg-red-500/10';
  }
  return 'text-amber-200 border-amber-500/40 bg-amber-500/10';
}

const ARTIFACT_ROW_LIMIT = 8;

/**
 * Live mode: every number is read from `/api/sources` and `/api/experiments`.
 * There is deliberately no fixture fallback here — a database workspace that
 * has not loaded yet shows a loading state, not demo values.
 */
const LiveOverviewPage: React.FC<{ workspaceId: string; onOpenGraph: () => void }> = ({
  workspaceId,
  onOpenGraph,
}) => {
  const [state, setState] = useState<LiveOverviewState>(() => ({
    workspaceId,
    status: 'loading',
    sources: [],
    experiments: [],
    claims: [],
    error: null,
  }));
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({
      workspaceId,
      status: 'loading',
      sources: [],
      experiments: [],
      claims: [],
      error: null,
    });

    const encoded = encodeURIComponent(workspaceId);
    Promise.all([
      fetchJson(`/api/sources?workspaceId=${encoded}`, controller.signal),
      fetchJson(`/api/experiments?workspaceId=${encoded}`, controller.signal),
    ])
      .then(([sourcesData, experimentsData]) => {
        if (!active) return;
        setState({
          workspaceId,
          status: 'ready',
          sources: normalizeSources(sourcesData),
          experiments: normalizeExperiments(experimentsData),
          claims: normalizeClaims(experimentsData),
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (!active || controller.signal.aborted) return;
        setState({
          workspaceId,
          status: 'error',
          sources: [],
          experiments: [],
          claims: [],
          error: err instanceof Error ? err.message : 'Failed to load workspace data',
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [workspaceId, revision]);

  // A state tagged with another workspace is stale; render loading, never it.
  const live = state.workspaceId === workspaceId ? state : null;
  const status = live?.status ?? 'loading';

  const sources = useMemo(() => live?.sources ?? [], [live]);
  const experiments = useMemo(() => live?.experiments ?? [], [live]);
  const claims = useMemo(() => live?.claims ?? [], [live]);

  const counts = useMemo(
    () => summarizeOverviewCounts(sources, experiments, claims),
    [sources, experiments, claims],
  );
  const activity = useMemo(
    () => buildWorkspaceActivity(sources, experiments),
    [sources, experiments],
  );
  const researchQuestion = useMemo(
    () => resolveResearchQuestion(experiments, claims),
    [experiments, claims],
  );
  const artifacts = useMemo(() => flattenRunArtifacts(experiments), [experiments]);

  if (status === 'loading') {
    return (
      <div className="p-6 space-y-6 max-w-7xl mx-auto animate-fade-in font-mono">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
          LIVE WORKSPACE · DATABASE
        </div>
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-10 flex items-center justify-center gap-2 text-xs text-[var(--text-dim)]">
          <Loader2 className="h-4 w-4 animate-spin text-[#f97316]" />
          Loading sources, claims and experiments from the database…
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="p-6 space-y-6 max-w-7xl mx-auto animate-fade-in font-mono">
        <div className="flex items-start gap-2 border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200 font-sans">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <div className="font-bold">Workspace data unavailable</div>
            <div>{live?.error ?? 'Failed to load workspace data'}</div>
          </div>
          <button
            onClick={() => setRevision((value) => value + 1)}
            className="flex items-center gap-1 text-[10px] text-red-200 hover:text-white"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
        <div className="border border-dashed border-[var(--border-primary)] bg-[var(--card-bg)] p-8 text-center text-xs text-[var(--text-dim)] font-sans">
          No values are shown because this page never substitutes fixture data for a live
          workspace.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto animate-fade-in font-mono">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
          LIVE WORKSPACE · DATABASE
        </div>
        <button
          onClick={() => setRevision((value) => value + 1)}
          className="flex items-center gap-1 text-[10px] text-[var(--text-dim)] hover:text-[#f97316]"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {/* 3 KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
            RESEARCH SOURCES
          </div>
          <div className="text-3xl font-extrabold text-[var(--text-primary)] my-2">
            {padCount(counts.sources)}
          </div>
          <div className="text-[11px] text-[var(--text-dim)]">
            Source rows in this workspace
          </div>
        </div>

        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
            EVIDENCE-BACKED CLAIMS
          </div>
          <div className="text-3xl font-extrabold text-[#f97316] my-2">
            {padCount(counts.claims)}
          </div>
          <div className="text-[11px] text-[var(--text-dim)]">
            Claim nodes in this workspace
          </div>
        </div>

        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
            EXPERIMENT RUNS
          </div>
          <div className="text-3xl font-extrabold text-[var(--text-primary)] my-2">
            {padCount(counts.runs)}
          </div>
          <div className="text-[11px] text-[var(--text-dim)]">
            Recorded run attempts · adapted mode
          </div>
        </div>
      </div>

      {/* Grid 2: Workspace Activity & Research Question */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Workspace Activity Timeline */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
          <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
            Workspace activity
          </div>
          {activity.length === 0 ? (
            <div className="border border-dashed border-[var(--border-primary)] bg-[var(--bg-surface)] p-6 text-center space-y-1">
              <div className="text-xs font-bold text-[var(--text-primary)]">No activity yet</div>
              <p className="text-[11px] text-[var(--text-dim)] font-sans">
                Ingest a source or create an experiment plan. Activity is derived from the rows
                in this workspace.
              </p>
            </div>
          ) : (
            <div className="space-y-3 pt-1">
              {activity.map((item, index) => (
                <div
                  key={item.key}
                  className={`flex items-start gap-3 ${
                    index < activity.length - 1
                      ? 'border-b border-[var(--border-primary)] pb-3'
                      : ''
                  }`}
                >
                  <span
                    className={`w-2.5 h-2.5 rounded-full mt-1 ${ACTIVITY_DOT[item.tone]}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-[var(--text-primary)] font-semibold">
                      {item.title}
                    </div>
                    <div className="text-[11px] text-[var(--text-dim)]">{item.detail}</div>
                    <div className="text-[10px] text-[var(--text-dim)]">
                      {formatDate(item.at)}
                    </div>
                  </div>
                  <span className="badge-solid-white !text-[8px] rounded-none">
                    {item.badge}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Research Question Card */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
              Research question
            </div>
            {researchQuestion ? (
              <>
                <h2 className="text-base font-bold text-[var(--text-primary)] leading-snug">
                  {researchQuestion.title}
                </h2>
                <p className="text-xs text-[var(--text-muted)] leading-relaxed font-sans">
                  {researchQuestion.text ??
                    'Claim text is unavailable for this node.'}
                </p>
                <div className="text-[10px] text-[var(--text-dim)]">
                  {researchQuestion.from === 'experiment'
                    ? 'From the latest experiment plan'
                    : 'From a claim node · no experiment plan yet'}
                </div>
              </>
            ) : (
              <div className="border border-dashed border-[var(--border-primary)] bg-[var(--bg-surface)] p-6 text-center space-y-1">
                <div className="text-xs font-bold text-[var(--text-primary)]">
                  No research question yet
                </div>
                <p className="text-[11px] text-[var(--text-dim)] font-sans">
                  This workspace has no claim nodes. Ingest a source to extract an
                  evidence-backed claim.
                </p>
              </div>
            )}
          </div>

          <button
            onClick={onOpenGraph}
            className="flex items-center justify-center gap-2 w-full py-2.5 bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] transition shadow-md mt-2"
          >
            <span>Open research graph</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Recent Artifacts Table */}
      <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
            Recent artifacts
          </div>
          <div className="text-[10px] text-[var(--text-dim)]">
            {artifacts.length} artifact{artifacts.length === 1 ? '' : 's'} recorded
          </div>
        </div>

        {artifacts.length === 0 ? (
          <div className="border border-dashed border-[var(--border-primary)] bg-[var(--bg-surface)] p-6 text-center space-y-1">
            <div className="text-xs font-bold text-[var(--text-primary)]">No artifacts yet</div>
            <p className="text-[11px] text-[var(--text-dim)] font-sans">
              Artifacts are written by an approved experiment run and appear here afterwards.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border-primary)] text-[10px] text-[var(--text-dim)] uppercase tracking-wider">
                  <th className="pb-2">ARTIFACT</th>
                  <th className="pb-2">TYPE</th>
                  <th className="pb-2">RUN STATUS</th>
                  <th className="pb-2">VERDICT</th>
                  <th className="pb-2 text-right">SIZE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-primary)]">
                {artifacts.slice(0, ARTIFACT_ROW_LIMIT).map((artifact) => (
                  <tr key={artifact.id} className="hover:bg-[var(--bg-surface-hover)]">
                    <td className="py-3 font-semibold text-[var(--text-primary)]">
                      <div className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 text-sky-400 flex-shrink-0" />
                        <span className="truncate max-w-[320px]" title={artifact.path}>
                          {artifact.path}
                        </span>
                      </div>
                      <div className="text-[10px] text-[var(--text-dim)] font-normal pl-6">
                        {artifact.claimTitle} · attempt {artifact.attempt}
                      </div>
                    </td>
                    <td className="py-3 text-[var(--text-muted)] uppercase">{artifact.kind}</td>
                    <td className="py-3">
                      <span className="badge-solid-white !text-[8px] rounded-none uppercase">
                        {artifact.runStatus}
                      </span>
                    </td>
                    <td className="py-3">
                      {artifact.runVerdict ? (
                        <span
                          className={`border px-1.5 py-0.5 uppercase text-[9px] rounded-none ${verdictTone(artifact.runVerdict)}`}
                        >
                          {artifact.runVerdict}
                        </span>
                      ) : (
                        <span className="text-[10px] text-[var(--text-dim)]">pending</span>
                      )}
                    </td>
                    <td className="py-3 text-right text-[var(--text-dim)]">
                      {formatBytes(artifact.bytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {artifacts.length > ARTIFACT_ROW_LIMIT && (
              <div className="pt-3 text-[10px] text-[var(--text-dim)]">
                Showing {ARTIFACT_ROW_LIMIT} of {artifacts.length} artifacts.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
