/**
 * The last «Розподіл кошика» the owner looked at on «Собівартість дня»,
 * remembered between visits (spec 2026-10-24 §3.1). A per-viewer convenience:
 * `?split=` stays the source of truth whenever it carries a valid value.
 *
 * Stores an opaque string — `shared` may not know the domain's split keys, so
 * the page validates what comes back. Modelled on `shared/lib/sidebar-preference`,
 * down to swallowing every storage error: a private window or blocked site
 * data must degrade to «nothing remembered», never to a crash.
 */
const KEY = 'web-starter:cost-split';

export function getStoredCostSplit(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function storeCostSplit(value: string): void {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* storage disabled — ignore */
  }
}
