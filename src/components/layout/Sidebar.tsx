import React, { useState } from 'react';
import rawWorkspace from '../../../fixtures/workspace.json';
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
  ExternalLink,
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
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

interface NavItem {
  id: PageId;
  label: string;
  icon: React.FC<{ className?: string }>;
  badge?: string;
  category: 'workspace' | 'experiments' | 'analytics' | 'system';
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  onNavigate,
}) => {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const totalNodesCount = rawWorkspace.nodes.length;
  const sourceNodesCount = rawWorkspace.nodes.filter((n) => n.type === 'source').length;

  const navItems: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: LayoutGrid, category: 'workspace' },
    { id: 'graph', label: 'Research Graph', icon: Network, badge: String(totalNodesCount), category: 'workspace' },
    { id: 'sources', label: 'Sources', icon: FileText, badge: String(sourceNodesCount), category: 'workspace' },
    { id: 'ask', label: 'Ask Research', icon: Sparkles, category: 'workspace' },
    { id: 'agents', label: 'Agent Monitor', icon: Cpu, category: 'experiments' },
    { id: 'experiments', label: 'Experiments', icon: FlaskConical, category: 'experiments' },
    { id: 'compare', label: 'Run Comparison', icon: GitCompare, category: 'experiments' },
    { id: 'strategies', label: 'Strategies', icon: BarChart3, category: 'analytics' },
  ];

  return (
    <aside className="w-[58px] flex-none h-full flex flex-col items-center justify-between py-3 select-none bg-transparent transition-colors duration-200 z-20">
      {/* TOP: ResearchGraph Logo & Ambient Workspace Trigger */}
      <div className="flex flex-col items-center gap-2 relative">
        <button
          onClick={() => onNavigate('graph')}
          onMouseEnter={() => setHoveredItem('logo')}
          onMouseLeave={() => setHoveredItem(null)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-[#f97316] hover:bg-[var(--bg-surface-hover)] transition-all duration-200 group"
          title="ResearchGraph Digital Twin"
        >
          <span className="font-mono text-xl font-bold tracking-tighter transform group-hover:scale-110 transition-transform">
            ⬡
          </span>
        </button>

        {/* Hover Tooltip for Logo */}
        {hoveredItem === 'logo' && (
          <div className="absolute left-14 top-1 z-50 pointer-events-none whitespace-nowrap animate-fade-in">
            <div className="px-2.5 py-1 text-[11px] font-mono bg-[var(--bg-surface-elevated)] border border-[var(--border-primary)] text-[var(--text-primary)] shadow-2xl backdrop-blur-xl">
              <span className="text-[#f97316] font-bold">ResearchGraph</span> · Digital Twin
            </div>
          </div>
        )}
      </div>

      {/* MIDDLE: Primary Ambient Navigation Icons */}
      <div className="flex flex-col items-center gap-1.5 my-auto w-full">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;
          const isHovered = hoveredItem === item.id;

          return (
            <div key={item.id} className="relative flex items-center justify-center w-full">
              {/* Active Indicator (Restrained 3px vertical pill) */}
              {isActive && (
                <div className="absolute left-0 w-[3px] h-4 bg-[#f97316] rounded-r-full shadow-[0_0_8px_rgba(249,115,22,0.8)]" />
              )}

              {/* Navigation Icon Button */}
              <button
                onClick={() => onNavigate(item.id)}
                onMouseEnter={() => setHoveredItem(item.id)}
                onMouseLeave={() => setHoveredItem(null)}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 relative group ${
                  isActive
                    ? 'text-[#f97316]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
                }`}
                aria-label={item.label}
              >
                <Icon className="w-5 h-5 transition-transform duration-150 group-hover:scale-105" />

                {/* Subtle Count Pip if Badge Exists */}
                {item.badge && !isActive && (
                  <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-[var(--border-secondary)] group-hover:bg-[var(--text-muted)]" />
                )}
              </button>

              {/* Ambient Hover Tooltip */}
              {isHovered && (
                <div className="absolute left-14 z-50 pointer-events-none whitespace-nowrap animate-fade-in">
                  <div className="flex items-center gap-2 px-2.5 py-1 text-xs font-mono bg-[var(--bg-surface-elevated)] border border-[var(--border-primary)] text-[var(--text-primary)] shadow-2xl backdrop-blur-xl">
                    <span className={isActive ? 'text-[#f97316] font-bold' : 'font-medium'}>
                      {item.label}
                    </span>
                    {item.badge && (
                      <span className="text-[9px] px-1 py-0.2 bg-[var(--bg-surface-hover)] text-[var(--text-dim)]">
                        {item.badge}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* BOTTOM: Preferences */}
      <div className="flex flex-col items-center gap-2 relative">
        {/* Settings */}
        <div className="relative flex items-center justify-center w-full">
          {currentPage === 'settings' && (
            <div className="absolute left-0 w-[3px] h-4 bg-[#f97316] rounded-r-full shadow-[0_0_8px_rgba(249,115,22,0.8)]" />
          )}
          <button
            onClick={() => onNavigate('settings')}
            onMouseEnter={() => setHoveredItem('settings')}
            onMouseLeave={() => setHoveredItem(null)}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 group ${
              currentPage === 'settings'
                ? 'text-[#f97316]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
            }`}
            title="Preferences"
          >
            <Settings className="w-5 h-5 transition-transform duration-150 group-hover:rotate-45" />
          </button>

          {hoveredItem === 'settings' && (
            <div className="absolute left-14 z-50 pointer-events-none whitespace-nowrap animate-fade-in">
              <div className="px-2.5 py-1 text-xs font-mono bg-[var(--bg-surface-elevated)] border border-[var(--border-primary)] text-[var(--text-primary)] shadow-2xl backdrop-blur-xl">
                Preferences
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
