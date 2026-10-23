import { useState } from 'react';
import { getStoredSidebarCollapsed, storeSidebarCollapsed } from '@/shared/lib/sidebar-preference';

/**
 * Whether the desktop sidebar is folded down to its icons. A per-viewer
 * convenience, so it lives in this browser's storage and falls back to
 * «expanded» whenever storage is unavailable.
 */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(getStoredSidebarCollapsed);
  const toggle = () =>
    setCollapsed((prev) => {
      const next = !prev;
      storeSidebarCollapsed(next);
      return next;
    });
  return [collapsed, toggle];
}
