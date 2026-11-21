import React from 'react';
import { X, ArrowRight, CheckCircle2 } from 'lucide-react';

interface ComparisonViewProps {
  isModal?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

export const ComparisonView: React.FC<ComparisonViewProps> = ({
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
          <div className="l">Run A vs Run B · Differential Analysis</div>
          <div className="text-[22px] font-bold mt-1.5 leading-snug text-white font-mono tracking-tight">
            Gini importance is biased toward high-cardinality features; permutation importance is not.
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

      {/* 1 Parameter Changed Banner */}
      <div className="c px-5 py-3.5 flex items-center gap-4 flex-wrap bg-[#0a0a0a] border border-[#262626]">
        <span className="badge-solid-white">1 PARAMETER CHANGED</span>
        <span className="m text-[13px] text-white font-semibold">importance_method</span>
        <span className="m text-[13px] text-[#f97316] font-semibold">impurity</span>
        <ArrowRight className="h-4 w-4 text-[#737373]" />
        <span className="m text-[13px] text-white font-semibold">permutation</span>
      </div>

      {/* Side-by-Side Run Cards */}
      <div className="flex gap-5 flex-wrap">
        {/* Run A · Root */}
        <div className="c flex-1 min-w-[320px] p-6 flex flex-col gap-4 bg-[#0a0a0a] border border-[#262626]">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <div>
              <div className="l">Run A · root</div>
              <div className="text-[19px] font-bold mt-1 text-white font-mono">
                Impurity importance
              </div>
            </div>
            <div className="flex gap-2">
              <span className="badge-orange-outline">
                adapted
              </span>
              <span className="badge-solid-white">
                match
              </span>
            </div>
          </div>

          <div className="l text-[9px]">Feature rank · lower # = more important</div>

          {/* Feature rank bars */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="m text-[12px] text-[#f97316] w-20 font-semibold">noise_20</span>
              <div className="flex-1 h-2 rounded bg-[#171717] overflow-hidden">
                <div className="h-full bg-[#f97316] rounded" style={{ width: '97%' }} />
              </div>
              <span className="m text-[12px] text-[#f97316] w-9 text-right font-bold">#2</span>
            </div>

            <div className="flex items-center gap-3">
              <span className="m text-[12px] text-[#a3a3a3] w-20">noise_5</span>
              <div className="flex-1 h-2 rounded bg-[#171717] overflow-hidden">
                <div className="h-full bg-[#404040] rounded" style={{ width: '70%' }} />
              </div>
              <span className="m text-[12px] text-white w-9 text-right font-medium">#11</span>
            </div>

            <div className="flex items-center gap-3">
              <span className="m text-[12px] text-[#a3a3a3] w-20">noise_2</span>
              <div className="flex-1 h-2 rounded bg-[#171717] overflow-hidden">
                <div className="h-full bg-[#404040] rounded" style={{ width: '30%' }} />
              </div>
              <span className="m text-[12px] text-white w-9 text-right font-medium">#24</span>
            </div>
          </div>

          {/* Assertion Footer */}
          <div className="border-t border-[#262626] pt-3.5 text-[12px] flex justify-between gap-2 flex-wrap items-center mt-2 font-mono">
            <span className="text-[#737373]">rank_impurity(noise_20) ≤ 5</span>
            <span className="text-[#f97316] font-bold">2 · PASS</span>
          </div>
        </div>

        {/* Run B · What-If Child */}
        <div className="c flex-1 min-w-[320px] p-6 flex flex-col gap-4 bg-[#0a0a0a] border border-[#262626]">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <div>
              <div className="l">Run B · what-if child of A</div>
              <div className="text-[19px] font-bold mt-1 text-white font-mono">
                Permutation importance
              </div>
            </div>
            <div className="flex gap-2">
              <span className="badge-orange-outline">
                adapted
              </span>
              <span className="badge-solid-white">
                match
              </span>
            </div>
          </div>

          <div className="l text-[9px]">Feature rank · lower # = more important</div>

          {/* Feature rank bars */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="m text-[12px] text-white w-20 font-semibold">noise_20</span>
              <div className="flex-1 h-2 rounded bg-[#171717] overflow-hidden">
                <div className="h-full bg-white rounded" style={{ width: '15%' }} />
              </div>
              <span className="m text-[12px] text-white w-9 text-right font-bold">#29</span>
            </div>

            <div className="flex items-center gap-3">
              <span className="m text-[12px] text-[#a3a3a3] w-20">noise_5</span>
              <div className="flex-1 h-2 rounded bg-[#171717] overflow-hidden">
                <div className="h-full bg-[#404040] rounded" style={{ width: '9%' }} />
              </div>
              <span className="m text-[12px] text-white w-9 text-right font-medium">#31</span>
            </div>

            <div className="flex items-center gap-3">
              <span className="m text-[12px] text-[#a3a3a3] w-20">noise_2</span>
              <div className="flex-1 h-2 rounded bg-[#171717] overflow-hidden">
                <div className="h-full bg-[#404040] rounded" style={{ width: '3%' }} />
              </div>
              <span className="m text-[12px] text-white w-9 text-right font-medium">#33</span>
            </div>
          </div>

          {/* Assertion Footer */}
          <div className="border-t border-[#262626] pt-3.5 text-[12px] flex justify-between gap-2 flex-wrap items-center mt-2 font-mono">
            <span className="text-[#737373]">rank_permutation(noise_20) &gt; 15</span>
            <span className="text-white font-bold">29 · PASS</span>
          </div>
        </div>
      </div>

      {/* Delta Verdict Card */}
      <div className="c p-5 bg-[#0a0a0a] border border-[#262626]">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-[#f97316]/10 border border-[#f97316]/40 text-[#f97316]">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[14px] font-bold text-white font-mono">
              Hypothesis Deterministically Verified by E2B Runtime
            </div>
            <div className="text-xs text-[#737373] mt-0.5 font-mono">
              Replacing Gini impurity with permutation drops 20-category synthetic noise feature from Rank #2 to Rank #29 (Δ = +27 positions).
            </div>
          </div>
        </div>
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
