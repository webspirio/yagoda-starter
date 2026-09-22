import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Shift } from '@/entities/shift';
import type { CashCount } from '@/entities/cash-count';
import { expectNoAxeViolations } from '../../../test-axe';
import { ShiftCountPanel } from './ShiftCountPanel';

// `RecountDrawerDialog` owns a real mutation (`useRecountMutation`) that
// needs a `QueryClientProvider` this suite has no reason to wire up — it has
// its own full suite already (`RecountDrawerDialog.test.tsx`). This panel's
// own job is only to open/close it, which a stub with the same `open` prop
// proves just as well.
vi.mock('@/features/count-shift', () => ({
  RecountDrawerDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Recount dialog</div> : null,
}));

const shift = (over: Partial<Shift> = {}): Shift => ({
  id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-22',
  status: 'open',
  opened_by_user_id: 'u1',
  opened_by_name: 'Olha',
  closed_by_user_id: null,
  closed_by_name: null,
  closed_at: null,
  created_at: '2026-09-22T07:00:00.000Z',
  explanation: null,
  broken_crates: null,
  ...over,
});

const count = (over: Partial<CashCount> = {}): CashCount => ({
  id: 'c1',
  shift_id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-22',
  book: 'berry',
  kind: 'opening',
  counted_amount: '1000.00',
  expected_amount: '1000.00',
  discrepancy: '0.00',
  is_open: false,
  counted_by_user_id: 'u1',
  counted_by_name: 'Olha',
  counted_at: '2026-09-22T07:00:00.000Z',
  explanation: null,
  ...over,
});

const noop = () => {};

describe('ShiftCountPanel — the shift line and names', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('shows «Shift open» and the opening time, TZ pinned for a fixed literal', () => {
    vi.stubEnv('TZ', 'UTC');
    render(
      <ShiftCountPanel
        shift={shift({ status: 'open' })}
        isShiftLoading={false}
        counts={[]}
        isOperator={false}
        isToday
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByText('Shift open')).toBeInTheDocument();
    expect(screen.getByText('since 07:00 AM')).toBeInTheDocument();
  });

  it('shows «Shift closed» and the from/to range', () => {
    vi.stubEnv('TZ', 'UTC');
    render(
      <ShiftCountPanel
        shift={shift({
          status: 'closed',
          closed_at: '2026-09-22T15:30:00.000Z',
          closed_by_name: 'Petro',
        })}
        isShiftLoading={false}
        counts={[]}
        isOperator={false}
        isToday
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByText('Shift closed')).toBeInTheDocument();
    expect(screen.getByText('07:00 AM to 03:30 PM')).toBeInTheDocument();
  });

  it('shows the opening and closing counted figures', () => {
    render(
      <ShiftCountPanel
        shift={shift({ status: 'closed', closed_by_name: 'Petro' })}
        isShiftLoading={false}
        counts={[
          count({ kind: 'opening', counted_amount: '1000.00' }),
          count({ id: 'c2', kind: 'closing', counted_amount: '1450.00', discrepancy: '0.00' }),
        ]}
        isOperator={false}
        isToday={false}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByText('Counted this morning')).toBeInTheDocument();
    expect(screen.getByText('1,000.00 ₴')).toBeInTheDocument();
    expect(screen.getByText('Counted at close')).toBeInTheDocument();
    expect(screen.getByText('1,450.00 ₴')).toBeInTheDocument();
  });

  it('shows no closing row, and no discrepancy pill, on a shift still open', () => {
    render(
      <ShiftCountPanel
        shift={shift({ status: 'open' })}
        isShiftLoading={false}
        counts={[count({ kind: 'opening' })]}
        isOperator={false}
        isToday
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.queryByText('Counted at close')).toBeNull();
    expect(screen.queryByText('Discrepancy')).toBeNull();
  });

  it('shows a leaf discrepancy pill when the closing count matched', () => {
    render(
      <ShiftCountPanel
        shift={shift({ status: 'closed', closed_by_name: 'Petro' })}
        isShiftLoading={false}
        counts={[count({ kind: 'closing', discrepancy: '0.00' })]}
        isOperator={false}
        isToday={false}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByText('Discrepancy').closest('span')).toHaveClass('text-leaf');
  });

  it('shows a destructive discrepancy pill when the closing count did not match', () => {
    render(
      <ShiftCountPanel
        shift={shift({ status: 'closed', closed_by_name: 'Petro' })}
        isShiftLoading={false}
        counts={[count({ kind: 'closing', discrepancy: '-25.00' })]}
        isOperator={false}
        isToday={false}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByText('Discrepancy').closest('span')).toHaveClass('text-destructive');
  });

  it('names who closed the shift', () => {
    render(
      <ShiftCountPanel
        shift={shift({ status: 'closed', closed_by_name: 'Petro' })}
        isShiftLoading={false}
        counts={[]}
        isOperator={false}
        isToday={false}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByText('closed by Petro')).toBeInTheDocument();
  });

  it('quotes the owner’s explanation in italics', () => {
    render(
      <ShiftCountPanel
        shift={shift({
          status: 'closed',
          closed_by_name: 'Petro',
          explanation: 'Double-paid a payout',
        })}
        isShiftLoading={false}
        counts={[]}
        isOperator={false}
        isToday={false}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    const note = screen.getByText('“Double-paid a payout”');
    expect(note).toHaveClass('italic');
  });

  it('shows no shift line at all when the date has no shift', () => {
    render(
      <ShiftCountPanel
        shift={null}
        isShiftLoading={false}
        counts={[]}
        isOperator={false}
        isToday
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.queryByText('Shift open')).toBeNull();
    expect(screen.queryByText('Shift closed')).toBeNull();
  });

  it('shows a spinner rather than guessing while the shift read is in flight', () => {
    render(
      <ShiftCountPanel
        shift={null}
        isShiftLoading
        counts={[]}
        isOperator
        isToday
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    // Nothing claims «no shift» before the read settles.
    expect(screen.queryByRole('button', { name: /open shift/i })).toBeNull();
  });
});

describe('ShiftCountPanel — the day’s recounts', () => {
  it('says the drawer was not recounted today when the midday list is empty', () => {
    render(
      <ShiftCountPanel
        shift={shift()}
        isShiftLoading={false}
        counts={[]}
        isOperator={false}
        isToday
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByText('The drawer has not been recounted today.')).toBeInTheDocument();
  });

  it('lists a midday row with its time, ✓/⚠ and the counted figure — ignoring the crates book', () => {
    vi.stubEnv('TZ', 'UTC');
    render(
      <ShiftCountPanel
        shift={shift()}
        isShiftLoading={false}
        counts={[
          count({
            id: 'm1',
            kind: 'midday',
            counted_amount: '1200.00',
            discrepancy: '0.00',
            counted_at: '2026-09-22T10:00:00.000Z',
          }),
          count({ id: 'm2', kind: 'midday', book: 'crates', counted_amount: '999.00' }),
        ]}
        isOperator={false}
        isToday
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByText('Recounted at 10:00 AM')).toBeInTheDocument();
    expect(screen.getByText('✓ matched')).toBeInTheDocument();
    expect(screen.getByText('1,200.00 ₴')).toBeInTheDocument();
    expect(screen.queryByText('999.00 ₴')).toBeNull();
    vi.unstubAllEnvs();
  });

  it('marks a mismatched midday recount ⚠, in destructive tone', () => {
    render(
      <ShiftCountPanel
        shift={shift()}
        isShiftLoading={false}
        counts={[count({ id: 'm1', kind: 'midday', discrepancy: '-15.00' })]}
        isOperator={false}
        isToday
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    const mismatch = screen.getByText('⚠ did not match');
    expect(mismatch).toHaveClass('text-destructive');
  });

  it('lists several midday recounts oldest first', () => {
    vi.stubEnv('TZ', 'UTC');
    render(
      <ShiftCountPanel
        shift={shift()}
        isShiftLoading={false}
        counts={[
          count({ id: 'm2', kind: 'midday', counted_at: '2026-09-22T14:00:00.000Z' }),
          count({ id: 'm1', kind: 'midday', counted_at: '2026-09-22T09:00:00.000Z' }),
        ]}
        isOperator={false}
        isToday
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    const times = screen.getAllByText(/^Recounted at/).map((el) => el.textContent);
    expect(times).toEqual(['Recounted at 09:00 AM', 'Recounted at 02:00 PM']);
    vi.unstubAllEnvs();
  });
});

describe('ShiftCountPanel — the four action states, per role', () => {
  it('operator, open shift today: offers Recount and Close', () => {
    render(
      <ShiftCountPanel
        shift={shift({ status: 'open' })}
        isShiftLoading={false}
        counts={[]}
        isOperator
        isToday
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByRole('button', { name: /Recount the drawer/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close shift' })).toBeInTheDocument();
  });

  it('owner, open shift today: no actions at all', () => {
    render(
      <ShiftCountPanel
        shift={shift({ status: 'open' })}
        isShiftLoading={false}
        counts={[]}
        isOperator={false}
        isToday
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.queryByRole('button', { name: /Recount the drawer/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close shift' })).toBeNull();
  });

  it('operator, closed shift that day: the settled note, no button', () => {
    render(
      <ShiftCountPanel
        shift={shift({ status: 'closed', closed_by_name: 'Petro' })}
        isShiftLoading={false}
        counts={[]}
        isOperator
        isToday={false}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(
      screen.getByText(
        "This day's shift is already settled. A second book is never opened for the same drawer, and a recount does not attach to a closed shift.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('owner, closed shift that day: no note, no button', () => {
    render(
      <ShiftCountPanel
        shift={shift({ status: 'closed', closed_by_name: 'Petro' })}
        isShiftLoading={false}
        counts={[]}
        isOperator={false}
        isToday={false}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(
      screen.queryByText(
        "This day's shift is already settled. A second book is never opened for the same drawer, and a recount does not attach to a closed shift.",
      ),
    ).toBeNull();
  });

  it('operator, no shift, today: offers Open shift with its caption', () => {
    render(
      <ShiftCountPanel
        shift={null}
        isShiftLoading={false}
        counts={[]}
        isOperator
        isToday
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByRole('button', { name: 'Open shift' })).toBeInTheDocument();
    expect(screen.getByText('a recount attaches to an open shift')).toBeInTheDocument();
  });

  it('owner, no shift, today: no button, no caption', () => {
    render(
      <ShiftCountPanel
        shift={null}
        isShiftLoading={false}
        counts={[]}
        isOperator={false}
        isToday
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Open shift' })).toBeNull();
    expect(screen.queryByText('a recount attaches to an open shift')).toBeNull();
  });

  it('operator, no shift, a past date: the nothing-to-attach-to note', () => {
    render(
      <ShiftCountPanel
        shift={null}
        isShiftLoading={false}
        counts={[]}
        isOperator
        isToday={false}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(
      screen.getByText('There is no shift for this day — there is nothing for a recount to attach to.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('owner, no shift, a past date: no note', () => {
    render(
      <ShiftCountPanel
        shift={null}
        isShiftLoading={false}
        counts={[]}
        isOperator={false}
        isToday={false}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(
      screen.queryByText(
        'There is no shift for this day — there is nothing for a recount to attach to.',
      ),
    ).toBeNull();
  });

  it('always shows the footnote, whatever the state', () => {
    render(
      <ShiftCountPanel
        shift={null}
        isShiftLoading={false}
        counts={[]}
        isOperator={false}
        isToday={false}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(
      screen.getByText(
        'The drawer can be recounted as many times a day as needed — every recount stays its own record and corrects nothing.',
      ),
    ).toBeInTheDocument();
  });
});

describe('ShiftCountPanel — wiring the actions', () => {
  it('opens the recount dialog from its button', async () => {
    const user = userEvent.setup();
    render(
      <ShiftCountPanel
        shift={shift({ status: 'open' })}
        isShiftLoading={false}
        counts={[]}
        isOperator
        isToday
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Recount the drawer/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Recount dialog');
  });

  it('calls onCloseShift with the open shift’s id', async () => {
    const user = userEvent.setup();
    const onCloseShift = vi.fn();
    render(
      <ShiftCountPanel
        shift={shift({ id: 's7', status: 'open' })}
        isShiftLoading={false}
        counts={[]}
        isOperator
        isToday
        onOpenShift={noop}
        onCloseShift={onCloseShift}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    expect(onCloseShift).toHaveBeenCalledWith('s7');
  });

  it('calls onOpenShift from the open button', async () => {
    const user = userEvent.setup();
    const onOpenShift = vi.fn();
    render(
      <ShiftCountPanel
        shift={null}
        isShiftLoading={false}
        counts={[]}
        isOperator
        isToday
        onOpenShift={onOpenShift}
        onCloseShift={noop}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open shift' }));
    expect(onOpenShift).toHaveBeenCalled();
  });

  it('has no axe violations across the busiest state (closed shift, midday history, both roles)', async () => {
    const { container, rerender } = render(
      <ShiftCountPanel
        shift={shift({ status: 'closed', closed_by_name: 'Petro', explanation: 'Recounted twice' })}
        isShiftLoading={false}
        counts={[
          count({ id: 'op', kind: 'opening' }),
          count({ id: 'md', kind: 'midday', discrepancy: '-5.00' }),
          count({ id: 'cl', kind: 'closing', discrepancy: '-5.00' }),
        ]}
        isOperator
        isToday={false}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );
    await expectNoAxeViolations(container);

    rerender(
      <ShiftCountPanel
        shift={shift({ status: 'closed', closed_by_name: 'Petro', explanation: 'Recounted twice' })}
        isShiftLoading={false}
        counts={[
          count({ id: 'op', kind: 'opening' }),
          count({ id: 'md', kind: 'midday', discrepancy: '-5.00' }),
          count({ id: 'cl', kind: 'closing', discrepancy: '-5.00' }),
        ]}
        isOperator={false}
        isToday={false}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );
    await expectNoAxeViolations(container);
  });
});
