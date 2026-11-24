import React, { useState } from 'react';
import {
  SlidersHorizontal,
  RotateCcw,
  Sparkles,
  Eye,
  Maximize2,
  Lock,
  Unlock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

export interface MemoryGraphSettings {
  repulsion: number;
  linkDistance: number;
  nodeSize: number;
  linkThickness: number;
  labelVisibility: 'selective' | 'always' | 'off';
  clusterHighlighting: boolean;
}

interface MemoryGraphToolbarProps {
  activeFilter: string;
  onFilterChange: (filter: string) => void;
  settings: MemoryGraphSettings;
  onSettingsChange: (settings: MemoryGraphSettings) => void;
  onResetLayout: () => void;
  onFitView: () => void;
  isLocked: boolean;
  onToggleLock: () => void;
  onAnimateLayout: () => void;
  nodeCounts: {
    all: number;
    source: number;
    claim: number;
    method: number;
    dataset: number;
    run: number;
    result: number;
  };
}

export const MemoryGraphToolbar: React.FC<MemoryGraphToolbarProps> = ({
  activeFilter,
  onFilterChange,
  settings,
  onSettingsChange,
  onResetLayout,
  onFitView,
  isLocked,
  onToggleLock,
  onAnimateLayout,
  nodeCounts,
}) => {
  const [isPhysicsOpen, setIsPhysicsOpen] = useState(false);

  const filters = [
    { id: 'all', label: 'All', color: 'var(--text-primary)', count: nodeCounts.all },
    { id: 'sources', label: 'Sources', color: '#38bdf8', count: nodeCounts.source },
    { id: 'claims', label: 'Claims', color: '#f97316', count: nodeCounts.claim },
    { id: 'methods', label: 'Methods', color: '#a855f7', count: nodeCounts.method },
    { id: 'datasets', label: 'Datasets', color: '#ec4899', count: nodeCounts.dataset },
    { id: 'runs', label: 'Runs', color: '#f59e0b', count: nodeCounts.run },
    { id: 'results', label: 'Results', color: '#10b981', count: nodeCounts.result },
  ];

  return (
    <div className="relative flex flex-col gap-1.5 pointer-events-auto select-none">
      {/* Top Bar: Category Filter Pills & Quick Actions */}
      <div className="flex items-center gap-1.5 flex-wrap rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] p-1 shadow-2xl backdrop-blur-xl">
        {/* Category Pills */}
        <div className="flex items-center gap-0.5">
          {filters.map((f) => {
            const isActive = activeFilter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => onFilterChange(f.id)}
                className={`flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded-none transition ${
                  isActive
                    ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
                }`}
              >
                {f.id !== 'all' && (
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: f.color }}
                  />
                )}
                <span>{f.label}</span>
                <span className="text-[8px] opacity-70">({f.count})</span>
              </button>
            );
          })}
        </div>

        <div className="h-4 w-[1px] bg-[var(--border-primary)] mx-0.5" />

        {/* Physics Controls Toggle */}
        <button
          onClick={() => setIsPhysicsOpen(!isPhysicsOpen)}
          className={`flex items-center gap-1 px-2 py-1 text-[10px] font-mono border transition ${
            isPhysicsOpen
              ? 'border-[#f97316] text-[#f97316] bg-[#f97316]/10'
              : 'border-[var(--border-primary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
          title="Adjust Force Simulation Physics"
        >
          <SlidersHorizontal className="h-3 w-3" />
          <span className="hidden sm:inline">Physics</span>
          {isPhysicsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        {/* Re-simulate / Animate */}
        <button
          onClick={onAnimateLayout}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono border border-[var(--border-primary)] text-[var(--text-muted)] hover:text-[#f97316] hover:border-[#f97316]/50 transition"
          title="Animate Force Relaxation"
        >
          <Sparkles className="h-3 w-3 text-[#f97316]" />
          <span className="hidden sm:inline">Relax</span>
        </button>

        {/* Reset Layout */}
        <button
          onClick={onResetLayout}
          className="p-1 border border-[var(--border-primary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"
          title="Reset to Force-Directed Layout"
        >
          <RotateCcw className="h-3 w-3" />
        </button>

        {/* Lock / Unlock */}
        <button
          onClick={onToggleLock}
          className={`p-1 border border-[var(--border-primary)] transition ${
            isLocked ? 'text-[#f97316] border-[#f97316]/60' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
          title={isLocked ? 'Unlock canvas navigation' : 'Lock canvas navigation'}
        >
          {isLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
        </button>

        {/* Fit View */}
        <button
          onClick={onFitView}
          className="p-1 border border-[var(--border-primary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"
          title="Fit view to graph"
        >
          <Maximize2 className="h-3 w-3" />
        </button>
      </div>

      {/* Expandable Physics & Memory Exploration Drawer */}
      {isPhysicsOpen && (
        <div className="rounded-none border border-[var(--border-primary)] bg-[var(--bg-surface)] p-3 shadow-2xl backdrop-blur-2xl animate-fade-in w-72 space-y-3 font-mono text-[10px]">
          <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-1.5">
            <span className="font-bold text-[var(--text-primary)] uppercase tracking-wider">
              Force Engine Tuning
            </span>
            <span className="text-[9px] text-[var(--text-dim)]">Organic Dynamics</span>
          </div>

          {/* Repulsion Slider */}
          <div className="space-y-1">
            <div className="flex justify-between text-[var(--text-secondary)]">
              <span>Node Repulsion</span>
              <span className="text-[var(--text-primary)]">{settings.repulsion}</span>
            </div>
            <input
              type="range"
              min="800"
              max="4500"
              step="100"
              value={settings.repulsion}
              onChange={(e) =>
                onSettingsChange({ ...settings, repulsion: Number(e.target.value) })
              }
              className="w-full h-1 bg-[var(--bg-surface-hover)] appearance-none cursor-pointer accent-[#f97316]"
            />
          </div>

          {/* Link Distance Slider */}
          <div className="space-y-1">
            <div className="flex justify-between text-[var(--text-secondary)]">
              <span>Link Distance</span>
              <span className="text-[var(--text-primary)]">{settings.linkDistance}px</span>
            </div>
            <input
              type="range"
              min="80"
              max="280"
              step="10"
              value={settings.linkDistance}
              onChange={(e) =>
                onSettingsChange({ ...settings, linkDistance: Number(e.target.value) })
              }
              className="w-full h-1 bg-[var(--bg-surface-hover)] appearance-none cursor-pointer accent-[#f97316]"
            />
          </div>

          {/* Node Size Scale Slider */}
          <div className="space-y-1">
            <div className="flex justify-between text-[var(--text-secondary)]">
              <span>Node Scale</span>
              <span className="text-[var(--text-primary)]">{settings.nodeSize.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.7"
              max="1.6"
              step="0.1"
              value={settings.nodeSize}
              onChange={(e) =>
                onSettingsChange({ ...settings, nodeSize: Number(e.target.value) })
              }
              className="w-full h-1 bg-[var(--bg-surface-hover)] appearance-none cursor-pointer accent-[#f97316]"
            />
          </div>

          {/* Link Thickness Slider */}
          <div className="space-y-1">
            <div className="flex justify-between text-[var(--text-secondary)]">
              <span>Link Thickness</span>
              <span className="text-[var(--text-primary)]">{settings.linkThickness}px</span>
            </div>
            <input
              type="range"
              min="1"
              max="4"
              step="0.5"
              value={settings.linkThickness}
              onChange={(e) =>
                onSettingsChange({ ...settings, linkThickness: Number(e.target.value) })
              }
              className="w-full h-1 bg-[var(--bg-surface-hover)] appearance-none cursor-pointer accent-[#f97316]"
            />
          </div>

          {/* Label Visibility Switcher */}
          <div className="space-y-1 pt-1 border-t border-[var(--border-primary)]">
            <div className="flex items-center justify-between text-[var(--text-secondary)] mb-1">
              <span className="flex items-center gap-1">
                <Eye className="h-3 w-3" />
                <span>Labels</span>
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {(['selective', 'always', 'off'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => onSettingsChange({ ...settings, labelVisibility: mode })}
                  className={`py-1 text-center capitalize transition border ${
                    settings.labelVisibility === mode
                      ? 'border-[#f97316] bg-[#f97316]/15 text-[#f97316] font-bold'
                      : 'border-[var(--border-primary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {mode === 'selective' ? 'Hubs/Hover' : mode}
                </button>
              ))}
            </div>
          </div>

          {/* Cluster Highlighting Glow Toggle */}
          <div className="flex items-center justify-between pt-1 border-t border-[var(--border-primary)]">
            <span className="text-[var(--text-secondary)]">Cluster Glow</span>
            <button
              onClick={() =>
                onSettingsChange({
                  ...settings,
                  clusterHighlighting: !settings.clusterHighlighting,
                })
              }
              className={`px-2 py-0.5 border text-[9px] transition ${
                settings.clusterHighlighting
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 font-bold'
                  : 'border-[var(--border-primary)] text-[var(--text-dim)]'
              }`}
            >
              {settings.clusterHighlighting ? 'ENABLED' : 'DISABLED'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
