import React from 'react';
import { Menu, Play, Download, Terminal, Sun, Moon } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import type { PageId } from './Sidebar';

interface NavbarProps {
  currentPage: PageId;
  pageTitle: string;
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenApproval: () => void;
  onOpenExport: () => void;
  onToggleConsole: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  pageTitle,
  onToggleSidebar,
  onOpenApproval,
  onOpenExport,
  onToggleConsole,
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

      <div className="flex min-h-[58px] w-full items-center justify-between gap-3 px-4 text-[var(--text-secondary)]">
        {/* Left: Sidebar Toggle & Brand */}
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleSidebar}
            className="p-1.5 border border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)] transition rounded-none"
            title="Toggle sidebar"
          >
            <Menu className="h-4 w-4" />
          </button>

          {/* Brand Identity */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 flex items-center justify-center border border-[#f97316] bg-[var(--bg-surface)] text-[#f97316] font-mono text-base font-bold shadow-[0_0_12px_rgba(249,115,22,0.25)]">
              ⬡
            </div>
            <div className="hidden sm:flex flex-col">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-black tracking-tight text-[var(--text-primary)] uppercase">
                  RESEARCHGRAPH
                </span>
                <span className="badge-solid-white !text-[8px] !px-1 rounded-none">
                  DIGITAL TWIN
                </span>
              </div>
              <span className="text-[9px] text-[var(--text-dim)] font-mono tracking-widest uppercase">
                EMPIRICAL REPRODUCIBILITY ENGINE
              </span>
            </div>
          </div>

          {/* Breadcrumb */}
          <div className="hidden md:flex items-center gap-2 pl-3 ml-2 border-l border-[var(--border-primary)] text-xs font-mono text-[var(--text-dim)]">
            <span>Workspace</span>
            <span>/</span>
            <strong className="text-[var(--text-primary)] font-semibold">{pageTitle}</strong>
          </div>
        </div>

        {/* Right: State Pills & Actions */}
        <div className="flex items-center gap-2">
          {/* Metadata Badges */}
          <span className="badge-orange-outline hidden lg:inline-flex rounded-none text-[10px]">
            MODE: ADAPTED
          </span>
          <span className="b hidden xl:inline-flex rounded-none border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-dim)] text-[10px]">
            DATA: OPENML:52350
          </span>

          {/* Plan & Run (Primary Hero Action) */}
          <button
            onClick={onOpenApproval}
            className="flex items-center gap-1.5 h-8 px-3 rounded-none bg-[#f97316] text-black font-mono font-bold text-xs hover:bg-[#ea580c] transition shadow-[0_0_15px_rgba(249,115,22,0.35)] active:scale-95"
            title="Review experiment plan and approve E2B run"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span className="hidden sm:inline">PLAN & RUN</span>
          </button>

          {/* Export Button */}
          <button
            onClick={onOpenExport}
            className="flex items-center gap-1.5 h-8 px-2.5 rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-secondary)] transition text-xs font-mono"
            title="Export workspace"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden md:inline">EXPORT</span>
          </button>

          {/* Terminal / Console Toggle */}
          <button
            onClick={onToggleConsole}
            className="p-2 rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[#f97316] hover:border-[#f97316]/50 transition"
            title="Execution Console"
          >
            <Terminal className="h-3.5 w-3.5" />
          </button>

          {/* Theme Switcher */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)] transition"
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </header>
  );
};