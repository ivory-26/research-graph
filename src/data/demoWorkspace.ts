import rawWorkspace from '../../fixtures/workspace.json';
import { HERO_EXPERIMENT_SPEC_RUN_A } from '../../fixtures/hero-spec';
import { parseWorkspaceFixture } from './workspace-fixture';
import type {
  StrategyStat,
  WorkspaceEdge,
  WorkspaceNode,
  WorkspaceSource,
} from './workspace-fixture';
import type {
  EdgeRelation,
  EdgeStatus,
  GraphEdge,
  GraphNode,
  NodeType,
  RunMode,
  RunStatus,
  Verdict,
  VerdictDetail,
} from '../shared/types';

export type { NodeType, EdgeRelation, EdgeStatus, RunMode, RunStatus, Verdict, VerdictDetail };
export type {
  WorkspaceEdge,
  WorkspaceNode,
  WorkspaceNodeData,
  WorkspaceSource,
  SourceChunk,
  StrategyStat,
  WorkspaceFixture,
} from './workspace-fixture';

export const PINNED_IMAGE_PACKAGES: Record<string, string> = {
  numpy: '2.5.5',
  pandas: '2.3.3',
  'scikit-learn': '1.9.1',
  scipy: '1.17.1',
  matplotlib: '3.10.0',
};

/**
 * The offline demo workspace, parsed once from `fixtures/workspace.json`.
 *
 * `parseWorkspaceFixture` validates every node as a `GraphNode`, every edge as
 * a `GraphEdge`, and the provenance rules that tie quotes to checked-in chunks.
 * A bad fixture fails here rather than rendering as if it were measured data.
 */
const fixture = parseWorkspaceFixture(rawWorkspace);

export const DEMO_WORKSPACE = fixture.workspace;
export const DEMO_SOURCES: WorkspaceSource[] = fixture.sources;
export const DEMO_CHUNKS = fixture.chunks;
export const DEMO_STRATEGIES: StrategyStat[] = fixture.strategies;

/** Validated contract rows, without the presentation-only adapter fields. */
export const DEMO_GRAPH_NODES: GraphNode[] = fixture.nodes;
export const DEMO_GRAPH_EDGES: GraphEdge[] = fixture.edges;

/**
 * The canvas/panel shape: the same validated rows plus `position` and React
 * Flow's `source` / `target` endpoint names. This adapter exists so the fixture
 * can use the frozen `GraphNode` / `GraphEdge` names while the existing DOM
 * keeps reading `source` / `target`.
 */
export const DEMO_NODES: WorkspaceNode[] = fixture.nodes;
export const DEMO_EDGES: WorkspaceEdge[] = fixture.edges.map((edge) => ({
  ...edge,
  source: edge.sourceNodeId,
  target: edge.targetNodeId,
}));

const demoSourceCount = DEMO_NODES.filter((node) => node.type === 'source').length;
const demoClaimCount = DEMO_NODES.filter((node) => node.type === 'claim').length;
export const DEMO_WORKSPACE_SUBTITLE = [
  `${demoSourceCount} ${demoSourceCount === 1 ? 'source' : 'sources'}`,
  `${demoClaimCount} ${demoClaimCount === 1 ? 'claim' : 'claims'}`,
  `${DEMO_WORKSPACE.dataset} (fixture)`,
].join(' · ');

export const HERO_PYTHON_SCRIPT = HERO_EXPERIMENT_SPEC_RUN_A.files['main.py'];
