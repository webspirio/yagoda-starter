import { useEffect, useState } from 'react';

/**
 * Shared search-debounce interval. Lives here (not in a feature's model) so
 * that any two features needing the same number share one owner for it.
 * Feature→feature imports aren't actually lint-blocked (`no-restricted-imports`
 * in `eslint.config.mjs` only enforces layer direction, not same-layer
 * cross-imports) — putting a value multiple features share in a lower layer
 * is an FSD convention: one owner for the number instead of copies that drift
 * apart the next time it's tuned.
 */
export const SEARCH_DEBOUNCE_MS = 300;

/** Debounce a fast-changing value (e.g. a search input → request param). */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
