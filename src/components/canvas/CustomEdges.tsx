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
  const confidence = typeof data?.confidence === 'number' ? data.confidence : null;

  let displayLabel = relation.replace('_', ' ');
  if (relation === 'derived_from') displayLabel = 'what-if';
  if (relation === 'contradicts') displayLabel = 'contradicts?';

  return (
    <>
      {/* Selected Edge Teal Halo */}
      {selected && (
        <BaseEdge
          id={`${id}-halo`}
          path={edgePath}
          style={{
            stroke: '#3DD6B5',
            strokeWidth: 8,
            opacity: 0.25,
          }}
        />
      )}

      {/* Main Edge Path */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        className={selected ? 'edge-flow-active' : undefined}
        style={{
          ...style,
          stroke: strokeColor,
          strokeWidth: selected ? 2.5 : 1.5,
          strokeDasharray: selected
            ? '6 6'
            : isDashed
            ? relation === 'derived_from'
              ? '3 4'
              : '5 4'
            : undefined,
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
            className={`group flex items-center gap-1 font-mono text-[9px] px-2 py-0.5 rounded-full transition-all duration-200 hover:scale-110 select-none shadow-md ${
              selected
                ? 'bg-[#161B22] text-[#3DD6B5] border border-[#3DD6B5] ring-2 ring-[#3DD6B5]/20'
                : 'bg-[#161B22]/90 text-[#9AA4B2] border border-[#252C36] hover:border-[#3A4452] hover:text-[#E6EAF0]'
            }`}
          >
            <span>{displayLabel}</span>
            {confidence && (
              <span className="text-[8px] opacity-75 font-sans">
                {Math.round(confidence * 100)}%
              </span>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};
