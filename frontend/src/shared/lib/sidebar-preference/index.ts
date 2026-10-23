/**
 * Whether the desktop sidebar is folded down to its icons, remembered between
 * visits. A per-viewer convenience, nothing more.
 *
 * Modelled on `shared/lib/point-preference`, down to swallowing every storage
 * error: a private window or blocked site data must degrade to «expanded»,
 * never to a blank page.
 */
const KEY = 'web-starter:sidebar-collapsed';

export function getStoredSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function storeSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(KEY, collapsed ? '1' : '0');
  } catch {
    /* storage disabled — ignore */
  }
}
