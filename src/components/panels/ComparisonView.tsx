import React from 'react';
import { X } from 'lucide-react';

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
    <div className="w-full max-w-[1200px] mx-auto p-6 flex flex-col gap-5 text-[#E6EAF0]">
      {/* Title Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="l">Compare runs</div>
          <div className="text-[22px] font-semibold mt-1.5 leading-snug text-[#E6EAF0]">
            Gini importance is biased toward high-cardinality features; permutation importance is not.
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

      {/* 1 Parameter Changed Banner */}
      <div className="c px-5 py-3.5 flex items-center gap-4 flex-wrap">
        <span className="l">1 parameter changed</span>
        <span className="m text-[14px] text-[#E6EAF0]">importance_method</span>
        <span className="m text-[14px] text-[#F5A524]">impurity</span>
        <span className="text-[#9AA4B2]">→</span>
        <span className="m text-[14px] text-[#3DD6B5]">permutation</span>
      </div>

      {/* Side-by-Side Run Cards */}
      <div className="flex gap-5 flex-wrap">
        {/* Run A · Root */}
        <div className="c flex-1 min-w-[320px] p-6 flex flex-col gap-4.5 bg-[#161B22]">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <div>
              <div className="l">Run A · root</div>
              <div className="text-[20px] font-semibold mt-1 text-[#E6EAF0]">
                Impurity importance
              </div>
            </div>
            <div className="flex gap-2">
              <span className="b text-[#F5A524] border-[#F5A524]/40 bg-[#F5A524]/10">
                adapted
              </span>
              <span className="b text-[#3DD6B5] border-[#3DD6B5]/40 bg-[#3DD6B5]/10">
                match
              </span>
            </div>
          </div>

          <div className="l">Feature rank · lower # = more important</div>

          {/* Feature rank bars */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="m text-[12px] text-[#F5A524] w-20">noise_20</span>
              <div className="flex-1 h-2.5 rounded-full bg-[#252C36] overflow-hidden">
                <div className="h-full bg-[#F5A524] rounded-full" style={{ width: '97%' }} />
              </div>
              <span className="m text-[12px] text-[#E6EAF0] w-9 text-right font-medium">#2</span>
            </div>

            <div className="flex items-center gap-3">
              <span className="m text-[12px] text-[#E6EAF0] w-20">noise_5</span>
              <div className="flex-1 h-2.5 rounded-full bg-[#252C36] overflow-hidden">
                <div className="h-full bg-[#8B97A8] rounded-full" style={{ width: '70%' }} />
              </div>
              <span className="m text-[12px] text-[#E6EAF0] w-9 text-right font-medium">#11</span>
            </div>

            <div className="flex items-center gap-3">
              <span className="m text-[12px] text-[#E6EAF0] w-20">noise_2</span>
              <div className="flex-1 h-2.5 rounded-full bg-[#252C36] overflow-hidden">
                <div className="h-full bg-[#8B97A8] rounded-full" style={{ width: '30%' }} />
              </div>
              <span className="m text-[12px] text-[#E6EAF0] w-9 text-right font-medium">#24</span>
            </div>
          </div>

          {/* Assertion Footer */}
          <div className="border-t border-[#252C36] pt-3.5 text-[13px] flex justify-between gap-2 flex-wrap items-center mt-2">
            <span className="m text-[#9AA4B2]">rank_impurity(noise_20) ≤ 5</span>
            <span className="m text-[#3DD6B5] font-semibold">2 · pass</span>
          </div>
        </div>

        {/* Run B · What-If Child */}
        <div className="c flex-1 min-w-[320px] p-6 flex flex-col gap-4.5 bg-[#161B22]">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <div>
              <div className="l">Run B · what-if child of A</div>
              <div className="text-[20px] font-semibold mt-1 text-[#E6EAF0]">
                Permutation importance
              </div>
            </div>
            <div className="flex gap-2">
              <span className="b text-[#F5A524] border-[#F5A524]/40 bg-[#F5A524]/10">
                adapted
              </span>
              <span className="b text-[#3DD6B5] border-[#3DD6B5]/40 bg-[#3DD6B5]/10">
                match
              </span>
            </div>
          </div>

          <div className="l">Feature rank · lower # = more important</div>

          {/* Feature rank bars */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="m text-[12px] text-[#3DD6B5] w-20">noise_20</span>
              <div className="flex-1 h-2.5 rounded-full bg-[#252C36] overflow-hidden">
                <div className="h-full bg-[#3DD6B5] rounded-full" style={{ width: '15%' }} />
              </div>
              <span className="m text-[12px] text-[#E6EAF0] w-9 text-right font-medium">#29</span>
            </div>

            <div className="flex items-center gap-3">
              <span className="m text-[12px] text-[#E6EAF0] w-20">noise_5</span>
              <div className="flex-1 h-2.5 rounded-full bg-[#252C36] overflow-hidden">
                <div className="h-full bg-[#8B97A8] rounded-full" style={{ width: '9%' }} />
              </div>
              <span className="m text-[12px] text-[#E6EAF0] w-9 text-right font-medium">#31</span>
            </div>

            <div className="flex items-center gap-3">
              <span className="m text-[12px] text-[#E6EAF0] w-20">noise_2</span>
              <div className="flex-1 h-2.5 rounded-full bg-[#252C36] overflow-hidden">
                <div className="h-full bg-[#8B97A8] rounded-full" style={{ width: '3%' }} />
              </div>
              <span className="m text-[12px] text-[#E6EAF0] w-9 text-right font-medium">#33</span>
            </div>
          </div>

          {/* Assertion Footer */}
          <div className="border-t border-[#252C36] pt-3.5 text-[13px] flex justify-between gap-2 flex-wrap items-center mt-2">
            <span className="m text-[#9AA4B2]">rank_permutation(noise_20) &gt; 15</span>
            <span className="m text-[#3DD6B5] font-semibold">29 · pass</span>
          </div>
        </div>
      </div>

      {/* Post-hoc Explanation Box */}
      <div className="c px-5 py-4 flex flex-col gap-2">
        <div className="l">Explanation · written after the verdict, cannot change it</div>
        <div className="text-[14px] leading-relaxed text-[#9AA4B2]">
          When features vary in cardinality, Gini splits favor those with many splits by chance. Permutation importance breaks the relationship with y, showing noise_20 has zero genuine signal.
        </div>
      </div>

      {/* Disclaimer Subtext */}
      <div className="text-[12px] leading-relaxed text-[#9AA4B2] max-w-[760px]">
        Adapted run: the paper’s method on our data subset and library versions. A mismatch would say our adaptation did not land where the paper did, not that the paper is wrong.
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
