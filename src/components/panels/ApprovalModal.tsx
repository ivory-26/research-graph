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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-[#252C36] bg-[#0E1116] text-[#E6EAF0] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#252C36] p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-[#F5A524]/10 p-2 text-[#F5A524]">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-[#E6EAF0]">
                  Human Approval Gate: Experiment Plan
                </h2>
                <span className="b text-[#3DD6B5] border-[#3DD6B5]/40 bg-[#3DD6B5]/10">
                  AWAIT_APPROVAL
                </span>
              </div>
              <p className="text-xs text-[#9AA4B2] mt-0.5">
                Inspect generated Python script and resource sandbox boundary before dispatching to E2B.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#9AA4B2] hover:text-[#E6EAF0] hover:bg-[#161B22] transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Resource & Isolation Boundary Cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="c p-3 flex items-center gap-3 bg-[#161B22]">
              <WifiOff className="h-5 w-5 text-[#3DD6B5]" />
              <div>
                <div className="l text-[9px] text-[#3DD6B5]">
                  Network Policy
                </div>
                <div className="m text-xs font-semibold text-[#E6EAF0]">
                  none (isolated)
                </div>
              </div>
            </div>

            <div className="c p-3 flex items-center gap-3 bg-[#161B22]">
              <Cpu className="h-5 w-5 text-[#6EA8FE]" />
              <div>
                <div className="l text-[9px]">
                  Compute Limit
                </div>
                <div className="m text-xs font-semibold text-[#E6EAF0]">
                  1 vCPU · 2GB RAM
                </div>
              </div>
            </div>

            <div className="c p-3 flex items-center gap-3 bg-[#161B22]">
              <HardDrive className="h-5 w-5 text-[#A78BFA]" />
              <div>
                <div className="l text-[9px]">
                  Storage Pinned
                </div>
                <div className="m text-xs font-semibold text-[#E6EAF0]">
                  SHA-256 match
                </div>
              </div>
            </div>
          </div>

          {/* Dataset Lock & Spec */}
          <div className="c p-4 bg-[#161B22] text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="l">Dataset Reference:</span>
              <span className="m text-[#E6EAF0]">openml:52350 (breast-w)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="l">Dataset SHA-256:</span>
              <span className="m text-[#3DD6B5]">7f83b1657ff185023908bf287cba6848419f44...</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="l">Execution Engine:</span>
              <span className="m text-[#E6EAF0]">E2B Sandbox (allowInternetAccess: false)</span>
            </div>
          </div>

          {/* Generated Code Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="l">Generated Entrypoint: main.py</span>
              <span className="m text-[10px] text-[#9AA4B2]">518 bytes · deterministic seed</span>
            </div>
            <div className="c max-h-64 overflow-y-auto p-4 bg-[#0E1116] border-[#252C36]">
              <pre className="font-mono text-[11px] leading-relaxed text-[#E6EAF0]">
                <code>{HERO_PYTHON_SCRIPT}</code>
              </pre>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-[#252C36] p-5">
          <div className="text-[11px] text-[#9AA4B2]">
            Verdict will be computed by code, not written by an LLM.
          </div>
          <div className="flex gap-3">
            <button
              onClick={onReject}
              className="h-9 px-4 rounded-lg border border-[#3A4452] bg-transparent text-[#E6EAF0] text-xs font-medium hover:bg-[#161B22] transition"
            >
              Reject Plan
            </button>
            <button
              onClick={onApprove}
              className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#3DD6B5] text-[#0E1116] text-xs font-semibold hover:bg-[#34c4a4] transition"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Approve &amp; Launch Sandbox</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
