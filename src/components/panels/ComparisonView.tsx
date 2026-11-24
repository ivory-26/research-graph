import React from 'react';
import { X, ArrowRight, CheckCircle2 } from 'lucide-react';
import { DEMO_NODES } from '../../data/demoWorkspace';

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

  const resA = DEMO_NODES.find((n) => n.id === 'result-a');
  const resB = DEMO_NODES.find((n) => n.id === 'result-b');

  const rankA = resA?.data?.metrics?.rank_impurity_noise_20 ?? '—';
  const rankB = resB?.data?.metrics?.rank_permutation_noise_20 ?? '—';
  const criteriaA = resA?.data?.criteria ?? '';
  const criteriaB = resB?.data?.criteria ?? '';
  const verdictA = (resA?.data?.verdict as string) || 'preview';
  const verdictB = (resB?.data?.verdict as string) || 'preview';
  const delta = typeof rankA === 'number' && typeof rankB === 'number' ? rankB - rankA : null;

  const datasetNode = DEMO_NODES.find((n) => n.type === 'dataset');
  const maxRank = ((datasetNode?.data?.features as number) || 30) + 3;
  const barWidthA = typeof rankA === 'number' ? `${Math.max(5, Math.min(100, Math.round((1 - (rankA - 1) / maxRank) * 100)))}%` : '50%';
  const barWidthB = typeof rankB === 'number' ? `${Math.max(5, Math.min(100, Math.round((1 - (rankB - 1) / maxRank) * 100)))}%` : '50%';

  const content = (
    <div className="w-full max-w-[1200px] mx-auto p-6 flex flex-col gap-5 text-[var(--text-secondary)]">
      {/* Title Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="l">Run A vs Run B · Differential Analysis</div>
            <span className="badge-orange-outline !text-[8px] rounded-none">FIXTURE PREVIEW</span>
          </div>
          <div className="text-[22px] font-bold mt-1 leading-snug text-[var(--text-primary)] font-mono tracking-tight">
            Gini importance is biased toward high-cardinality features; permutation importance is not.
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

      {/* 1 Parameter Changed Banner with Sharp Corners */}
      <div className="c px-5 py-3.5 flex items-center gap-4 flex-wrap bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none">
        <span className="badge-solid-white rounded-none">1 PARAMETER CHANGED</span>
        <span className="m text-[13px] text-[var(--text-primary)] font-semibold">importance_method</span>
        <span className="m text-[13px] text-[#f97316] font-semibold">impurity</span>
        <ArrowRight className="h-4 w-4 text-[var(--text-dim)]" />
        <span className="m text-[13px] text-[var(--text-primary)] font-semibold">permutation</span>
      </div>

      {/* Side-by-Side Run Cards with Sharp Corners */}
      <div className="flex gap-5 flex-wrap">
        {/* Run A · Root */}
        <div className="c flex-1 min-w-[320px] p-6 flex flex-col gap-4 bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <div>
              <div className="l">Run A · root</div>
              <div className="text-[19px] font-bold mt-1 text-[var(--text-primary)] font-mono">
                Impurity importance
              </div>
            </div>
            <div className="flex gap-2">
              <span className="badge-orange-outline rounded-none">
                adapted
              </span>
              <span className="badge-solid-white rounded-none uppercase">
                {verdictA}
              </span>
            </div>
          </div>

          <div className="l text-[9px]">Target feature rank specification</div>

          {/* Feature rank bars with Sharp 0px Corners */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="m text-[12px] text-[#f97316] w-20 font-semibold">noise_20</span>
              <div className="flex-1 h-2 rounded-none bg-[var(--border-primary)] overflow-hidden">
                <div className="h-full bg-[#f97316] rounded-none" style={{ width: barWidthA }} />
              </div>
              <span className="m text-[12px] text-[#f97316] w-9 text-right font-bold">#{rankA}</span>
            </div>
          </div>

          {/* Assertion Footer */}
          <div className="border-t border-[var(--border-primary)] pt-3.5 text-[12px] flex justify-between gap-2 flex-wrap items-center mt-2 font-mono">
            <span className="text-[var(--text-dim)]">{criteriaA}</span>
            <span className="text-[#f97316] font-bold">Rank #{rankA} · {verdictA.toUpperCase()}</span>
          </div>
        </div>

        {/* Run B · What-If Child */}
        <div className="c flex-1 min-w-[320px] p-6 flex flex-col gap-4 bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <div>
              <div className="l">Run B · what-if child of A</div>
              <div className="text-[19px] font-bold mt-1 text-[var(--text-primary)] font-mono">
                Permutation importance
              </div>
            </div>
            <div className="flex gap-2">
              <span className="badge-orange-outline rounded-none">
                adapted
              </span>
              <span className="badge-solid-white rounded-none uppercase">
                {verdictB}
              </span>
            </div>
          </div>

          <div className="l text-[9px]">Target feature rank specification</div>

          {/* Feature rank bars with Sharp 0px Corners */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="m text-[12px] text-[var(--text-primary)] w-20 font-semibold">noise_20</span>
              <div className="flex-1 h-2 rounded-none bg-[var(--border-primary)] overflow-hidden">
                <div className="h-full bg-[var(--text-primary)] rounded-none" style={{ width: barWidthB }} />
              </div>
              <span className="m text-[12px] text-[var(--text-primary)] w-9 text-right font-bold">#{rankB}</span>
            </div>
          </div>

          {/* Assertion Footer */}
          <div className="border-t border-[var(--border-primary)] pt-3.5 text-[12px] flex justify-between gap-2 flex-wrap items-center mt-2 font-mono">
            <span className="text-[var(--text-dim)]">{criteriaB}</span>
            <span className="text-[var(--text-primary)] font-bold">Rank #{rankB} · {verdictB.toUpperCase()}</span>
          </div>
        </div>
      </div>

      {/* Delta Verdict Card with Sharp Corners */}
      <div className="c p-5 bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-none bg-[#f97316]/10 border border-[#f97316]/40 text-[#f97316]">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[14px] font-bold text-[var(--text-primary)] font-mono">
              Hypothesis Specification & Fixture Preview
            </div>
            <div className="text-xs text-[var(--text-dim)] mt-0.5 font-mono">
              Specification preview: Replacing Gini impurity with permutation drops 20-category noise feature from Rank #{rankA} to Rank #{rankB}{delta !== null ? ` (Δ = +${delta} positions)` : ''}.
            </div>
          </div>
        </div>
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
