import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { ResearchCanvas } from '../components/canvas/ResearchCanvas';
import { Navbar, type ActiveTab } from '../components/layout/Navbar';
import { EvidencePanel } from '../components/panels/EvidencePanel';
import { ApprovalModal } from '../components/panels/ApprovalModal';
import { ComparisonView } from '../components/panels/ComparisonView';
import { AskSourcesPanel } from '../components/panels/AskSourcesPanel';
import { IngestionPanel } from '../components/panels/IngestionPanel';
import { StrategyDashboard } from '../components/panels/StrategyDashboard';
import { NotebookExportModal } from '../components/panels/NotebookExportModal';
import {
  DEMO_NODES,
  DEMO_EDGES,
} from '../data/demoWorkspace';
import type { WorkspaceNode, WorkspaceEdge } from '../data/demoWorkspace';
import { Terminal } from 'lucide-react';

export const Route = createFileRoute('/')({
  component: WorkspacePage,
});

function WorkspacePage() {
  const [nodes] = useState<WorkspaceNode[]>(DEMO_NODES);
  const [edges, setEdges] = useState<WorkspaceEdge[]>(DEMO_EDGES);

  // Active View Tab matching the 3 mockup screens
  const [activeTab, setActiveTab] = useState<ActiveTab>('graph');

  // Selected Edge for Evidence Sidebar (default to hero edge)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>('e-src1-claim');
  // Selected Node for Dynamic Lineage Path Tracing
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Modals & Panels state
  const [isIngestOpen, setIsIngestOpen] = useState(false);
  const [isAskOpen, setIsAskOpen] = useState(false);
  const [isApprovalOpen, setIsApprovalOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);

  // E2B execution simulation
  const [isRunningPipeline, setIsRunningPipeline] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<string[]>([
    '[E2B] Initialized isolated sandbox (allowInternetAccess: false)...',
    '[E2B] Fetched & pinned dataset breast-w.arff (SHA-256 match)...',
    '[E2B] Executing entrypoint: python main.py...',
    '[E2B] RandomForestClassifier(n_estimators=100) training complete.',
    '[E2B] Gini impurity ranking computed: noise_20 = Rank 2.',
    '[E2B] Permutation importance ranking computed: noise_20 = Rank 29.',
    '[E2B] Wrote /output/metrics.json with verified metrics.',
    '[EVALUATE] rank_impurity(noise_20) <= 5 -> 2 <= 5 (MATCH).',
    '[EVALUATE] rank_permutation(noise_20) > 15 -> 29 > 15 (MATCH).',
    '[SANDBOX] Sandbox terminated with exitCode 0 in 3420ms.',
  ]);
  const [showLogDrawer, setShowLogDrawer] = useState(false);

  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) || edges[0] || null;

  const handleUpdateEdgeStatus = (edgeId: string, status: 'accepted' | 'rejected') => {
    setEdges((prev) =>
      prev.map((e) => (e.id === edgeId ? { ...e, status } : e))
    );
  };

  const handleApproveExperiment = () => {
    setIsApprovalOpen(false);
    setIsRunningPipeline(true);
    setShowLogDrawer(true);
    setExecutionLogs([
      '[E2B] Initializing isolated sandbox (allowInternetAccess: false)...',
      '[E2B] Fetching & pinning dataset breast-w.arff (SHA-256 match)...',
      '[E2B] Writing generated main.py into sandbox...',
      '[E2B] Executing entrypoint: python main.py...',
    ]);

    setTimeout(() => {
      setExecutionLogs((prev) => [
        ...prev,
        '[E2B] RandomForestClassifier(n_estimators=100) training complete.',
        '[E2B] Gini impurity ranking computed: noise_20 = Rank 2.',
        '[E2B] Permutation importance ranking computed: noise_20 = Rank 29.',
        '[E2B] Wrote /output/metrics.json with 6 metric keys.',
        '[EVALUATE] Evaluating criteria: rank_impurity(noise_20) <= 5 -> MATCH.',
        '[EVALUATE] Evaluating criteria: rank_permutation(noise_20) > 15 -> MATCH.',
        '[SANDBOX] Process completed with exitCode 0 in 3420ms. Sandbox killed.',
      ]);
      setIsRunningPipeline(false);
    }, 1500);
  };

  const handleSelectTab = (tab: ActiveTab) => {
    if (tab === 'sources') {
      setIsIngestOpen(true);
    } else if (tab === 'ask') {
      setIsAskOpen(true);
    } else {
      setActiveTab(tab);
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#000000] text-[#e5e5e5]">
      {/* Prithvi Twin Global Navbar with Tri-color Accent Stripe */}
      <Navbar
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onOpenApproval={() => setIsApprovalOpen(true)}
        onOpenExport={() => setIsExportOpen(true)}
        onToggleLogs={() => setShowLogDrawer(!showLogDrawer)}
        logCount={executionLogs.length}
      />

      {/* Main Workspace Body */}
      <div className="relative flex flex-1 overflow-hidden">
        {activeTab === 'graph' && (
          <main className="relative flex h-full flex-1 overflow-hidden">
            <ResearchCanvas
              initialNodes={nodes}
              initialEdges={edges}
              selectedEdgeId={selectedEdgeId}
              selectedNodeId={selectedNodeId}
              onSelectEdge={(id) => setSelectedEdgeId(id)}
              onSelectNode={(id) => setSelectedNodeId(id)}
            />
            {/* Auditable Citation Evidence Sidebar */}
            <EvidencePanel
              edge={selectedEdge}
              onUpdateStatus={handleUpdateEdgeStatus}
            />
          </main>
        )}

        {activeTab === 'runs' && (
          <main className="flex-1 overflow-y-auto bg-[#000000]">
            <ComparisonView />
          </main>
        )}

        {activeTab === 'dashboard' && (
          <main className="flex-1 overflow-y-auto bg-[#000000]">
            <StrategyDashboard />
          </main>
        )}
      </div>

      {/* Stream Terminal Drawer (E2B Sandbox Logs) */}
      {showLogDrawer && (
        <aside className="border-t border-[#262626] bg-[#0a0a0a] p-4 font-mono text-xs shadow-2xl z-40">
          <div className="flex items-center justify-between pb-2 border-b border-[#262626]">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-[#f97316]" />
              <span className="font-bold text-white uppercase tracking-wider text-[11px]">
                E2B Isolated Sandbox Output Stream
              </span>
              {isRunningPipeline && (
                <span className="badge-orange-outline animate-pulse">
                  EXECUTING IN SANDBOX
                </span>
              )}
            </div>
            <button
              onClick={() => setShowLogDrawer(false)}
              className="text-[#737373] hover:text-white text-xs uppercase font-bold"
            >
              Close
            </button>
          </div>
          <div className="mt-2.5 max-h-40 overflow-y-auto space-y-1 text-[#a3a3a3]">
            {executionLogs.map((log, index) => {
              const isMatch = log.includes('MATCH');
              return (
                <div
                  key={index}
                  className={`flex items-center gap-2 ${
                    isMatch
                      ? 'text-[#f97316] font-semibold'
                      : log.includes('Executing')
                      ? 'text-white'
                      : ''
                  }`}
                >
                  <span className="text-[#525252] select-none text-[10px] w-5">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span>{log}</span>
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* Slide-out Panels & Dialogs */}
      <IngestionPanel
        isOpen={isIngestOpen}
        onClose={() => setIsIngestOpen(false)}
      />

      <AskSourcesPanel
        isOpen={isAskOpen}
        onClose={() => setIsAskOpen(false)}
      />

      <ApprovalModal
        isOpen={isApprovalOpen}
        onClose={() => setIsApprovalOpen(false)}
        onApprove={handleApproveExperiment}
        onReject={() => setIsApprovalOpen(false)}
      />

      <NotebookExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
      />
    </div>
  );
}
