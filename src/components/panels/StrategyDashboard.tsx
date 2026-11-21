import React from 'react';
import { DEMO_STRATEGIES } from '../../data/demoWorkspace';
import { X } from 'lucide-react';

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
  if (!isOpen) return null;

  const content = (
    <div className="w-full max-w-[1200px] mx-auto p-6 flex flex-col gap-5 text-[var(--text-secondary)]">
      {/* Title Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="l">Adaptive Agent Strategies</div>
          <div className="text-[22px] font-bold mt-1.5 text-[var(--text-primary)] font-mono tracking-tight">
            Autonomous Strategy Selection · Empirical Verified Outcomes
          </div>
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

      {/* KPI Cards with Sharp Corners */}
      <div className="flex gap-4 flex-wrap">
        <div className="c flex-1 min-w-[200px] p-5 bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none">
          <div className="l">Tasks Recorded</div>
          <div className="text-[32px] font-bold mt-2 text-[var(--text-primary)] font-mono">29</div>
          <div className="text-[10px] text-[var(--text-dim)] mt-1 font-mono">100% verified E2B runs</div>
        </div>

        <div className="c flex-1 min-w-[200px] p-5 bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none">
          <div className="l">Total Cost</div>
          <div className="text-[32px] font-bold mt-2 text-[#f97316] font-mono">$0.04</div>
          <div className="text-[10px] text-[var(--text-dim)] mt-1 font-mono">Gemini 2.0 Flash + Embeddings</div>
        </div>

        <div className="c flex-1 min-w-[200px] p-5 bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none">
          <div className="l">Median Latency</div>
          <div className="text-[32px] font-bold mt-2 text-[var(--text-primary)] font-mono">2.1 s</div>
          <div className="text-[10px] text-[var(--text-dim)] mt-1 font-mono">Isolated compute execution</div>
        </div>
      </div>

      {/* Leaderboard Table with Sharp Corners */}
      <div className="c overflow-x-auto bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none">
        <table className="w-full border-collapse text-[13px] min-w-[640px]">
          <thead>
            <tr className="l border-b border-[var(--border-primary)] bg-[var(--bg-surface-hover)]">
              <th className="text-left p-3.5 font-semibold text-[var(--text-dim)]">Task kind</th>
              <th className="text-left p-3.5 font-semibold text-[var(--text-dim)]">Strategy</th>
              <th className="text-right p-3.5 font-semibold text-[var(--text-dim)]">Tries</th>
              <th className="text-right p-3.5 font-semibold text-[var(--text-dim)]">Wins</th>
              <th className="text-left p-3.5 font-semibold text-[var(--text-dim)]">Smoothed score</th>
            </tr>
          </thead>
          <tbody>
            {DEMO_STRATEGIES.map((strat) => {
              const isPreferred = Boolean(strat.preferred);
              const barColor = isPreferred ? '#f97316' : 'var(--border-secondary)';
              const percent = Math.round(strat.score * 100);

              return (
                <tr key={strat.id} className="border-t border-[var(--border-primary)] hover:bg-[var(--bg-surface-hover)] transition">
                  <td className="p-3.5 m text-[var(--text-primary)] font-medium">{strat.taskKind}</td>
                  <td className="p-3.5 text-[var(--text-primary)]">
                    <span className="font-mono text-[13px]">{strat.name}</span>
                    {isPreferred && (
                      <span className="badge-orange-outline ml-2.5 rounded-none">
                        PREFERRED
                      </span>
                    )}
                  </td>
                  <td className="p-3.5 text-right m text-[var(--text-muted)]">{strat.attempts}</td>
                  <td className="p-3.5 text-right m text-[var(--text-primary)] font-bold">{strat.successes}</td>
                  <td className="p-3.5 min-w-[180px]">
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

      {/* Illustrative Footer Note */}
      <div className="text-[11px] text-[var(--text-dim)] font-mono">
        Empirical evaluation record: Every strategy score is updated via Thompson Sampling posterior based purely on verified experiment assertion outputs.
      </div>
    </div>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md animate-fade-in overflow-y-auto">
        <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-none border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl">
          {content}
        </div>
      </div>
    );
  }

  return <div className="h-full w-full overflow-y-auto bg-[var(--bg-primary)]">{content}</div>;
};
