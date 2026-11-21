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
import { Terminal, ArrowRight } from 'lucide-react';

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
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0E1116] text-[#E6EAF0] font-sans select-none">
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onOpenApproval={() => setIsApprovalOpen(true)}
        onOpenExport={() => setIsExportOpen(true)}
        onToggleLogs={() => setShowLogDrawer(!showLogDrawer)}
        logCount={executionLogs.length}
      />

      {/* Main Body depending on activeTab */}
      <div className="relative flex-1 w-full overflow-hidden flex flex-col">
        {/* VIEW 1: GRAPH WORKSPACE */}
        {activeTab === 'graph' && (
          <div className="relative flex flex-1 h-full w-full overflow-hidden">
            {/* Left Canvas Section */}
            <div className="flex flex-1 flex-col min-w-0 h-full p-4 gap-3">
              <div className="relative flex-1 rounded-[14px] border border-[#252C36] overflow-hidden bg-[#0E1116]">
                <ResearchCanvas
                  initialNodes={nodes}
                  initialEdges={edges}
                  selectedEdgeId={selectedEdgeId}
                  onSelectEdge={(edgeId) => setSelectedEdgeId(edgeId)}
                />

                {/* Quick Status Floating Pill */}
                <div className="absolute top-4 left-4 z-20 flex items-center gap-3">
                  <div className="c flex items-center gap-2.5 px-3.5 py-2 bg-[#161B22]/90 backdrop-blur shadow-xl border-[#252C36]">
                    <div
                      className={`h-2 w-2 rounded-full ${
                        isRunningPipeline
                          ? 'bg-[#3DD6B5] animate-ping'
                          : 'bg-[#3DD6B5]'
                      }`}
                    />
                    <div className="text-xs">
                      <span className="font-semibold text-[#E6EAF0]">
                        {isRunningPipeline ? 'Executing in E2B: ' : 'Hero Claim Verified: '}
                      </span>
                      <span className="text-[#3DD6B5] font-mono">
                        {isRunningPipeline ? 'python main.py' : 'Run A (Match) · Run B (Match)'}
                      </span>
                    </div>
                    <button
                      onClick={() => setActiveTab('runs')}
                      className="ml-2 flex items-center gap-1 rounded bg-[#252C36] px-2 py-0.5 text-[11px] font-medium text-[#E6EAF0] hover:text-[#3DD6B5] transition border border-[#3A4452]"
                    >
                      <span>View Delta</span>
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Canvas Bottom Legend matching Mockup Screen 1 */}
              <div className="flex items-center gap-4 flex-wrap l text-[10px] text-[#9AA4B2] px-1">
                <span>solid = accepted</span>
                <span>dashed = suggested</span>
                <span>teal halo = selected edge</span>
              </div>
            </div>

            {/* Right Evidence Sidebar matching Mockup Screen 1 */}
            <EvidencePanel
              edge={selectedEdge}
              onUpdateStatus={handleUpdateEdgeStatus}
            />
          </div>
        )}

        {/* VIEW 2: RUN A VS RUN B (MOCKUP SCREEN 2) */}
        {activeTab === 'runs' && (
          <div className="flex-1 w-full h-full overflow-y-auto">
            <ComparisonView isModal={false} />
          </div>
        )}

        {/* VIEW 3: AGENT STRATEGIES DASHBOARD (MOCKUP SCREEN 3) */}
        {activeTab === 'dashboard' && (
          <div className="flex-1 w-full h-full overflow-y-auto">
            <StrategyDashboard isModal={false} />
          </div>
        )}

        {/* Live Execution Logs Drawer */}
        {showLogDrawer && (
          <div className="absolute bottom-4 left-4 right-4 z-30 max-w-2xl rounded-2xl border border-[#252C36] bg-[#161B22]/95 p-4 shadow-2xl backdrop-blur-md animate-fade-in">
            <div className="flex items-center justify-between border-b border-[#252C36] pb-2 mb-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#E6EAF0]">
                <Terminal className="h-4 w-4 text-[#3DD6B5]" />
                <span>E2B Sandbox Execution Stream (network: none)</span>
              </div>
              <button
                onClick={() => setShowLogDrawer(false)}
                className="text-xs text-[#9AA4B2] hover:text-[#E6EAF0]"
              >
                Hide
              </button>
            </div>
            <div className="max-h-44 overflow-y-auto font-mono text-[11px] leading-relaxed text-[#E6EAF0] space-y-1">
              {executionLogs.map((log, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-[#9AA4B2] select-none">&gt;</span>
                  <span>{log}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Slide-over Drawers & Modals */}
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
