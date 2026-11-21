import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';

const RELATION_STROKES: Record<string, string> = {
  supports: '#f97316',
  contradicts: '#ef4444',
  cites: '#ffffff',
  uses_dataset: '#737373',
  tests: '#e5e5e5',
  produced: '#f97316',
  derived_from: '#525252',
};

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
  const strokeColor = RELATION_STROKES[relation] || '#262626';
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
            stroke: strokeColor === '#262626' ? '#f97316' : strokeColor,
            strokeWidth: 9,
            opacity: 0.4,
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
            className={`group flex items-center gap-1 font-mono text-[9px] px-2 py-0.5 rounded transition-all duration-200 hover:scale-105 select-none shadow-xl ${
              isLineageActive
                ? 'bg-[#000000] text-[#f97316] border border-[#f97316] ring-1 ring-[#f97316]/50'
                : 'bg-[#0a0a0a] text-[#a3a3a3] border border-[#262626] hover:border-[#404040] hover:text-white'
            }`}
          >
            <span className="uppercase tracking-wider">{displayLabel}</span>
            {confidence && (
              <span className="text-[8px] opacity-75 font-mono text-[#737373]">
                {Math.round(confidence * 100)}%
              </span>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};
