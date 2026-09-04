import { Logger } from '@nestjs/common';
import { messageOf } from '../errors/message-of';

/**
 * Run a scheduled tick so that a failure is a logged no-op for that interval,
 * never an escaping rejection.
 *
 * WHY EVERY TICK NEEDS THIS, and why the two decorators need it for different
 * reasons:
 *
 * - `@Interval` — `@nestjs/schedule` mounts it as a bare `setInterval(target, ms)`
 *   (SchedulerOrchestrator) with no `.catch()` anywhere on the returned promise.
 *   An escaping rejection therefore reaches the process as an `unhandledRejection`.
 * - `@Cron` — `cron@4` DOES attach its own catch to the tick promise, so a
 *   rejection never escapes. It logs through a raw
 *   `console.error('[Cron] error in callback', …)` fallback instead, which bypasses
 *   `nestjs-pino` entirely and leaves an unstructured line no log pipeline can
 *   query. **This is why a global `unhandledRejection` handler cannot substitute
 *   for this wrapper on a `@Cron`: the rejection is consumed before it gets there.**
 *
 * `installUnhandledRejectionHandler` (see `common/process-safety.ts`) is the
 * process-wide net and means an unguarded `@Interval` no longer crashes the
 * process. This wrapper is still what attributes a failure to a NAMED tick and
 * keeps the surrounding loop running — it is no longer the crash barrier, and any
 * comment claiming otherwise is stale.
 *
 * `name` is the operator-facing label; the emitted line is `<name> tick failed: …`.
 */
export const runGuardedTick = async (
  logger: Logger,
  name: string,
  run: () => Promise<void>,
): Promise<void> => {
  try {
    await run();
  } catch (err) {
    logger.warn(`${name} tick failed: ${messageOf(err)}`);
  }
};
