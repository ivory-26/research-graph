import React from 'react';
import type { WorkspaceEdge, WorkspaceNode } from '../../data/demoWorkspace';
import { NODE_CATEGORY_THEMES } from '../canvas/MemoryNode';
import {
  Check,
  X as XIcon,
  ArrowRight,
  ArrowLeft,
  FileText,
  Target,
  Cpu,
  Database,
  Play,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  Layers,
} from 'lucide-react';

interface EvidencePanelProps {
  edge?: WorkspaceEdge | null;
  node?: WorkspaceNode | null;
  allNodes?: WorkspaceNode[];
  allEdges?: WorkspaceEdge[];
  onSelectNode?: (nodeId: string) => void;
  onSelectEdge?: (edgeId: string) => void;
  onUpdateStatus?: (edgeId: string, newStatus: 'accepted' | 'rejected') => void;
  onClose?: () => void;
}

export const EvidencePanel: React.FC<EvidencePanelProps> = ({
  edge,
  node,
  allNodes = [],
  allEdges = [],
  onSelectNode,
  onSelectEdge,
  onUpdateStatus,
  onClose,
}) => {
  const datasetNode = allNodes.find((n) => n.type === 'dataset');

  // If neither node nor edge is provided, render the Workspace & Variables Inspector
  if (!node && !edge) {
    return (
      <aside className="w-[360px] flex-shrink-0 border-l border-[var(--border-primary)] bg-[var(--bg-primary)] p-5 flex flex-col gap-4 text-[var(--text-secondary)] overflow-y-auto animate-fade-in select-text">
        <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-[#f97316]" />
            <div className="l font-mono text-xs">WORKSPACE & VARIABLES</div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-sm font-bold text-[var(--text-dim)] hover:text-[var(--text-primary)] transition px-1"
              title="Close inspector"
            >
              ×
            </button>
          )}
        </div>

        {/* Workspace State Badges */}
        <div className="flex items-center gap-2">
          <span className="badge-orange-outline text-[10px]">MODE: ADAPTED</span>
          <span className="b border-[var(--border-primary)] bg-[var(--bg-surface-hover)] text-[var(--text-muted)] text-[10px]">
            DATA: OPENML:52350
          </span>
        </div>

        {/* Active Research Variables Summary */}
        <div className="c p-3 bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none space-y-2.5 font-mono">
          <div className="text-[10px] uppercase font-bold text-[var(--text-primary)] tracking-wider border-b border-[var(--border-primary)] pb-1">
            Active Dataset & Variables
          </div>

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[var(--text-dim)]">Dataset:</span>
            <span className="text-[var(--text-primary)] font-bold">{datasetNode?.data?.name || datasetNode?.title || 'breast-w'}</span>
          </div>

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[var(--text-dim)]">OpenML ID:</span>
            <span className="text-sky-600 dark:text-sky-400 font-bold">{(datasetNode?.data?.openmlId as string) || '52350'}</span>
          </div>

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[var(--text-dim)]">Dimensions:</span>
            <span className="text-[var(--text-primary)]">
              {datasetNode?.data?.rows ? `${datasetNode.data.rows} rows × ${datasetNode.data.features || 9} features` : '569 rows × 9 features'}
            </span>
          </div>

          <div className="border-t border-[var(--border-primary)] pt-2 space-y-1.5">
            <div className="text-[10px] text-[#f97316] uppercase font-bold">
              Injected Noise Variables:
            </div>
            <div className="grid grid-cols-1 gap-1 text-[10px] text-[var(--text-muted)]">
              <div className="flex justify-between bg-[var(--bg-surface-hover)] p-1 border border-[var(--border-primary)]">
                <code className="text-pink-600 dark:text-pink-400 font-bold">noise_2</code>
                <span>2 levels (binary)</span>
              </div>
              <div className="flex justify-between bg-[var(--bg-surface-hover)] p-1 border border-[var(--border-primary)]">
                <code className="text-pink-600 dark:text-pink-400 font-bold">noise_5</code>
                <span>5 levels (moderate)</span>
              </div>
              <div className="flex justify-between bg-[var(--bg-surface-hover)] p-1 border border-[var(--border-primary)]">
                <code className="text-pink-600 dark:text-pink-400 font-bold">noise_20</code>
                <span className="text-amber-600 dark:text-amber-400 font-bold">20 levels (high bias)</span>
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--border-primary)] pt-2 space-y-1">
            <div className="text-[10px] text-[var(--text-dim)] uppercase">Tested Importance Methods:</div>
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="px-1.5 py-0.5 border border-violet-500/40 text-violet-600 dark:text-violet-400 font-bold bg-violet-500/10">
                Gini (MDI)
              </span>
              <span className="text-[var(--text-dim)]">vs</span>
              <span className="px-1.5 py-0.5 border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-500/10">
                Permutation
              </span>
            </div>
          </div>
        </div>

        {/* Quick Entity Navigation */}
        {allNodes.length > 0 && (
          <div className="space-y-1.5 font-mono">
            <div className="l text-[10px]">GRAPH NODES ({allNodes.length})</div>
            <div className="flex flex-col gap-1 max-h-56 overflow-y-auto pr-1">
              {allNodes.map((n) => {
                const nTheme = NODE_CATEGORY_THEMES[n.type] || NODE_CATEGORY_THEMES.source;
                return (
                  <button
                    key={n.id}
                    onClick={() => onSelectNode?.(n.id)}
                    className="p-1.5 border border-[var(--border-primary)] bg-[var(--bg-surface)] hover:border-[var(--border-secondary)] hover:bg-[var(--bg-surface-hover)] transition text-left flex items-center justify-between text-[11px]"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: nTheme.color }} />
                      <span className="text-[var(--text-primary)] truncate max-w-[210px]">{n.title}</span>
                    </div>
                    <span className="text-[9px] uppercase font-bold text-[var(--text-dim)] ml-2">
                      {n.type}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </aside>
    );
  }

  // SCENARIO 1: NODE INSPECTOR (Requirement 6)
  if (node) {
    const nodeType = node.type || 'source';
    const theme = NODE_CATEGORY_THEMES[nodeType] || NODE_CATEGORY_THEMES.source;

    // Incoming & Outgoing edges for this node
    const incomingEdges = allEdges.filter((e) => e.target === node.id);
    const outgoingEdges = allEdges.filter((e) => e.source === node.id);
    const totalConnections = incomingEdges.length + outgoingEdges.length;

    // Resolve neighbor nodes
    const connectedNeighborIds = Array.from(
      new Set([
        ...incomingEdges.map((e) => e.source),
        ...outgoingEdges.map((e) => e.target),
      ])
    );
    const neighborNodes = allNodes.filter((n) => connectedNeighborIds.includes(n.id));

    // Type icon
    const getIcon = () => {
      switch (nodeType) {
        case 'source':
          return <FileText className="h-4 w-4" style={{ color: theme.color }} />;
        case 'claim':
          return <Target className="h-4 w-4" style={{ color: theme.color }} />;
        case 'method':
          return <Cpu className="h-4 w-4" style={{ color: theme.color }} />;
        case 'dataset':
          return <Database className="h-4 w-4" style={{ color: theme.color }} />;
        case 'run':
          return <Play className="h-4 w-4 fill-current" style={{ color: theme.color }} />;
        case 'result':
          return <CheckCircle2 className="h-4 w-4" style={{ color: theme.color }} />;
        default:
          return <Layers className="h-4 w-4" style={{ color: theme.color }} />;
      }
    };

    return (
      <aside className="w-[360px] flex-shrink-0 border-l border-[var(--border-primary)] bg-[var(--bg-primary)] p-5 flex flex-col gap-4 text-[var(--text-secondary)] overflow-y-auto animate-fade-in select-text">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-3">
          <div className="flex items-center gap-2">
            {getIcon()}
            <div className="l font-mono text-xs">ENTITY INSPECTOR</div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="text-[9px] font-mono px-2 py-0.5 border font-bold uppercase rounded-none"
              style={{
                borderColor: theme.color,
                color: theme.color,
                backgroundColor: theme.ring,
              }}
            >
              {theme.name}
            </span>
            {onClose && (
              <button
                onClick={onClose}
                className="text-sm font-bold text-[var(--text-dim)] hover:text-[var(--text-primary)] transition px-1"
                title="Close inspector"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Node Title */}
        <div>
          <h3 className="text-sm font-bold text-[var(--text-primary)] font-mono leading-snug">
            {node.title}
          </h3>
          <div className="text-[10px] text-[var(--text-dim)] font-mono mt-1 flex items-center gap-2">
            <span>ID: {node.id}</span>
            <span>·</span>
            <span>{totalConnections} edges</span>
          </div>
        </div>

        {/* Description / Summary / Details */}
        <div className="c p-3 bg-[var(--card-bg)] border border-[var(--border-primary)] rounded-none space-y-2">
          {node.data?.text && (
            <div className="text-[12px] leading-relaxed text-[var(--text-primary)] font-mono">
              {node.data.text}
            </div>
          )}
          {node.data?.summary && (
            <div className="text-[11px] leading-relaxed text-[var(--text-secondary)] font-mono">
              {node.data.summary}
            </div>
          )}
          {node.data?.doi && (
            <div className="flex items-center justify-between text-[10px] font-mono border-t border-[var(--border-primary)] pt-2 mt-2">
              <span className="text-[var(--text-dim)]">DOI:</span>
              <a
                href={node.data.url || `https://doi.org/${node.data.doi}`}
                target="_blank"
                rel="noreferrer"
                className="text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 font-bold"
              >
                <span>{node.data.doi}</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          {node.data?.sha256 && (
            <div className="flex items-center justify-between text-[10px] font-mono border-t border-[var(--border-primary)] pt-2">
              <span className="text-[var(--text-dim)] flex items-center gap-1">
                <ShieldCheck className="h-3 w-3 text-[#f97316]" />
                <span>SHA-256:</span>
              </span>
              <span className="text-[var(--text-primary)] truncate max-w-[180px]">
                {String(node.data.sha256).slice(0, 16)}...
              </span>
            </div>
          )}
          {node.data?.library && (
            <div className="flex items-center justify-between text-[10px] font-mono border-t border-[var(--border-primary)] pt-2">
              <span className="text-[var(--text-dim)]">Library:</span>
              <span className="text-violet-600 dark:text-violet-400 font-bold">{node.data.library}</span>
            </div>
          )}
          {(node.data?.verdict || node.data?.isPreview) && (
            <div className="flex items-center justify-between text-[10px] font-mono border-t border-[var(--border-primary)] pt-2">
              <span className="text-[var(--text-dim)]">Status:</span>
              <span className="badge-solid-white rounded-none uppercase">{node.data.verdict || 'PREVIEW'}</span>
            </div>
          )}

          {/* Dataset Variables */}
          {node.data?.rows && (
            <div className="border-t border-[var(--border-primary)] pt-2 space-y-1 font-mono text-[10px]">
              <div className="flex justify-between">
                <span className="text-[var(--text-dim)]">Dataset:</span>
                <span className="text-[var(--text-primary)] font-bold">{node.data.name || node.title}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-dim)]">Dimensions:</span>
                <span className="text-pink-600 dark:text-pink-400 font-bold">{node.data.rows} rows × {node.data.features || 9} features</span>
              </div>
              {node.data.noiseColumns && (
                <div className="flex justify-between">
                  <span className="text-[var(--text-dim)]">Noise Variables:</span>
                  <span className="text-amber-600 dark:text-amber-400 font-mono font-bold">{node.data.noiseColumns}</span>
                </div>
              )}
            </div>
          )}

          {/* Run Variables / Parameters */}
          {node.data?.parameter && (
            <div className="border-t border-[var(--border-primary)] pt-2 space-y-1 font-mono text-[10px]">
              <div className="flex justify-between">
                <span className="text-[var(--text-dim)]">Importance Method:</span>
                <span className="text-amber-600 dark:text-amber-400 font-bold uppercase">{node.data.parameter.importance_method}</span>
              </div>
              {node.data.singleParamDiff && (
                <div className="text-[10px] text-[#f97316] bg-[#f97316]/10 p-1 border border-[#f97316]/30">
                  {node.data.singleParamDiff}
                </div>
              )}
              {node.data.durationMs && node.data.sandboxId && (
                <div className="flex justify-between text-[10px]">
                  <span className="text-[var(--text-dim)]">Sandbox Execution:</span>
                  <span className="text-[var(--text-primary)] font-mono">{node.data.durationMs}ms ({node.data.sandboxId})</span>
                </div>
              )}
            </div>
          )}

          {/* Result Metrics Variables */}
          {node.data?.metrics && (
            <div className="border-t border-[var(--border-primary)] pt-2 space-y-1.5 font-mono text-[10px]">
              <div className="text-[10px] text-[var(--text-primary)] uppercase font-bold">Target Variables (Spec):</div>
              {Object.entries(node.data.metrics).map(([k, v]) => (
                <div key={k} className="flex justify-between bg-[var(--bg-surface-hover)] p-1 border border-[var(--border-primary)]">
                  <span className="text-[var(--text-dim)] font-mono">{k}:</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">{String(v)}</span>
                </div>
              ))}
              {node.data.criteria && (
                <div className="flex justify-between text-[10px] text-[var(--text-secondary)] border-t border-[var(--border-primary)] pt-1">
                  <span>Criteria:</span>
                  <code className="text-emerald-600 dark:text-emerald-400 font-bold">{node.data.criteria}</code>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Incoming Relationships */}
        {incomingEdges.length > 0 && (
          <div className="space-y-1.5">
            <div className="l flex items-center gap-1">
              <ArrowLeft className="h-3 w-3 text-sky-600 dark:text-sky-400" />
              <span>INCOMING RELATIONSHIPS ({incomingEdges.length})</span>
            </div>
            <div className="space-y-1">
              {incomingEdges.map((e) => {
                const srcNode = allNodes.find((n) => n.id === e.source);
                return (
                  <div
                    key={e.id}
                    onClick={() => onSelectEdge?.(e.id)}
                    className="p-2 border border-[var(--border-primary)] bg-[var(--bg-surface)] hover:border-[var(--border-secondary)] hover:bg-[var(--bg-surface-hover)] cursor-pointer transition flex items-center justify-between text-xs font-mono"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="text-[9px] uppercase font-bold text-[#f97316]">
                        {e.relation}
                      </span>
                      <span className="text-[var(--text-dim)]">from</span>
                      <span className="text-[var(--text-primary)] truncate max-w-[140px]">
                        {srcNode?.title || e.source}
                      </span>
                    </div>
                    {e.confidence && (
                      <span className="text-[9px] text-[var(--text-dim)] ml-2">
                        {Math.round(e.confidence * 100)}%
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Outgoing Relationships */}
        {outgoingEdges.length > 0 && (
          <div className="space-y-1.5">
            <div className="l flex items-center gap-1">
              <ArrowRight className="h-3 w-3 text-[#f97316]" />
              <span>OUTGOING RELATIONSHIPS ({outgoingEdges.length})</span>
            </div>
            <div className="space-y-1">
              {outgoingEdges.map((e) => {
                const tgtNode = allNodes.find((n) => n.id === e.target);
                return (
                  <div
                    key={e.id}
                    onClick={() => onSelectEdge?.(e.id)}
                    className="p-2 border border-[var(--border-primary)] bg-[var(--bg-surface)] hover:border-[var(--border-secondary)] hover:bg-[var(--bg-surface-hover)] cursor-pointer transition flex items-center justify-between text-xs font-mono"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="text-[9px] uppercase font-bold text-emerald-600 dark:text-emerald-400">
                        {e.relation}
                      </span>
                      <span className="text-[var(--text-dim)]">to</span>
                      <span className="text-[var(--text-primary)] truncate max-w-[140px]">
                        {tgtNode?.title || e.target}
                      </span>
                    </div>
                    {e.confidence && (
                      <span className="text-[9px] text-[var(--text-dim)] ml-2">
                        {Math.round(e.confidence * 100)}%
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Connected Knowledge Entities */}
        {neighborNodes.length > 0 && (
          <div className="space-y-1.5">
            <div className="l">CONNECTED NODES ({neighborNodes.length})</div>
            <div className="flex flex-wrap gap-1">
              {neighborNodes.map((nbr) => {
                const nbrTheme = NODE_CATEGORY_THEMES[nbr.type] || NODE_CATEGORY_THEMES.source;
                return (
                  <button
                    key={nbr.id}
                    onClick={() => onSelectNode?.(nbr.id)}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono border border-[var(--border-primary)] bg-[var(--bg-surface)] hover:border-[var(--border-secondary)] hover:text-[var(--text-primary)] transition"
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: nbrTheme.color }}
                    />
                    <span className="truncate max-w-[120px]">{nbr.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </aside>
    );
  }

  // SCENARIO 2: EDGE EVIDENCE INSPECTOR (Original behavior preserved)
  const relation = edge?.relation || 'supports';
  const status = edge?.status || 'accepted';
  const confidence = edge?.confidence ? `conf ${edge.confidence.toFixed(2)}` : null;
  const quote = edge?.quote;
  const page = edge?.page;
  const chunkNumber = edge?.chunkNumber;
  const charStart = edge?.charStart;
  const charEnd = edge?.charEnd;
  const sourceName = edge?.sourceTitle || 'Source';
  const targetName = edge?.targetTitle || 'Target';
  const rationale = edge?.rationale || 'Graph edge relationship.';

  const isAccepted = status === 'accepted';
  const isRejected = status === 'rejected';

  return (
    <aside className="w-[360px] flex-shrink-0 border-l border-[var(--border-primary)] bg-[var(--bg-primary)] p-5 flex flex-col gap-4 text-[var(--text-secondary)] overflow-y-auto animate-fade-in select-text">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-3">
        <div className="l font-mono text-xs">CITATION & EVIDENCE INSPECTOR</div>
        <div className="flex items-center gap-2">
          <span className="badge-solid-white rounded-none uppercase">{status || 'STRUCTURAL'}</span>
          {onClose && (
            <button
              onClick={onClose}
              className="text-sm font-bold text-[var(--text-dim)] hover:text-[var(--text-primary)] transition px-1"
              title="Close inspector"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Badges with Sharp Corners */}
      <div className="flex gap-2 flex-wrap">
        <span className="badge-orange-outline rounded-none">{relation}</span>
        <span
          className={`b rounded-none ${isAccepted
            ? 'border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold'
            : isRejected
              ? 'border-red-500/50 bg-red-500/10 text-red-500'
              : 'border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-dim)]'
            }`}
        >
          {status}
        </span>
        {confidence && (
          <span className="b rounded-none border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-dim)]">
            {confidence}
          </span>
        )}
      </div>

      {/* From → To */}
      <div className="text-[13px] leading-snug font-mono">
        <span className="text-[var(--text-primary)] font-semibold">{sourceName}</span>{' '}
        <span className="text-[var(--text-dim)]">→</span>{' '}
        <span className="text-[var(--text-primary)] font-semibold">{targetName}</span>
      </div>

      {/* Verbatim Cited Quote Card with Sharp Corners */}
      {quote ? (
        <div className="c p-4 border-l-[3px] !border-l-[#f97316] !rounded-none bg-[var(--card-bg)] border border-[var(--border-primary)]">
          <div className="text-[13px] leading-relaxed text-[var(--text-primary)] font-serif italic">
            &ldquo;{quote}&rdquo;
          </div>
          {page !== undefined && (
            <div className="m text-[10px] text-[var(--text-dim)] mt-3 border-t border-[var(--border-primary)] pt-2">
              PAGE {page}{chunkNumber !== undefined ? ` · CHUNK #${chunkNumber}` : ''}{charStart !== undefined ? ` · CHARS ${charStart}–${charEnd}` : ''}
            </div>
          )}
        </div>
      ) : (
        <div className="c p-4 !rounded-none bg-[var(--card-bg)] border border-[var(--border-primary)] text-xs text-[var(--text-dim)] font-mono">
          Structural relation without direct text quotation.
        </div>
      )}

      {/* Rationale */}
      <div className="l">AUDIT RATIONALE</div>
      <div className="text-[12px] leading-relaxed text-[var(--text-muted)] font-mono">
        {rationale}
      </div>

      {/* Accept / Reject actions with Sharp Corners */}
      {edge && (
        <div className="flex gap-2 mt-auto pt-4">
          <button
            onClick={() => onUpdateStatus?.(edge.id, 'accepted')}
            className={`flex-1 h-9 rounded-none font-mono uppercase text-xs font-bold transition flex items-center justify-center gap-1.5 ${isAccepted
              ? 'bg-[#f97316] text-black shadow-[0_0_15px_rgba(249,115,22,0.3)]'
              : 'bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-90'
              }`}
          >
            <Check className="h-3.5 w-3.5" />
            <span>Accept</span>
          </button>
          <button
            onClick={() => onUpdateStatus?.(edge.id, 'rejected')}
            className={`flex-1 h-9 rounded-none font-mono uppercase text-xs transition border flex items-center justify-center gap-1.5 ${isRejected
              ? 'bg-[var(--bg-surface)] text-red-500 border-red-500'
              : 'bg-[var(--bg-surface)] text-[var(--text-dim)] border-[var(--border-primary)] hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)]'
              }`}
          >
            <XIcon className="h-3.5 w-3.5" />
            <span>Reject</span>
          </button>
        </div>
      )}
    </aside>
  );
};
