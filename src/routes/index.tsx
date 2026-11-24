import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
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
import { Plus, Play } from 'lucide-react';

export const Route = createFileRoute('/')({
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
  const [nodes, setNodes] = useState<WorkspaceNode[]>(DEMO_NODES);
  const [edges, setEdges] = useState<WorkspaceEdge[]>(DEMO_EDGES);

  // Active view page matching the blueprint navigation
  const [currentPage, setCurrentPage] = useState<PageId>('graph');

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

  // Execution console simulation logs
  const [executionLogs, setExecutionLogs] = useState<string[]>([
    '[09:41:02] workspace loaded · fixture: strobl-rf-importance',
    '[09:41:03] 3 sources · 1 claim · 2 methods · 1 dataset · 2 runs indexed',
    '[09:41:04] awaiting user action · E2B runner idle',
  ]);

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
    showToast(`Source added: ${title} (${kind.toUpperCase()})`);
  };

  // Connects Plan & Run to the experiment approval lifecycle
  const handleApproveExperiment = () => {
    setIsApprovalOpen(false);
    setIsConsoleOpen(true);
    showToast('Plan specification confirmed.');

    setExecutionLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] plan specification reviewed and confirmed`,
    ]);
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
          currentWorkspace="Research Graph"
          isInspectorOpen={isInspectorOpen}
          onToggleInspector={() => setIsInspectorOpen(!isInspectorOpen)}
          onOpenApproval={() => setIsApprovalOpen(true)}
          onOpenExport={() => setIsExportOpen(true)}
          onToggleConsole={() => setIsConsoleOpen(!isConsoleOpen)}
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
                  onClick={() => setIsApprovalOpen(true)}
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
              onOpenApproval={() => setIsApprovalOpen(true)}
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
        onClose={() => setIsApprovalOpen(false)}
        onApprove={handleApproveExperiment}
        onReject={() => {
          setIsApprovalOpen(false);
          showToast('Experiment plan rejected');
        }}
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
