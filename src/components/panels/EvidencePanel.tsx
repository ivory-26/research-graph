import React from 'react';
import type { WorkspaceEdge } from '../../data/demoWorkspace';
import { Check, X as XIcon } from 'lucide-react';

interface EvidencePanelProps {
  edge: WorkspaceEdge | null;
  onUpdateStatus?: (edgeId: string, newStatus: 'accepted' | 'rejected') => void;
}

export const EvidencePanel: React.FC<EvidencePanelProps> = ({
  edge,
  onUpdateStatus,
}) => {
  if (!edge) {
    return (
      <aside className="w-[350px] border-l border-[var(--border-primary)] bg-[var(--bg-primary)] p-5 flex flex-col gap-4 text-[var(--text-secondary)]">
        <div className="l">CITATION EVIDENCE</div>
        <div className="text-xs text-[var(--text-dim)] italic font-mono">
          Select any edge or relation pill on the canvas to inspect its auditable citation evidence.
        </div>
      </aside>
    );
  }

  const relation = edge.relation || 'supports';
  const status = edge.status || 'accepted';
  const confidence = edge.confidence ? `conf ${edge.confidence.toFixed(2)}` : null;
  const quote = edge.quote || 'A variable with more categories has a higher probability to be selected in individual splits purely by chance. Consequently, impurity-based variable importance measures (Gini importance) are severely biased towards variables with many categories...';
  const page = edge.page || 4;
  const chunkNumber = edge.chunkNumber || 14;
  const charStart = edge.charStart || 3810;
  const charEnd = edge.charEnd || 4220;
  const sourceName = edge.sourceTitle || 'Strobl et al. 2007';
  const targetName = edge.targetTitle || 'Claim';
  const rationale = edge.rationale || 'Core theoretical finding documented in Section 2 with mathematical justification.';

  const isAccepted = status === 'accepted';
  const isRejected = status === 'rejected';

  return (
    <aside className="w-[350px] flex-shrink-0 border-l border-[var(--border-primary)] bg-[var(--bg-primary)] p-5 flex flex-col gap-4 text-[var(--text-secondary)] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="l">CITATION EVIDENCE</div>
        <span className="badge-solid-white">AUDITED</span>
      </div>

      {/* Badges */}
      <div className="flex gap-2 flex-wrap">
        <span className="badge-orange-outline">
          {relation}
        </span>
        <span
          className={`b ${
            isAccepted
              ? 'border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold'
              : isRejected
              ? 'border-red-500/50 bg-red-500/10 text-red-500'
              : 'border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-dim)]'
          }`}
        >
          {status}
        </span>
        {confidence && (
          <span className="b border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-dim)]">
            {confidence}
          </span>
        )}
      </div>

      {/* From → To */}
      <div className="text-[13px] leading-snug font-mono">
        <span className="text-[var(--text-primary)] font-semibold">{sourceName}</span>{' '}
        <span className="text-[var(--text-dim)]">→</span>{' '}
        <span className="text-[var(--text-primary)] font-semibold">{targetName}</span>
      </div>

      {/* Verbatim Cited Quote Card */}
      <div className="c p-4 border-l-[3px] !border-l-[#f97316] !rounded-md bg-[var(--card-bg)] border border-[var(--border-primary)]">
        <div className="text-[13px] leading-relaxed text-[var(--text-primary)] font-serif italic">
          &ldquo;{quote}&rdquo;
        </div>
        <div className="m text-[10px] text-[var(--text-dim)] mt-3 border-t border-[var(--border-primary)] pt-2">
          PAGE {page} · CHUNK #{chunkNumber} · CHARS {charStart}–{charEnd}
        </div>
      </div>

      {/* Rationale */}
      <div className="l">AUDIT RATIONALE</div>
      <div className="text-[12px] leading-relaxed text-[var(--text-muted)] font-mono">
        {rationale}
      </div>

      {/* Accept / Reject actions */}
      <div className="flex gap-2 mt-auto pt-4">
        <button
          onClick={() => onUpdateStatus?.(edge.id, 'accepted')}
          className={`flex-1 h-9 rounded font-mono uppercase text-xs font-bold transition flex items-center justify-center gap-1.5 ${
            isAccepted
              ? 'bg-[#f97316] text-black shadow-[0_0_15px_rgba(249,115,22,0.3)]'
              : 'bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-90'
          }`}
        >
          <Check className="h-3.5 w-3.5" />
          <span>Accept</span>
        </button>
        <button
          onClick={() => onUpdateStatus?.(edge.id, 'rejected')}
          className={`flex-1 h-9 rounded font-mono uppercase text-xs transition border flex items-center justify-center gap-1.5 ${
            isRejected
              ? 'bg-[var(--bg-surface)] text-red-500 border-red-500'
              : 'bg-[var(--bg-surface)] text-[var(--text-dim)] border-[var(--border-primary)] hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)]'
          }`}
        >
          <XIcon className="h-3.5 w-3.5" />
          <span>Reject</span>
        </button>
      </div>
    </aside>
  );
};
