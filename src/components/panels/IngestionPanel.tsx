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
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl border-l border-[#252C36] bg-[#0E1116] p-6 text-[#E6EAF0] shadow-2xl backdrop-blur-xl transition-all">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#252C36] pb-4">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-[#6EA8FE]/10 p-2 text-[#6EA8FE]">
            <UploadCloud className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#E6EAF0]">
              Collect: Ingestion &amp; Chunk Viewer
            </h3>
            <p className="text-[11px] text-[#9AA4B2]">
              PDF coordinate order extraction + Firecrawl project page scraper
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-[#9AA4B2] hover:text-[#E6EAF0] hover:bg-[#161B22] transition"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="mt-4 flex border-b border-[#252C36]">
        <button
          onClick={() => setActiveTab('upload')}
          className={`border-b-2 px-4 py-2 text-xs font-semibold transition ${
            activeTab === 'upload'
              ? 'border-[#3DD6B5] text-[#3DD6B5]'
              : 'border-transparent text-[#9AA4B2] hover:text-[#E6EAF0]'
          }`}
        >
          PDF Upload
        </button>
        <button
          onClick={() => setActiveTab('firecrawl')}
          className={`border-b-2 px-4 py-2 text-xs font-semibold transition ${
            activeTab === 'firecrawl'
              ? 'border-[#3DD6B5] text-[#3DD6B5]'
              : 'border-transparent text-[#9AA4B2] hover:text-[#E6EAF0]'
          }`}
        >
          Firecrawl Scraper
        </button>
        <button
          onClick={() => setActiveTab('chunks')}
          className={`border-b-2 px-4 py-2 text-xs font-semibold transition ${
            activeTab === 'chunks'
              ? 'border-[#3DD6B5] text-[#3DD6B5]'
              : 'border-transparent text-[#9AA4B2] hover:text-[#E6EAF0]'
          }`}
        >
          Extracted Chunks ({Object.keys(DEMO_CHUNKS).length})
        </button>
      </div>

      <div className="mt-5 space-y-4">
        {/* Upload Tab */}
        {activeTab === 'upload' && (
          <div className="space-y-4">
            <div className="c flex flex-col items-center justify-center border-dashed border-[#252C36] p-8 text-center bg-[#161B22]">
              <UploadCloud className="h-10 w-10 text-[#6EA8FE] mb-2" />
              <div className="text-xs font-semibold text-[#E6EAF0]">
                Drop Research Papers (.pdf) here
              </div>
              <p className="text-[11px] text-[#9AA4B2] mt-1 max-w-xs">
                Automatically extracts text in coordinate reading order, computes SHA-256 hash, and chunks with character offsets.
              </p>
              <button className="mt-4 rounded-lg bg-[#3DD6B5] px-4 py-2 text-xs font-semibold text-[#0E1116] hover:bg-[#34c4a4] transition">
                Select File
              </button>
            </div>

            <div className="space-y-2">
              <div className="l">Active Papers in Workspace</div>
              <div className="space-y-2">
                {DEMO_SOURCES.map((src) => (
                  <div key={src.id} className="c p-3 bg-[#161B22] flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium text-[#E6EAF0]">{src.title}</div>
                      <div className="m text-[10px] text-[#9AA4B2] mt-0.5">
                        {src.venue} · {(src.bytes / 1024).toFixed(0)} KB
                      </div>
                    </div>
                    <span className="b text-[#3DD6B5] border-[#3DD6B5]/40 text-[10px]">
                      verified
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
                  className="flex-1 rounded-xl border border-[#252C36] bg-[#161B22] px-3.5 py-2.5 text-xs text-[#E6EAF0] outline-none focus:border-[#3DD6B5]"
                />
                <button
                  onClick={handleCrawl}
                  className="flex items-center gap-1.5 rounded-lg bg-[#3DD6B5] px-4 text-xs font-semibold text-[#0E1116] hover:bg-[#34c4a4] transition"
                >
                  <Globe className="h-3.5 w-3.5" />
                  Crawl
                </button>
              </div>
            </div>

            {crawlStatus && (
              <div className="c p-3 bg-[#161B22] border-l-[3px] !border-l-[#3DD6B5] text-xs text-[#E6EAF0] flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[#3DD6B5] flex-shrink-0" />
                <span>{crawlStatus}</span>
              </div>
            )}
          </div>
        )}

        {/* Chunks Tab */}
        {activeTab === 'chunks' && (
          <div className="max-h-[calc(100vh-230px)] overflow-y-auto space-y-3 pr-1">
            {Object.values(DEMO_CHUNKS).map((chunk) => (
              <div key={chunk.id} className="c p-3.5 bg-[#161B22] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="l text-[#3DD6B5]">Chunk {chunk.id}</span>
                  <span className="m text-[10px] text-[#9AA4B2]">
                    Page {chunk.page} · {chunk.charStart}–{chunk.charEnd}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-[#E6EAF0]">
                  &ldquo;{chunk.text}&rdquo;
                </p>
                <div className="text-[10px] text-[#9AA4B2]">
                  Source: <span className="text-[#E6EAF0]">{chunk.sourceTitle}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
