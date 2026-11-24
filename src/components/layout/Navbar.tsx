import React, { useState, useRef, useEffect } from 'react';
import {
  Play,
  Terminal,
  PanelRight,
  Plus,
  Sun,
  Moon,
  MoreVertical,
  Download,
  ChevronDown,
  Sparkles,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

interface NavbarProps {
  currentWorkspace?: string;
  isInspectorOpen?: boolean;
  onToggleInspector?: () => void;
  onOpenApproval: () => void;
  onOpenExport: () => void;
  onToggleConsole: () => void;
  onAddSource?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentWorkspace = 'Research Graph',
  isInspectorOpen = false,
  onToggleInspector,
  onOpenApproval,
  onOpenExport,
  onToggleConsole,
  onAddSource,
}) => {
  const { theme, toggleTheme } = useTheme();
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsMoreMenuOpen(false);
      }
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(e.target as Node)) {
        setIsWorkspaceMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="flex flex-col w-full z-30 select-none border-b border-[var(--border-primary)] bg-[var(--header-bg)] transition-colors duration-200">
      {/* Prithvi Twin Signature 2px Tri-color Header Accent Stripe */}
      <div className="flex h-[2px] w-full">
        <div className={`w-1/3 ${theme === 'dark' ? 'bg-white' : 'bg-[#f97316]/40'}`} />
        <div className="w-1/3 bg-[#f97316]" />
        <div className={`w-1/3 ${theme === 'dark' ? 'bg-[var(--border-primary)]' : 'bg-slate-200'}`} />
      </div>

      <div className="flex h-16 min-h-[64px] w-full items-center justify-between gap-3 px-5 text-[var(--text-secondary)]">
        {/* LEFT SECTION: Brand Identity, Digital Twin Badge, Subtitle & Workspace Selector (Icon removed from top nav; preserved on left rail) */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Brand Identity & Subtitle */}
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-black tracking-tight text-[var(--text-primary)] uppercase">
                RESEARCHGRAPH
              </span>
              <span className="badge-solid-white !text-[8px] !px-1 rounded-none">
                DIGITAL TWIN
              </span>
            </div>
            <span className="text-[9px] text-[var(--text-dim)] font-mono tracking-widest uppercase truncate hidden sm:inline">
              EMPIRICAL REPRODUCIBILITY ENGINE
            </span>
          </div>

          {/* Vertical Separator */}
          <div className="h-6 w-[1px] bg-[var(--border-primary)] hidden md:block" />

          {/* Workspace Selector (Displaying: Research Graph) */}
          <div className="relative hidden md:block" ref={workspaceMenuRef}>
            <button
              onClick={() => setIsWorkspaceMenuOpen(!isWorkspaceMenuOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 border border-[var(--border-primary)] bg-[var(--bg-surface)] hover:border-[var(--border-secondary)] hover:bg-[var(--bg-surface-hover)] transition text-xs font-mono text-[var(--text-primary)] group"
              title="Current Workspace: Research Graph"
            >
              <span className="font-semibold">{currentWorkspace}</span>
              <ChevronDown className="h-3 w-3 text-[var(--text-dim)] group-hover:text-[var(--text-primary)] transition-transform duration-150" />
            </button>

            {/* Workspace Selection Popover */}
            {isWorkspaceMenuOpen && (
              <div className="absolute left-0 top-10 z-50 w-64 bg-[var(--bg-surface-elevated)] border border-[var(--border-primary)] p-2 shadow-2xl backdrop-blur-2xl animate-fade-in text-xs font-mono space-y-1">
                <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-[var(--text-dim)] border-b border-[var(--border-primary)] flex justify-between items-center">
                  <span>Workspaces</span>
                  <span className="text-emerald-400">Online</span>
                </div>
                <div className="p-2 bg-[var(--bg-surface-hover)] text-[var(--text-primary)] border border-[#f97316]/50 flex items-center justify-between">
                  <div>
                    <div className="font-bold flex items-center gap-1.5 text-xs">
                      <span>{currentWorkspace}</span>
                    </div>
                    <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                      3 sources · 1 claim · Active
                    </div>
                  </div>
                  <span className="text-[9px] text-[#f97316] uppercase font-bold">Active</span>
                </div>
              </div>
            )}
          </div>

          {/* Workspace State / Variables Badges */}
          <div className="hidden lg:flex items-center gap-1.5">
            <span
              className="badge-orange-outline text-[10px] tracking-wide cursor-default select-none"
              title="Execution Mode: Adapted Scikit-learn Pipeline"
            >
              MODE: ADAPTED
            </span>
            <span
              className="b border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-muted)] text-[10px] tracking-wide cursor-default select-none"
              title="Pinned Dataset: OpenML 52350 (breast-w + 3 noise columns: noise_2, noise_5, noise_20)"
            >
              DATA: OPENML:52350
            </span>
          </div>
        </div>

        {/* RIGHT SECTION: Ready Status, Plan & Run, Terminal, Inspector, Add Source, Theme, More Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* 1. Ready Status */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 border border-emerald-500/25 bg-emerald-500/10 text-emerald-400 select-none mr-1 font-mono text-xs"
            title="Workspace & E2B Execution Status: Ready"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" />
            <span className="font-semibold text-[11px] tracking-wide">Ready</span>
          </div>

          {/* 2. Plan & Run (Primary Hero Action) */}
          <button
            onClick={onOpenApproval}
            className="flex items-center gap-1.5 h-8 px-3 rounded-none bg-[#f97316] text-black font-mono font-bold text-xs hover:bg-[#ea580c] transition shadow-[0_0_15px_rgba(249,115,22,0.35)] active:scale-95"
            title="Review experiment plan and execute reproducible run"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>PLAN & RUN</span>
          </button>

          {/* 3. Terminal (Icon-only) */}
          <button
            onClick={onToggleConsole}
            className="w-8 h-8 rounded-none border border-[var(--border-primary)] bg-transparent text-[var(--text-muted)] hover:text-[#f97316] hover:border-[#f97316]/50 flex items-center justify-center transition"
            title="Terminal"
            aria-label="Terminal"
          >
            <Terminal className="h-4 w-4" />
          </button>

          {/* 4. Inspector (Icon-only) */}
          {onToggleInspector && (
            <button
              onClick={onToggleInspector}
              className={`w-8 h-8 rounded-none border flex items-center justify-center transition ${isInspectorOpen
                ? 'border-[#f97316] text-[#f97316] bg-[#f97316]/10'
                : 'border-[var(--border-primary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)]'
                }`}
              title="Inspector"
              aria-label="Inspector"
            >
              <PanelRight className="h-4 w-4" />
            </button>
          )}

          {/* 5. Add Source (Icon-only) */}
          {onAddSource && (
            <button
              onClick={onAddSource}
              className="w-8 h-8 rounded-none border border-[var(--border-primary)] bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)] flex items-center justify-center transition"
              title="Add source"
              aria-label="Add source"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}

          {/* 6. Theme Switcher (Icon-only) */}
          <button
            onClick={toggleTheme}
            className="w-8 h-8 rounded-none border border-[var(--border-primary)] bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)] flex items-center justify-center transition"
            title="Switch theme"
            aria-label="Switch theme"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          {/* 7. More Actions (Three-dot overflow menu) */}
          <div className="relative" ref={moreMenuRef}>
            <button
              onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
              className={`w-8 h-8 rounded-none border flex items-center justify-center transition ${isMoreMenuOpen
                ? 'border-[var(--border-secondary)] text-[var(--text-primary)] bg-[var(--bg-surface-hover)]'
                : 'border-[var(--border-primary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)]'
                }`}
              title="More actions"
              aria-label="More actions"
            >
              <MoreVertical className="h-4 w-4" />
            </button>

            {/* Overflow Dropdown Menu */}
            {isMoreMenuOpen && (
              <div className="absolute right-0 top-10 z-50 w-52 bg-[var(--bg-surface-elevated)] border border-[var(--border-primary)] p-1.5 shadow-2xl backdrop-blur-2xl animate-fade-in text-xs font-mono space-y-1">
                <button
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onOpenExport();
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] transition"
                  title="Export Workspace artifacts"
                >
                  <Download className="h-3.5 w-3.5 text-[#f97316]" />
                  <span>Export Workspace...</span>
                </button>
                <button
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onOpenApproval();
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] transition"
                  title="Review experiment specification"
                >
                  <Sparkles className="h-3.5 w-3.5 text-sky-400" />
                  <span>Review Experiment Plan</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
