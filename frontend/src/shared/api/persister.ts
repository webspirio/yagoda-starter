import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import {
  removeOldestQuery,
  type PersistQueryClientOptions,
  type Persister,
} from '@tanstack/react-query-persist-client';
import type { Query } from '@tanstack/react-query';

/**
 * Bump when a persisted query's shape changes so a deploy drops stale entries
 * (fed to the persister's `buster`). Explicit and controllable — no build-id
 * plumbing.
 *
 * The rule this file lives or dies by: whatever is persisted raw is cached
 * verbatim, so ANY field added to that shape is a bump. A rehydrated payload
 * missing a field its readers treat as required does not fail loudly — it
 * renders the wrong thing for up to the 24h `maxAge`.
 */
export const PERSIST_VERSION = 1;

/**
 * Default-deny allowlist of queries that are safe to keep in `localStorage`.
 * Only the signed-in user's own profile qualifies today. Add new keys here
 * explicitly as the app grows — anything that could carry another user's
 * data must never be persisted.
 */
export function isPersistableKey(queryKey: readonly unknown[]): boolean {
  const [head] = queryKey;
  return head === 'me'; // queryKeys.me
}

const PROBE_KEY = '__web_starter_storage_probe__';

/**
 * Resolves a usable `Storage`, or `undefined` when there isn't one.
 *
 * Two distinct browser failures, both fatal if left unguarded. Reading
 * `window.localStorage` at all throws `SecurityError` in some private-
 * browsing modes or when third-party storage is blocked — and because this
 * module is imported at bootstrap (`main.tsx` → `shared/api`), that throw
 * escapes module evaluation, i.e. before any bootstrap try/catch can render a
 * fallback. The user gets a blank page. Separately, some browsers expose the
 * object but throw on write, which the read alone would not catch — hence
 * the probe.
 *
 * `read` is a thunk rather than a `Storage` so the getter access itself
 * happens inside the try. Every other storage reader in the app already
 * guards this way (`theme-preference`, `language-preference`).
 */
export function safeStorage(read: () => Storage): Storage | undefined {
  try {
    const storage = read();
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return storage;
  } catch {
    return undefined;
  }
}

/**
 * Builds the cache persister over `storage`, or a no-op persister when there
 * is none (the library already degrades that way for a falsy `storage`, so an
 * unavailable store simply means in-memory-only caching).
 *
 * `retry: removeOldestQuery` is what keeps a quota overflow recoverable.
 * Without it `createSyncStoragePersister` catches the `setItem` error, calls
 * `retry?.()`, gets `undefined`, and exits the recovery loop — the failure is
 * neither thrown nor logged, so persistence stops working permanently and
 * silently.
 */
export function createCachePersister(storage: Storage | undefined): Persister {
  return createSyncStoragePersister({
    storage,
    key: 'web-starter-rq-cache',
    retry: removeOldestQuery,
  });
}

/**
 * The localStorage-backed persister. Exported so `AppLayout`'s `signOut` can
 * wipe the persisted blob (`persister.removeClient()`) the moment a session
 * ends, rather than leaving it behind for the next app open.
 */
export const persister = createCachePersister(safeStorage(() => window.localStorage));

/**
 * Short, non-reversible fingerprint of `value`, rendered as hex (djb2a: a
 * cheap synchronous string hash — no crypto API, no new dependency).
 *
 * `buildPersistOptions` uses this to turn the signed-in identity into a
 * `buster` scope. TanStack's sync-storage persister writes `buster` into the
 * persisted blob verbatim, so whatever is used as the scope sits in
 * `localStorage` in plaintext for as long as that blob lives — a hash still
 * changes on every sign-in (all the buster needs to stop one account's cache
 * rehydrating under another) without itself being usable to authenticate.
 * Exported for direct testing.
 */
export function hashToken(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Build persistence options for the current signed-in identity. The `buster`
 * incorporates a fingerprint of `identity` so a cache written by one account
 * is discarded (never rehydrated) when a DIFFERENT account signs in on the
 * same browser — closing the cross-user data-bleed on a shared, multi-account
 * device.
 *
 * `identity` is the signed-in user's bearer token, or `'anon'` before one
 * exists. It is NEVER used raw: this function hashes it (`hashToken`) before
 * it reaches `buster`, because `buster` is persisted verbatim in the blob
 * this module writes to `localStorage` — passing the token through un-hashed
 * would leave a still-valid credential sitting in plaintext next to the
 * cached data. `'anon'` is kept literal, since it identifies no one and
 * carries nothing to protect.
 */
export function buildPersistOptions(
  identity: string,
): Omit<PersistQueryClientOptions, 'queryClient'> {
  const scope = identity === 'anon' ? 'anon' : hashToken(identity);
  return {
    persister,
    maxAge: 24 * 60 * 60_000,
    buster: `v${PERSIST_VERSION}:${scope}`,
    dehydrateOptions: {
      shouldDehydrateQuery: (query: Query) =>
        query.state.status === 'success' && isPersistableKey(query.queryKey),
    },
  };
}
