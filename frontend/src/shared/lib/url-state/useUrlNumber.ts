import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { useUrlPatch } from './useUrlPatch';

/**
 * A positive-integer param (a page number, a grown page size).
 *
 * Anything that is not one -- junk, a float, zero, a negative, an empty value
 * -- reads as `null`, i.e. absent, so the caller's own default applies. The URL
 * is user-editable and shareable, so this is the boundary where a hand-typed
 * `?page=abc` has to stop; letting NaN through would put it straight on the
 * wire as a page number the backend rejects.
 *
 * It insists on plain decimal digits rather than deferring to `Number`, which
 * accepts a good deal more than it looks like it does: `1e3` parses to a
 * perfectly valid integer 1000, so a value would not survive a write/read
 * round trip unchanged. Exponents and signs buy nothing for a page number.
 */
export function useUrlNumber(name: string): [number | null, (value: number | null) => void] {
  const [searchParams] = useSearchParams();
  const patch = useUrlPatch();

  const raw = searchParams.get(name);
  const parsed = raw !== null && /^\d+$/.test(raw) ? Number(raw) : NaN;
  const value = Number.isInteger(parsed) && parsed > 0 ? parsed : null;

  const setValue = useCallback((next: number | null) => patch({ [name]: next }), [name, patch]);

  return [value, setValue];
}
