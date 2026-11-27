import React, { useEffect, useMemo, useState } from 'react';
import {
  PREVIEW_AGENT_TASKS,
  aggregateAgentTasks,
  fetchAgentTasks,
  type AgentTaskRow,
} from '../../utils/strategyClient';
import { X, AlertTriangle } from 'lucide-react';

interface StrategyDashboardProps {
  isModal?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

export const StrategyDashboard: React.FC<StrategyDashboardProps> = ({
  isModal = false,
  isOpen = true,
  onClose,
}) => {
  const [tasks, setTasks] = useState<AgentTaskRow[]>(PREVIEW_AGENT_TASKS);
  const [dataSource, setDataSource] = useState<'api' | 'preview'>('preview');
  const [runFilter, setRunFilter] = useState<string>('all');

  useEffect(() => {
    let active = true;
    fetchAgentTasks().then((res) => {
      if (active) {
        setTasks(res.tasks);
        setDataSource(res.source);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  if (!isOpen) return null;

  const availableRuns = useMemo(() => {
    const runs = new Set(tasks.map((t) => t.runId));
    return ['all', ...Array.from(runs).sort()];
  }, [tasks]);

  const filteredTasks = useMemo(
    () => (runFilter === 'all' ? tasks : tasks.filter((t) => t.runId === runFilter)),
    [tasks, runFilter],
  );

  const strategies = useMemo(
    () => aggregateAgentTasks(tasks, runFilter),
    [tasks, runFilter],
  );

  const failedTasks = useMemo(
    () => filteredTasks.filter((t) => t.status === 'failed'),
    [filteredTasks],
  );

  const totalAttempts = filteredTasks.length;
  const totalFailures = failedTasks.length;
  const totalCost = filteredTasks.reduce((sum, t) => sum + t.costUsd, 0);
  const avgLatency =
    totalAttempts > 0
      ? (filteredTasks.reduce((sum, t) => sum + t.latencyMs, 0) / totalAttempts / 1000).toFixed(2)
      : '0.00';

  const content = (
    <div className="w-full max-w-[1200px] mx-auto p-6 flex flex-col gap-5 text-[var(--text-secondary)]">
      {/* Title Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="l">Adaptive Agent Strategies</div>
            <span className="badge-orange-outline !text-[8px] rounded-none">
              {dataSource === 'api' ? 'LIVE AGENT_TASKS' : 'PREVIEW'}
            </span>
          </div>
          <div className="text-[22px] font-bold mt-1 text-[var(--text-primary)] font-mono tracking-tight">
            Autonomous Strategy Selection · Task Aggregation
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Extraction Run Filter */}
          <div className="flex items-center gap-1 border border-[var(--border-primary)] bg-[var(--bg-surface)] p-1 font-mono text-[11px]">
            {availableRuns.map((runId) => (
              <button
                key={runId}
                type="button"
                onClick={() => setRunFilter(runId)}
                className={`px-2.5 py-1 transition uppercase cursor-pointer ${
                  runFilter === runId
                    ? 'bg-[#f97316] text-black font-bold'
                    : 'text-[var(--text-dim)] hover:text-[var(--text-primary)]'
                }`}
              >
                {runId === 'all' ? 'All Runs' : runId}
              </button>
            ))}
          </div>

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
          <div className="l">Tasks Recorded</div>
          <div className="text-[32px] font-bold mt-2 text-[var(--text-primary)] font-mono">
            {totalAttempts}
            {totalFailures > 0 && (
              <span className="text-sm text-red-400 ml-2 font-normal">
                ({totalFailures} failed)
              </span>
            )}
          </div>
          <div className="text-[10px] text-[var(--text-dim)] mt-1 font-mono">
            Grouped from agent_tasks ({runFilter === 'all' ? 'all runs' : runFilter})
          </div>
        </div>

        <div className="c flex-1 min-w-[200px] p-5 bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none">
          <div className="l">Total Cost</div>
          <div className="text-[32px] font-bold mt-2 text-[#f97316] font-mono">${totalCost.toFixed(3)}</div>
          <div className="text-[10px] text-[var(--text-dim)] mt-1 font-mono">Aggregated task cost</div>
        </div>

        <div className="c flex-1 min-w-[200px] p-5 bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none">
          <div className="l">Average Latency</div>
          <div className="text-[32px] font-bold mt-2 text-[var(--text-primary)] font-mono">{avgLatency} s</div>
          <div className="text-[10px] text-[var(--text-dim)] mt-1 font-mono">Mean task duration</div>
        </div>
      </div>

      {/* Leaderboard Table with Sharp Corners */}
      <div className="c overflow-x-auto bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none">
        <table className="w-full border-collapse text-[13px] min-w-[820px]">
          <thead>
            <tr className="l border-b border-[var(--border-primary)] bg-[var(--bg-surface-hover)]">
              <th className="text-left p-3.5 font-semibold text-[var(--text-dim)]">Task kind</th>
              <th className="text-left p-3.5 font-semibold text-[var(--text-dim)]">Strategy</th>
              <th className="text-right p-3.5 font-semibold text-[var(--text-dim)]">Tries</th>
              <th className="text-right p-3.5 font-semibold text-[var(--text-dim)]">Wins</th>
              <th className="text-right p-3.5 font-semibold text-[var(--text-dim)]">Failures</th>
              <th className="text-right p-3.5 font-semibold text-[var(--text-dim)]">Success rate</th>
              <th className="text-right p-3.5 font-semibold text-[var(--text-dim)]">Avg latency</th>
              <th className="text-right p-3.5 font-semibold text-[var(--text-dim)]">Avg cost</th>
              <th className="text-left p-3.5 font-semibold text-[var(--text-dim)]">Smoothed score</th>
            </tr>
          </thead>
          <tbody>
            {strategies.map((strat) => {
              const isPreferred = Boolean(strat.preferred);
              const barColor = isPreferred ? '#f97316' : 'var(--border-secondary)';
              const percent = Math.round(strat.score * 100);

              return (
                <tr key={strat.key} className="border-t border-[var(--border-primary)] hover:bg-[var(--bg-surface-hover)] transition">
                  <td className="p-3.5 m text-[var(--text-primary)] font-medium">{strat.taskKind}</td>
                  <td className="p-3.5 text-[var(--text-primary)]">
                    <span className="font-mono text-[13px]">{strat.strategyId}</span>
                    {isPreferred && (
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
                    {(strat.avgLatencyMs / 1000).toFixed(2)}s
                  </td>
                  <td className="p-3.5 text-right m font-mono text-[var(--text-muted)]">
                    ${strat.avgCostUsd.toFixed(4)}
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
            })}
          </tbody>
        </table>
      </div>

      {/* Explicit Failed Task Rows */}
      {failedTasks.length > 0 && (
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
                    FAILED
                  </span>
                  <span className="text-[var(--text-primary)] font-semibold">{t.taskKind}</span>
                  <span className="text-[var(--text-dim)]">·</span>
                  <span className="text-[#f97316]">{t.strategyId}</span>
                  <span className="text-[var(--text-dim)]">({t.runId})</span>
                </div>
                <div className="text-[var(--text-muted)] truncate max-w-[520px]">
                  {t.error || 'Execution error'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Illustrative Footer Note */}
      <div className="text-[11px] text-[var(--text-dim)] font-mono">
        Strategy Evaluation: Aggregated by (task_kind, strategy_id, run_id) using Thompson Sampling over task outcomes.
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
