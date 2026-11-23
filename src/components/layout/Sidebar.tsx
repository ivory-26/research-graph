import React from 'react';
import {
  LayoutGrid,
  Network,
  FileText,
  Sparkles,
  Cpu,
  FlaskConical,
  GitCompare,
  BarChart3,
  Settings,
  ChevronDown,
} from 'lucide-react';

export type PageId =
  | 'overview'
  | 'graph'
  | 'sources'
  | 'ask'
  | 'agents'
  | 'experiments'
  | 'compare'
  | 'strategies'
  | 'settings';

interface SidebarProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  onNavigate,
  isCollapsed,
}) => {
  return (
    <aside
      className={`border-r border-[var(--border-primary)] bg-[var(--bg-surface)] flex flex-col min-h-0 overflow-hidden transition-all duration-200 select-none ${
        isCollapsed ? 'w-[68px]' : 'w-[244px]'
      }`}
    >
      <div className="p-3 overflow-y-auto flex-1 space-y-4">
        {/* Workspace Switcher */}
        <div
          className={`flex items-center gap-2.5 p-2.5 border border-[var(--border-primary)] bg-[var(--bg-primary)] cursor-pointer hover:border-[var(--border-secondary)] transition ${
            isCollapsed ? 'justify-center p-2' : ''
          }`}
          title="Switch workspace"
        >
          <div className="w-7 h-7 flex items-center justify-center bg-[#f97316]/10 text-[#f97316] border border-[#f97316]/40 flex-shrink-0 font-mono text-sm">
            ⬡
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-[var(--text-primary)] truncate font-mono">
                Random Forest Study
              </div>
              <div className="text-[10px] text-[var(--text-dim)] truncate mt-0.5">
                3 sources · Updated now
              </div>
            </div>
          )}
          {!isCollapsed && (
            <ChevronDown className="h-3.5 w-3.5 text-[var(--text-dim)] flex-shrink-0" />
          )}
        </div>

        {/* WORKSPACE GROUP */}
        <div>
          {!isCollapsed && (
            <div className="px-2.5 pb-1.5 font-mono text-[9px] uppercase tracking-wider text-[var(--text-dim)]">
              WORKSPACE
            </div>
          )}
          <div className="space-y-0.5">
            <button
              onClick={() => onNavigate('overview')}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-mono transition text-left ${
                currentPage === 'overview'
                  ? 'bg-[#f97316]/15 text-[#f97316] border-l-2 border-[#f97316] font-bold'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
              } ${isCollapsed ? 'justify-center px-0' : ''}`}
              title="Overview"
            >
              <LayoutGrid className="h-4 w-4 flex-shrink-0" />
              {!isCollapsed && <span className="flex-1 truncate">Overview</span>}
            </button>

            <button
              onClick={() => onNavigate('graph')}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-mono transition text-left ${
                currentPage === 'graph'
                  ? 'bg-[#f97316]/15 text-[#f97316] border-l-2 border-[#f97316] font-bold'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
              } ${isCollapsed ? 'justify-center px-0' : ''}`}
              title="Research Graph"
            >
              <Network className="h-4 w-4 flex-shrink-0" />
              {!isCollapsed && <span className="flex-1 truncate">Research Graph</span>}
              {!isCollapsed && (
                <span className="text-[9px] font-mono px-1 bg-[var(--bg-surface-hover)] text-[var(--text-dim)]">
                  8
                </span>
              )}
            </button>

            <button
              onClick={() => onNavigate('sources')}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-mono transition text-left ${
                currentPage === 'sources'
                  ? 'bg-[#f97316]/15 text-[#f97316] border-l-2 border-[#f97316] font-bold'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
              } ${isCollapsed ? 'justify-center px-0' : ''}`}
              title="Sources"
            >
              <FileText className="h-4 w-4 flex-shrink-0" />
              {!isCollapsed && <span className="flex-1 truncate">Sources</span>}
              {!isCollapsed && (
                <span className="text-[9px] font-mono px-1 bg-[var(--bg-surface-hover)] text-[var(--text-dim)]">
                  3
                </span>
              )}
            </button>

            <button
              onClick={() => onNavigate('ask')}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-mono transition text-left ${
                currentPage === 'ask'
                  ? 'bg-[#f97316]/15 text-[#f97316] border-l-2 border-[#f97316] font-bold'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
              } ${isCollapsed ? 'justify-center px-0' : ''}`}
              title="Ask Research"
            >
              <Sparkles className="h-4 w-4 flex-shrink-0 text-[var(--accent-orange)]" />
              {!isCollapsed && <span className="flex-1 truncate">Ask Research</span>}
            </button>
          </div>
        </div>

        {/* EXPERIMENTS GROUP */}
        <div>
          {!isCollapsed && (
            <div className="px-2.5 pb-1.5 font-mono text-[9px] uppercase tracking-wider text-[var(--text-dim)]">
              EXPERIMENTS
            </div>
          )}
          <div className="space-y-0.5">
            <button
              onClick={() => onNavigate('agents')}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-mono transition text-left ${
                currentPage === 'agents'
                  ? 'bg-[#f97316]/15 text-[#f97316] border-l-2 border-[#f97316] font-bold'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
              } ${isCollapsed ? 'justify-center px-0' : ''}`}
              title="Agent Monitor"
            >
              <Cpu className="h-4 w-4 flex-shrink-0" />
              {!isCollapsed && <span className="flex-1 truncate">Agent Monitor</span>}
              {!isCollapsed && (
                <span className="text-[9px] font-mono px-1 bg-[var(--bg-surface-hover)] text-[var(--text-dim)]">
                  2
                </span>
              )}
            </button>

            <button
              onClick={() => onNavigate('experiments')}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-mono transition text-left ${
                currentPage === 'experiments'
                  ? 'bg-[#f97316]/15 text-[#f97316] border-l-2 border-[#f97316] font-bold'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
              } ${isCollapsed ? 'justify-center px-0' : ''}`}
              title="Experiments"
            >
              <FlaskConical className="h-4 w-4 flex-shrink-0" />
              {!isCollapsed && <span className="flex-1 truncate">Experiments</span>}
            </button>

            <button
              onClick={() => onNavigate('compare')}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-mono transition text-left ${
                currentPage === 'compare'
                  ? 'bg-[#f97316]/15 text-[#f97316] border-l-2 border-[#f97316] font-bold'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
              } ${isCollapsed ? 'justify-center px-0' : ''}`}
              title="Run Comparison"
            >
              <GitCompare className="h-4 w-4 flex-shrink-0" />
              {!isCollapsed && <span className="flex-1 truncate">Run Comparison</span>}
            </button>
          </div>
        </div>

        {/* ANALYTICS GROUP */}
        <div>
          {!isCollapsed && (
            <div className="px-2.5 pb-1.5 font-mono text-[9px] uppercase tracking-wider text-[var(--text-dim)]">
              ANALYTICS
            </div>
          )}
          <div className="space-y-0.5">
            <button
              onClick={() => onNavigate('strategies')}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-mono transition text-left ${
                currentPage === 'strategies'
                  ? 'bg-[#f97316]/15 text-[#f97316] border-l-2 border-[#f97316] font-bold'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
              } ${isCollapsed ? 'justify-center px-0' : ''}`}
              title="Strategies"
            >
              <BarChart3 className="h-4 w-4 flex-shrink-0" />
              {!isCollapsed && <span className="flex-1 truncate">Strategies</span>}
            </button>
          </div>
        </div>

        {/* SYSTEM GROUP */}
        <div>
          {!isCollapsed && (
            <div className="px-2.5 pb-1.5 font-mono text-[9px] uppercase tracking-wider text-[var(--text-dim)]">
              SYSTEM
            </div>
          )}
          <div className="space-y-0.5">
            <button
              onClick={() => onNavigate('settings')}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-mono transition text-left ${
                currentPage === 'settings'
                  ? 'bg-[#f97316]/15 text-[#f97316] border-l-2 border-[#f97316] font-bold'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
              } ${isCollapsed ? 'justify-center px-0' : ''}`}
              title="Preferences"
            >
              <Settings className="h-4 w-4 flex-shrink-0" />
              {!isCollapsed && <span className="flex-1 truncate">Preferences</span>}
            </button>
          </div>
        </div>
      </div>

      {/* Sidebar Footer: Profile */}
      <div className="p-3 border-t border-[var(--border-primary)] bg-[var(--bg-primary)]">
        <div className={`flex items-center gap-2.5 ${isCollapsed ? 'justify-center' : ''}`}>
          <div className="w-7 h-7 rounded-full bg-[#34404a] text-white flex items-center justify-center font-bold text-xs flex-shrink-0 font-mono">
            SP
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                Researcher
              </div>
              <div className="text-[10px] text-[var(--text-dim)] truncate">
                Workspace owner
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};