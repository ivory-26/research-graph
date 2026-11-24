import React, { useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getStraightPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import { useTheme } from '../../context/ThemeContext';

export const CustomEvidenceEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
  markerEnd,
  selected,
}) => {
  const { theme } = useTheme();
  const [isEdgeHovered, setIsEdgeHovered] = useState(false);

  const isMemoryMode = Boolean(data?.isMemoryMode);

  // In Memory Graph mode, use straight luminous filaments connecting circular nodes omni-directionally.
  // In Cards mode, use smooth horizontal bezier curves between card anchors.
  const [bezierPath, bLabelX, bLabelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const [straightPath, sLabelX, sLabelY] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  const edgePath = isMemoryMode ? straightPath : bezierPath;
  const labelX = isMemoryMode ? sLabelX : bLabelX;
  const labelY = isMemoryMode ? sLabelY : bLabelY;

  const relation = (data?.relation as string) || 'cites';

  // Crisp relation strokes for technical precision
  const relationStrokesDark: Record<string, string> = {
    supports: '#f97316',
    contradicts: '#ef4444',
    cites: '#38bdf8',
    uses_dataset: '#ec4899',
    tests: '#a855f7',
    produced: '#f59e0b',
    derived_from: '#64748b',
  };

  const relationStrokesLight: Record<string, string> = {
    supports: '#ea580c',
    contradicts: '#dc2626',
    cites: '#0284c7',
    uses_dataset: '#db2777',
    tests: '#9333ea',
    produced: '#d97706',
    derived_from: '#94a3b8',
  };

  const currentStrokes = theme === 'dark' ? relationStrokesDark : relationStrokesLight;
  const strokeColor = currentStrokes[relation] || (theme === 'dark' ? '#475569' : '#94a3b8');
  const confidence = typeof data?.confidence === 'number' ? data.confidence : null;

  const linkThickness = typeof data?.linkThickness === 'number' ? data.linkThickness : 1.2;
  const isLineageActive = Boolean(data?.isLineageActive) || selected;
  const isDimmed = Boolean(data?.isDimmed);

  let displayLabel = relation.replace('_', ' ');
  if (relation === 'derived_from') displayLabel = 'what-if';
  if (relation === 'contradicts') displayLabel = 'contradicts?';

  // In Memory Graph mode: only show edge label pill if specifically hovered or individually selected.
  // In Cards mode: show label when lineage active or hovered.
  const showEdgeBadge = isMemoryMode
    ? isEdgeHovered || selected
    : isLineageActive || isEdgeHovered || selected;

  return (
    <g
      className="react-flow__edge-group cursor-pointer"
      onMouseEnter={() => setIsEdgeHovered(true)}
      onMouseLeave={() => setIsEdgeHovered(false)}
      onClick={() => {
        if (data?.onSelectEdge && typeof data.onSelectEdge === 'function') {
          data.onSelectEdge(id);
        }
      }}
    >
      {/* Invisible wider interaction path for effortless hover & click */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        className="cursor-pointer"
      />

      {/* Main Solid Edge Connection (Simple, Clean, and Solid - Zero Flashing Animations) */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={isMemoryMode ? undefined : markerEnd}
        className={isDimmed ? 'edge-dimmed' : isLineageActive ? 'edge-highlighted' : ''}
        style={{
          ...style,
          stroke: isLineageActive ? (theme === 'dark' ? '#f97316' : '#ea580c') : strokeColor,
          strokeWidth: isLineageActive
            ? 2.0
            : isMemoryMode
            ? 1.2
            : linkThickness,
          opacity: isDimmed ? 0.05 : isLineageActive ? 0.95 : isMemoryMode ? 0.35 : 0.75,
          transition: 'stroke 0.2s ease, stroke-width 0.2s ease, opacity 0.2s ease',
        }}
      />

      {/* Interactive Relation Pill / Label (Only shown on edge hover/selection to avoid crowding) */}
      {showEdgeBadge && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              zIndex: 35,
            }}
            className="nodrag nopan cursor-pointer select-none animate-fade-in"
            onClick={(e) => {
              e.stopPropagation();
              if (data?.onSelectEdge && typeof data.onSelectEdge === 'function') {
                data.onSelectEdge(id);
              }
            }}
          >
            <div
              className={`flex items-center gap-1 font-mono text-[9px] px-2 py-0.5 rounded-none shadow-xl border transition-all duration-150 ${
                isLineageActive || isEdgeHovered
                  ? 'bg-[var(--bg-surface)] text-[#f97316] border-[#f97316] ring-1 ring-[#f97316]/40'
                  : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border-primary)]'
              }`}
            >
              <span className="uppercase tracking-wider font-semibold">{displayLabel}</span>
              {confidence && (
                <span className="text-[8px] opacity-80 font-mono text-[var(--text-dim)]">
                  {Math.round(confidence * 100)}%
                </span>
              )}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
};
