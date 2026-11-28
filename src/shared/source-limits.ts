/**
 * Client-safe source-ingestion limits.
 *
 * Kept in `shared/` so the browser upload label and the server validator use
 * one number. `src/server/source-input.ts` re-exports `MAX_PDF_BYTES`, which is
 * the name the route and its tests import.
 */

/**
 * Vercel caps a request body near 4.5 MB. A PDF travels as base64 (≈4/3 the
 * raw bytes) inside a multipart or JSON envelope, so a larger advertised cap
 * could never reach the validator on the deployed platform. 3 MiB leaves room
 * for the encoding and envelope under the platform cap.
 */
export const MAX_PDF_BYTES = 3 * 1024 * 1024

/** Human-facing form of `MAX_PDF_BYTES`, e.g. "3 MB". */
export const MAX_PDF_LABEL = `${MAX_PDF_BYTES / (1024 * 1024)} MB`
