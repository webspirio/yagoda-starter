import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';

/**
 * WHAT MAY BE CACHED — the one list, default-deny, the same shape as the
 * persister's `isPersistableKey`. A key is matched by PREFIX
 * (`setQueryDefaults`), so `['product-grades', 'active']` rides on
 * `queryKeys.productGrades()`.
 *
 * Only data that changes rarely and by the owner's hand belongs here. Money
 * and documents never do: `/reception` showed a drawer, receipts and prices
 * five minutes old because each hook used to pick its own window. Points are
 * left off on purpose — their row carries `target_crates`, a live figure.
 * Adding a key is the decision; nothing else in `src` may set a freshness
 * option (eslint `no-restricted-syntax`).
 */
const CACHEABLE_KEYS: readonly (readonly unknown[])[] = [
  queryKeys.me,
  queryKeys.tareTypes,
  queryKeys.products,
  queryKeys.productGrades(),
];

const CACHED_STALE_MS = 30 * 60_000;
/** Not shorter than the persister's `maxAge` — it keeps `me` across reloads. */
const CACHED_GC_MS = 24 * 60 * 60_000;

/**
 * The app's `QueryClient`. Everything off `CACHEABLE_KEYS` is stale on
 * arrival, refetched on every mount and on window focus, and dropped the
 * moment nothing reads it — so returning to a screen shows the loading state,
 * never a previous visit's figures. Mutations are dropped once unobserved
 * too: one mutation's `data` is a plaintext password
 * (`useRevealPasswordMutation`).
 */
export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 0,
        gcTime: 0,
        refetchOnMount: true,
        refetchOnWindowFocus: true,
      },
      mutations: {
        gcTime: 0,
      },
    },
  });
  for (const queryKey of CACHEABLE_KEYS) {
    client.setQueryDefaults(queryKey, { staleTime: CACHED_STALE_MS, gcTime: CACHED_GC_MS });
  }
  return client;
}
