import { useState } from 'react';
import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TotalsSection } from './TotalsSection';

/**
 * `TotalsSection` is controlled (`paid` + `onPaidChange`) — this harness owns
 * the state so a click on a chip or a keystroke in the field is visible in
 * the next render, exactly as `ReceptionPage` wires it.
 *
 * Fixture: accrued 5460.00 + a carried debt of 37.37 → total 5497.37; a
 * drawer of 1616.10 caps the payout below that total, which is what makes
 * the cash-note / clamp / remainder cases below meaningfully different from
 * "just pay the total".
 */
function Harness({
  paid: initialPaid = '',
  ...rest
}: Partial<ComponentProps<typeof TotalsSection>> & { paid?: string }) {
  const [paid, setPaid] = useState(initialPaid);
  return (
    <TotalsSection
      accrued="5460.00"
      netKg="39.00"
      lineCount={1}
      debt="37.37"
      cash="1616.10"
      cashUnavailable={false}
      paidError={null}
      disabled={false}
      isPreviewing={false}
      isSubmitting={false}
      formErrorKey={null}
      showDraftHint={false}
      {...rest}
      paid={paid}
      onPaidChange={setPaid}
    />
  );
}

describe('TotalsSection — the total and the carried-in balance', () => {
  it('shows «Разом до видачі» as today’s accrual plus the positive balance', () => {
    render(<Harness />);
    // Scoped to the total row: with nothing paid yet the remainder box
    // legitimately reads the SAME figure, so a bare `getByText` would match
    // both and turn an ambiguity into a false failure.
    expect(screen.getByText('Total to pay out').parentElement).toHaveTextContent('5,497.37 ₴');
    // The amber row that carries the balance in, labelled with the same
    // «Previous balance» copy the supplier section uses.
    expect(screen.getByText('+ 37.37 ₴')).toBeInTheDocument();
  });
});

describe('TotalsSection — the chips', () => {
  it('«Full amount» and «All to balance» set the paid value to the cap and to zero', async () => {
    const user = userEvent.setup();
    // Cash ample enough that the cap is the TOTAL, not the drawer — isolates
    // the chips' own arithmetic from the cash cap tested separately below.
    render(<Harness cash="9000.00" />);
    const input = screen.getByLabelText('Paid in cash');

    await user.click(screen.getByRole('button', { name: 'Full amount' }));
    expect(input).toHaveValue('5497.37');

    await user.click(screen.getByRole('button', { name: 'Round to 100' }));
    expect(input).toHaveValue('5400.00');

    await user.click(screen.getByRole('button', { name: 'All to balance' }));
    expect(input).toHaveValue('0');
  });

  it('disables «Round to 100» when the CAP is under 100, even though the total is not', () => {
    // total (5497.37) is nowhere near 100 — only a tiny drawer makes the cap
    // small. A `total < 100` check would leave this enabled; `cap < 100` (the
    // brief's own code, not its prose) disables it.
    render(<Harness cash="50.00" />);
    expect(screen.getByRole('button', { name: 'Round to 100' })).toBeDisabled();
  });

  it('leaves «Round to 100» enabled once the cap clears 100', () => {
    render(<Harness cash="9000.00" />);
    expect(screen.getByRole('button', { name: 'Round to 100' })).toBeEnabled();
  });
});

describe('TotalsSection — the remainder panel', () => {
  it('reads «Owed by us» and the cash note when less than the total is paid out', () => {
    render(<Harness paid="1616.10" />);
    expect(
      screen.getByText(/Only 1,616.10 ₴ is in the berry drawer/),
    ).toBeInTheDocument();
    expect(screen.getByText('Owed by us')).toBeInTheDocument();
    expect(screen.getByText('3,881.27 ₴')).toBeInTheDocument();
  });

  it('reads «Settled in full» once the whole total is paid out', () => {
    render(<Harness paid="5497.37" />);
    expect(screen.getByText('Settled in full')).toBeInTheDocument();
    expect(screen.queryByText('Owed by us')).toBeNull();
  });

  it('shows a neutral dash instead of a false «Settled in full» before anything has settled (M1)', () => {
    render(<Harness accrued={null} netKg={null} />);
    expect(screen.queryByText('Settled in full')).toBeNull();
    expect(screen.queryByText('Owed by us')).toBeNull();
    // The right panel now echoes the SAME «Total to pay out» eyebrow the left
    // column shows, instead of claiming settlement over a total that isn't
    // there yet.
    expect(screen.getAllByText('Total to pay out')).toHaveLength(2);
  });
});

describe('TotalsSection — the cap and the clamp', () => {
  it('clamps an over-cap figure on blur, naming the DRAWER when that is what limits it (M2)', async () => {
    const user = userEvent.setup();
    // The default fixture's cap is the cash drawer (1616.10), not the total
    // (5497.37) — so the note has to say "the berry drawer", not "the total".
    render(<Harness />);
    const input = screen.getByLabelText('Paid in cash');

    await user.type(input, '9999');
    expect(input).toHaveValue('9999');
    expect(
      screen.getByText('Cannot pay out more than is in the berry drawer — using 1,616.10 ₴'),
    ).toBeInTheDocument();

    await user.tab();
    expect(input).toHaveValue('1616.10');
  });

  it('names the TOTAL instead once cash is ample enough that the cap IS the total (M2)', async () => {
    const user = userEvent.setup();
    render(<Harness cash="9000.00" />);
    const input = screen.getByLabelText('Paid in cash');

    await user.type(input, '9999');
    expect(
      screen.getByText('Cannot pay out more than the total — using 5,497.37 ₴'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/is in the berry drawer/)).toBeNull();
  });

  it('gives the clamp note a warning tone, leaves the plain state muted, and stays muted when the drawer is unavailable even over the cap', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    const input = screen.getByLabelText('Paid in cash');

    // Plain state: no clamp note yet, so the (absent) hint has nothing to warn about.
    expect(screen.queryByText(/Cannot pay out more than/)).toBeNull();

    await user.type(input, '9999');
    expect(
      screen.getByText('Cannot pay out more than is in the berry drawer — using 1,616.10 ₴'),
    ).toHaveClass('text-amber');
    unmount();

    // Composition rule: a failed cash read is information, not a warning
    // about what the operator typed — so the hint stays muted even though
    // the typed amount is (still) over whatever cap would otherwise apply.
    render(<Harness cash={null} cashUnavailable />);
    const input2 = screen.getByLabelText('Paid in cash');
    await user.type(input2, '9999');
    expect(
      screen.getByText(
        'The berry cash drawer could not be read — the server will check the amount when the receipt is recorded',
      ),
    ).not.toHaveClass('text-amber');
  });

  it('a null (unread) drawer clamps to the TOTAL on blur, not to zero, and shows no cash note (review finding 2)', async () => {
    const user = userEvent.setup();
    // `cash === null` must never read as an empty drawer: the cap is the
    // uncapped total (`suggestedPaid`), so typing above it clamps to
    // 5497.37, never to 0.00, and neither cash-related note (the amber
    // over-cash chip note nor the below-form cash note) renders.
    render(<Harness cash={null} />);
    const input = screen.getByLabelText('Paid in cash');

    await user.type(input, '9999');
    expect(input).toHaveValue('9999');

    await user.tab();
    expect(input).toHaveValue('5497.37');
    expect(screen.queryByText(/berry drawer/)).toBeNull();
  });

  it('cashUnavailable renders a muted note instead, and it does not depend on typing anything', () => {
    render(<Harness cash={null} cashUnavailable />);
    expect(
      screen.getByText(
        'The berry cash drawer could not be read — the server will check the amount when the receipt is recorded',
      ),
    ).toBeInTheDocument();
  });

  it('does not touch «Видано готівкою» on a blur that changes nothing (I4)', async () => {
    const user = userEvent.setup();
    const onPaidChange = vi.fn();
    // The suggested/cash-capped value is ALREADY canonical — tabbing through
    // without typing anything must be a no-op, not a `paidTouched` latch on
    // the caller's side.
    render(
      <TotalsSection
        accrued="5460.00"
        netKg="39.00"
        lineCount={1}
        debt="37.37"
        cash="1616.10"
        cashUnavailable={false}
        paid="1616.10"
        onPaidChange={onPaidChange}
        paidError={null}
        disabled={false}
        isPreviewing={false}
        isSubmitting={false}
        formErrorKey={null}
        showDraftHint={false}
      />,
    );

    await user.click(screen.getByLabelText('Paid in cash'));
    await user.tab();

    expect(onPaidChange).not.toHaveBeenCalled();
  });

  it('canonicalises a trailing separator on blur (I5)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Paid in cash');

    await user.type(input, '1200,');
    expect(input).toHaveValue('1200.');

    await user.tab();
    expect(input).toHaveValue('1200.00');
  });
});

describe('TotalsSection — the submit label', () => {
  it('reads the accepted weight and the payout together once something is paid', () => {
    render(<Harness paid="1616.10" />);
    expect(
      screen.getByRole('button', { name: 'Accept 39.00 kg · pay out 1,616.10 ₴' }),
    ).toBeInTheDocument();
  });

  it('falls back to the plain kg label when nothing is being paid out', () => {
    render(<Harness paid="0" />);
    expect(screen.getByRole('button', { name: 'Accept 39.00 kg' })).toBeInTheDocument();
  });

  it('falls back to the bare label while the preview has not settled on a net weight', () => {
    render(<Harness netKg={null} paid="1616.10" />);
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
  });
});

describe('TotalsSection — refusal and hints', () => {
  it('renders a server refusal on «Видано готівкою» as an alert', () => {
    render(<Harness paidError="reception.errors.paidExceedsCash" />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The receipt was not recorded: the berry cash drawer holds less. Lower the amount and try again.',
    );
  });

  it('renders the form-level banner as its own alert', () => {
    render(<Harness formErrorKey="reception.errors.failed" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not record the receipt');
  });

  it('shows the draft hint when asked to', () => {
    render(<Harness showDraftHint />);
    expect(screen.getByText('Finish this line or remove it')).toBeInTheDocument();
  });

  it('disables the submit button while disabled or submitting', () => {
    const { rerender } = render(<Harness disabled />);
    expect(screen.getByRole('button', { name: /Accept/ })).toBeDisabled();

    rerender(<Harness isSubmitting />);
    expect(screen.getByRole('button', { name: /Accept/ })).toBeDisabled();
  });
});
