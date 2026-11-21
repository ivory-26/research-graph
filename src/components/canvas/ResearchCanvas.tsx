import React, { useMemo, useCallback, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  Panel,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
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
import {
  Search,
  Grid,
  MapPin,
  Lock,
  Unlock,
  Layers,
  Sparkles,
} from 'lucide-react';

interface ResearchCanvasProps {
  initialNodes: WorkspaceNode[];
  initialEdges: WorkspaceEdge[];
  selectedEdgeId: string | null;
  onSelectEdge: (edgeId: string) => void;
  onSelectNode?: (nodeId: string) => void;
}

function CanvasInner({
  initialNodes,
  initialEdges,
  selectedEdgeId,
  onSelectEdge,
  onSelectNode,
}: ResearchCanvasProps) {
  const { setCenter, fitView } = useReactFlow();

  // Filter state for nodes
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [gridVariant, setGridVariant] = useState<BackgroundVariant>(BackgroundVariant.Dots);
  const [showMinimap, setShowMinimap] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

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

  // Compute node opacity/dimming based on filter
  const rfNodes: Node[] = useMemo(() => {
    return initialNodes.map((n) => {
      let isDimmed = false;
      if (activeFilter === 'sources' && n.type !== 'source') isDimmed = true;
      if (activeFilter === 'claims' && n.type !== 'claim') isDimmed = true;
      if (activeFilter === 'methods' && n.type !== 'method') isDimmed = true;
      if (activeFilter === 'runs' && n.type !== 'run' && n.type !== 'result') isDimmed = true;

      return {
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data,
        style: {
          opacity: isDimmed ? 0.25 : 1,
          transition: 'opacity 0.25s ease',
        },
      };
    });
  }, [initialNodes, activeFilter]);

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

  // Search filtering
  const matchingNodes = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return initialNodes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        (n.data.text && String(n.data.text).toLowerCase().includes(q)) ||
        (n.data.sublabel && String(n.data.sublabel).toLowerCase().includes(q))
    );
  }, [searchQuery, initialNodes]);

  const handleJumpToNode = (node: WorkspaceNode) => {
    setCenter(node.position.x + 90, node.position.y + 40, {
      zoom: 1.25,
      duration: 600,
    });
    if (onSelectNode) {
      onSelectNode(node.id);
    }
    setSearchQuery('');
    setIsSearchOpen(false);
  };

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
        panOnDrag={!isLocked}
        zoomOnScroll={!isLocked}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.25}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={gridVariant} gap={20} size={1} color="#252C36" />

        {/* TOP-LEFT PANEL: GRAPH STATS & JUMP SEARCH */}
        <Panel position="top-left" className="m-3 flex items-center gap-2">
          {/* Node Quick Search Dock */}
          <div className="relative">
            <div className="flex items-center gap-1.5 rounded-xl border border-[#252C36] bg-[#161B22]/95 px-3 py-1.5 shadow-2xl backdrop-blur-md">
              <Search className="h-3.5 w-3.5 text-[#9AA4B2]" />
              <input
                type="text"
                placeholder="Jump to node (e.g. Gini, Strobl)..."
                value={searchQuery}
                onFocus={() => setIsSearchOpen(true)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsSearchOpen(true);
                }}
                className="w-48 bg-transparent text-xs text-[#E6EAF0] placeholder-[#9AA4B2] outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setIsSearchOpen(false);
                  }}
                  className="text-xs text-[#9AA4B2] hover:text-[#E6EAF0]"
                >
                  ×
                </button>
              )}
            </div>

            {/* Search Dropdown Results */}
            {isSearchOpen && matchingNodes.length > 0 && (
              <div className="absolute left-0 top-11 z-50 w-72 rounded-xl border border-[#252C36] bg-[#161B22] p-2 shadow-2xl backdrop-blur-xl animate-fade-in space-y-1">
                <div className="px-2 py-1 l text-[9px] text-[#9AA4B2]">Matching Nodes</div>
                {matchingNodes.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => handleJumpToNode(n)}
                    className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-[#E6EAF0] hover:bg-[#252C36] cursor-pointer transition"
                  >
                    <div className="truncate font-medium">{n.title}</div>
                    <span className="font-mono text-[9px] uppercase text-[#9AA4B2] ml-2">
                      {n.type}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Stats Pill */}
          <div className="hidden md:flex items-center gap-2 rounded-xl border border-[#252C36] bg-[#161B22]/90 px-3 py-1.5 text-[11px] font-mono text-[#9AA4B2] shadow-xl backdrop-blur-md">
            <Layers className="h-3.5 w-3.5 text-[#3DD6B5]" />
            <span>3 Sources · 1 Claim · 2 Methods · 2 Runs</span>
          </div>
        </Panel>

        {/* TOP-RIGHT PANEL: FILTER DOCK & GRID SWITCHER */}
        <Panel position="top-right" className="m-3 flex items-center gap-2">
          {/* Node Category Filters */}
          <div className="flex items-center gap-1 rounded-xl border border-[#252C36] bg-[#161B22]/95 p-1 shadow-2xl backdrop-blur-md">
            <button
              onClick={() => setActiveFilter('all')}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                activeFilter === 'all'
                  ? 'bg-[#252C36] text-[#E6EAF0]'
                  : 'text-[#9AA4B2] hover:text-[#E6EAF0]'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setActiveFilter('sources')}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                activeFilter === 'sources'
                  ? 'bg-[#6EA8FE]/20 text-[#6EA8FE] font-semibold'
                  : 'text-[#9AA4B2] hover:text-[#E6EAF0]'
              }`}
            >
              Sources
            </button>
            <button
              onClick={() => setActiveFilter('claims')}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                activeFilter === 'claims'
                  ? 'bg-[#3DD6B5]/20 text-[#3DD6B5] font-semibold'
                  : 'text-[#9AA4B2] hover:text-[#E6EAF0]'
              }`}
            >
              Claims
            </button>
            <button
              onClick={() => setActiveFilter('methods')}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                activeFilter === 'methods'
                  ? 'bg-[#A78BFA]/20 text-[#A78BFA] font-semibold'
                  : 'text-[#9AA4B2] hover:text-[#E6EAF0]'
              }`}
            >
              Methods
            </button>
            <button
              onClick={() => setActiveFilter('runs')}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                activeFilter === 'runs'
                  ? 'bg-[#F5A524]/20 text-[#F5A524] font-semibold'
                  : 'text-[#9AA4B2] hover:text-[#E6EAF0]'
              }`}
            >
              Runs
            </button>
          </div>

          {/* Grid Mode Switcher */}
          <button
            onClick={() => {
              if (gridVariant === BackgroundVariant.Dots) setGridVariant(BackgroundVariant.Lines);
              else if (gridVariant === BackgroundVariant.Lines) setGridVariant(BackgroundVariant.Cross);
              else setGridVariant(BackgroundVariant.Dots);
            }}
            className="flex items-center gap-1 rounded-xl border border-[#252C36] bg-[#161B22]/95 px-2.5 py-1.5 text-xs text-[#9AA4B2] shadow-2xl backdrop-blur-md hover:text-[#E6EAF0] transition"
            title="Toggle Grid Type (Dots, Lines, Cross)"
          >
            <Grid className="h-3.5 w-3.5" />
            <span className="font-mono text-[10px] uppercase">
              {gridVariant === BackgroundVariant.Dots ? 'Dots' : gridVariant === BackgroundVariant.Lines ? 'Lines' : 'Cross'}
            </span>
          </button>

          {/* Minimap Toggle */}
          <button
            onClick={() => setShowMinimap(!showMinimap)}
            className={`flex items-center gap-1 rounded-xl border border-[#252C36] bg-[#161B22]/95 px-2.5 py-1.5 text-xs transition shadow-2xl backdrop-blur-md ${
              showMinimap ? 'text-[#3DD6B5]' : 'text-[#9AA4B2] hover:text-[#E6EAF0]'
            }`}
            title="Toggle Map"
          >
            <MapPin className="h-3.5 w-3.5" />
          </button>
        </Panel>

        {/* CONTROLS DOCK */}
        <Controls className="!bg-[#161B22] !border-[#252C36] !text-[#9AA4B2]">
          <ControlButton
            onClick={() => setIsLocked(!isLocked)}
            title={isLocked ? 'Unlock canvas navigation' : 'Lock canvas navigation'}
          >
            {isLocked ? <Lock className="h-3.5 w-3.5 text-[#F5A524]" /> : <Unlock className="h-3.5 w-3.5" />}
          </ControlButton>
          <ControlButton onClick={() => fitView({ padding: 0.18, duration: 500 })} title="Reset View">
            <Sparkles className="h-3.5 w-3.5 text-[#3DD6B5]" />
          </ControlButton>
        </Controls>

        {/* MINIMAP */}
        {showMinimap && (
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
        )}
      </ReactFlow>
    </div>
  );
}

export const ResearchCanvas: React.FC<ResearchCanvasProps> = (props) => {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
};
