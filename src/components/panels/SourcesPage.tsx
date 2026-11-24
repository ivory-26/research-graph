import React, { useState } from 'react';
import { Upload, Globe, GitBranch, Sparkles, CheckCircle2, ArrowRight } from 'lucide-react';
import { IngestionPanel } from './IngestionPanel';

interface SourcesPageProps {
  onShowToast: (msg: string) => void;
  onIngestSource?: (title: string, kind: 'web' | 'repo' | 'pdf', url?: string) => void;
}

export const SourcesPage: React.FC<SourcesPageProps> = ({ onShowToast, onIngestSource }) => {
  const [activeTab, setActiveTab] = useState<'pdf' | 'web'>('web');
  const [webUrl, setWebUrl] = useState('https://github.com/parrt/random-forest-importances');
  const [webTitle, setWebTitle] = useState('Parr et al. (2018) Beware Default Random Forest Importances');
  const [isIngestingWeb, setIsIngestingWeb] = useState(false);
  const [isChunkViewerOpen, setIsChunkViewerOpen] = useState(false);
  const [selectedSourceForViewer, setSelectedSourceForViewer] = useState<string | null>(null);

  const [sources, setSources] = useState([
    {
      id: 'src-1',
      title: 'Strobl et al. 2007',
      venue: 'BMC Bioinformatics',
      pages: 14,
      size: '411 KB',
      status: 'READY',
      doi: '10.1186/1471-2105-8-25',
    },
    {
      id: 'src-2',
      title: 'Strobl et al. 2008',
      venue: 'BMC Bioinformatics',
      pages: 12,
      size: '500 KB',
      status: 'READY',
      doi: '10.1186/1471-2105-9-307',
    },
    {
      id: 'src-3',
      title: 'Kursa & Rudnicki 2010',
      venue: 'Journal of Statistical Software',
      pages: 13,
      size: '378 KB',
      status: 'READY',
      doi: '10.18637/jss.v036.i11',
    },
  ]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newItems = Array.from(files).map((f, i) => {
      const cleanTitle = f.name.replace(/\.pdf$/i, '');
      if (onIngestSource) {
        onIngestSource(cleanTitle, 'pdf');
      }
      return {
        id: `uploaded-${Date.now()}-${i}`,
        title: cleanTitle,
        venue: 'Local Document',
        pages: 0,
        size: `${(f.size / 1024).toFixed(0)} KB`,
        status: 'QUEUED',
        doi: f.name,
      };
    });

    setSources((prev) => [...newItems, ...prev]);
    onShowToast(`Uploaded ${files.length} paper(s) to workspace queue`);
  };

  const handleWebIngest = async () => {
    if (!webUrl.trim() || isIngestingWeb) return;
    setIsIngestingWeb(true);
    onShowToast(`Dispatching Firecrawl ingestion for ${webUrl}...`);

    setTimeout(() => {
      const kind: 'repo' | 'web' = webUrl.includes('github.com') ? 'repo' : 'web';
      const cleanTitle = webTitle.trim() || (kind === 'repo' ? 'GitHub Repo Source' : 'Web Source');

      const newSourceItem = {
        id: `src-web-${Date.now()}`,
        title: cleanTitle,
        venue: kind === 'repo' ? 'GitHub Open Source' : 'Web Page',
        pages: 0,
        size: '—',
        status: 'QUEUED',
        doi: webUrl,
      };

      setSources((prev) => [newSourceItem, ...prev]);
      if (onIngestSource) {
        onIngestSource(cleanTitle, kind, webUrl);
      }
      setIsIngestingWeb(false);
      onShowToast(`Source added to indexing queue.`);
    }, 1200);
  };

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
            Add papers or project repositories. The engine chunks text, calculates SHA-256 fingerprints, embeds into pgvector, and extracts candidate claims into the Research Graph.
          </p>

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
                disabled={isIngestingWeb || !webUrl.trim()}
                className="w-full py-2 bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] disabled:opacity-50 transition flex items-center justify-center gap-2 cursor-pointer shadow-md"
              >
                {isIngestingWeb ? (
                  <>
                    <span className="inline-block h-3 w-3 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    <span>Scraping with Firecrawl & Extracting Claims...</span>
                  </>
                ) : (
                  <>
                    <span>Ingest with Firecrawl &amp; Add to Graph</span>
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
                PDF files · coordinate-aware extraction · SHA-256 fingerprint
              </p>
              <div className="mt-3 px-3 py-1.5 bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] transition">
                Select files
              </div>
              <input
                type="file"
                accept=".pdf"
                multiple
                className="hidden"
                onChange={handleFileUpload}
              />
            </label>
          )}

          <div className="space-y-2 pt-2 border-t border-[var(--border-primary)] text-xs text-[var(--text-muted)] font-sans">
            <div className="text-[10px] font-mono uppercase text-[var(--text-dim)]">
              INGESTION PIPELINE SETTINGS
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" defaultChecked className="accent-[#f97316]" />
              <span>Extract verbatim page and character offsets</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" defaultChecked className="accent-[#f97316]" />
              <span>Generate 768-dim semantic pgvector embeddings</span>
            </label>
          </div>
        </div>

        {/* Source Processing Pipeline Status */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
          <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
            Source processing pipeline status
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
              <span className="badge-solid-white !text-[8px] rounded-none">ACTIVE</span>
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
              <span className="badge-solid-white !text-[8px] rounded-none">ACTIVE</span>
            </div>

            <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-3">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <div>
                  <div className="text-xs text-[var(--text-primary)] font-semibold">
                    Chunk generation &amp; Anchor mapping
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] font-sans">
                    512-token chunks with char ranges
                  </div>
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">ACTIVE</span>
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
              <span className="badge-solid-white !text-[8px] rounded-none">ACTIVE</span>
            </div>
          </div>
        </div>
      </div>

      {/* Active Papers in Workspace List */}
      <div className="space-y-3">
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
          ACTIVE INGESTED SOURCES IN WORKSPACE ({sources.length})
        </div>
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
                  <div className="text-xs font-bold text-[var(--text-primary)]">
                    {s.title}
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                    {s.venue} · {s.pages} pages · {s.size} · {s.doi}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="badge-solid-white !text-[8px] rounded-none">
                  {s.status}
                </span>
                <button
                  onClick={() => {
                    setSelectedSourceForViewer(s.id);
                    setIsChunkViewerOpen(true);
                  }}
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
        sources={sources}
      />
    </div>
  );
};
