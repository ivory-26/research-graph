import rawWorkspace from '../../fixtures/workspace.json';
import { HERO_EXPERIMENT_SPEC_RUN_A } from '../../fixtures/hero-spec';
import type {
  NodeType,
  EdgeRelation,
  EdgeStatus,
  RunMode,
  RunStatus,
  Verdict,
  NodeData,
} from '../shared/types';

export type { NodeType, EdgeRelation, EdgeStatus, RunMode, RunStatus, Verdict };

export interface SourceChunk {
  id: string;
  sourceId: string;
  sourceTitle: string;
  page: number;
  charStart: number;
  charEnd: number;
  text: string;
}

export interface WorkspaceSource {
  id: string;
  kind: 'paper' | 'web' | 'repo' | 'dataset' | 'note';
  title: string;
  authors: string;
  venue: string;
  year: number;
  url?: string;
  doi?: string;
  sha256: string;
  bytes: number;
  isHero?: boolean;
}

export interface WorkspaceNode {
  id: string;
  type: NodeType;
  title: string;
  position: { x: number; y: number };
  data: NodeData & {
    type: NodeType;
    sublabel?: string;
    title?: string;
    isPreview?: boolean;
    [key: string]: any;
  };
}

export interface WorkspaceEdge {
  id: string;
  source: string;
  target: string;
  relation: EdgeRelation;
  status: EdgeStatus;
  confidence?: number;
  evidenceChunkId?: string;
  evidenceRunId?: string;
  quote?: string;
  page?: number;
  charStart?: number;
  charEnd?: number;
  chunkNumber?: number;
  sourceTitle?: string;
  targetTitle?: string;
  rationale?: string;
}

export interface StrategyStat {
  id: string;
  name: string;
  taskKind: string;
  preferred?: boolean;
  attempts: number;
  successes: number;
  score: number; // (successes + 1) / (attempts + 2)
  avgLatencyMs: number;
  totalCostUsd: number;
  totalTokens: number;
}

// Single source of truth: all demo workspace data is derived directly from fixtures/workspace.json
export const DEMO_WORKSPACE = rawWorkspace.workspace;
export const DEMO_SOURCES: WorkspaceSource[] = rawWorkspace.sources as unknown as WorkspaceSource[];
export const DEMO_CHUNKS: Record<string, SourceChunk> = rawWorkspace.chunks as unknown as Record<string, SourceChunk>;
export const DEMO_NODES: WorkspaceNode[] = rawWorkspace.nodes as unknown as WorkspaceNode[];
export const DEMO_EDGES: WorkspaceEdge[] = rawWorkspace.edges as unknown as WorkspaceEdge[];
export const DEMO_STRATEGIES: StrategyStat[] = rawWorkspace.strategies as unknown as StrategyStat[];

export const HERO_PYTHON_SCRIPT = HERO_EXPERIMENT_SPEC_RUN_A.files['main.py'];
