import React from 'react';
import { X, Terminal } from 'lucide-react';

interface ConsoleDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  logs: string[];
}

export const ConsoleDrawer: React.FC<ConsoleDrawerProps> = ({
  isOpen,
  onClose,
  logs,
}) => {
  if (!isOpen) return null;

  return (
    <div className="border-t border-[var(--border-primary)] h-[180px] bg-[#090b0d] p-3 overflow-y-auto flex-none font-mono text-xs select-text animate-fade-in z-20">
      <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-2 mb-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-[#f97316]" />
          <strong className="text-[var(--text-primary)] tracking-wide">
            EXECUTION CONSOLE
          </strong>
        </div>
        <button
          onClick={onClose}
          className="text-xs text-[var(--text-dim)] hover:text-[var(--text-primary)] transition flex items-center gap-1"
        >
          <span>Collapse</span>
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="space-y-1 text-[11px] leading-relaxed text-[#9ca5af]">
        {logs.map((line, i) => {
          const isError = line.includes('ERR') || line.includes('fail');
          const isSuccess = line.includes('MATCH') || line.includes('PASS') || line.includes('complete');
          const isWarn = line.includes('awaiting') || line.includes('DEMO');

          return (
            <div key={i} className="flex gap-2 items-start">
              <span className="text-[var(--text-dim)] select-none">›</span>
              <span
                className={
                  isError
                    ? 'text-red-400 font-semibold'
                    : isSuccess
                    ? 'text-emerald-400 font-semibold'
                    : isWarn
                    ? 'text-[#f97316]'
                    : ''
                }
              >
                {line}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};