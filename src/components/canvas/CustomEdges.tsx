import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';

const RELATION_STROKES: Record<string, string> = {
  supports: '#3DD6B5',
  contradicts: '#F5A524',
  cites: '#6EA8FE',
  uses_dataset: '#F472B6',
  tests: '#A78BFA',
  produced: '#3DD6B5',
  derived_from: '#E6EAF0',
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
  const strokeColor = RELATION_STROKES[relation] || '#252C36';

  let displayLabel = relation.replace('_', ' ');
  if (relation === 'derived_from') displayLabel = 'what-if';
  if (relation === 'contradicts') displayLabel = 'contradicts?';

  return (
    <>
      {/* Selected Edge Teal Halo as seen in the Mockup */}
      {selected && (
        <BaseEdge
          id={`${id}-halo`}
          path={edgePath}
          style={{
            stroke: '#3DD6B5',
            strokeWidth: 8,
            opacity: 0.22,
          }}
        />
      )}

      {/* Main Edge Path */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: strokeColor,
          strokeWidth: selected ? 2.5 : 1.5,
          strokeDasharray: isDashed ? (relation === 'derived_from' ? '3 4' : '5 4') : undefined,
          opacity: selected ? 1 : 0.85,
        }}
      />

      {/* Relation Pill / Label */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan cursor-pointer"
          onClick={() => {
            if (data?.onSelectEdge && typeof data.onSelectEdge === 'function') {
              data.onSelectEdge(id);
            }
          }}
        >
          <div
            className={`font-mono text-[9px] px-1.5 py-0.5 rounded transition-all hover:scale-110 select-none ${
              selected
                ? 'bg-[#161B22] text-[#3DD6B5] border border-[#3DD6B5]'
                : 'bg-[#0E1116]/80 text-[#9AA4B2] hover:text-[#E6EAF0]'
            }`}
          >
            {displayLabel}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};
