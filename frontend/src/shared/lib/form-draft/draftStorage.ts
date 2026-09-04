/**
 * Raw-string draft storage backed by localStorage. Every consumer goes
 * through `useFormDraft`, which owns the envelope shape.
 */

export function loadLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode / storage disabled throws on access
  }
}

export function writeLocal(key: string, raw: string): void {
  try {
    localStorage.setItem(key, raw);
  } catch {
    /* storage disabled / quota — ignore */
  }
}

/** Drop the stored draft. Used to sweep an invalid/stale/cleared draft. */
export function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
