import React from 'react';
import { ArrowRight, CheckCircle2, FileText, ShieldCheck } from 'lucide-react';
import { DEMO_SOURCES, DEMO_NODES } from '../../data/demoWorkspace';

interface OverviewPageProps {
  onOpenGraph: () => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({ onOpenGraph }) => {
  const sourceCount = String(DEMO_SOURCES.length).padStart(2, '0');
  const claimCount = String(DEMO_NODES.filter((n) => n.type === 'claim').length).padStart(2, '0');
  const runCount = String(DEMO_NODES.filter((n) => n.type === 'run').length).padStart(2, '0');

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto animate-fade-in font-mono">
      {/* 3 KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
            RESEARCH SOURCES
          </div>
          <div className="text-3xl font-extrabold text-[var(--text-primary)] my-2">
            {sourceCount}
          </div>
          <div className="text-[11px] text-[var(--text-dim)]">
            Configured in workspace
          </div>
        </div>

        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
            EVIDENCE-BACKED CLAIMS
          </div>
          <div className="text-3xl font-extrabold text-[#f97316] my-2">
            {claimCount}
          </div>
          <div className="text-[11px] text-[var(--text-dim)]">
            Evidence-grounded claims
          </div>
        </div>

        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
            EXPERIMENT RUNS
          </div>
          <div className="text-3xl font-extrabold text-[var(--text-primary)] my-2">
            {runCount}
          </div>
          <div className="text-[11px] text-[var(--text-dim)]">
            Adapted reproduction mode
          </div>
        </div>
      </div>

      {/* Grid 2: Workspace Activity & Research Question */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Workspace Activity Timeline */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
          <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
            Workspace activity
          </div>
          <div className="space-y-3 pt-1">
            <div className="flex items-start gap-3 border-b border-[var(--border-primary)] pb-3">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 mt-1 shadow-[0_0_8px_#34d399]" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[var(--text-primary)] font-semibold">
                  Evidence edge linked
                </div>
                <div className="text-[11px] text-[var(--text-dim)]">
                  Strobl et al. 2007 supports Gini bias claim
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">
                INDEXED
              </span>
            </div>

            <div className="flex items-start gap-3 border-b border-[var(--border-primary)] pb-3">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 mt-1" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[var(--text-primary)] font-semibold">
                  Experiment plan configured
                </div>
                <div className="text-[11px] text-[var(--text-dim)]">
                  Permutation importance · adapted specification
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">
                SPEC
              </span>
            </div>

            <div className="flex items-start gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-[#f97316] mt-1" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[var(--text-primary)] font-semibold">
                  Three sources configured
                </div>
                <div className="text-[11px] text-[var(--text-dim)]">
                  PDF extraction and chunking specification
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">
                SEEDED
              </span>
            </div>
          </div>
        </div>

        {/* Research Question Card */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
              Research question
            </div>
            <h2 className="text-base font-bold text-[var(--text-primary)] leading-snug">
              Does impurity-based feature importance overvalue high-cardinality noise features?
            </h2>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed font-sans">
              The workspace investigates a core reproducibility claim from the random forest literature (Strobl et al. 2007) and compares standard Gini impurity importance against permutation importance on an augmented OpenML benchmark.
            </p>
          </div>

          <button
            onClick={onOpenGraph}
            className="flex items-center justify-center gap-2 w-full py-2.5 bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] transition shadow-md mt-2"
          >
            <span>Open research graph</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Recent Artifacts Table */}
      <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
        <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
          Recent artifacts
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border-primary)] text-[10px] text-[var(--text-dim)] uppercase tracking-wider">
                <th className="pb-2">ARTIFACT</th>
                <th className="pb-2">TYPE</th>
                <th className="pb-2">STATUS</th>
                <th className="pb-2 text-right">UPDATED</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-primary)]">
              <tr className="hover:bg-[var(--bg-surface-hover)]">
                <td className="py-3 font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-sky-400" />
                  <span>Strobl et al. 2007</span>
                </td>
                <td className="py-3 text-[var(--text-muted)]">Source Paper</td>
                <td className="py-3">
                  <span className="badge-solid-white !text-[8px] rounded-none">
                    INDEXED
                  </span>
                </td>
                <td className="py-3 text-right text-[var(--text-dim)]">Today</td>
              </tr>
              <tr className="hover:bg-[var(--bg-surface-hover)]">
                <td className="py-3 font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#f97316]" />
                  <span>Gini importance bias</span>
                </td>
                <td className="py-3 text-[var(--text-muted)]">Claim</td>
                <td className="py-3">
                  <span className="badge-orange-outline !text-[8px] rounded-none">
                    PROPOSED
                  </span>
                </td>
                <td className="py-3 text-right text-[var(--text-dim)]">Today</td>
              </tr>
              <tr className="hover:bg-[var(--bg-surface-hover)]">
                <td className="py-3 font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Run B — permutation</span>
                </td>
                <td className="py-3 text-[var(--text-muted)]">Experiment Run</td>
                <td className="py-3">
                  <span className="border border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-dim)] text-[8px] px-1.5 py-0.5">
                    SPEC
                  </span>
                </td>
                <td className="py-3 text-right text-[var(--text-dim)]">Template</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};