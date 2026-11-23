import React, { useState } from 'react';
import { Upload } from 'lucide-react';

interface SourcesPageProps {
  onShowToast: (msg: string) => void;
}

export const SourcesPage: React.FC<SourcesPageProps> = ({ onShowToast }) => {
  const [sources, setSources] = useState([
    {
      id: 'src-1',
      title: 'Strobl et al. 2007',
      venue: 'BMC Bioinformatics',
      pages: 14,
      size: '411 KB',
      status: 'VERIFIED',
      doi: '10.1186/1471-2105-8-25',
    },
    {
      id: 'src-2',
      title: 'Strobl et al. 2008',
      venue: 'BMC Bioinformatics',
      pages: 12,
      size: '500 KB',
      status: 'VERIFIED',
      doi: '10.1186/1471-2105-9-307',
    },
    {
      id: 'src-3',
      title: 'Kursa & Rudnicki 2010',
      venue: 'Journal of Statistical Software',
      pages: 13,
      size: '378 KB',
      status: 'VERIFIED',
      doi: '10.18637/jss.v036.i11',
    },
  ]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newItems = Array.from(files).map((f, i) => ({
      id: `uploaded-${Date.now()}-${i}`,
      title: f.name.replace(/\.pdf$/i, ''),
      venue: 'Local Document',
      pages: 10,
      size: `${(f.size / 1024).toFixed(0)} KB`,
      status: 'QUEUED',
      doi: 'Local Checksum: verified',
    }));

    setSources((prev) => [...newItems, ...prev]);
    onShowToast(`Added ${files.length} paper(s) to local ingestion queue`);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto animate-fade-in font-mono">
      {/* Top Grid: Ingest Dropzone & Processing Pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Dropzone Card */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
          <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
            Ingest research sources
          </div>
          <p className="text-xs text-[var(--text-dim)] font-sans">
            Add papers to this workspace. The engine extracts coordinate-aware passages, computes cryptographic SHA-256 fingerprints, and builds chunk anchors.
          </p>

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

          <div className="space-y-2 pt-2 border-t border-[var(--border-primary)] text-xs text-[var(--text-muted)] font-sans">
            <div className="text-[10px] font-mono uppercase text-[var(--text-dim)]">
              INGESTION OPTIONS
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" defaultChecked className="accent-[#f97316]" />
              <span>Extract page and character offsets</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" defaultChecked className="accent-[#f97316]" />
              <span>Generate semantic embeddings (768-dim)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="accent-[#f97316]" />
              <span>Attempt metadata enrichment via Crossref</span>
            </label>
          </div>
        </div>

        {/* Source Processing Pipeline Status */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
          <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
            Source processing pipeline
          </div>
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-3">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                <div>
                  <div className="text-xs text-[var(--text-primary)] font-semibold">
                    File validation
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] font-sans">
                    PDF type, size and SHA-256 checksum
                  </div>
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">READY</span>
            </div>

            <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-3">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <div>
                  <div className="text-xs text-[var(--text-primary)] font-semibold">
                    Text extraction
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] font-sans">
                    Column-aware text with unpdf
                  </div>
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">READY</span>
            </div>

            <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-3">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <div>
                  <div className="text-xs text-[var(--text-primary)] font-semibold">
                    Chunk generation
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] font-sans">
                    Stable chunk anchors with char ranges
                  </div>
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">READY</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <div>
                  <div className="text-xs text-[var(--text-primary)] font-semibold">
                    Embedding generation
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] font-sans">
                    Semantic pgvector cosine index
                  </div>
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">READY</span>
            </div>
          </div>
        </div>
      </div>

      {/* Active Papers in Workspace List */}
      <div className="space-y-3">
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
          ACTIVE PAPERS IN WORKSPACE ({sources.length})
        </div>
        <div className="space-y-2">
          {sources.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between p-4 border border-[var(--border-primary)] bg-[var(--card-bg)] hover:border-[var(--border-secondary)] transition gap-4 flex-wrap"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-11 border border-[#f97316]/50 bg-[#f97316]/10 text-[#f97316] flex items-center justify-center font-bold text-xs flex-shrink-0">
                  PDF
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
                  onClick={() => onShowToast(`Opened source document: ${s.title}`)}
                  className="px-2.5 py-1 text-xs border border-[var(--border-primary)] bg-[var(--bg-surface)] hover:text-[#f97316] transition"
                >
                  View
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};