import type { SyntheticEvent } from 'react';

/**
 * React bubbles a synthetic event along the FIBER tree, not the DOM tree — a
 * dialog portaled to `document.body` (e.g. `SupplierFormDialog`, rendered
 * inline by `SupplierPicker` inside this page's `<form>`) still counts as a
 * descendant of that `<form>` in React's own component tree, even though its
 * DOM node lives outside the `<form>` element entirely. Left unguarded, the
 * dialog's own `submit`/`keydown` reaches the page form's `onSubmit`/
 * `onKeyDown` handlers as if the operator had triggered them directly.
 *
 * `true` only when the event's real DOM target is actually inside the DOM
 * element the handler is attached to — i.e. this event genuinely belongs to
 * THIS form, not to a portaled descendant that merely shares its React tree.
 */
export function isOwnFormEvent(e: SyntheticEvent<Element>): boolean {
  return e.currentTarget.contains(e.target as Node);
}
