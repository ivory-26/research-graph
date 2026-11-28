import React, { useEffect, useMemo, useState } from 'react';
import { X, Download, ExternalLink, Loader2, AlertCircle } from 'lucide-react';
import rawWorkspace from '../../../fixtures/workspace.json';
import { HERO_EXPERIMENT_SPEC_RUN_A } from '../../../fixtures/hero-spec';
import { PINNED_IMAGE_PACKAGES } from '../../data/demoWorkspace';
import { buildParameterEnvironmentSource } from '../../shared/notebook-parameters';
import {
  findNotebookArtifact,
  type RunArtifactManifest,
  type RunArtifactManifestEntry,
} from '../../shared/run-artifacts';
import {
  artifactDownloadUrl,
  fetchRunArtifactManifest,
} from '../../utils/artifactClient';
import { isDatabaseWorkspaceId } from '../../utils/graphClient';

/** The run an export is being made from, when a live database run is active. */
export interface ExportRunContext {
  runId: string;
  /** Display only; never used to authorize or address the request. */
  label?: string;
}

function buildReproducibleNotebook(spec = HERO_EXPERIMENT_SPEC_RUN_A) {
  const scriptCode = spec.files['main.py'] || '';
  const dataset = spec.datasets[0];
  const checks = spec.criteria.checks;

  const claimNode = (rawWorkspace.nodes as any[]).find((n) => n.type === 'claim');
  const claimQuote = claimNode?.data?.locator?.quote || '';
  const claimPage = claimNode?.data?.locator?.page;
  const claimCharStart = claimNode?.data?.locator?.charStart;
  const claimCharEnd = claimNode?.data?.locator?.charEnd;

  const pinnedPipPackages = Object.entries(PINNED_IMAGE_PACKAGES)
    .map(([pkg, ver]) => `"${pkg}==${ver}"`)
    .join(' ');

  return JSON.stringify(
    {
      cells: [
        {
          cell_type: 'markdown',
          metadata: {},
          source: [
            '# Reproducibility Record: Strobl et al. (2007)\n',
            '**Paper:** Strobl et al. (2007) *Bias in random forest variable importance measures: Illustrations, sources and a solution*\n',
            '**DOI:** `10.1186/1471-2105-8-25`\n',
            `**Claim (Verbatim, p. ${claimPage}, chars ${claimCharStart}–${claimCharEnd}):** "${claimQuote}"\n`,
            `**Mode:** ${spec.mode}\n`,
            '**Verdict Status:** Specification Preview (demo fixture, not a measured run)\n',
          ],
        },
        {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: [
            '# 1. Pinned dependencies install\n',
            `!pip install -q ${pinnedPipPackages}\n`,
          ],
        },
        {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: [
            '# 2. Dataset retrieval and verification\n',
            'import pathlib, urllib.request, hashlib\n',
            `dest_path = pathlib.Path("${dataset?.path || 'data/breast-w.arff'}")\n`,
            'dest_path.parent.mkdir(parents=True, exist_ok=True)\n',
            `data_url = "${dataset?.url || 'https://www.openml.org/data/download/52350/breast-w.arff'}"\n`,
            'if not dest_path.exists():\n',
            '    urllib.request.urlretrieve(data_url, dest_path)\n',
            'data_bytes = dest_path.read_bytes()\n',
            'print(f"Cached {dest_path}: {len(data_bytes)} bytes, sha256={hashlib.sha256(data_bytes).hexdigest()[:16]}...")\n',
          ],
        },
        {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: buildParameterEnvironmentSource(spec.parameters)
            .split('\n')
            .map((line) => line + '\n'),
        },
        {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: scriptCode.split('\n').map((line) => line + '\n'),
        },
        {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: [
            '# 4. Display generated metrics\n',
            'import json, pathlib\n',
            'metrics_path = pathlib.Path("/output/metrics.json")\n',
            'if not metrics_path.exists():\n',
            '    metrics_path = pathlib.Path("metrics.json")\n',
            'if metrics_path.exists():\n',
            '    with open(metrics_path) as f:\n',
            '        metrics = json.load(f)\n',
            '    print(json.dumps(metrics, indent=2))\n',
            'else:\n',
            '    print("metrics.json not found")\n',
          ],
        },
        {
          cell_type: 'markdown',
          metadata: {},
          source: [
            '### Evaluation Criteria\n',
            ...checks.map((c) => {
              const opMap: Record<string, string> = {
                lte: '<=',
                lt: '<',
                gte: '>=',
                gt: '>',
                eq: '==',
              };
              const opSymbol = opMap[c.op] || c.op;
              const explanation = c.metric.includes('impurity')
                ? 'evaluates whether high-cardinality noise is artificially favored and ranked among top predictors under impurity importance.'
                : 'evaluates whether permutation importance remedies the bias by dropping high-cardinality noise toward the bottom ranks.';
              return `- Target check: \`${c.metric}\` ${opSymbol} ${c.value} -> ${explanation}\n`;
            }),
          ],
        },
      ],
      metadata: {
        language_info: { name: 'python' },
      },
      nbformat: 4,
      nbformat_minor: 2,
    },
    null,
    2
  );
}

function downloadBlob(content: string, type: string, filename: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function artifactLabel(artifact: RunArtifactManifestEntry): string {
  return artifact.path.split('/').pop() || artifact.path;
}

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShowToast: (msg: string) => void;
  /**
   * A live database run to export from. A workspace without a selected run
   * can still export its graph.
   */
  activeRun?: ExportRunContext | null;
  /** Enables a live workspace JSON download when it is a database UUID. */
  workspaceId?: string | null;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  onShowToast,
  activeRun = null,
  workspaceId = null,
}) => {
  const [manifest, setManifest] = useState<RunArtifactManifest | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspaceDownloading, setWorkspaceDownloading] = useState(false);

  const liveRunId = activeRun?.runId ?? null;
  // A fixture workspace id (for example `research-graph`) is not a database
  // workspace; it must never be fetched as if it were one.
  const liveWorkspaceId = isDatabaseWorkspaceId(workspaceId) ? workspaceId : null;
  const isDemo = liveRunId === null && liveWorkspaceId === null;

  useEffect(() => {
    if (!isOpen || !liveRunId) {
      setManifest(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setManifest(null);

    void fetchRunArtifactManifest(liveRunId).then((result) => {
      if (cancelled) return;
      setIsLoading(false);
      if (result.ok) {
        setManifest(result.manifest);
      } else {
        setError(result.error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, liveRunId]);

  const notebook = useMemo(() => findNotebookArtifact(manifest), [manifest]);

  if (!isOpen) return null;

  const handleDownloadJson = () => {
    downloadBlob(
      JSON.stringify(rawWorkspace, null, 2),
      'application/json',
      'researchgraph-workspace.json'
    );
    onShowToast('Downloaded the demo workspace.json fixture (not a live workspace)');
    onClose();
  };

  const handleDownloadNotebook = () => {
    downloadBlob(
      buildReproducibleNotebook(),
      'application/x-ipynb+json',
      'strobl_rf_reproducibility.ipynb'
    );
    onShowToast('Downloaded the demo reproducible notebook (.ipynb, not a measured run)');
    onClose();
  };

  const handleDownloadLiveArtifact = (artifact: RunArtifactManifestEntry) => {
    if (!liveRunId) return;
    const anchor = document.createElement('a');
    anchor.href = artifactDownloadUrl(liveRunId, artifact.id);
    anchor.rel = 'noopener';
    anchor.download = artifactLabel(artifact);
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    onShowToast(`Downloading ${artifactLabel(artifact)} from run ${liveRunId.slice(0, 8)}…`);
  };

  const handleOpenColab = () => {
    window.open('https://colab.research.google.com/#create=true', '_blank', 'noopener');
    onShowToast('In Colab, use File → Upload notebook and select the downloaded .ipynb');
  };

  const handleDownloadLiveWorkspace = async () => {
    if (!liveWorkspaceId) return;
    setWorkspaceDownloading(true);
    try {
      const response = await fetch(`/api/graph?workspaceId=${encodeURIComponent(liveWorkspaceId)}`, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      downloadBlob(
        JSON.stringify(payload, null, 2),
        'application/json',
        `researchgraph-${liveWorkspaceId}.json`
      );
      onShowToast('Downloaded the live workspace graph');
    } catch (err) {
      onShowToast(
        `Could not download the live workspace: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setWorkspaceDownloading(false);
    }
  };

  const runLabel = activeRun?.label
    ? activeRun.label
    : liveRunId
      ? `Run ${liveRunId.slice(0, 8)}`
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md animate-fade-in font-mono">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border-primary)] p-4">
          <div>
            <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase">
              Export Workspace
            </h3>
            <p className="text-[10px] text-[var(--text-dim)] font-sans mt-0.5">
              {runLabel
                ? `Run artifacts for ${runLabel}`
                : isDemo ? 'Demo fixture export' : 'Export the current workspace graph'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[var(--text-dim)] hover:text-[var(--text-primary)] transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {isDemo ? (
            <>
              <div className="border border-amber-500/30 bg-amber-950/10 px-3 py-2 text-[10px] text-amber-200/90 font-sans">
                Demo mode: the notebook and workspace JSON below come from
                <code className="mx-1">fixtures/</code>, not from a run row. Open a live
                experiment to export its persisted notebook and artifacts.
              </div>

              {/* Option 1: Jupyter Notebook */}
              <div className="flex items-center justify-between p-3.5 border border-[var(--border-primary)] bg-[var(--card-bg)] hover:border-[var(--border-secondary)] transition gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-10 border border-[#f97316] bg-[#f97316]/10 text-[#f97316] flex items-center justify-center font-bold text-xs flex-shrink-0">
                    IPYNB
                  </div>
                  <div>
                    <div className="text-xs font-bold text-[var(--text-primary)]">
                      Demo Reproducibility Notebook
                    </div>
                    <div className="text-[10px] text-[var(--text-dim)] font-sans mt-0.5">
                      Fixture specification · not a measured run
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleDownloadNotebook}
                  className="px-3 py-1.5 bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] transition flex items-center gap-1"
                >
                  <Download className="h-3 w-3" />
                  <span>Export</span>
                </button>
              </div>

              {/* Option 2: Workspace JSON */}
              <div className="flex items-center justify-between p-3.5 border border-[var(--border-primary)] bg-[var(--card-bg)] hover:border-[var(--border-secondary)] transition gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-10 border border-sky-400 bg-sky-950/30 text-sky-400 flex items-center justify-center font-bold text-xs flex-shrink-0">
                    JSON
                  </div>
                  <div>
                    <div className="text-xs font-bold text-[var(--text-primary)]">
                      Workspace JSON Fixture
                    </div>
                    <div className="text-[10px] text-[var(--text-dim)] font-sans mt-0.5">
                      Complete demo graph: sources, claims, methods, datasets, runs
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleDownloadJson}
                  className="px-3 py-1.5 border border-[var(--border-primary)] bg-[var(--bg-surface)] hover:text-[#f97316] transition text-xs font-mono flex items-center gap-1"
                >
                  <Download className="h-3 w-3" />
                  <span>Export</span>
                </button>
              </div>
            </>
          ) : (
            <>
              {!liveRunId && (
                <p className="text-xs text-[var(--text-dim)]">
                  To download a notebook, select Export run artifacts on a run in Experiments.
                </p>
              )}
              {isLoading && (
                <div className="flex items-center gap-2 border border-[var(--border-primary)] bg-[var(--card-bg)] p-3 text-xs text-[var(--text-dim)]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#f97316]" />
                  <span>Loading artifact manifest for {liveRunId}…</span>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 border border-red-500/40 bg-red-950/20 p-3 text-xs text-red-300">
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {manifest && (
                <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-3 text-[10px] text-[var(--text-dim)] space-y-1">
                  <div className="flex justify-between gap-3">
                    <span>Status</span>
                    <span className="text-[var(--text-primary)] font-bold uppercase">
                      {manifest.status}
                      {manifest.verdict ? ` · ${manifest.verdict}` : ''}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Attempt</span>
                    <span className="text-[var(--text-primary)]">
                      {manifest.attempt}
                      {manifest.parentRunId ? ' · repaired from a failed attempt' : ''}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Run</span>
                    <span className="text-[var(--text-primary)] truncate" title={manifest.runId}>
                      {manifest.runId}
                    </span>
                  </div>
                </div>
              )}

              {manifest && notebook && (
                <div className="p-3.5 border border-[var(--border-primary)] bg-[var(--card-bg)] space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-10 border border-[#f97316] bg-[#f97316]/10 text-[#f97316] flex items-center justify-center font-bold text-xs flex-shrink-0">
                        IPYNB
                      </div>
                      <div>
                        <div className="text-xs font-bold text-[var(--text-primary)]">
                          Reproducibility Notebook
                        </div>
                        <div className="text-[10px] text-[var(--text-dim)] font-sans mt-0.5">
                          nbformat 4.5 · built from this run&apos;s frozen spec and environment
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDownloadLiveArtifact(notebook)}
                      className="px-3 py-1.5 bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] transition flex items-center gap-1"
                    >
                      <Download className="h-3 w-3" />
                      <span>Download</span>
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-[var(--border-primary)] pt-2">
                    <span className="text-[10px] text-[var(--text-dim)] font-sans">
                      Colab-compatible. Download, then File → Upload notebook.
                    </span>
                    <button
                      onClick={handleOpenColab}
                      className="px-2.5 py-1 border border-[var(--border-primary)] bg-[var(--bg-surface)] hover:text-[#f97316] transition text-[10px] flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>Open Colab</span>
                    </button>
                  </div>
                </div>
              )}

              {manifest && !notebook && !isLoading && (
                <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-3 text-[11px] text-[var(--text-dim)] font-sans">
                  This run has no persisted notebook. A notebook is written for a
                  successful run, including a successful repaired run.
                </div>
              )}

              {manifest && manifest.artifacts.length > 0 && (
                <div className="border border-[var(--border-primary)] bg-[var(--card-bg)]">
                  <div className="border-b border-[var(--border-primary)] px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
                    Run artifacts
                  </div>
                  <ul className="divide-y divide-[var(--border-primary)]">
                    {manifest.artifacts.map((artifact) => (
                      <li
                        key={artifact.id}
                        className="flex items-center justify-between gap-3 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-[11px] text-[var(--text-primary)]">
                            {artifactLabel(artifact)}
                          </div>
                          <div className="text-[9px] text-[var(--text-dim)]">
                            {artifact.kind} · {formatBytes(artifact.bytes)}
                            {artifact.hasContent ? '' : ' · metadata only'}
                          </div>
                        </div>
                        <button
                          onClick={() => handleDownloadLiveArtifact(artifact)}
                          disabled={!artifact.hasContent}
                          title={
                            artifact.hasContent
                              ? undefined
                              : 'This artifact has metadata but no stored bytes'
                          }
                          className="shrink-0 px-2.5 py-1 border border-[var(--border-primary)] bg-[var(--bg-surface)] hover:text-[#f97316] transition text-[10px] flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Download className="h-3 w-3" />
                          <span>Download</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center justify-between p-3.5 border border-[var(--border-primary)] bg-[var(--card-bg)] gap-3">
                <div>
                  <div className="text-xs font-bold text-[var(--text-primary)]">
                    Workspace JSON
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] font-sans mt-0.5">
                    {liveWorkspaceId
                      ? 'Live graph rows for this workspace'
                      : 'No live database workspace selected'}
                  </div>
                </div>
                <button
                  onClick={handleDownloadLiveWorkspace}
                  disabled={!liveWorkspaceId || workspaceDownloading}
                  className="px-3 py-1.5 border border-[var(--border-primary)] bg-[var(--bg-surface)] hover:text-[#f97316] transition text-xs font-mono flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {workspaceDownloading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3" />
                  )}
                  <span>Export</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
