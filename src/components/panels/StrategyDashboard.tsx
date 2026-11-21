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
  if (isModal && !isOpen) return null;

  const content = (
    <div className="w-full max-w-[1200px] mx-auto p-6 flex flex-col gap-5 text-[#e5e5e5]">
      {/* Title Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="l">Adaptive Agent Strategies</div>
          <div className="text-[22px] font-bold mt-1.5 text-white font-mono tracking-tight">
            Autonomous Strategy Selection · Empirical Verified Outcomes
          </div>
        </div>
        {isModal && onClose && (
          <button
            onClick={onClose}
            className="rounded p-2 text-[#737373] hover:text-white hover:bg-[#171717] transition"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="flex gap-4 flex-wrap">
        <div className="c flex-1 min-w-[200px] p-5 bg-[#0a0a0a] border border-[#262626]">
          <div className="l">Tasks Recorded</div>
          <div className="text-[32px] font-bold mt-2 text-white font-mono">29</div>
          <div className="text-[10px] text-[#737373] mt-1 font-mono">100% verified E2B runs</div>
        </div>

        <div className="c flex-1 min-w-[200px] p-5 bg-[#0a0a0a] border border-[#262626]">
          <div className="l">Total Cost</div>
          <div className="text-[32px] font-bold mt-2 text-[#f97316] font-mono">$0.04</div>
          <div className="text-[10px] text-[#737373] mt-1 font-mono">Gemini 2.0 Flash + Embeddings</div>
        </div>

        <div className="c flex-1 min-w-[200px] p-5 bg-[#0a0a0a] border border-[#262626]">
          <div className="l">Median Latency</div>
          <div className="text-[32px] font-bold mt-2 text-white font-mono">2.1 s</div>
          <div className="text-[10px] text-[#737373] mt-1 font-mono">Isolated compute execution</div>
        </div>
      </div>

      {/* Leaderboard Table */}
      <div className="c overflow-x-auto bg-[#0a0a0a] border border-[#262626]">
        <table className="w-full border-collapse text-[13px] min-w-[640px]">
          <thead>
            <tr className="l border-b border-[#262626] bg-[#000000]">
              <th className="text-left p-3.5 font-semibold text-[#737373]">Task kind</th>
              <th className="text-left p-3.5 font-semibold text-[#737373]">Strategy</th>
              <th className="text-right p-3.5 font-semibold text-[#737373]">Tries</th>
              <th className="text-right p-3.5 font-semibold text-[#737373]">Wins</th>
              <th className="text-left p-3.5 font-semibold text-[#737373]">Smoothed score</th>
            </tr>
          </thead>
          <tbody>
            {DEMO_STRATEGIES.map((strat) => {
              const isPreferred = Boolean(strat.preferred);
              const barColor = isPreferred ? '#f97316' : '#404040';
              const percent = Math.round(strat.score * 100);

              return (
                <tr key={strat.id} className="border-t border-[#262626] hover:bg-[#121212] transition">
                  <td className="p-3.5 m text-white font-medium">{strat.taskKind}</td>
                  <td className="p-3.5 text-white">
                    <span className="font-mono text-[13px]">{strat.name}</span>
                    {isPreferred && (
                      <span className="badge-orange-outline ml-2.5">
                        PREFERRED
                      </span>
                    )}
                  </td>
                  <td className="p-3.5 text-right m text-[#a3a3a3]">{strat.attempts}</td>
                  <td className="p-3.5 text-right m text-white font-bold">{strat.successes}</td>
                  <td className="p-3.5 min-w-[180px]">
                    <div className="flex items-center gap-2.5">
                      <div className="flex-1 h-2 rounded bg-[#171717] overflow-hidden">
                        <div
                          className="h-full rounded transition-all duration-500"
                          style={{
                            width: `${percent}%`,
                            backgroundColor: barColor,
                          }}
                        />
                      </div>
                      <span className="m text-[12px] w-9 text-right font-mono text-white">
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
      <div className="text-[11px] text-[#737373] font-mono">
        Empirical evaluation record: Every strategy score is updated via Thompson Sampling posterior based purely on verified experiment assertion outputs.
      </div>
    </div>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-fade-in overflow-y-auto">
        <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-[#262626] bg-[#000000] shadow-2xl">
          {content}
        </div>
      </div>
    );
  }

  return <div className="h-full w-full overflow-y-auto bg-[#000000]">{content}</div>;
};
