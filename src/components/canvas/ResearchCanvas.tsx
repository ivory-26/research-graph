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
  selectedEdgeId: string | null;
  onSelectEdge: (edgeId: string) => void;
  onSelectNode?: (nodeId: string) => void;
}

export const ResearchCanvas: React.FC<ResearchCanvasProps> = ({
  initialNodes,
  initialEdges,
  selectedEdgeId,
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

  const rfNodes: Node[] = useMemo(() => {
    return initialNodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
    }));
  }, [initialNodes]);

  const rfEdges: Edge[] = useMemo(() => {
    return initialEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'customEvidenceEdge',
      selected: e.id === selectedEdgeId,
      data: {
        relation: e.relation,
        status: e.status,
        confidence: e.confidence,
        quote: e.quote,
        page: e.page,
        charStart: e.charStart,
        charEnd: e.charEnd,
        chunkNumber: e.chunkNumber,
        sourceTitle: e.sourceTitle,
        targetTitle: e.targetTitle,
        rationale: e.rationale,
        onSelectEdge,
      },
    }));
  }, [initialEdges, selectedEdgeId, onSelectEdge]);

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

  const handleEdgeClick = useCallback(
    (_: any, edge: Edge) => {
      onSelectEdge(edge.id);
    },
    [onSelectEdge]
  );

  return (
    <div className="relative h-full w-full bg-[#0E1116] select-none">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.3}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#252C36" />
        <Controls className="!bg-[#161B22] !border-[#252C36] !text-[#9AA4B2]" />
        <MiniMap
          nodeStrokeWidth={2}
          zoomable
          pannable
          className="!bg-[#161B22] !border-[#252C36] !rounded-xl"
          nodeColor={(n) => {
            switch (n.type) {
              case 'claim':
                return '#3DD6B5';
              case 'method':
                return '#A78BFA';
              case 'dataset':
                return '#F472B6';
              case 'run':
                return '#E6EAF0';
              case 'result':
                return '#3DD6B5';
              case 'source':
                return '#6EA8FE';
              default:
                return '#252C36';
            }
          }}
        />
      </ReactFlow>
    </div>
  );
};
