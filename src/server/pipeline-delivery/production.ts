/**
 * Production wiring for the delivery handlers.
 *
 * Everything heavy is imported lazily: the Neon client, the auth SDK, and the
 * Drizzle data adapter. A server route importing this module therefore carries
 * no database driver or auth secret into any bundle that is not actually
 * serving a request.
 *
 * `stages` has no production value today. `#23`, `#24` and `#25` are not on
 * main (PR #43 is blocked and is not a dependency of this branch), and `#7`
 * has not landed. A GET that would have to start a pipeline therefore returns
 * 503 rather than pretending to run one. The approval POST needs no stage
 * provider and is fully live.
 */
import { readVerifiedActorFromNeonAuth } from './authorization'
import {
  createPipelineHandlers,
  type PipelineHandlers,
  type PipelineRouteParams,
} from './handlers'
import type { PipelineStages } from './stages'
import type { PipelineTimings } from './timings'

export type ProductionPipelineOptions = {
  /**
   * Supplied by the pipeline workstream once `PipelineStages` has a real
   * implementation. Until then, omit it.
   */
  stages?: PipelineStages | null
  /** Tests only. */
  timings?: Partial<PipelineTimings>
}

/**
 * Builds the handlers over the live database and Neon Auth identity.
 *
 * The only thing a caller may override is `stages`: the data, identity and
 * authorization paths are fixed.
 */
export async function createProductionPipelineHandlers(
  options: ProductionPipelineOptions = {},
): Promise<PipelineHandlers> {
  const [{ getDb }, { createDrizzlePipelineData }] = await Promise.all([
    import('../../db/client'),
    import('./data'),
  ])

  return createPipelineHandlers({
    data: createDrizzlePipelineData(getDb()),
    readActor: readVerifiedActorFromNeonAuth,
    stages: options.stages ?? null,
    timings: options.timings,
  })
}

/** The approval POST. Live in production; depends on no stage provider. */
export async function handlePipelineApproval(
  request: Request,
  params: PipelineRouteParams,
): Promise<Response> {
  const handlers = await createProductionPipelineHandlers()
  return handlers.approve(request, params)
}

/**
 * The SSE GET. Mounted only when a real `PipelineStages` provider exists;
 * otherwise a fresh request is refused with 503 before any claim is written.
 */
export async function handlePipelineStream(
  request: Request,
  params: PipelineRouteParams,
): Promise<Response> {
  const handlers = await createProductionPipelineHandlers()
  return handlers.stream(request, params)
}
