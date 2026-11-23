import React, { useState } from 'react';
import { Send, BookOpen } from 'lucide-react';

interface Message {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  citations?: string[];
}

export const AskResearchPage: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'm1',
      sender: 'ai',
      text: 'Ask questions across the papers in this workspace. Answers are retrieval-grounded and accompanied by verbatim chunk citations.',
      citations: ['Strobl et al. 2007 · p.4'],
    },
    {
      id: 'm2',
      sender: 'user',
      text: 'Why does Gini importance favor high-cardinality noise features?',
    },
    {
      id: 'm3',
      sender: 'ai',
      text: 'Impurity-based importance can favor variables with many possible split points because they have more opportunities to produce an apparently large impurity decrease purely by chance. Permutation importance evaluates the effect of disrupting a feature\'s values instead, eliminating this split-selection bias.',
      citations: [
        'Strobl et al. 2007 · p.4 · chunk 14',
        'Strobl et al. 2008 · p.2 · chunk 6',
      ],
    },
  ]);

  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim()) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: input,
    };

    const aiMsg: Message = {
      id: `ai-${Date.now()}`,
      sender: 'ai',
      text: `Based on the indexed literature, ${input.toLowerCase().includes('boruta') ? 'the Boruta algorithm addresses feature selection by creating randomized shadow attributes to construct an empirical statistical threshold.' : 'the empirical evaluation demonstrates that permutation importance restores parity across features with varying categorical levels, ranking noise attributes in the bottom quartile.'}`,
      citations: ['Strobl et al. 2007 · p.6 · chunk 2', 'Kursa & Rudnicki 2010 · p.5 · chunk 5'],
    };

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setInput('');
  };

  return (
    <div className="p-6 max-w-5xl mx-auto h-[calc(100vh-140px)] flex flex-col font-mono animate-fade-in">
      {/* Header Banner */}
      <div className="flex items-center justify-between p-4 border border-[var(--border-primary)] bg-[var(--card-bg)] border-b-0">
        <div>
          <div className="text-xs font-bold text-[var(--text-primary)]">
            Ask Ingested Sources (RAG Assistant)
          </div>
          <div className="text-[11px] text-[var(--text-dim)] font-sans mt-0.5">
            Retrieval-grounded research assistant · strict verbatim citations required
          </div>
        </div>
        <span className="badge-solid-white !text-[9px] rounded-none">
          3 SOURCES AVAILABLE
        </span>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 border border-[var(--border-primary)] bg-[var(--bg-surface)] space-y-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[85%] p-4 border text-xs leading-relaxed ${
              m.sender === 'user'
                ? 'ml-auto border-[#f97316]/50 bg-[#f97316]/10 text-[var(--text-primary)]'
                : 'border-[var(--border-primary)] bg-[var(--card-bg)] text-[var(--text-secondary)]'
            }`}
          >
            <div className="font-bold text-[10px] uppercase text-[var(--text-dim)] mb-1">
              {m.sender === 'user' ? 'Researcher' : 'ResearchGraph Assistant'}
            </div>
            <div className="font-sans leading-relaxed">{m.text}</div>
            {m.citations && m.citations.length > 0 && (
              <div className="mt-2.5 pt-2 border-t border-[var(--border-primary)] flex gap-1.5 flex-wrap">
                {m.citations.map((c, i) => (
                  <span
                    key={i}
                    className="badge-orange-outline !text-[9px] !px-1.5 rounded-none flex items-center gap-1"
                  >
                    <BookOpen className="h-2.5 w-2.5" />
                    <span>{c}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input Dock */}
      <div className="flex gap-2 p-3 border border-[var(--border-primary)] border-t-0 bg-[var(--card-bg)]">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask a question about your research sources (e.g. Boruta shadow features, cardinality bias)..."
          className="flex-1 bg-[var(--bg-surface)] border border-[var(--border-primary)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-[#f97316]"
        />
        <button
          onClick={handleSend}
          className="px-4 py-2 bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] transition flex items-center gap-1.5"
        >
          <span>Ask</span>
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};