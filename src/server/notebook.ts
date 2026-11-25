import { createHash } from 'node:crypto'
import type { Database } from '../db/client'
import { runArtifacts } from '../db/schema'
import {
  buildNotebookDocument,
  type BuildNotebookInput,
  type NbformatCell,
  type NbformatCodeCell,
  type NbformatMarkdownCell,
  type NbformatOutput,
  type NbformatV4Document,
  type NotebookClaimInfo,
} from '../shared/notebook'

export {
  buildNotebookDocument,
  type BuildNotebookInput,
  type NbformatCell,
  type NbformatCodeCell,
  type NbformatMarkdownCell,
  type NbformatOutput,
  type NbformatV4Document,
  type NotebookClaimInfo,
}

export type NotebookArtifactPayload = {
  kind: 'notebook'
  path: string
  sha256: string
  bytes: number
  content: string
  notebook: NbformatV4Document
}

/**
 * Builds the nbformat v4 JSON payload and metadata needed for `run_artifacts`
 * with `kind = 'notebook'`.
 */
export function buildNotebookArtifact(
  input: BuildNotebookInput,
  path = 'reproducibility-record.ipynb',
): NotebookArtifactPayload {
  const notebook = buildNotebookDocument(input)
  const content = JSON.stringify(notebook, null, 2)
  const buf = Buffer.from(content, 'utf8')
  const sha256 = createHash('sha256').update(buf).digest('hex')

  return {
    kind: 'notebook',
    path,
    sha256,
    bytes: buf.byteLength,
    content,
    notebook,
  }
}

export async function saveNotebookArtifact(
  db: Pick<Database, 'insert'>,
  runId: string,
  input: BuildNotebookInput,
  path = 'reproducibility-record.ipynb',
): Promise<{ id: string } & NotebookArtifactPayload> {
  const artifact = buildNotebookArtifact(input, path)
  const [row] = await db
    .insert(runArtifacts)
    .values({
      runId,
      kind: artifact.kind,
      path: artifact.path,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
      content: artifact.content,
    })
    .returning({ id: runArtifacts.id })

  if (!row) {
    throw new Error('run_artifacts insert returned no row')
  }

  return { id: row.id, ...artifact }
}
