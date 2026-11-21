import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';

const RELATION_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  supports: { color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-950/80', border: 'border-emerald-300 dark:border-emerald-800' },
  contradicts: { color: 'text-rose-700 dark:text-rose-300', bg: 'bg-rose-50 dark:bg-rose-950/80', border: 'border-rose-300 dark:border-rose-800' },
  cites: { color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-950/80', border: 'border-blue-300 dark:border-blue-800' },
  uses_dataset: { color: 'text-purple-700 dark:text-purple-300', bg: 'bg-purple-50 dark:bg-purple-950/80', border: 'border-purple-300 dark:border-purple-800' },
  tests: { color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-950/80', border: 'border-amber-300 dark:border-amber-800' },
  produced: { color: 'text-cyan-700 dark:text-cyan-300', bg: 'bg-cyan-50 dark:bg-cyan-950/80', border: 'border-cyan-300 dark:border-cyan-800' },
  derived_from: { color: 'text-indigo-700 dark:text-indigo-300', bg: 'bg-indigo-50 dark:bg-indigo-950/80', border: 'border-indigo-300 dark:border-indigo-800' },
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
  const confidence = data?.confidence as number | undefined;
  const relStyle = RELATION_STYLES[relation] || RELATION_STYLES.cites;

  const isDashed = status === 'suggested';

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          strokeWidth: 2,
          strokeDasharray: isDashed ? '6 4' : undefined,
          stroke: isDashed ? '#94a3b8' : '#64748b',
        }}
      />
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
            className={`group flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold shadow-sm transition-all hover:scale-105 hover:shadow-md ${relStyle.bg} ${relStyle.border} ${relStyle.color}`}
          >
            <span>{relation.replace('_', ' ')}</span>
            {confidence && (
              <span className="text-[9px] opacity-75">
                ({Math.round(confidence * 100)}%)
              </span>
            )}
            {isDashed && (
              <span className="rounded bg-amber-200/60 dark:bg-amber-800 px-1 text-[8px] text-amber-900 dark:text-amber-100">
                suggested
              </span>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};
