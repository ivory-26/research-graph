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
      // Deterministic semantic retrieval across the 3 ingested demo sources
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
    }, 400);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl border-l border-slate-200 bg-white/95 p-6 shadow-2xl backdrop-blur-xl transition-all dark:border-slate-800 dark:bg-slate-900/95">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-cyan-500/10 p-2 text-cyan-600 dark:text-cyan-400">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Ask Across Sources (pgvector RAG)
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Embedded passages at 768 dimensions across 3 verified research papers.
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

      {/* Query Bar */}
      <div className="mt-5 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch(query)}
              placeholder="Ask a scientific query across papers..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-xs text-slate-900 outline-none focus:border-cyan-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
          <button
            onClick={() => handleSearch(query)}
            disabled={isSearching}
            className="flex items-center gap-1.5 rounded-xl bg-cyan-600 px-4 py-2 text-xs font-bold text-white hover:bg-cyan-700 transition disabled:opacity-50"
          >
            {isSearching ? 'Retrieving...' : 'Query'}
          </button>
        </div>

        {/* Preset Chips */}
        <div className="flex flex-wrap gap-1.5">
          {PRESET_QUERIES.map((preset, idx) => (
            <button
              key={idx}
              onClick={() => {
                setQuery(preset);
                handleSearch(preset);
              }}
              className="rounded-full border border-slate-200/80 bg-slate-100/60 px-2.5 py-1 text-[10px] text-slate-600 hover:bg-cyan-50 hover:text-cyan-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400 dark:hover:bg-cyan-950/40 dark:hover:text-cyan-300 transition text-left"
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {/* Search Results */}
      <div className="mt-6 max-h-[calc(100vh-250px)] overflow-y-auto space-y-4 pr-1">
        {activeResults ? (
          activeResults.map((res, i) => (
            <div
              key={i}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950 space-y-3"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate max-w-[260px]">
                    {res.source.title}
                  </span>
                </div>
                <span className="font-mono text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                  Cosine: {(res.similarity * 100).toFixed(0)}%
                </span>
              </div>

              <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed font-medium">
                {res.synthesis}
              </p>

              {/* Cited Chunk */}
              <div className="rounded-lg border border-amber-200/60 bg-amber-50/50 p-3 text-[11px] leading-relaxed text-slate-700 dark:border-amber-800/30 dark:bg-amber-950/20 dark:text-slate-300">
                <div className="flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-400 mb-1">
                  <Quote className="h-3 w-3" />
                  Cited Passage (Page {res.chunk.page})
                </div>
                &quot;{res.chunk.text}&quot;
              </div>

              <div className="text-[10px] text-slate-400 flex justify-between">
                <span>{res.source.authors} ({res.source.year})</span>
                <span className="font-mono">{res.source.doi}</span>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-12 text-slate-400 text-xs">
            Enter a question or click a preset query to perform cross-source vector search.
          </div>
        )}
      </div>
    </div>
  );
};
