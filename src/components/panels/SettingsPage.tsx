import React, { useState } from 'react';
import { Sun, Moon, Save } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

interface SettingsPageProps {
  onShowToast: (msg: string) => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ onShowToast }) => {
  const { theme, toggleTheme } = useTheme();
  const [workspaceName, setWorkspaceName] = useState('Random Forest Study');
  const [mode, setMode] = useState('Adapted');
  const [dataset, setDataset] = useState('OpenML:52350');

  const handleSave = () => {
    onShowToast('Preferences saved successfully');
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto animate-fade-in font-mono">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Appearance Settings */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
          <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
            Appearance
          </div>

          <div className="space-y-3 pt-1 text-xs">
            <div className="flex justify-between items-center border-b border-[var(--border-primary)] pb-3">
              <div>
                <div className="text-[var(--text-primary)] font-semibold">Color theme</div>
                <div className="text-[10px] text-[var(--text-dim)]">Obsidian Dark / Crisp Slate Light</div>
              </div>
              <button
                onClick={toggleTheme}
                className="px-3 py-1.5 border border-[var(--border-primary)] bg-[var(--bg-surface)] hover:text-[#f97316] transition flex items-center gap-1.5"
              >
                {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
              </button>
            </div>

            <div className="flex justify-between items-center border-b border-[var(--border-primary)] pb-3">
              <div>
                <div className="text-[var(--text-primary)] font-semibold">Graph node style</div>
                <div className="text-[10px] text-[var(--text-dim)]">Switchable on canvas toolbar</div>
              </div>
              <strong className="text-[var(--text-primary)]">Sharp cards / Circles</strong>
            </div>

            <div className="flex justify-between items-center border-b border-[var(--border-primary)] pb-3">
              <div>
                <div className="text-[var(--text-primary)] font-semibold">Default inspector</div>
                <div className="text-[10px] text-[var(--text-dim)]">Auto-open on edge select</div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">OPEN</span>
            </div>

            <div className="flex justify-between items-center">
              <div>
                <div className="text-[var(--text-primary)] font-semibold">Motion & animations</div>
                <div className="text-[10px] text-[var(--text-dim)]">GPU accelerated particle flow</div>
              </div>
              <strong className="text-emerald-400">OPTIMIZED</strong>
            </div>
          </div>
        </div>

        {/* Workspace Preferences */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
          <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
            Workspace preferences
          </div>

          <div className="space-y-3 pt-1 text-xs">
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] uppercase mb-1">
                WORKSPACE NAME
              </label>
              <input
                type="text"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] p-2 text-xs text-[var(--text-primary)] outline-none focus:border-[#f97316]"
              />
            </div>

            <div>
              <label className="block text-[10px] text-[var(--text-dim)] uppercase mb-1">
                DEFAULT REPRODUCTION MODE
              </label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] p-2 text-xs text-[var(--text-primary)] outline-none focus:border-[#f97316]"
              >
                <option value="Adapted">Adapted</option>
                <option value="Exact">Exact</option>
                <option value="Conceptual">Conceptual</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] text-[var(--text-dim)] uppercase mb-1">
                DEFAULT DATASET
              </label>
              <input
                type="text"
                value={dataset}
                onChange={(e) => setDataset(e.target.value)}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] p-2 text-xs text-[var(--text-primary)] outline-none focus:border-[#f97316]"
              />
            </div>

            <button
              onClick={handleSave}
              className="w-full mt-2 py-2 bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] transition flex items-center justify-center gap-1.5"
            >
              <Save className="h-3.5 w-3.5" />
              <span>Save preferences</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};