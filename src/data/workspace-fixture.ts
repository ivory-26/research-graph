import { z } from 'zod';

import type {
  EdgeRelation,
  EdgeStatus,
  GraphEdge,
  GraphNode,
  NodeData,
  NodeType,
  RunMode,
  RunStatus,
  Verdict,
  VerdictDetail,
} from '../shared/types';

/**
 * Runtime contract for `fixtures/workspace.json` (Issue #17).
 *
 * The fixture is the offline demo's only source of graph data, so it is parsed
 * rather than asserted. `GraphNode` / `GraphEdge` required fields are validated
 * here; presentation-only keys (`position`, `sublabel`, edge quote locators)
 * ride along on loose objects instead of being smuggled in by a cast.
 *
 * Cross-references and provenance rules that need the whole document (edge
 * endpoints exist, a claim quote lives in a chunk of its own source, an edge
 * quote is verbatim in its evidence chunk) are enforced in
 * `parseWorkspaceFixture`, which throws on the first violation.
 */

const HEX_SHA256 = /^[0-9a-f]{64}$/;

export const NODE_TYPES = [
  'source',
  'claim',
  'method',
  'dataset',
  'result',
  'run',
  'note',
] as const satisfies readonly NodeType[];

export const EDGE_RELATIONS = [
  'supports',
  'contradicts',
  'cites',
  'uses_dataset',
  'tests',
  'produced',
  'derived_from',
] as const satisfies readonly EdgeRelation[];

export const EDGE_STATUSES = [
  'suggested',
  'accepted',
  'rejected',
] as const satisfies readonly EdgeStatus[];

export const RUN_MODES = [
  'exact',
  'adapted',
  'conceptual',
] as const satisfies readonly RunMode[];

export const RUN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'timeout',
  'cancelled',
] as const satisfies readonly RunStatus[];

export const VERDICTS = [
  'match',
  'mismatch',
  'inconclusive',
  'failed',
] as const satisfies readonly Verdict[];

export const NodeTypeSchema = z.enum(NODE_TYPES);
export const EdgeRelationSchema = z.enum(EDGE_RELATIONS);
export const EdgeStatusSchema = z.enum(EDGE_STATUSES);
export const RunModeSchema = z.enum(RUN_MODES);
export const RunStatusSchema = z.enum(RUN_STATUSES);
export const VerdictSchema = z.enum(VERDICTS);

export const WorkspaceMetaSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  mode: RunModeSchema,
  dataset: z.string().min(1),
  description: z.string().min(1),
});

export const SourceSchema = z.looseObject({
  id: z.string().min(1),
  kind: z.enum(['paper', 'web', 'repo', 'dataset', 'note']),
  title: z.string().min(1),
  authors: z.string().min(1),
  venue: z.string().min(1),
  year: z.number().int(),
  url: z.string().url().optional(),
  doi: z.string().min(1).optional(),
  sha256: z.string().regex(HEX_SHA256, 'sha256 must be 64 lowercase hex characters'),
  bytes: z.number().int().positive(),
  isHero: z.boolean().optional(),
  /** Repository-relative path to the checked-in bytes. */
  file: z.string().min(1).optional(),
  pages: z.number().int().positive().optional(),
});

export const SourceChunkSchema = z
  .looseObject({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    sourceTitle: z.string().min(1),
    page: z.number().int().positive(),
    charStart: z.number().int().nonnegative(),
    charEnd: z.number().int().positive(),
    text: z.string().min(1),
  })
  .superRefine((chunk, ctx) => {
    if (chunk.charEnd <= chunk.charStart) {
      ctx.addIssue({
        code: 'custom',
        path: ['charEnd'],
        message: 'charEnd must be greater than charStart',
      });
    }
    if (chunk.text.length !== chunk.charEnd - chunk.charStart) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: 'text length must equal charEnd - charStart',
      });
    }
  });

export const ReportedValueSchema = z.looseObject({
  metric: z.string().min(1),
  value: z.number().nullable(),
  comparator: z.enum(['gt', 'lt', 'eq']).nullable(),
  against: z.number().nullable(),
  quote: z.string().min(1),
});

const SourceNodeDataSchema = z.looseObject({
  type: z.literal('source'),
  sourceId: z.string().min(1),
  kind: z.string().min(1),
});

const ClaimNodeDataSchema = z.looseObject({
  type: z.literal('claim'),
  text: z.string().min(1),
  reported: ReportedValueSchema.nullable(),
  datasetName: z.string().nullable(),
  methodName: z.string().nullable(),
  locator: z.looseObject({
    page: z.number().int().positive(),
    quote: z.string().min(1),
  }),
});

const MethodNodeDataSchema = z.looseObject({
  type: z.literal('method'),
  summary: z.string().min(1),
  library: z.string().nullable(),
});

const DatasetNodeDataSchema = z.looseObject({
  type: z.literal('dataset'),
  name: z.string().min(1),
  url: z.string().url().nullable(),
  sha256: z.string().regex(HEX_SHA256).nullable(),
  rows: z.number().int().nonnegative().nullable(),
});

const ResultNodeDataSchema = z.looseObject({
  type: z.literal('result'),
  metrics: z.record(z.string(), z.number()),
  runId: z.string().min(1),
  verdict: VerdictSchema.nullable(),
});

const RunNodeDataSchema = z.looseObject({
  type: z.literal('run'),
  runId: z.string().min(1),
  status: RunStatusSchema,
  mode: RunModeSchema,
});

const NoteNodeDataSchema = z.looseObject({
  type: z.literal('note'),
  body: z.string().min(1),
});

export const NodeDataSchema = z.discriminatedUnion('type', [
  SourceNodeDataSchema,
  ClaimNodeDataSchema,
  MethodNodeDataSchema,
  DatasetNodeDataSchema,
  ResultNodeDataSchema,
  RunNodeDataSchema,
  NoteNodeDataSchema,
]);

export const GraphNodeSchema = z
  .looseObject({
    id: z.string().min(1),
    type: NodeTypeSchema,
    title: z.string().min(1),
    data: NodeDataSchema,
    sourceId: z.string().min(1).nullable(),
    /** Presentation-only canvas coordinate; not part of the frozen GraphNode. */
    position: z.looseObject({ x: z.number(), y: z.number() }),
  })
  .superRefine((node, ctx) => {
    if (node.data.type !== node.type) {
      ctx.addIssue({
        code: 'custom',
        path: ['data', 'type'],
        message: `node.type is '${node.type}' but data.type is '${node.data.type}'`,
      });
    }
  });

export const GraphEdgeSchema = z
  .looseObject({
    id: z.string().min(1),
    sourceNodeId: z.string().min(1),
    targetNodeId: z.string().min(1),
    relation: EdgeRelationSchema,
    status: EdgeStatusSchema,
    evidenceChunkId: z.string().min(1).nullable(),
    evidenceRunId: z.string().min(1).nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    /** Presentation copied from the evidence chunk for the inspector. */
    quote: z.string().min(1).max(400).optional(),
    page: z.number().int().positive().optional(),
    charStart: z.number().int().nonnegative().optional(),
    charEnd: z.number().int().positive().optional(),
    chunkNumber: z.number().int().positive().optional(),
    sourceTitle: z.string().min(1).optional(),
    targetTitle: z.string().min(1).optional(),
    rationale: z.string().min(1).max(600),
  })
  .superRefine((edge, ctx) => {
    if (edge.sourceNodeId === edge.targetNodeId) {
      ctx.addIssue({ code: 'custom', path: ['targetNodeId'], message: 'self-loop edge' });
    }
    if (edge.evidenceChunkId === null && edge.evidenceRunId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidenceChunkId'],
        message: 'an edge needs a chunk or a run behind it',
      });
    }
    if (edge.evidenceChunkId !== null && edge.quote === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['quote'],
        message: 'a chunk-evidenced edge needs its verbatim quote',
      });
    }
    if (edge.evidenceChunkId === null && edge.quote !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['quote'],
        message: 'a quote without a chunk id is not evidence',
      });
    }
    if (edge.relation === 'contradicts' && edge.status !== 'suggested') {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'contradicts edges always start as suggested',
      });
    }
    if (edge.confidence !== null && edge.confidence < 0.65 && edge.status !== 'suggested') {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'confidence below 0.65 must land as suggested',
      });
    }
  });

export const StrategyStatSchema = z
  .looseObject({
    id: z.string().min(1),
    name: z.string().min(1),
    taskKind: z.string().min(1),
    preferred: z.boolean().optional(),
    attempts: z.number().int().positive(),
    successes: z.number().int().nonnegative(),
    score: z.number().min(0).max(1),
    avgLatencyMs: z.number().nonnegative(),
    totalCostUsd: z.number().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .superRefine((stat, ctx) => {
    if (stat.successes > stat.attempts) {
      ctx.addIssue({
        code: 'custom',
        path: ['successes'],
        message: 'successes cannot exceed attempts',
      });
    }
    const expected = Math.round(((stat.successes + 1) / (stat.attempts + 2)) * 100) / 100;
    if (Math.abs(stat.score - expected) > 1e-9) {
      ctx.addIssue({
        code: 'custom',
        path: ['score'],
        message: `score ${stat.score} is not the documented ${expected}`,
      });
    }
  });

export const WorkspaceFixtureSchema = z.looseObject({
  workspace: WorkspaceMetaSchema,
  sources: z.array(SourceSchema).min(1),
  chunks: z.record(z.string(), SourceChunkSchema),
  nodes: z.array(GraphNodeSchema).min(1),
  edges: z.array(GraphEdgeSchema),
  strategies: z.array(StrategyStatSchema),
});

export type WorkspaceMeta = z.infer<typeof WorkspaceMetaSchema>;
export type WorkspaceSource = z.infer<typeof SourceSchema> & {
  /** Display-only source metadata the existing panels read. */
  [key: string]: any;
};
export type SourceChunk = z.infer<typeof SourceChunkSchema>;
export type StrategyStat = z.infer<typeof StrategyStatSchema>;

/** UI/display metadata the components read alongside the frozen `NodeData`. */
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
  // The panels read display metadata without narrowing the NodeData union.
  [key: string]: any;
};

/**
 * The canvas/panel shape. `sourceId` is optional so existing component tests
 * and API payloads that predate the top-level field stay assignable; the
 * parsed fixture always supplies it, and `FixtureNode` requires it.
 */
export interface WorkspaceNode {
  id: string;
  type: NodeType;
  title: string;
  data: WorkspaceNodeData;
  position: { x: number; y: number };
  sourceId?: string | null;
}

/** A node that has been parsed against the frozen `GraphNode` contract. */
export interface FixtureNode extends GraphNode {
  data: WorkspaceNodeData;
  position: { x: number; y: number };
}

/** A validated fixture edge, before the UI adapter adds `source` / `target`. */
export interface FixtureEdge extends GraphEdge {
  quote?: string;
  page?: number;
  charStart?: number;
  charEnd?: number;
  chunkNumber?: number;
  sourceTitle?: string;
  targetTitle?: string;
  rationale: string;
}

/**
 * The edge shape the canvas and inspector consume. It stays deliberately
 * looser than `GraphEdge` so `/api/graph` payloads and test fixtures written
 * before the canonical names are still assignable; the parsed fixture and the
 * API both provide the canonical fields as well.
 */
export interface WorkspaceEdge {
  id: string;
  /** React Flow endpoint names. Both mirror `sourceNodeId` / `targetNodeId`. */
  source: string;
  target: string;
  relation: EdgeRelation;
  status: EdgeStatus;
  confidence?: number | null;
  evidenceChunkId?: string | null;
  evidenceRunId?: string | null;
  quote?: string;
  page?: number;
  charStart?: number;
  charEnd?: number;
  chunkNumber?: number;
  sourceTitle?: string;
  targetTitle?: string;
  rationale?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  [key: string]: unknown;
}

export interface WorkspaceFixture {
  workspace: WorkspaceMeta;
  sources: WorkspaceSource[];
  chunks: Record<string, SourceChunk>;
  nodes: FixtureNode[];
  edges: FixtureEdge[];
  strategies: StrategyStat[];
}

export class WorkspaceFixtureError extends Error {
  constructor(message: string) {
    super(`workspace fixture: ${message}`);
    this.name = 'WorkspaceFixtureError';
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new WorkspaceFixtureError(message);
}

/**
 * Parses and cross-checks the offline workspace fixture.
 *
 * Throws a `WorkspaceFixtureError` rather than returning a partially-valid
 * workspace: the demo must never render a node, edge or quote it cannot
 * justify.
 */
export function parseWorkspaceFixture(raw: unknown): WorkspaceFixture {
  const parsed = WorkspaceFixtureSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new WorkspaceFixtureError(`schema validation failed: ${detail}`);
  }

  const fixture = parsed.data;
  const sourceIds = new Set<string>();
  const sourcesById = new Map<string, WorkspaceSource>();
  for (const source of fixture.sources) {
    assert(!sourceIds.has(source.id), `duplicate source id ${source.id}`);
    sourceIds.add(source.id);
    sourcesById.set(source.id, source);
    if (source.kind === 'paper') {
      assert(source.file !== undefined, `paper source ${source.id} is missing its checked-in file`);
    }
  }

  const chunksById = new Map<string, SourceChunk>();
  for (const [key, chunk] of Object.entries(fixture.chunks)) {
    assert(key === chunk.id, `chunk map key ${key} does not match chunk id ${chunk.id}`);
    assert(!chunksById.has(chunk.id), `duplicate chunk id ${chunk.id}`);
    assert(sourcesById.has(chunk.sourceId), `chunk ${chunk.id} names unknown source ${chunk.sourceId}`);
    const source = sourcesById.get(chunk.sourceId);
    assert(
      source === undefined || source.title === chunk.sourceTitle,
      `chunk ${chunk.id} sourceTitle does not match source ${chunk.sourceId}`,
    );
    chunksById.set(chunk.id, chunk);
  }

  const nodesById = new Map<string, FixtureNode>();
  const runIds = new Set<string>();
  for (const node of fixture.nodes) {
    assert(!nodesById.has(node.id), `duplicate node id ${node.id}`);
    nodesById.set(node.id, node);

    if (node.data.type === 'run') {
      assert(node.type === 'run', `node ${node.id} stores run data on a '${node.type}' node`);
      assert(
        node.data.mode === 'adapted',
        `run node ${node.id} must declare the only mode the product produces (adapted)`,
      );
      runIds.add(node.data.runId);
    }

    if (node.sourceId !== null) {
      assert(sourcesById.has(node.sourceId), `node ${node.id} names unknown source ${node.sourceId}`);
    }

    if (node.data.type === 'source') {
      assert(
        node.data.sourceId === node.sourceId,
        `source node ${node.id} sourceId disagrees with its data.sourceId`,
      );
    }

    if (node.data.type === 'claim') {
      assert(node.sourceId !== null, `claim node ${node.id} is missing its source`);
      const locator = node.data.locator;
      const quoteChunk = [...chunksById.values()].find(
        (chunk) =>
          chunk.sourceId === node.sourceId &&
          chunk.page === locator.page &&
          chunk.text.includes(locator.quote),
      );
      assert(
        quoteChunk !== undefined,
        `claim ${node.id} quote is not verbatim in any page ${locator.page} chunk of ${node.sourceId}`,
      );
      const locatorCharStart = (locator as { charStart?: unknown }).charStart;
      const locatorCharEnd = (locator as { charEnd?: unknown }).charEnd;
      if (typeof locatorCharStart === 'number' && typeof locatorCharEnd === 'number') {
        assert(
          locatorCharEnd - locatorCharStart === locator.quote.length,
          `claim ${node.id} locator character span does not match its quote`,
        );
      }
    }

    if (node.data.type === 'result') {
      const runId = node.data.runId;
      assert(
        fixture.nodes.some((n) => n.data.type === 'run' && n.data.runId === runId),
        `result node ${node.id} names unknown run ${runId}`,
      );
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of fixture.edges) {
    assert(!edgeIds.has(edge.id), `duplicate edge id ${edge.id}`);
    edgeIds.add(edge.id);
    assert(nodesById.has(edge.sourceNodeId), `edge ${edge.id} source ${edge.sourceNodeId} is not a node`);
    assert(nodesById.has(edge.targetNodeId), `edge ${edge.id} target ${edge.targetNodeId} is not a node`);

    if (edge.evidenceChunkId !== null) {
      const chunk = chunksById.get(edge.evidenceChunkId);
      assert(chunk !== undefined, `edge ${edge.id} names unknown chunk ${edge.evidenceChunkId}`);
      assert(edge.quote !== undefined, `edge ${edge.id} is missing its quote`);
      assert(
        chunk.text.includes(edge.quote),
        `edge ${edge.id} quote is not verbatim in chunk ${chunk.id}`,
      );
      if (edge.page !== undefined) {
        assert(edge.page === chunk.page, `edge ${edge.id} page does not match chunk ${chunk.id}`);
      }
      if (edge.charStart !== undefined) {
        assert(edge.charStart === chunk.charStart, `edge ${edge.id} charStart does not match chunk ${chunk.id}`);
      }
      if (edge.charEnd !== undefined) {
        assert(edge.charEnd === chunk.charEnd, `edge ${edge.id} charEnd does not match chunk ${chunk.id}`);
      }
      if (edge.chunkNumber !== undefined) {
        assert(
          edge.chunkNumber === Number(chunk.id.replace(/^chunk-/, '')),
          `edge ${edge.id} chunkNumber does not match chunk ${chunk.id}`,
        );
      }
    }

    if (edge.evidenceRunId !== null) {
      assert(runIds.has(edge.evidenceRunId), `edge ${edge.id} names unknown run ${edge.evidenceRunId}`);
    }
  }

  return fixture as WorkspaceFixture;
}
