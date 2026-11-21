import React from 'react';
import { DEMO_CHUNKS } from '../../data/demoWorkspace';
import type { WorkspaceEdge } from '../../data/demoWorkspace';
import { X, ShieldCheck, FileText, Quote } from 'lucide-react';

interface EvidencePanelProps {
  edge: WorkspaceEdge | null;
  onClose: () => void;
  onUpdateStatus?: (edgeId: string, newStatus: 'accepted' | 'rejected') => void;
}

export const EvidencePanel: React.FC<EvidencePanelProps> = ({
  edge,
  onClose,
  onUpdateStatus,
}) => {
  if (!edge) return null;

  const chunk = edge.evidenceChunkId ? DEMO_CHUNKS[edge.evidenceChunkId] : null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-96 border-l border-slate-200 bg-white/95 p-6 shadow-2xl backdrop-blur-xl transition-all dark:border-slate-800 dark:bg-slate-900/95 sm:w-[420px]">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-600 dark:text-cyan-400">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Auditable Evidence
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Relationship: <span className="font-mono font-semibold uppercase text-cyan-600 dark:text-cyan-400">{edge.relation}</span>
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-6 space-y-5">
        {/* Verification Status */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-slate-500 dark:text-slate-400">Edge State:</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                edge.status === 'accepted'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
              }`}
            >
              {edge.status}
            </span>
          </div>
          {edge.confidence && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 dark:text-slate-400">Model Confidence:</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                {(edge.confidence * 100).toFixed(0)}%
              </span>
            </div>
          )}
        </div>

        {/* Verbatim Quote Card */}
        {edge.quote && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-1.5">
                <Quote className="h-3.5 w-3.5 text-amber-500" />
                Verbatim Cited Quote
              </span>
              {edge.page && (
                <span className="rounded bg-amber-100 dark:bg-amber-950 px-1.5 py-0.5 text-[10px] text-amber-800 dark:text-amber-300 font-mono">
                  Page {edge.page}
                </span>
              )}
            </div>
            <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 p-4 text-[12px] leading-relaxed text-slate-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-slate-200 italic">
              &quot;{edge.quote}&quot;
            </div>
          </div>
        )}

        {/* Source Chunk Context */}
        {chunk && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-blue-500" />
                Underlying Source Passage
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                Chars {chunk.charStart}–{chunk.charEnd}
              </span>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3.5 text-[11px] leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              {chunk.text}
            </div>
            <div className="text-[10px] text-slate-400">
              From: <span className="font-semibold">{chunk.sourceTitle}</span>
            </div>
          </div>
        )}

        {/* Run Evidence if produced by execution */}
        {edge.evidenceRunId && (
          <div className="rounded-xl border border-cyan-200/80 bg-cyan-50/50 p-4 text-xs dark:border-cyan-800/40 dark:bg-cyan-950/20">
            <div className="font-semibold text-cyan-900 dark:text-cyan-200 mb-1">
              Execution Evidence ({edge.evidenceRunId})
            </div>
            <p className="text-[11px] text-cyan-800 dark:text-cyan-300 leading-relaxed">
              Backed by verified execution receipt from E2B isolated sandbox. Arithmetic criteria evaluated against frozen `/output/metrics.json`.
            </p>
          </div>
        )}

        {/* Rationale */}
        {edge.rationale && (
          <div className="rounded-xl border border-slate-200/80 p-3.5 text-xs dark:border-slate-800 text-slate-600 dark:text-slate-400">
            <span className="font-semibold text-slate-800 dark:text-slate-200">Extraction Rationale: </span>
            {edge.rationale}
          </div>
        )}

        {/* Human Audit Actions */}
        {onUpdateStatus && edge.status === 'suggested' && (
          <div className="pt-2 flex gap-3">
            <button
              onClick={() => onUpdateStatus(edge.id, 'accepted')}
              className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-xs font-bold text-white shadow hover:bg-emerald-700 transition"
            >
              Accept Edge Evidence
            </button>
            <button
              onClick={() => onUpdateStatus(edge.id, 'rejected')}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
