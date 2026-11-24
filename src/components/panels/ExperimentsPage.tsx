import React from 'react';
import { Plus } from 'lucide-react';
import { HERO_EXPERIMENT_SPEC_RUN_A } from '../../../fixtures/hero-spec';

interface ExperimentsPageProps {
  onOpenApproval: () => void;
  onOpenCompare: () => void;
}

export const ExperimentsPage: React.FC<ExperimentsPageProps> = ({
  onOpenApproval,
  onOpenCompare,
}) => {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto animate-fade-in font-mono">
      {/* Top Action Bar */}
      <div className="flex justify-end">
        <button
          onClick={onOpenApproval}
          className="flex items-center gap-1.5 px-3 py-2 bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] transition shadow-md"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New experiment</span>
        </button>
      </div>

      {/* Grid 2: Experiment Plan & Execution Safety Boundary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Experiment Plan Card */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
              Experiment plan
            </div>
            <h2 className="text-base font-bold text-[var(--text-primary)] font-mono">
              Random Forest Variable Importance
            </h2>
            <p className="text-xs text-[var(--text-dim)] font-sans">
              Test whether impurity-based importance ranks high-cardinality synthetic noise features among the top predictors.
            </p>

            <div className="pt-2 border-t border-[var(--border-primary)] space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--text-dim)]">Dataset:</span>
                <strong className="text-[var(--text-primary)]">Breast-w + 3 noise columns</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-dim)]">Estimator:</span>
                <strong className="text-[var(--text-primary)]">
                  RandomForest · {Number(HERO_EXPERIMENT_SPEC_RUN_A.parameters.n_estimators || 100)} trees
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-dim)]">Reproduction mode:</span>
                <span className="badge-orange-outline !text-[8px] rounded-none uppercase">
                  {HERO_EXPERIMENT_SPEC_RUN_A.mode}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-dim)]">Execution target:</span>
                <strong className="text-[var(--text-primary)]">E2B isolated sandbox</strong>
              </div>
            </div>
          </div>

          <button
            onClick={onOpenApproval}
            className="w-full mt-4 py-2 bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] transition text-center"
          >
            Review plan & approve →
          </button>
        </div>

        {/* Execution Safety Boundary Card */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
          <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
            Execution safety boundary
          </div>

          <div className="space-y-2.5 text-xs pt-1">
            <div className="flex justify-between items-center border-b border-[var(--border-primary)] pb-2">
              <span className="text-[var(--text-dim)]">Network access:</span>
              <span className="badge-solid-white !text-[8px] rounded-none uppercase">
                {HERO_EXPERIMENT_SPEC_RUN_A.network === 'none' ? 'DISABLED' : HERO_EXPERIMENT_SPEC_RUN_A.network}
              </span>
            </div>
            <div className="flex justify-between items-center border-b border-[var(--border-primary)] pb-2">
              <span className="text-[var(--text-dim)]">Memory limit:</span>
              <strong className="text-[var(--text-primary)]">{HERO_EXPERIMENT_SPEC_RUN_A.memoryMb} MB</strong>
            </div>
            <div className="flex justify-between items-center border-b border-[var(--border-primary)] pb-2">
              <span className="text-[var(--text-dim)]">Timeout:</span>
              <strong className="text-[var(--text-primary)]">{HERO_EXPERIMENT_SPEC_RUN_A.timeoutSeconds} seconds</strong>
            </div>
            <div className="flex justify-between items-center border-b border-[var(--border-primary)] pb-2">
              <span className="text-[var(--text-dim)]">Dataset:</span>
              <strong className="text-[var(--text-primary)] font-mono">
                {HERO_EXPERIMENT_SPEC_RUN_A.datasets[0]?.name || 'breast-w'} ({HERO_EXPERIMENT_SPEC_RUN_A.mode})
              </strong>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[var(--text-dim)]">Human approval:</span>
              <strong className="text-[#f97316]">REQUIRED</strong>
            </div>
          </div>

          <p className="text-[11px] text-[var(--text-dim)] pt-2 border-t border-[var(--border-primary)] font-sans leading-relaxed">
            Every experiment is configured for an isolated ephemeral microVM. Datasets and dependencies are specified deterministically before execution.
          </p>
        </div>
      </div>

      {/* Recent Experiment Runs Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
            EXPERIMENT SPECIFICATIONS &amp; RUN TEMPLATES (PREVIEW)
          </div>
          <span className="badge-orange-outline !text-[8px] rounded-none">PREVIEW</span>
        </div>
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border-primary)] text-[10px] text-[var(--text-dim)] uppercase tracking-wider">
                <th className="p-3">RUN</th>
                <th className="p-3">METHOD</th>
                <th className="p-3">MODE</th>
                <th className="p-3">CRITERIA</th>
                <th className="p-3">STATUS</th>
                <th className="p-3 text-right">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-primary)]">
              <tr className="hover:bg-[var(--bg-surface-hover)]">
                <td className="p-3 font-semibold text-[var(--text-primary)]">Run A · root</td>
                <td className="p-3 text-[var(--text-muted)]">Impurity importance</td>
                <td className="p-3">
                  <span className="badge-orange-outline !text-[8px] rounded-none">ADAPTED</span>
                </td>
                <td className="p-3 font-mono text-[11px] text-[var(--text-dim)]">rank_impurity(noise_20) &le; 5</td>
                <td className="p-3">
                  <span className="badge-solid-white !text-[8px] rounded-none">SPECIFICATION</span>
                </td>
                <td className="p-3 text-right">
                  <button
                    onClick={onOpenCompare}
                    className="px-2.5 py-1 border border-[var(--border-primary)] hover:border-[#f97316] hover:text-[#f97316] transition text-[11px]"
                  >
                    Compare
                  </button>
                </td>
              </tr>
              <tr className="hover:bg-[var(--bg-surface-hover)]">
                <td className="p-3 font-semibold text-[var(--text-primary)]">Run B · what-if</td>
                <td className="p-3 text-[var(--text-muted)]">Permutation importance</td>
                <td className="p-3">
                  <span className="badge-orange-outline !text-[8px] rounded-none">ADAPTED</span>
                </td>
                <td className="p-3 font-mono text-[11px] text-[var(--text-dim)]">rank_permutation(noise_20) &gt; 15</td>
                <td className="p-3">
                  <span className="badge-solid-white !text-[8px] rounded-none">SPECIFICATION</span>
                </td>
                <td className="p-3 text-right">
                  <button
                    onClick={onOpenCompare}
                    className="px-2.5 py-1 border border-[var(--border-primary)] hover:border-[#f97316] hover:text-[#f97316] transition text-[11px]"
                  >
                    Compare
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};