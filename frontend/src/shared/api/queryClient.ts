import { createQueryClient } from './cachePolicy';

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

/** The app's one client. Freshness is decided in `cachePolicy.ts`, nowhere else. */
export const queryClient = createQueryClient();
