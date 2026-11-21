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
    <header className="flex min-h-[64px] w-full flex-wrap items-center gap-6 border-b border-[#252C36] bg-[#0E1116] px-6 text-[#E6EAF0] z-30 select-none">
      {/* Brand */}
      <div
        className="flex items-center gap-2.5 font-semibold text-base cursor-pointer"
        onClick={() => onSelectTab('graph')}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#3DD6B5"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M12 2l9 5v10l-9 5-9-5V7z" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
        <span>ResearchGraph</span>
      </div>

      {/* Navigation View Tabs */}
      <nav className="flex flex-1 flex-wrap items-center gap-1">
        <button
          onClick={() => onSelectTab('graph')}
          className={`h-9 px-4 rounded-lg font-medium text-[13px] transition ${
            activeTab === 'graph'
              ? 'bg-[#252C36] text-[#E6EAF0]'
              : 'bg-transparent text-[#9AA4B2] hover:text-[#E6EAF0]'
          }`}
        >
          Graph
        </button>

        <button
          onClick={() => onSelectTab('sources')}
          className={`h-9 px-4 rounded-lg font-medium text-[13px] transition ${
            activeTab === 'sources'
              ? 'bg-[#252C36] text-[#E6EAF0]'
              : 'bg-transparent text-[#9AA4B2] hover:text-[#E6EAF0]'
          }`}
        >
          Sources
        </button>

        <button
          onClick={() => onSelectTab('ask')}
          className={`h-9 px-4 rounded-lg font-medium text-[13px] transition ${
            activeTab === 'ask'
              ? 'bg-[#252C36] text-[#E6EAF0]'
              : 'bg-transparent text-[#9AA4B2] hover:text-[#E6EAF0]'
          }`}
        >
          Ask
        </button>

        <button
          onClick={() => onSelectTab('runs')}
          className={`h-9 px-4 rounded-lg font-medium text-[13px] transition ${
            activeTab === 'runs'
              ? 'bg-[#252C36] text-[#E6EAF0]'
              : 'bg-transparent text-[#9AA4B2] hover:text-[#E6EAF0]'
          }`}
        >
          Runs
        </button>

        <button
          onClick={() => onSelectTab('dashboard')}
          className={`h-9 px-4 rounded-lg font-medium text-[13px] transition ${
            activeTab === 'dashboard'
              ? 'bg-[#252C36] text-[#E6EAF0]'
              : 'bg-transparent text-[#9AA4B2] hover:text-[#E6EAF0]'
          }`}
        >
          Dashboard
        </button>
      </nav>

      {/* Status Badges & Quick Triggers */}
      <div className="flex items-center gap-3">
        <span className="b text-[#F5A524] border-[#F5A524]/40 bg-[#F5A524]/10">
          mode: adapted
        </span>
        <span className="b text-[#9AA4B2] border-[#252C36]">
          mock data
        </span>

        {/* Plan & Run */}
        <button
          onClick={onOpenApproval}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#3DD6B5] text-[#0E1116] font-semibold text-xs hover:bg-[#34c4a4] transition"
          title="Review code and approve isolated E2B sandbox run"
        >
          <Play className="h-3 w-3 fill-current" />
          <span>Plan &amp; Run</span>
        </button>

        {/* Colab Notebook Export */}
        <button
          onClick={onOpenExport}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#252C36] bg-[#161B22] text-[#E6EAF0] text-xs font-medium hover:border-[#3A4452] transition"
          title="Export self-contained Jupyter notebook for Google Colab"
        >
          <BookOpen className="h-3.5 w-3.5 text-[#F5A524]" />
          <span>Colab</span>
        </button>

        {/* Sandbox Stream Logs Trigger */}
        <button
          onClick={onToggleLogs}
          className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-[#252C36] bg-[#161B22] text-[#9AA4B2] text-xs hover:text-[#E6EAF0] transition"
          title="Toggle E2B Sandbox logs"
        >
          <Terminal className="h-3.5 w-3.5 text-[#3DD6B5]" />
          {logCount > 0 && (
            <span className="font-mono text-[10px] text-[#3DD6B5] font-bold">
              {logCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
};
