/**
 * The seed's model runtime.
 *
 * The application default in `src/server/model.ts` stays on the pinned Gemini
 * stack. The seed alone injects Meta Model API's Contributor-mode text
 * generator, plus the record/replay wrapper used by the deterministic
 * two-database baseline. Keeping the selection here means a deployed
 * application that happens to have a `SEED_*` variable set cannot serve
 * recorded output or write `agent_tasks` rows for calls that never happened.
 *
 * Gemini remains the embedding provider; see `src/server/ingest/embed.ts`.
 */
import {
  createCallModel,
  DEFAULT_PRICING,
  generateWithMeta,
  type CallModel,
} from '../../src/server/model.ts'
import { defaultGeneratorFromEnv } from '../../src/server/model-replay.ts'

/** The seed's text model. The app's `DEFAULT_MODEL_ID` is unaffected. */
export const SEED_TEXT_MODEL_ID = 'muse-spark-1.3-contributor'

/**
 * Model ids the application may pass explicitly. The evaluator pins
 * `gemini-4-hydrogen` for `explain_gap`; the seed's generator is Meta, so that
 * pin is routed to the seed model and the `agent_tasks` row records the model
 * that actually answered.
 */
const SEED_REMAP_MODEL_IDS = new Set([
  SEED_TEXT_MODEL_ID,
  'gemini-4-hydrogen',
  'gemini-3.8-flash',
])

/**
 * Build the seed's call wrapper. Callers run inside the seed process only;
 * normal application code must keep using `callModel` from `src/server/model`.
 */
export function createSeedCallModel(
  env: NodeJS.ProcessEnv = process.env,
): CallModel {
  const call = createCallModel({
    generate: defaultGeneratorFromEnv(generateWithMeta, env),
    defaultModelId: SEED_TEXT_MODEL_ID,
    pricing: DEFAULT_PRICING,
  })

  return (schema, prompt, context) => {
    const modelId =
      context.modelId === undefined ||
      SEED_REMAP_MODEL_IDS.has(context.modelId)
        ? SEED_TEXT_MODEL_ID
        : context.modelId
    return call(schema, prompt, { ...context, modelId })
  }
}
