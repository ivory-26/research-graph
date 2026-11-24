import React from 'react';
import { DEMO_STRATEGIES } from '../../data/demoWorkspace';

export const AgentMonitorPage: React.FC = () => {
  const totalTasks = DEMO_STRATEGIES.reduce((sum, s) => sum + s.attempts, 0);
  const medianLatency = DEMO_STRATEGIES.length > 0
    ? (DEMO_STRATEGIES.reduce((sum, s) => sum + s.avgLatencyMs, 0) / DEMO_STRATEGIES.length / 1000).toFixed(1)
    : '0.0';

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto animate-fade-in font-mono">
      {/* 3 KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
            PIPELINE STATUS
          </div>
          <div className="text-2xl font-extrabold text-emerald-400 my-2">
            IDLE
          </div>
          <div className="text-[11px] text-[var(--text-dim)]">
            No active execution
          </div>
        </div>

        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
            AGENT TASKS
          </div>
          <div className="text-2xl font-extrabold text-[var(--text-primary)] my-2">
            {totalTasks}
          </div>
          <div className="text-[11px] text-[var(--text-dim)]">
            Recorded attempts in demo fixture
          </div>
        </div>

        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
            AVG LATENCY
          </div>
          <div className="text-2xl font-extrabold text-[#f97316] my-2">
            {medianLatency}s
          </div>
          <div className="text-[11px] text-[var(--text-dim)]">
            Average task latency
          </div>
        </div>
      </div>

      {/* Grid 2: Research Pipeline Timeline & Selected Task Details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Research Pipeline Stages */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
          <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
            Research pipeline
          </div>
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-3">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <div>
                  <div className="text-xs text-[var(--text-primary)] font-semibold">
                    Source ingestion agent
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] font-sans">
                    Extract and normalize PDF content with unpdf
                  </div>
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">READY</span>
            </div>

            <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-3">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <div>
                  <div className="text-xs text-[var(--text-primary)] font-semibold">
                    Claim extraction agent
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] font-sans">
                    Identify testable empirical research claims
                  </div>
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">READY</span>
            </div>

            <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-3">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <div>
                  <div className="text-xs text-[var(--text-primary)] font-semibold">
                    Evidence validation agent
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] font-sans">
                    Verify verbatim quotes and chunk anchors
                  </div>
                </div>
              </div>
              <span className="badge-solid-white !text-[8px] rounded-none">READY</span>
            </div>

            <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-3">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-[#f97316] shadow-[0_0_8px_#f97316]" />
                <div>
                  <div className="text-xs text-[var(--text-primary)] font-semibold">
                    Experiment planner
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] font-sans">
                    Generate an experiment specification
                  </div>
                </div>
              </div>
              <span className="badge-orange-outline !text-[8px] rounded-none">WAITING</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-zinc-600" />
                <div>
                  <div className="text-xs text-[var(--text-muted)] font-semibold">
                    Sandbox runner
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] font-sans">
                    Execute approved Python script in E2B
                  </div>
                </div>
              </div>
              <span className="border border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-dim)] text-[8px] px-1.5 py-0.5">
                WAITING
              </span>
            </div>
          </div>
        </div>

        {/* Selected Task Details */}
        <div className="border border-[var(--border-primary)] bg-[var(--card-bg)] p-6 space-y-4">
          <div className="text-xs uppercase font-bold text-[var(--text-primary)] tracking-wide">
            Sample Task Specification · extract_claims
          </div>

          <div className="space-y-1">
            <div className="text-[10px] uppercase text-[var(--text-dim)]">TASK INPUT SPEC</div>
            <pre className="p-3 bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[11px] text-[var(--text-secondary)] font-mono overflow-x-auto leading-relaxed">
{`source_ids: ["src-1"]
strategy: "sectioned"
model: "Gemini 2.0 Flash"
max_attempts: 2`}
            </pre>
          </div>

          <div className="space-y-1">
            <div className="text-[10px] uppercase text-[var(--text-dim)]">TASK OUTPUT SPEC</div>
            <p className="text-xs text-[var(--text-muted)] font-sans leading-relaxed">
              Candidate claim extraction and evidence passage linking. Verbatim quote validation requires 100% exact substring match against chunk anchors (e.g. chunk-1).
            </p>
          </div>

          <div className="pt-2 border-t border-[var(--border-primary)] space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-[var(--text-dim)]">Status:</span>
              <span className="badge-solid-white !text-[8px] rounded-none">READY</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-dim)]">Reproduction Mode:</span>
              <strong className="text-[var(--text-primary)] font-mono">adapted</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};