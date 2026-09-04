/**
 * The one definition of "turn an unknown throw into a log line".
 *
 * This used to be duplicated across several call sites before being pulled
 * out here. It lives under `errors/` rather than inside
 * `scheduling/guarded-tick.ts` because not every consumer is a scheduled
 * tick — some are ordinary request-handling or background-job error paths
 * that need the same one-liner.
 */
export const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
