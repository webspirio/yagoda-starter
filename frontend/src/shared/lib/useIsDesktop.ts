import { useCallback, useSyncExternalStore } from 'react';

export const DESKTOP_BREAKPOINT = 768;

const QUERY = `(min-width: ${DESKTOP_BREAKPOINT}px)`;

function canMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

/**
 * `true` at ≥768px (Tailwind `md`) — the app's single mobile/desktop switch
 * (bottom sheet vs dialog, stacked vs rail layout). Reactive to viewport
 * changes; `false` where matchMedia is unavailable (jsdom, ancient WebViews).
 */
export function useIsDesktop(): boolean {
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (!canMatchMedia()) return () => {};
    const mql = window.matchMedia(QUERY);
    mql.addEventListener('change', onStoreChange);
    return () => mql.removeEventListener('change', onStoreChange);
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => (canMatchMedia() ? window.matchMedia(QUERY).matches : false),
    () => false,
  );
}
