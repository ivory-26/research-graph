import React, { useState } from 'react';
import { Handle, Position, useViewport } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import {
  FileText,
  Target,
  Cpu,
  Database,
  Play,
  CheckCircle2,
  GitBranch,
  FileCode,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

// Category color palettes matching Obsidian & Kinetic AI reference visual standards
export const NODE_CATEGORY_THEMES: Record<
  string,
  {
    name: string;
    color: string;
    glow: string;
    ring: string;
    bg: string;
    lightBg: string;
    border: string;
    hoverBorder: string;
  }
> = {
  source: {
    name: 'Paper / Source',
    color: '#0284c7', // Cyan
    glow: 'rgba(56, 189, 248, 0.4)',
    ring: 'rgba(56, 189, 248, 0.18)',
    bg: '#08090b',
    lightBg: '#ffffff',
    border: '#0284c7',
    hoverBorder: '#38bdf8',
  },
  claim: {
    name: 'Claim / Hypothesis',
    color: '#f97316', // Orange
    glow: 'rgba(249, 115, 22, 0.5)',
    ring: 'rgba(249, 115, 22, 0.22)',
    bg: '#08090b',
    lightBg: '#ffffff',
    border: '#f97316',
    hoverBorder: '#fb923c',
  },
  method: {
    name: 'Method / Algorithm',
    color: '#9333ea', // Violet
    glow: 'rgba(168, 85, 247, 0.4)',
    ring: 'rgba(168, 85, 247, 0.18)',
    bg: '#08090b',
    lightBg: '#ffffff',
    border: '#9333ea',
    hoverBorder: '#a855f7',
  },
  dataset: {
    name: 'Dataset / Fixture',
    color: '#db2777', // Pink
    glow: 'rgba(236, 72, 153, 0.4)',
    ring: 'rgba(236, 72, 153, 0.18)',
    bg: '#08090b',
    lightBg: '#ffffff',
    border: '#db2777',
    hoverBorder: '#ec4899',
  },
  run: {
    name: 'Experiment / Run',
    color: '#d97706', // Amber
    glow: 'rgba(245, 158, 11, 0.4)',
    ring: 'rgba(245, 158, 11, 0.18)',
    bg: '#08090b',
    lightBg: '#ffffff',
    border: '#d97706',
    hoverBorder: '#f59e0b',
  },
  result: {
    name: 'Result',
    color: '#059669', // Emerald
    glow: 'rgba(16, 185, 129, 0.45)',
    ring: 'rgba(16, 185, 129, 0.2)',
    bg: '#08090b',
    lightBg: '#ffffff',
    border: '#059669',
    hoverBorder: '#10b981',
  },
  note: {
    name: 'Note / Annotation',
    color: '#ca8a04', // Yellow
    glow: 'rgba(234, 179, 8, 0.35)',
    ring: 'rgba(234, 179, 8, 0.18)',
    bg: '#08090b',
    lightBg: '#ffffff',
    border: '#ca8a04',
    hoverBorder: '#eab308',
  },
};

export const MemoryNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const { theme: appTheme } = useTheme();
  const isDark = appTheme === 'dark';
  const { zoom } = useViewport();
  const [isHovered, setIsHovered] = useState(false);

  const nodeType = (data?.type as string) || 'source';
  const theme = NODE_CATEGORY_THEMES[nodeType] || NODE_CATEGORY_THEMES.source;

  const title = (data?.title as string) || (data?.label as string) || id;
  const sublabel = (data?.sublabel as string) || theme.name;
  const degree = typeof data?.degree === 'number' ? data.degree : 1;
  const radius = typeof data?.radius === 'number' ? data.radius : 21;
  const nodeScale = typeof data?.nodeScale === 'number' ? data.nodeScale : 1;

  const isDimmed = Boolean(data?.isDimmed);
  const isHighlighted = Boolean(data?.isHighlighted) || selected;
  const clusterHighlighting = Boolean(data?.clusterHighlighting);
  const labelVisibility = (data?.labelVisibility as 'selective' | 'always' | 'off') || 'selective';

  // Controlled node sizing: 38–46px normal, 50–54px central/hub nodes.
  // Selected nodes strictly RETAIN original physical dimensions (no scaling jumps)
  const isSelected = selected;
  const isMajorHub = degree >= 3 || nodeType === 'claim';
  const isDirectNeighbor = Boolean(data?.isDirectNeighbor);
  const hasActiveSelection = Boolean(data?.hasActiveSelection);

  // Controlled diameter: bounded between 38px and 54px
  const baseDiameter = Math.round(radius * 2 * nodeScale);
  const diameter = Math.min(Math.max(baseDiameter, 38), 54);
  const iconSize = diameter > 48 ? 19 : diameter > 42 ? 16 : 14;

  // Zoom-Aware Level-of-Detail & Contextual Label Visibility:
  // - Zoomed out (zoom < 0.65): Show only selected node or primary claim
  // - Normal zoom (0.65 <= zoom <= 1.25):
  //   * Selected state: show selected node + immediate 1-hop neighbours
  //   * Default state: show important hubs (degree >= 3 or claim)
  //   * Unselected state: hide unnecessary labels to prevent crowding
  // - Zoomed in (zoom > 1.25): show all visible node titles
  let shouldRenderLabel = false;
  if (!isHovered && labelVisibility !== 'off') {
    if (labelVisibility === 'always') {
      shouldRenderLabel = true;
    } else if (zoom < 0.65) {
      shouldRenderLabel = isSelected || nodeType === 'claim';
    } else if (zoom > 1.25) {
      shouldRenderLabel = !isDimmed;
    } else {
      // Normal zoom level
      if (hasActiveSelection) {
        shouldRenderLabel = isSelected || isDirectNeighbor;
      } else {
        shouldRenderLabel = isMajorHub;
      }
    }
  }

  // Small crisp icon inside circular core
  const renderIcon = () => {
    const iconColor = isSelected || isHighlighted ? '#ffffff' : theme.color;
    switch (nodeType) {
      case 'source':
        return <FileText style={{ width: iconSize, height: iconSize, color: iconColor }} />;
      case 'claim':
        return <Target style={{ width: iconSize, height: iconSize, color: iconColor }} />;
      case 'method':
        return <Cpu style={{ width: iconSize, height: iconSize, color: iconColor }} />;
      case 'dataset':
        return <Database style={{ width: iconSize, height: iconSize, color: iconColor }} />;
      case 'run':
        return data?.parentRunId ? (
          <GitBranch style={{ width: iconSize, height: iconSize, color: iconColor }} />
        ) : (
          <Play style={{ width: iconSize, height: iconSize, color: iconColor, fill: 'currentColor' }} />
        );
      case 'result':
        return <CheckCircle2 style={{ width: iconSize, height: iconSize, color: iconColor }} />;
      default:
        return <FileCode style={{ width: iconSize, height: iconSize, color: iconColor }} />;
    }
  };

  return (
    <div
      className={`memory-node-wrapper relative flex items-center justify-center select-none cursor-pointer transition-opacity duration-200 ${isDimmed ? 'opacity-20 filter blur-[0.2px]' : 'opacity-100'
        } ${isSelected ? 'z-40' : isHovered ? 'z-40' : isHighlighted ? 'z-30' : 'z-20'}`}
      onMouseEnter={() => {
        setIsHovered(true);
        if (typeof data?.onNodeHover === 'function') {
          (data.onNodeHover as (id: string) => void)(id);
        }
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        if (typeof data?.onNodeLeave === 'function') {
          (data.onNodeLeave as () => void)();
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (typeof data?.onNodeDoubleClick === 'function') {
          (data.onNodeDoubleClick as (id: string) => void)(id);
        }
      }}
    >
      {/* Invisible omni-directional center handles so filaments radiate 360° from circular core */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-0 !h-0 !opacity-0 !border-none !bg-transparent !top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2 !pointer-events-none"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-0 !h-0 !opacity-0 !border-none !bg-transparent !top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2 !pointer-events-none"
      />

      {/* Atmospheric Ambient Glow for Selected / Hub / Cluster Nodes (No physical size change) */}
      {(isSelected || isHovered || (clusterHighlighting && !isDimmed)) && (
        <div
          className="absolute rounded-full pointer-events-none transition-all duration-300"
          style={{
            width: diameter + (clusterHighlighting ? 34 : 20),
            height: diameter + (clusterHighlighting ? 34 : 20),
            background: `radial-gradient(circle, ${clusterHighlighting ? theme.glow : theme.ring} 0%, transparent 72%)`,
            opacity: isSelected || isHovered ? 0.9 : 0.45,
          }}
        />
      )}

      {/* Subtle Restrained Outer Glow Halo Ring */}
      <div
        className="absolute rounded-full pointer-events-none transition-all duration-200"
        style={{
          width: diameter + (isSelected ? 10 : isHovered ? 8 : 4),
          height: diameter + (isSelected ? 10 : isHovered ? 8 : 4),
          border: `1.5px solid ${isSelected ? theme.color : isHovered ? theme.hoverBorder : theme.border}`,
          opacity: isSelected ? 0.95 : isHovered ? 0.8 : isHighlighted ? 0.45 : 0.22,
          boxShadow: isSelected || isHovered ? `0 0 16px ${theme.glow}` : `0 0 4px ${theme.ring}`,
        }}
      />

      {/* Main Circular Node Core - 100% Solid Opaque Background (Terminates connecting lines cleanly) */}
      <div
        className="rounded-full flex items-center justify-center transition-all duration-150 shadow-lg relative z-10"
        style={{
          width: diameter,
          height: diameter,
          backgroundColor: isSelected || isHighlighted ? theme.color : isDark ? '#08090b' : '#ffffff',
          border: `2px solid ${isSelected
            ? (isDark ? '#ffffff' : '#0f172a')
            : isHovered
              ? theme.hoverBorder
              : theme.color
            }`,
          boxShadow: isDark
            ? `inset 0 1px 2px rgba(255, 255, 255, 0.12), 0 3px 10px rgba(0, 0, 0, 0.85)`
            : `inset 0 1px 2px rgba(255, 255, 255, 0.9), 0 2px 8px rgba(0, 0, 0, 0.08)`,
        }}
      >
        <div className="flex items-center justify-center">
          {renderIcon()}
        </div>
      </div>

      {/* Collision-Aware Compact Label (Never renders across node circles) */}
      {shouldRenderLabel && (
        <div
          className="absolute pointer-events-none transition-opacity duration-200 text-center z-30 top-[calc(100%+6px)]"
          style={{ width: 'max-content', maxWidth: '130px' }}
        >
          <div
            className={`px-2 py-0.5 font-mono text-[9px] font-medium rounded-none backdrop-blur-md shadow-md border truncate leading-tight transition-colors ${isSelected
              ? 'bg-[var(--bg-surface)] border-[#f97316] text-[#f97316] font-bold ring-1 ring-[#f97316]/40'
              : 'bg-[var(--bg-surface)]/95 border-[var(--border-primary)] text-[var(--text-secondary)]'
              }`}
          >
            {title}
          </div>
        </div>
      )}

      {/* Unified Tooltip on Direct Hover (Reveals complete title & connection metadata) */}
      {isHovered && (
        <div
          className="absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 z-50 pointer-events-none whitespace-nowrap animate-fade-in"
          style={{ width: 'max-content' }}
        >
          <div
            className={`flex flex-col gap-1 px-2.5 py-1.5 border shadow-2xl backdrop-blur-xl rounded-none ${isDark
              ? 'bg-[#08090b]/98 border-[#1e2229] text-[var(--text-primary)]'
              : 'bg-white/98 border-slate-200 text-slate-800 shadow-xl'
              }`}
            style={{ borderLeft: `3px solid ${theme.color}` }}
          >
            <div className="flex items-center gap-2">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: theme.color, boxShadow: `0 0 6px ${theme.color}` }}
              />
              <span
                className="font-mono text-[9px] uppercase tracking-wider font-bold"
                style={{ color: theme.color }}
              >
                {sublabel}
              </span>
              <span className="font-mono text-[8px] text-[var(--text-dim)] border-l border-[var(--border-primary)] pl-2">
                {degree} {degree === 1 ? 'edge' : 'edges'}
              </span>
            </div>
            <div className="text-[11px] font-semibold text-[var(--text-primary)] max-w-xs truncate font-mono">
              {title}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
