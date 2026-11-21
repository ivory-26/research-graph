import React from 'react';
import { Play, BookOpen, Terminal, Sun, Moon } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

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
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="flex flex-col w-full z-30 select-none border-b border-[var(--border-primary)] bg-[var(--header-bg)] backdrop-blur-xl transition-colors duration-200">
      {/* Prithvi Twin Signature 2px Tri-color Header Accent Stripe */}
      <div className="flex h-[2px] w-full">
        <div className={`w-1/3 ${theme === 'dark' ? 'bg-white' : 'bg-slate-900'}`} />
        <div className="w-1/3 bg-[#f97316]" />
        <div className={`w-1/3 ${theme === 'dark' ? 'bg-[#262626]' : 'bg-slate-300'}`} />
      </div>

      <div className="flex min-h-[58px] w-full flex-wrap items-center justify-between gap-4 px-6 text-[var(--text-secondary)]">
        {/* Brand Identity */}
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-2.5 font-semibold text-base cursor-pointer group"
            onClick={() => onSelectTab('graph')}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--bg-surface)] border border-[#f97316]/50 group-hover:border-[#f97316] transition shadow-[0_0_12px_rgba(249,115,22,0.2)]">
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
                <span className="tracking-tight text-[15px] font-bold text-[var(--text-primary)] uppercase font-mono">
                  ResearchGraph
                </span>
                <span className="badge-solid-white">
                  DIGITAL TWIN
                </span>
              </div>
              <span className="text-[10px] text-[var(--text-dim)] font-mono tracking-wider">
                EMPIRICAL REPRODUCIBILITY ENGINE
              </span>
            </div>
          </div>
        </div>

        {/* Navigation View Tabs */}
        <nav className="flex items-center gap-1.5 p-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)]">
          <button
            onClick={() => onSelectTab('graph')}
            className={`h-7 px-3.5 rounded text-[12px] font-mono uppercase tracking-wide transition ${
              activeTab === 'graph'
                ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold shadow-sm'
                : 'bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
            }`}
          >
            Graph
          </button>

          <button
            onClick={() => onSelectTab('sources')}
            className={`h-7 px-3.5 rounded text-[12px] font-mono uppercase tracking-wide transition ${
              activeTab === 'sources'
                ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold shadow-sm'
                : 'bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
            }`}
          >
            Sources
          </button>

          <button
            onClick={() => onSelectTab('ask')}
            className={`h-7 px-3.5 rounded text-[12px] font-mono uppercase tracking-wide transition ${
              activeTab === 'ask'
                ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold shadow-sm'
                : 'bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
            }`}
          >
            Ask RAG
          </button>

          <button
            onClick={() => onSelectTab('runs')}
            className={`h-7 px-3.5 rounded text-[12px] font-mono uppercase tracking-wide transition ${
              activeTab === 'runs'
                ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold shadow-sm'
                : 'bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
            }`}
          >
            Run A / B
          </button>

          <button
            onClick={() => onSelectTab('dashboard')}
            className={`h-7 px-3.5 rounded text-[12px] font-mono uppercase tracking-wide transition ${
              activeTab === 'dashboard'
                ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold shadow-sm'
                : 'bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
            }`}
          >
            Strategies
          </button>
        </nav>

        {/* Status Badges, Quick Triggers & Theme Toggle */}
        <div className="flex items-center gap-3">
          <span className="badge-orange-outline">
            MODE: ADAPTED
          </span>
          <span className="b border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-dim)]">
            DATA: OPENML:52350
          </span>

          {/* Plan & Run (Hero Action Button) */}
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
            className="flex items-center gap-1.5 h-7 px-2.5 rounded border border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-secondary)] text-xs font-mono uppercase tracking-wide hover:border-[var(--border-secondary)] hover:text-[var(--text-primary)] transition"
            title="Export self-contained Jupyter notebook for Google Colab"
          >
            <BookOpen className="h-3 w-3 text-[#f97316]" />
            <span className="text-[11px]">Colab</span>
          </button>

          {/* Sandbox Stream Logs Trigger */}
          <button
            onClick={onToggleLogs}
            className="flex items-center gap-1.5 h-7 px-2.5 rounded border border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-muted)] text-xs hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)] transition"
            title="Toggle E2B Sandbox logs"
          >
            <Terminal className="h-3 w-3 text-[#f97316]" />
            {logCount > 0 && (
              <span className="font-mono text-[10px] text-[#f97316] font-bold">
                {logCount}
              </span>
            )}
          </button>

          {/* Theme Toggle Button (Light/Dark Switcher) */}
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center h-7 w-7 rounded border border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)] transition shadow-sm"
            title={theme === 'dark' ? 'Switch to White (Light) Theme' : 'Switch to Prithvi Obsidian Dark Theme'}
            aria-label="Toggle Color Theme"
          >
            {theme === 'dark' ? (
              <Sun className="h-3.5 w-3.5 text-[#f97316] hover:rotate-45 transition-transform" />
            ) : (
              <Moon className="h-3.5 w-3.5 text-slate-800 hover:-rotate-12 transition-transform" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
