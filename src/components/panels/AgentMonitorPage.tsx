import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { DEMO_STRATEGIES } from '../../data/demoWorkspace';
import {
  UNATTRIBUTED_RUN_LABEL,
  latestAgentTask,
  summarizeAgentTasks,
  summarizeAgentTasksByKind,
  type AgentTaskKindSummary,
  type AgentTaskOverview,
} from '../../utils/strategyClient';
import type { AgentTaskRow } from '../../shared/strategies';
import type { AgentTaskStatus, TaskKind } from '../../shared/types';

interface AgentMonitorPageProps {
  /** Active workspace id: a database UUID, or the fixture id when `isLive` is false. */
  workspaceId: string;
  /** True only when an authenticated database workspace is active. */
  isLive: boolean;
}

function formatLatency(latencyMs: number | null): string {
  return latencyMs !== null ? `${(latencyMs / 1000).toFixed(2)}s` : '—';
}

function formatCost(costUsd: number, samples: number): string {
  return samples > 0 ? `$${costUsd.toFixed(4)}` : '—';
}

function statusTone(status: AgentTaskStatus): string {
  if (status === 'succeeded') return 'text-emerald-300';
  if (status === 'failed' || status === 'rejected') return 'text-red-300';
  if (status === 'retried') return 'text-amber-300';
  return 'text-[var(--text-muted)]';
}

const TASK_KINDS: ReadonlySet<TaskKind> = new Set([
  'ingest',
  'extract_claims',
  'propose_edges',
  'plan_experiment',
  'repair_script',
  'explain_gap',
  'ask_across_sources',
]);

const TASK_STATUSES: ReadonlySet<AgentTaskStatus> = new Set([
  'succeeded',
  'failed',
  'rejected',
  'retried',
]);

export const AgentMonitorPage: React.FC<AgentMonitorPageProps> = ({ workspaceId, isLive }) => {
  if (!isLive) return <DemoAgentMonitorPage />;
  return <LiveAgentMonitorPage workspaceId={workspaceId} />;
};

/** The intentional offline demo. Never presented as measured run output. */
const DemoAgentMonitorPage: React.FC = () => {
  const totalTasks = DEMO_STRATEGIES.reduce((sum, s) => sum + s.attempts, 0);
  const avgLatency = DEMO_STRATEGIES.length > 0
    ? (DEMO_STRATEGIES.reduce((sum, s) => sum + s.avgLatencyMs, 0) / DEMO_STRATEGIES.length / 1000).toFixed(1)
    : '0.0';

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto animate-fade-in font-mono">
      <div className="border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 font-sans">
        <strong className="font-bold">Demo fixture · not measured.</strong> The tasks, latencies
        and costs below are a recorded fixture, not rows from a database workspace.
      </div>

      {/* 3 KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
            PIPELINE STATUS
          </div>
          <div className="text-2xl font-extrabold text-emerald-400 my-2">
            IDLE
          </div>
          <div className="text-[11px] text-[var(--text-dim)]">
            No active execution
          </div>
        </div>

        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
            AGENT TASKS
          </div>
          <div className="text-2xl font-extrabold text-[var(--text-primary)] my-2">
            {totalTasks}
          </div>
          <div className="text-[11px] text-[var(--text-dim)]">
            Recorded attempts in demo fixture
          </div>
        </div>

        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] flex items-center justify-between">
            <span>AVG LATENCY</span>
            <span className="badge-orange-outline !text-[8px] rounded-none">PREVIEW</span>
          </div>
          <div className="text-2xl font-extrabold text-[#f97316] my-2">
            {avgLatency}s
          </div>
          <div className="text-[11px] text-[var(--text-dim)]">
            Mean task duration in demo fixture
          </div>
        </div>
      </div>

      {/* Grid 2: Research Pipeline Timeline & Selected Task Details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Research Pipeline Stages */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
          <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
            Research pipeline
          </div>
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-3">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <div>
                  <div className="text-xs text-[var(--text-primary)] font-semibold">
                    Source ingestion agent
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] font-sans">
                    Extract and normalize PDF content with unpdf
                  </div>
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">STANDBY</span>
            </div>

            <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-3">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <div>
                  <div className="text-xs text-[var(--text-primary)] font-semibold">
                    Claim extraction agent
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] font-sans">
                    Identify testable empirical research claims
                  </div>
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">STANDBY</span>
            </div>

            <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-3">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <div>
                  <div className="text-xs text-[var(--text-primary)] font-semibold">
                    Evidence validation agent
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] font-sans">
                    Verify verbatim quotes and chunk anchors
                  </div>
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">STANDBY</span>
            </div>

            <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-3">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-[#f97316] shadow-[0_0_8px_#f97316]" />
                <div>
                  <div className="text-xs text-[var(--text-primary)] font-semibold">
                    Experiment planner
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] font-sans">
                    Generate an experiment specification
                  </div>
                </div>
              </div>
              <span className="badge-orange-outline !text-[8px] rounded-none">WAITING</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-zinc-600" />
                <div>
                  <div className="text-xs text-[var(--text-muted)] font-semibold">
                    Sandbox runner
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] font-sans">
                    Execute approved Python script in E2B
                  </div>
                </div>
              </div>
              <span className="border border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-dim)] text-[8px] px-1.5 py-0.5">
                WAITING
              </span>
            </div>
          </div>
        </div>

        {/* Selected Task Details */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
          <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
            Recorded Seed Task Specification · extract_claims
          </div>
          <div className="text-[10px] text-[var(--text-dim)]">
            The seeded workspace records Meta's Contributor model; the application runtime stays on gemini-3.8-flash.
          </div>

          <div className="space-y-1">
            <div className="text-[10px] uppercase text-[var(--text-dim)]">TASK INPUT SPEC</div>
            <pre className="p-3 bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[11px] text-[var(--text-secondary)] font-mono overflow-x-auto leading-relaxed">
{`source_ids: ["src-1"]
strategy: "sectioned"
model: "muse-spark-1.3-contributor"
max_attempts: 2`}
            </pre>
          </div>

          <div className="space-y-1">
            <div className="text-[10px] uppercase text-[var(--text-dim)]">TASK OUTPUT SPEC</div>
            <p className="text-xs text-[var(--text-muted)] font-sans leading-relaxed">
              Candidate claim extraction and evidence passage linking. Verbatim quote validation requires 100% exact substring match against chunk anchors (e.g. chunk-1).
            </p>
          </div>

          <div className="pt-2 border-t border-[var(--border-primary)] space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-[var(--text-dim)]">Status:</span>
              <span className="badge-solid-white !text-[8px] rounded-none">STANDBY</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-dim)]">Reproduction Mode:</span>
              <strong className="text-[var(--text-primary)] font-mono">adapted</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface LiveTasksState {
  workspaceId: string;
  status: 'loading' | 'ready' | 'error';
  tasks: AgentTaskRow[];
  error: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeTasks(data: unknown): AgentTaskRow[] {
  const rows = asRecord(data)?.tasks;
  if (!Array.isArray(rows)) return [];
  const tasks: AgentTaskRow[] = [];
  for (const value of rows) {
    const row = asRecord(value) ?? {};
    // A row whose kind or status is outside the contract cannot be rendered
    // truthfully, so it is dropped rather than relabeled.
    if (!TASK_KINDS.has(row.taskKind as TaskKind)) continue;
    if (!TASK_STATUSES.has(row.status as AgentTaskStatus)) continue;
    tasks.push({
      id: String(row.id ?? ''),
      taskKind: row.taskKind as TaskKind,
      strategyId: String(row.strategyId ?? 'unassigned'),
      runId: typeof row.runId === 'string' ? row.runId : null,
      runLabel: typeof row.runLabel === 'string' ? row.runLabel : null,
      model: typeof row.model === 'string' ? row.model : null,
      status: row.status as AgentTaskStatus,
      latencyMs:
        typeof row.latencyMs === 'number' && Number.isFinite(row.latencyMs)
          ? row.latencyMs
          : null,
      costUsd:
        typeof row.costUsd === 'number' && Number.isFinite(row.costUsd)
          ? row.costUsd
          : null,
      error: typeof row.error === 'string' ? row.error : null,
      createdAt: typeof row.createdAt === 'string' ? row.createdAt : null,
    });
  }
  return tasks;
}

async function fetchAgentTasks(workspaceId: string, signal: AbortSignal): Promise<AgentTaskRow[]> {
  const res = await fetch(
    `/api/strategies?workspaceId=${encodeURIComponent(workspaceId)}`,
    {
      signal,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    },
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      data && typeof (data as { error?: unknown }).error === 'string'
        ? String((data as { error: string }).error)
        : `HTTP ${res.status}`,
    );
  }
  return normalizeTasks(data);
}

function formatRecordedAt(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function KpiCards({ summary }: { summary: AgentTaskOverview }) {
  const breakdown = [
    `${summary.succeeded} succeeded`,
    `${summary.failed} failed`,
    `${summary.retried} retried`,
    ...(summary.rejected > 0 ? [`${summary.rejected} rejected`] : []),
  ].join(' · ');

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-5">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
          AGENT TASKS
        </div>
        <div className="text-2xl font-extrabold text-[var(--text-primary)] my-2">
          {summary.totalTasks}
        </div>
        <div className="text-[11px] text-[var(--text-dim)]">{breakdown}</div>
      </div>

      <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-5">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
          AVG LATENCY
        </div>
        <div className="text-2xl font-extrabold text-[#f97316] my-2">
          {formatLatency(summary.avgLatencyMs)}
        </div>
        <div className="text-[11px] text-[var(--text-dim)]">
          {summary.latencySamples > 0
            ? `Mean over ${summary.latencySamples} timed task${summary.latencySamples === 1 ? '' : 's'}`
            : 'No latency recorded'}
        </div>
      </div>

      <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-5">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
          ESTIMATED COST
        </div>
        <div className="text-2xl font-extrabold text-[var(--text-primary)] my-2">
          {formatCost(summary.totalCostUsd, summary.costSamples)}
        </div>
        <div className="text-[11px] text-[var(--text-dim)]">
          Sum of recorded cost_usd · estimate, not billing
        </div>
      </div>

      <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-5">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
          MODELS OBSERVED
        </div>
        <div className="text-2xl font-extrabold text-[var(--text-primary)] my-2">
          {summary.models.length}
        </div>
        <div className="text-[11px] text-[var(--text-dim)] break-words">
          {summary.models.length > 0 ? summary.models.join(' · ') : 'No model recorded'}
        </div>
      </div>
    </div>
  );
}

function KindTable({
  summaries,
  onSelectTask,
}: {
  summaries: AgentTaskKindSummary[];
  onSelectTask: (taskId: string) => void;
}) {
  return (
    <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
          Agent tasks by kind
        </div>
        <div className="text-[10px] text-[var(--text-dim)]">
          {summaries.length} kind{summaries.length === 1 ? '' : 's'} · click a row for its latest task
        </div>
      </div>

      {summaries.length === 0 ? (
        <div className="border border-dashed border-[var(--border-primary)] bg-[var(--bg-surface)] p-6 text-center space-y-1">
          <div className="text-xs font-bold text-[var(--text-primary)]">No agent tasks yet</div>
          <p className="text-[11px] text-[var(--text-dim)] font-sans">
            Every model call writes exactly one agent_tasks row, including failures. Rows appear
            here after the first ingestion or pipeline run.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border-primary)] text-[10px] text-[var(--text-dim)] uppercase tracking-wider">
                <th className="pb-2">TASK KIND</th>
                <th className="pb-2 text-right">COUNT</th>
                <th className="pb-2">LATEST STATUS</th>
                <th className="pb-2">MODELS</th>
                <th className="pb-2 text-right">AVG LATENCY</th>
                <th className="pb-2 text-right">COST</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-primary)]">
              {summaries.map((summary) => (
                <tr
                  key={summary.taskKind}
                  onClick={() => {
                    if (summary.latestTaskId) onSelectTask(summary.latestTaskId);
                  }}
                  className="cursor-pointer hover:bg-[var(--bg-surface-hover)]"
                  title={`Show the latest ${summary.taskKind} task`}
                >
                  <td className="py-3 font-semibold text-[var(--text-primary)]">
                    {summary.taskKind}
                  </td>
                  <td className="py-3 text-right text-[var(--text-primary)]">
                    {summary.count}
                  </td>
                  <td className={`py-3 uppercase ${statusTone(summary.latestStatus)}`}>
                    {summary.latestStatus}
                  </td>
                  <td className="py-3 text-[var(--text-muted)]">
                    {summary.models.length > 0 ? summary.models.join(' · ') : '—'}
                  </td>
                  <td className="py-3 text-right text-[var(--text-muted)]">
                    {formatLatency(summary.avgLatencyMs)}
                  </td>
                  <td className="py-3 text-right text-[var(--text-muted)]">
                    {formatCost(summary.totalCostUsd, summary.costSamples)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pt-3 text-[10px] text-[var(--text-dim)]">
            Latest status is read from each kind&apos;s most recent agent_tasks row.
          </div>
        </div>
      )}
    </div>
  );
}

function TaskDetail({ task }: { task: AgentTaskRow | null }) {
  return (
    <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
      <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
        {task ? `Task detail · ${task.taskKind}` : 'Task detail'}
      </div>

      {task === null ? (
        <div className="border border-dashed border-[var(--border-primary)] bg-[var(--bg-surface)] p-6 text-center space-y-1">
          <div className="text-xs font-bold text-[var(--text-primary)]">No task selected</div>
          <p className="text-[11px] text-[var(--text-dim)] font-sans">
            Once agent_tasks rows exist, the latest attempt is shown here with its model, latency,
            cost and run attribution.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-[var(--text-primary)]">{task.taskKind}</span>
            <span className={`border border-[var(--border-primary)] px-1.5 py-0.5 uppercase text-[9px] ${statusTone(task.status)}`}>
              {task.status}
            </span>
            <span className="badge-solid-white !text-[8px] rounded-none uppercase">
              {task.strategyId}
            </span>
          </div>

          <div className="space-y-2 text-xs pt-2 border-t border-[var(--border-primary)]">
            <div className="flex justify-between gap-4">
              <span className="text-[var(--text-dim)]">Model:</span>
              <strong className="text-[var(--text-primary)] font-mono text-right break-all">
                {task.model ?? '—'}
              </strong>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-[var(--text-dim)]">Latency:</span>
              <strong className="text-[var(--text-primary)] font-mono">
                {formatLatency(task.latencyMs)}
              </strong>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-[var(--text-dim)]">Cost:</span>
              <strong className="text-[var(--text-primary)] font-mono">
                {task.costUsd !== null ? `$${task.costUsd.toFixed(6)}` : '—'}
              </strong>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-[var(--text-dim)]">Run:</span>
              <strong
                className="text-[var(--text-primary)] font-mono text-right break-all"
                title={task.runId ?? undefined}
              >
                {task.runLabel ?? task.runId ?? UNATTRIBUTED_RUN_LABEL}
              </strong>
            </div>
            {task.runLabel && task.runId && (
              <div className="flex justify-between gap-4">
                <span className="text-[var(--text-dim)]">Run ID:</span>
                <span className="text-[var(--text-muted)] font-mono text-right break-all">
                  {task.runId}
                </span>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <span className="text-[var(--text-dim)]">Recorded:</span>
              <span className="text-[var(--text-muted)] font-mono text-right">
                {formatRecordedAt(task.createdAt)}
              </span>
            </div>
          </div>

          {task.error && (
            <div className="space-y-1 pt-2 border-t border-[var(--border-primary)]">
              <div className="text-[10px] uppercase text-[var(--text-dim)]">Error</div>
              <pre className="p-3 bg-red-500/5 border border-red-500/30 text-[11px] text-red-200 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed">
                {task.error}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Live mode: reads the workspace's persisted `agent_tasks` rows and derives
 * every number on the page from them. There is no fixture fallback here.
 */
const LiveAgentMonitorPage: React.FC<{ workspaceId: string }> = ({ workspaceId }) => {
  const [state, setState] = useState<LiveTasksState>(() => ({
    workspaceId,
    status: 'loading',
    tasks: [],
    error: null,
  }));
  const [revision, setRevision] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ workspaceId, status: 'loading', tasks: [], error: null });
    setSelectedTaskId(null);

    fetchAgentTasks(workspaceId, controller.signal)
      .then((tasks) => {
        if (!active) return;
        setState({ workspaceId, status: 'ready', tasks, error: null });
      })
      .catch((err: unknown) => {
        if (!active || controller.signal.aborted) return;
        setState({
          workspaceId,
          status: 'error',
          tasks: [],
          error: err instanceof Error ? err.message : 'Failed to load agent tasks',
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
  const tasks = useMemo(() => live?.tasks ?? [], [live]);

  const summary = useMemo(() => summarizeAgentTasks(tasks), [tasks]);
  const kindSummaries = useMemo(() => summarizeAgentTasksByKind(tasks), [tasks]);
  const selectedTask = useMemo(() => {
    if (selectedTaskId) {
      const found = tasks.find((task) => task.id === selectedTaskId);
      if (found) return found;
    }
    return latestAgentTask(tasks);
  }, [tasks, selectedTaskId]);

  if (status === 'loading') {
    return (
      <div className="p-6 space-y-6 max-w-7xl mx-auto animate-fade-in font-mono">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
          LIVE AGENT_TASKS · DATABASE
        </div>
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-10 flex items-center justify-center gap-2 text-xs text-[var(--text-dim)]">
          <Loader2 className="h-4 w-4 animate-spin text-[#f97316]" />
          Loading agent_tasks rows from the database…
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
            <div className="font-bold">Agent tasks unavailable</div>
            <div>{live?.error ?? 'Failed to load agent tasks'}</div>
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
          LIVE AGENT_TASKS · DATABASE
        </div>
        <button
          onClick={() => setRevision((value) => value + 1)}
          className="flex items-center gap-1 text-[10px] text-[var(--text-dim)] hover:text-[#f97316]"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      <KpiCards summary={summary} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <KindTable summaries={kindSummaries} onSelectTask={setSelectedTaskId} />
        <TaskDetail task={selectedTask} />
      </div>
    </div>
  );
};
