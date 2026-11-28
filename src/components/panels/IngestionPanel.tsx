import React, { useState, useEffect, useRef } from 'react';
import { DEMO_SOURCES, DEMO_CHUNKS } from '../../data/demoWorkspace';
import {
  UploadCloud,
  Globe,
  CheckCircle2,
  X,
  FileText,
  Copy,
  Check,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

/** A chunk row as persisted for a database workspace. */
export interface LiveSourceChunk {
  id: string;
  sourceId: string;
  sourceTitle: string;
  ordinal: number;
  page: number | null;
  text: string;
  charStart: number;
  charEnd: number;
}

export interface IngestionPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'upload' | 'firecrawl' | 'chunks';
  selectedSourceId?: string | null;
  sources?: Array<{
    id: string;
    title: string;
    venue: string;
    pages: number;
    size: string;
    status: string;
    doi: string;
  }>;
  /** Persisted chunks for a database workspace; omitted for the demo fixture. */
  chunks?: LiveSourceChunk[];
  isLoadingChunks?: boolean;
  chunksError?: string | null;
  /** Hide the simulated upload/scrape tabs when reading a live workspace. */
  live?: boolean;
}

interface DisplayChunk {
  id: string;
  sourceId: string;
  sourceTitle: string;
  /** Web chunks persist no page, so a missing page must stay missing. */
  page: number | null;
  charStart: number;
  charEnd: number;
  text: string;
  ordinal?: number;
}

export const IngestionPanel: React.FC<IngestionPanelProps> = ({
  isOpen,
  onClose,
  initialTab = 'upload',
  selectedSourceId = null,
  sources,
  chunks,
  isLoadingChunks = false,
  chunksError = null,
  live = false,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'firecrawl' | 'chunks'>(initialTab);
  const [activeSourceFilter, setActiveSourceFilter] = useState<string | null>(selectedSourceId);
  const [firecrawlUrl, setFirecrawlUrl] = useState(
    'https://bmcbioinformatics.biomedcentral.com/articles/10.1186/1471-2105-8-25',
  );
  const [crawlStatus, setCrawlStatus] = useState<string | null>(null);
  const [copiedChunkId, setCopiedChunkId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      if (initialTab) setActiveTab(live ? 'chunks' : initialTab);
      if (selectedSourceId !== undefined) setActiveSourceFilter(selectedSourceId);
    }
  }, [isOpen, initialTab, selectedSourceId, live]);

  const handleCrawl = () => {
    setCrawlStatus('Adding paper project page to local sources...');
    setTimeout(() => {
      setCrawlStatus('Source URL queued for workspace ingestion.');
    }, 800);
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedChunkId(id);
    setTimeout(() => {
      setCopiedChunkId((curr) => (curr === id ? null : curr));
    }, 1800);
  };

  if (!isOpen) return null;

  const allChunks: DisplayChunk[] = chunks
    ? chunks.map((chunk) => ({
        id: chunk.id,
        sourceId: chunk.sourceId,
        sourceTitle: chunk.sourceTitle,
        page: chunk.page,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        text: chunk.text,
        ordinal: chunk.ordinal,
      }))
    : Object.values(DEMO_CHUNKS);
  const displayedChunks = activeSourceFilter
    ? allChunks.filter((c) => c.sourceId === activeSourceFilter)
    : allChunks;

  const availableSources = sources || DEMO_SOURCES;
  const currentFilteredSource = availableSources.find((s) => s.id === activeSourceFilter);

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 transition-opacity animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over Drawer Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl border-l border-[var(--border-primary)] bg-[var(--bg-primary)] p-6 text-[var(--text-secondary)] shadow-2xl backdrop-blur-xl transition-all flex flex-col font-mono">
        {/* Header with Sharp Corners */}
        <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-4 flex-none">
          <div className="flex items-center gap-2.5">
            <div className="rounded-none bg-[#f97316]/10 p-2 text-[#f97316] border border-[#f97316]/30">
              <UploadCloud className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wide">
                  Ingestion &amp; Chunk Viewer
                </h3>
                <span className="badge-solid-white rounded-none">COLLECT</span>
              </div>
              <p className="text-[11px] text-[var(--text-dim)] mt-0.5">
                PDF coordinate extraction + Firecrawl project page scraper
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-none p-1.5 text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] transition cursor-pointer"
            title="Close Drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs with Sharp Corners */}
        <div className="mt-4 flex border-b border-[var(--border-primary)] flex-none">
          {!live && (
            <>
              <button
                onClick={() => setActiveTab('upload')}
                className={`border-b-2 px-4 py-2 text-xs uppercase tracking-wider transition cursor-pointer ${
                  activeTab === 'upload'
                    ? 'border-[#f97316] text-[#f97316] font-bold'
                    : 'border-transparent text-[var(--text-dim)] hover:text-[var(--text-primary)]'
                }`}
              >
                PDF Upload
              </button>
              <button
                onClick={() => setActiveTab('firecrawl')}
                className={`border-b-2 px-4 py-2 text-xs uppercase tracking-wider transition cursor-pointer ${
                  activeTab === 'firecrawl'
                    ? 'border-[#f97316] text-[#f97316] font-bold'
                    : 'border-transparent text-[var(--text-dim)] hover:text-[var(--text-primary)]'
                }`}
              >
                Firecrawl Scraper
              </button>
            </>
          )}
          <button
            onClick={() => setActiveTab('chunks')}
            className={`border-b-2 px-4 py-2 text-xs uppercase tracking-wider transition cursor-pointer ${
              activeTab === 'chunks'
                ? 'border-[#f97316] text-[#f97316] font-bold'
                : 'border-transparent text-[var(--text-dim)] hover:text-[var(--text-primary)]'
            }`}
          >
            Extracted Chunks ({allChunks.length})
          </button>
        </div>

        <div className="mt-5 flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Upload Tab */}
          {activeTab === 'upload' && (
            <div className="space-y-4">
              <div className="c flex flex-col items-center justify-center border-dashed border-[var(--border-primary)] p-8 text-center bg-[var(--card-bg)] rounded-none">
                <UploadCloud className="h-10 w-10 text-[#f97316] mb-2" />
                <div className="text-xs font-bold text-[var(--text-primary)] uppercase">
                  Drop Research Papers (.pdf) here
                </div>
                <p className="text-[11px] text-[var(--text-dim)] mt-1 max-w-xs">
                  Extracts text in coordinate reading order, computes SHA-256 hash, and chunks with character offsets.
                </p>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setCrawlStatus(`Source ${file.name} queued for workspace extraction.`);
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-4 rounded-none bg-[#f97316] px-4 py-2 text-xs font-bold uppercase text-black hover:bg-[#ea580c] transition shadow-[0_0_15px_rgba(249,115,22,0.3)] cursor-pointer"
                >
                  Select File
                </button>
              </div>

              <div className="space-y-2">
                <div className="text-xs uppercase text-[var(--text-dim)] font-bold">
                  Active Papers in Workspace
                </div>
                <div className="space-y-2">
                  {availableSources.map((src) => (
                    <div
                      key={src.id}
                      className="p-3 bg-[var(--card-bg)] border border-[var(--border-primary)] flex items-center justify-between rounded-none"
                    >
                      <div>
                        <div className="text-xs font-semibold text-[var(--text-primary)]">
                          {src.title}
                        </div>
                        <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                          {src.venue} · {'size' in src ? src.size : `${((src as any).bytes / 1024).toFixed(0)} KB`}
                        </div>
                      </div>
                      <span className="badge-solid-white rounded-none">
                        {('status' in src && src.status) ? String(src.status) : 'SEEDED'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Firecrawl Tab */}
          {activeTab === 'firecrawl' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs uppercase text-[var(--text-dim)] font-bold">
                  Target Web Page or Repository URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={firecrawlUrl}
                    onChange={(e) => setFirecrawlUrl(e.target.value)}
                    className="flex-1 rounded-none border border-[var(--border-primary)] bg-[var(--card-bg)] px-3.5 py-2.5 text-xs text-[var(--text-primary)] outline-none focus:border-[#f97316]"
                  />
                  <button
                    onClick={handleCrawl}
                    className="flex items-center gap-1.5 rounded-none bg-[#f97316] px-4 text-xs font-bold uppercase text-black hover:bg-[#ea580c] transition shadow-[0_0_15px_rgba(249,115,22,0.3)] cursor-pointer"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    Crawl
                  </button>
                </div>
              </div>

              {crawlStatus && (
                <div className="p-3 bg-[var(--card-bg)] border-l-[3px] !border-l-[#f97316] text-xs text-[var(--text-primary)] flex items-center gap-2 border border-[var(--border-primary)] rounded-none">
                  <CheckCircle2 className="h-4 w-4 text-[#f97316] flex-shrink-0" />
                  <span>{crawlStatus}</span>
                </div>
              )}
            </div>
          )}

          {/* Chunks Tab */}
          {activeTab === 'chunks' && (
            <div className="space-y-4">
              {/* Filter chips header */}
              <div className="space-y-2 pb-2 border-b border-[var(--border-primary)]">
                <div className="flex items-center justify-between text-[11px] text-[var(--text-dim)]">
                  <span>FILTER CHUNKS BY SOURCE:</span>
                  {activeSourceFilter && (
                    <button
                      onClick={() => setActiveSourceFilter(null)}
                      className="text-[#f97316] hover:underline cursor-pointer"
                    >
                      Clear Filter
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => setActiveSourceFilter(null)}
                    className={`px-2.5 py-1 text-[11px] border transition cursor-pointer ${
                      activeSourceFilter === null
                        ? 'bg-[#f97316] text-black font-bold border-[#f97316]'
                        : 'bg-[var(--card-bg)] text-[var(--text-dim)] hover:text-[var(--text-primary)] border-[var(--border-primary)]'
                    }`}
                  >
                    All ({allChunks.length})
                  </button>
                  {availableSources.map((s) => {
                    const count = allChunks.filter((c) => c.sourceId === s.id).length;
                    const isSelected = activeSourceFilter === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setActiveSourceFilter(isSelected ? null : s.id)}
                        className={`px-2.5 py-1 text-[11px] border whitespace-nowrap transition cursor-pointer ${
                          isSelected
                            ? 'bg-[#f97316] text-black font-bold border-[#f97316]'
                            : 'bg-[var(--card-bg)] text-[var(--text-dim)] hover:text-[var(--text-primary)] border-[var(--border-primary)]'
                        }`}
                      >
                        {s.title} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Chunks List */}
              {isLoadingChunks ? (
                <div className="p-8 text-center border border-dashed border-[var(--border-primary)] bg-[var(--card-bg)] space-y-2">
                  <Loader2 className="h-8 w-8 text-[#f97316] mx-auto animate-spin" />
                  <div className="text-xs font-bold text-[var(--text-primary)]">
                    Loading persisted chunks...
                  </div>
                </div>
              ) : chunksError ? (
                <div className="p-6 text-center border border-dashed border-red-500/40 bg-red-500/5 space-y-2">
                  <AlertTriangle className="h-8 w-8 text-red-300 mx-auto" />
                  <div className="text-xs font-bold text-red-200">{chunksError}</div>
                </div>
              ) : displayedChunks.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-[var(--border-primary)] bg-[var(--card-bg)] space-y-2">
                  <FileText className="h-8 w-8 text-[#f97316] mx-auto opacity-70" />
                  <div className="text-xs font-bold text-[var(--text-primary)]">
                    No chunks extracted yet for {currentFilteredSource?.title || 'this source'}
                  </div>
                  <p className="text-[11px] text-[var(--text-dim)]">
                    {live
                      ? 'This source has no persisted chunks. It may need OCR, or ingestion may not have completed.'
                      : 'Run the PDF coordinate ingestion pipeline to generate 512-token chunks with character offsets.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {displayedChunks.map((chunk) => {
                    const isCopied = copiedChunkId === chunk.id;
                    return (
                      <div
                        key={chunk.id}
                        className="p-3.5 bg-[var(--card-bg)] border border-[var(--border-primary)] hover:border-[var(--border-secondary)] space-y-2.5 rounded-none transition"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="badge-orange-outline !text-[9px] rounded-none">
                              {chunk.ordinal !== undefined
                                ? `Chunk #${chunk.ordinal}`
                                : `Chunk ${chunk.id}`}
                            </span>
                            <span className="text-[10px] text-[var(--text-dim)]">
                              PAGE {chunk.page ?? '—'} · CHARS {chunk.charStart}–{chunk.charEnd}
                            </span>
                          </div>
                          <button
                            onClick={() => handleCopy(chunk.id, chunk.text)}
                            className="p-1 text-[var(--text-dim)] hover:text-[var(--text-primary)] transition cursor-pointer"
                            title="Copy verbatim passage"
                          >
                            {isCopied ? (
                              <Check className="h-3.5 w-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>

                        <p className="text-xs leading-relaxed text-[var(--text-primary)] font-serif bg-[var(--bg-surface)] p-2.5 border-l-2 border-[#f97316]">
                          &ldquo;{chunk.text}&rdquo;
                        </p>

                        <div className="flex items-center justify-between text-[10px] pt-1 border-t border-[var(--border-primary)]/40">
                          <span className="text-[var(--text-dim)]">
                            Source: <strong className="text-[var(--text-primary)]">{chunk.sourceTitle}</strong>
                          </span>
                          <span className="text-[var(--text-dim)] font-mono text-[9px] uppercase tracking-wider">
                            ANCHOR CHUNK
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};
