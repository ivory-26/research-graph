import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  DEMO_WORKSPACE,
  DEMO_SOURCES,
  DEMO_CHUNKS,
  DEMO_NODES,
  DEMO_EDGES,
  DEMO_GRAPH_NODES,
  DEMO_GRAPH_EDGES,
  DEMO_STRATEGIES,
  PINNED_IMAGE_PACKAGES as DEMO_PINS,
} from './data/demoWorkspace';
import {
  GraphEdgeSchema,
  GraphNodeSchema,
  parseWorkspaceFixture,
  WorkspaceFixtureError,
  type WorkspaceFixture,
} from './data/workspace-fixture';
import { findPageForCharOffset } from './server/ingest/chunker';
import { extractPdf } from './server/ingest/pdf';
import { PINNED_IMAGE_PACKAGES as RUNNER_PINS } from './server/runner';
import type { NodeType } from './shared/types';

const ROOT = process.cwd();
const FIXTURE_PATH = path.resolve(ROOT, 'fixtures/workspace.json');

function readFixture(): any {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

function issueSummary(result: { success: boolean; error?: { issues: unknown[] } }): string {
  return JSON.stringify(result.error?.issues ?? []);
}

type PdfExtract = Awaited<ReturnType<typeof extractPdf>>;

async function extractSources(fixture: WorkspaceFixture): Promise<Map<string, PdfExtract>> {
  const pdfs = new Map<string, PdfExtract>();
  for (const source of fixture.sources) {
    if (!source.file) continue;
    const buffer = fs.readFileSync(path.resolve(ROOT, 'fixtures', source.file));
    pdfs.set(source.id, await extractPdf(buffer));
  }
  return pdfs;
}

describe('Workspace fixture (Issue #17)', () => {
  it('exists, is valid JSON, and parses at runtime as a workspace fixture', () => {
    expect(fs.existsSync(FIXTURE_PATH)).toBe(true);
    const data = readFixture();
    expect(() => parseWorkspaceFixture(data)).not.toThrow();
  });

  it('parses every node at runtime as a GraphNode with a top-level sourceId', () => {
    const data = readFixture();
    expect(data.nodes.length).toBeGreaterThanOrEqual(10);

    for (const node of data.nodes) {
      const result = GraphNodeSchema.safeParse(node);
      expect(result.success, `node ${node.id}: ${issueSummary(result)}`).toBe(true);
      expect(node, `node ${node.id} must carry top-level sourceId`).toHaveProperty('sourceId');
      expect(node.data.type).toBe(node.type);
    }
  });

  it('parses every edge at runtime as a GraphEdge with sourceNodeId/targetNodeId', () => {
    const data = readFixture();
    expect(data.edges.length).toBeGreaterThanOrEqual(10);

    const nodeIds = new Set(data.nodes.map((node: any) => node.id));
    for (const edge of data.edges) {
      const result = GraphEdgeSchema.safeParse(edge);
      expect(result.success, `edge ${edge.id}: ${issueSummary(result)}`).toBe(true);
      expect(edge).not.toHaveProperty('source');
      expect(edge).not.toHaveProperty('target');
      expect(nodeIds.has(edge.sourceNodeId)).toBe(true);
      expect(nodeIds.has(edge.targetNodeId)).toBe(true);
      expect(edge.evidenceChunkId !== null || edge.evidenceRunId !== null).toBe(true);
      expect(typeof edge.confidence === 'number' || edge.confidence === null).toBe(true);
    }
  });

  it('contains every core node type and Run A / Run B lineage', () => {
    const data = readFixture();
    const typesPresent = new Set<NodeType>(data.nodes.map((node: any) => node.type));
    for (const type of ['source', 'claim', 'method', 'dataset', 'run', 'result'] as NodeType[]) {
      expect(typesPresent.has(type), `missing ${type} node`).toBe(true);
    }

    const runA = data.nodes.find((node: any) => node.id === 'run-a');
    const runB = data.nodes.find((node: any) => node.id === 'run-b');
    expect(runA).toBeDefined();
    expect(runB).toBeDefined();
    expect(runB.data.parentRunId).toBe(runA.data.runId);
    expect(runA.data.mode).toBe('adapted');
    expect(runB.data.mode).toBe('adapted');

    const derived = data.edges.find((edge: any) => edge.relation === 'derived_from');
    expect(derived).toBeDefined();
    expect(derived.sourceNodeId).toBe('run-a');
    expect(derived.targetNodeId).toBe('run-b');
    expect(derived.evidenceRunId).toBe('run-2');

    const results = data.nodes.filter((node: any) => node.type === 'result');
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.data.verdict).toBeNull();
      expect(result.data.isPreview).toBe(true);
      expect(result.data.metrics.rank_impurity_noise_20).toBe(4);
      expect(result.data.metrics.rank_permutation_noise_20).toBe(11);
    }
  });

  it('matches the checked-in PDF bytes for every source', () => {
    const data = readFixture();
    expect(data.sources).toHaveLength(3);

    for (const source of data.sources) {
      expect(source.file, `source ${source.id} needs a checked-in file`).toBeTruthy();
      const filePath = path.resolve(ROOT, 'fixtures', source.file);
      const bytes = fs.readFileSync(filePath);
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

      expect(sha256, `sha256 for ${source.id}`).toBe(source.sha256);
      expect(bytes.byteLength, `byte count for ${source.id}`).toBe(source.bytes);
    }

    const hero = data.sources.find((source: any) => source.isHero);
    expect(hero).toBeDefined();
    expect(hero.sha256).toBe('07c2801d84b912e97fede1fcf8d31dcda15cf63520054a29561b7b38fa1f74b5');
    expect(hero.bytes).toBe(397660);
  });

  it('keeps every chunk verbatim at its checked-in page and character offsets', async () => {
    const fixture = parseWorkspaceFixture(readFixture());
    const pdfs = await extractSources(fixture);

    for (const chunk of Object.values(fixture.chunks)) {
      const pdf = pdfs.get(chunk.sourceId);
      expect(pdf, `no extracted PDF for ${chunk.sourceId}`).toBeDefined();
      if (!pdf) continue;

      expect(pdf.fullText.slice(chunk.charStart, chunk.charEnd), `chunk ${chunk.id}`).toBe(
        chunk.text,
      );
      expect(findPageForCharOffset(chunk.charStart, pdf.pages), `chunk ${chunk.id} page`).toBe(
        chunk.page,
      );
    }
  });

  it('keeps every claim locator and edge quote verbatim in its checked-in source', async () => {
    const fixture = parseWorkspaceFixture(readFixture());
    const pdfs = await extractSources(fixture);

    for (const node of fixture.nodes.filter((candidate) => candidate.data.type === 'claim')) {
      if (node.data.type !== 'claim') throw new Error('narrowing failed');
      const pdf = pdfs.get(node.sourceId ?? '');
      expect(pdf, `claim ${node.id} has no extracted source`).toBeDefined();
      if (!pdf) continue;

      const locator = node.data.locator as typeof node.data.locator & {
        charStart?: number;
        charEnd?: number;
      };
      expect(locator.charStart).toBeTypeOf('number');
      expect(locator.charEnd).toBeTypeOf('number');
      if (typeof locator.charStart !== 'number' || typeof locator.charEnd !== 'number') continue;

      expect(pdf.fullText.slice(locator.charStart, locator.charEnd)).toBe(locator.quote);
      expect(findPageForCharOffset(locator.charStart, pdf.pages)).toBe(locator.page);

      const chunkOnPage = Object.values(fixture.chunks).find(
        (chunk) =>
          chunk.sourceId === node.sourceId &&
          chunk.page === locator.page &&
          chunk.text.includes(locator.quote),
      );
      expect(chunkOnPage, `claim ${node.id} quote is not in a page ${locator.page} chunk`).toBeDefined();
    }

    for (const edge of fixture.edges) {
      if (edge.evidenceChunkId === null) {
        expect(edge.quote, `run-evidenced edge ${edge.id} must not carry a quote`).toBeUndefined();
        continue;
      }

      const chunk = fixture.chunks[edge.evidenceChunkId];
      expect(chunk, `edge ${edge.id} evidence chunk`).toBeDefined();
      if (!chunk) continue;

      expect(edge.quote, `edge ${edge.id} needs a quote`).toBeTruthy();
      expect(chunk.text.includes(edge.quote ?? '')).toBe(true);
      expect(edge.quote!.length).toBeLessThanOrEqual(400);
      expect(edge.page).toBe(chunk.page);
      expect(edge.charStart).toBe(chunk.charStart);
      expect(edge.charEnd).toBe(chunk.charEnd);

      const pdf = pdfs.get(chunk.sourceId);
      expect(pdf, `edge ${edge.id} source PDF`).toBeDefined();
      if (pdf) {
        expect(pdf.fullText.slice(edge.charStart!, edge.charEnd!)).toBe(chunk.text);
      }
    }
  });

  it('rejects a fixture that hides a missing top-level sourceId or edge endpoint', () => {
    const withoutSourceId = readFixture();
    delete withoutSourceId.nodes[0].sourceId;
    expect(() => parseWorkspaceFixture(withoutSourceId)).toThrow(WorkspaceFixtureError);

    const legacyEdgeNames = readFixture();
    const edge = legacyEdgeNames.edges[0];
    edge.source = edge.sourceNodeId;
    edge.target = edge.targetNodeId;
    delete edge.sourceNodeId;
    delete edge.targetNodeId;
    expect(() => parseWorkspaceFixture(legacyEdgeNames)).toThrow(WorkspaceFixtureError);
  });

  it('rejects a quote that is not verbatim in its evidence chunk', () => {
    const data = readFixture();
    data.edges[0].quote = 'A sentence that is not in the checked-in PDF.';
    expect(() => parseWorkspaceFixture(data)).toThrow(/not verbatim/);
  });

  it('rejects an edge with no chunk or run behind it', () => {
    const data = readFixture();
    data.edges[0].evidenceChunkId = null;
    delete data.edges[0].quote;
    expect(() => parseWorkspaceFixture(data)).toThrow(/schema validation|evidence/i);
  });

  it('keeps demoWorkspace.ts and the fixture byte-for-byte in sync', () => {
    const data = readFixture();

    expect(DEMO_WORKSPACE).toEqual(data.workspace);
    expect(DEMO_SOURCES).toEqual(data.sources);
    expect(DEMO_CHUNKS).toEqual(data.chunks);
    expect(DEMO_NODES).toEqual(data.nodes);
    expect(DEMO_GRAPH_NODES).toEqual(data.nodes);
    expect(DEMO_STRATEGIES).toEqual(data.strategies);
    expect(DEMO_EDGES).toHaveLength(data.edges.length);

    for (const [index, edge] of DEMO_EDGES.entries()) {
      const raw = data.edges[index];
      expect(edge.source).toBe(raw.sourceNodeId);
      expect(edge.target).toBe(raw.targetNodeId);
      const { source, target, evidenceSourceTitle, ...rest } = edge;
      expect(source).toBe(raw.sourceNodeId);
      expect(target).toBe(raw.targetNodeId);
      if (edge.sourceTitle !== undefined) {
        expect(edge.sourceTitle).toBe(DEMO_GRAPH_NODES.find((node) => node.id === source)?.title);
      }
      if (edge.targetTitle !== undefined) {
        expect(edge.targetTitle).toBe(DEMO_GRAPH_NODES.find((node) => node.id === target)?.title);
      }
      expect(evidenceSourceTitle).toBe(
        raw.evidenceChunkId ? data.chunks[raw.evidenceChunkId]?.sourceTitle : undefined,
      );
      expect(rest).toEqual(raw);
    }

    for (const edge of DEMO_GRAPH_EDGES) {
      expect(edge).toHaveProperty('sourceNodeId');
      expect(edge).toHaveProperty('targetNodeId');
      expect(edge).toHaveProperty('evidenceChunkId');
      expect(edge).toHaveProperty('evidenceRunId');
    }
  });

  it('ensures PINNED_IMAGE_PACKAGES in demoWorkspace matches runner.ts without drift', () => {
    expect(DEMO_PINS).toEqual(RUNNER_PINS);
  });
});
