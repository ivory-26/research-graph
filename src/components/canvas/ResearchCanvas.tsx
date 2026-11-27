import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
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
import { MemoryNode } from './MemoryNode';
import { MemoryGraphToolbar, type MemoryGraphSettings } from './MemoryGraphToolbar';
import { CustomEvidenceEdge } from './CustomEdges';
import { computeForceLayout } from '../../utils/forceSimulation';
import {
  clearPersistedPositions,
  loadPersistedPositions,
  savePersistedPositions,
  type PositionMap,
} from '../../utils/graphClient';
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
  Share2,
} from 'lucide-react';

export type VisualizationMode = 'cards' | 'memory';

interface ResearchCanvasProps {
  initialNodes: WorkspaceNode[];
  initialEdges: WorkspaceEdge[];
  workspaceId?: string;
  selectedEdgeId: string | null;
  selectedNodeId: string | null;
  onSelectEdge: (edgeId: string) => void;
  onSelectNode: (nodeId: string | null) => void;
}

function CanvasInner({
  initialNodes,
  initialEdges,
  workspaceId,
  selectedEdgeId,
  selectedNodeId,
  onSelectEdge,
  onSelectNode,
}: ResearchCanvasProps) {
  const { setCenter, fitView } = useReactFlow();
  const { theme } = useTheme();

  // Active visualization mode: 'cards' (Structured pipeline) or 'memory' (Organic force-directed graph)
  const [viewMode, setViewMode] = useState<VisualizationMode>('cards');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored =
        localStorage.getItem('rg_view_mode') || localStorage.getItem('rg_node_shape');
      if (stored === 'circles' || stored === 'memory') {
        setViewMode('memory');
      }
    }
  }, []);

  // Filter state for nodes
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [gridVariant, setGridVariant] = useState<BackgroundVariant>(BackgroundVariant.Dots);
  const [showMinimap, setShowMinimap] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Hover state for organic network focus
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Force simulation settings
  const [settings, setSettings] = useState<MemoryGraphSettings>({
    repulsion: 3400,
    linkDistance: 195,
    nodeSize: 1.0,
    linkThickness: 1.2,
    labelVisibility: 'selective',
    clusterHighlighting: true,
  });

  const [simulationSeed, setSimulationSeed] = useState(0);

  const handleToggleViewMode = (mode: VisualizationMode) => {
    setViewMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('rg_view_mode', mode);
      localStorage.setItem('rg_node_shape', mode === 'memory' ? 'circles' : 'cards');
    }
    setTimeout(() => {
      fitView({ padding: mode === 'memory' ? 0.25 : 0.18, duration: 500 });
    }, 60);
  };

  // Node counts for Memory Graph toolbar
  const nodeCounts = useMemo(() => {
    const counts = {
      all: initialNodes.length,
      source: 0,
      claim: 0,
      method: 0,
      dataset: 0,
      run: 0,
      result: 0,
    };
    initialNodes.forEach((n) => {
      if (n.type in counts) (counts as any)[n.type] += 1;
    });
    return counts;
  }, [initialNodes]);

  // Compute organic force-directed layout
  const forceLayout = useMemo(() => {
    return computeForceLayout(
      initialNodes.map((n) => ({
        id: n.id,
        type: n.type,
      })),
      initialEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        relation: e.relation,
      })),
      {
        repulsion: settings.repulsion,
        linkDistance: settings.linkDistance,
        collisionPadding: 86,
      }
    );
  }, [initialNodes, initialEdges, settings.repulsion, settings.linkDistance, simulationSeed]);

  // References for tracking layout inputs, rendered positions, and manual user drags
  const userDraggedNodeIdsRef = useRef<Set<string>>(new Set());
  const nodesRef = useRef<Node[]>([]);
  const [persistedPositions, setPersistedPositions] = useState<PositionMap>({});

  // Load persisted node coordinates on the client after mount / viewMode / workspace switch (SSR-safe)
  useEffect(() => {
    const loaded = loadPersistedPositions(viewMode, undefined, workspaceId);
    setPersistedPositions(loaded);
    userDraggedNodeIdsRef.current = new Set(Object.keys(loaded));
  }, [viewMode, workspaceId]);

  // Double-click focus on node and immediate neighborhood (centred on actually rendered position)
  const handleNodeDoubleClick = useCallback(
    (nodeId: string) => {
      const renderedNode = nodesRef.current.find((n) => n.id === nodeId);
      const nodePos = renderedNode
        ? renderedNode.position
        : viewMode === 'memory'
          ? forceLayout.positions[nodeId]
          : initialNodes.find((n) => n.id === nodeId)?.position;

      if (nodePos) {
        setCenter(nodePos.x + 30, nodePos.y + 30, { zoom: 1.55, duration: 600 });
        onSelectNode(nodeId);
      }
    },
    [viewMode, forceLayout, initialNodes, setCenter, onSelectNode]
  );

  const handleResetLayout = useCallback(() => {
    userDraggedNodeIdsRef.current.clear();
    clearPersistedPositions(viewMode, undefined, workspaceId);
    setPersistedPositions({});
    setSimulationSeed((s) => s + 1);
    setTimeout(() => {
      fitView({ padding: viewMode === 'memory' ? 0.38 : 0.25, duration: 600 });
    }, 100);
  }, [fitView, viewMode, workspaceId]);

  const handleAnimateLayout = useCallback(() => {
    userDraggedNodeIdsRef.current.clear();
    clearPersistedPositions(viewMode, undefined, workspaceId);
    setPersistedPositions({});
    setSimulationSeed((s) => s + 1);
  }, [viewMode, workspaceId]);

  const nodeTypes = useMemo(
    () => ({
      source: viewMode === 'memory' ? MemoryNode : SourceNode,
      claim: viewMode === 'memory' ? MemoryNode : ClaimNode,
      method: viewMode === 'memory' ? MemoryNode : MethodNode,
      dataset: viewMode === 'memory' ? MemoryNode : DatasetNode,
      run: viewMode === 'memory' ? MemoryNode : RunNode,
      result: viewMode === 'memory' ? MemoryNode : ResultNode,
      note: viewMode === 'memory' ? MemoryNode : NoteNode,
    }),
    [viewMode]
  );

  const edgeTypes = useMemo(
    () => ({
      customEvidenceEdge: CustomEvidenceEdge,
    }),
    []
  );

  // Dynamic Lineage & Active Connections (Targeted 1-hop on hover, full BFS on explicit selection)
  const { connectedNodeIds, connectedEdgeIds } = useMemo(() => {
    // Priority: hover preview takes temporary precedence if present, otherwise selected node
    const isHovering = Boolean(hoveredNodeId);
    const activeId = hoveredNodeId || selectedNodeId;
    if (!activeId) {
      return {
        connectedNodeIds: new Set<string>(),
        connectedEdgeIds: new Set<string>(),
      };
    }

    const nodeSet = new Set<string>([activeId]);
    const edgeSet = new Set<string>();

    // Direct 1-hop connections (incident edges and adjacent nodes)
    for (const e of initialEdges) {
      if (e.source === activeId || e.target === activeId) {
        edgeSet.add(e.id);
        nodeSet.add(e.source);
        nodeSet.add(e.target);
      }
    }

    // On hover preview: keep focus strictly to 1-hop neighborhood to prevent visual clutter and name crowding!
    // On explicit node click/selection: traverse full multi-hop lineage for end-to-end evidence audit
    if (!isHovering && selectedNodeId) {
      // Upstream traversal
      let queue = [activeId];
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

      // Downstream traversal
      queue = [activeId];
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
    }

    return { connectedNodeIds: nodeSet, connectedEdgeIds: edgeSet };
  }, [hoveredNodeId, selectedNodeId, initialEdges]);

  const hasLineage = connectedNodeIds.size > 0;

  // Direct 1-hop neighbours for the selected node (for selective label display & highlighting)
  const directNeighborIds = useMemo(() => {
    if (!selectedNodeId) return new Set<string>();
    const neighbors = new Set<string>();
    for (const e of initialEdges) {
      if (e.source === selectedNodeId) neighbors.add(e.target);
      if (e.target === selectedNodeId) neighbors.add(e.source);
    }
    return neighbors;
  }, [selectedNodeId, initialEdges]);

  // Transform workspace nodes to ReactFlow nodes
  const rfNodes: Node[] = useMemo(() => {
    return initialNodes.map((n) => {
      let isCategoryDimmed = false;
      if (activeFilter === 'sources' && n.type !== 'source') isCategoryDimmed = true;
      if (activeFilter === 'claims' && n.type !== 'claim') isCategoryDimmed = true;
      if (activeFilter === 'methods' && n.type !== 'method') isCategoryDimmed = true;
      if (activeFilter === 'datasets' && n.type !== 'dataset') isCategoryDimmed = true;
      if (activeFilter === 'runs' && n.type !== 'run') isCategoryDimmed = true;
      if (activeFilter === 'results' && n.type !== 'result') isCategoryDimmed = true;

      const isLineageNode = hasLineage ? connectedNodeIds.has(n.id) : false;
      const isDimmed = isCategoryDimmed || (hasLineage && !isLineageNode);
      const isHighlighted = hasLineage ? isLineageNode : false;

      // Position: persisted user drag coordinates (per viewMode), organic force-directed position, or cards pipeline position
      const persisted = persistedPositions[n.id];
      const position =
        persisted ||
        (viewMode === 'memory'
          ? forceLayout.positions[n.id] || { x: n.position.x - 450, y: n.position.y - 200 }
          : n.position);

      return {
        id: n.id,
        type: n.type,
        position,
        selected: n.id === selectedNodeId,
        data: {
          ...n.data,
          title: (n.data as any)?.title || n.title,
          nodeShape: viewMode === 'memory' ? 'circles' : 'cards',
          isDimmed,
          isHighlighted,
          isDirectNeighbor: directNeighborIds.has(n.id),
          hasActiveSelection: Boolean(selectedNodeId),
          selectedNodeId,
          degree: forceLayout.nodeDegrees[n.id] || 1,
          radius: forceLayout.nodeRadii[n.id] || 21,
          nodeScale: settings.nodeSize,
          labelVisibility: settings.labelVisibility,
          clusterHighlighting: settings.clusterHighlighting,
          onNodeHover: (id: string) => setHoveredNodeId(id),
          onNodeLeave: () => setHoveredNodeId(null),
          onNodeDoubleClick: handleNodeDoubleClick,
        },
      };
    });
  }, [
    initialNodes,
    activeFilter,
    hasLineage,
    connectedNodeIds,
    directNeighborIds,
    selectedNodeId,
    viewMode,
    forceLayout,
    persistedPositions,
    settings,
    handleNodeDoubleClick,
  ]);

  // Transform workspace edges to ReactFlow edges
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
          isMemoryMode: viewMode === 'memory',
          linkThickness: settings.linkThickness,
          onSelectEdge,
        },
      };
    });
  }, [
    initialEdges,
    hasLineage,
    connectedEdgeIds,
    selectedEdgeId,
    viewMode,
    settings.linkThickness,
    onSelectEdge,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  // Keep nodesRef in sync for coordinate center lookups
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // Track layout signature: recomputed layout applies when signature changes or node wasn't manually dragged
  const layoutSignature = `${viewMode}:${simulationSeed}:${settings.repulsion}:${settings.linkDistance}`;
  const prevLayoutSignatureRef = useRef(layoutSignature);

  const handleNodesChange = useCallback(
    (changes: any) => {
      if (Array.isArray(changes)) {
        for (const c of changes) {
          if (c.type === 'position' && (c.dragging || c.position)) {
            userDraggedNodeIdsRef.current.add(c.id);
          }
        }
      }
      onNodesChange(changes);
    },
    [onNodesChange]
  );

  // Synchronize state when nodes, viewMode, filters, or forceLayout change
  useEffect(() => {
    const signatureChanged = prevLayoutSignatureRef.current !== layoutSignature;
    if (signatureChanged) {
      prevLayoutSignatureRef.current = layoutSignature;
      userDraggedNodeIdsRef.current.clear();
    }

    setNodes((currentNodes) => {
      return rfNodes.map((rfNode) => {
        const match = currentNodes.find((cn) => cn.id === rfNode.id);
        const isDragged = userDraggedNodeIdsRef.current.has(rfNode.id);
        const useMatchPosition = !signatureChanged && isDragged && match;
        return {
          ...rfNode,
          position: useMatchPosition ? match.position : rfNode.position,
        };
      });
    });
  }, [rfNodes, layoutSignature, setNodes]);

  useEffect(() => {
    setEdges(rfEdges);
  }, [rfEdges, setEdges]);

  // Click on node selects it and opens Contextual Inspector
  const handleNodeClick = useCallback(
    (_: any, node: Node) => {
      if (selectedNodeId === node.id) {
        onSelectNode(null);
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
    const renderedNode = nodesRef.current.find((n) => n.id === node.id);
    const pos = renderedNode
      ? renderedNode.position
      : viewMode === 'memory'
        ? forceLayout.positions[node.id] || { x: node.position.x - 450, y: node.position.y - 200 }
        : node.position;

    setCenter(pos.x + 40, pos.y + 40, {
      zoom: 1.35,
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

  const gridDotColor = theme === 'dark' ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.07)';

  return (
    <div className="relative h-full w-full bg-[var(--canvas-bg)] select-none transition-colors duration-200">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={(_, node) => {
          userDraggedNodeIdsRef.current.add(node.id);
          const next = {
            ...persistedPositions,
            [node.id]: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
          };
          savePersistedPositions(next, viewMode, undefined, workspaceId);
          setPersistedPositions(next);
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        panOnDrag={!isLocked}
        zoomOnScroll={!isLocked}
        fitView
        fitViewOptions={{ padding: viewMode === 'memory' ? 0.38 : 0.2 }}
        minZoom={0.2}
        maxZoom={2.4}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={gridVariant} gap={22} size={1} color={gridDotColor} />

        {/* UNIFIED RESPONSIVE TOP BAR: SEARCH, FOCUS & TOOLBAR (Non-colliding layout) */}
        <Panel position="top-left" className="m-3 flex items-center justify-between w-[calc(100%-24px)] pointer-events-none gap-2">
          {/* Left: Quick Search Dock & Lineage Badge */}
          <div className="flex items-center gap-2 pointer-events-auto min-w-0">
            {/* Node Quick Search Dock with Sharp Corners */}
            <div className="relative">
              <div className="flex items-center gap-1.5 rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] px-2.5 py-1.5 shadow-xl backdrop-blur-md">
                <Search className="h-3.5 w-3.5 text-[var(--text-dim)]" />
                <input
                  type="text"
                  placeholder="Jump to node..."
                  value={searchQuery}
                  onFocus={() => setIsSearchOpen(true)}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setIsSearchOpen(true);
                  }}
                  className="w-32 sm:w-44 bg-transparent text-xs text-[var(--text-primary)] placeholder-[var(--text-dim)] outline-none font-mono"
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
              <div className="flex items-center gap-1.5 rounded-none border border-[#f97316]/60 bg-[#f97316]/10 px-2.5 py-1.5 text-[11px] font-mono text-[#f97316] shadow-xl backdrop-blur-md animate-fade-in truncate max-w-[220px]">
                <Zap className="h-3.5 w-3.5 text-[#f97316] flex-shrink-0" />
                <span className="truncate">
                  Focus: <strong className="text-[var(--text-primary)]">{selectedNodeTitle}</strong>
                </span>
                <button
                  onClick={() => {
                    onSelectNode(null);
                    setHoveredNodeId(null);
                  }}
                  className="ml-1 rounded-none p-0.5 hover:bg-[#f97316]/20 text-[#f97316] flex-shrink-0"
                  title="Clear focus"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          {/* Right: View Mode Switcher & Exploration Toolbar */}
          <div className="flex items-center gap-1.5 pointer-events-auto flex-shrink-0">
            {/* Switchable View Mode: CARDS (Image 1) vs MEMORY GRAPH (Image 2) */}
            <div className="flex items-center gap-0.5 rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] p-1 shadow-xl backdrop-blur-md">
              <button
                onClick={() => handleToggleViewMode('cards')}
                className={`flex items-center gap-1.5 rounded-none px-2.5 py-1 text-[11px] font-mono tracking-wider transition ${viewMode === 'cards'
                  ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold shadow-sm'
                  : 'text-[var(--text-dim)] hover:text-[var(--text-primary)]'
                  }`}
                title="Structured Cards Pipeline View"
              >
                <LayoutGrid className="h-3 w-3" />
                <span>CARDS</span>
              </button>
              <button
                onClick={() => handleToggleViewMode('memory')}
                className={`flex items-center gap-1.5 rounded-none px-2.5 py-1 text-[11px] font-mono tracking-wider transition ${viewMode === 'memory'
                  ? 'bg-[#f97316] text-black font-bold shadow-[0_0_15px_rgba(249,115,22,0.55)]'
                  : 'text-[var(--text-dim)] hover:text-[var(--text-primary)]'
                  }`}
                title="Organic Force-Directed Memory Graph"
              >
                <Share2 className="h-3 w-3" />
                <span>MEMORY GRAPH</span>
              </button>
            </div>

            {/* VIEW MODE SPECIFIC CONTROLS */}
            {viewMode === 'memory' ? (
              <MemoryGraphToolbar
                activeFilter={activeFilter}
                onFilterChange={setActiveFilter}
                settings={settings}
                onSettingsChange={setSettings}
                onResetLayout={handleResetLayout}
                onFitView={() => fitView({ padding: 0.25, duration: 500 })}
                isLocked={isLocked}
                onToggleLock={() => setIsLocked(!isLocked)}
                onAnimateLayout={handleAnimateLayout}
                nodeCounts={nodeCounts}
              />
            ) : (
              <>
                {/* Cards Mode Category Filter Dock */}
                <div className="flex items-center gap-1 rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] p-1 shadow-xl backdrop-blur-md">
                  <button
                    onClick={() => setActiveFilter('all')}
                    className={`rounded-none px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition ${activeFilter === 'all'
                      ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold'
                      : 'text-[var(--text-dim)] hover:text-[var(--text-primary)]'
                      }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setActiveFilter('sources')}
                    className={`rounded-none px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition ${activeFilter === 'sources'
                      ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold'
                      : 'text-[var(--text-dim)] hover:text-[var(--text-primary)]'
                      }`}
                  >
                    Sources
                  </button>
                  <button
                    onClick={() => setActiveFilter('claims')}
                    className={`rounded-none px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition ${activeFilter === 'claims'
                      ? 'bg-[#f97316] text-black font-bold'
                      : 'text-[var(--text-dim)] hover:text-[var(--text-primary)]'
                      }`}
                  >
                    Claims
                  </button>
                  <button
                    onClick={() => setActiveFilter('methods')}
                    className={`rounded-none px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition ${activeFilter === 'methods'
                      ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold'
                      : 'text-[var(--text-dim)] hover:text-[var(--text-primary)]'
                      }`}
                  >
                    Methods
                  </button>
                  <button
                    onClick={() => setActiveFilter('runs')}
                    className={`rounded-none px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition ${activeFilter === 'runs'
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
                    else if (gridVariant === BackgroundVariant.Lines)
                      setGridVariant(BackgroundVariant.Cross);
                    else setGridVariant(BackgroundVariant.Dots);
                  }}
                  className="flex items-center gap-1 rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-dim)] shadow-xl backdrop-blur-md hover:text-[var(--text-primary)] transition"
                  title="Toggle Grid Type"
                >
                  <Grid className="h-3.5 w-3.5" />
                  <span className="font-mono text-[10px] uppercase">
                    {gridVariant === BackgroundVariant.Dots
                      ? 'Dots'
                      : gridVariant === BackgroundVariant.Lines
                        ? 'Lines'
                        : 'Cross'}
                  </span>
                </button>
              </>
            )}

            {/* Minimap Toggle with Sharp Corners */}
            <button
              onClick={() => setShowMinimap(!showMinimap)}
              className={`flex items-center gap-1 rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs transition shadow-xl backdrop-blur-md ${showMinimap
                ? 'text-[#f97316]'
                : 'text-[var(--text-dim)] hover:text-[var(--text-primary)]'
                }`}
              title="Toggle Map"
            >
              <MapPin className="h-3.5 w-3.5" />
            </button>
          </div>
        </Panel>

        {/* BOTTOM-LEFT: MEMORY GRAPH CONSTELLATION OVERLAY (Obsidian / Kinetic AI Style) */}
        {viewMode === 'memory' && (
          <Panel
            position="bottom-left"
            className="m-3 ml-14 mb-3 select-none pointer-events-none animate-fade-in"
          >
            <div className="space-y-1 font-mono text-xs backdrop-blur-md bg-[var(--bg-surface)]/90 border border-[var(--border-primary)] px-3 py-2 shadow-2xl">
              <div className="flex items-center gap-2 text-sky-400 font-semibold tracking-wide">
                <span className="inline-block h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_10px_#38bdf8] animate-pulse" />
                <span>
                  Memory Network: {initialNodes.length} nodes ·{' '}
                  {initialEdges.length} edges
                </span>
              </div>
              <div className="text-[10px] text-[var(--text-dim)] truncate max-w-xs md:max-w-md">
                <span className="text-[var(--text-muted)]">Mode:</span> Force-directed organic
                clustering · Click node to inspect · Double-click to zoom
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
            {isLocked ? (
              <Lock className="h-3.5 w-3.5 text-[#f97316]" />
            ) : (
              <Unlock className="h-3.5 w-3.5" />
            )}
          </ControlButton>
          <ControlButton
            onClick={() => fitView({ padding: viewMode === 'memory' ? 0.25 : 0.18, duration: 500 })}
            title="Reset View"
          >
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
                  case 'source':
                    return '#38bdf8';
                  case 'claim':
                    return '#f97316';
                  case 'method':
                    return '#a855f7';
                  case 'dataset':
                    return '#ec4899';
                  case 'run':
                    return '#f59e0b';
                  case 'result':
                    return '#10b981';
                  default:
                    return '#1e2229';
                }
              } else {
                switch (n.type) {
                  case 'source':
                    return '#0284c7';
                  case 'claim':
                    return '#ea580c';
                  case 'method':
                    return '#9333ea';
                  case 'dataset':
                    return '#db2777';
                  case 'run':
                    return '#d97706';
                  case 'result':
                    return '#059669';
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
