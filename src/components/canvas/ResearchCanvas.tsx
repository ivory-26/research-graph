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
  Zap,
  X,
} from 'lucide-react';

interface ResearchCanvasProps {
  initialNodes: WorkspaceNode[];
  initialEdges: WorkspaceEdge[];
  selectedEdgeId: string | null;
  selectedNodeId: string | null;
  onSelectEdge: (edgeId: string) => void;
  onSelectNode: (nodeId: string | null) => void;
}

function CanvasInner({
  initialNodes,
  initialEdges,
  selectedEdgeId,
  selectedNodeId,
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

  // Dynamic Lineage Path Tracing (BFS upstream & downstream traversal)
  const { connectedNodeIds, connectedEdgeIds } = useMemo(() => {
    if (!selectedNodeId) {
      return {
        connectedNodeIds: new Set<string>(),
        connectedEdgeIds: new Set<string>(),
      };
    }

    const nodeSet = new Set<string>([selectedNodeId]);
    const edgeSet = new Set<string>();

    // Upstream traversal (find parent sources / claims)
    let queue = [selectedNodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const e of initialEdges) {
        if (e.target === current) {
          edgeSet.add(e.id);
          if (!nodeSet.has(e.source)) {
            nodeSet.add(e.source);
            queue.push(e.source);
          }
        }
      }
    }

    // Downstream traversal (find dependent runs / results)
    queue = [selectedNodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const e of initialEdges) {
        if (e.source === current) {
          edgeSet.add(e.id);
          if (!nodeSet.has(e.target)) {
            nodeSet.add(e.target);
            queue.push(e.target);
          }
        }
      }
    }

    return { connectedNodeIds: nodeSet, connectedEdgeIds: edgeSet };
  }, [selectedNodeId, initialEdges]);

  const hasLineage = connectedNodeIds.size > 0;

  // Transform workspace nodes to ReactFlow nodes with lineage states
  const rfNodes: Node[] = useMemo(() => {
    return initialNodes.map((n) => {
      let isCategoryDimmed = false;
      if (activeFilter === 'sources' && n.type !== 'source') isCategoryDimmed = true;
      if (activeFilter === 'claims' && n.type !== 'claim') isCategoryDimmed = true;
      if (activeFilter === 'methods' && n.type !== 'method') isCategoryDimmed = true;
      if (activeFilter === 'runs' && n.type !== 'run' && n.type !== 'result') isCategoryDimmed = true;

      const isLineageNode = hasLineage ? connectedNodeIds.has(n.id) : false;
      const isDimmed = isCategoryDimmed || (hasLineage && !isLineageNode);
      const isHighlighted = hasLineage ? isLineageNode : false;

      return {
        id: n.id,
        type: n.type,
        position: n.position,
        selected: n.id === selectedNodeId,
        data: {
          ...n.data,
          isDimmed,
          isHighlighted,
        },
      };
    });
  }, [initialNodes, activeFilter, hasLineage, connectedNodeIds, selectedNodeId]);

  // Transform workspace edges to ReactFlow edges with lineage states
  const rfEdges: Edge[] = useMemo(() => {
    return initialEdges.map((e) => {
      const isLineageEdge = hasLineage ? connectedEdgeIds.has(e.id) : false;
      const isSelected = e.id === selectedEdgeId;
      const isLineageActive = isLineageEdge || isSelected;
      const isDimmed = hasLineage && !isLineageEdge;

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'customEvidenceEdge',
        selected: isSelected,
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
          isLineageActive,
          isDimmed,
          onSelectEdge,
        },
      };
    });
  }, [initialEdges, hasLineage, connectedEdgeIds, selectedEdgeId, onSelectEdge]);

  const [nodes, , onNodesChange] = useNodesState(rfNodes);
  const [edges, , onEdgesChange] = useEdgesState(rfEdges);

  // Click on node toggles lineage lighting
  const handleNodeClick = useCallback(
    (_: any, node: Node) => {
      if (selectedNodeId === node.id) {
        onSelectNode(null); // toggle off
      } else {
        onSelectNode(node.id);
      }
    },
    [selectedNodeId, onSelectNode]
  );

  const handleEdgeClick = useCallback(
    (_: any, edge: Edge) => {
      onSelectEdge(edge.id);
    },
    [onSelectEdge]
  );

  const handlePaneClick = useCallback(() => {
    if (selectedNodeId) {
      onSelectNode(null);
    }
  }, [selectedNodeId, onSelectNode]);

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
    onSelectNode(node.id);
    setSearchQuery('');
    setIsSearchOpen(false);
  };

  const selectedNodeTitle = useMemo(() => {
    if (!selectedNodeId) return null;
    return initialNodes.find((n) => n.id === selectedNodeId)?.title || selectedNodeId;
  }, [selectedNodeId, initialNodes]);

  return (
    <div className="relative h-full w-full bg-[#000000] select-none">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        panOnDrag={!isLocked}
        zoomOnScroll={!isLocked}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.25}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={gridVariant} gap={20} size={1} color="#262626" />

        {/* TOP-LEFT PANEL: GRAPH STATS & JUMP SEARCH */}
        <Panel position="top-left" className="m-3 flex items-center gap-2">
          {/* Node Quick Search Dock */}
          <div className="relative">
            <div className="flex items-center gap-1.5 rounded-md border border-[#262626] bg-[#0a0a0a] px-3 py-1.5 shadow-2xl backdrop-blur-md">
              <Search className="h-3.5 w-3.5 text-[#737373]" />
              <input
                type="text"
                placeholder="Jump to node (Gini, Strobl)..."
                value={searchQuery}
                onFocus={() => setIsSearchOpen(true)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsSearchOpen(true);
                }}
                className="w-48 bg-transparent text-xs text-white placeholder-[#737373] outline-none font-mono"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setIsSearchOpen(false);
                  }}
                  className="text-xs text-[#737373] hover:text-white"
                >
                  ×
                </button>
              )}
            </div>

            {/* Search Dropdown Results */}
            {isSearchOpen && matchingNodes.length > 0 && (
              <div className="absolute left-0 top-11 z-50 w-72 rounded-lg border border-[#262626] bg-[#0a0a0a] p-2 shadow-2xl backdrop-blur-xl animate-fade-in space-y-1">
                <div className="px-2 py-1 l text-[9px]">Matching Nodes</div>
                {matchingNodes.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => handleJumpToNode(n)}
                    className="flex items-center justify-between rounded px-2.5 py-1.5 text-xs text-white hover:bg-[#171717] cursor-pointer transition"
                  >
                    <div className="truncate font-medium">{n.title}</div>
                    <span className="font-mono text-[9px] uppercase text-[#737373] ml-2">
                      {n.type}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Lineage Focus Badge or Quick Stats Pill */}
          {hasLineage ? (
            <div className="flex items-center gap-2 rounded-md border border-[#f97316]/60 bg-[#f97316]/10 px-3 py-1.5 text-[11px] font-mono text-[#f97316] shadow-xl backdrop-blur-md animate-fade-in">
              <Zap className="h-3.5 w-3.5 text-[#f97316]" />
              <span>Tracing: <strong className="text-white">{selectedNodeTitle}</strong> ({connectedNodeIds.size} nodes)</span>
              <button
                onClick={() => onSelectNode(null)}
                className="ml-1 rounded p-0.5 hover:bg-[#f97316]/20 text-[#f97316]"
                title="Clear lineage focus"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="hidden md:flex items-center gap-2 rounded-md border border-[#262626] bg-[#0a0a0a] px-3 py-1.5 text-[11px] font-mono text-[#737373] shadow-xl backdrop-blur-md">
              <Layers className="h-3.5 w-3.5 text-white" />
              <span>3 SOURCES · 1 CLAIM · 2 METHODS · 2 RUNS</span>
            </div>
          )}
        </Panel>

        {/* TOP-RIGHT PANEL: FILTER DOCK & GRID SWITCHER */}
        <Panel position="top-right" className="m-3 flex items-center gap-2">
          {/* Node Category Filters */}
          <div className="flex items-center gap-1 rounded-md border border-[#262626] bg-[#0a0a0a] p-1 shadow-2xl backdrop-blur-md">
            <button
              onClick={() => setActiveFilter('all')}
              className={`rounded px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition ${
                activeFilter === 'all'
                  ? 'bg-white text-black font-bold'
                  : 'text-[#737373] hover:text-white'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setActiveFilter('sources')}
              className={`rounded px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition ${
                activeFilter === 'sources'
                  ? 'bg-white text-black font-bold'
                  : 'text-[#737373] hover:text-white'
              }`}
            >
              Sources
            </button>
            <button
              onClick={() => setActiveFilter('claims')}
              className={`rounded px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition ${
                activeFilter === 'claims'
                  ? 'bg-[#f97316] text-black font-bold'
                  : 'text-[#737373] hover:text-white'
              }`}
            >
              Claims
            </button>
            <button
              onClick={() => setActiveFilter('methods')}
              className={`rounded px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition ${
                activeFilter === 'methods'
                  ? 'bg-white text-black font-bold'
                  : 'text-[#737373] hover:text-white'
              }`}
            >
              Methods
            </button>
            <button
              onClick={() => setActiveFilter('runs')}
              className={`rounded px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition ${
                activeFilter === 'runs'
                  ? 'bg-white text-black font-bold'
                  : 'text-[#737373] hover:text-white'
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
            className="flex items-center gap-1 rounded-md border border-[#262626] bg-[#0a0a0a] px-2.5 py-1.5 text-xs text-[#737373] shadow-2xl backdrop-blur-md hover:text-white transition"
            title="Toggle Grid Type"
          >
            <Grid className="h-3.5 w-3.5" />
            <span className="font-mono text-[10px] uppercase">
              {gridVariant === BackgroundVariant.Dots ? 'Dots' : gridVariant === BackgroundVariant.Lines ? 'Lines' : 'Cross'}
            </span>
          </button>

          {/* Minimap Toggle */}
          <button
            onClick={() => setShowMinimap(!showMinimap)}
            className={`flex items-center gap-1 rounded-md border border-[#262626] bg-[#0a0a0a] px-2.5 py-1.5 text-xs transition shadow-2xl backdrop-blur-md ${
              showMinimap ? 'text-[#f97316]' : 'text-[#737373] hover:text-white'
            }`}
            title="Toggle Map"
          >
            <MapPin className="h-3.5 w-3.5" />
          </button>
        </Panel>

        {/* CONTROLS DOCK */}
        <Controls className="!bg-[#0a0a0a] !border-[#262626] !text-[#a3a3a3]">
          <ControlButton
            onClick={() => setIsLocked(!isLocked)}
            title={isLocked ? 'Unlock canvas navigation' : 'Lock canvas navigation'}
          >
            {isLocked ? <Lock className="h-3.5 w-3.5 text-[#f97316]" /> : <Unlock className="h-3.5 w-3.5" />}
          </ControlButton>
          <ControlButton onClick={() => fitView({ padding: 0.18, duration: 500 })} title="Reset View">
            <Sparkles className="h-3.5 w-3.5 text-[#f97316]" />
          </ControlButton>
        </Controls>

        {/* MINIMAP */}
        {showMinimap && (
          <MiniMap
            nodeStrokeWidth={2}
            zoomable
            pannable
            className="!bg-[#0a0a0a] !border-[#262626] !rounded-lg"
            nodeColor={(n) => {
              switch (n.type) {
                case 'claim':
                  return '#f97316';
                case 'method':
                  return '#e5e5e5';
                case 'dataset':
                  return '#737373';
                case 'run':
                  return '#f97316';
                case 'result':
                  return '#ffffff';
                case 'source':
                  return '#a3a3a3';
                default:
                  return '#262626';
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
