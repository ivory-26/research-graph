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
      <aside className="w-[350px] border-l border-[#262626] bg-[#000000] p-5 flex flex-col gap-4 text-[#e5e5e5]">
        <div className="l">CITATION EVIDENCE</div>
        <div className="text-xs text-[#737373] italic font-mono">
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
    <aside className="w-[350px] flex-shrink-0 border-l border-[#262626] bg-[#000000] p-5 flex flex-col gap-4 text-[#e5e5e5] overflow-y-auto">
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
              ? 'border-white bg-white text-black font-bold'
              : isRejected
              ? 'border-red-500/50 bg-red-500/10 text-red-400'
              : 'border-[#262626] bg-[#0a0a0a] text-[#737373]'
          }`}
        >
          {status}
        </span>
        {confidence && (
          <span className="b border-[#262626] bg-[#0a0a0a] text-[#737373]">
            {confidence}
          </span>
        )}
      </div>

      {/* From → To */}
      <div className="text-[13px] leading-snug font-mono">
        <span className="text-white font-semibold">{sourceName}</span>{' '}
        <span className="text-[#737373]">→</span>{' '}
        <span className="text-white font-semibold">{targetName}</span>
      </div>

      {/* Verbatim Cited Quote Card */}
      <div className="c p-4 border-l-[3px] !border-l-[#f97316] !rounded-md bg-[#0a0a0a] border border-[#262626]">
        <div className="text-[13px] leading-relaxed text-[#e5e5e5] font-serif italic">
          &ldquo;{quote}&rdquo;
        </div>
        <div className="m text-[10px] text-[#737373] mt-3 border-t border-[#171717] pt-2">
          PAGE {page} · CHUNK #{chunkNumber} · CHARS {charStart}–{charEnd}
        </div>
      </div>

      {/* Rationale */}
      <div className="l">AUDIT RATIONALE</div>
      <div className="text-[12px] leading-relaxed text-[#a3a3a3] font-mono">
        {rationale}
      </div>

      {/* Accept / Reject actions */}
      <div className="flex gap-2 mt-auto pt-4">
        <button
          onClick={() => onUpdateStatus?.(edge.id, 'accepted')}
          className={`flex-1 h-9 rounded font-mono uppercase text-xs font-bold transition flex items-center justify-center gap-1.5 ${
            isAccepted
              ? 'bg-[#f97316] text-black shadow-[0_0_15px_rgba(249,115,22,0.3)]'
              : 'bg-white text-black hover:bg-neutral-200'
          }`}
        >
          <Check className="h-3.5 w-3.5" />
          <span>Accept</span>
        </button>
        <button
          onClick={() => onUpdateStatus?.(edge.id, 'rejected')}
          className={`flex-1 h-9 rounded font-mono uppercase text-xs transition border flex items-center justify-center gap-1.5 ${
            isRejected
              ? 'bg-[#171717] text-red-400 border-red-500'
              : 'bg-[#0a0a0a] text-[#737373] border-[#262626] hover:text-white hover:border-[#404040]'
          }`}
        >
          <XIcon className="h-3.5 w-3.5" />
          <span>Reject</span>
        </button>
      </div>
    </aside>
  );
};
