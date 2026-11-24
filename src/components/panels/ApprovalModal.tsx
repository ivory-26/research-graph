import React from 'react';
import { HERO_EXPERIMENT_SPEC_RUN_A } from '../../server/planner';
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

  const spec = HERO_EXPERIMENT_SPEC_RUN_A;
  const primaryDataset = spec.datasets[0];
  const criteriaText = spec.criteria.checks
    .map((c) => `${c.metric} ${c.op === 'lte' ? '≤' : c.op === 'gt' ? '>' : c.op} ${c.value}`)
    .join(' & ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md animate-fade-in">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-none border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-secondary)] shadow-2xl">
        {/* Header with Sharp Corners */}
        <div className="flex items-center justify-between border-b border-[var(--border-primary)] p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-none bg-[#f97316]/10 p-2 text-[#f97316] border border-[#f97316]/30">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[var(--text-primary)] font-mono uppercase tracking-tight">
                  Human Approval Gate: Experiment Plan
                </h2>
                <span className="badge-orange-outline rounded-none">
                  AWAIT_APPROVAL
                </span>
              </div>
              <p className="text-xs text-[var(--text-dim)] mt-0.5 font-mono">
                Inspect generated Python script and resource sandbox boundary specification.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-none p-1.5 text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Resource & Isolation Boundary Cards with Sharp Corners */}
          <div className="grid grid-cols-3 gap-3">
            <div className="c p-3 flex items-center gap-3 bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none">
              <WifiOff className="h-5 w-5 text-[#f97316]" />
              <div>
                <div className="l text-[9px] text-[#f97316]">
                  Network Policy
                </div>
                <div className="m text-xs font-bold text-[var(--text-primary)]">
                  {spec.network} (isolated)
                </div>
              </div>
            </div>

            <div className="c p-3 flex items-center gap-3 bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none">
              <Cpu className="h-5 w-5 text-[var(--text-primary)]" />
              <div>
                <div className="l text-[9px]">
                  Compute Limit
                </div>
                <div className="m text-xs font-bold text-[var(--text-primary)]">
                  {spec.cpuCount} vCPU · {spec.memoryMb}MB RAM
                </div>
              </div>
            </div>

            <div className="c p-3 flex items-center gap-3 bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none">
              <HardDrive className="h-5 w-5 text-[var(--text-primary)]" />
              <div>
                <div className="l text-[9px]">
                  Dataset Mode
                </div>
                <div className="m text-xs font-bold text-[var(--text-primary)]">
                  {spec.mode} (OpenML)
                </div>
              </div>
            </div>
          </div>

          {/* Dataset Lock & Spec */}
          <div className="c p-4 bg-[var(--card-bg)] border border-[var(--border-primary)] text-xs space-y-1.5 rounded-none">
            <div className="flex items-center justify-between">
              <span className="l">Dataset Reference:</span>
              <span className="m text-[var(--text-primary)] font-bold">
                {primaryDataset?.name} ({primaryDataset?.path})
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="l">Dataset Source & Size:</span>
              <span className="m text-[#f97316] font-mono text-[11px] truncate max-w-[450px]">
                {primaryDataset?.url} {primaryDataset?.bytes ? `(${primaryDataset.bytes} bytes)` : ''}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="l">Target Assertions:</span>
              <span className="m text-[var(--text-primary)] font-mono">{criteriaText}</span>
            </div>
          </div>

          {/* Generated Code Preview with Sharp Corners */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="l">Generated Entrypoint: {spec.entrypoint}</span>
              <span className="font-mono text-[10px] text-[var(--text-dim)]">
                Timeout = {spec.timeoutSeconds}s
              </span>
            </div>
            <pre className="max-h-60 overflow-y-auto rounded-none border border-[var(--border-primary)] bg-[var(--card-bg)] p-4 font-mono text-[11px] text-[var(--text-primary)] leading-relaxed">
              <code>{spec.files['main.py']}</code>
            </pre>
          </div>
        </div>

        {/* Footer Actions with Sharp Corners */}
        <div className="flex items-center justify-end gap-3 border-t border-[var(--border-primary)] p-4 bg-[var(--bg-surface)]">
          <button
            onClick={onReject}
            className="h-8 px-4 rounded-none border border-[var(--border-primary)] bg-transparent text-xs font-mono uppercase text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)] transition"
          >
            Reject Plan
          </button>
          <button
            onClick={onApprove}
            className="h-8 px-4 rounded-none bg-[#f97316] text-black font-mono uppercase text-xs font-bold hover:bg-[#ea580c] transition shadow-[0_0_15px_rgba(249,115,22,0.3)]"
          >
            Confirm Plan Specification
          </button>
        </div>
      </div>
    </div>
  );
};
