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

  const runA = DEMO_NODES.find((n) => n.id === 'run-a');
  const runB = DEMO_NODES.find((n) => n.id === 'run-b');
  const resA = DEMO_NODES.find((n) => n.id === 'result-a');
  const resB = DEMO_NODES.find((n) => n.id === 'result-b');

  // Derive changed parameters dynamically from the two run specs
  const paramA = (runA?.data?.parameter ?? {}) as Record<string, unknown>;
  const paramB = (runB?.data?.parameter ?? {}) as Record<string, unknown>;
  const changedParams = Object.keys({ ...paramA, ...paramB })
    .filter((k) => paramA[k] !== paramB[k])
    .map((k) => ({
      key: k,
      from: String(paramA[k] ?? 'unset'),
      to: String(paramB[k] ?? 'unset'),
    }));

  const rankA = resA?.data?.metrics?.rank_impurity_noise_20 ?? '—';
  const rankB = resB?.data?.metrics?.rank_permutation_noise_20 ?? '—';
  const criteriaA = resA?.data?.criteria ?? '';
  const criteriaB = resB?.data?.criteria ?? '';
  const rawVerdictA = resA?.data?.verdict as string | null | undefined;
  const rawVerdictB = resB?.data?.verdict as string | null | undefined;
  const verdictLabelA = rawVerdictA ? rawVerdictA.toUpperCase() : 'not yet evaluated';
  const verdictLabelB = rawVerdictB ? rawVerdictB.toUpperCase() : 'not yet evaluated';
  const delta = typeof rankA === 'number' && typeof rankB === 'number' ? rankB - rankA : null;

  const datasetNode = DEMO_NODES.find((n) => n.type === 'dataset');
  const sampleCount = typeof datasetNode?.data?.rows === 'number' ? datasetNode.data.rows : null;
  const featureCount = typeof datasetNode?.data?.features === 'number' ? datasetNode.data.features : null;
  const noiseCount = typeof datasetNode?.data?.noiseColumns === 'string'
    ? datasetNode.data.noiseColumns.split(',').filter(Boolean).length
    : null;
  const maxRank = featureCount != null && noiseCount != null ? featureCount + noiseCount : null;
  const barWidthA =
    typeof rankA === 'number' && maxRank
      ? `${Math.max(5, Math.min(100, Math.round((1 - (rankA - 1) / maxRank) * 100)))}%`
      : '50%';
  const barWidthB =
    typeof rankB === 'number' && maxRank
      ? `${Math.max(5, Math.min(100, Math.round((1 - (rankB - 1) / maxRank) * 100)))}%`
      : '50%';

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

      {/* Derived Changed Parameter Banner with Sharp Corners */}
      <div className="c px-5 py-3.5 flex items-center gap-4 flex-wrap bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none">
        <span className="badge-solid-white rounded-none">
          {changedParams.length} PARAMETER{changedParams.length === 1 ? '' : 'S'} CHANGED
        </span>
        {changedParams.length > 0 ? (
          changedParams.map((diff) => (
            <div key={diff.key} className="flex items-center gap-2.5">
              <span className="m text-[13px] text-[var(--text-primary)] font-semibold">{diff.key}</span>
              <span className="m text-[13px] text-[#f97316] font-semibold">{diff.from}</span>
              <ArrowRight className="h-4 w-4 text-[var(--text-dim)]" />
              <span className="m text-[13px] text-[var(--text-primary)] font-semibold">{diff.to}</span>
            </div>
          ))
        ) : (
          <span className="m text-[12px] text-[var(--text-dim)]">No parameter differences detected</span>
        )}
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
                {runA?.data?.mode ?? 'unspecified'}
              </span>
              <span className="badge-solid-white rounded-none uppercase">
                {verdictLabelA}
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
            <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-dim)] pt-1">
              <span>
                Dataset: {sampleCount != null ? `${sampleCount} samples` : 'unknown samples'} · {featureCount != null ? `${featureCount} base` : 'unknown base'} + {noiseCount != null ? `${noiseCount} noise` : 'unknown noise'}
              </span>
              <span>Method: {String(paramA.importance_method ?? 'unknown')}</span>
            </div>
          </div>

          {/* Assertion Footer */}
          <div className="border-t border-[var(--border-primary)] pt-3.5 text-[12px] flex justify-between gap-2 flex-wrap items-center mt-2 font-mono">
            <span className="text-[var(--text-dim)]">{criteriaA}</span>
            <span className="text-[#f97316] font-bold">Rank #{rankA} · {verdictLabelA}</span>
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
                {runB?.data?.mode ?? 'unspecified'}
              </span>
              <span className="badge-solid-white rounded-none uppercase">
                {verdictLabelB}
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
            <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-dim)] pt-1">
              <span>
                Dataset: {sampleCount != null ? `${sampleCount} samples` : 'unknown samples'} · {featureCount != null ? `${featureCount} base` : 'unknown base'} + {noiseCount != null ? `${noiseCount} noise` : 'unknown noise'}
              </span>
              <span>Method: {String(paramB.importance_method ?? 'unknown')}</span>
            </div>
          </div>

          {/* Assertion Footer */}
          <div className="border-t border-[var(--border-primary)] pt-3.5 text-[12px] flex justify-between gap-2 flex-wrap items-center mt-2 font-mono">
            <span className="text-[var(--text-dim)]">{criteriaB}</span>
            <span className="text-[var(--text-primary)] font-bold">Rank #{rankB} · {verdictLabelB}</span>
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
              Specification preview: The 20-category noise feature moves from Rank #{rankA} with Gini impurity to Rank #{rankB} with permutation{delta !== null ? ` (Δ = ${delta >= 0 ? `+${delta}` : delta} positions)` : ''}.
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
