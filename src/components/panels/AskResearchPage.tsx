import React, { useState } from 'react';
import { Send, BookOpen, CheckCircle, Sparkles, Quote } from 'lucide-react';
import { queryRetrieval, type RetrievalResult } from '../../server/pipelineBridge';

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
    verified: boolean;
  }>;
}

const SAMPLE_QUESTIONS = [
  'Why does Gini importance favor high-cardinality noise features?',
  'How does Boruta use randomized shadow attributes?',
  'When does conditional permutation importance outperform standard permutation?',
];

export const AskResearchPage: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'm1',
      sender: 'ai',
      text: 'Ask evidence-grounded questions across your indexed research papers (Strobl 2007, Strobl 2008, Kursa 2010). Every answer is backed by exact verbatim chunk citations verified against source text.',
      citations: [
        {
          sourceId: 'src-strobl-2007',
          sourceTitle: 'Strobl et al. 2007',
          chunkId: 'chunk-14',
          page: 4,
          quote: 'A variable with more categories has a higher probability to be selected in individual splits purely by chance.',
          claimSupported: 'Gini split selection combinatorial bias',
          verified: true,
        },
      ],
    },
  ]);

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

    try {
      // Connect to backend retrieval engine with verbatim quote verification
      const result: RetrievalResult = queryRetrieval(textToSend);

      const aiMsg: Message = {
        id: `ai-${Date.now()}`,
        sender: 'ai',
        text: result.answer,
        citations: result.citations,
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch {
      const errorMsg: Message = {
        id: `ai-err-${Date.now()}`,
        sender: 'ai',
        text: 'Error querying retrieval API. Please ensure the workspace papers are indexed.',
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto h-[calc(100vh-140px)] flex flex-col font-mono animate-fade-in">
      {/* Header Banner */}
      <div className="flex items-center justify-between p-4 border border-[var(--border-primary)] bg-[var(--card-bg)] border-b-0">
        <div>
          <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#f97316]" />
            <span>Ask Ingested Sources (RAG Assistant)</span>
          </div>
          <div className="text-[11px] text-[var(--text-dim)] font-sans mt-0.5">
            Retrieval-grounded research assistant · strict verbatim citations verified with Neon pgvector
          </div>
        </div>
        <span className="badge-solid-white !text-[9px] rounded-none">
          3 SOURCES INDEXED
        </span>
      </div>

      {/* Suggested Questions Pill Dock */}
      <div className="p-2 border-x border-[var(--border-primary)] bg-[var(--bg-surface)] flex items-center gap-2 overflow-x-auto text-[10px]">
        <span className="text-[var(--text-dim)] uppercase tracking-wider flex-shrink-0">
          Suggested:
        </span>
        {SAMPLE_QUESTIONS.map((sq, i) => (
          <button
            key={i}
            onClick={() => handleSend(sq)}
            className="px-2 py-1 border border-[var(--border-primary)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:text-[#f97316] hover:border-[#f97316]/60 transition truncate whitespace-nowrap"
          >
            {sq}
          </button>
        ))}
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
                <span className="text-[9px] text-emerald-400 flex items-center gap-1 font-mono">
                  <CheckCircle className="h-2.5 w-2.5" />
                  VERBATIM CITATIONS
                </span>
              )}
            </div>
            <div className="font-sans leading-relaxed text-sm">{m.text}</div>

            {/* Citations with Verbatim Verification Details */}
            {m.citations && m.citations.length > 0 && (
              <div className="mt-3 pt-2.5 border-t border-[var(--border-primary)] space-y-2">
                <div className="text-[9px] text-[var(--text-dim)] uppercase tracking-wider font-bold">
                  Verified Evidence Passages:
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
                          {c.verified && (
                            <span className="text-emerald-400 text-[8px] font-bold">✓ VERIFIED</span>
                          )}
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
            <span>Searching 768-dim embeddings and verifying verbatim quotes...</span>
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
          placeholder="Ask a question across the indexed papers (e.g. Why does Gini importance favor noise?)..."
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
