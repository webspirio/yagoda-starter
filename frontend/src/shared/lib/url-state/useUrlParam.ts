import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { useUrlPatch } from './useUrlPatch';

/**
 * A single query param as React state — the mechanism that lets an ephemeral
 * UI choice (which tab is active, whether a detail sheet is open) survive the
 * unmount that every outward navigation causes. `useState` cannot: a user who
 * taps a list row and presses back gets a freshly mounted component and its
 * initial value, which is the bug this exists to fix.
 *
 * Writes REPLACE the current history entry; they never push. That is the whole
 * trick, and it is the opposite of the intuition that restoring on back needs
 * a pushed entry:
 *
 *   - `replace` rewrites the URL the CURRENT entry stores. Navigating away
 *     pushes a new entry; coming back pops to the rewritten one, so the param
 *     — and the UI state it encodes — is restored for free.
 *   - `push` would work too, but it makes every open/close pair leave a dead
 *     entry that silently swallows one back press.
 *
 * The back doctrine is therefore unchanged: a back press still closes the
 * topmost layer, and a tab switch is an edit, not a navigation, so it stays
 * out of history.
 */
export function useUrlParam(name: string): [string | null, (value: string | null) => void] {
  const [searchParams] = useSearchParams();
  const patch = useUrlPatch();

  const setValue = useCallback((value: string | null) => patch({ [name]: value }), [name, patch]);

  return [searchParams.get(name), setValue];
}
