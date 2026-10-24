/**
 * The top-level `uk.json` namespaces only the owner-only screens read — the lazy owner
 * chunk's strings (`app/owner-pages.ts`). They leave the first load: an operator on a
 * phone at a collection point never renders them, yet paid for them on every first
 * visit (the `bundle` row's first-paint ceiling, 2026-10-24: −8 KiB gzip).
 *
 * `vite.config.ts` reads this list to split `uk.json` into two virtual modules,
 * `virtual:uk-core` (first paint) and `virtual:uk-owner` (the owner chunk). `uk.json`
 * itself stays ONE file, so the `locales` and `plain-text` rows see it unchanged.
 *
 * A namespace belongs here only if no eager screen reads it. The error codes
 * `shared/lib/api-error` maps into `costOfDay`/`reweigh`/`settings` come only from
 * owner endpoints, so the owner chunk is always loaded before one can surface.
 * `index.test.ts` checks the two halves add up to `uk.json` exactly.
 */
export const OWNER_NAMESPACES = [
  'costOfDay',
  'reweigh',
  'users',
  'catalog',
  'points',
  'journal',
  'settings',
  'transfers',
] as const;
