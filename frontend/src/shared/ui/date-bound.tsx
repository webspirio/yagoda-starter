import { useRef, useState } from 'react';
import { isRealIsoDate } from '@/shared/lib/date';
import { TextInput } from '@/shared/ui/text-input';

/** The default `min`. Anything before it is a year still being typed
 *  (`0002-…`, `0202-…`), never a period anyone means. */
const MIN_PICKABLE_DATE = '2020-01-01';

/** Keys that move focus, move between segments, only modify another key, or
 *  dismiss the picker — not an edit of the date. */
const NON_EDIT_KEYS = new Set([
  'Tab',
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'Escape',
  'ArrowLeft',
  'ArrowRight',
]);

/** `Alt`+`↓`/`↑` opens the calendar from the keyboard, so the choice that
 *  follows is a pick, not typing — the keyboard's `pointerdown`. */
const opensPicker = (e: { key: string; altKey: boolean }) =>
  e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp');

/**
 * One bound of a date period, with TWO ways in that must commit differently.
 * A value outside `[min, max]` or off the calendar is never committed.
 *
 * TYPING commits on blur or Enter only. A native date input reports a
 * complete date after every segment edit: typing `10` into the day passes
 * through the 1st, `12` into the month through January, a year through
 * `0002-…` and `0202-…`. Any commit mid-edit — at once or after a pause — fires
 * a request for a period nobody asked for and can drag the OTHER bound
 * (where the caller keeps the period valid), losing it for good.
 *
 * THE CALENDAR PICKER commits at once. Choosing a date fires `change` with no
 * keystroke and leaves focus in the field, so waiting for a blur would leave
 * the old period's rows under the new label — and on touch the picker is the
 * only way in. A keystroke in the field is what tells the two apart, so no
 * timer has to guess.
 *
 * The draft follows `value` when it changes from outside (a preset, the other
 * bound dragging this one) by remembering the value it was last synced to —
 * React's «adjust state when a prop changes», with no effect and no remount,
 * so focus stays where the user left it.
 */
export function DateBound({
  label,
  value,
  min = MIN_PICKABLE_DATE,
  max,
  onCommit,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onCommit: (value: string) => void;
}) {
  const isPickable = (v: string) =>
    isRealIsoDate(v) && v >= min && (max === undefined || v <= max);
  const [draft, setDraft] = useState(value);
  const [syncedTo, setSyncedTo] = useState(value);
  if (syncedTo !== value) {
    setSyncedTo(value);
    setDraft(value);
  }
  // Set by a keystroke in the field, cleared by a commit: «this draft is being
  // typed». Only read in handlers, never during render.
  const typing = useRef(false);

  const commit = (next: string) => {
    typing.current = false;
    if (!isPickable(next)) setDraft(value);
    else if (next !== value) onCommit(next);
  };

  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <TextInput
        type="date"
        className="h-8.5 w-auto"
        value={draft}
        min={min}
        max={max}
        onChange={(e) => {
          setDraft(e.target.value);
          if (!typing.current && isPickable(e.target.value)) commit(e.target.value);
        }}
        onBlur={() => commit(draft)}
        // A pointer in the field (opening the picker, clicking a segment)
        // starts a fresh gesture; a keystroke after it flags typing again.
        onPointerDown={() => {
          typing.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(draft);
          else if (opensPicker(e)) typing.current = false;
          else if (!NON_EDIT_KEYS.has(e.key)) typing.current = true;
        }}
      />
    </label>
  );
}
