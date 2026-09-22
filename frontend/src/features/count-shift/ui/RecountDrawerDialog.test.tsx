import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/shared/api';
import { expectNoAxeViolations } from '../../../test-axe';
import { RecountDrawerDialog } from './RecountDrawerDialog';

// Same convention `PayoutDialog.test.tsx` uses for a dialog that owns its
// mutation directly (no `onConfirm` prop, unlike `CountDrawerDialog`) — the
// wire contract (book/amount) already has its own suite in `recount.test.tsx`,
// so this file mocks the hook and pins the dialog's OWN behaviour: the
// result view, and the NO_OPEN_SHIFT → recount-specific banner mapping.
const { recountMock } = vi.hoisted(() => ({ recountMock: vi.fn() }));

vi.mock('../api/recount', () => ({
  useRecountMutation: () => ({ mutateAsync: recountMock }),
}));

const COUNT_ROW = {
  id: 'c1',
  shift_id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-22',
  book: 'berry',
  kind: 'midday',
  counted_amount: '1500.00',
  expected_amount: '1500.00',
  discrepancy: '0.00',
  is_open: false,
  counted_by_user_id: 'u1',
  counted_by_name: 'Olha',
  counted_at: '2026-09-22T12:00:00Z',
  explanation: null,
};

beforeEach(() => {
  recountMock.mockReset().mockResolvedValue(COUNT_ROW);
});

function setup(onClose = vi.fn()) {
  render(<RecountDrawerDialog open onClose={onClose} />);
  return onClose;
}

describe('RecountDrawerDialog', () => {
  it('posts the normalised amount through the recount mutation, and is axe-clean', async () => {
    const { container } = render(<RecountDrawerDialog open onClose={vi.fn()} />);

    await userEvent.type(screen.getByRole('textbox'), '1 500,00');
    await userEvent.click(screen.getByRole('button', { name: 'Recorded the count' }));

    await waitFor(() =>
      expect(recountMock).toHaveBeenCalledWith({ counted_amount: '1500.00' }),
    );
    await expectNoAxeViolations(container);
  });

  it('never shows the expected figure before a count is submitted', () => {
    setup();
    expect(screen.queryByText(/expected/i)).toBeNull();
  });

  it('refuses to submit an empty amount', async () => {
    const onClose = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Recorded the count' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(recountMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the result view — expected, counted and a matched pill — after a matching recount', async () => {
    setup();

    await userEvent.type(screen.getByRole('textbox'), '1500.00');
    await userEvent.click(screen.getByRole('button', { name: 'Recorded the count' }));

    expect(await screen.findByText('Expected')).toBeInTheDocument();
    expect(screen.getByText('Counted')).toBeInTheDocument();
    expect(screen.getAllByText('1,500.00 ₴')).toHaveLength(2);
    expect(screen.getByText('Discrepancy')).toBeInTheDocument();
    // A matched recount carries no «cannot be changed» line.
    expect(screen.queryByText(/cannot be changed/i)).toBeNull();
    // The amount field is gone — only the result and its «Done» button remain.
    expect(screen.queryByRole('textbox')).toBeNull();
    // ONE dialog, whose body swapped — never a second one briefly coexisting
    // with the first mid-animation (review round 3, minor 4).
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('shows the discrepancy note when the recount does not match', async () => {
    recountMock.mockResolvedValue({
      ...COUNT_ROW,
      counted_amount: '1450.00',
      discrepancy: '-50.00',
      is_open: true,
    });
    setup();

    await userEvent.type(screen.getByRole('textbox'), '1450.00');
    await userEvent.click(screen.getByRole('button', { name: 'Recorded the count' }));

    expect(
      await screen.findByText(/This figure cannot be changed in the app/),
    ).toBeInTheDocument();
  });

  it('closes via «Done» after showing the result', async () => {
    const onClose = setup();

    await userEvent.type(screen.getByRole('textbox'), '1500.00');
    await userEvent.click(screen.getByRole('button', { name: 'Recorded the count' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('maps a refused recount (NO_OPEN_SHIFT) onto its own sentence, not the generic transfer banner', async () => {
    recountMock.mockRejectedValue(new ApiError(409, 'nope', undefined, 'NO_OPEN_SHIFT'));
    setup();

    await userEvent.type(screen.getByRole('textbox'), '1500.00');
    await userEvent.click(screen.getByRole('button', { name: 'Recorded the count' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A recount does not attach to a closed shift — you can only count while the shift is open.',
    );
    // Never the shared transfer-side wording for the same code, and never
    // the (client-side validation, unrelated) amount-format message either.
    expect(screen.queryByText('No open shift at this point — open one first')).toBeNull();
    expect(
      screen.queryByText('Enter the amount you counted in the drawer — a number, not less than zero.'),
    ).toBeNull();
  });

  it('falls back to the generic recount failure for an unmapped error', async () => {
    recountMock.mockRejectedValue(new Error('network down'));
    setup();

    await userEvent.type(screen.getByRole('textbox'), '1500.00');
    await userEvent.click(screen.getByRole('button', { name: 'Recorded the count' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not record the recount');
  });

  it('stays open and keeps the typed amount when the mutation is refused', async () => {
    recountMock.mockRejectedValue(new Error('network down'));
    const onClose = setup();

    await userEvent.type(screen.getByRole('textbox'), '1500.00');
    await userEvent.click(screen.getByRole('button', { name: 'Recorded the count' }));

    await screen.findByRole('alert');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('1500.00');
  });
});

/**
 * A tiny parent that owns `open`/`key` itself — the same shape
 * `ShiftCountPanel` wires up for its own `recountInstance` (bump the key,
 * THEN open): a real `QueryClientProvider` in the tree, since that is how
 * this dialog is always mounted outside a test, and `Reopen` bumps `key`
 * so the second recount of the day gets a genuinely fresh mount rather than
 * `open` alone flipping false→true on the SAME instance (which would leave
 * last time's `result`/form state sitting in place).
 */
function RecountHarness() {
  const [client] = useState(() => new QueryClient());
  const [instance, setInstance] = useState(0);
  const [open, setOpen] = useState(true);
  const reopen = () => {
    setInstance((n) => n + 1);
    setOpen(true);
  };
  return (
    <QueryClientProvider client={client}>
      <button onClick={reopen}>Reopen</button>
      <RecountDrawerDialog key={`recount-${instance}`} open={open} onClose={() => setOpen(false)} />
    </QueryClientProvider>
  );
}

describe('RecountDrawerDialog — the second recount of the day starts blank (Important 3)', () => {
  it('shows an empty amount field and no stale result after a submit, a close and a re-open', async () => {
    render(<RecountHarness />);

    await userEvent.type(screen.getByRole('textbox'), '1500.00');
    await userEvent.click(screen.getByRole('button', { name: 'Recorded the count' }));
    expect(await screen.findByText('Expected')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }));

    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.queryByText('Expected')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
