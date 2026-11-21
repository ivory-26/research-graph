import React from 'react';
import { HERO_PYTHON_SCRIPT } from '../../data/demoWorkspace';
import { ShieldCheck, Cpu, HardDrive, WifiOff, X } from 'lucide-react';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-fade-in">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-[#262626] bg-[#000000] text-[#e5e5e5] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#262626] p-5">
          <div className="flex items-center gap-3">
            <div className="rounded bg-[#f97316]/10 p-2 text-[#f97316] border border-[#f97316]/30">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white font-mono uppercase tracking-tight">
                  Human Approval Gate: Experiment Plan
                </h2>
                <span className="badge-orange-outline">
                  AWAIT_APPROVAL
                </span>
              </div>
              <p className="text-xs text-[#737373] mt-0.5 font-mono">
                Inspect generated Python script and resource sandbox boundary before dispatching to E2B.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-[#737373] hover:text-white hover:bg-[#171717] transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Resource & Isolation Boundary Cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="c p-3 flex items-center gap-3 bg-[#0a0a0a] border border-[#262626]">
              <WifiOff className="h-5 w-5 text-[#f97316]" />
              <div>
                <div className="l text-[9px] text-[#f97316]">
                  Network Policy
                </div>
                <div className="m text-xs font-bold text-white">
                  none (isolated)
                </div>
              </div>
            </div>

            <div className="c p-3 flex items-center gap-3 bg-[#0a0a0a] border border-[#262626]">
              <Cpu className="h-5 w-5 text-white" />
              <div>
                <div className="l text-[9px]">
                  Compute Limit
                </div>
                <div className="m text-xs font-bold text-white">
                  1 vCPU · 2GB RAM
                </div>
              </div>
            </div>

            <div className="c p-3 flex items-center gap-3 bg-[#0a0a0a] border border-[#262626]">
              <HardDrive className="h-5 w-5 text-white" />
              <div>
                <div className="l text-[9px]">
                  Storage Pinned
                </div>
                <div className="m text-xs font-bold text-white">
                  SHA-256 match
                </div>
              </div>
            </div>
          </div>

          {/* Dataset Lock & Spec */}
          <div className="c p-4 bg-[#0a0a0a] border border-[#262626] text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="l">Dataset Reference:</span>
              <span className="m text-white font-bold">openml:52350 (breast-w)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="l">Dataset SHA-256:</span>
              <span className="m text-[#f97316]">7f83b1657ff185023908bf287cba6848419f44...</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="l">Target Assertions:</span>
              <span className="m text-white">rank_impurity(noise_20) ≤ 5 &amp; rank_permutation(noise_20) &gt; 15</span>
            </div>
          </div>

          {/* Generated Code Preview */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="l">Generated Entrypoint: main.py</span>
              <span className="font-mono text-[10px] text-[#737373]">Deterministic seed = 42</span>
            </div>
            <pre className="max-h-60 overflow-y-auto rounded-lg border border-[#262626] bg-[#0a0a0a] p-4 font-mono text-[11px] text-[#e5e5e5] leading-relaxed">
              <code>{HERO_PYTHON_SCRIPT}</code>
            </pre>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-[#262626] p-4 bg-[#0a0a0a]">
          <button
            onClick={onReject}
            className="h-8 px-4 rounded border border-[#262626] bg-transparent text-xs font-mono uppercase text-[#737373] hover:text-white hover:border-[#404040] transition"
          >
            Reject Plan
          </button>
          <button
            onClick={onApprove}
            className="h-8 px-4 rounded bg-[#f97316] text-black font-mono uppercase text-xs font-bold hover:bg-[#ea580c] transition shadow-[0_0_15px_rgba(249,115,22,0.3)]"
          >
            Approve &amp; Dispatch to E2B
          </button>
        </div>
      </div>
    </div>
  );
};
