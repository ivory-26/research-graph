import React from 'react';
import { DEMO_STRATEGIES } from '../../data/demoWorkspace';
import { BarChart3, X, Award, Zap, Coins, Clock } from 'lucide-react';

interface StrategyDashboardProps {
  isOpen: boolean;
  onClose: () => void;
}

export const StrategyDashboard: React.FC<StrategyDashboardProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  // Sorted by Laplace score descending as required by pickStrategy
  const sorted = [...DEMO_STRATEGIES].sort((a, b) => b.score - a.score);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-cyan-500/10 p-2.5 text-cyan-600 dark:text-cyan-400">
              <BarChart3 className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Agent Strategy Leaderboard
                </h2>
                <span className="rounded-full bg-cyan-100 dark:bg-cyan-950 px-2 py-0.5 text-[10px] font-bold text-cyan-800 dark:text-cyan-300">
                  Laplace Smoothed: (s+1)/(n+2)
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Empirical scoring computed via GROUP BY agent_tasks. No separate score table to drift.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Summary Metric Cards */}
          <div className="grid grid-cols-4 gap-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs">
                <Award className="h-4 w-4 text-amber-500" />
                Top Strategy
              </div>
              <div className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">
                {sorted[0].name}
              </div>
              <div className="text-[10px] text-emerald-600 font-mono">
                {(sorted[0].score * 100).toFixed(1)}% win rate
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs">
                <Zap className="h-4 w-4 text-cyan-500" />
                Recorded Tasks
              </div>
              <div className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">
                {sorted.reduce((acc, s) => acc + s.attempts, 0)} Total
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                {sorted.reduce((acc, s) => acc + s.successes, 0)} verified passes
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs">
                <Coins className="h-4 w-4 text-emerald-500" />
                Cumulative Cost
              </div>
              <div className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100 font-mono">
                ${sorted.reduce((acc, s) => acc + s.totalCostUsd, 0).toFixed(4)}
              </div>
              <div className="text-[10px] text-slate-400">Gemini 3.8 Flash</div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs">
                <Clock className="h-4 w-4 text-purple-500" />
                Avg Latency
              </div>
              <div className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100 font-mono">
                1,596 ms
              </div>
              <div className="text-[10px] text-slate-400">Sequential calls</div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                <tr>
                  <th className="p-3.5">Rank &amp; Strategy</th>
                  <th className="p-3.5">Task Kind</th>
                  <th className="p-3.5 text-center">Attempts</th>
                  <th className="p-3.5 text-center">Verified</th>
                  <th className="p-3.5 text-right">Laplace Score</th>
                  <th className="p-3.5 text-right">Avg Latency</th>
                  <th className="p-3.5 text-right">Cost (USD)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono">
                {sorted.map((strat, i) => (
                  <tr
                    key={strat.id}
                    className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition"
                  >
                    <td className="p-3.5 font-sans font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800 text-[10px]">
                        {i + 1}
                      </span>
                      {strat.name}
                    </td>
                    <td className="p-3.5 font-sans text-slate-600 dark:text-slate-400">
                      {strat.taskKind}
                    </td>
                    <td className="p-3.5 text-center text-slate-700 dark:text-slate-300">
                      {strat.attempts}
                    </td>
                    <td className="p-3.5 text-center text-emerald-600 dark:text-emerald-400 font-bold">
                      {strat.successes}
                    </td>
                    <td className="p-3.5 text-right font-bold text-cyan-600 dark:text-cyan-400">
                      {(strat.score * 100).toFixed(1)}%
                    </td>
                    <td className="p-3.5 text-right text-slate-500">
                      {strat.avgLatencyMs}ms
                    </td>
                    <td className="p-3.5 text-right text-slate-700 dark:text-slate-300">
                      ${strat.totalCostUsd.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-slate-100 p-5 dark:border-slate-800">
          <button
            onClick={onClose}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 transition"
          >
            Close Dashboard
          </button>
        </div>
      </div>
    </div>
  );
};
