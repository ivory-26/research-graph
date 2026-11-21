import React from 'react';
import { Play, BookOpen, Terminal } from 'lucide-react';

export type ActiveTab = 'graph' | 'sources' | 'ask' | 'runs' | 'dashboard';

interface NavbarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onOpenApproval: () => void;
  onOpenExport: () => void;
  onToggleLogs: () => void;
  logCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  onOpenApproval,
  onOpenExport,
  onToggleLogs,
  logCount = 0,
}) => {
  return (
    <header className="flex flex-col w-full z-30 select-none border-b border-[#262626] bg-[#000000]/95 backdrop-blur-xl">
      {/* Prithvi Twin Signature 2px Tri-color Header Accent Stripe */}
      <div className="flex h-[2px] w-full">
        <div className="w-1/3 bg-white" />
        <div className="w-1/3 bg-[#f97316]" />
        <div className="w-1/3 bg-[#262626]" />
      </div>

      <div className="flex min-h-[58px] w-full flex-wrap items-center justify-between gap-4 px-6 text-[#e5e5e5]">
        {/* Brand Identity */}
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-2.5 font-semibold text-base cursor-pointer group"
            onClick={() => onSelectTab('graph')}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#0a0a0a] border border-[#f97316]/50 group-hover:border-[#f97316] transition shadow-[0_0_12px_rgba(249,115,22,0.2)]">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#f97316"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M12 2l9 5v10l-9 5-9-5V7z" />
                <circle cx="12" cy="12" r="2.5" fill="#f97316" fillOpacity="0.3" />
              </svg>
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="tracking-tight text-[15px] font-bold text-white uppercase font-mono">
                  ResearchGraph
                </span>
                <span className="badge-solid-white">
                  DIGITAL TWIN
                </span>
              </div>
              <span className="text-[10px] text-[#737373] font-mono tracking-wider">
                EMPIRICAL REPRODUCIBILITY ENGINE
              </span>
            </div>
          </div>
        </div>

        {/* Navigation View Tabs */}
        <nav className="flex items-center gap-1.5 p-1 rounded-lg border border-[#262626] bg-[#0a0a0a]">
          <button
            onClick={() => onSelectTab('graph')}
            className={`h-7 px-3.5 rounded text-[12px] font-mono uppercase tracking-wide transition ${
              activeTab === 'graph'
                ? 'bg-white text-black font-bold shadow-sm'
                : 'bg-transparent text-[#a3a3a3] hover:text-white hover:bg-[#171717]'
            }`}
          >
            Graph
          </button>

          <button
            onClick={() => onSelectTab('sources')}
            className={`h-7 px-3.5 rounded text-[12px] font-mono uppercase tracking-wide transition ${
              activeTab === 'sources'
                ? 'bg-white text-black font-bold shadow-sm'
                : 'bg-transparent text-[#a3a3a3] hover:text-white hover:bg-[#171717]'
            }`}
          >
            Sources
          </button>

          <button
            onClick={() => onSelectTab('ask')}
            className={`h-7 px-3.5 rounded text-[12px] font-mono uppercase tracking-wide transition ${
              activeTab === 'ask'
                ? 'bg-white text-black font-bold shadow-sm'
                : 'bg-transparent text-[#a3a3a3] hover:text-white hover:bg-[#171717]'
            }`}
          >
            Ask RAG
          </button>

          <button
            onClick={() => onSelectTab('runs')}
            className={`h-7 px-3.5 rounded text-[12px] font-mono uppercase tracking-wide transition ${
              activeTab === 'runs'
                ? 'bg-white text-black font-bold shadow-sm'
                : 'bg-transparent text-[#a3a3a3] hover:text-white hover:bg-[#171717]'
            }`}
          >
            Run A / B
          </button>

          <button
            onClick={() => onSelectTab('dashboard')}
            className={`h-7 px-3.5 rounded text-[12px] font-mono uppercase tracking-wide transition ${
              activeTab === 'dashboard'
                ? 'bg-white text-black font-bold shadow-sm'
                : 'bg-transparent text-[#a3a3a3] hover:text-white hover:bg-[#171717]'
            }`}
          >
            Strategies
          </button>
        </nav>

        {/* Status Badges & Quick Triggers */}
        <div className="flex items-center gap-3">
          <span className="badge-orange-outline">
            MODE: ADAPTED
          </span>
          <span className="b border-[#262626] bg-[#0a0a0a] text-[#737373]">
            DATA: OPENML:52350
          </span>

          {/* Plan & Run (Prithvi International Orange Hero Button) */}
          <button
            onClick={onOpenApproval}
            className="flex items-center gap-1.5 h-7 px-3 rounded bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] transition shadow-[0_0_15px_rgba(249,115,22,0.3)] active:scale-95"
            title="Review code and approve isolated E2B sandbox run"
          >
            <Play className="h-3 w-3 fill-current" />
            <span className="font-mono uppercase text-[11px] tracking-wider">Plan &amp; Run</span>
          </button>

          {/* Colab Notebook Export */}
          <button
            onClick={onOpenExport}
            className="flex items-center gap-1.5 h-7 px-2.5 rounded border border-[#262626] bg-[#0a0a0a] text-[#e5e5e5] text-xs font-mono uppercase tracking-wide hover:border-[#404040] hover:text-white transition"
            title="Export self-contained Jupyter notebook for Google Colab"
          >
            <BookOpen className="h-3 w-3 text-[#f97316]" />
            <span className="text-[11px]">Colab</span>
          </button>

          {/* Sandbox Stream Logs Trigger */}
          <button
            onClick={onToggleLogs}
            className="flex items-center gap-1.5 h-7 px-2.5 rounded border border-[#262626] bg-[#0a0a0a] text-[#a3a3a3] text-xs hover:text-white hover:border-[#404040] transition"
            title="Toggle E2B Sandbox logs"
          >
            <Terminal className="h-3 w-3 text-[#f97316]" />
            {logCount > 0 && (
              <span className="font-mono text-[10px] text-[#f97316] font-bold">
                {logCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
