import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateBound } from './date-bound';

function renderBound(props: { min?: string; max?: string } = {}) {
  const onCommit = vi.fn();
  render(<DateBound label="From" value="2026-09-10" onCommit={onCommit} {...props} />);
  return { onCommit, input: screen.getByLabelText('From') };
}

/** A calendar pick: a `change` with no keystroke before it commits at once. */
const pick = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } });

describe('DateBound', () => {
  it('commits a picked date inside [min, max]', () => {
    const { onCommit, input } = renderBound({ min: '2026-09-01', max: '2026-09-30' });
    pick(input, '2026-09-30');
    expect(onCommit).toHaveBeenCalledWith('2026-09-30');
  });

  it.each([
    ['after max', '2026-10-01'],
    ['before min', '2026-08-31'],
    ['off the calendar', '2026-02-30'],
  ])('never commits a date %s, and snaps back on blur', (_, value) => {
    const { onCommit, input } = renderBound({ min: '2026-09-01', max: '2026-09-30' });
    pick(input, value);
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue('2026-09-10');
  });

  it('has no upper bound without max, and refuses a year still being typed by default', () => {
    const { onCommit, input } = renderBound();
    pick(input, '2031-01-01');
    expect(onCommit).toHaveBeenLastCalledWith('2031-01-01');
    pick(input, '0202-09-10');
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
