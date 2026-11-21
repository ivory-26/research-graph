import React, { useState } from 'react';
import { Handle, Position, NodeToolbar } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import {
  FileText,
  Target,
  Cpu,
  Database,
  Play,
  CheckCircle2,
  Copy,
  ShieldCheck,
  GitBranch,
  Check,
} from 'lucide-react';

export const SourceNode: React.FC<NodeProps> = ({ data, selected }) => {
  const isHero = Boolean(data.isHero);
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (data.doi) {
      navigator.clipboard.writeText(String(data.doi));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div
      className={`node-premium-card w-[180px] rounded-[10px] bg-[#161B22] p-3 transition-all ${
        selected
          ? 'border-2 border-[#6EA8FE] shadow-[0_0_20px_rgba(110,168,254,0.35)]'
          : isHero
          ? 'border border-[#6EA8FE]/80 hover:border-[#6EA8FE]'
          : 'border border-[#252C36] hover:border-[#3A4452]'
      }`}
    >
      {/* Node Toolbar on Selection */}
      <NodeToolbar
        isVisible={selected}
        position={Position.Top}
        className="flex items-center gap-1 rounded-lg border border-[#252C36] bg-[#161B22]/95 px-2 py-1 shadow-2xl backdrop-blur-md mb-1"
      >
        <span className="font-mono text-[10px] text-[#9AA4B2] mr-1">Source:</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded bg-[#252C36] px-1.5 py-0.5 text-[10px] font-mono text-[#E6EAF0] hover:text-[#3DD6B5] transition"
          title="Copy DOI"
        >
          {copied ? <Check className="h-3 w-3 text-[#3DD6B5]" /> : <Copy className="h-3 w-3" />}
          <span>{copied ? 'Copied' : 'DOI'}</span>
        </button>
      </NodeToolbar>

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[#6EA8FE] !w-2.5 !h-2.5"
      />

      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-[#9AA4B2]">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isHero ? 'bg-[#6EA8FE] pulse-dot' : 'bg-[#9AA4B2]'
            }`}
          />
          <span>{isHero ? 'SOURCE · HERO' : 'SOURCE · SUPPORT'}</span>
        </div>
        <FileText className="h-3 w-3 text-[#6EA8FE] opacity-75" />
      </div>

      <div className="text-[12px] font-medium text-[#E6EAF0] truncate">
        {data.title as string}
      </div>

      <div className="mt-1 flex items-center justify-between text-[10px] text-[#9AA4B2]">
        <span className="font-mono text-[9px] truncate max-w-[110px]">
          {data.doi ? String(data.doi) : 'Open Access'}
        </span>
        <span>{data.pages ? `${data.pages} pp` : ''}</span>
      </div>
    </div>
  );
};

export const ClaimNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <div
      className={`node-premium-card w-[220px] rounded-[12px] bg-[#13201F] p-3.5 transition-all ${
        selected
          ? 'border-2 border-[#3DD6B5] shadow-[0_0_25px_rgba(61,214,181,0.4)]'
          : 'border-[1.5px] border-[#3DD6B5]'
      }`}
    >
      <NodeToolbar
        isVisible={selected}
        position={Position.Top}
        className="flex items-center gap-1.5 rounded-lg border border-[#252C36] bg-[#161B22]/95 px-2 py-1 shadow-2xl backdrop-blur-md mb-1"
      >
        <span className="font-mono text-[10px] text-[#3DD6B5] font-semibold">Audited Claim</span>
      </NodeToolbar>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[#3DD6B5] !w-2.5 !h-2.5"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[#3DD6B5] !w-2.5 !h-2.5"
      />

      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-[#3DD6B5]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#3DD6B5] pulse-dot" />
          <span>{(data.sublabel as string) || 'CLAIM · QUALITATIVE'}</span>
        </div>
        <Target className="h-3.5 w-3.5 text-[#3DD6B5]" />
      </div>

      <div className="text-[12px] font-medium leading-snug text-[#E6EAF0]">
        {(data.text as string) || (data.title as string)}
      </div>

      <div className="mt-2.5 flex items-center justify-between border-t border-[#3DD6B5]/20 pt-1.5 font-mono text-[9px] text-[#3DD6B5]">
        <span>Deterministic eval</span>
        <span>Adapted mode</span>
      </div>
    </div>
  );
};

export const MethodNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <div
      className={`node-premium-card w-[190px] rounded-[10px] bg-[#161B22] p-3 transition-all ${
        selected
          ? 'border-2 border-[#A78BFA] shadow-[0_0_20px_rgba(167,139,250,0.35)]'
          : 'border border-[#A78BFA]'
      }`}
    >
      <NodeToolbar
        isVisible={selected}
        position={Position.Top}
        className="flex items-center gap-1 rounded-lg border border-[#252C36] bg-[#161B22]/95 px-2 py-1 shadow-2xl backdrop-blur-md mb-1"
      >
        <span className="font-mono text-[10px] text-[#A78BFA]">scikit-learn 1.9.1</span>
      </NodeToolbar>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[#A78BFA] !w-2.5 !h-2.5"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[#A78BFA] !w-2.5 !h-2.5"
      />

      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-[#9AA4B2]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#A78BFA]" />
          <span>METHOD</span>
        </div>
        <Cpu className="h-3 w-3 text-[#A78BFA]" />
      </div>

      <div className="text-[12px] font-medium text-[#E6EAF0]">
        {data.title as string}
      </div>

      <div className="mt-1 text-[10px] text-[#9AA4B2] font-mono">
        RandomForest · 100 trees
      </div>
    </div>
  );
};

export const DatasetNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <div
      className={`node-premium-card w-[190px] rounded-[10px] bg-[#161B22] p-3 transition-all ${
        selected
          ? 'border-2 border-[#F472B6] shadow-[0_0_20px_rgba(244,114,182,0.35)]'
          : 'border border-[#F472B6]'
      }`}
    >
      <NodeToolbar
        isVisible={selected}
        position={Position.Top}
        className="flex items-center gap-1.5 rounded-lg border border-[#252C36] bg-[#161B22]/95 px-2 py-1 shadow-2xl backdrop-blur-md mb-1"
      >
        <ShieldCheck className="h-3.5 w-3.5 text-[#F472B6]" />
        <span className="font-mono text-[10px] text-[#F472B6]">SHA-256 Pinned</span>
      </NodeToolbar>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[#F472B6] !w-2.5 !h-2.5"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[#F472B6] !w-2.5 !h-2.5"
      />

      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-[#9AA4B2]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#F472B6]" />
          <span>DATASET · SHA PINNED</span>
        </div>
        <Database className="h-3 w-3 text-[#F472B6]" />
      </div>

      <div className="text-[12px] font-medium text-[#E6EAF0]">
        {data.title as string}
      </div>

      <div className="mt-1 flex items-center justify-between text-[10px] text-[#9AA4B2] font-mono">
        <span>569 rows</span>
        <span>+3 noise cols</span>
      </div>
    </div>
  );
};

export const RunNode: React.FC<NodeProps> = ({ data, selected }) => {
  const isWhatIf = Boolean(data.parentRunId);

  return (
    <div
      className={`node-premium-card w-[190px] rounded-[10px] bg-[#161B22] p-3 transition-all ${
        selected
          ? 'border-2 border-[#3DD6B5] shadow-[0_0_20px_rgba(61,214,181,0.35)]'
          : 'border border-[#E6EAF0]'
      }`}
    >
      <NodeToolbar
        isVisible={selected}
        position={Position.Top}
        className="flex items-center gap-1.5 rounded-lg border border-[#252C36] bg-[#161B22]/95 px-2 py-1 shadow-2xl backdrop-blur-md mb-1"
      >
        <span className="font-mono text-[10px] text-[#3DD6B5]">E2B Sandbox · none network</span>
      </NodeToolbar>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[#E6EAF0] !w-2.5 !h-2.5"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[#E6EAF0] !w-2.5 !h-2.5"
      />

      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-[#9AA4B2]">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isWhatIf ? 'bg-[#3DD6B5]' : 'bg-[#F5A524]'
            }`}
          />
          <span>{isWhatIf ? 'RUN B · WHAT-IF' : 'RUN A · ROOT'}</span>
        </div>
        {isWhatIf ? (
          <GitBranch className="h-3 w-3 text-[#3DD6B5]" />
        ) : (
          <Play className="h-3 w-3 text-[#F5A524]" />
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-[#E6EAF0]">
          {data.title as string}
        </span>
        <span className="b text-[10px] text-[#3DD6B5] border-[#3DD6B5]/40 py-0.5">
          match
        </span>
      </div>

      <div className="mt-1 flex items-center justify-between text-[10px] text-[#9AA4B2] font-mono">
        <span>adapted</span>
        <span>3.4s (CPU)</span>
      </div>
    </div>
  );
};

export const ResultNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <div
      className={`node-premium-card w-[190px] rounded-[10px] bg-[#161B22] p-3 transition-all ${
        selected
          ? 'border-2 border-[#3DD6B5] shadow-[0_0_20px_rgba(61,214,181,0.35)]'
          : 'border border-[#3DD6B5]'
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[#3DD6B5] !w-2.5 !h-2.5"
      />

      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-[#3DD6B5]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#3DD6B5] pulse-dot" />
          <span>RESULT · EVALUATED</span>
        </div>
        <CheckCircle2 className="h-3.5 w-3.5 text-[#3DD6B5]" />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-[#E6EAF0]">
          {data.title as string}
        </span>
        <span className="b text-[10px] text-[#3DD6B5] border-[#3DD6B5]/40 py-0.5">
          pass
        </span>
      </div>

      <div className="mt-1 text-[10px] text-[#9AA4B2] font-mono truncate">
        {data.criteria as string || 'Deterministic arithmetic check'}
      </div>
    </div>
  );
};

export const NoteNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <div
      className={`node-premium-card w-[190px] rounded-[10px] bg-[#161B22] p-3 transition-all ${
        selected
          ? 'border-2 border-[#F5A524] shadow-[0_0_20px_rgba(245,165,36,0.35)]'
          : 'border border-[#F5A524]/60'
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[#F5A524] !w-2.5 !h-2.5"
      />
      <div className="font-mono text-[9px] uppercase tracking-wider text-[#F5A524] mb-1">
        AUDITOR NOTE
      </div>
      <div className="text-[11px] text-[#E6EAF0] leading-snug line-clamp-2">
        {data.body as string}
      </div>
    </div>
  );
};
