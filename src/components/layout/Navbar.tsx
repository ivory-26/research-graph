import React, { useState, useRef, useEffect } from 'react';
import rawWorkspace from '../../../fixtures/workspace.json';
import {
  Play,
  Terminal,
  PanelRight,
  Sun,
  Moon,
  MoreHorizontal,
  Download,
  ChevronDown,
  LogOut,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

interface WorkspaceOption {
  id: string;
  name: string;
  subtitle: string;
}

interface NavbarProps {
  currentWorkspace?: string;
  activeWorkspaceId?: string;
  workspaces?: WorkspaceOption[];
  onSelectWorkspace?: (workspaceId: string) => void;
  showInspectorToggle?: boolean;
  isInspectorOpen?: boolean;
  onToggleInspector?: () => void;
  onOpenApproval: () => void;
  onOpenExport: () => void;
  onToggleConsole: () => void;
  onSignOut?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentWorkspace = 'Research Graph',
  activeWorkspaceId,
  workspaces,
  onSelectWorkspace,
  showInspectorToggle = false,
  isInspectorOpen = false,
  onToggleInspector,
  onOpenApproval,
  onOpenExport,
  onToggleConsole,
  onSignOut,
}) => {
  const { theme, toggleTheme } = useTheme();
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click or Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsMoreMenuOpen(false);
      }
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(e.target as Node)) {
        setIsWorkspaceMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isMoreMenuOpen) {
          setIsMoreMenuOpen(false);
          moreButtonRef.current?.focus();
        }
        if (isWorkspaceMenuOpen) {
          setIsWorkspaceMenuOpen(false);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMoreMenuOpen, isWorkspaceMenuOpen]);

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(currentIndex + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  useEffect(() => {
    if (isMoreMenuOpen) {
      const firstItem = moreMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
      firstItem?.focus();
    }
  }, [isMoreMenuOpen]);

  const sourceCount = rawWorkspace.nodes.filter((n) => n.type === 'source').length;
  const claimCount = rawWorkspace.nodes.filter((n) => n.type === 'claim').length;

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
              <div className="absolute left-0 top-10 z-50 w-72 bg-[var(--bg-surface-elevated)] border border-[var(--border-primary)] p-2 shadow-2xl backdrop-blur-2xl animate-fade-in text-xs font-mono space-y-1">
                <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-[var(--text-dim)] border-b border-[var(--border-primary)] flex justify-between items-center">
                  <span>Workspaces</span>
                  <span className="text-emerald-400">Switch</span>
                </div>
                {(workspaces && workspaces.length > 0
                  ? workspaces
                  : [
                      {
                        id: 'research-graph',
                        name: currentWorkspace,
                        subtitle: `${sourceCount} sources · ${claimCount} claim (fixture)`,
                      },
                    ]
                ).map((ws) => {
                  const isActive = activeWorkspaceId
                    ? ws.id === activeWorkspaceId
                    : ws.name === currentWorkspace || ws.id === currentWorkspace;
                  return (
                    <button
                      key={ws.id}
                      type="button"
                      onClick={() => {
                        onSelectWorkspace?.(ws.id);
                        setIsWorkspaceMenuOpen(false);
                      }}
                      className={`w-full text-left p-2 flex items-center justify-between transition border ${
                        isActive
                          ? 'bg-[var(--bg-surface-hover)] text-[var(--text-primary)] border-[#f97316]/50'
                          : 'bg-transparent text-[var(--text-secondary)] border-transparent hover:bg-[var(--bg-surface-hover)] hover:border-[var(--border-primary)]'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-bold flex items-center gap-1.5 text-xs truncate">
                          <span>{ws.name}</span>
                        </div>
                        <div className="text-[10px] text-[var(--text-dim)] mt-0.5 truncate">
                          {ws.subtitle}
                        </div>
                      </div>
                      {isActive && (
                        <span className="text-[9px] text-[#f97316] uppercase font-bold shrink-0">Active</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        {/* RIGHT SECTION: Plan & Run + Overflow Menu */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onOpenApproval}
            className="flex items-center gap-1.5 h-9 px-3.5 rounded-[6px] bg-[#f97316] text-black font-medium text-[14px] hover:bg-[#ea580c] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316]"
            title="Review experiment plan and execute reproducible run"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>Plan &amp; Run</span>
          </button>

          {/* Overflow Menu */}
          <div className="relative" ref={moreMenuRef}>
            <button
              ref={moreButtonRef}
              type="button"
              onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
              aria-expanded={isMoreMenuOpen}
              aria-haspopup="menu"
              aria-label="More actions"
              className={`w-9 h-9 rounded-[6px] border flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] ${isMoreMenuOpen
                ? 'border-[var(--border-secondary)] text-[var(--text-primary)] bg-[var(--bg-surface-hover)]'
                : 'border-[var(--border-primary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)]'
                }`}
              title="More actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>

            {isMoreMenuOpen && (
              <div
                role="menu"
                onKeyDown={handleMenuKeyDown}
                className="absolute right-0 top-11 z-50 w-52 rounded-[10px] bg-[var(--bg-surface-elevated)] border border-[var(--border-primary)] p-1.5 shadow-xl space-y-0.5 text-[14px]"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onToggleConsole();
                  }}
                  className="w-full flex items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-left text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316]"
                >
                  <Terminal className="h-4 w-4 text-[var(--text-muted)]" />
                  <span>Terminal</span>
                </button>

                {showInspectorToggle && onToggleInspector && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      onToggleInspector();
                    }}
                    className="w-full flex items-center justify-between rounded-[6px] px-2.5 py-2 text-left text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316]"
                  >
                    <span className="flex items-center gap-2.5">
                      <PanelRight className="h-4 w-4 text-[var(--text-muted)]" />
                      <span>Inspector</span>
                    </span>
                    {isInspectorOpen && (
                      <span className="text-xs text-[var(--text-muted)]">On</span>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onOpenExport();
                  }}
                  className="w-full flex items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-left text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316]"
                >
                  <Download className="h-4 w-4 text-[var(--text-muted)]" />
                  <span>Export workspace…</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    toggleTheme();
                  }}
                  className="w-full flex items-center justify-between rounded-[6px] px-2.5 py-2 text-left text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316]"
                >
                  <span className="flex items-center gap-2.5">
                    {theme === 'dark' ? (
                      <Moon className="h-4 w-4 text-[var(--text-muted)]" />
                    ) : (
                      <Sun className="h-4 w-4 text-[var(--text-muted)]" />
                    )}
                    <span>Theme</span>
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {theme === 'dark' ? 'Dark' : 'Light'}
                  </span>
                </button>

                {onSignOut && (
                  <>
                    <div
                      role="separator"
                      className="my-1 border-t border-[var(--border-primary)]"
                    />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        onSignOut();
                      }}
                      className="w-full flex items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-left text-red-400 hover:bg-[var(--bg-surface-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316]"
                    >
                      <LogOut className="h-4 w-4" />
                      <span>Sign out</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
