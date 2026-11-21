import React, { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';
import {
  SourceNode,
  ClaimNode,
  MethodNode,
  DatasetNode,
  RunNode,
  ResultNode,
  NoteNode,
} from './CustomNodes';
import { CustomEvidenceEdge } from './CustomEdges';
import type { WorkspaceNode, WorkspaceEdge } from '../../data/demoWorkspace';

interface ResearchCanvasProps {
  initialNodes: WorkspaceNode[];
  initialEdges: WorkspaceEdge[];
  onSelectEdge: (edgeId: string) => void;
  onSelectNode?: (nodeId: string) => void;
}

export const ResearchCanvas: React.FC<ResearchCanvasProps> = ({
  initialNodes,
  initialEdges,
  onSelectEdge,
  onSelectNode,
}) => {
  const nodeTypes = useMemo(
    () => ({
      source: SourceNode,
      claim: ClaimNode,
      method: MethodNode,
      dataset: DatasetNode,
      run: RunNode,
      result: ResultNode,
      note: NoteNode,
    }),
    []
  );

  const edgeTypes = useMemo(
    () => ({
      customEvidenceEdge: CustomEvidenceEdge,
    }),
    []
  );

  // Transform workspace nodes to ReactFlow nodes
  const rfNodes: Node[] = useMemo(() => {
    return initialNodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
    }));
  }, [initialNodes]);

  // Transform workspace edges to ReactFlow edges with custom handler
  const rfEdges: Edge[] = useMemo(() => {
    return initialEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'customEvidenceEdge',
      data: {
        relation: e.relation,
        status: e.status,
        confidence: e.confidence,
        quote: e.quote,
        page: e.page,
        rationale: e.rationale,
        onSelectEdge,
      },
    }));
  }, [initialEdges, onSelectEdge]);

  const [nodes, , onNodesChange] = useNodesState(rfNodes);
  const [edges, , onEdgesChange] = useEdgesState(rfEdges);

  const handleNodeClick = useCallback(
    (_: any, node: Node) => {
      if (onSelectNode) {
        onSelectNode(node.id);
      }
    },
    [onSelectNode]
  );

  return (
    <div className="relative h-full w-full bg-slate-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#334155" />
        <Controls className="!bg-slate-900 !border-slate-800 !text-slate-300 [&>button]:!border-slate-800 [&>button]:!bg-slate-900 [&>button]:!text-slate-300 [&>button:hover]:!bg-slate-800" />
        <MiniMap
          nodeStrokeWidth={3}
          zoomable
          pannable
          className="!bg-slate-900/90 !border-slate-800 !rounded-xl"
          nodeColor={(n) => {
            switch (n.type) {
              case 'claim':
                return '#f59e0b';
              case 'method':
                return '#a855f7';
              case 'dataset':
                return '#10b981';
              case 'run':
                return '#06b6d4';
              case 'result':
                return '#10b981';
              case 'source':
                return '#3b82f6';
              default:
                return '#64748b';
            }
          }}
        />
      </ReactFlow>
    </div>
  );
};
