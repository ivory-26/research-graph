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
  const isDimmed = Boolean(data.isDimmed);
  const isHighlighted = Boolean(data.isHighlighted) || selected;
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
      className={`node-premium-card w-[185px] rounded-none p-3 transition-all ${
        isDimmed ? 'node-dimmed' : ''
      } ${
        isHighlighted
          ? 'border-2 border-[#f97316] shadow-[0_0_25px_rgba(249,115,22,0.45)] node-highlighted'
          : isHero
          ? 'border border-[var(--border-secondary)] hover:border-[#f97316]'
          : 'border border-[var(--border-primary)] hover:border-[var(--border-secondary)]'
      }`}
    >
      {/* Node Toolbar on Selection with Sharp Corners */}
      <NodeToolbar
        isVisible={selected}
        position={Position.Top}
        className="flex items-center gap-1 rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] px-2 py-1 shadow-2xl backdrop-blur-md mb-1"
      >
        <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--text-dim)] mr-1">Source:</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded-none bg-[var(--bg-surface-hover)] px-1.5 py-0.5 text-[9px] font-mono text-[var(--text-primary)] hover:text-[#f97316] transition"
          title="Copy DOI"
        >
          {copied ? <Check className="h-3 w-3 text-[#f97316]" /> : <Copy className="h-3 w-3" />}
          <span>{copied ? 'Copied' : 'DOI'}</span>
        </button>
      </NodeToolbar>

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[var(--accent-orange)] !w-2.5 !h-2.5 !rounded-none"
      />

      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
          <span
            className={`h-1.5 w-1.5 rounded-none ${
              isHero ? 'bg-[#f97316] pulse-dot' : 'bg-[var(--text-dim)]'
            }`}
          />
          <span className="font-semibold">{isHero ? 'SOURCE · PRIMARY' : 'SOURCE · SUPPORT'}</span>
        </div>
        <FileText className="h-3 w-3 text-[var(--text-muted)]" />
      </div>

      <div className="text-[12px] font-medium text-[var(--text-primary)] truncate">
        {data.title as string}
      </div>

      <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-dim)]">
        <span className="font-mono text-[9px] truncate max-w-[110px] text-[var(--text-muted)]">
          {data.doi ? String(data.doi) : 'Open Access'}
        </span>
        <span className="font-mono">{data.pages ? `${data.pages} pp` : ''}</span>
      </div>
    </div>
  );
};

export const ClaimNode: React.FC<NodeProps> = ({ data, selected }) => {
  const isDimmed = Boolean(data.isDimmed);
  const isHighlighted = Boolean(data.isHighlighted) || selected;

  return (
    <div
      className={`node-premium-card w-[230px] rounded-none p-3.5 transition-all ${
        isDimmed ? 'node-dimmed' : ''
      } ${
        isHighlighted
          ? 'border-2 border-[#f97316] shadow-[0_0_30px_rgba(249,115,22,0.5)] node-highlighted'
          : 'border-[1.5px] border-[#f97316] shadow-[0_0_15px_rgba(249,115,22,0.15)]'
      }`}
    >
      <NodeToolbar
        isVisible={selected}
        position={Position.Top}
        className="flex items-center gap-1.5 rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] px-2 py-1 shadow-2xl backdrop-blur-md mb-1"
      >
        <span className="badge-solid-white rounded-none">AUDITED HYPOTHESIS</span>
      </NodeToolbar>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[#f97316] !w-2.5 !h-2.5 !rounded-none"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[#f97316] !w-2.5 !h-2.5 !rounded-none"
      />

      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-wider text-[#f97316]">
          <span className="h-1.5 w-1.5 rounded-none bg-[#f97316] pulse-dot" />
          <span>{(data.sublabel as string) || 'CLAIM · DETERMINISTIC'}</span>
        </div>
        <Target className="h-3.5 w-3.5 text-[#f97316]" />
      </div>

      <div className="text-[12px] font-medium leading-snug text-[var(--text-primary)]">
        {(data.text as string) || (data.title as string)}
      </div>

      <div className="mt-2.5 flex items-center justify-between border-t border-[var(--border-primary)] pt-1.5 font-mono text-[9px] text-[var(--text-muted)]">
        <span className="text-[#f97316] font-semibold">Deterministic eval</span>
        <span>Adapted mode</span>
      </div>
    </div>
  );
};

export const MethodNode: React.FC<NodeProps> = ({ data, selected }) => {
  const isDimmed = Boolean(data.isDimmed);
  const isHighlighted = Boolean(data.isHighlighted) || selected;

  return (
    <div
      className={`node-premium-card w-[190px] rounded-none p-3 transition-all ${
        isDimmed ? 'node-dimmed' : ''
      } ${
        isHighlighted
          ? 'border-2 border-[#f97316] shadow-[0_0_25px_rgba(249,115,22,0.45)] node-highlighted'
          : 'border border-[var(--border-secondary)] hover:border-[var(--text-primary)]'
      }`}
    >
      <NodeToolbar
        isVisible={selected}
        position={Position.Top}
        className="flex items-center gap-1 rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] px-2 py-1 shadow-2xl backdrop-blur-md mb-1"
      >
        <span className="font-mono text-[9px] text-[var(--text-primary)]">scikit-learn 1.9.1</span>
      </NodeToolbar>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[var(--accent-orange)] !w-2.5 !h-2.5 !rounded-none"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[var(--accent-orange)] !w-2.5 !h-2.5 !rounded-none"
      />

      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-[var(--text-dim)]">
          <span className="h-1.5 w-1.5 rounded-none bg-[var(--text-dim)]" />
          <span>METHOD</span>
        </div>
        <Cpu className="h-3 w-3 text-[var(--text-muted)]" />
      </div>

      <div className="text-[12px] font-medium text-[var(--text-primary)]">
        {data.title as string}
      </div>

      <div className="mt-1 text-[10px] text-[var(--text-dim)] font-mono">
        RandomForest · 100 trees
      </div>
    </div>
  );
};

export const DatasetNode: React.FC<NodeProps> = ({ data, selected }) => {
  const isDimmed = Boolean(data.isDimmed);
  const isHighlighted = Boolean(data.isHighlighted) || selected;

  return (
    <div
      className={`node-premium-card w-[190px] rounded-none p-3 transition-all ${
        isDimmed ? 'node-dimmed' : ''
      } ${
        isHighlighted
          ? 'border-2 border-[#f97316] shadow-[0_0_25px_rgba(249,115,22,0.45)] node-highlighted'
          : 'border border-[var(--border-primary)] hover:border-[var(--border-secondary)]'
      }`}
    >
      <NodeToolbar
        isVisible={selected}
        position={Position.Top}
        className="flex items-center gap-1.5 rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] px-2 py-1 shadow-2xl backdrop-blur-md mb-1"
      >
        <ShieldCheck className="h-3.5 w-3.5 text-[#f97316]" />
        <span className="font-mono text-[9px] text-[var(--text-primary)]">SHA-256 Pinned</span>
      </NodeToolbar>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[var(--accent-orange)] !w-2.5 !h-2.5 !rounded-none"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[var(--accent-orange)] !w-2.5 !h-2.5 !rounded-none"
      />

      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-[var(--text-dim)]">
          <span className="h-1.5 w-1.5 rounded-none bg-[#f97316]" />
          <span>DATASET · PINNED</span>
        </div>
        <Database className="h-3 w-3 text-[var(--text-muted)]" />
      </div>

      <div className="text-[12px] font-medium text-[var(--text-primary)]">
        {data.title as string}
      </div>

      <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-dim)] font-mono">
        <span>569 rows</span>
        <span className="text-[var(--text-muted)]">+3 noise cols</span>
      </div>
    </div>
  );
};

export const RunNode: React.FC<NodeProps> = ({ data, selected }) => {
  const isWhatIf = Boolean(data.parentRunId);
  const isDimmed = Boolean(data.isDimmed);
  const isHighlighted = Boolean(data.isHighlighted) || selected;

  return (
    <div
      className={`node-premium-card w-[190px] rounded-none p-3 transition-all ${
        isDimmed ? 'node-dimmed' : ''
      } ${
        isHighlighted
          ? 'border-2 border-[#f97316] shadow-[0_0_25px_rgba(249,115,22,0.45)] node-highlighted'
          : 'border border-[var(--border-secondary)]'
      }`}
    >
      <NodeToolbar
        isVisible={selected}
        position={Position.Top}
        className="flex items-center gap-1.5 rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] px-2 py-1 shadow-2xl backdrop-blur-md mb-1"
      >
        <span className="font-mono text-[9px] text-[var(--text-primary)]">E2B Sandbox · none network</span>
      </NodeToolbar>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[var(--accent-orange)] !w-2.5 !h-2.5 !rounded-none"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[var(--accent-orange)] !w-2.5 !h-2.5 !rounded-none"
      />

      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-[var(--text-dim)]">
          <span
            className={`h-1.5 w-1.5 rounded-none ${
              isWhatIf ? 'bg-[var(--text-primary)]' : 'bg-[#f97316]'
            }`}
          />
          <span>{isWhatIf ? 'RUN B · WHAT-IF' : 'RUN A · ROOT'}</span>
        </div>
        {isWhatIf ? (
          <GitBranch className="h-3 w-3 text-[var(--text-primary)]" />
        ) : (
          <Play className="h-3 w-3 text-[#f97316]" />
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-[var(--text-primary)] truncate mr-1">
          {data.title as string}
        </span>
        <span className="badge-orange-outline !text-[8px] !px-1 rounded-none">
          match
        </span>
      </div>

      <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-dim)] font-mono">
        <span>adapted</span>
        <span className="text-[var(--text-primary)]">3.4s (CPU)</span>
      </div>
    </div>
  );
};

export const ResultNode: React.FC<NodeProps> = ({ data, selected }) => {
  const isDimmed = Boolean(data.isDimmed);
  const isHighlighted = Boolean(data.isHighlighted) || selected;

  return (
    <div
      className={`node-premium-card w-[190px] rounded-none p-3 transition-all ${
        isDimmed ? 'node-dimmed' : ''
      } ${
        isHighlighted
          ? 'border-2 border-[#f97316] shadow-[0_0_25px_rgba(249,115,22,0.45)] node-highlighted'
          : 'border border-[var(--border-primary)] hover:border-[var(--border-secondary)]'
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[#f97316] !w-2.5 !h-2.5 !rounded-none"
      />

      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-[#f97316]">
          <span className="h-1.5 w-1.5 rounded-none bg-[#f97316] pulse-dot" />
          <span className="font-bold">VERIFIED RESULT</span>
        </div>
        <CheckCircle2 className="h-3.5 w-3.5 text-[#f97316]" />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-[var(--text-primary)] truncate mr-1">
          {data.title as string}
        </span>
        <span className="badge-solid-white !text-[8px] !px-1 rounded-none">
          pass
        </span>
      </div>

      <div className="mt-1 text-[10px] text-[var(--text-dim)] font-mono truncate">
        {data.criteria as string || 'Deterministic arithmetic check'}
      </div>
    </div>
  );
};

export const NoteNode: React.FC<NodeProps> = ({ data, selected }) => {
  const isDimmed = Boolean(data.isDimmed);
  const isHighlighted = Boolean(data.isHighlighted) || selected;

  return (
    <div
      className={`node-premium-card w-[190px] rounded-none p-3 transition-all ${
        isDimmed ? 'node-dimmed' : ''
      } ${
        isHighlighted
          ? 'border-2 border-[#f97316] shadow-[0_0_25px_rgba(249,115,22,0.45)] node-highlighted'
          : 'border border-[var(--border-primary)] hover:border-[var(--border-secondary)]'
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[#f97316] !w-2.5 !h-2.5 !rounded-none"
      />
      <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
        AUDITOR NOTE
      </div>
      <div className="text-[11px] text-[var(--text-secondary)] leading-snug line-clamp-2">
        {data.body as string}
      </div>
    </div>
  );
};
