import React, { useState } from 'react';
import { DEMO_SOURCES, DEMO_CHUNKS } from '../../data/demoWorkspace';
import { UploadCloud, Globe, FileText, CheckCircle2, X } from 'lucide-react';

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
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl border-l border-slate-200 bg-white/95 p-6 shadow-2xl backdrop-blur-xl transition-all dark:border-slate-800 dark:bg-slate-900/95">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-blue-500/10 p-2 text-blue-600 dark:text-blue-400">
            <UploadCloud className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Collect: Ingestion &amp; Chunk Viewer
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              unpdf coordinate order extraction + Firecrawl project page scraper
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="mt-4 flex border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setActiveTab('upload')}
          className={`border-b-2 px-4 py-2 text-xs font-bold transition ${
            activeTab === 'upload'
              ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          PDF Drag &amp; Drop
        </button>
        <button
          onClick={() => setActiveTab('firecrawl')}
          className={`border-b-2 px-4 py-2 text-xs font-bold transition ${
            activeTab === 'firecrawl'
              ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          Firecrawl Web Ingest
        </button>
        <button
          onClick={() => setActiveTab('chunks')}
          className={`border-b-2 px-4 py-2 text-xs font-bold transition ${
            activeTab === 'chunks'
              ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          Extracted Chunks ({Object.keys(DEMO_CHUNKS).length})
        </button>
      </div>

      {/* Tab Panels */}
      <div className="mt-5 space-y-4">
        {activeTab === 'upload' && (
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 p-8 text-center transition hover:border-cyan-500 dark:border-slate-700 dark:hover:border-cyan-500 bg-slate-50/50 dark:bg-slate-950/40">
              <FileText className="h-10 w-10 text-cyan-500 mb-3" />
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Drop born-digital research paper PDF here
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Local unpdf extracts coordinate-ordered reading stream. Scanned PDFs (&lt;40 chars/page) are marked needs_ocr.
              </p>
              <div className="mt-4 rounded-lg bg-cyan-600 px-4 py-2 text-xs font-bold text-white shadow">
                Browse Files
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Ingested Workspace Sources:
              </div>
              {DEMO_SOURCES.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950"
                >
                  <div>
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {s.title}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      {s.authors} · {s.venue}
                    </div>
                  </div>
                  <span className="rounded bg-emerald-100 dark:bg-emerald-950 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                    Active
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'firecrawl' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
                <Globe className="h-4 w-4 text-blue-500" />
                Firecrawl Project Web Ingestion
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Firecrawl pulls published HTML project pages, benchmarks, and dataset repositories, converting DOM tables into structured Markdown.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={firecrawlUrl}
                  onChange={(e) => setFirecrawlUrl(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-cyan-500 dark:border-slate-800 dark:bg-slate-900"
                />
                <button
                  onClick={handleCrawl}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 transition"
                >
                  Crawl Page
                </button>
              </div>
              {crawlStatus && (
                <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/40 p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800">
                  <CheckCircle2 className="h-4 w-4" />
                  {crawlStatus}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'chunks' && (
          <div className="max-h-[calc(100vh-250px)] overflow-y-auto space-y-3">
            {Object.values(DEMO_CHUNKS).map((chunk) => (
              <div
                key={chunk.id}
                className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-950 space-y-2"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {chunk.sourceTitle}
                  </span>
                  <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono">
                    Page {chunk.page} · Chars {chunk.charStart}–{chunk.charEnd}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  {chunk.text}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
