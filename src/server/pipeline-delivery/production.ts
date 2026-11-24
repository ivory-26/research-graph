/**
 * Production wiring for the delivery handlers.
 *
 * Everything heavy is imported lazily: the Neon client, the auth SDK, and the
 * Drizzle data adapter. A server route importing this module therefore carries
 * no database driver or auth secret into any bundle that is not actually
 * serving a request.
 *
 * The GET route supplies the real provider (`./production-stages`) through
 * `stagesFactory`; the approval POST does not need one. A stream that cannot
 * build a provider still refuses with 503 before claiming anything rather than
 * pretending to run a pipeline.
 */
import type { Database } from '../../db/client'
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
   * An explicit provider, or `null` to refuse to start work. When omitted, the
   * stream route supplies the real provider through `stagesFactory`.
   */
  stages?: PipelineStages | null
  /**
   * Builds the stage provider over the same database the handlers use. This is
   * the seam the mounted GET route uses; it is also how a test can supply the
   * real provider while swapping the database client.
   */
  stagesFactory?: (db: Database) => PipelineStages
  /** Tests only. */
  timings?: Partial<PipelineTimings>
}

/**
 * Builds the handlers over the live database and Neon Auth identity.
 *
 * The only things a caller may override are `stages` / `stagesFactory`: the
 * data, identity and authorization paths are fixed.
 */
export async function createProductionPipelineHandlers(
  options: ProductionPipelineOptions = {},
): Promise<PipelineHandlers> {
  const [{ getDb }, { createDrizzlePipelineData }] = await Promise.all([
    import('../../db/client'),
    import('./data'),
  ])

  const db = getDb()
  const stages =
    options.stages !== undefined
      ? options.stages
      : (options.stagesFactory?.(db) ?? null)

  return createPipelineHandlers({
    data: createDrizzlePipelineData(db),
    readActor: readVerifiedActorFromNeonAuth,
    stages,
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
 * The SSE GET used by `src/routes/api/pipeline/$experimentId.ts`.
 *
 * The provider is imported lazily so the approval POST never pays for the E2B
 * SDK or the model client. A GET that cannot build a provider still fails
 * closed: `createPipelineHandlers` refuses with 503 before claiming anything.
 */
export async function handlePipelineStream(
  request: Request,
  params: PipelineRouteParams,
): Promise<Response> {
  const { createProductionPipelineStages } = await import(
    './production-stages'
  )

  const handlers = await createProductionPipelineHandlers({
    stagesFactory: (db) => createProductionPipelineStages({ db }),
  })
  return handlers.stream(request, params)
}
