import React from 'react';
import {
  Network,
  UploadCloud,
  Search,
  Play,
  GitBranch,
  BarChart3,
  BookOpen,
  CheckCircle2,
} from 'lucide-react';

interface NavbarProps {
  onOpenIngest: () => void;
  onOpenAsk: () => void;
  onOpenApproval: () => void;
  onOpenCompare: () => void;
  onOpenDashboard: () => void;
  onOpenExport: () => void;
  currentBeat: number;
}

const BEATS = [
  { id: 1, name: 'Collect' },
  { id: 2, name: 'Organise' },
  { id: 3, name: 'Understand' },
  { id: 4, name: 'Experiment' },
  { id: 5, name: 'Learn' },
  { id: 6, name: 'Share' },
];

export const Navbar: React.FC<NavbarProps> = ({
  onOpenIngest,
  onOpenAsk,
  onOpenApproval,
  onOpenCompare,
  onOpenDashboard,
  onOpenExport,
  currentBeat,
}) => {
  return (
    <header className="flex h-16 w-full items-center justify-between border-b border-slate-800 bg-slate-900 px-5 text-slate-100 z-30 select-none">
      {/* Brand & Workspace */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-500 shadow-lg shadow-cyan-500/20">
            <Network className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-extrabold tracking-tight text-white">
                ResearchGraph
              </span>
              <span className="rounded-md bg-cyan-950 px-1.5 py-0.5 text-[9px] font-bold text-cyan-400 border border-cyan-800/40">
                AUDITABLE ML
              </span>
            </div>
            <div className="text-[10px] text-slate-400">
              Workspace: <span className="font-semibold text-slate-200">strobl-2007-gini-bias</span>
            </div>
          </div>
        </div>

        {/* 6 Beat Pipeline Tracker */}
        <div className="hidden lg:flex items-center gap-1 border-l border-slate-800 pl-4">
          {BEATS.map((beat) => {
            const isDone = beat.id <= currentBeat;
            const isCurrent = beat.id === currentBeat;
            return (
              <div
                key={beat.id}
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                  isCurrent
                    ? 'bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40'
                    : isDone
                    ? 'text-emerald-400'
                    : 'text-slate-500'
                }`}
              >
                {isDone && <CheckCircle2 className="h-2.5 w-2.5" />}
                <span>{beat.id}. {beat.name}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenIngest}
          className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700/80 hover:text-white transition"
          title="Collect PDF sources or scrape project pages"
        >
          <UploadCloud className="h-3.5 w-3.5 text-blue-400" />
          <span className="hidden sm:inline">Collect Sources</span>
        </button>

        <button
          onClick={onOpenAsk}
          className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700/80 hover:text-white transition"
          title="Vector similarity query across papers"
        >
          <Search className="h-3.5 w-3.5 text-cyan-400" />
          <span className="hidden sm:inline">Ask Across Sources</span>
        </button>

        <button
          onClick={onOpenApproval}
          className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-600 to-amber-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:from-amber-500 hover:to-amber-400 transition"
          title="Review script and approve execution"
        >
          <Play className="h-3.5 w-3.5 fill-current" />
          <span>Plan &amp; Run</span>
        </button>

        <button
          onClick={onOpenCompare}
          className="flex items-center gap-1.5 rounded-lg border border-purple-800/60 bg-purple-950/40 px-3 py-1.5 text-xs font-semibold text-purple-300 hover:bg-purple-900/50 transition"
          title="Compare Run A and Run B (What-If)"
        >
          <GitBranch className="h-3.5 w-3.5 text-purple-400" />
          <span className="hidden md:inline">What-If Delta</span>
        </button>

        <button
          onClick={onOpenDashboard}
          className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700/80 hover:text-white transition"
          title="Strategy scores and costs"
        >
          <BarChart3 className="h-3.5 w-3.5 text-emerald-400" />
          <span className="hidden xl:inline">Strategies</span>
        </button>

        <button
          onClick={onOpenExport}
          className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700/80 hover:text-white transition"
          title="Export Jupyter Notebook for Colab"
        >
          <BookOpen className="h-3.5 w-3.5 text-orange-400" />
          <span className="hidden sm:inline">Export</span>
        </button>
      </div>
    </header>
  );
};
