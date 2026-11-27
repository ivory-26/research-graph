import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState, useEffect, useRef } from 'react';
import { Sidebar, type PageId } from '../components/layout/Sidebar';
import { Navbar } from '../components/layout/Navbar';
import { ResearchCanvas } from '../components/canvas/ResearchCanvas';
import { EvidencePanel } from '../components/panels/EvidencePanel';
import { OverviewPage } from '../components/panels/OverviewPage';
import { SourcesPage } from '../components/panels/SourcesPage';
import { AskResearchPage } from '../components/panels/AskResearchPage';
import { AgentMonitorPage } from '../components/panels/AgentMonitorPage';
import { ExperimentsPage } from '../components/panels/ExperimentsPage';
import { ComparisonView } from '../components/panels/ComparisonView';
import { StrategyDashboard } from '../components/panels/StrategyDashboard';
import { SettingsPage } from '../components/panels/SettingsPage';
import { ApprovalModal } from '../components/panels/ApprovalModal';
import { ExportModal } from '../components/panels/ExportModal';
import { ConsoleDrawer } from '../components/panels/ConsoleDrawer';
import {
  DEMO_NODES,
  DEMO_EDGES,
} from '../data/demoWorkspace';
import type { WorkspaceNode, WorkspaceEdge } from '../data/demoWorkspace';
import type { ExperimentSpec } from '../shared/types';
import { Plus, Play } from 'lucide-react';
import { getCurrentUser } from '../server/auth';
import { signOut } from '../utils/authClient';
import { sendPipelineApproval, subscribeToPipelineStream } from '../utils/pipelineClient';
import { fetchWorkspaceGraph } from '../utils/graphClient';

const VALID_PAGES: ReadonlySet<PageId> = new Set([
  'overview',
  'graph',
  'sources',
  'ask',
  'agents',
  'experiments',
  'compare',
  'strategies',
  'settings',
]);

export interface WorkspaceSearchParams {
  page?: PageId;
  workspace?: string;
  preview?: string;
  redirect?: string;
}

const WORKSPACES = [
  {
    id: 'research-graph',
    name: 'Research Graph',
    subtitle: '3 sources · 1 claim · OpenML:52350',
  },
  {
    id: 'strobl-repro',
    name: 'Strobl 2007/2008 Repro',
    subtitle: 'Hero experiment lineage · RF bias audit',
  },
];

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): WorkspaceSearchParams => {
    const rawPage = typeof search.page === 'string' ? (search.page as PageId) : undefined;
    return {
      page: rawPage && VALID_PAGES.has(rawPage) ? rawPage : undefined,
      workspace: typeof search.workspace === 'string' ? search.workspace : undefined,
      preview: typeof search.preview === 'string' ? search.preview : undefined,
      redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
    };
  },
  beforeLoad: async ({ location }) => {
    const search = location.search as Record<string, unknown>;
    if (import.meta.env.DEV && search?.preview === 'true') {
      return { user: null, isPreview: true };
    }

    const user = await getCurrentUser();
    if (!user) {
      throw redirect({
        to: '/sign-in',
        search: { redirect: location.href },
      });
    }
    return { user, isPreview: false };
  },
  component: WorkspacePage,
});

const PAGE_META: Record<PageId, { title: string; subtitle: string }> = {
  overview: {
    title: 'Overview',
    subtitle: 'Workspace health, research activity and recent artifacts',
  },
  graph: {
    title: 'Research Graph',
    subtitle: 'Explore claims, methods, datasets and reproducibility lineage',
  },
  sources: {
    title: 'Sources',
    subtitle: 'Research papers, ingestion status and extracted chunks',
  },
  ask: {
    title: 'Ask Research',
    subtitle: 'Ask evidence-grounded questions across your sources',
  },
  agents: {
    title: 'Agent Monitor',
    subtitle: 'Pipeline stages, agent tasks and execution observability',
  },
  experiments: {
    title: 'Experiments',
    subtitle: 'Plan, approve and inspect reproducibility experiments',
  },
  compare: {
    title: 'Run Comparison',
    subtitle: 'Compare parent and what-if experiment outcomes',
  },
  strategies: {
    title: 'Strategies',
    subtitle: 'Empirical strategy performance and task analytics',
  },
  settings: {
    title: 'Preferences',
    subtitle: 'Workspace, appearance and interaction settings',
  },
};

function WorkspacePage() {
  const navigate = useNavigate({ from: '/' });
  const search = Route.useSearch();

  const [nodes, setNodes] = useState<WorkspaceNode[]>(DEMO_NODES);
  const [edges, setEdges] = useState<WorkspaceEdge[]>(DEMO_EDGES);

  // URL-addressable active page and workspace
  const currentPage: PageId = search.page ?? 'graph';
  const activeWorkspaceObj = WORKSPACES.find((w) => w.id === search.workspace) ?? WORKSPACES[0];

  const setCurrentPage = (page: PageId) => {
    navigate({
      search: (prev) => ({ ...prev, page }),
    });
  };

  const handleSelectWorkspace = (workspaceId: string) => {
    const target = WORKSPACES.find((w) => w.id === workspaceId);
    if (!target) return;
    navigate({
      search: (prev) => ({ ...prev, workspace: target.id }),
    });
    showToast(`Switched workspace to ${target.name}`);
  };

  // UI state
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [isApprovalOpen, setIsApprovalOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);

  // Selection states
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>('e-src1-claim');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current));
    }, 2800);
  };

  // Execution console: neutral standby state until plan approval
  const [executionLogs, setExecutionLogs] = useState<string[]>([
    'Execution console ready · awaiting plan specification review',
  ]);

  // Pipeline backend integration state
  const [experimentId, setExperimentId] = useState<string | null>(null);
  const [gateSeq, setGateSeq] = useState<number | null>(null);
  const [activeGateSpec, setActiveGateSpec] = useState<ExperimentSpec | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);
  const streamCleanupRef = useRef<(() => void) | null>(null);

  // Load graph from API if configured, falling back to fixture
  useEffect(() => {
    let active = true;
    fetchWorkspaceGraph().then((res) => {
      if (active && res.source === 'api') {
        setNodes(res.nodes);
        setEdges(res.edges);
      }
    });

    return () => {
      active = false;
      if (streamCleanupRef.current) {
        streamCleanupRef.current();
        streamCleanupRef.current = null;
      }
    };
  }, []);

  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) || edges[0] || null;
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;

  const handleUpdateEdgeStatus = (edgeId: string, status: 'accepted' | 'rejected') => {
    setEdges((prev) =>
      prev.map((e) => (e.id === edgeId ? { ...e, status } : e))
    );
    showToast(`Edge marked as ${status.toUpperCase()} in local state`);
  };

  // Records source ingestion notification
  const handleIngestSource = (title: string, kind: 'web' | 'repo' | 'pdf', _url?: string) => {
    showToast(`Source queued: ${title} (${kind.toUpperCase()})`);
  };

  // Opens the SSE pipeline stream first; the backend creates and emits `approval.requested`
  const handleOpenPipelineRun = (targetExperimentId?: string) => {
    setApprovalError(null);
    const expId = targetExperimentId ?? experimentId;

    if (!expId) {
      // No live experiment ID bound yet; open modal in preview inspection mode
      setIsApprovalOpen(true);
      return;
    }

    if (!streamCleanupRef.current) {
      setIsConsoleOpen(true);
      setExecutionLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] [SSE] Connecting to /api/pipeline/${expId}...`,
      ]);

      streamCleanupRef.current = subscribeToPipelineStream(expId, {
        onLog: (line) => {
          setExecutionLogs((prev) => [...prev, line]);
        },
        onApprovalRequested: (event) => {
          setExperimentId(event.experimentId);
          setGateSeq(event.seq);
          setActiveGateSpec(event.spec);
          setApprovalError(null);
          setIsApprovalOpen(true);
        },
        onError: () => {
          const msg = `Pipeline stream error for ${expId}`;
          setExecutionLogs((prev) => [
            ...prev,
            `[${new Date().toLocaleTimeString()}] [SSE ERROR] ${msg}`,
          ]);
          showToast(msg);
        },
        onComplete: () => {
          streamCleanupRef.current = null;
        },
      });
    } else {
      setIsApprovalOpen(true);
    }
  };

  // Decision handlers only POST; the open SSE stream delivers approval.resolved & terminal events
  const handleApproveExperiment = async (expId = experimentId ?? undefined, seq = gateSeq ?? undefined) => {
    if (!expId || seq == null) {
      setApprovalError('No active pipeline gate has been requested yet. Start a pipeline run first.');
      return;
    }

    setIsSubmittingApproval(true);
    setApprovalError(null);
    const timestamp = new Date().toLocaleTimeString();

    try {
      const result = await sendPipelineApproval({
        experimentId: expId,
        gateSeq: seq,
        decision: 'approved',
      });

      if (!result.ok) {
        const errMsg = result.error || `Approval refused (HTTP ${result.status})`;
        setApprovalError(errMsg);
        showToast(errMsg);
        return;
      }

      setIsApprovalOpen(false);
      setIsConsoleOpen(true);
      showToast(`Plan confirmed for ${expId} (gate #${seq})`);
      setExecutionLogs((prev) => [
        ...prev,
        `[${timestamp}] [POST /api/pipeline/${expId}/approve] Gate #${seq} approved`,
      ]);
    } finally {
      setIsSubmittingApproval(false);
    }
  };

  const handleRejectExperiment = async (expId = experimentId ?? undefined, seq = gateSeq ?? undefined) => {
    if (!expId || seq == null) {
      setApprovalError('No active pipeline gate has been requested yet.');
      return;
    }

    setIsSubmittingApproval(true);
    setApprovalError(null);
    const timestamp = new Date().toLocaleTimeString();

    try {
      const result = await sendPipelineApproval({
        experimentId: expId,
        gateSeq: seq,
        decision: 'rejected',
      });

      if (!result.ok) {
        const errMsg = result.error || `Rejection refused (HTTP ${result.status})`;
        setApprovalError(errMsg);
        showToast(errMsg);
        return;
      }

      setIsApprovalOpen(false);
      showToast('Experiment plan rejected');
      setExecutionLogs((prev) => [
        ...prev,
        `[${timestamp}] [POST /api/pipeline/${expId}/approve] Gate #${seq} rejected`,
      ]);
    } finally {
      setIsSubmittingApproval(false);
    }
  };

  const handleSignOut = async () => {
    const res = await signOut();
    if (res.ok) {
      navigate({ to: '/sign-in' });
    } else {
      showToast(res.error || 'Sign out failed');
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-secondary)] font-sans">
      {/* Ambient Seamless Left Navigation Rail */}
      <Sidebar
        currentPage={currentPage}
        onNavigate={(page) => {
          setCurrentPage(page);
          if (page === 'graph') setIsInspectorOpen(true);
        }}
      />

      {/* Main Continuous Workspace Area */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0 bg-[var(--bg-primary)]">
        {/* Top Navbar */}
        <Navbar
          currentWorkspace={activeWorkspaceObj.name}
          workspaces={WORKSPACES}
          onSelectWorkspace={handleSelectWorkspace}
          isInspectorOpen={isInspectorOpen}
          onToggleInspector={() => setIsInspectorOpen(!isInspectorOpen)}
          onOpenApproval={() => handleOpenPipelineRun()}
          onOpenExport={() => setIsExportOpen(true)}
          onToggleConsole={() => setIsConsoleOpen(!isConsoleOpen)}
          onSignOut={handleSignOut}
          onAddSource={() => {
            if (currentPage === 'sources') {
              const input = document.querySelector('input[type="file"]') as HTMLInputElement;
              if (input) input.click();
            } else {
              setCurrentPage('sources');
            }
          }}
        />

        {/* Subheader Pagebar (Only for non-graph pages; Graph has no redundant title row) */}
        {currentPage !== 'graph' && (
          <div className="flex min-h-[46px] flex-none items-center justify-between border-b border-[var(--border-primary)] bg-transparent px-5 py-2 select-none">
            <div>
              <div className="text-sm font-bold text-[var(--text-primary)] font-mono">
                {PAGE_META[currentPage].title}
              </div>
              <div className="text-[11px] text-[var(--text-dim)] font-sans">
                {PAGE_META[currentPage].subtitle}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {currentPage === 'sources' && (
                <button
                  onClick={() => {
                    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
                    if (input) input.click();
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono bg-[#f97316] text-black font-bold hover:bg-[#ea580c] transition"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add source</span>
                </button>
              )}

              {currentPage === 'experiments' && (
                <button
                  onClick={() => handleOpenPipelineRun()}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono bg-[#f97316] text-black font-bold hover:bg-[#ea580c] transition"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Plan & Run</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Page Views Container */}
        <div className="flex-1 overflow-auto relative">
          {currentPage === 'overview' && (
            <OverviewPage onOpenGraph={() => setCurrentPage('graph')} />
          )}

          {currentPage === 'graph' && (
            <div className="relative flex h-full flex-1 overflow-hidden">
              <ResearchCanvas
                initialNodes={nodes}
                initialEdges={edges}
                selectedEdgeId={selectedEdgeId}
                selectedNodeId={selectedNodeId}
                onSelectEdge={(id) => {
                  setSelectedEdgeId(id);
                  setSelectedNodeId(null);
                  setIsInspectorOpen(true);
                }}
                onSelectNode={(id) => {
                  setSelectedNodeId(id);
                  if (id) setIsInspectorOpen(true);
                }}
              />
              {isInspectorOpen && (
                <EvidencePanel
                  node={selectedNode}
                  edge={selectedNode ? null : selectedEdge}
                  allNodes={nodes}
                  allEdges={edges}
                  onSelectNode={(id) => {
                    setSelectedNodeId(id);
                    setIsInspectorOpen(true);
                  }}
                  onSelectEdge={(id) => {
                    setSelectedEdgeId(id);
                    setSelectedNodeId(null);
                    setIsInspectorOpen(true);
                  }}
                  onUpdateStatus={handleUpdateEdgeStatus}
                  onClose={() => setIsInspectorOpen(false)}
                />
              )}
            </div>
          )}

          {currentPage === 'sources' && (
            <SourcesPage onShowToast={showToast} onIngestSource={handleIngestSource} />
          )}

          {currentPage === 'ask' && (
            <AskResearchPage />
          )}

          {currentPage === 'agents' && (
            <AgentMonitorPage />
          )}

          {currentPage === 'experiments' && (
            <ExperimentsPage
              onOpenApproval={() => handleOpenPipelineRun()}
              onOpenCompare={() => setCurrentPage('compare')}
            />
          )}

          {currentPage === 'compare' && (
            <ComparisonView />
          )}

          {currentPage === 'strategies' && (
            <StrategyDashboard />
          )}

          {currentPage === 'settings' && (
            <SettingsPage onShowToast={showToast} />
          )}
        </div>

        {/* Bottom Execution Console Drawer */}
        <ConsoleDrawer
          isOpen={isConsoleOpen}
          onClose={() => setIsConsoleOpen(false)}
          logs={executionLogs}
        />
      </div>

      {/* Global Modals */}
      <ApprovalModal
        isOpen={isApprovalOpen}
        onClose={() => {
          setApprovalError(null);
          setIsApprovalOpen(false);
        }}
        onApprove={handleApproveExperiment}
        onReject={handleRejectExperiment}
        experimentId={experimentId ?? undefined}
        gateSeq={gateSeq ?? undefined}
        spec={activeGateSpec}
        errorMessage={approvalError}
        isSubmitting={isSubmittingApproval}
      />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        onShowToast={showToast}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 border border-emerald-500/50 bg-[#101e16] text-emerald-200 px-4 py-2.5 text-xs font-mono shadow-2xl animate-fade-in flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
