import React, { useState } from 'react';
import { DEMO_SOURCES, DEMO_CHUNKS } from '../../data/demoWorkspace';
import { Search, Sparkles, X, BookOpen, Quote } from 'lucide-react';

interface AskSourcesPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_QUERIES = [
  'Why does Gini importance favor high-cardinality noise features?',
  'How does conditional variable importance handle correlated features?',
  'How does Boruta use shadow features to detect importance?',
];

export const AskSourcesPanel: React.FC<AskSourcesPanelProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState(PRESET_QUERIES[0]);
  const [activeResults, setActiveResults] = useState<any[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = (q: string) => {
    setIsSearching(true);
    setTimeout(() => {
      if (q.toLowerCase().includes('gini') || q.toLowerCase().includes('cardinality') || q.toLowerCase().includes('noise')) {
        setActiveResults([
          {
            source: DEMO_SOURCES[0],
            chunk: DEMO_CHUNKS['chunk-1'],
            similarity: 0.94,
            synthesis:
              'Gini importance measures the total decrease in node impurity. Categorical variables with more levels provide more potential split cutpoints, inflating the probability of incidental impurity reduction purely by chance.',
          },
          {
            source: DEMO_SOURCES[0],
            chunk: DEMO_CHUNKS['chunk-3'],
            similarity: 0.89,
            synthesis:
              'In simulation studies, high-cardinality noise consistently places in the top 5 ranking, while permutation importance drops it to the bottom.',
          },
        ]);
      } else if (q.toLowerCase().includes('conditional') || q.toLowerCase().includes('correlat')) {
        setActiveResults([
          {
            source: DEMO_SOURCES[1],
            chunk: DEMO_CHUNKS['chunk-4'],
            similarity: 0.92,
            synthesis:
              'Conditional variable importance permutes features within strata of correlated predictors, preventing artificially elevated importance scores among correlated blocks.',
          },
        ]);
      } else {
        setActiveResults([
          {
            source: DEMO_SOURCES[2],
            chunk: DEMO_CHUNKS['chunk-5'],
            similarity: 0.91,
            synthesis:
              'Boruta creates shadow features by shuffling attribute values to establish an empirical noise baseline. Features are retained only if their importance exceeds the maximal shadow score.',
          },
        ]);
      }
      setIsSearching(false);
    }, 450);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl border-l border-[var(--border-primary)] bg-[var(--bg-primary)] p-6 text-[var(--text-secondary)] shadow-2xl backdrop-blur-xl transition-all">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-4">
        <div className="flex items-center gap-2.5">
          <div className="rounded bg-[#f97316]/10 p-2 text-[#f97316] border border-[#f97316]/30">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-[var(--text-primary)] font-mono uppercase tracking-wide">
                Ask Ingested Sources
              </h3>
              <span className="badge-solid-white">RAG</span>
            </div>
            <p className="text-[11px] text-[var(--text-dim)] font-mono mt-0.5">
              768-dim Gemini embeddings with mandatory passage citation
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

      <div className="mt-5 space-y-4">
        {/* Search Input Bar */}
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch(query)}
            placeholder="Search cross-paper claims and methodologies..."
            className="w-full rounded border border-[var(--border-primary)] bg-[var(--card-bg)] py-2.5 pl-10 pr-24 text-xs text-[var(--text-primary)] placeholder-[var(--text-dim)] outline-none font-mono focus:border-[#f97316]"
          />
          <Search className="absolute left-3.5 top-3 h-4 w-4 text-[var(--text-dim)]" />
          <button
            onClick={() => handleSearch(query)}
            disabled={isSearching}
            className="absolute right-1.5 top-1.5 h-7 rounded bg-[#f97316] px-3 text-xs font-mono font-bold uppercase text-black hover:bg-[#ea580c] transition disabled:opacity-50"
          >
            {isSearching ? '...' : 'Query'}
          </button>
        </div>

        {/* Preset Prompt Pills */}
        <div className="flex flex-wrap gap-1.5">
          {PRESET_QUERIES.map((pq, i) => (
            <button
              key={i}
              onClick={() => {
                setQuery(pq);
                handleSearch(pq);
              }}
              className="b text-[10px] text-[var(--text-muted)] border-[var(--border-primary)] bg-[var(--card-bg)] hover:border-[#f97316] hover:text-[var(--text-primary)] transition text-left"
            >
              {pq}
            </button>
          ))}
        </div>

        {/* Results Stream */}
        <div className="max-h-[calc(100vh-250px)] overflow-y-auto space-y-4 pr-1">
          {activeResults ? (
            activeResults.map((res, i) => (
              <div key={i} className="c p-4 bg-[var(--card-bg)] border border-[var(--border-primary)] space-y-3">
                <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)] font-mono">
                    <BookOpen className="h-3.5 w-3.5 text-[#f97316]" />
                    <span>{res.source.title}</span>
                  </div>
                  <span className="badge-orange-outline !text-[9px]">
                    COS SIM: {(res.similarity * 100).toFixed(0)}%
                  </span>
                </div>

                {/* Synthesis */}
                <p className="text-xs leading-relaxed text-[var(--text-secondary)] font-serif">
                  {res.synthesis}
                </p>

                {/* Grounding Cited Chunk */}
                <div className="c p-3 bg-[var(--bg-primary)] border-[var(--border-primary)] border-l-[3px] !border-l-[#f97316] text-[11px] leading-relaxed text-[var(--text-muted)]">
                  <div className="flex items-center justify-between text-[10px] font-bold text-[#f97316] mb-1 font-mono">
                    <span className="flex items-center gap-1">
                      <Quote className="h-3 w-3" />
                      CITED PASSAGE GROUNDING
                    </span>
                    <span className="m text-[var(--text-dim)]">PAGE {res.chunk.page}</span>
                  </div>
                  &ldquo;{res.chunk.text}&rdquo;
                </div>
              </div>
            ))
          ) : (
            <div className="c p-8 text-center bg-[var(--card-bg)] border border-[var(--border-primary)]">
              <div className="l text-xs">Vector Search Grounding</div>
              <p className="text-xs text-[var(--text-dim)] mt-2 font-mono">
                Click &ldquo;Query&rdquo; or pick a preset query to perform semantic retrieval across the 3 ingested research papers.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
