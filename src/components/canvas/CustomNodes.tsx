import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';

export const SourceNode: React.FC<NodeProps> = ({ data, selected }) => {
  const isHero = Boolean(data.isHero);

  return (
    <div
      className={`w-[170px] rounded-[10px] bg-[#161B22] p-3 transition-all ${
        selected
          ? 'border-2 border-[#6EA8FE] shadow-[0_0_15px_rgba(110,168,254,0.3)]'
          : isHero
          ? 'border border-[#6EA8FE]'
          : 'border border-[#252C36] hover:border-[#3A4452]'
      }`}
    >
      <Handle type="source" position={Position.Right} className="!bg-[#6EA8FE] !w-2 !h-2" />
      <div className="font-mono text-[9px] uppercase tracking-wider text-[#9AA4B2] mb-1">
        {isHero ? 'SOURCE · HERO' : 'SOURCE · SUPPORT'}
      </div>
      <div className="text-[12px] font-medium text-[#E6EAF0] truncate">
        {data.title as string}
      </div>
    </div>
  );
};

export const ClaimNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <div
      className={`w-[210px] rounded-[12px] bg-[#13201F] p-3.5 transition-all ${
        selected
          ? 'border-2 border-[#3DD6B5] shadow-[0_0_20px_rgba(61,214,181,0.35)]'
          : 'border-[1.5px] border-[#3DD6B5]'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-[#3DD6B5] !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-[#3DD6B5] !w-2 !h-2" />
      <div className="font-mono text-[9px] font-semibold uppercase tracking-wider text-[#3DD6B5] mb-2">
        {(data.sublabel as string) || 'CLAIM · QUALITATIVE'}
      </div>
      <div className="text-[12px] font-medium leading-snug text-[#E6EAF0]">
        {(data.text as string) || (data.title as string)}
      </div>
    </div>
  );
};

export const MethodNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <div
      className={`w-[190px] rounded-[10px] bg-[#161B22] p-3 transition-all ${
        selected
          ? 'border-2 border-[#A78BFA] shadow-[0_0_15px_rgba(167,139,250,0.3)]'
          : 'border border-[#A78BFA]'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-[#A78BFA] !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-[#A78BFA] !w-2 !h-2" />
      <div className="font-mono text-[9px] uppercase tracking-wider text-[#9AA4B2] mb-1">
        METHOD
      </div>
      <div className="text-[12px] font-medium text-[#E6EAF0]">
        {data.title as string}
      </div>
    </div>
  );
};

export const DatasetNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <div
      className={`w-[190px] rounded-[10px] bg-[#161B22] p-3 transition-all ${
        selected
          ? 'border-2 border-[#F472B6] shadow-[0_0_15px_rgba(244,114,182,0.3)]'
          : 'border border-[#F472B6]'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-[#F472B6] !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-[#F472B6] !w-2 !h-2" />
      <div className="font-mono text-[9px] uppercase tracking-wider text-[#9AA4B2] mb-1">
        DATASET · SHA PINNED
      </div>
      <div className="text-[12px] font-medium text-[#E6EAF0]">
        {data.title as string}
      </div>
    </div>
  );
};

export const RunNode: React.FC<NodeProps> = ({ data, selected }) => {
  const isWhatIf = Boolean(data.parentRunId);

  return (
    <div
      className={`w-[190px] rounded-[10px] bg-[#161B22] p-3 transition-all ${
        selected
          ? 'border-2 border-[#3DD6B5] shadow-[0_0_15px_rgba(61,214,181,0.3)]'
          : 'border border-[#E6EAF0]'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-[#E6EAF0] !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-[#E6EAF0] !w-2 !h-2" />
      <div className="font-mono text-[9px] uppercase tracking-wider text-[#9AA4B2] mb-1">
        {isWhatIf ? 'RUN B · WHAT-IF' : 'RUN A · ROOT'}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-[#E6EAF0]">
          {data.title as string}
        </span>
        <span className="font-mono text-[11px] font-semibold text-[#3DD6B5]">
          match
        </span>
      </div>
    </div>
  );
};

export const ResultNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <div
      className={`w-[190px] rounded-[10px] bg-[#161B22] p-3 transition-all ${
        selected
          ? 'border-2 border-[#3DD6B5] shadow-[0_0_15px_rgba(61,214,181,0.3)]'
          : 'border border-[#3DD6B5]'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-[#3DD6B5] !w-2 !h-2" />
      <div className="font-mono text-[9px] uppercase tracking-wider text-[#3DD6B5] mb-1">
        RESULT · EVALUATED
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-[#E6EAF0]">
          {data.title as string}
        </span>
        <span className="font-mono text-[11px] font-semibold text-[#3DD6B5]">
          pass
        </span>
      </div>
    </div>
  );
};

export const NoteNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <div
      className={`w-[190px] rounded-[10px] bg-[#161B22] p-3 transition-all ${
        selected
          ? 'border-2 border-[#F5A524] shadow-[0_0_15px_rgba(245,165,36,0.3)]'
          : 'border border-[#F5A524]/60'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-[#F5A524] !w-2 !h-2" />
      <div className="font-mono text-[9px] uppercase tracking-wider text-[#F5A524] mb-1">
        AUDITOR NOTE
      </div>
      <div className="text-[11px] text-[#E6EAF0] leading-snug line-clamp-2">
        {data.body as string}
      </div>
    </div>
  );
};
