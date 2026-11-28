import { createFileRoute } from '@tanstack/react-router'
import { assertSameOrigin } from '../../server/pipeline-delivery/authorization'
import { toErrorResponse } from '../../server/pipeline-delivery/errors'
import { and, asc, desc, eq } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { experiments, nodes, runArtifacts, runs } from '../../db/schema'
import { requireWorkspaceAccess } from '../../server/auth/workspace.server'
import {
  AuthConfigurationError,
  AuthUnavailableError,
  UnauthenticatedError,
  WorkspaceAccessDeniedError,
} from '../../server/auth.server'
import {
  assessClaimTemplateCompatibility,
  buildSupportedExperimentSpec,
  isSupportedExperimentTemplateId,
  supportedExperimentTemplateSummary,
  SUPPORTED_EXPERIMENT_TEMPLATE,
} from '../../server/experiment-templates'
import type { NodeData } from '../../shared/types'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const AUTH_ERRORS = [
  UnauthenticatedError,
  WorkspaceAccessDeniedError,
  AuthUnavailableError,
  AuthConfigurationError,
] as const

function authErrorResponse(err: unknown): Response | null {
  for (const ErrorType of AUTH_ERRORS) {
    if (err instanceof ErrorType) {
      return Response.json(
        { error: err.message, code: err.code },
        { status: err.status, headers: { 'Cache-Control': 'no-store' } },
      )
    }
  }
  return null
}

function jsonError(message: string, status: number, code?: string): Response {
  return Response.json(
    code ? { error: message, code } : { error: message },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * Auth-guarded workspace experiments API.
 *
 * GET is the read model the experiments page renders: planned/stored specs,
 * every run attempt, its measured metrics and deterministic verdict, and the
 * artifact metadata (not the bytes; download is another route). All rows are
 * scoped by workspace membership, and runs are joined through their experiment
 * so a run from another tenant is unrepresentable in the response.
 *
 * POST creates one experiment from the single supported tabular template. It
 * does not run anything: the existing SSE route starts PLAN_EXPERIMENT, opens
 * the gate and executes after a human approves. Because the template rebinds
 * the claim but keeps the fixed breast-w script and criteria, a claim that is
 * not about random-forest variable importance is refused with 422
 * `CLAIM_TEMPLATE_MISMATCH` instead of receiving a verdict it did not ask for.
 * Every experiment in the response carries `templateId` / `templateName`.
 */
export const Route = createFileRoute('/api/experiments')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const workspaceId = url.searchParams.get('workspaceId')?.trim()

        if (!workspaceId) {
          return jsonError('workspaceId query parameter is required', 400)
        }

        try {
          const membership = await requireWorkspaceAccess(request, workspaceId)
          const db = getDb()
          const scopedWorkspaceId = membership.workspaceId

          const [experimentRows, runRows, artifactRows, claimRows] = await Promise.all([
            db
              .select({
                id: experiments.id,
                claimNodeId: experiments.claimNodeId,
                spec: experiments.spec,
                mode: experiments.mode,
                approvalState: experiments.approvalState,
                approvedBy: experiments.approvedBy,
                approvedAt: experiments.approvedAt,
                createdAt: experiments.createdAt,
                claimTitle: nodes.title,
                claimData: nodes.data,
              })
              .from(experiments)
              .leftJoin(
                nodes,
                and(
                  eq(nodes.id, experiments.claimNodeId),
                  eq(nodes.workspaceId, experiments.workspaceId),
                ),
              )
              .where(eq(experiments.workspaceId, scopedWorkspaceId))
              .orderBy(desc(experiments.createdAt), asc(experiments.id)),
            db
              .select({
                id: runs.id,
                experimentId: runs.experimentId,
                attempt: runs.attempt,
                status: runs.status,
                runner: runs.runner,
                parameters: runs.parameters,
                metrics: runs.metrics,
                environment: runs.environment,
                verdict: runs.verdict,
                verdictDetail: runs.verdictDetail,
                stdout: runs.stdout,
                stderr: runs.stderr,
                startedAt: runs.startedAt,
                finishedAt: runs.finishedAt,
                createdAt: runs.createdAt,
              })
              .from(runs)
              .innerJoin(experiments, eq(runs.experimentId, experiments.id))
              .where(eq(experiments.workspaceId, scopedWorkspaceId))
              .orderBy(asc(runs.attempt), asc(runs.createdAt), asc(runs.id)),
            db
              .select({
                id: runArtifacts.id,
                runId: runArtifacts.runId,
                kind: runArtifacts.kind,
                path: runArtifacts.path,
                sha256: runArtifacts.sha256,
                bytes: runArtifacts.bytes,
              })
              .from(runArtifacts)
              .innerJoin(runs, eq(runArtifacts.runId, runs.id))
              .innerJoin(experiments, eq(runs.experimentId, experiments.id))
              .where(eq(experiments.workspaceId, scopedWorkspaceId))
              .orderBy(asc(runArtifacts.path), asc(runArtifacts.id)),
            db
              .select({
                id: nodes.id,
                title: nodes.title,
                data: nodes.data,
                sourceId: nodes.sourceId,
                createdAt: nodes.createdAt,
              })
              .from(nodes)
              .where(
                and(
                  eq(nodes.workspaceId, scopedWorkspaceId),
                  eq(nodes.type, 'claim'),
                ),
              )
              .orderBy(asc(nodes.createdAt), asc(nodes.id)),
          ])

          const artifactsByRun = new Map<string, typeof artifactRows>()
          for (const artifact of artifactRows) {
            const list = artifactsByRun.get(artifact.runId) ?? []
            list.push(artifact)
            artifactsByRun.set(artifact.runId, list)
          }

          const runsByExperiment = new Map<string, typeof runRows>()
          for (const run of runRows) {
            const list = runsByExperiment.get(run.experimentId) ?? []
            list.push(run)
            runsByExperiment.set(run.experimentId, list)
          }

          return Response.json(
            {
              experiments: experimentRows.map((row) => ({
                id: row.id,
                claimNodeId: row.claimNodeId,
                claimTitle: row.claimTitle ?? 'Unknown claim',
                claimText:
                  row.claimData?.type === 'claim' ? row.claimData.text : null,
                // The stored spec does not carry a template id; every stored
                // experiment was created from the one supported template.
                templateId: SUPPORTED_EXPERIMENT_TEMPLATE.id,
                templateName: SUPPORTED_EXPERIMENT_TEMPLATE.name,
                mode: row.mode,
                approvalState: row.approvalState,
                approvedBy: row.approvedBy,
                approvedAt: row.approvedAt,
                createdAt: row.createdAt,
                parameters: row.spec.parameters,
                criteria: row.spec.criteria,
                datasets: row.spec.datasets.map((dataset) => ({
                  name: dataset.name,
                  url: dataset.url,
                  bytes: dataset.bytes,
                  sha256: dataset.sha256,
                })),
                timeoutSeconds: row.spec.timeoutSeconds,
                memoryMb: row.spec.memoryMb,
                cpuCount: row.spec.cpuCount,
                network: row.spec.network,
                entrypoint: row.spec.entrypoint,
                files: row.spec.files,
                runs: (runsByExperiment.get(row.id) ?? []).map((run) => ({
                  id: run.id,
                  attempt: run.attempt,
                  status: run.status,
                  runner: run.runner,
                  parameters: run.parameters,
                  metrics: run.metrics,
                  verdict: run.verdict,
                  verdictDetail: run.verdictDetail,
                  stdout: run.stdout,
                  stderr: run.stderr,
                  startedAt: run.startedAt,
                  finishedAt: run.finishedAt,
                  createdAt: run.createdAt,
                  artifacts: (artifactsByRun.get(run.id) ?? []).map((artifact) => ({
                    id: artifact.id,
                    kind: artifact.kind,
                    path: artifact.path,
                    sha256: artifact.sha256,
                    bytes: artifact.bytes,
                  })),
                })),
              })),
              claims: claimRows.map((claim) => {
                const data: NodeData = claim.data
                return {
                  id: claim.id,
                  title: claim.title,
                  sourceId: claim.sourceId,
                  text: data.type === 'claim' ? data.text : null,
                  datasetName: data.type === 'claim' ? data.datasetName : null,
                  methodName: data.type === 'claim' ? data.methodName : null,
                }
              }),
              template: supportedExperimentTemplateSummary(),
              source: 'database',
            },
            {
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'private, no-store',
                Vary: 'Cookie',
              },
            },
          )
        } catch (err: unknown) {
          const authResponse = authErrorResponse(err)
          if (authResponse) return authResponse
          console.error('[experiments] list failed', err)
          return jsonError('Failed to load workspace experiments', 500)
        }
      },

      POST: async ({ request }) => {
        try {
          assertSameOrigin(request, { requireOrigin: true })
        } catch (error) {
          return toErrorResponse(error)
        }

        let body: Record<string, unknown>
        try {
          const parsed: unknown = await request.json()
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return jsonError('Expected a JSON object', 400)
          }
          body = parsed as Record<string, unknown>
        } catch {
          return jsonError('Invalid JSON body', 400)
        }

        const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : ''
        const claimNodeId = typeof body.claimNodeId === 'string' ? body.claimNodeId.trim() : ''

        if (!workspaceId) return jsonError('workspaceId is required', 400)
        if (!UUID_REGEX.test(claimNodeId)) {
          return jsonError('claimNodeId must be a claim node UUID', 400)
        }
        if (!isSupportedExperimentTemplateId(body.templateId)) {
          return jsonError(
            `templateId must be "${SUPPORTED_EXPERIMENT_TEMPLATE.id}"`,
            400,
            'UNSUPPORTED_TEMPLATE',
          )
        }

        const rawParameters = body.parameters
        if (
          rawParameters !== undefined &&
          (typeof rawParameters !== 'object' ||
            rawParameters === null ||
            Array.isArray(rawParameters))
        ) {
          return jsonError('parameters must be an object', 400)
        }

        try {
          const membership = await requireWorkspaceAccess(request, workspaceId)
          const db = getDb()

          const [claim] = await db
            .select({ id: nodes.id, title: nodes.title, data: nodes.data })
            .from(nodes)
            .where(
              and(
                eq(nodes.id, claimNodeId),
                eq(nodes.workspaceId, membership.workspaceId),
                eq(nodes.type, 'claim'),
              ),
            )
            .limit(1)

          if (!claim) {
            return jsonError('Claim node not found in this workspace', 404, 'CLAIM_NOT_FOUND')
          }

          const compatibility = assessClaimTemplateCompatibility({
            title: claim.title,
            data: claim.data,
          })
          if (!compatibility.compatible) {
            return jsonError(compatibility.reason, 422, 'CLAIM_TEMPLATE_MISMATCH')
          }

          const built = buildSupportedExperimentSpec({
            claimNodeId: claim.id,
            templateId: SUPPORTED_EXPERIMENT_TEMPLATE.id,
            parameters: (rawParameters ?? {}) as Record<string, unknown>,
          })

          if (!built.spec) {
            return Response.json(
              {
                error: 'The supported experiment plan failed validation',
                code: 'PLAN_INVALID',
                details: built.errors,
              },
              { status: 400, headers: { 'Cache-Control': 'no-store' } },
            )
          }

          const [created] = await db
            .insert(experiments)
            .values({
              workspaceId: membership.workspaceId,
              claimNodeId: claim.id,
              spec: built.spec,
              mode: built.spec.mode,
              approvalState: 'pending',
            })
            .returning({
              id: experiments.id,
              workspaceId: experiments.workspaceId,
              claimNodeId: experiments.claimNodeId,
              mode: experiments.mode,
              approvalState: experiments.approvalState,
              createdAt: experiments.createdAt,
            })

          if (!created) {
            return jsonError('The experiment could not be created', 500)
          }

          return Response.json(
            {
              experiment: {
                ...created,
                claimTitle: claim.title,
                templateId: SUPPORTED_EXPERIMENT_TEMPLATE.id,
                templateName: SUPPORTED_EXPERIMENT_TEMPLATE.name,
                spec: built.spec,
              },
              template: supportedExperimentTemplateSummary(),
            },
            {
              status: 201,
              headers: { 'Cache-Control': 'no-store' },
            },
          )
        } catch (err: unknown) {
          const authResponse = authErrorResponse(err)
          if (authResponse) return authResponse
          console.error('[experiments] create failed', err)
          return jsonError('Failed to create the experiment', 500)
        }
      },
    },
  },
})
