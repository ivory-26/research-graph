import React from 'react';
import { HERO_PYTHON_SCRIPT } from '../../data/demoWorkspace';
import { ShieldCheck, Cpu, HardDrive, WifiOff, CheckCircle2, X } from 'lucide-react';

interface ApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
}

export const ApprovalModal: React.FC<ApprovalModalProps> = ({
  isOpen,
  onClose,
  onApprove,
  onReject,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-amber-500/10 p-2.5 text-amber-600 dark:text-amber-400">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Human Approval Gate: Experiment Plan
                </h2>
                <span className="rounded-full bg-cyan-100 dark:bg-cyan-950 px-2.5 py-0.5 text-[10px] font-bold uppercase text-cyan-800 dark:text-cyan-300">
                  Stage 5: AWAIT_APPROVAL
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Inspect generated Python script and resource boundary before dispatching to E2B sandbox.
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

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Resource & Isolation Boundary Cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-800/40 dark:bg-emerald-950/20">
              <WifiOff className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <div>
                <div className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400">
                  Network Security
                </div>
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  network: &apos;none&apos; (Strict)
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-800/40">
              <Cpu className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">
                  CPU Allocation
                </div>
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  1 Core · 60s timeout
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-800/40">
              <HardDrive className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">
                  Memory Ceiling
                </div>
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  2048 MB Limit
                </div>
              </div>
            </div>
          </div>

          {/* Dataset SHA-256 Pin Verification */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-950/40 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Pinned Dataset: breast-w.arff (OpenML 52350)
              </span>
              <span className="rounded bg-emerald-100 dark:bg-emerald-950 px-2 py-0.5 text-[10px] font-mono text-emerald-800 dark:text-emerald-300">
                19.4 KB · Verified Hash Match
              </span>
            </div>
            <div className="font-mono text-[10px] text-slate-500 truncate">
              SHA256: 7f83b1657ff185023908bf287cba6848419f44
            </div>
          </div>

          {/* Generated Code Window */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
              <span>Executable Spec: main.py</span>
              <span className="text-[10px] text-slate-400">Writes to /output/metrics.json</span>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-slate-950 p-4 font-mono text-[11px] leading-relaxed text-slate-200 dark:border-slate-800">
              <pre>{HERO_PYTHON_SCRIPT}</pre>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-100 p-5 dark:border-slate-800">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Approval state is stored synchronously in Postgres.
          </div>
          <div className="flex gap-3">
            <button
              onClick={onReject}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition"
            >
              Reject Plan
            </button>
            <button
              onClick={onApprove}
              className="flex items-center gap-2 rounded-xl bg-cyan-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-cyan-600/20 hover:bg-cyan-700 transition"
            >
              <CheckCircle2 className="h-4 w-4" />
              Approve &amp; Dispatch to E2B
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
