import React, { useMemo } from 'react';
import { DEMO_STRATEGIES } from '../../data/demoWorkspace';
import {
  UNATTRIBUTED_RUN_LABEL,
  aggregateAgentTasksByRun,
  summarizeAgentTaskRuns,
  type AgentTaskRow,
  type AgentTaskRunSummary,
} from '../../utils/strategyClient';
import { X, AlertTriangle, Loader2 } from 'lucide-react';

function runDisplayName(run: Pick<AgentTaskRunSummary, 'runId' | 'label'>): string {
  return run.runId === null ? UNATTRIBUTED_RUN_LABEL : run.label;
}

function formatLatency(latencyMs: number | null): string {
  return latencyMs !== null ? `${(latencyMs / 1000).toFixed(2)}s` : '—';
}

function formatCost(costUsd: number | null): string {
  return costUsd !== null ? `$${costUsd.toFixed(4)}` : '—';
}

const RunKpiCard: React.FC<{ run: AgentTaskRunSummary }> = ({ run }) => {
  const attributed = run.runId !== null;
  return (
    <div
      className={`c min-w-0 p-4 bg-[var(--card-bg)] border rounded-none ${
        attributed ? 'border-[var(--border-primary)]' : 'border-dashed border-[var(--border-secondary)]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div
            className="truncate font-mono text-[11px] font-semibold text-[var(--text-primary)]"
            title={runDisplayName(run)}
          >
            {runDisplayName(run)}
          </div>
          <div
            className="truncate font-mono text-[9px] text-[var(--text-dim)]"
            title={run.runId ?? undefined}
          >
            {attributed ? run.runId : 'Tasks without a recorded run'}
          </div>
        </div>
        <span
          className={`shrink-0 border px-1.5 py-0.5 font-mono text-[9px] ${
            run.failures > 0
              ? 'border-red-500/40 bg-red-500/10 text-red-400'
              : 'border-[var(--border-primary)] text-[var(--text-dim)]'
          }`}
        >
          {run.failures} failed
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[10px]">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[var(--text-dim)]">Tasks</span>
          <span className="text-[var(--text-primary)]">{run.attempts}</span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[var(--text-dim)]">Success</span>
          <span className="text-[var(--text-primary)]">{run.successRate.toFixed(0)}%</span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[var(--text-dim)]">Successes</span>
          <span className="text-[var(--text-primary)]">{run.successes}</span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[var(--text-dim)]">Avg latency</span>
          <span className="text-[var(--text-muted)]">{formatLatency(run.avgLatencyMs)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[var(--text-dim)]">Avg cost</span>
          <span className="text-[var(--text-muted)]">{formatCost(run.avgCostUsd)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[var(--text-dim)]">Total cost</span>
          <span className="text-[#f97316]">
            {run.avgCostUsd !== null ? `$${run.totalCostUsd.toFixed(4)}` : '—'}
          </span>
        </div>
      </div>
    </div>
  );
};

interface StrategyDashboardProps {
  isModal?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  tasks?: AgentTaskRow[];
  source?: 'api' | 'fixture' | 'error' | 'loading';
}

export const StrategyDashboard: React.FC<StrategyDashboardProps> = ({
  isModal = false,
  isOpen = true,
  onClose,
  tasks,
  source = 'fixture',
}) => {
  const isDatabaseMode = source === 'api' || source === 'error';
  const liveTasks = tasks ?? [];

  // One row per (run, task kind, strategy), so two extraction batches are
  // compared side by side instead of being averaged into one row.
  const liveRows = useMemo(
    () => (isDatabaseMode ? aggregateAgentTasksByRun(liveTasks) : []),
    [isDatabaseMode, liveTasks],
  );

  // Per-run KPIs read from the same rows. Attributed runs are shown first;
  // the legacy bucket is rendered separately so it can never be mistaken for
  // a named extraction batch.
  const runSummaries = useMemo(
    () => (isDatabaseMode ? summarizeAgentTaskRuns(liveTasks) : []),
    [isDatabaseMode, liveTasks],
  );
  const attributedRuns = runSummaries.filter((run) => run.runId !== null);
  const unattributedRun = runSummaries.find((run) => run.runId === null) ?? null;

  const failedTasks = useMemo(
    () => liveTasks.filter((t) => t.status === 'failed' || t.status === 'rejected'),
    [liveTasks],
  );

  if (!isOpen) return null;

  if (source === 'loading') {
    const loadingContent = (
      <div
        role="status"
        aria-live="polite"
        className="flex h-full min-h-[240px] w-full items-center justify-center gap-2 p-6 font-mono text-xs text-[var(--text-dim)]"
      >
        <Loader2 className="h-4 w-4 animate-spin text-[#f97316]" />
        <span>Loading agent_tasks for this workspace…</span>
      </div>
    );

    if (isModal) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-5xl rounded-none border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl">
            {loadingContent}
          </div>
        </div>
      );
    }

    return <div className="h-full w-full bg-[var(--bg-primary)]">{loadingContent}</div>;
  }

  const rows = isDatabaseMode
    ? liveRows.map((s) => ({
        key: s.key,
        runId: s.runId,
        runLabel: s.runLabel,
        taskKind: s.taskKind,
        strategyId: s.strategyId,
        preferred: s.preferred,
        attempts: s.attempts,
        successes: s.successes,
        failures: s.failures,
        successRate: s.successRate,
        avgLatencyMs: s.avgLatencyMs,
        avgCostUsd: s.avgCostUsd,
        score: s.score,
      }))
    : DEMO_STRATEGIES.map((s) => {
        const failures = Math.max(0, s.attempts - s.successes);
        const successRate = s.attempts > 0 ? (s.successes / s.attempts) * 100 : 0;
        const avgCostUsd = s.attempts > 0 ? s.totalCostUsd / s.attempts : null;
        return {
          key: s.id,
          runId: null as string | null,
          runLabel: null as string | null,
          taskKind: s.taskKind,
          strategyId: s.name,
          preferred: Boolean(s.preferred),
          attempts: s.attempts,
          successes: s.successes,
          failures,
          successRate,
          avgLatencyMs: s.avgLatencyMs,
          avgCostUsd,
          score: s.score,
        };
      });

  const totalAttempts = isDatabaseMode
    ? liveTasks.length
    : DEMO_STRATEGIES.reduce((sum, s) => sum + s.attempts, 0);
  const totalFailures = isDatabaseMode
    ? failedTasks.length
    : DEMO_STRATEGIES.reduce((sum, s) => sum + Math.max(0, s.attempts - s.successes), 0);

  const costValues = isDatabaseMode
    ? liveTasks.map((t) => t.costUsd).filter((c): c is number => c !== null && Number.isFinite(c))
    : DEMO_STRATEGIES.map((s) => s.totalCostUsd);
  const totalCost = costValues.length > 0 ? costValues.reduce((sum, c) => sum + c, 0) : null;

  const latencyValues = isDatabaseMode
    ? liveTasks.map((t) => t.latencyMs).filter((l): l is number => l !== null && Number.isFinite(l))
    : DEMO_STRATEGIES.map((s) => s.avgLatencyMs);
  const avgLatency =
    latencyValues.length > 0
      ? (latencyValues.reduce((sum, l) => sum + l, 0) / latencyValues.length / 1000).toFixed(2)
      : null;

  const content = (
    <div className="w-full max-w-[1200px] mx-auto p-6 flex flex-col gap-5 text-[var(--text-secondary)]">
      {/* Title Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="l">Adaptive Agent Strategies</div>
            <span className="badge-orange-outline !text-[8px] rounded-none">
              {source === 'error' ? 'UNAVAILABLE' : isDatabaseMode ? 'LIVE AGENT_TASKS' : 'DEMO FIXTURE'}
            </span>
          </div>
          <div className="text-[22px] font-bold mt-1 text-[var(--text-primary)] font-mono tracking-tight">
            {isDatabaseMode
              ? 'Extraction Strategy Runs · Task Aggregation'
              : 'Extraction Strategy Runs · Demo Fixture Preview'}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isModal && onClose && (
            <button
              onClick={onClose}
              className="rounded-none p-2 text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] transition"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards with Sharp Corners */}
      <div className="flex gap-4 flex-wrap">
        <div className="c flex-1 min-w-[200px] p-5 bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none">
          <div className="l">{isDatabaseMode ? 'Tasks Recorded' : 'Fixture Tasks'}</div>
          <div className="text-[32px] font-bold mt-2 text-[var(--text-primary)] font-mono">
            {totalAttempts}
            {totalFailures > 0 && (
              <span className="text-sm text-red-400 ml-2 font-normal">
                ({totalFailures} failed)
              </span>
            )}
          </div>
          <div className="text-[10px] text-[var(--text-dim)] mt-1 font-mono">
            {source === 'error'
              ? 'Database query failed'
              : isDatabaseMode
                ? `Grouped from agent_tasks · ${attributedRuns.length} attributed run${attributedRuns.length === 1 ? '' : 's'}`
                : 'Demo fixture preview (fixtures/workspace.json)'}
          </div>
        </div>

        <div className="c flex-1 min-w-[200px] p-5 bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none">
          <div className="l">{isDatabaseMode ? 'Recorded Cost' : 'Total Cost'}</div>
          <div className="text-[32px] font-bold mt-2 text-[#f97316] font-mono">
            {totalCost !== null ? `$${totalCost.toFixed(3)}` : '—'}
          </div>
          <div className="text-[10px] text-[var(--text-dim)] mt-1 font-mono">
            {source === 'error' && 'Cost data unavailable'}
            {source === 'api' &&
              `Estimated cost for ${costValues.length} of ${totalAttempts} tasks · list price × measured tokens`}
            {source === 'fixture' && 'muse-spark-1.3-contributor + Embeddings · seeded recording'}
          </div>
        </div>

        <div className="c flex-1 min-w-[200px] p-5 bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none">
          <div className="l">Average Latency</div>
          <div className="text-[32px] font-bold mt-2 text-[var(--text-primary)] font-mono">
            {avgLatency !== null ? `${avgLatency} s` : '—'}
          </div>
          <div className="text-[10px] text-[var(--text-dim)] mt-1 font-mono">
            {isDatabaseMode ? 'Mean task duration' : 'Demo fixture baseline'}
          </div>
        </div>
      </div>

      {/* Per-run KPI comparison: every card is one persisted run_id. */}
      {isDatabaseMode && runSummaries.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <div className="l">Extraction batches and experiment runs</div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {attributedRuns.map((run) => (
              <RunKpiCard key={run.runId} run={run} />
            ))}
            {unattributedRun && <RunKpiCard run={unattributedRun} />}
          </div>
        </div>
      )}

      {/* Leaderboard Table with Sharp Corners */}
      <div className="c overflow-x-auto bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none">
        <table className="w-full border-collapse text-[13px] min-w-[1040px]">
          <thead>
            <tr className="l border-b border-[var(--border-primary)] bg-[var(--bg-surface-hover)]">
              {isDatabaseMode && (
                <th className="text-left p-3.5 font-semibold text-[var(--text-dim)]">Batch or run</th>
              )}
              <th className="text-left p-3.5 font-semibold text-[var(--text-dim)]">Task kind</th>
              <th className="text-left p-3.5 font-semibold text-[var(--text-dim)]">Strategy</th>
              <th className="text-right p-3.5 font-semibold text-[var(--text-dim)]">Tries</th>
              <th className="text-right p-3.5 font-semibold text-[var(--text-dim)]">Successes</th>
              <th className="text-right p-3.5 font-semibold text-[var(--text-dim)]">Failures</th>
              <th className="text-right p-3.5 font-semibold text-[var(--text-dim)]">Success rate</th>
              <th className="text-right p-3.5 font-semibold text-[var(--text-dim)]">Avg latency</th>
              <th className="text-right p-3.5 font-semibold text-[var(--text-dim)]">Avg cost</th>
              <th className="text-left p-3.5 font-semibold text-[var(--text-dim)]">Smoothed score</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={isDatabaseMode ? 10 : 9} className="p-6 text-center font-mono text-xs text-[var(--text-dim)]">
                  {source === 'error'
                    ? 'Failed to load agent_tasks from database.'
                    : 'No agent_tasks recorded for this workspace yet.'}
                </td>
              </tr>
            ) : (
              rows.map((strat) => {
              const barColor = strat.preferred ? '#f97316' : 'var(--border-secondary)';
              const percent = Math.round(strat.score * 100);
              const runName = strat.runLabel ?? strat.runId ?? UNATTRIBUTED_RUN_LABEL;

              return (
                <tr key={strat.key} className="border-t border-[var(--border-primary)] hover:bg-[var(--bg-surface-hover)] transition">
                  {isDatabaseMode && (
                    <td className="p-3.5 max-w-[220px]">
                      <div
                        className={`truncate font-mono text-[12px] ${strat.runId === null ? 'text-[var(--text-dim)]' : 'text-[var(--text-primary)]'}`}
                        title={runName}
                      >
                        {runName}
                      </div>
                      {strat.runId !== null && strat.runLabel && (
                        <div className="truncate font-mono text-[9px] text-[var(--text-dim)]" title={strat.runId}>
                          {strat.runId}
                        </div>
                      )}
                    </td>
                  )}
                  <td className="p-3.5 m text-[var(--text-primary)] font-medium">{strat.taskKind}</td>
                  <td className="p-3.5 text-[var(--text-primary)]">
                    <span className="font-mono text-[13px]">{strat.strategyId}</span>
                    {strat.preferred && (
                      <span className="badge-orange-outline ml-2.5 rounded-none">
                        PREFERRED
                      </span>
                    )}
                  </td>
                  <td className="p-3.5 text-right m text-[var(--text-muted)]">{strat.attempts}</td>
                  <td className="p-3.5 text-right m text-[var(--text-primary)] font-bold">{strat.successes}</td>
                  <td className={`p-3.5 text-right m font-mono ${strat.failures > 0 ? 'text-red-400 font-bold' : 'text-[var(--text-dim)]'}`}>
                    {strat.failures}
                  </td>
                  <td className="p-3.5 text-right m font-mono text-[var(--text-primary)]">
                    {strat.successRate.toFixed(0)}%
                  </td>
                  <td className="p-3.5 text-right m font-mono text-[var(--text-muted)]">
                    {formatLatency(strat.avgLatencyMs)}
                  </td>
                  <td className="p-3.5 text-right m font-mono text-[var(--text-muted)]">
                    {formatCost(strat.avgCostUsd)}
                  </td>
                  <td className="p-3.5 min-w-[160px]">
                    <div className="flex items-center gap-2.5">
                      <div className="flex-1 h-2 rounded-none bg-[var(--border-primary)] overflow-hidden">
                        <div
                          className="h-full rounded-none transition-all duration-500"
                          style={{
                            width: `${percent}%`,
                            backgroundColor: barColor,
                          }}
                        />
                      </div>
                      <span className="m text-[12px] w-9 text-right font-mono text-[var(--text-primary)]">
                        {strat.score.toFixed(2)}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })
            )}
          </tbody>
        </table>
      </div>

      {/* Explicit Failed Task Rows (only when live agent_tasks are present) */}
      {isDatabaseMode && failedTasks.length > 0 && (
        <div className="c p-4 bg-[var(--card-bg)] border border-red-500/30 rounded-none space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-mono font-bold text-red-400 uppercase">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Recorded Task Failures ({failedTasks.length})</span>
          </div>
          <div className="space-y-1.5 font-mono text-[11px]">
            {failedTasks.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 flex-wrap"
              >
                <div className="flex items-center gap-2">
                  <span className="px-1.5 py-0.5 bg-red-500/10 border border-red-500/40 text-red-400 text-[10px]">
                    {t.status.toUpperCase()}
                  </span>
                  <span className="text-[var(--text-primary)] font-semibold">{t.taskKind}</span>
                  <span className="text-[var(--text-dim)]">·</span>
                  <span className="text-[#f97316]">{t.strategyId}</span>
                  <span className="text-[var(--text-dim)]">
                    ({t.runLabel ?? t.runId ?? UNATTRIBUTED_RUN_LABEL})
                  </span>
                </div>
                <div className="text-[var(--text-muted)] truncate max-w-[520px]">
                  {t.error || 'Execution error'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer Note */}
      <div className="text-[11px] text-[var(--text-dim)] font-mono">
        {isDatabaseMode
          ? 'Strategy Evaluation: Rows are grouped by (run, task_kind, strategy_id) from persisted agent_tasks; the score is Laplace-smoothed (successes + 1) / (attempts + 2). Rows without a run id are legacy, unattributed tasks.'
          : 'Strategy Evaluation (Demo Fixture): Displays illustrative fixture values from fixtures/workspace.json until a database workspace is active.'}
      </div>
    </div>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md animate-fade-in overflow-y-auto">
        <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-none border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl">
          {content}
        </div>
      </div>
    );
  }

  return <div className="h-full w-full overflow-y-auto bg-[var(--bg-primary)]">{content}</div>;
};
