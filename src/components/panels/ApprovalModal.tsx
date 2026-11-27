import React, { useState } from 'react';
import { HERO_EXPERIMENT_SPEC_RUN_A } from '../../../fixtures/hero-spec';
import type { ExperimentSpec } from '../../shared/types';
import { ShieldCheck, Cpu, HardDrive, WifiOff, X, AlertCircle, Play } from 'lucide-react';

interface ApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApprove: (experimentId: string, gateSeq: number) => void;
  onReject: (experimentId: string, gateSeq: number) => void;
  onStartStream?: (experimentId: string) => void;
  experimentId?: string | null;
  gateSeq?: number | null;
  spec?: ExperimentSpec | null;
  errorMessage?: string | null;
  isSubmitting?: boolean;
  isStreaming?: boolean;
}

export const ApprovalModal: React.FC<ApprovalModalProps> = ({
  isOpen,
  onClose,
  onApprove,
  onReject,
  onStartStream,
  experimentId,
  gateSeq,
  spec: liveSpec,
  errorMessage,
  isSubmitting = false,
  isStreaming = false,
}) => {
  const [inputExperimentId, setInputExperimentId] = useState('');
  const [uuidError, setUuidError] = useState<string | null>(null);

  if (!isOpen) return null;

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const hasLiveGate = Boolean(experimentId && gateSeq != null && gateSeq > 0 && liveSpec);
  const spec = liveSpec ?? HERO_EXPERIMENT_SPEC_RUN_A;
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
                  {hasLiveGate ? 'AWAIT_APPROVAL' : 'FIXTURE PREVIEW · NO LIVE GATE'}
                </span>
              </div>
              <p className="text-xs text-[var(--text-dim)] mt-0.5 font-mono">
                {hasLiveGate ? (
                  <>
                    Experiment: <span className="text-[#f97316] font-semibold">{experimentId}</span> · Gate Seq: #{gateSeq} · Python sandbox specification
                  </>
                ) : (
                  'Showing HERO_EXPERIMENT_SPEC_RUN_A fixture preview. Open a pipeline stream for a live experiment ID to approve or reject.'
                )}
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
          {errorMessage && (
            <div className="flex items-center gap-2 border border-red-500/40 bg-red-950/20 p-3 text-xs text-red-300 font-mono">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {!hasLiveGate && onStartStream && (
            <div className="c p-3.5 bg-[var(--card-bg)] border border-[var(--border-primary)] space-y-2 font-mono text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={inputExperimentId}
                  onChange={(e) => {
                    setInputExperimentId(e.target.value);
                    setUuidError(null);
                  }}
                  placeholder="Enter experiment UUID to stream..."
                  className="flex-1 min-w-[220px] border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:border-[#f97316] focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!inputExperimentId.trim() || isStreaming}
                  onClick={() => {
                    const trimmed = inputExperimentId.trim();
                    if (!UUID_RE.test(trimmed)) {
                      setUuidError('Experiment ID must be a valid UUID.');
                      return;
                    }
                    setUuidError(null);
                    onStartStream(trimmed);
                  }}
                  className="h-8 px-3 bg-[#f97316] text-black font-bold uppercase text-[11px] hover:bg-[#ea580c] transition disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  <Play className="h-3 w-3 fill-current" />
                  <span>{isStreaming ? 'Streaming...' : 'Open Pipeline Stream'}</span>
                </button>
              </div>
              {uuidError && (
                <div className="text-[11px] text-red-400">{uuidError}</div>
              )}
            </div>
          )}

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
              <span className="l">Dataset Source:</span>
              <span className="m text-[#f97316] font-mono text-[11px] truncate max-w-[450px]">
                {primaryDataset?.url}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="l">Dataset Size:</span>
              <span className="m text-[var(--text-primary)] font-mono text-[11px]">
                {primaryDataset?.bytes != null ? `${primaryDataset.bytes} bytes` : 'unknown until fetched'}
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
              <code>{spec.files[spec.entrypoint] ?? spec.files['main.py']}</code>
            </pre>
          </div>
        </div>

        {/* Footer Actions with Sharp Corners */}
        <div className="flex items-center justify-end gap-3 border-t border-[var(--border-primary)] p-4 bg-[var(--bg-surface)]">
          <button
            onClick={() => hasLiveGate && experimentId && gateSeq != null && onReject(experimentId, gateSeq)}
            disabled={!hasLiveGate || isSubmitting}
            title={!hasLiveGate ? 'Open a live pipeline stream to receive an approval gate' : undefined}
            className="h-8 px-4 rounded-none border border-[var(--border-primary)] bg-transparent text-xs font-mono uppercase text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)] transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Reject Plan
          </button>
          <button
            onClick={() => hasLiveGate && experimentId && gateSeq != null && onApprove(experimentId, gateSeq)}
            disabled={!hasLiveGate || isSubmitting}
            title={!hasLiveGate ? 'Open a live pipeline stream to receive an approval gate' : undefined}
            className="h-8 px-4 rounded-none bg-[#f97316] text-black font-mono uppercase text-xs font-bold hover:bg-[#ea580c] transition shadow-[0_0_15px_rgba(249,115,22,0.3)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {isSubmitting ? 'Posting Approval...' : 'Confirm Plan Specification'}
          </button>
        </div>
      </div>
    </div>
  );
};
