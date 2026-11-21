import React from 'react';
import type { WorkspaceEdge } from '../../data/demoWorkspace';

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
      <aside className="w-[340px] border-l border-[#252C36] bg-[#0E1116] p-5 flex flex-col gap-4 text-[#E6EAF0]">
        <div className="l">Evidence</div>
        <div className="text-xs text-[#9AA4B2] italic">
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
    <aside className="w-[340px] flex-shrink-0 border-l border-[#252C36] bg-[#0E1116] p-5 flex flex-col gap-4 text-[#E6EAF0] overflow-y-auto">
      {/* Header */}
      <div className="l">Evidence</div>

      {/* Badges */}
      <div className="flex gap-2 flex-wrap">
        <span className="b text-[#3DD6B5] border-[#3DD6B5]/40 bg-[#3DD6B5]/10">
          {relation}
        </span>
        <span
          className={`b ${
            isAccepted
              ? 'text-[#3DD6B5] border-[#3DD6B5]/40 bg-[#3DD6B5]/10'
              : isRejected
              ? 'text-[#F5A524] border-[#F5A524]/40 bg-[#F5A524]/10'
              : 'text-[#9AA4B2] border-[#252C36]'
          }`}
        >
          {status}
        </span>
        {confidence && (
          <span className="b text-[#9AA4B2] border-[#252C36]">
            {confidence}
          </span>
        )}
      </div>

      {/* From → To */}
      <div className="text-[14px] leading-snug">
        <span className="text-[#E6EAF0] font-medium">{sourceName}</span>{' '}
        <span className="text-[#9AA4B2]">→</span>{' '}
        <span className="text-[#E6EAF0] font-medium">{targetName}</span>
      </div>

      {/* Verbatim Cited Quote Card */}
      <div className="c p-4 border-l-[3px] !border-l-[#3DD6B5] !rounded-lg bg-[#161B22]">
        <div className="text-[14px] leading-relaxed text-[#E6EAF0]">
          &ldquo;{quote}&rdquo;
        </div>
        <div className="m text-[11px] text-[#9AA4B2] mt-3">
          p. {page} · chunk #{chunkNumber} · chars {charStart}–{charEnd}
        </div>
      </div>

      {/* Rationale */}
      <div className="l">Rationale</div>
      <div className="text-[13px] leading-relaxed text-[#9AA4B2]">
        {rationale}
      </div>

      {/* Accept / Reject actions */}
      <div className="flex gap-2 mt-auto pt-4">
        <button
          onClick={() => onUpdateStatus?.(edge.id, 'accepted')}
          className={`flex-1 h-10 rounded-lg font-medium text-[13px] transition ${
            isAccepted
              ? 'bg-[#3DD6B5] text-[#0E1116] font-semibold ring-2 ring-[#3DD6B5]/40'
              : 'bg-[#3DD6B5] text-[#0E1116] hover:bg-[#34c4a4]'
          }`}
        >
          Accept
        </button>
        <button
          onClick={() => onUpdateStatus?.(edge.id, 'rejected')}
          className={`flex-1 h-10 rounded-lg font-medium text-[13px] transition border ${
            isRejected
              ? 'bg-[#252C36] text-[#F5A524] border-[#F5A524]'
              : 'bg-transparent text-[#E6EAF0] border-[#3A4452] hover:bg-[#161B22]'
          }`}
        >
          Reject
        </button>
      </div>
    </aside>
  );
};
