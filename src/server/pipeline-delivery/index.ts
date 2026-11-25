/**
 * Pipeline delivery: the `GET /api/pipeline/:experimentId` SSE transport and
 * the `POST /api/pipeline/:experimentId/approve` write path.
 *
 * This module is server-only. The route adapter should import
 * `./production` directly so the DB driver stays out of the static route
 * module; everything below is exported for tests and for the handoff.
 */
export {
  createPipelineHandlers,
} from './handlers'
export type {
  PipelineHandlerDeps,
  PipelineHandlers,
  PipelineRouteParams,
} from './handlers'

export {
  createProductionPipelineHandlers,
  handlePipelineApproval,
  handlePipelineStream,
} from './production'
export type { ProductionPipelineOptions } from './production'

export { createProductionPipelineStages } from './production-stages'
export type {
  ProductionPipelineStageOptions,
  ProductionPipelineStages,
} from './production-stages'

export {
  createDrizzlePipelineData,
} from './data'
export type {
  ExperimentScope,
  PipelineData,
  WorkspaceMemberView,
} from './data'

export { PipelineStageError } from './stages'
export type {
  PipelineEmit,
  PipelineExecutionResult,
  PipelinePlanResult,
  PipelineStageContext,
  PipelineStages,
} from './stages'

export type { VerifiedActor, ReadVerifiedActor } from './authorization'

export {
  CLAIM_TTL_MARGIN_MS,
  DEFAULT_PIPELINE_TIMINGS,
  EVENT_POLL_INTERVAL_MS,
  resolveTimings,
} from './timings'
export type { PipelineTimings } from './timings'
