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
    <div className="w-full max-w-[1200px] mx-auto p-6 flex flex-col gap-5 text-[#E6EAF0]">
      {/* Title Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="l">Agent strategies</div>
          <div className="text-[22px] font-semibold mt-1.5 text-[#E6EAF0]">
            Which strategy is winning, by verified outcomes only
          </div>
        </div>
        {isModal && onClose && (
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[#9AA4B2] hover:text-[#E6EAF0] hover:bg-[#161B22] transition"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="flex gap-4 flex-wrap">
        <div className="c flex-1 min-w-[200px] p-5 bg-[#161B22]">
          <div className="l">Tasks recorded</div>
          <div className="text-[32px] font-semibold mt-2 text-[#E6EAF0]">29</div>
        </div>

        <div className="c flex-1 min-w-[200px] p-5 bg-[#161B22]">
          <div className="l">Total cost</div>
          <div className="text-[32px] font-semibold mt-2 text-[#E6EAF0]">$0.04</div>
        </div>

        <div className="c flex-1 min-w-[200px] p-5 bg-[#161B22]">
          <div className="l">Median latency</div>
          <div className="text-[32px] font-semibold mt-2 text-[#E6EAF0]">2.1 s</div>
        </div>
      </div>

      {/* Leaderboard Table */}
      <div className="c overflow-x-auto bg-[#161B22]">
        <table className="w-full border-collapse text-[13px] min-w-[640px]">
          <thead>
            <tr className="l border-b border-[#252C36]">
              <th className="text-left p-3.5 font-medium">Task kind</th>
              <th className="text-left p-3.5 font-medium">Strategy</th>
              <th className="text-right p-3.5 font-medium">Tries</th>
              <th className="text-right p-3.5 font-medium">Wins</th>
              <th className="text-left p-3.5 font-medium">Smoothed score</th>
            </tr>
          </thead>
          <tbody>
            {DEMO_STRATEGIES.map((strat) => {
              const isPreferred = Boolean(strat.preferred);
              const barColor = isPreferred ? '#3DD6B5' : '#8B97A8';
              const percent = Math.round(strat.score * 100);

              return (
                <tr key={strat.id} className="border-t border-[#252C36] hover:bg-[#252C36]/30 transition">
                  <td className="p-3.5 m text-[#E6EAF0]">{strat.taskKind}</td>
                  <td className="p-3.5 text-[#E6EAF0]">
                    <span>{strat.name}</span>
                    {isPreferred && (
                      <span className="b text-[#3DD6B5] border-[#3DD6B5]/40 ml-2">
                        preferred
                      </span>
                    )}
                  </td>
                  <td className="p-3.5 text-right m text-[#E6EAF0]">{strat.attempts}</td>
                  <td className="p-3.5 text-right m text-[#E6EAF0]">{strat.successes}</td>
                  <td className="p-3.5 min-w-[180px]">
                    <div className="flex items-center gap-2.5">
                      <div className="flex-1 h-2 rounded-full bg-[#252C36] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${percent}%`,
                            backgroundColor: barColor,
                          }}
                        />
                      </div>
                      <span className="m text-[12px] w-9 text-right text-[#E6EAF0]">
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
      <div className="text-[12px] text-[#9AA4B2]">
        Illustrative values. In the product every figure is a GROUP BY over recorded task rows.
      </div>
    </div>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in overflow-y-auto">
        <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-[#252C36] bg-[#0E1116] shadow-2xl">
          {content}
        </div>
      </div>
    );
  }

  return <div className="h-full w-full overflow-y-auto bg-[#0E1116]">{content}</div>;
};
