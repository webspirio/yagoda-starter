import type { AuthHooks } from '@/shared/api';
import { useSession } from './store';

/**
 * The session-backed implementation of `shared/api`'s `AuthHooks` contract.
 *
 * `shared` cannot import the store — it's FSD's lowest layer and must never
 * import from `entities` — so `attachAuthInterceptors` takes these as
 * callbacks instead. `entities` is the lowest layer permitted to know about
 * both the http client and the session store, so it owns wiring them
 * together. Every call site (main.tsx, and this feature's own tests) passes
 * this object rather than reaching into the store directly.
 */
export const sessionAuthHooks: AuthHooks = {
  getToken: () => useSession.getState().token,
  onUnauthorized: () => useSession.getState().setToken(null),
};
