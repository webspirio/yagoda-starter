import { LoggerService } from '@nestjs/common';
import { messageOf } from './errors/message-of';

/**
 * Log an unhandled promise rejection through nestjs-pino and KEEP SERVING.
 *
 * Node ≥ 22 (this backend's floor) defaults `unhandledRejection` to `throw`, so
 * without a listener any stray rejection kills the process. The case that
 * actually reaches here is a background tick rejecting on a transient DB or
 * network blip — killing the HTTP API for every user to recover from one bad
 * iteration of one loop is the worse outcome. Prod runs
 * `restart: unless-stopped`, so exiting WOULD be recovered, but a persistent
 * fault turns that into a crash loop that serves nothing and re-runs migrations
 * on every boot.
 *
 * ACCEPTED COST: a process whose state is genuinely corrupt keeps serving. The
 * trade is deliberate — an unhandled rejection is usually one isolated async
 * operation, not shared process state.
 *
 * DELIBERATELY NOT COVERED:
 *  - boot failures — both rejections before the logger exists (during
 *    NestFactory.create) and anything that throws or rejects later in
 *    bootstrap() (a throwing provider, a failed listen()) are never caught
 *    here; they crash, loudly, because `main.ts` attaches its own `.catch()`
 *    to the `bootstrap()` call and exits non-zero, not because this handler
 *    declines to cover them;
 *  - log flooding from a tight rejection loop — no rate limit, no dedupe;
 *  - `uncaughtException`, a different signal with a different meaning, left at
 *    Node's default.
 *
 * NOT a substitute for the per-tick guard on a `@Cron`: `cron@4` catches the
 * tick's rejection itself, so it never arrives here. See
 * `common/scheduling/guarded-tick.ts`.
 */
export const installUnhandledRejectionHandler = (logger: LoggerService): void => {
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error(
      `unhandled promise rejection: ${messageOf(reason)}`,
      reason instanceof Error ? reason.stack : undefined,
      'ProcessSafety',
    );
  });
};
