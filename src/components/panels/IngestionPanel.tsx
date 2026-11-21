import React, { useState } from 'react';
import { DEMO_SOURCES, DEMO_CHUNKS } from '../../data/demoWorkspace';
import { UploadCloud, Globe, CheckCircle2, X } from 'lucide-react';

interface IngestionPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const IngestionPanel: React.FC<IngestionPanelProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'firecrawl' | 'chunks'>('upload');
  const [firecrawlUrl, setFirecrawlUrl] = useState('https://bmcbioinformatics.biomedcentral.com/articles/10.1186/1471-2105-8-25');
  const [crawlStatus, setCrawlStatus] = useState<string | null>(null);

  const handleCrawl = () => {
    setCrawlStatus('Crawling paper project page via Firecrawl API...');
    setTimeout(() => {
      setCrawlStatus('Success: Ingested 14 sections, extracted metadata, 23 chunks embedded.');
    }, 800);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl border-l border-[var(--border-primary)] bg-[var(--bg-primary)] p-6 text-[var(--text-secondary)] shadow-2xl backdrop-blur-xl transition-all">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-4">
        <div className="flex items-center gap-2.5">
          <div className="rounded bg-[#f97316]/10 p-2 text-[#f97316] border border-[#f97316]/30">
            <UploadCloud className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-[var(--text-primary)] font-mono uppercase tracking-wide">
                Ingestion &amp; Chunk Viewer
              </h3>
              <span className="badge-solid-white">COLLECT</span>
            </div>
            <p className="text-[11px] text-[var(--text-dim)] font-mono mt-0.5">
              PDF coordinate extraction + Firecrawl project page scraper
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1.5 text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] transition"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="mt-4 flex border-b border-[var(--border-primary)]">
        <button
          onClick={() => setActiveTab('upload')}
          className={`border-b-2 px-4 py-2 text-xs font-mono uppercase tracking-wider transition ${
            activeTab === 'upload'
              ? 'border-[#f97316] text-[#f97316] font-bold'
              : 'border-transparent text-[var(--text-dim)] hover:text-[var(--text-primary)]'
          }`}
        >
          PDF Upload
        </button>
        <button
          onClick={() => setActiveTab('firecrawl')}
          className={`border-b-2 px-4 py-2 text-xs font-mono uppercase tracking-wider transition ${
            activeTab === 'firecrawl'
              ? 'border-[#f97316] text-[#f97316] font-bold'
              : 'border-transparent text-[var(--text-dim)] hover:text-[var(--text-primary)]'
          }`}
        >
          Firecrawl Scraper
        </button>
        <button
          onClick={() => setActiveTab('chunks')}
          className={`border-b-2 px-4 py-2 text-xs font-mono uppercase tracking-wider transition ${
            activeTab === 'chunks'
              ? 'border-[#f97316] text-[#f97316] font-bold'
              : 'border-transparent text-[var(--text-dim)] hover:text-[var(--text-primary)]'
          }`}
        >
          Extracted Chunks ({Object.keys(DEMO_CHUNKS).length})
        </button>
      </div>

      <div className="mt-5 space-y-4">
        {/* Upload Tab */}
        {activeTab === 'upload' && (
          <div className="space-y-4">
            <div className="c flex flex-col items-center justify-center border-dashed border-[var(--border-primary)] p-8 text-center bg-[var(--card-bg)]">
              <UploadCloud className="h-10 w-10 text-[#f97316] mb-2" />
              <div className="text-xs font-bold text-[var(--text-primary)] font-mono uppercase">
                Drop Research Papers (.pdf) here
              </div>
              <p className="text-[11px] text-[var(--text-dim)] mt-1 max-w-xs font-mono">
                Extracts text in coordinate reading order, computes SHA-256 hash, and chunks with character offsets.
              </p>
              <button className="mt-4 rounded bg-[#f97316] px-4 py-2 text-xs font-mono font-bold uppercase text-black hover:bg-[#ea580c] transition shadow-[0_0_15px_rgba(249,115,22,0.3)]">
                Select File
              </button>
            </div>

            <div className="space-y-2">
              <div className="l">Active Papers in Workspace</div>
              <div className="space-y-2">
                {DEMO_SOURCES.map((src) => (
                  <div key={src.id} className="c p-3 bg-[var(--card-bg)] border border-[var(--border-primary)] flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-[var(--text-primary)] font-mono">{src.title}</div>
                      <div className="m text-[10px] text-[var(--text-dim)] mt-0.5">
                        {src.venue} · {(src.bytes / 1024).toFixed(0)} KB
                      </div>
                    </div>
                    <span className="badge-solid-white">
                      VERIFIED
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
              <label className="l">Target Web Page or Repository URL</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={firecrawlUrl}
                  onChange={(e) => setFirecrawlUrl(e.target.value)}
                  className="flex-1 rounded border border-[var(--border-primary)] bg-[var(--card-bg)] px-3.5 py-2.5 text-xs text-[var(--text-primary)] outline-none font-mono focus:border-[#f97316]"
                />
                <button
                  onClick={handleCrawl}
                  className="flex items-center gap-1.5 rounded bg-[#f97316] px-4 text-xs font-mono font-bold uppercase text-black hover:bg-[#ea580c] transition shadow-[0_0_15px_rgba(249,115,22,0.3)]"
                >
                  <Globe className="h-3.5 w-3.5" />
                  Crawl
                </button>
              </div>
            </div>

            {crawlStatus && (
              <div className="c p-3 bg-[var(--card-bg)] border-l-[3px] !border-l-[#f97316] text-xs text-[var(--text-primary)] flex items-center gap-2 border border-[var(--border-primary)]">
                <CheckCircle2 className="h-4 w-4 text-[#f97316] flex-shrink-0" />
                <span className="font-mono">{crawlStatus}</span>
              </div>
            )}
          </div>
        )}

        {/* Chunks Tab */}
        {activeTab === 'chunks' && (
          <div className="max-h-[calc(100vh-230px)] overflow-y-auto space-y-3 pr-1">
            {Object.values(DEMO_CHUNKS).map((chunk) => (
              <div key={chunk.id} className="c p-3.5 bg-[var(--card-bg)] border border-[var(--border-primary)] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="badge-orange-outline !text-[9px]">Chunk {chunk.id}</span>
                  <span className="m text-[10px] text-[var(--text-dim)]">
                    PAGE {chunk.page} · {chunk.charStart}–{chunk.charEnd}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-[var(--text-secondary)] font-serif">
                  &ldquo;{chunk.text}&rdquo;
                </p>
                <div className="text-[10px] text-[var(--text-dim)] font-mono">
                  Source: <span className="text-[var(--text-primary)] font-medium">{chunk.sourceTitle}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
