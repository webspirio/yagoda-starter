/**
 * The fields Enter walks through on the reception form, in DOM order:
 * product, grade, price, gross, pallet (while shown), each tare row's type and
 * count, «Ще позиція», «Видано готівкою». Enter is how an operator moves on
 * the scale's numeric pad, so the walk is opt-in: a field joins it by
 * spreading `ENTRY_FIELD`. A disabled stop is skipped (an unfinished line
 * goes past «Ще позиція» to the payout) unless it carries `ENTRY_WAIT` — about
 * to be enabled, so Enter waits on it rather than jumping past (a finished
 * line whose preview is still in flight). On a button Enter is the button's
 * own click. The steppers stay out of it, and out of Tab.
 *
 * A stop with `ENTRY_EXIT` leaves its line (`ENTRY_LINE`): Enter goes to the
 * first stop past it — an empty «Товар» on a line after the first is the
 * operator saying the receipt has no more lines, so it is «Видано готівкою».
 */
export const ENTRY_FIELD = { 'data-entry-field': '' } as const;
export const ENTRY_WAIT = { 'data-entry-wait': '' } as const;
export const ENTRY_EXIT = { 'data-entry-exit': '' } as const;
export const ENTRY_LINE = { 'data-entry-line': '' } as const;

/** The next entry field after `from` inside `form` that is enabled or waited
 *  on (`ENTRY_WAIT`), or `null` when `from` is the last one (or not an entry
 *  field at all). */
export function nextEntryField(form: HTMLElement, from: Element): HTMLElement | null {
  const fields = [...form.querySelectorAll<HTMLElement>('[data-entry-field]')];
  const at = fields.indexOf(from as HTMLElement);
  if (at === -1) return null;
  const line = from.hasAttribute('data-entry-exit') ? from.closest('[data-entry-line]') : null;
  return (
    fields
      .slice(at + 1)
      .filter((field) => line === null || !line.contains(field))
      .find(
        (field) =>
          !(field as HTMLInputElement).disabled || field.hasAttribute('data-entry-wait'),
      ) ?? null
  );
}
