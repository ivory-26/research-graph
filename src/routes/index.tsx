import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { ResearchCanvas } from '../components/canvas/ResearchCanvas';
import { Navbar } from '../components/layout/Navbar';
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

  // Active Selected Edge for Evidence Drawer
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Modals & Drawers state
  const [isIngestOpen, setIsIngestOpen] = useState(false);
  const [isAskOpen, setIsAskOpen] = useState(false);
  const [isApprovalOpen, setIsApprovalOpen] = useState(false);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);

  // Pipeline simulation state
  const currentBeat = 6;
  const [isRunningPipeline, setIsRunningPipeline] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<string[]>([]);
  const [showLogDrawer, setShowLogDrawer] = useState(false);

  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) || null;

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
        '[E2B] Gini impurity ranking computed: noise_20 = Rank 1.',
        '[E2B] Permutation importance ranking computed: noise_20 = Rank 29.',
        '[E2B] Wrote /output/metrics.json with 6 metric keys.',
        '[EVALUATE] Evaluating criteria: rank_impurity(noise_20) <= 5 -> MATCH.',
        '[SANDBOX] Process completed with exitCode 0 in 3420ms. Sandbox killed.',
      ]);
      setIsRunningPipeline(false);
    }, 1500);
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 font-sans">
      {/* Top Navbar */}
      <Navbar
        onOpenIngest={() => setIsIngestOpen(true)}
        onOpenAsk={() => setIsAskOpen(true)}
        onOpenApproval={() => setIsApprovalOpen(true)}
        onOpenCompare={() => setIsCompareOpen(true)}
        onOpenDashboard={() => setIsDashboardOpen(true)}
        onOpenExport={() => setIsExportOpen(true)}
        currentBeat={currentBeat}
      />

      {/* Main Workspace Canvas */}
      <main className="relative flex-1 w-full h-[calc(100vh-64px)]">
        <ResearchCanvas
          initialNodes={nodes}
          initialEdges={edges}
          onSelectEdge={(edgeId) => setSelectedEdgeId(edgeId)}
        />

        {/* Floating Quick Action / Status Banner */}
        <div className="absolute top-4 left-4 z-20 flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/90 px-3.5 py-2 shadow-xl backdrop-blur-md">
            <div
              className={`h-2 w-2 rounded-full ${
                isRunningPipeline
                  ? 'bg-cyan-500 animate-ping'
                  : 'bg-emerald-500 animate-pulse'
              }`}
            />
            <div className="text-xs">
              <span className="font-bold text-white">
                {isRunningPipeline ? 'Executing in E2B: ' : 'Hero Claim Verified: '}
              </span>
              <span className="text-emerald-400 font-mono">
                {isRunningPipeline ? 'python main.py' : 'Run A (Match) · Run B (Match)'}
              </span>
            </div>
            <button
              onClick={() => setIsCompareOpen(true)}
              className="ml-2 rounded-md bg-purple-600/30 px-2 py-0.5 text-[11px] font-bold text-purple-300 hover:bg-purple-600/50 transition border border-purple-500/30"
            >
              View Delta
            </button>
          </div>

          {/* Log Console Trigger */}
          <button
            onClick={() => setShowLogDrawer(!showLogDrawer)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-xs font-semibold text-slate-300 shadow-xl backdrop-blur-md hover:bg-slate-800 transition"
          >
            <Terminal className="h-3.5 w-3.5 text-cyan-400" />
            <span>Sandbox Logs</span>
            {executionLogs.length > 0 && (
              <span className="rounded-full bg-cyan-950 px-1.5 text-[10px] font-bold text-cyan-400">
                {executionLogs.length}
              </span>
            )}
          </button>
        </div>

        {/* Live Execution Logs Drawer */}
        {showLogDrawer && (
          <div className="absolute bottom-4 left-4 right-4 z-20 max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-md animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                <Terminal className="h-4 w-4 text-cyan-400" />
                E2B Sandbox Execution Stream
              </div>
              <button
                onClick={() => setShowLogDrawer(false)}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                Hide
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto font-mono text-[11px] leading-relaxed text-slate-300 space-y-1">
              {executionLogs.length === 0 ? (
                <div className="text-slate-500 italic">No active execution. Click &quot;Plan &amp; Run&quot; to test.</div>
              ) : (
                executionLogs.map((log, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-slate-600 select-none">&gt;</span>
                    <span>{log}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>

      {/* Slide-over Evidence Panel */}
      <EvidencePanel
        edge={selectedEdge}
        onClose={() => setSelectedEdgeId(null)}
        onUpdateStatus={handleUpdateEdgeStatus}
      />

      {/* Experiment Approval Gate Modal */}
      <ApprovalModal
        isOpen={isApprovalOpen}
        onClose={() => setIsApprovalOpen(false)}
        onApprove={handleApproveExperiment}
        onReject={() => setIsApprovalOpen(false)}
      />

      {/* What-If Run A vs Run B Comparison Modal */}
      <ComparisonView
        isOpen={isCompareOpen}
        onClose={() => setIsCompareOpen(false)}
      />

      {/* Ask Across Sources (RAG) Drawer */}
      <AskSourcesPanel
        isOpen={isAskOpen}
        onClose={() => setIsAskOpen(false)}
      />

      {/* Collect / Ingestion Panel */}
      <IngestionPanel
        isOpen={isIngestOpen}
        onClose={() => setIsIngestOpen(false)}
      />

      {/* Strategy Leaderboard Modal */}
      <StrategyDashboard
        isOpen={isDashboardOpen}
        onClose={() => setIsDashboardOpen(false)}
      />

      {/* Jupyter Notebook Export Modal */}
      <NotebookExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
      />
    </div>
  );
}
