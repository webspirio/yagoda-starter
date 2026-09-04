import { QueryClient } from '@tanstack/react-query';

/**
 * Per-read freshness windows (ms). Import these at each `useQuery` instead of
 * hand-writing durations so the values stay DRY and documented. Mutations still
 * invalidate the relevant keys, so post-action freshness is unaffected.
 */
export const STALE = {
  /** List reads (paginated collections) — a few minutes is plenty. */
  list: 5 * 60_000,
  /** Single-entity detail reads. */
  detail: 60_000,
  /** Rarely-changing reference / lookup reads (e.g. static dropdown options). */
  reference: 30 * 60_000,
} as const;

/**
 * Shared TanStack Query client with sensible defaults for a browser app:
 * - `refetchOnWindowFocus: false` — a tab switch or a brief background/foreground
 *   cycle should not trigger a redundant refetch of data that is already fresh.
 * - `staleTime: 30_000` — default for reads that don't set their own via `STALE`.
 * - `gcTime: 24h` — keep unused query data in memory long enough that the
 *   persisted cache (see `persister.ts`) stays meaningful across a session
 *   (TanStack guidance: `gcTime >= persist maxAge`).
 * - `retry: 1` — a single retry; most failures are auth/validation errors.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      gcTime: 24 * 60 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
});
