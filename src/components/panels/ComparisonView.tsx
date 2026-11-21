import React from 'react';
import { X, GitBranch, ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';

interface ComparisonViewProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ComparisonView: React.FC<ComparisonViewProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-purple-500/10 p-2.5 text-purple-600 dark:text-purple-400">
              <GitBranch className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  What-If Comparison: Lineage Delta
                </h2>
                <span className="rounded-full bg-purple-100 dark:bg-purple-950 px-2.5 py-0.5 text-[10px] font-bold text-purple-800 dark:text-purple-300">
                  Run A ➔ Run B
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Single parameter variation test: verifying Strobl et al. (2007) proposed permutation remedy.
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

        {/* Comparison Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Single Parameter Variation Banner */}
          <div className="rounded-xl border border-purple-200/80 bg-purple-50/50 p-4 dark:border-purple-800/40 dark:bg-purple-950/20">
            <div className="text-xs font-bold text-purple-900 dark:text-purple-200 mb-1 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              Verified Invariant: Exactly One Parameter Modified
            </div>
            <div className="flex items-center gap-3 font-mono text-xs text-slate-800 dark:text-slate-200">
              <span className="rounded bg-rose-100 dark:bg-rose-950/60 px-2 py-1 text-rose-800 dark:text-rose-300">
                importance_method = &quot;impurity&quot;
              </span>
              <ArrowRight className="h-4 w-4 text-purple-500" />
              <span className="rounded bg-emerald-100 dark:bg-emerald-950/60 px-2 py-1 text-emerald-800 dark:text-emerald-300">
                importance_method = &quot;permutation&quot;
              </span>
            </div>
          </div>

          {/* Side by Side Run Cards */}
          <div className="grid grid-cols-2 gap-5">
            {/* Run A Column */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200/60 pb-2 dark:border-slate-800">
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    Run A (Baseline Impurity)
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">ID: run-1 · Mode: adapted</div>
                </div>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  MATCH
                </span>
              </div>

              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200/50 dark:border-slate-800">
                  <span className="text-slate-500">rank_impurity(noise_20):</span>
                  <span className="font-bold text-rose-600 dark:text-rose-400">Rank #1 (Highest)</span>
                </div>
                <div className="flex justify-between bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200/50 dark:border-slate-800">
                  <span className="text-slate-500">Noise in Top 5:</span>
                  <span className="font-bold text-rose-600 dark:text-rose-400">Yes (True)</span>
                </div>
                <div className="flex justify-between bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200/50 dark:border-slate-800">
                  <span className="text-slate-500">Criterion:</span>
                  <span className="text-slate-700 dark:text-slate-300">rank &lt;= 5</span>
                </div>
              </div>

              <p className="text-[11px] text-slate-600 dark:text-slate-400 italic">
                Impurity importance selects high-cardinality noise above genuine biological features. The paper&apos;s reported bias is reproduced.
              </p>
            </div>

            {/* Run B Column */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-4 dark:border-emerald-800/40 dark:bg-emerald-950/20 space-y-3">
              <div className="flex items-center justify-between border-b border-emerald-200/60 pb-2 dark:border-emerald-800/40">
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    Run B (Permutation What-If)
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">ID: run-2 · Mode: adapted</div>
                </div>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  MATCH
                </span>
              </div>

              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200/50 dark:border-slate-800">
                  <span className="text-slate-500">rank_permutation(noise_20):</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">Rank #29 (Bottom)</span>
                </div>
                <div className="flex justify-between bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200/50 dark:border-slate-800">
                  <span className="text-slate-500">Noise in Top 5:</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">No (False)</span>
                </div>
                <div className="flex justify-between bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200/50 dark:border-slate-800">
                  <span className="text-slate-500">Criterion:</span>
                  <span className="text-slate-700 dark:text-slate-300">rank &gt; 15</span>
                </div>
              </div>

              <p className="text-[11px] text-slate-600 dark:text-slate-400 italic">
                Permutation importance drops the uninformative noise variable to the bottom quartile (Rank 29 of 33). The proposed solution holds.
              </p>
            </div>
          </div>

          {/* Delta Conclusion */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-1 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Empirical Conclusion
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Delta is strictly attributable to the importance calculation algorithm. Gini impurity creates spurious split preference on high-cardinality noise, whereas permutation testing provides an unbiased, scale-invariant evaluation.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-slate-100 p-5 dark:border-slate-800">
          <button
            onClick={onClose}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 transition"
          >
            Close Comparison
          </button>
        </div>
      </div>
    </div>
  );
};
