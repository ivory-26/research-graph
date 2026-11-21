import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
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

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const relation = (data?.relation as string) || 'cites';
  const status = (data?.status as string) || 'accepted';
  const isDashed = status === 'suggested' || relation === 'derived_from';

  const relationStrokesDark: Record<string, string> = {
    supports: '#f97316',
    contradicts: '#ef4444',
    cites: '#ffffff',
    uses_dataset: '#737373',
    tests: '#e5e5e5',
    produced: '#f97316',
    derived_from: '#525252',
  };

  const relationStrokesLight: Record<string, string> = {
    supports: '#ea580c',
    contradicts: '#dc2626',
    cites: '#475569',
    uses_dataset: '#94a3b8',
    tests: '#334155',
    produced: '#ea580c',
    derived_from: '#cbd5e1',
  };

  const currentStrokes = theme === 'dark' ? relationStrokesDark : relationStrokesLight;
  const strokeColor = currentStrokes[relation] || (theme === 'dark' ? '#262626' : '#e2e8f0');
  const confidence = typeof data?.confidence === 'number' ? data.confidence : null;

  const isLineageActive = Boolean(data?.isLineageActive) || selected;
  const isDimmed = Boolean(data?.isDimmed);

  let displayLabel = relation.replace('_', ' ');
  if (relation === 'derived_from') displayLabel = 'what-if';
  if (relation === 'contradicts') displayLabel = 'contradicts?';

  return (
    <>
      {/* Electric Halo along Edge Path for Selected / Lineage Active Edges */}
      {isLineageActive && (
        <BaseEdge
          id={`${id}-halo`}
          path={edgePath}
          className="edge-halo-pulse"
          style={{
            stroke: '#f97316',
            strokeWidth: 9,
            opacity: theme === 'dark' ? 0.4 : 0.25,
          }}
        />
      )}

      {/* Main Edge Path with Particle Flow on Active Lineage */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        className={`${isLineageActive ? 'edge-flow-active edge-highlighted' : ''} ${
          isDimmed ? 'edge-dimmed' : ''
        }`}
        style={{
          ...style,
          stroke: isLineageActive ? '#f97316' : strokeColor,
          strokeWidth: isLineageActive ? 2 : 1.2,
          strokeDasharray: isLineageActive
            ? '6 6'
            : isDashed
            ? relation === 'derived_from'
              ? '3 4'
              : '5 4'
            : undefined,
          opacity: isDimmed ? 0.08 : isLineageActive ? 1 : 0.8,
        }}
      />

      {/* Interactive Relation Pill / Label */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className={`nodrag nopan cursor-pointer transition-opacity duration-300 ${
            isDimmed ? 'opacity-20' : 'opacity-100'
          }`}
          onClick={() => {
            if (data?.onSelectEdge && typeof data.onSelectEdge === 'function') {
              data.onSelectEdge(id);
            }
          }}
        >
          <div
            className={`group flex items-center gap-1 font-mono text-[9px] px-2 py-0.5 rounded transition-all duration-200 hover:scale-105 select-none shadow-md ${
              isLineageActive
                ? 'bg-[var(--bg-primary)] text-[#f97316] border border-[#f97316] ring-1 ring-[#f97316]/50'
                : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border-primary)] hover:border-[var(--border-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <span className="uppercase tracking-wider">{displayLabel}</span>
            {confidence && (
              <span className="text-[8px] opacity-75 font-mono text-[var(--text-dim)]">
                {Math.round(confidence * 100)}%
              </span>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};
