import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState, useEffect, useMemo, useRef } from 'react';
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
import { ExportModal, type ExportRunContext } from '../components/panels/ExportModal';
import { ConsoleDrawer } from '../components/panels/ConsoleDrawer';
import {
  DEMO_NODES,
  DEMO_EDGES,
  DEMO_WORKSPACE_SUBTITLE,
} from '../data/demoWorkspace';
import type { ExperimentSpec } from '../shared/types';
import { getCurrentUser } from '../server/auth';
import { signOut } from '../utils/authClient';
import { sendPipelineApproval, subscribeToPipelineStream } from '../utils/pipelineClient';
import {
  fetchWorkspaceGraph,
  isDatabaseWorkspaceId,
  selectWorkspaceGraph,
  type WorkspaceGraphSource,
  type WorkspaceGraphView,
} from '../utils/graphClient';
import type { AgentTaskRow } from '../utils/strategyClient';

/**
 * An experiment id only becomes a pipeline URL when it is a UUID. A stale or
 * hand-edited `?experimentId=` must never open an SSE connection.
 */
const EXPERIMENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isExperimentId = (value: string | null | undefined): value is string =>
  typeof value === 'string' && EXPERIMENT_ID_RE.test(value);

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
  experimentId?: string;
  preview?: string;
  redirect?: string;
}

const WORKSPACES = [
  {
    id: 'research-graph',
    name: 'Research Graph',
    subtitle: DEMO_WORKSPACE_SUBTITLE,
  },
];

const FIXTURE_WORKSPACE_ID = WORKSPACES[0].id;

/** Strategy rows tagged with the workspace they were loaded for. */
interface WorkspaceStrategyState {
  workspaceId: string;
  tasks: AgentTaskRow[];
  source: WorkspaceGraphSource;
}

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): WorkspaceSearchParams => {
    const rawPage = typeof search.page === 'string' ? (search.page as PageId) : undefined;
    return {
      page: rawPage && VALID_PAGES.has(rawPage) ? rawPage : undefined,
      workspace: typeof search.workspace === 'string' ? search.workspace : undefined,
      experimentId: typeof search.experimentId === 'string' ? search.experimentId : undefined,
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

function WorkspacePage() {
  const navigate = useNavigate({ from: '/' });
  const search = Route.useSearch();
  const { isPreview } = Route.useRouteContext();

  // Graph and strategy rows carry the workspace they belong to, so a workspace switch
  // never renders the previous workspace's data under the new workspace's header.
  const [graphState, setGraphState] = useState<WorkspaceGraphView>(() => ({
    workspaceId: FIXTURE_WORKSPACE_ID,
    nodes: DEMO_NODES,
    edges: DEMO_EDGES,
    source: 'fixture',
  }));
  const [strategyState, setStrategyState] = useState<WorkspaceStrategyState>(() => ({
    workspaceId: FIXTURE_WORKSPACE_ID,
    tasks: [],
    source: 'fixture',
  }));
  const [workspaces, setWorkspaces] = useState(WORKSPACES);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);

  // URL-addressable active page and workspace (active id derived directly from search.workspace)
  const currentPage: PageId = search.page ?? 'graph';
  const activeWorkspaceId = search.workspace ?? workspaces[1]?.id ?? FIXTURE_WORKSPACE_ID;
  const activeIsDatabaseWorkspace = isDatabaseWorkspaceId(activeWorkspaceId);
  const activeWorkspaceObj = workspaces.find((w) => w.id === activeWorkspaceId) ?? {
    id: activeWorkspaceId,
    name: activeWorkspaceId,
    subtitle: 'Database workspace',
  };

  // Readable for the requested workspace only. A UUID workspace has no fixture fallback:
  // until its request resolves the canvas gets an explicit loading state and no nodes.
  // This runs during render (and SSR), so stale rows are never painted under a new header.
  const graphForWorkspace = useMemo<WorkspaceGraphView>(
    () => selectWorkspaceGraph(graphState, activeWorkspaceId),
    [graphState, activeWorkspaceId],
  );

  const strategiesForWorkspace = useMemo<WorkspaceStrategyState>(() => {
    if (strategyState.workspaceId === activeWorkspaceId) return strategyState;
    return activeIsDatabaseWorkspace
      ? { workspaceId: activeWorkspaceId, tasks: [], source: 'loading' }
      : { workspaceId: activeWorkspaceId, tasks: [], source: 'fixture' };
  }, [strategyState, activeWorkspaceId, activeIsDatabaseWorkspace]);

  const { nodes, edges, source: graphSource } = graphForWorkspace;
  const { tasks: agentTasks, source: strategiesSource } = strategiesForWorkspace;

  const setCurrentPage = (page: PageId) => {
    navigate({
      search: (prev) => ({ ...prev, page }),
    });
  };

  const handleSelectWorkspace = (workspaceId: string) => {
    const target = workspaces.find((w) => w.id === workspaceId);
    if (!target) return;
    navigate({
      search: (prev) => ({ ...prev, workspace: target.id, experimentId: undefined }),
    });
    showToast(`Switched workspace to ${target.name}`);
  };

  // UI state
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [isApprovalOpen, setIsApprovalOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportRun, setExportRun] = useState<(ExportRunContext & { workspaceId: string }) | null>(null);

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
  const [experimentId, setExperimentId] = useState<string | null>(
    isExperimentId(search.experimentId) ? search.experimentId : null,
  );
  const [gateSeq, setGateSeq] = useState<number | null>(null);
  const [activeGateSpec, setActiveGateSpec] = useState<ExperimentSpec | null>(null);
  const [gateRepair, setGateRepair] = useState<{ parentRunId: string; attempt?: number | null } | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const streamCleanupRef = useRef<(() => void) | null>(null);
  const lastSeqRef = useRef<Record<string, number>>({});
  const approvalOpenedByStreamRef = useRef(false);
  /**
   * The gate the UI currently shows. The async decision handlers compare
   * against this after their POST resolves: a stream terminal, a newer gate,
   * or a URL change may have replaced it while the request was in flight.
   */
  const activeGateRef = useRef<{ experimentId: string; gateSeq: number } | null>(null);
  const pendingDecisionRef = useRef(false);
  const decisionTokenRef = useRef(0);

  const openGate = (expId: string, seq: number, spec: ExperimentSpec | null) => {
    activeGateRef.current = { experimentId: expId, gateSeq: seq };
    setGateSeq(seq);
    setActiveGateSpec(spec);
  };

  const clearGate = () => {
    activeGateRef.current = null;
    setGateSeq(null);
    setActiveGateSpec(null);
    setGateRepair(null);
  };

  // Load live user workspaces (with UUIDs) on mount, preserving the demo fixture entry
  useEffect(() => {
    if (isPreview) return;
    let active = true;
    fetch('/api/workspaces', { headers: { Accept: 'application/json' } })
      .then((res) => {
        if (!res.ok) {
          if (res.status !== 401 && res.status !== 403 && active) {
            showToast(`Workspace list unavailable (HTTP ${res.status})`);
          }
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (active && data && Array.isArray(data.workspaces) && data.workspaces.length > 0) {
          setWorkspaces([...WORKSPACES, ...data.workspaces]);
        }
      })
      .catch(() => {
        if (active) showToast('Failed to load workspace list');
      });
    return () => {
      active = false;
    };
  }, [isPreview]);

  useEffect(() => {
    const onWorkspaceUpdated = (event: Event) => {
      if ((event as CustomEvent<{ workspaceId: string }>).detail?.workspaceId === activeWorkspaceId) {
        setWorkspaceRevision((revision) => revision + 1);
      }
    };
    window.addEventListener('rg:workspace-updated', onWorkspaceUpdated);
    return () => window.removeEventListener('rg:workspace-updated', onWorkspaceUpdated);
  }, [activeWorkspaceId]);

  // Load graph and strategy agent_tasks for the requested workspace: database rows for a UUID,
  // the demo fixture for the intentional fixture route. Every write is tagged with the workspace
  // it belongs to, and every response from a superseded workspace is ignored.
  useEffect(() => {
    let active = true;
    const requestedWorkspaceId = activeWorkspaceId;

    if (!isDatabaseWorkspaceId(requestedWorkspaceId)) {
      setGraphState({
        workspaceId: requestedWorkspaceId,
        nodes: DEMO_NODES,
        edges: DEMO_EDGES,
        source: 'fixture',
      });
      setStrategyState({
        workspaceId: requestedWorkspaceId,
        tasks: [],
        source: 'fixture',
      });
      return () => {
        active = false;
      };
    }

    setGraphState({
      workspaceId: requestedWorkspaceId,
      nodes: [],
      edges: [],
      source: 'loading',
    });
    setStrategyState({
      workspaceId: requestedWorkspaceId,
      tasks: [],
      source: 'loading',
    });

    fetchWorkspaceGraph(requestedWorkspaceId).then((res) => {
      if (!active) return;
      if (res.source === 'api') {
        setGraphState({
          workspaceId: requestedWorkspaceId,
          nodes: res.nodes,
          edges: res.edges,
          source: 'api',
        });
        setWorkspaces((prev) =>
          prev.map((w) =>
            w.id === requestedWorkspaceId
              ? { ...w, subtitle: `${res.nodes.length} nodes · ${res.edges.length} edges (database)` }
              : w,
          ),
        );
      } else {
        setGraphState({
          workspaceId: requestedWorkspaceId,
          nodes: [],
          edges: [],
          source: 'error',
        });
        showToast('Failed to load workspace graph from database');
      }
    });

    fetch(`/api/strategies?workspaceId=${encodeURIComponent(requestedWorkspaceId)}`, {
      headers: { Accept: 'application/json' },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        if (data && Array.isArray(data.tasks)) {
          setStrategyState({
            workspaceId: requestedWorkspaceId,
            tasks: data.tasks,
            source: 'api',
          });
        } else {
          setStrategyState({
            workspaceId: requestedWorkspaceId,
            tasks: [],
            source: 'error',
          });
        }
      })
      .catch(() => {
        if (active) {
          setStrategyState({
            workspaceId: requestedWorkspaceId,
            tasks: [],
            source: 'error',
          });
        }
      });

    return () => {
      active = false;
    };
  }, [activeWorkspaceId, workspaceRevision]);

  useEffect(() => {
    return () => {
      streamCleanupRef.current?.();
      streamCleanupRef.current = null;
    };
  }, []);

  // Separate effect for URL-triggered SSE pipeline stream so workspace switches do not kill an active stream
  useEffect(() => {
    const urlExperimentId = search.experimentId;

    if (!urlExperimentId) {
      // The URL no longer names a run. Any gate it opened is stale: reset it
      // rather than leaving a decision that posts to a run the address bar
      // does not show.
      clearGate();
      setApprovalError(null);
      if (approvalOpenedByStreamRef.current) {
        approvalOpenedByStreamRef.current = false;
        setIsApprovalOpen(false);
      }
      return;
    }

    if (!isExperimentId(urlExperimentId)) {
      // Never open an EventSource for a non-UUID. Drop the invalid param so a
      // reload cannot retry it.
      clearGate();
      setExperimentId(null);
      setIsApprovalOpen(false);
      setExecutionLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] [SSE] Ignored invalid experimentId in URL`,
      ]);
      showToast('Experiment ID in the URL is not a valid UUID');
      navigate({
        search: (prev) => ({ ...prev, experimentId: undefined }),
        replace: true,
      });
      return;
    }

    handleOpenPipelineRun(urlExperimentId);

    return () => {
      if (streamCleanupRef.current) {
        streamCleanupRef.current();
        streamCleanupRef.current = null;
      }
      setIsStreaming(false);
    };
  }, [search.experimentId]);

  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) || edges[0] || null;
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;

  const handleUpdateEdgeStatus = (edgeId: string, status: 'accepted' | 'rejected') => {
    setGraphState((prev) => {
      const base = prev.workspaceId === activeWorkspaceId ? prev : graphForWorkspace;
      return {
        ...base,
        edges: base.edges.map((e) => (e.id === edgeId ? { ...e, status } : e)),
      };
    });
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
      // No live experiment ID bound yet; open modal in fixture preview mode (approve/reject disabled)
      setIsApprovalOpen(true);
      return;
    }

    if (!isExperimentId(expId)) {
      // The modal validates its own input, but the URL and state can be stale.
      // Refuse before creating an EventSource.
      const msg = 'Experiment ID must be a valid UUID.';
      setApprovalError(msg);
      setExecutionLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] [SSE] Refused invalid experiment id`,
      ]);
      showToast(msg);
      return;
    }

    // Close previous stream if reconnecting or switching to a new experiment ID
    if (targetExperimentId && streamCleanupRef.current) {
      streamCleanupRef.current();
      streamCleanupRef.current = null;
      setIsStreaming(false);
    }

    if (targetExperimentId && targetExperimentId !== experimentId) {
      clearGate();
    }

    setExperimentId(expId);

    if (!streamCleanupRef.current) {
      setIsStreaming(true);
      setIsConsoleOpen(true);
      setExecutionLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] [SSE] Connecting to /api/pipeline/${expId}...`,
      ]);

      let awaitingApproval = false;
      streamCleanupRef.current = subscribeToPipelineStream(
        expId,
        {
          onEvent: (event) => {
            if (event.type === 'approval.requested') awaitingApproval = true;
            if (event.type === 'approval.resolved') awaitingApproval = false;

            // Keep the manual reconnect cursor before a pending gate so its
            // spec and decision controls can be restored from replay.
            if (!awaitingApproval && typeof event.seq === 'number') {
              lastSeqRef.current[expId] = Math.max(lastSeqRef.current[expId] ?? 0, event.seq);
            }
          },
          onLog: (line) => {
            setExecutionLogs((prev) => [...prev, line]);
          },
          onApprovalRequested: (event) => {
            setExperimentId(event.experimentId);
            openGate(event.experimentId, event.seq, event.spec);
            setGateRepair(event.repair ?? null);
            setApprovalError(null);
            approvalOpenedByStreamRef.current = true;
            setIsApprovalOpen(true);
          },
          onApprovalResolved: () => {
            clearGate();
            if (approvalOpenedByStreamRef.current) {
              approvalOpenedByStreamRef.current = false;
              setIsApprovalOpen(false);
            }
          },
          onError: (err) => {
            const es = (err as any)?.target;
            // Let native EventSource auto-reconnect with Last-Event-ID on transient errors
            if (es && typeof EventSource !== 'undefined' && es.readyState === EventSource.CONNECTING) {
              return;
            }
            const detail =
              err instanceof Error && err.message ? `: ${err.message}` : '';
            const msg = `Pipeline stream error for ${expId}${detail}`;
            setExecutionLogs((prev) => [
              ...prev,
              `[${new Date().toLocaleTimeString()}] [SSE ERROR] ${msg}`,
            ]);
            showToast(msg);
            if (streamCleanupRef.current) {
              streamCleanupRef.current();
              streamCleanupRef.current = null;
            }
            setIsStreaming(false);
            // The next open replays any pending gate from the saved cursor.
            clearGate();
            setApprovalError(msg);
            if (approvalOpenedByStreamRef.current) {
              approvalOpenedByStreamRef.current = false;
              setIsApprovalOpen(false);
            }
          },
          onComplete: () => {
            setWorkspaceRevision((revision) => revision + 1);
            delete lastSeqRef.current[expId];
            streamCleanupRef.current = null;
            setIsStreaming(false);
            setExperimentId(null);
            clearGate();
            // Only the terminal event clears the URL, and only when the URL
            // still names this experiment. A replaced run keeps its own param.
            if (search.experimentId === expId) {
              navigate({
                search: (prev) =>
                  prev.experimentId === expId
                    ? { ...prev, experimentId: undefined }
                    : prev,
                replace: true,
              });
            }
            if (approvalOpenedByStreamRef.current) {
              approvalOpenedByStreamRef.current = false;
              setIsApprovalOpen(false);
            }
          },
        },
        { initialLastSeq: lastSeqRef.current[expId] ?? 0 },
      );
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

    if (pendingDecisionRef.current) return;

    pendingDecisionRef.current = true;
    const decisionToken = ++decisionTokenRef.current;
    setIsSubmittingApproval(true);
    setApprovalError(null);
    const timestamp = new Date().toLocaleTimeString();

    try {
      const result = await sendPipelineApproval({
        experimentId: expId,
        gateSeq: seq,
        decision: 'approved',
      });

      // The gate may have been resolved by the stream or replaced by a newer
      // one while this POST was in flight. Never clear a gate the modal no
      // longer shows.
      const stillCurrent =
        activeGateRef.current?.experimentId === expId &&
        activeGateRef.current?.gateSeq === seq;

      if (!result.ok) {
        const errMsg = result.error || `Approval refused (HTTP ${result.status})`;
        const codeLabel = result.code ?? `HTTP ${result.status}`;
        setExecutionLogs((prev) => [
          ...prev,
          `[${timestamp}] [APPROVAL] Approve refused (${codeLabel}): ${errMsg}`,
        ]);
        setIsConsoleOpen(true);
        if (!stillCurrent) return;
        setApprovalError(errMsg);
        showToast(errMsg);
        if (result.status === 409) {
          // The gate was already decided, or the experiment went terminal.
          // The stream is the source of truth; drop the stale decision UI.
          clearGate();
          setIsApprovalOpen(false);
        }
        return;
      }

      if (!stillCurrent) return;

      clearGate();
      setIsApprovalOpen(false);
      setIsConsoleOpen(true);
      showToast(`Plan confirmed for ${expId} (gate #${seq})`);
      setExecutionLogs((prev) => [
        ...prev,
        `[${timestamp}] [POST /api/pipeline/${expId}/approve] Gate #${seq} approved`,
      ]);
    } finally {
      if (decisionTokenRef.current === decisionToken) {
        pendingDecisionRef.current = false;
        setIsSubmittingApproval(false);
      }
    }
  };

  const handleRejectExperiment = async (expId = experimentId ?? undefined, seq = gateSeq ?? undefined) => {
    if (!expId || seq == null) {
      setApprovalError('No active pipeline gate has been requested yet.');
      return;
    }

    if (pendingDecisionRef.current) return;

    pendingDecisionRef.current = true;
    const decisionToken = ++decisionTokenRef.current;
    setIsSubmittingApproval(true);
    setApprovalError(null);
    const timestamp = new Date().toLocaleTimeString();

    try {
      const result = await sendPipelineApproval({
        experimentId: expId,
        gateSeq: seq,
        decision: 'rejected',
      });

      const stillCurrent =
        activeGateRef.current?.experimentId === expId &&
        activeGateRef.current?.gateSeq === seq;

      if (!result.ok) {
        const errMsg = result.error || `Rejection refused (HTTP ${result.status})`;
        const codeLabel = result.code ?? `HTTP ${result.status}`;
        setExecutionLogs((prev) => [
          ...prev,
          `[${timestamp}] [APPROVAL] Reject refused (${codeLabel}): ${errMsg}`,
        ]);
        setIsConsoleOpen(true);
        if (!stillCurrent) return;
        setApprovalError(errMsg);
        showToast(errMsg);
        if (result.status === 409) {
          clearGate();
          setIsApprovalOpen(false);
        }
        return;
      }

      if (!stillCurrent) return;

      clearGate();
      setIsApprovalOpen(false);
      // Keep the rejection in view: the console is the durable UI record of
      // what the POST did, so open it instead of only toasting.
      setIsConsoleOpen(true);
      showToast('Experiment plan rejected');
      setExecutionLogs((prev) => [
        ...prev,
        `[${timestamp}] [POST /api/pipeline/${expId}/approve] Gate #${seq} rejected`,
      ]);
    } finally {
      if (decisionTokenRef.current === decisionToken) {
        pendingDecisionRef.current = false;
        setIsSubmittingApproval(false);
      }
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
        showFixtureCounts={graphSource === 'fixture'}
        onNavigate={(page) => {
          setCurrentPage(page);
          if (page === 'graph') setIsInspectorOpen(true);
        }}
      />

      {/* Main Continuous Workspace Area */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0 bg-[var(--bg-primary)]">
        {/* Top Navbar */}
        <Navbar
          currentWorkspace={`${activeWorkspaceObj.name} · ${
            graphSource === 'api'
              ? 'database'
              : graphSource === 'error'
                ? 'unavailable'
                : graphSource === 'loading'
                  ? 'loading database…'
                  : 'demo fixture'
          }`}
          activeWorkspaceId={activeWorkspaceObj.id}
          workspaces={workspaces}
          onSelectWorkspace={handleSelectWorkspace}
          showInspectorToggle={currentPage === 'graph'}
          isInspectorOpen={isInspectorOpen}
          onToggleInspector={() => setIsInspectorOpen(!isInspectorOpen)}
          onOpenApproval={() => handleOpenPipelineRun()}
          onOpenExport={() => setIsExportOpen(true)}
          onToggleConsole={() => setIsConsoleOpen(!isConsoleOpen)}
          onSignOut={handleSignOut}
        />

        {/* Page Views Container */}
        <div className="flex-1 overflow-auto relative">
          {currentPage === 'overview' && (
            <OverviewPage onOpenGraph={() => setCurrentPage('graph')} />
          )}

          {currentPage === 'graph' && (
            <div className="relative flex h-full flex-1 overflow-hidden">
              <ResearchCanvas
                key={activeWorkspaceId}
                initialNodes={nodes}
                initialEdges={edges}
                workspaceId={activeWorkspaceObj.id}
                isLoading={graphSource === 'loading'}
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
            <SourcesPage workspaceId={activeWorkspaceId} onShowToast={showToast} onIngestSource={handleIngestSource} />
          )}

          {currentPage === 'ask' && (
            <AskResearchPage />
          )}

          {currentPage === 'agents' && (
            <AgentMonitorPage />
          )}

          {currentPage === 'experiments' && (
            <ExperimentsPage
              workspaceId={activeWorkspaceId}
              onShowToast={showToast}
              onOpenRunExport={(run) => {
                setExportRun({ ...run, workspaceId: activeWorkspaceId });
                setIsExportOpen(true);
              }}
              onOpenApproval={() => handleOpenPipelineRun()}
              onOpenCompare={() => setCurrentPage('compare')}
            />
          )}

          {currentPage === 'compare' && (
            <ComparisonView />
          )}

          {currentPage === 'strategies' && (
            <StrategyDashboard tasks={agentTasks} source={strategiesSource} />
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
        onStartStream={(id) => handleOpenPipelineRun(id)}
        experimentId={experimentId}
        gateSeq={gateSeq}
        spec={activeGateSpec}
        repair={gateRepair}
        errorMessage={approvalError}
        isSubmitting={isSubmittingApproval}
        isStreaming={isStreaming}
      />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        onShowToast={showToast}
        workspaceId={activeIsDatabaseWorkspace ? activeWorkspaceId : null}
        activeRun={exportRun?.workspaceId === activeWorkspaceId ? exportRun : null}
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
