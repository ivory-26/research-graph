import rawWorkspace from '../../fixtures/workspace.json';
import { HERO_EXPERIMENT_SPEC_RUN_A } from '../../fixtures/hero-spec';
import type {
  NodeType,
  EdgeRelation,
  EdgeStatus,
  RunMode,
  RunStatus,
  Verdict,
  VerdictDetail,
  NodeData,
} from '../shared/types';

export type { NodeType, EdgeRelation, EdgeStatus, RunMode, RunStatus, Verdict, VerdictDetail };

export const PINNED_IMAGE_PACKAGES: Record<string, string> = {
  numpy: '2.5.5',
  pandas: '2.3.3',
  'scikit-learn': '1.9.1',
  scipy: '1.17.1',
  matplotlib: '3.10.0',
};

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

export type WorkspaceNodeData = NodeData & {
  title?: string;
  sublabel?: string;
  isPreview?: boolean;
  isHero?: boolean;
  venue?: string;
  doi?: string;
  pages?: number;
  noiseColumns?: string;
  features?: number;
  parameter?: Record<string, any>;
  parentRunId?: string;
  singleParamDiff?: string;
  criteria?: string;
  verdictDetail?: VerdictDetail;
  [key: string]: any;
};

export interface WorkspaceNode {
  id: string;
  type: NodeType;
  title: string;
  position: { x: number; y: number };
  data: WorkspaceNodeData;
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
const demoSourceCount = DEMO_NODES.filter((node) => node.type === 'source').length;
const demoClaimCount = DEMO_NODES.filter((node) => node.type === 'claim').length;
export const DEMO_WORKSPACE_SUBTITLE = [
  `${demoSourceCount} ${demoSourceCount === 1 ? 'source' : 'sources'}`,
  `${demoClaimCount} ${demoClaimCount === 1 ? 'claim' : 'claims'}`,
  `${DEMO_WORKSPACE.dataset} (fixture)`,
].join(' · ');
export const DEMO_EDGES: WorkspaceEdge[] = rawWorkspace.edges as unknown as WorkspaceEdge[];
export const DEMO_STRATEGIES: StrategyStat[] = rawWorkspace.strategies as unknown as StrategyStat[];

export const HERO_PYTHON_SCRIPT = HERO_EXPERIMENT_SPEC_RUN_A.files['main.py'];
