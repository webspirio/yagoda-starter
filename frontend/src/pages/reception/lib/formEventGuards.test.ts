import { describe, it, expect } from 'vitest';
import type { SyntheticEvent } from 'react';
import { isOwnFormEvent } from './formEventGuards';

/** A minimal stand-in for the bits of `SyntheticEvent` the guard reads. */
function fakeEvent(currentTarget: Element, target: Element): SyntheticEvent<Element> {
  return { currentTarget, target } as unknown as SyntheticEvent<Element>;
}

describe('isOwnFormEvent', () => {
  it('is true when the event target sits inside the DOM node the handler is on', () => {
    const form = document.createElement('form');
    const input = document.createElement('input');
    form.appendChild(input);

    expect(isOwnFormEvent(fakeEvent(form, input))).toBe(true);
  });

  it('is true when the target IS the handler node itself', () => {
    const form = document.createElement('form');
    expect(isOwnFormEvent(fakeEvent(form, form))).toBe(true);
  });

  it('is false when the target lives outside the DOM node — a portaled descendant', () => {
    // Mirrors `SupplierFormDialog`: rendered inline in the REACT tree, but
    // portaled to `document.body` in the DOM — its input is a React
    // descendant of the outer form without being a DOM one.
    const form = document.createElement('form');
    const portaled = document.createElement('input');
    document.body.appendChild(portaled);

    expect(isOwnFormEvent(fakeEvent(form, portaled))).toBe(false);

    portaled.remove();
  });
});
