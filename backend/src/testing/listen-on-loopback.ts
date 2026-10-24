import type { INestApplication } from '@nestjs/common';

/**
 * Starts the app's HTTP server ONCE, on 127.0.0.1 and a free port, in place of `app.init()`
 * (which `listen` runs itself). Every suite that sends requests through supertest calls it.
 *
 * Handed a server that is not listening, supertest calls `listen(0)` before EVERY request —
 * on the wildcard address — and `close()` after it. macOS lets a wildcard listen take a port
 * another process already holds on 127.0.0.1 (an editor helper, an agent server), and
 * supertest then sends the request to 127.0.0.1:<port>, which the OS hands to that OTHER
 * process. The test sees «socket hang up», or that process's 401/404/400, on a random request
 * of a random suite, about one `test:db` run in three on a busy machine (2026-10-24). Bound to
 * 127.0.0.1 itself, the server is only ever given a port nobody holds there.
 *
 * One listening server also spares the per-request `close()`, which waits out idle keep-alive
 * sockets (`payout-cash-race.db-spec.ts` measured 18s of a 20s run lost to it).
 */
export async function listenOnLoopback(app: INestApplication): Promise<void> {
  await app.listen(0, '127.0.0.1');
}
