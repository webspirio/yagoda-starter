/**
 * The one definition of "turn an unknown throw into a log line".
 *
 * Three copies of this existed before (`notification.scheduler.ts`,
 * `delivery.dispatcher.ts`, `notification.service.ts`) — design §17 item 4
 * counted two and undercounted. It lives under `errors/` rather than inside
 * `scheduling/guarded-tick.ts` because not every consumer is a tick:
 * `NotificationService` is the legacy transactional send path.
 */
export const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
