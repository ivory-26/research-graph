import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import {
  FileText,
  Target,
  Cpu,
  Database,
  Play,
  CheckCircle2,
  XCircle,
  StickyNote,
  ShieldCheck,
  GitBranch,
} from 'lucide-react';

export const SourceNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <div
      className={`w-72 rounded-xl border bg-white/90 p-4 shadow-md backdrop-blur-md transition-all dark:bg-slate-900/90 ${
        selected ? 'border-cyan-500 ring-2 ring-cyan-500/30' : 'border-slate-200 dark:border-slate-800'
      }`}
    >
      <Handle type="source" position={Position.Right} className="!bg-cyan-500 !w-3 !h-3" />
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-blue-500/10 p-2 text-blue-600 dark:text-blue-400">
            <FileText className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              Source Paper
            </span>
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 line-clamp-1">
              {data.title as string}
            </div>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-2 mb-3">
        {data.subtitle as string}
      </p>
      <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800/80 pt-2 text-[10px] text-slate-500 dark:text-slate-400">
        <span className="font-mono">{data.doi as string}</span>
        <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5">
          {data.pages as number} pp.
        </span>
      </div>
    </div>
  );
};

export const ClaimNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <div
      className={`w-80 rounded-xl border bg-white/90 p-4 shadow-md backdrop-blur-md transition-all dark:bg-slate-900/90 ${
        selected ? 'border-amber-500 ring-2 ring-amber-500/30' : 'border-slate-200 dark:border-slate-800'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-amber-500 !w-3 !h-3" />
      <Handle type="source" position={Position.Right} className="!bg-amber-500 !w-3 !h-3" />
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400">
            <Target className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              Testable Claim
            </span>
            <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
              Gini Cardinality Bias
            </div>
          </div>
        </div>
        <span className="rounded-full bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
          Qualitative
        </span>
      </div>
      <p className="text-[12px] leading-relaxed text-slate-700 dark:text-slate-300 mb-3 bg-amber-50/50 dark:bg-amber-950/20 p-2.5 rounded-lg border border-amber-200/40 dark:border-amber-800/30">
        {data.text as string}
      </p>
      {Boolean(data.locator) && (
        <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
          <span className="font-semibold text-amber-600 dark:text-amber-400">
            Page {(data.locator as any).page}:
          </span>
          <span className="italic truncate">&quot;{(data.locator as any).quote}&quot;</span>
        </div>
      )}
    </div>
  );
};

export const MethodNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <div
      className={`w-72 rounded-xl border bg-white/90 p-4 shadow-md backdrop-blur-md transition-all dark:bg-slate-900/90 ${
        selected ? 'border-purple-500 ring-2 ring-purple-500/30' : 'border-slate-200 dark:border-slate-800'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-purple-500 !w-3 !h-3" />
      <Handle type="source" position={Position.Right} className="!bg-purple-500 !w-3 !h-3" />
      <div className="flex items-center gap-2 mb-2">
        <div className="rounded-lg bg-purple-500/10 p-2 text-purple-600 dark:text-purple-400">
          <Cpu className="w-4 h-4" />
        </div>
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
            Method Reimplementation
          </span>
          <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
            Random Forest (scikit-learn)
          </div>
        </div>
      </div>
      <p className="text-[11px] text-slate-600 dark:text-slate-300 mb-3 line-clamp-3">
        {data.summary as string}
      </p>
      <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px]">
        <span className="font-mono text-purple-600 dark:text-purple-400">{data.library as string}</span>
        <span className="text-slate-400">100 trees · 10 repeats</span>
      </div>
    </div>
  );
};

export const DatasetNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <div
      className={`w-72 rounded-xl border bg-white/90 p-4 shadow-md backdrop-blur-md transition-all dark:bg-slate-900/90 ${
        selected ? 'border-emerald-500 ring-2 ring-emerald-500/30' : 'border-slate-200 dark:border-slate-800'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-emerald-500 !w-3 !h-3" />
      <Handle type="source" position={Position.Right} className="!bg-emerald-500 !w-3 !h-3" />
      <div className="flex items-center gap-2 mb-2">
        <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-400">
          <Database className="w-4 h-4" />
        </div>
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            Dataset Reference
          </span>
          <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
            {data.name as string}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg mb-2">
        <div>
          <span className="text-slate-400">Rows:</span>{' '}
          <span className="font-semibold text-slate-800 dark:text-slate-200">{data.rows as number}</span>
        </div>
        <div>
          <span className="text-slate-400">Base Feats:</span>{' '}
          <span className="font-semibold text-slate-800 dark:text-slate-200">{data.features as number}</span>
        </div>
        <div className="col-span-2 text-[10px] text-emerald-700 dark:text-emerald-300">
          Injected: <span className="font-mono">{data.noiseColumns as string}</span>
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1">
          <ShieldCheck className="w-3 h-3 text-emerald-500" />
          SHA256 verified
        </span>
        <span className="font-mono">{((data.verifiedBytes as number) / 1024).toFixed(1)} KB</span>
      </div>
    </div>
  );
};

export const RunNode: React.FC<NodeProps> = ({ data, selected }) => {
  const isWhatIf = Boolean(data.parentRunId);

  return (
    <div
      className={`w-72 rounded-xl border bg-white/90 p-4 shadow-md backdrop-blur-md transition-all dark:bg-slate-900/90 ${
        selected ? 'border-cyan-500 ring-2 ring-cyan-500/30' : 'border-slate-200 dark:border-slate-800'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-cyan-500 !w-3 !h-3" />
      <Handle type="source" position={Position.Right} className="!bg-cyan-500 !w-3 !h-3" />
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-600 dark:text-cyan-400">
            {isWhatIf ? <GitBranch className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
                {isWhatIf ? 'What-If Branch' : 'Execution Run'}
              </span>
              <span className="rounded bg-cyan-100 dark:bg-cyan-950 px-1 text-[9px] font-bold text-cyan-800 dark:text-cyan-300">
                {data.mode as string}
              </span>
            </div>
            <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
              {isWhatIf ? 'Run B (Permutation)' : 'Run A (Impurity)'}
            </div>
          </div>
        </div>
      </div>
      {Boolean(data.singleParamDiff) && (
        <div className="mb-2 rounded bg-amber-500/10 p-1.5 text-[10px] font-mono text-amber-700 dark:text-amber-300 border border-amber-500/20">
          Δ {data.singleParamDiff as string}
        </div>
      )}
      <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
        <div className="flex justify-between">
          <span>Sandbox:</span>
          <span className="font-mono text-slate-800 dark:text-slate-200">{data.sandboxId as string}</span>
        </div>
        <div className="flex justify-between">
          <span>Network Policy:</span>
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">disabled (none)</span>
        </div>
        <div className="flex justify-between">
          <span>Duration:</span>
          <span>{((data.durationMs as number) / 1000).toFixed(2)}s (CPU)</span>
        </div>
      </div>
    </div>
  );
};

export const ResultNode: React.FC<NodeProps> = ({ data, selected }) => {
  const isMatch = data.verdict === 'match';

  return (
    <div
      className={`w-80 rounded-xl border bg-white/90 p-4 shadow-md backdrop-blur-md transition-all dark:bg-slate-900/90 ${
        selected ? 'border-emerald-500 ring-2 ring-emerald-500/30' : 'border-slate-200 dark:border-slate-800'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-emerald-500 !w-3 !h-3" />
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className={`rounded-lg p-2 ${
              isMatch
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
            }`}
          >
            {isMatch ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              Evaluated Result
            </span>
            <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
              Verdict: <span className="uppercase">{data.verdict as string}</span>
            </div>
          </div>
        </div>
        <span className="rounded-full bg-emerald-100 dark:bg-emerald-950 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
          Arithmetic Pass
        </span>
      </div>

      <div className="my-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-2 text-[11px] font-mono space-y-1">
        <div className="flex justify-between">
          <span className="text-slate-500">rank_impurity(noise_20):</span>
          <span className="font-bold text-rose-600 dark:text-rose-400">
            #{(data.metrics as any).rank_impurity_noise_20}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">rank_permutation(noise_20):</span>
          <span className="font-bold text-emerald-600 dark:text-emerald-400">
            #{(data.metrics as any).rank_permutation_noise_20}
          </span>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 italic border-l-2 border-emerald-500 pl-2">
        {(data.verdictDetail as any)?.summary}
      </p>
    </div>
  );
};

export const NoteNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <div
      className={`w-72 rounded-xl border bg-amber-50/70 p-4 shadow-sm backdrop-blur-md transition-all dark:bg-amber-950/20 ${
        selected ? 'border-amber-500 ring-2 ring-amber-500/30' : 'border-amber-200/60 dark:border-amber-800/40'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-amber-500 !w-3 !h-3" />
      <div className="flex items-center gap-2 mb-2">
        <StickyNote className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        <span className="text-xs font-bold text-amber-900 dark:text-amber-200">
          Auditor Comment
        </span>
      </div>
      <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed mb-2">
        {data.body as string}
      </p>
      <div className="text-[10px] text-amber-700/60 dark:text-amber-400/60 flex justify-between">
        <span>{data.author as string}</span>
        <span>{data.createdAt as string}</span>
      </div>
    </div>
  );
};
