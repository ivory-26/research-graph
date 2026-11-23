import React, { useMemo, useCallback, useState, useEffect } from 'react';
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
import { useTheme } from '../../context/ThemeContext';
import {
  Search,
  Grid,
  MapPin,
  Lock,
  Unlock,
  Sparkles,
  Zap,
  X,
  LayoutGrid,
  CircleDot,
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
  const { theme } = useTheme();

  // Filter state for nodes
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [gridVariant, setGridVariant] = useState<BackgroundVariant>(BackgroundVariant.Dots);
  const [showMinimap, setShowMinimap] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Switchable node shape: 'cards' (Image 1) or 'circles' (Image 2)
  const [nodeShape, setNodeShape] = useState<'cards' | 'circles'>(() => {
    return (localStorage.getItem('rg_node_shape') as 'cards' | 'circles') || 'cards';
  });

  const handleToggleNodeShape = (shape: 'cards' | 'circles') => {
    setNodeShape(shape);
    localStorage.setItem('rg_node_shape', shape);
    setTimeout(() => {
      fitView({ padding: 0.18, duration: 400 });
    }, 50);
  };

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

  // Transform workspace nodes to ReactFlow nodes with lineage states and shape mode
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
          nodeShape,
          isDimmed,
          isHighlighted,
        },
      };
    });
  }, [initialNodes, activeFilter, hasLineage, connectedNodeIds, selectedNodeId, nodeShape]);

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

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  // Synchronize state when filters, lineage, or node shape change
  useEffect(() => {
    setNodes((currentNodes) => {
      return rfNodes.map((rfNode) => {
        const match = currentNodes.find((cn) => cn.id === rfNode.id);
        return {
          ...rfNode,
          position: match ? match.position : rfNode.position,
        };
      });
    });
  }, [rfNodes, setNodes]);

  useEffect(() => {
    setEdges(rfEdges);
  }, [rfEdges, setEdges]);

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

  const gridDotColor = theme === 'dark' ? '#262626' : '#cbd5e1';

  return (
    <div className="relative h-full w-full bg-[var(--canvas-bg)] select-none transition-colors duration-200">
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
        <Background variant={gridVariant} gap={20} size={1} color={gridDotColor} />

        {/* TOP-LEFT PANEL: GRAPH STATS & JUMP SEARCH */}
        <Panel position="top-left" className="m-3 flex items-center gap-2">
          {/* Node Quick Search Dock with Sharp Corners */}
          <div className="relative">
            <div className="flex items-center gap-1.5 rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-1.5 shadow-xl backdrop-blur-md">
              <Search className="h-3.5 w-3.5 text-[var(--text-dim)]" />
              <input
                type="text"
                placeholder="Jump to node (Gini, Strobl)..."
                value={searchQuery}
                onFocus={() => setIsSearchOpen(true)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsSearchOpen(true);
                }}
                className="w-48 bg-transparent text-xs text-[var(--text-primary)] placeholder-[var(--text-dim)] outline-none font-mono"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setIsSearchOpen(false);
                  }}
                  className="text-xs text-[var(--text-dim)] hover:text-[var(--text-primary)]"
                >
                  ×
                </button>
              )}
            </div>

            {/* Search Dropdown Results with Sharp Corners */}
            {isSearchOpen && matchingNodes.length > 0 && (
              <div className="absolute left-0 top-11 z-50 w-72 rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] p-2 shadow-2xl backdrop-blur-xl animate-fade-in space-y-1">
                <div className="px-2 py-1 l text-[9px]">Matching Nodes</div>
                {matchingNodes.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => handleJumpToNode(n)}
                    className="flex items-center justify-between rounded-none px-2.5 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] cursor-pointer transition"
                  >
                    <div className="truncate font-medium">{n.title}</div>
                    <span className="font-mono text-[9px] uppercase text-[var(--text-dim)] ml-2">
                      {n.type}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Lineage Focus Badge with Sharp Corners */}
          {hasLineage && (
            <div className="flex items-center gap-2 rounded-none border border-[#f97316]/60 bg-[#f97316]/10 px-3 py-1.5 text-[11px] font-mono text-[#f97316] shadow-xl backdrop-blur-md animate-fade-in">
              <Zap className="h-3.5 w-3.5 text-[#f97316]" />
              <span>Tracing: <strong className="text-[var(--text-primary)]">{selectedNodeTitle}</strong> ({connectedNodeIds.size} nodes)</span>
              <button
                onClick={() => onSelectNode(null)}
                className="ml-1 rounded-none p-0.5 hover:bg-[#f97316]/20 text-[#f97316]"
                title="Clear lineage focus"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </Panel>

        {/* TOP-RIGHT PANEL: SWITCHABLE VIEW SHAPE, FILTER DOCK & GRID SWITCHER */}
        <Panel position="top-right" className="m-3 flex items-center gap-2">
          {/* Switchable View Mode: Cards (Image 1) vs Round Nodes (Image 2) */}
          <div className="flex items-center gap-0.5 rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] p-1 shadow-xl backdrop-blur-md">
            <button
              onClick={() => handleToggleNodeShape('cards')}
              className={`flex items-center gap-1.5 rounded-none px-2.5 py-1 text-[11px] font-mono tracking-wider transition ${
                nodeShape === 'cards'
                  ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold shadow-sm'
                  : 'text-[var(--text-dim)] hover:text-[var(--text-primary)]'
              }`}
              title="Detailed Sharp Cards View (Image 1)"
            >
              <LayoutGrid className="h-3 w-3" />
              <span>CARDS</span>
            </button>
            <button
              onClick={() => handleToggleNodeShape('circles')}
              className={`flex items-center gap-1.5 rounded-none px-2.5 py-1 text-[11px] font-mono tracking-wider transition ${
                nodeShape === 'circles'
                  ? 'bg-[#f97316] text-black font-bold shadow-[0_0_12px_rgba(249,115,22,0.5)]'
                  : 'text-[var(--text-dim)] hover:text-[var(--text-primary)]'
              }`}
              title="Round Network Nodes View (Image 2)"
            >
              <CircleDot className="h-3 w-3" />
              <span>ROUND NODES</span>
            </button>
          </div>

          {/* Node Category Filters with Sharp Corners */}
          <div className="flex items-center gap-1 rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] p-1 shadow-xl backdrop-blur-md">
            <button
              onClick={() => setActiveFilter('all')}
              className={`rounded-none px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition ${
                activeFilter === 'all'
                  ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold'
                  : 'text-[var(--text-dim)] hover:text-[var(--text-primary)]'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setActiveFilter('sources')}
              className={`rounded-none px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition ${
                activeFilter === 'sources'
                  ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold'
                  : 'text-[var(--text-dim)] hover:text-[var(--text-primary)]'
              }`}
            >
              Sources
            </button>
            <button
              onClick={() => setActiveFilter('claims')}
              className={`rounded-none px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition ${
                activeFilter === 'claims'
                  ? 'bg-[#f97316] text-black font-bold'
                  : 'text-[var(--text-dim)] hover:text-[var(--text-primary)]'
              }`}
            >
              Claims
            </button>
            <button
              onClick={() => setActiveFilter('methods')}
              className={`rounded-none px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition ${
                activeFilter === 'methods'
                  ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold'
                  : 'text-[var(--text-dim)] hover:text-[var(--text-primary)]'
              }`}
            >
              Methods
            </button>
            <button
              onClick={() => setActiveFilter('runs')}
              className={`rounded-none px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition ${
                activeFilter === 'runs'
                  ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold'
                  : 'text-[var(--text-dim)] hover:text-[var(--text-primary)]'
              }`}
            >
              Runs
            </button>
          </div>

          {/* Grid Mode Switcher with Sharp Corners */}
          <button
            onClick={() => {
              if (gridVariant === BackgroundVariant.Dots) setGridVariant(BackgroundVariant.Lines);
              else if (gridVariant === BackgroundVariant.Lines) setGridVariant(BackgroundVariant.Cross);
              else setGridVariant(BackgroundVariant.Dots);
            }}
            className="flex items-center gap-1 rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-dim)] shadow-xl backdrop-blur-md hover:text-[var(--text-primary)] transition"
            title="Toggle Grid Type"
          >
            <Grid className="h-3.5 w-3.5" />
            <span className="font-mono text-[10px] uppercase">
              {gridVariant === BackgroundVariant.Dots ? 'Dots' : gridVariant === BackgroundVariant.Lines ? 'Lines' : 'Cross'}
            </span>
          </button>

          {/* Minimap Toggle with Sharp Corners */}
          <button
            onClick={() => setShowMinimap(!showMinimap)}
            className={`flex items-center gap-1 rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs transition shadow-xl backdrop-blur-md ${
              showMinimap ? 'text-[#f97316]' : 'text-[var(--text-dim)] hover:text-[var(--text-primary)]'
            }`}
            title="Toggle Map"
          >
            <MapPin className="h-3.5 w-3.5" />
          </button>
        </Panel>

        {/* BOTTOM-LEFT: CITATION NETWORK OVERLAY (Image 2 style) */}
        {nodeShape === 'circles' && (
          <Panel position="bottom-left" className="m-3 ml-14 mb-3 select-none pointer-events-none animate-fade-in">
            <div className="space-y-1 font-mono text-xs backdrop-blur-md bg-[var(--bg-surface)]/90 border border-[var(--border-primary)] px-3 py-2 shadow-2xl">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold tracking-wide">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" />
                <span>Network: {initialNodes.length} nodes · {initialEdges.length} connections</span>
              </div>
              <div className="text-[10px] text-[var(--text-dim)] truncate max-w-xs md:max-w-md">
                <span className="text-[var(--text-muted)]">Query:</span> "External validation of sepsis prediction models in multicenter ICU datasets"
              </div>
            </div>
          </Panel>
        )}

        {/* CONTROLS DOCK with Sharp Corners */}
        <Controls>
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

        {/* MINIMAP with Sharp Corners */}
        {showMinimap && (
          <MiniMap
            nodeStrokeWidth={2}
            zoomable
            pannable
            className="!rounded-none"
            nodeColor={(n) => {
              if (theme === 'dark') {
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
              } else {
                switch (n.type) {
                  case 'claim':
                    return '#ea580c';
                  case 'method':
                    return '#475569';
                  case 'dataset':
                    return '#64748b';
                  case 'run':
                    return '#ea580c';
                  case 'result':
                    return '#0f172a';
                  case 'source':
                    return '#94a3b8';
                  default:
                    return '#cbd5e1';
                }
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
