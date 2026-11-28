import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { Upload, Globe, GitBranch, Sparkles, ArrowRight, RefreshCw, AlertTriangle } from 'lucide-react';
import { IngestionPanel, type LiveSourceChunk } from './IngestionPanel';
import { DEMO_SOURCES } from '../../data/demoWorkspace';
import rawWorkspace from '../../../fixtures/workspace.json';
import { isDatabaseWorkspaceId } from '../../utils/graphClient';
import { MAX_PDF_BYTES, MAX_PDF_LABEL } from '../../shared/source-limits';
import { inferSourceKind } from '../../shared/source-kind';

interface SourcesPageProps {
  onShowToast: (msg: string) => void;
  onIngestSource?: (title: string, kind: 'web' | 'repo' | 'pdf', url?: string) => void;
  /** Optional override; otherwise the active `?workspace=` is used. */
  workspaceId?: string;
  /** Called after a successful ingestion so the shell can refetch the graph. */
  onGraphChanged?: () => void;
}

interface SourceListItem {
  id: string;
  kind: string;
  title: string;
  url: string | null;
  doi: string | null;
  bytes: number;
  chunkCount: number;
  pages: number | null;
  needsOcr: boolean;
}

interface IngestSummary {
  title: string;
  chunkCount: number;
  claimCount: number;
  edgeCount: number;
  needsOcr: boolean;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sourceVenue(source: SourceListItem): string {
  if (source.kind === 'repo') return 'GitHub / repository';
  if (source.kind === 'paper') return 'Paper';
  if (source.kind === 'dataset') return 'Dataset';
  if (source.kind === 'note') return 'Note';
  return 'Web page';
}

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export const SourcesPage: React.FC<SourcesPageProps> = ({
  onShowToast,
  onIngestSource,
  workspaceId,
  onGraphChanged,
}) => {
  const routerSearch = useRouterState({
    select: (state) => state.location.search as Record<string, unknown>,
  });
  const searchWorkspace =
    typeof routerSearch?.workspace === 'string' ? routerSearch.workspace : undefined;
  const activeWorkspaceId = workspaceId ?? searchWorkspace;
  const isLiveWorkspace = isDatabaseWorkspaceId(activeWorkspaceId);

  const [activeTab, setActiveTab] = useState<'pdf' | 'web'>('web');
  const [webUrl, setWebUrl] = useState('https://github.com/parrt/random-forest-importances');
  const [webTitle, setWebTitle] = useState(
    'Parr et al. (2018) Beware Default Random Forest Importances',
  );
  const [isIngestingWeb, setIsIngestingWeb] = useState(false);
  const [isChunkViewerOpen, setIsChunkViewerOpen] = useState(false);
  const [selectedSourceForViewer, setSelectedSourceForViewer] = useState<string | null>(null);

  // Fixture rows are the intentional offline demo. They are never presented as
  // rows measured from the database.
  const fixtureSources = useMemo(
    () =>
      DEMO_SOURCES.map((s) => {
        const node = (rawWorkspace.nodes as any[]).find(
          (n) => n.data?.sourceId === s.id || n.id === s.id,
        );
        return {
          id: s.id,
          title: s.title,
          venue: s.venue,
          pages: node?.data?.pages ?? 1,
          size: `${(s.bytes / 1024).toFixed(0)} KB`,
          status: 'SEEDED',
          doi: s.doi || s.url || '',
        };
      }),
    [],
  );

  const [liveSources, setLiveSources] = useState<SourceListItem[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState(() => isLiveWorkspace);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [lastIngest, setLastIngest] = useState<IngestSummary | null>(null);
  const [liveChunks, setLiveChunks] = useState<LiveSourceChunk[]>([]);
  const [isLoadingChunks, setIsLoadingChunks] = useState(false);
  const [chunksError, setChunksError] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    if (!isLiveWorkspace || !activeWorkspaceId) return;
    setIsLoadingSources(true);
    setSourcesError(null);
    try {
      const res = await fetch(
        `/api/sources?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
        { headers: { Accept: 'application/json' } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          (body && typeof body.error === 'string' && body.error) ||
            `HTTP ${res.status}`,
        );
      }
      const data = await res.json();
      setLiveSources(
        Array.isArray(data.sources)
          ? data.sources.map((row: any) => ({
              id: String(row.id),
              kind: String(row.kind),
              title: String(row.title),
              url: typeof row.url === 'string' ? row.url : null,
              doi: typeof row.doi === 'string' ? row.doi : null,
              bytes: Number(row.bytes) || 0,
              chunkCount: Number(row.chunkCount) || 0,
              pages: typeof row.pages === 'number' ? row.pages : null,
              needsOcr: row.needsOcr === true,
            }))
          : [],
      );
    } catch (err) {
      setLiveSources([]);
      setSourcesError(err instanceof Error ? err.message : 'Failed to load sources');
    } finally {
      setIsLoadingSources(false);
    }
  }, [isLiveWorkspace, activeWorkspaceId]);

  useEffect(() => {
    if (!isLiveWorkspace) {
      setLiveSources([]);
      setSourcesError(null);
      setLastIngest(null);
      return;
    }
    setLiveChunks([]);
    setSelectedSourceForViewer(null);
    void loadSources();
  }, [isLiveWorkspace, loadSources]);

  const notifyGraphChanged = () => {
    onGraphChanged?.();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('rg:workspace-updated', {
          detail: { workspaceId: activeWorkspaceId },
        }),
      );
    }
  };

  const openGraph = () => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('page', 'graph');
    if (activeWorkspaceId) url.searchParams.set('workspace', activeWorkspaceId);
    url.searchParams.delete('experimentId');
    // A document navigation is deliberate: the graph is read once when the
    // shell mounts, and a route-only update cannot refetch it.
    window.location.assign(url.toString());
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (!isLiveWorkspace || !activeWorkspaceId) {
      onShowToast('PDF upload is available inside an authenticated workspace');
      e.target.value = '';
      return;
    }

    const file = files[0];
    if (!isPdfFile(file)) {
      onShowToast('Only PDF files can be uploaded');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      onShowToast(`PDF file exceeds the ${MAX_PDF_LABEL} limit`);
      e.target.value = '';
      return;
    }

    setIsIngestingWeb(true);
    setSourcesError(null);
    try {
      const form = new FormData();
      form.set('workspaceId', activeWorkspaceId);
      form.set('title', file.name.replace(/\.pdf$/i, ''));
      form.set('file', file);

      const res = await fetch('/api/sources', { method: 'POST', body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (data && typeof data.error === 'string' && data.error) ||
            `Upload failed (HTTP ${res.status})`,
        );
      }

      setLastIngest({
        title: data?.source?.title ?? file.name,
        chunkCount: Number(data?.chunkCount) || 0,
        claimCount: Number(data?.claimCount) || 0,
        edgeCount: Number(data?.edgeCount) || 0,
        needsOcr: data?.needsOcr === true,
      });
      onIngestSource?.(file.name.replace(/\.pdf$/i, ''), 'pdf');
      await loadSources();
      notifyGraphChanged();
      onShowToast(
        data?.needsOcr
          ? 'PDF stored, but it needs OCR before claims can be extracted'
          : `Ingested ${data?.source?.title ?? file.name}: ${Number(data?.chunkCount) || 0} chunks, ${Number(data?.claimCount) || 0} claims`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setSourcesError(message);
      onShowToast(message);
    } finally {
      setIsIngestingWeb(false);
      e.target.value = '';
    }
  };

  const handleWebIngest = async () => {
    if (!webUrl.trim() || isIngestingWeb) return;
    if (!isLiveWorkspace || !activeWorkspaceId) {
      onShowToast('Connect an authenticated workspace before ingesting a source');
      return;
    }

    const kind = inferSourceKind(webUrl);
    const cleanTitle = webTitle.trim() || (kind === 'repo' ? 'GitHub Repo Source' : 'Web Source');

    setIsIngestingWeb(true);
    setSourcesError(null);
    onShowToast(`Scraping and extracting ${cleanTitle}...`);

    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          kind,
          url: webUrl.trim(),
          title: cleanTitle,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (data && typeof data.error === 'string' && data.error) ||
            `Ingestion failed (HTTP ${res.status})`,
        );
      }

      setLastIngest({
        title: data?.source?.title ?? cleanTitle,
        chunkCount: Number(data?.chunkCount) || 0,
        claimCount: Number(data?.claimCount) || 0,
        edgeCount: Number(data?.edgeCount) || 0,
        needsOcr: data?.needsOcr === true,
      });
      onIngestSource?.(cleanTitle, kind, webUrl.trim());
      await loadSources();
      notifyGraphChanged();
      onShowToast(
        `Ingested ${data?.source?.title ?? cleanTitle}: ${Number(data?.chunkCount) || 0} chunks, ${Number(data?.claimCount) || 0} claims, ${Number(data?.edgeCount) || 0} edges`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Source ingestion failed';
      setSourcesError(message);
      onShowToast(message);
    } finally {
      setIsIngestingWeb(false);
    }
  };

  const handleOpenChunks = async (sourceId: string) => {
    setSelectedSourceForViewer(sourceId);

    if (!isLiveWorkspace || !activeWorkspaceId) {
      setIsChunkViewerOpen(true);
      return;
    }

    setIsChunkViewerOpen(true);
    setIsLoadingChunks(true);
    setChunksError(null);
    setLiveChunks([]);
    try {
      const res = await fetch(
        `/api/sources?workspaceId=${encodeURIComponent(activeWorkspaceId)}&sourceId=${encodeURIComponent(sourceId)}`,
        { headers: { Accept: 'application/json' } },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (data && typeof data.error === 'string' && data.error) ||
            `Failed to load chunks (HTTP ${res.status})`,
        );
      }
      setLiveChunks(
        Array.isArray(data.chunks)
          ? data.chunks.map((chunk: any) => ({
              id: String(chunk.id),
              sourceId: String(chunk.sourceId),
              sourceTitle: String(chunk.sourceTitle),
              ordinal: Number(chunk.ordinal) || 0,
              page: typeof chunk.page === 'number' ? chunk.page : null,
              text: String(chunk.text),
              charStart: Number(chunk.charStart) || 0,
              charEnd: Number(chunk.charEnd) || 0,
            }))
          : [],
      );
    } catch (err) {
      setChunksError(err instanceof Error ? err.message : 'Failed to load chunks');
    } finally {
      setIsLoadingChunks(false);
    }
  };

  const sources = isLiveWorkspace
    ? liveSources.map((source) => ({
        id: source.id,
        title: source.title,
        venue: sourceVenue(source),
        pages: source.pages ?? '—',
        size: formatBytes(source.bytes),
        status: source.needsOcr ? 'NEEDS OCR' : 'EXTRACTED',
        doi: source.doi || source.url || `${source.chunkCount} chunks`,
        chunkCount: source.chunkCount,
      }))
    : fixtureSources;

  const panelSources = sources.map((s) => ({
    id: s.id,
    title: s.title,
    venue: s.venue,
    pages: typeof s.pages === 'number' ? s.pages : 0,
    size: s.size,
    status: s.status,
    doi: s.doi,
  }));

  const stageState = (active: boolean, done: boolean): string => {
    if (isIngestingWeb) return 'RUNNING';
    if (done) return 'DONE';
    if (active) return 'READY';
    return 'READY';
  };

  const ingestStage = lastIngest;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto animate-fade-in font-mono">
      {/* Top Grid: Ingest Dropzone & Processing Pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Ingestion Source Panel */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#f97316]" />
              <span>Ingest research sources</span>
            </div>
            {/* Mode Switcher */}
            <div className="flex items-center border border-[var(--border-primary)] bg-[var(--bg-surface)] p-0.5 text-[10px]">
              <button
                onClick={() => setActiveTab('web')}
                className={`px-2 py-1 transition ${
                  activeTab === 'web'
                    ? 'bg-[#f97316] text-black font-bold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                Firecrawl URL
              </button>
              <button
                onClick={() => setActiveTab('pdf')}
                className={`px-2 py-1 transition ${
                  activeTab === 'pdf'
                    ? 'bg-[#f97316] text-black font-bold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                Upload PDF
              </button>
            </div>
          </div>

          <p className="text-xs text-[var(--text-dim)] font-sans">
            Add papers or project repositories. The engine chunks text, calculates SHA-256
            fingerprints, embeds into pgvector, and extracts candidate claims into the Research
            Graph.
          </p>

          {!isLiveWorkspace && (
            <div className="border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 font-sans">
              This is the offline demo workspace. Switch to a database workspace to ingest and
              extract real sources.
            </div>
          )}

          {sourcesError && (
            <div className="flex items-start gap-2 border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200 font-sans">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>{sourcesError}</span>
            </div>
          )}

          {activeTab === 'web' ? (
            <div className="p-4 border border-[var(--border-primary)] bg-[var(--bg-surface)] space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] text-[var(--text-dim)] uppercase">
                  Target URL (GitHub Repo README or Web Page):
                </label>
                <div className="flex items-center gap-2 border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-1.5">
                  <Globe className="h-3.5 w-3.5 text-[#f97316] flex-shrink-0" />
                  <input
                    type="text"
                    value={webUrl}
                    onChange={(e) => setWebUrl(e.target.value)}
                    placeholder="https://github.com/..."
                    className="w-full bg-transparent text-xs text-[var(--text-primary)] outline-none font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-[var(--text-dim)] uppercase">
                  Source Title / Citation Label:
                </label>
                <input
                  type="text"
                  value={webTitle}
                  onChange={(e) => setWebTitle(e.target.value)}
                  placeholder="Citation title..."
                  className="w-full border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none font-mono"
                />
              </div>

              <button
                onClick={handleWebIngest}
                disabled={isIngestingWeb || !webUrl.trim() || !isLiveWorkspace}
                className="w-full py-2 bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] disabled:opacity-50 transition flex items-center justify-center gap-2 cursor-pointer shadow-md"
              >
                {isIngestingWeb ? (
                  <>
                    <span className="inline-block h-3 w-3 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    <span>Scraping, embedding and extracting...</span>
                  </>
                ) : (
                  <>
                    <span>Add Source to Workspace</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            </div>
          ) : (
            <label className="border border-dashed border-[var(--border-secondary)] hover:border-[#f97316] bg-[var(--bg-surface)] p-8 flex flex-col items-center justify-center cursor-pointer transition text-center group block">
              <Upload className="h-8 w-8 text-[#f97316] mb-2 group-hover:scale-110 transition" />
              <strong className="text-xs text-[var(--text-primary)] font-bold">
                Drop research PDFs here
              </strong>
              <p className="text-[10px] text-[var(--text-dim)] mt-1 font-mono">
                PDF files up to {MAX_PDF_LABEL} · coordinate-aware extraction · SHA-256 fingerprint
              </p>
              <div className="mt-3 px-3 py-1.5 bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] transition">
                {isIngestingWeb ? 'Ingesting...' : 'Select files'}
              </div>
              <input
                type="file"
                accept=".pdf"
                multiple={false}
                className="hidden"
                disabled={isIngestingWeb || !isLiveWorkspace}
                onChange={handleFileUpload}
              />
            </label>
          )}

          <div className="space-y-2 pt-2 border-t border-[var(--border-primary)] text-xs text-[var(--text-muted)] font-sans">
            <div className="text-[10px] font-mono uppercase text-[var(--text-dim)]">
              INGESTION PIPELINE SETTINGS
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" defaultChecked disabled className="accent-[#f97316]" />
              <span>Extract verbatim page and character offsets</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" defaultChecked disabled className="accent-[#f97316]" />
              <span>Generate 768-dim semantic pgvector embeddings</span>
            </label>
          </div>
        </div>

        {/* Source Processing Pipeline Status */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
              Source processing pipeline status
            </div>
            {isLiveWorkspace && (
              <button
                onClick={openGraph}
                className="flex items-center gap-1 text-[10px] text-[#f97316] hover:underline"
              >
                <RefreshCw className="h-3 w-3" />
                Open updated graph
              </button>
            )}
          </div>
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-3">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                <div>
                  <div className="text-xs text-[var(--text-primary)] font-semibold">
                    File &amp; URL validation
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] font-sans">
                    PDF format, Firecrawl scrape &amp; SHA-256 checksum
                  </div>
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">
                {isLiveWorkspace ? stageState(false, Boolean(lastIngest)) : 'STANDBY'}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-3">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <div>
                  <div className="text-xs text-[var(--text-primary)] font-semibold">
                    Text extraction (unpdf &amp; Firecrawl)
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] font-sans">
                    Column-aware text reading order
                  </div>
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">
                {isLiveWorkspace ? stageState(true, (ingestStage?.chunkCount ?? 0) > 0) : 'STANDBY'}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-3">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <div>
                  <div className="text-xs text-[var(--text-primary)] font-semibold">
                    Chunk generation &amp; Anchor mapping
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] font-sans">
                    ~800-token chunks with char ranges
                  </div>
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">
                {isLiveWorkspace ? stageState(true, (ingestStage?.chunkCount ?? 0) > 0) : 'STANDBY'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <div>
                  <div className="text-xs text-[var(--text-primary)] font-semibold">
                    Neon pgvector Embedding &amp; Claim extraction
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] font-sans">
                    Gemini embedding-2 · verbatim quote verification
                  </div>
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">
                {isLiveWorkspace ? stageState(true, (ingestStage?.claimCount ?? 0) > 0) : 'STANDBY'}
              </span>
            </div>
          </div>

          {isLiveWorkspace && lastIngest && (
            <div className="border-t border-[var(--border-primary)] pt-3 text-[10px] text-[var(--text-dim)] font-sans space-y-1">
              <div className="text-[var(--text-primary)] font-semibold">{lastIngest.title}</div>
              <div>
                {lastIngest.chunkCount} chunks · {lastIngest.claimCount} claims ·{' '}
                {lastIngest.edgeCount} edges
              </div>
              {lastIngest.needsOcr && (
                <div className="text-amber-300">
                  Source stored, but at least one page yielded too little text. OCR is required
                  before extraction.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Active Papers in Workspace List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
            WORKSPACE SOURCES ({sources.length})
          </div>
          {isLiveWorkspace && (
            <button
              onClick={() => void loadSources()}
              disabled={isLoadingSources}
              className="flex items-center gap-1 text-[10px] text-[var(--text-dim)] hover:text-[#f97316] disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${isLoadingSources ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          )}
        </div>

        {isLiveWorkspace && sourcesError && liveSources.length === 0 && (
          <div className="border border-dashed border-red-500/40 bg-red-500/5 p-6 text-center text-xs text-red-200 font-sans">
            {sourcesError}
          </div>
        )}

        {isLiveWorkspace && !sourcesError && !isLoadingSources && sources.length === 0 && (
          <div className="border border-dashed border-[var(--border-primary)] bg-[var(--card-bg)] p-8 text-center space-y-1">
            <div className="text-xs font-bold text-[var(--text-primary)]">No sources yet</div>
            <p className="text-[11px] text-[var(--text-dim)] font-sans">
              Add a paper or project page above. Persisted rows appear here after extraction.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {sources.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between p-4 border border-[var(--border-primary)] bg-[var(--card-bg)] hover:border-[var(--border-secondary)] transition gap-4 flex-wrap"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-11 border border-[#f97316]/50 bg-[#f97316]/10 text-[#f97316] flex items-center justify-center font-bold text-xs flex-shrink-0">
                  {s.venue.includes('GitHub') ? <GitBranch className="h-4 w-4" /> : 'PDF'}
                </div>
                <div>
                  <div className="text-xs font-bold text-[var(--text-primary)]">{s.title}</div>
                  <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                    {s.venue} · {s.pages} pages · {s.size} · {s.doi}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="badge-solid-white !text-[8px] rounded-none">{s.status}</span>
                <button
                  onClick={() => void handleOpenChunks(s.id)}
                  className="px-2.5 py-1 text-xs border border-[var(--border-primary)] bg-[var(--bg-surface)] hover:text-[#f97316] hover:border-[#f97316] transition cursor-pointer"
                  title={`View extracted text chunks for ${s.title}`}
                >
                  View Chunks
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Slide-over Ingestion & Chunk Viewer Drawer (Option A) */}
      <IngestionPanel
        isOpen={isChunkViewerOpen}
        onClose={() => setIsChunkViewerOpen(false)}
        initialTab="chunks"
        selectedSourceId={selectedSourceForViewer}
        sources={panelSources}
        chunks={isLiveWorkspace ? liveChunks : undefined}
        isLoadingChunks={isLiveWorkspace && isLoadingChunks}
        chunksError={isLiveWorkspace ? chunksError : null}
        live={isLiveWorkspace}
      />
    </div>
  );
};
