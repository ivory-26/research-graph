import React, { useState } from 'react';
import { Send, BookOpen, CheckCircle, Sparkles, Quote } from 'lucide-react';
import { DEMO_CHUNKS } from '../../data/demoWorkspace';

interface Message {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  citations?: Array<{
    sourceId: string;
    sourceTitle: string;
    chunkId: string;
    page: number;
    quote: string;
    claimSupported: string;
    verified?: boolean;
  }>;
}

function citeChunk(chunkId: string, claimSupported: string) {
  const chunk = DEMO_CHUNKS[chunkId];
  if (!chunk) throw new Error(`Missing inquiry fixture chunk ${chunkId}`);
  return {
    sourceId: chunk.sourceId,
    sourceTitle: chunk.sourceTitle,
    chunkId: chunk.id,
    page: chunk.page,
    quote: chunk.text,
    claimSupported,
  };
}

export function retrieveDemoCitations(query: string) {
  const q = query.toLowerCase();

  if (q.includes('boruta') || q.includes('shadow')) {
    return {
      answer:
        'Boruta expands the feature set by generating randomized shadow attributes that break correlation with the response. A real feature is confirmed informative only if its importance score significantly exceeds the maximum importance among all shadow features.',
      citations: [citeChunk('chunk-5', 'Shuffled shadow attributes and their importance')],
    };
  }

  if (q.includes('conditional') || q.includes('correlat')) {
    return {
      answer:
        'Conditional variable importance permutes features only within strata defined by correlated predictors. This preserves the conditional association and avoids artificially inflating importance scores among blocks of correlated predictors.',
      citations: [citeChunk('chunk-4', 'Conditional permutation importance compared with marginal importance')],
    };
  }

  return {
    answer:
      'Gini importance measures the total decrease in node impurity. Because variables with more categories provide exponentially more potential split cutpoints, they have a higher combinatorial probability of reducing impurity purely by chance.',
    citations: [
      citeChunk('chunk-1', 'Gini importance favors predictors with many categories'),
      citeChunk('chunk-3', 'Simulation ranking of high-cardinality noise'),
    ],
  };
}

export const demoWelcomeMessage: Message = {
  id: 'm1',
  sender: 'ai',
  text: 'Ask evidence-grounded questions across workspace research papers (Strobl 2007, Strobl 2008, Kursa 2010). Citations link to verbatim passages in workspace chunks.',
  citations: [citeChunk('chunk-1', 'Gini importance favors predictors with many categories')],
};

export const AskResearchPage: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([demoWelcomeMessage]);

  const [input, setInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [expandedCitation, setExpandedCitation] = useState<string | null>(null);

  const handleSend = async (queryText?: string) => {
    const textToSend = queryText || input;
    if (!textToSend.trim() || isSearching) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: textToSend,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsSearching(true);

    const result = retrieveDemoCitations(textToSend);

    const aiMsg: Message = {
      id: `ai-${Date.now()}`,
      sender: 'ai',
      text: result.answer,
      citations: result.citations,
    };

    setMessages((prev) => [...prev, aiMsg]);
    setIsSearching(false);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto h-[calc(100vh-140px)] flex flex-col font-mono animate-fade-in">
      {/* Header Banner */}
      <div className="flex items-center justify-between p-4 border border-[var(--border-primary)] bg-[var(--card-bg)] border-b-0">
        <div>
          <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#f97316]" />
            <span>Ask Ingested Sources (Inquiry Preview)</span>
          </div>
          <div className="text-[11px] text-[var(--text-dim)] font-sans mt-0.5">
            Literature inquiry preview · sample queries over workspace sources
          </div>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 border border-[var(--border-primary)] bg-[var(--bg-surface)] space-y-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[88%] p-4 border text-xs leading-relaxed ${
              m.sender === 'user'
                ? 'ml-auto border-[#f97316]/50 bg-[#f97316]/10 text-[var(--text-primary)]'
                : 'border-[var(--border-primary)] bg-[var(--card-bg)] text-[var(--text-secondary)]'
            }`}
          >
            <div className="font-bold text-[10px] uppercase text-[var(--text-dim)] mb-1 flex items-center justify-between">
              <span>{m.sender === 'user' ? 'Researcher' : 'ResearchGraph Assistant'}</span>
              {m.sender === 'ai' && (
                <span className="text-[9px] text-[var(--text-dim)] flex items-center gap-1 font-mono">
                  <CheckCircle className="h-2.5 w-2.5" />
                  CITATION PREVIEW
                </span>
              )}
            </div>
            <div className="font-sans leading-relaxed text-sm">{m.text}</div>

            {/* Citations with Verbatim Verification Details */}
            {m.citations && m.citations.length > 0 && (
              <div className="mt-3 pt-2.5 border-t border-[var(--border-primary)] space-y-2">
                <div className="text-[9px] text-[var(--text-dim)] uppercase tracking-wider font-bold">
                  Workspace Evidence Passages:
                </div>
                <div className="flex gap-2 flex-wrap">
                  {m.citations.map((c, i) => {
                    const citKey = `${m.id}-${i}`;
                    const isExpanded = expandedCitation === citKey;
                    return (
                      <div key={i} className="flex flex-col gap-1 w-full sm:w-auto">
                        <button
                          onClick={() => setExpandedCitation(isExpanded ? null : citKey)}
                          className="badge-orange-outline !text-[9px] !px-2 !py-1 rounded-none flex items-center gap-1.5 hover:bg-[#f97316]/15 transition text-left cursor-pointer"
                        >
                          <BookOpen className="h-3 w-3 text-[#f97316] flex-shrink-0" />
                          <span className="font-bold">{c.sourceTitle}</span>
                          <span className="text-[var(--text-dim)]">· p.{c.page} · {c.chunkId}</span>
                        </button>

                        {/* Citation Quote Popover / Expand */}
                        {isExpanded && (
                          <div className="p-2.5 bg-[var(--bg-primary)] border border-[#f97316]/40 text-[11px] font-sans space-y-1.5 animate-fade-in shadow-xl max-w-xl">
                            <div className="flex items-center gap-1.5 text-[#f97316] font-mono text-[9px] font-bold uppercase">
                              <Quote className="h-3 w-3" />
                              <span>Verbatim Quote in Document</span>
                            </div>
                            <blockquote className="italic border-l-2 border-[#f97316] pl-2 text-[var(--text-primary)]">
                              "{c.quote}"
                            </blockquote>
                            <div className="text-[10px] text-[var(--text-dim)] font-mono">
                              <strong>Supports:</strong> {c.claimSupported}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}

        {isSearching && (
          <div className="max-w-[75%] p-4 border border-[var(--border-primary)] bg-[var(--card-bg)] text-xs text-[var(--text-dim)] flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-[#f97316] animate-pulse" />
            <span>Retrieving sample citations for query...</span>
          </div>
        )}
      </div>

      {/* Input Box */}
      <div className="p-3 border border-[var(--border-primary)] bg-[var(--card-bg)] border-t-0 flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask a question across workspace papers (e.g. Why does Gini importance favor noise?)..."
          className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder-[var(--text-dim)] outline-none font-mono"
        />
        <button
          onClick={() => handleSend()}
          disabled={!input.trim() || isSearching}
          className="px-3 py-1.5 bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] disabled:opacity-50 transition flex items-center gap-1.5 cursor-pointer"
        >
          <span>Ask</span>
          <Send className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
};
