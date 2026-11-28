import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import {
  Plus,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Play,
  CheckCircle2,
  XCircle,
  ExternalLink,
} from 'lucide-react';
import { HERO_EXPERIMENT_SPEC_RUN_A } from '../../../fixtures/hero-spec';
import { isDatabaseWorkspaceId } from '../../utils/graphClient';

interface ExperimentsPageProps {
  onOpenApproval: () => void;
  onOpenCompare: () => void;
  workspaceId?: string;
  onShowToast?: (msg: string) => void;
  onOpenRunExport?: (run: { runId: string; label: string }) => void;
}

interface LiveRunArtifact {
  id: string;
  kind: string;
  path: string;
  sha256: string;
  bytes: number;
}

interface LiveVerdictCheck {
  metric: string;
  op: string;
  threshold: number;
  tolerance: number | null;
  measured: number | null;
  passed: boolean;
}

interface LiveRun {
  id: string;
  attempt: number;
  status: string;
  runner: string;
  parameters: Record<string, unknown>;
  metrics: Record<string, number>;
  verdict: string | null;
  verdictDetail: { checks: LiveVerdictCheck[]; explanation: string | null } | null;
  stdout: string;
  stderr: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  artifacts: LiveRunArtifact[];
}

interface LiveExperiment {
  id: string;
  claimNodeId: string;
  claimTitle: string;
  claimText: string | null;
  mode: string;
  approvalState: string;
  createdAt: string;
  parameters: Record<string, unknown>;
  criteria: { mode: string; checks: Array<{ metric: string; op: string; value: number }> };
  datasets: Array<{ name: string; url: string; bytes: number | null; sha256: string | null }>;
  timeoutSeconds: number;
  memoryMb: number;
  cpuCount: number;
  network: string;
  entrypoint: string;
  files: Record<string, string>;
  runs: LiveRun[];
}

interface LiveClaim {
  id: string;
  title: string;
  sourceId: string | null;
  text: string | null;
  datasetName: string | null;
  methodName: string | null;
}

interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  claimHint: string;
  dataset: string;
  method: string;
  mode: string;
  parameters: {
    importance_method: {
      label: string;
      options: Array<{ value: string; label: string }>;
      defaultValue: string;
    };
    n_estimators: { label: string; min: number; max: number; defaultValue: number };
    seed: { label: string; min: number; max: number; defaultValue: number };
  };
  timeoutSeconds: number;
  memoryMb: number;
  cpuCount: number;
  network: string;
  criteria: { mode: string; checks: Array<{ metric: string; op: string; value: number }> };
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function verdictTone(verdict: string | null): string {
  if (verdict === 'match') return 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10';
  if (verdict === 'mismatch') return 'text-red-300 border-red-500/40 bg-red-500/10';
  if (verdict === 'failed') return 'text-red-300 border-red-500/40 bg-red-500/10';
  return 'text-amber-200 border-amber-500/40 bg-amber-500/10';
}

function statusTone(status: string): string {
  if (status === 'succeeded') return 'text-emerald-300';
  if (status === 'failed' || status === 'timeout' || status === 'cancelled') return 'text-red-300';
  if (status === 'running') return 'text-sky-300';
  return 'text-[var(--text-muted)]';
}

export const ExperimentsPage: React.FC<ExperimentsPageProps> = (props) => {
  const routerSearch = useRouterState({
    select: (state) => state.location.search as Record<string, unknown>,
  });
  const searchWorkspace =
    typeof routerSearch?.workspace === 'string' ? routerSearch.workspace : undefined;
  const activeWorkspaceId = props.workspaceId ?? searchWorkspace;
  const activeExperimentId =
    typeof routerSearch?.experimentId === 'string' ? routerSearch.experimentId : null;

  if (isDatabaseWorkspaceId(activeWorkspaceId)) {
    return (
      <LiveExperimentsPage
        {...props}
        workspaceId={activeWorkspaceId}
        activeExperimentId={activeExperimentId}
      />
    );
  }

  return <FixtureExperimentsPage {...props} />;
};

const FixtureExperimentsPage: React.FC<ExperimentsPageProps> = ({
  onOpenApproval,
  onOpenCompare,
}) => {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto animate-fade-in font-mono">
      {/* Top Action Bar */}
      <div className="flex justify-end">
        <button
          onClick={onOpenApproval}
          className="flex items-center gap-1.5 px-3 py-2 bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] transition shadow-md"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New experiment</span>
        </button>
      </div>

      {/* Grid 2: Experiment Plan & Execution Safety Boundary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Experiment Plan Card */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
              Experiment plan
            </div>
            <h2 className="text-base font-bold text-[var(--text-primary)] font-mono">
              Random Forest Variable Importance
            </h2>
            <p className="text-xs text-[var(--text-dim)] font-sans">
              Test whether impurity-based importance ranks high-cardinality synthetic noise
              features among the top predictors.
            </p>

            <div className="pt-2 border-t border-[var(--border-primary)] space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--text-dim)]">Dataset:</span>
                <strong className="text-[var(--text-primary)]">Breast-w + 3 noise columns</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-dim)]">Estimator:</span>
                <strong className="text-[var(--text-primary)]">
                  RandomForest · {Number(HERO_EXPERIMENT_SPEC_RUN_A.parameters.n_estimators || 100)} trees
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-dim)]">Reproduction mode:</span>
                <span className="badge-orange-outline !text-[8px] rounded-none uppercase">
                  {HERO_EXPERIMENT_SPEC_RUN_A.mode}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-dim)]">Execution target:</span>
                <strong className="text-[var(--text-primary)]">E2B isolated sandbox</strong>
              </div>
            </div>
          </div>

          <button
            onClick={onOpenApproval}
            className="w-full mt-4 py-2 bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] transition text-center"
          >
            Review plan & approve →
          </button>
        </div>

        {/* Execution Safety Boundary Card */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
          <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
            Execution safety boundary
          </div>

          <div className="space-y-2.5 text-xs pt-1">
            <div className="flex justify-between items-center border-b border-[var(--border-primary)] pb-2">
              <span className="text-[var(--text-dim)]">Network access:</span>
              <span className="badge-solid-white !text-[8px] rounded-none uppercase">
                {HERO_EXPERIMENT_SPEC_RUN_A.network === 'none'
                  ? 'DISABLED'
                  : HERO_EXPERIMENT_SPEC_RUN_A.network}
              </span>
            </div>
            <div className="flex justify-between items-center border-b border-[var(--border-primary)] pb-2">
              <span className="text-[var(--text-dim)]">Memory limit:</span>
              <strong className="text-[var(--text-primary)]">
                {HERO_EXPERIMENT_SPEC_RUN_A.memoryMb} MB
              </strong>
            </div>
            <div className="flex justify-between items-center border-b border-[var(--border-primary)] pb-2">
              <span className="text-[var(--text-dim)]">Timeout:</span>
              <strong className="text-[var(--text-primary)]">
                {HERO_EXPERIMENT_SPEC_RUN_A.timeoutSeconds} seconds
              </strong>
            </div>
            <div className="flex justify-between items-center border-b border-[var(--border-primary)] pb-2">
              <span className="text-[var(--text-dim)]">Dataset:</span>
              <strong className="text-[var(--text-primary)] font-mono">
                {HERO_EXPERIMENT_SPEC_RUN_A.datasets[0]?.name || 'breast-w'} (
                {HERO_EXPERIMENT_SPEC_RUN_A.mode})
              </strong>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[var(--text-dim)]">Human approval:</span>
              <strong className="text-[#f97316]">REQUIRED</strong>
            </div>
          </div>

          <p className="text-[11px] text-[var(--text-dim)] pt-2 border-t border-[var(--border-primary)] font-sans leading-relaxed">
            Every experiment is configured for an isolated ephemeral microVM. Datasets and
            dependencies are specified deterministically before execution.
          </p>
        </div>
      </div>

      {/* Recent Experiment Runs Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
            EXPERIMENT SPECIFICATIONS &amp; RUN TEMPLATES (PREVIEW)
          </div>
          <span className="badge-orange-outline !text-[8px] rounded-none">PREVIEW</span>
        </div>
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border-primary)] text-[10px] text-[var(--text-dim)] uppercase tracking-wider">
                <th className="p-3">RUN</th>
                <th className="p-3">METHOD</th>
                <th className="p-3">MODE</th>
                <th className="p-3">CRITERIA</th>
                <th className="p-3">STATUS</th>
                <th className="p-3 text-right">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-primary)]">
              <tr className="hover:bg-[var(--bg-surface-hover)]">
                <td className="p-3 font-semibold text-[var(--text-primary)]">Run A · root</td>
                <td className="p-3 text-[var(--text-muted)]">Impurity importance</td>
                <td className="p-3">
                  <span className="badge-orange-outline !text-[8px] rounded-none">ADAPTED</span>
                </td>
                <td className="p-3 font-mono text-[11px] text-[var(--text-dim)]">
                  rank_impurity(noise_20) &le; 5
                </td>
                <td className="p-3">
                  <span className="badge-solid-white !text-[8px] rounded-none">SPECIFICATION</span>
                </td>
                <td className="p-3 text-right">
                  <button
                    onClick={onOpenCompare}
                    className="px-2.5 py-1 border border-[var(--border-primary)] hover:border-[#f97316] hover:text-[#f97316] transition text-[11px]"
                  >
                    Compare
                  </button>
                </td>
              </tr>
              <tr className="hover:bg-[var(--bg-surface-hover)]">
                <td className="p-3 font-semibold text-[var(--text-primary)]">Run B · what-if</td>
                <td className="p-3 text-[var(--text-muted)]">Permutation importance</td>
                <td className="p-3">
                  <span className="badge-orange-outline !text-[8px] rounded-none">ADAPTED</span>
                </td>
                <td className="p-3 font-mono text-[11px] text-[var(--text-dim)]">
                  rank_permutation(noise_20) &gt; 5
                </td>
                <td className="p-3">
                  <span className="badge-solid-white !text-[8px] rounded-none">SPECIFICATION</span>
                </td>
                <td className="p-3 text-right">
                  <button
                    onClick={onOpenCompare}
                    className="px-2.5 py-1 border border-[var(--border-primary)] hover:border-[#f97316] hover:text-[#f97316] transition text-[11px]"
                  >
                    Compare
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const LiveExperimentsPage: React.FC<
  ExperimentsPageProps & { workspaceId: string; activeExperimentId: string | null }
> = ({ workspaceId, activeExperimentId, onShowToast, onOpenRunExport }) => {
  const navigate = useNavigate({ from: '/' });
  const [experiments, setExperiments] = useState<LiveExperiment[]>([]);
  const [claims, setClaims] = useState<LiveClaim[]>([]);
  const [template, setTemplate] = useState<TemplateInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedExperimentId, setSelectedExperimentId] = useState<string | null>(null);

  const [selectedClaimId, setSelectedClaimId] = useState<string>('');
  const [importanceMethod, setImportanceMethod] = useState<'impurity' | 'permutation'>('impurity');
  const [nEstimators, setNEstimators] = useState(
    Number(HERO_EXPERIMENT_SPEC_RUN_A.parameters.n_estimators || 100),
  );
  const [seed, setSeed] = useState(Number(HERO_EXPERIMENT_SPEC_RUN_A.parameters.seed || 42));
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const defaultsAppliedRef = useRef(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/experiments?workspaceId=${encodeURIComponent(workspaceId)}`,
        { headers: { Accept: 'application/json' } },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (data && typeof data.error === 'string' && data.error) || `HTTP ${res.status}`,
        );
      }
      setExperiments(Array.isArray(data.experiments) ? data.experiments : []);
      setClaims(Array.isArray(data.claims) ? data.claims : []);
      setTemplate(data.template ?? null);
      setSelectedExperimentId((current) => {
        if (current && data.experiments?.some((exp: LiveExperiment) => exp.id === current)) {
          return current;
        }
        return data.experiments?.[0]?.id ?? null;
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load experiments');
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (defaultsAppliedRef.current || !template) return;
    defaultsAppliedRef.current = true;
    setImportanceMethod(
      template.parameters.importance_method.defaultValue === 'permutation'
        ? 'permutation'
        : 'impurity',
    );
    setNEstimators(template.parameters.n_estimators.defaultValue);
    setSeed(template.parameters.seed.defaultValue);
  }, [template]);

  useEffect(() => {
    if (!selectedClaimId && claims.length > 0) {
      setSelectedClaimId(claims[0]!.id);
    }
  }, [claims, selectedClaimId]);

  // Poll while the shell has an experiment stream open (the URL names a run that
  // may pass the approval gate) or while a run row is still in flight. A plan
  // that is merely pending, with no stream, is not polled forever.
  const hasActiveWork = useMemo(
    () =>
      activeExperimentId !== null ||
      experiments.some((experiment) =>
        experiment.runs.some((run) => run.status === 'queued' || run.status === 'running'),
      ),
    [activeExperimentId, experiments],
  );

  useEffect(() => {
    if (!hasActiveWork) return;
    const timer = setInterval(() => {
      void load();
    }, 4000);
    return () => clearInterval(timer);
  }, [hasActiveWork, load]);

  // The shell clears `experimentId` on the terminal stream event. Fetch once
  // more so the page shows the terminal run instead of its last `running` poll.
  const previousActiveExperimentIdRef = useRef<string | null>(activeExperimentId);
  useEffect(() => {
    if (previousActiveExperimentIdRef.current && !activeExperimentId) {
      void load();
    }
    previousActiveExperimentIdRef.current = activeExperimentId;
  }, [activeExperimentId, load]);

  const handleCreate = async () => {
    if (!selectedClaimId || isCreating) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          workspaceId,
          claimNodeId: selectedClaimId,
          templateId: 'rf-variable-importance',
          parameters: {
            importance_method: importanceMethod,
            n_estimators: nEstimators,
            seed,
          },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const details =
          data && Array.isArray(data.details) && data.details.length > 0
            ? `: ${data.details.join('; ')}`
            : '';
        throw new Error(
          `${(data && typeof data.error === 'string' && data.error) || `HTTP ${res.status}`}${details}`,
        );
      }

      await load();
      const createdId = data?.experiment?.id;
      onShowToast?.('Experiment created. The plan is waiting for approval.');
      if (typeof createdId === 'string') {
        setSelectedExperimentId(createdId);
        navigate({
          search: (prev) => ({
            ...prev,
            page: 'experiments',
            workspace: workspaceId,
            experimentId: createdId,
          }),
        });
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create the experiment');
    } finally {
      setIsCreating(false);
    }
  };

  const openStream = (experimentId: string) => {
    setSelectedExperimentId(experimentId);
    navigate({
      search: (prev) => ({
        ...prev,
        page: 'experiments',
        workspace: workspaceId,
        experimentId,
      }),
    });
  };

  const scrollToForm = () => {
    if (typeof document === 'undefined') return;
    document.getElementById('new-experiment')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openGraph = () => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('page', 'graph');
    url.searchParams.set('workspace', workspaceId);
    url.searchParams.delete('experimentId');
    // A document navigation refetches the graph, which is mounted state rather
    // than a route loader. The projected run/result nodes then appear.
    window.location.assign(url.toString());
  };

  const selectedExperiment = experiments.find(
    (experiment) => experiment.id === selectedExperimentId,
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto animate-fade-in font-mono">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
            Experiments
          </div>
          <p className="text-[11px] text-[var(--text-dim)] font-sans mt-1">
            Plans are stored in the database. Results below are read from `runs` rows; nothing on
            this page is fixture data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openGraph}
            className="flex items-center gap-1.5 px-3 py-2 border border-[var(--border-primary)] text-xs text-[var(--text-dim)] hover:text-[#f97316]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open graph
          </button>
          <button
            onClick={() => void load()}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-2 border border-[var(--border-primary)] text-xs text-[var(--text-dim)] hover:text-[#f97316] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={scrollToForm}
            className="flex items-center gap-1.5 px-3 py-2 bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] transition shadow-md"
          >
            <Plus className="h-3.5 w-3.5" />
            New experiment
          </button>
        </div>
      </div>

      {loadError && (
        <div className="flex items-start gap-2 border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200 font-sans">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* New experiment from the single supported template */}
      <div
        id="new-experiment"
        className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4"
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="max-w-xl space-y-2">
            <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
              Supported tabular experiment
            </div>
            <h2 className="text-base font-bold text-[var(--text-primary)]">
              {template?.name ?? 'Random forest variable importance'}
            </h2>
            <p className="text-xs text-[var(--text-dim)] font-sans">
              {template?.description ??
                'Tests whether impurity-based importance ranks a high-cardinality noise feature among the top predictors.'}
            </p>
            <p className="text-[11px] text-[var(--text-dim)] font-sans">
              {template?.claimHint ??
                'Choose a claim about random-forest feature importance.'}
            </p>
          </div>
          <div className="text-[10px] text-[var(--text-dim)] space-y-1 min-w-[210px]">
            <div>
              Dataset: <span className="text-[var(--text-primary)]">{template?.dataset ?? 'breast-w'}</span>
            </div>
            <div>
              Method: <span className="text-[var(--text-primary)]">{template?.method ?? 'scikit-learn'}</span>
            </div>
            <div>
              Mode: <span className="badge-orange-outline !text-[8px] rounded-none">ADAPTED</span>
            </div>
            <div>
              Network:{' '}
              <span className="text-[var(--text-primary)] uppercase">
                {template?.network === 'none' ? 'DISABLED' : template?.network ?? 'none'}
              </span>
            </div>
            {template?.criteria?.checks?.length ? (
              <div>
                Criteria:{' '}
                <span className="text-[var(--text-primary)]">
                  {template.criteria.checks
                    .map((check) => `${check.metric} ${check.op} ${check.value}`)
                    .join(' · ')}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {claims.length === 0 ? (
          <div className="border border-dashed border-amber-500/40 bg-amber-500/5 p-4 text-xs text-amber-200 font-sans">
            No claim nodes exist in this workspace yet. Ingest a source first so the experiment can
            attach to a verified claim.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[10px] text-[var(--text-dim)] uppercase">Claim</label>
              <select
                value={selectedClaimId}
                onChange={(event) => setSelectedClaimId(event.target.value)}
                className="w-full border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-2 text-xs text-[var(--text-primary)] outline-none"
              >
                {claims.map((claim) => (
                  <option key={claim.id} value={claim.id}>
                    {claim.title}
                  </option>
                ))}
              </select>
              {selectedClaimId && (
                <p className="text-[10px] text-[var(--text-dim)] font-sans pt-1">
                  {claims.find((claim) => claim.id === selectedClaimId)?.text ??
                    'Claim text unavailable.'}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] text-[var(--text-dim)] uppercase">
                  Importance method
                </label>
                <select
                  value={importanceMethod}
                  onChange={(event) =>
                    setImportanceMethod(event.target.value === 'permutation' ? 'permutation' : 'impurity')
                  }
                  className="w-full border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-2 text-xs text-[var(--text-primary)] outline-none"
                >
                  <option value="impurity">Impurity (Gini)</option>
                  <option value="permutation">Permutation</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-[var(--text-dim)] uppercase">Estimators</label>
                <input
                  type="number"
                  min={template?.parameters.n_estimators.min ?? 10}
                  max={template?.parameters.n_estimators.max ?? 500}
                  step={1}
                  value={nEstimators}
                  onChange={(event) => setNEstimators(Number(event.target.value))}
                  className="w-full border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-2 text-xs text-[var(--text-primary)] outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-[var(--text-dim)] uppercase">Seed</label>
                <input
                  type="number"
                  min={template?.parameters.seed.min ?? 0}
                  max={template?.parameters.seed.max ?? 2_147_483_647}
                  step={1}
                  value={seed}
                  onChange={(event) => setSeed(Number(event.target.value))}
                  className="w-full border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-2 text-xs text-[var(--text-primary)] outline-none"
                />
              </div>
            </div>

            {createError && (
              <div className="flex items-start gap-2 border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200 font-sans">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>{createError}</span>
              </div>
            )}

            <button
              onClick={() => void handleCreate()}
              disabled={isCreating || !selectedClaimId}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] disabled:opacity-50 transition"
            >
              {isCreating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {isCreating ? 'Creating plan...' : 'Create plan & request approval'}
            </button>
            <p className="text-[10px] text-[var(--text-dim)] font-sans">
              Creating a plan does not execute code. The pipeline opens the approval gate; the
              isolated runner starts only after a recorded human decision.
            </p>
          </div>
        )}
      </div>

      {/* Persisted experiments and their measured runs */}
      <div className="space-y-3">
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
          PERSISTED EXPERIMENTS ({experiments.length})
        </div>

        {isLoading && experiments.length === 0 && (
          <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-8 flex items-center justify-center gap-2 text-xs text-[var(--text-dim)]">
            <Loader2 className="h-4 w-4 animate-spin text-[#f97316]" />
            Loading experiments from the database...
          </div>
        )}

        {!isLoading && experiments.length === 0 && (
          <div className="border border-dashed border-[var(--border-primary)] bg-[var(--card-bg)] p-8 text-center space-y-1">
            <div className="text-xs font-bold text-[var(--text-primary)]">
              No experiments yet
            </div>
            <p className="text-[11px] text-[var(--text-dim)] font-sans">
              Choose a claim above to create the supported tabular plan.
            </p>
          </div>
        )}

        {experiments.map((experiment) => {
          const isSelected = experiment.id === selectedExperiment?.id;
          return (
            <div
              key={experiment.id}
              className={`border bg-[var(--card-bg)] p-5 space-y-3 transition ${
                isSelected
                  ? 'border-[#f97316]/70 shadow-[0_0_0_1px_rgba(249,115,22,0.25)]'
                  : 'border-[var(--border-primary)]'
              }`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                      {experiment.claimTitle}
                    </span>
                    <span className="badge-orange-outline !text-[8px] rounded-none uppercase">
                      {experiment.mode}
                    </span>
                    <span className="badge-solid-white !text-[8px] rounded-none uppercase">
                      {experiment.approvalState}
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)]">
                    {formatDate(experiment.createdAt)} · {experiment.runs.length} run
                    {experiment.runs.length === 1 ? '' : 's'} · {experiment.entrypoint}
                  </div>
                  {experiment.claimText && (
                    <p className="text-[11px] text-[var(--text-dim)] font-sans line-clamp-2">
                      {experiment.claimText}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => openStream(experiment.id)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] border border-[var(--border-primary)] hover:border-[#f97316] hover:text-[#f97316] transition"
                >
                  <Play className="h-3 w-3" />
                  {experiment.runs.length === 0 ? 'Open plan & approve' : 'Open stream'}
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] border-t border-[var(--border-primary)] pt-3">
                <div>
                  <div className="text-[var(--text-dim)] uppercase">Method</div>
                  <div className="text-[var(--text-primary)]">
                    {String(experiment.parameters.importance_method ?? '—')}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--text-dim)] uppercase">Estimators</div>
                  <div className="text-[var(--text-primary)]">
                    {String(experiment.parameters.n_estimators ?? '—')}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--text-dim)] uppercase">Seed</div>
                  <div className="text-[var(--text-primary)]">
                    {String(experiment.parameters.seed ?? '—')}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--text-dim)] uppercase">Isolation</div>
                  <div className="text-[var(--text-primary)]">
                    {experiment.memoryMb} MB · {experiment.cpuCount} vCPU · network{' '}
                    {experiment.network}
                  </div>
                </div>
              </div>

              {experiment.runs.length === 0 ? (
                <div className="text-[11px] text-[var(--text-dim)] font-sans border-t border-[var(--border-primary)] pt-3">
                  No run row yet. Opening the plan stream requests the gate and starts execution
                  only after approval.
                </div>
              ) : (
                <div className="space-y-3 border-t border-[var(--border-primary)] pt-3">
                  {experiment.runs.map((run) => (
                    <div key={run.id} className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap text-[11px]">
                        <span className="text-[var(--text-primary)] font-semibold">
                          Attempt {run.attempt}
                        </span>
                        <span className={`uppercase ${statusTone(run.status)}`}>{run.status}</span>
                        <span className="text-[var(--text-dim)]">·</span>
                        <span className="text-[var(--text-dim)]">{run.runner}</span>
                        {run.verdict && (
                          <span
                            className={`border px-1.5 py-0.5 uppercase text-[9px] rounded-none ${verdictTone(run.verdict)}`}
                          >
                            {run.verdict}
                          </span>
                        )}
                        <span className="text-[var(--text-dim)] ml-auto">
                          {formatDate(run.finishedAt ?? run.startedAt ?? run.createdAt)}
                        </span>
                      </div>

                      {run.verdictDetail?.explanation && (
                        <p className="text-[11px] text-[var(--text-muted)] font-sans">
                          {run.verdictDetail.explanation}
                        </p>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <div className="text-[9px] uppercase text-[var(--text-dim)] mb-1">
                            Measured metrics
                          </div>
                          {Object.keys(run.metrics).length === 0 ? (
                            <div className="text-[10px] text-[var(--text-dim)]">No metrics</div>
                          ) : (
                            <table className="w-full text-[10px]">
                              <tbody>
                                {Object.entries(run.metrics).map(([metric, value]) => (
                                  <tr key={metric} className="border-b border-[var(--border-primary)]/50">
                                    <td className="py-0.5 pr-2 text-[var(--text-dim)] font-mono">
                                      {metric}
                                    </td>
                                    <td className="py-0.5 text-[var(--text-primary)] font-mono text-right">
                                      {Number.isFinite(value) ? value : String(value)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                        <div>
                          <div className="text-[9px] uppercase text-[var(--text-dim)] mb-1">
                            Criteria checks
                          </div>
                          {!run.verdictDetail || run.verdictDetail.checks.length === 0 ? (
                            <div className="text-[10px] text-[var(--text-dim)]">
                              No verdict detail recorded
                            </div>
                          ) : (
                            <table className="w-full text-[10px]">
                              <tbody>
                                {run.verdictDetail.checks.map((check) => (
                                  <tr
                                    key={`${check.metric}-${check.op}`}
                                    className="border-b border-[var(--border-primary)]/50"
                                  >
                                    <td className="py-0.5 pr-2 font-mono text-[var(--text-dim)]">
                                      {check.metric} {check.op} {check.threshold}
                                    </td>
                                    <td className="py-0.5 text-right text-[var(--text-primary)] font-mono">
                                      {check.measured === null ? 'missing' : check.measured}
                                    </td>
                                    <td className="py-0.5 pl-2 text-right">
                                      {check.passed ? (
                                        <CheckCircle2 className="h-3 w-3 text-emerald-400 inline" />
                                      ) : (
                                        <XCircle className="h-3 w-3 text-red-400 inline" />
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </div>

                      {run.artifacts.length > 0 && (
                        <div className="text-[10px] text-[var(--text-dim)]">
                          Artifacts:{' '}
                          {run.artifacts
                            .map((artifact) => `${artifact.path} (${formatBytes(artifact.bytes)})`)
                            .join(' · ')}
                          {onOpenRunExport && (
                            <button
                              type="button"
                              className="ml-2 text-[var(--text-primary)] underline"
                              onClick={() => onOpenRunExport({ runId: run.id, label: `Attempt ${run.attempt}` })}
                            >
                              Export run artifacts
                            </button>
                          )}
                        </div>
                      )}

                      {(run.stdout || run.stderr) && (
                        <details className="text-[10px]">
                          <summary className="cursor-pointer text-[var(--text-dim)] hover:text-[var(--text-primary)]">
                            Captured output
                          </summary>
                          {run.stdout && (
                            <pre className="mt-1 max-h-48 overflow-auto bg-[var(--bg-primary)] border border-[var(--border-primary)] p-2 whitespace-pre-wrap text-[var(--text-muted)]">
                              {run.stdout}
                            </pre>
                          )}
                          {run.stderr && (
                            <pre className="mt-1 max-h-32 overflow-auto bg-red-500/5 border border-red-500/30 p-2 whitespace-pre-wrap text-red-200">
                              {run.stderr}
                            </pre>
                          )}
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <details className="text-[10px] border-t border-[var(--border-primary)] pt-2">
                <summary className="cursor-pointer text-[var(--text-dim)] hover:text-[var(--text-primary)]">
                  Stored plan script ({Object.keys(experiment.files).length} file
                  {Object.keys(experiment.files).length === 1 ? '' : 's'})
                </summary>
                {Object.entries(experiment.files).map(([path, source]) => (
                  <div key={path} className="mt-2">
                    <div className="text-[var(--text-dim)] font-mono mb-1">{path}</div>
                    <pre className="max-h-56 overflow-auto bg-[var(--bg-primary)] border border-[var(--border-primary)] p-2 whitespace-pre-wrap text-[var(--text-muted)]">
                      {source}
                    </pre>
                  </div>
                ))}
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
};
