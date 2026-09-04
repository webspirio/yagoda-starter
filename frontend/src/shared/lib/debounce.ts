/** A debounced function with a `cancel()` that drops any pending invocation. */
export interface Debounced<Args extends unknown[]> {
  (...args: Args): void;
  cancel: () => void;
}

/**
 * Returns a debounced wrapper of `fn`: rapid calls collapse so `fn` runs once,
 * `ms` after the last call. `cancel()` clears a pending call so it never fires —
 * used to stop a queued write from landing after the data was intentionally
 * cleared.
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  ms: number,
): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = (...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, ms);
  };
  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return debounced;
}
