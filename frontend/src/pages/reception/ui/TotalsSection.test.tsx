import { useState } from 'react';
import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TraceScope } from '@/shared/ui/trace';
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
      lineCount={1}
      debt="37.37"
      cash="1616.10"
      debtStatus="ready"
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

  it('adds a NEGATIVE balance signed — «Разом» is the balance (§3.5, R3)', () => {
    // The supplier owes us 50: 100 accrued − 50 = 50, the server's own ceiling.
    render(<Harness accrued="100.00" debt="-50.00" cash="9000.00" />);
    expect(screen.getByText('Previous balance').parentElement).toHaveTextContent('− 50.00 ₴');
    expect(screen.getByText('Total to pay out').parentElement).toHaveTextContent('50.00 ₴');
    // No «overpaid» plaque any more — §3.8 is cancelled.
    expect(screen.queryByText(/Overpaid/)).toBeNull();
    // The suggestion and «Full amount» stop at that ceiling.
    expect(screen.getByLabelText('Paid in cash')).toHaveValue('');
  });

  it('never caps below zero when the supplier still owes us after today (R3)', async () => {
    const user = userEvent.setup();
    // 300 accrued − 500 owed to us = −200: nothing may go out.
    render(<Harness accrued="300.00" debt="-500.00" cash="9000.00" />);
    expect(screen.getByText('Total to pay out').parentElement).toHaveTextContent('−200.00 ₴');

    await user.click(screen.getByRole('button', { name: 'Full amount' }));
    expect(screen.getByLabelText('Paid in cash')).toHaveValue('0.00');
    expect(screen.getByRole('button', { name: 'Round to 100' })).toBeDisabled();
    // A balance below zero reads as what it is — the supplier owes us — with
    // no minus to contradict a label about what WE owe (B1).
    const row = screen.getByTestId('remainder-row');
    expect(row).toHaveTextContent('Supplier owes us');
    expect(row).toHaveTextContent('200.00 ₴');
    expect(row).not.toHaveTextContent('−');
    expect(row).not.toHaveTextContent('Owed by us after this');
    expect(screen.queryByText('Settled in full')).toBeNull();
    // Today's 300 only pays down what the supplier owed: no debt of ours from it.
    expect(screen.queryByText('Debt from this delivery')).toBeNull();

    // Any payout at all is over the cap: refused, the button disabled.
    await user.clear(screen.getByLabelText('Paid in cash'));
    await user.type(screen.getByLabelText('Paid in cash'), '1');
    expect(screen.getByText('Cannot pay out more than the total — at most 0.00 ₴')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Accept/ })).toBeDisabled();
  });

  it('nets a negative previous balance out of this delivery’s debt (B1)', async () => {
    const user = userEvent.setup();
    // 1000 accrued, the supplier owed us 200: the first 200 of today's berries
    // pay that off, so at most 800 can be new debt of ours.
    render(<Harness accrued="1000.00" debt="-200.00" cash="9000.00" paid="500.00" />);
    expect(screen.getByText('Debt from this delivery').parentElement).toHaveTextContent(
      '+ 300.00 ₴',
    );
    const row = screen.getByTestId('remainder-row');
    expect(row).toHaveTextContent('Owed by us after this');
    expect(row).toHaveTextContent('300.00 ₴');

    // The whole cap paid out: nothing new owed, settled in full.
    await user.click(screen.getByRole('button', { name: 'Full amount' }));
    expect(screen.getByLabelText('Paid in cash')).toHaveValue('800.00');
    expect(screen.queryByText('Debt from this delivery')).toBeNull();
    expect(screen.getByText('Settled in full')).toBeInTheDocument();
  });

  it('renders the crate return slot between the cash note and the submit', () => {
    render(<Harness crateReturn={<div>crate-slot</div>} />);
    const note = screen.getByText(/Only 1,616.10 ₴ is in the berry drawer/);
    const slot = screen.getByText('crate-slot');
    const submit = screen.getByRole('button', { name: /Accept/ });
    expect(note.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('TotalsSection — a balance not known yet (B2)', () => {
  it('while the balance loads: «…» for it, «—» for the total, nothing to pay or accept', () => {
    render(<Harness debtStatus="pending" debt={null} cash="9000.00" />);
    expect(screen.getByText('Previous balance').parentElement).toHaveTextContent('…');
    expect(screen.getByText('Total to pay out').parentElement).toHaveTextContent('—');
    expect(screen.getByText('Total to pay out').parentElement).not.toHaveTextContent('5,460');
    // B3 — no cap yet, so no chip can set one.
    expect(screen.getByRole('button', { name: 'Full amount' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Round to 100' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Accept/ })).toBeDisabled();
    expect(screen.queryByText('Settled in full')).toBeNull();
  });

  it('when the balance read failed: says so, and still never shows a total without it', () => {
    render(<Harness debtStatus="error" debt={null} cash="9000.00" />);
    expect(screen.getByText('Previous balance').parentElement).toHaveTextContent(
      "couldn't be read",
    );
    expect(screen.getByText('Total to pay out').parentElement).toHaveTextContent('—');
    expect(screen.getByRole('button', { name: 'Full amount' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Accept/ })).toBeDisabled();
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
    expect(input).toHaveValue('5,497.37');

    await user.click(screen.getByRole('button', { name: 'Round to 100' }));
    expect(input).toHaveValue('5,400.00');

    await user.click(screen.getByRole('button', { name: 'All to balance' }));
    expect(input).toHaveValue('0.00');
  });

  it('disables «Round to 100» when the CAP is under 100, even though the total is not', () => {
    // total (5497.37) is nowhere near 100 — only a tiny drawer makes the cap
    // small. A `total < 100` check would leave this enabled; `cap < 100` (the
    // brief's own code, not its prose) disables it.
    render(<Harness cash="50.00" />);
    expect(screen.getByRole('button', { name: 'Round to 100' })).toBeDisabled();
  });

  it('disables «Full amount» too while there is no cap yet (B3)', () => {
    render(<Harness accrued={null} />);
    expect(screen.getByRole('button', { name: 'Full amount' })).toBeDisabled();
  });

  it('leaves «Round to 100» enabled once the cap clears 100', () => {
    render(<Harness cash="9000.00" />);
    expect(screen.getByRole('button', { name: 'Round to 100' })).toBeEnabled();
  });
});

describe('TotalsSection — the remainder panel', () => {
  it('reads «Owed by us» and the cash note when less than the total is paid out', () => {
    render(<Harness paid="1616.10" />);
    expect(screen.getByText(/Only 1,616.10 ₴ is in the berry drawer/)).toBeInTheDocument();
    // 5460.00 accrued − 1616.10 paid: this delivery's own new debt…
    expect(screen.getByText('Debt from this delivery')).toBeInTheDocument();
    expect(screen.getByText('Debt from this delivery').parentElement).toHaveTextContent(
      '+ 3,843.90 ₴',
    );
    // …and the balance it all comes to, the earlier 37.37 included.
    const row = screen.getByTestId('remainder-row');
    expect(row).toHaveTextContent('Owed by us after this');
    expect(row).toHaveTextContent('3,881.27 ₴');
    expect(screen.queryByText('Paid off the earlier balance')).toBeNull();
  });

  it('shows what the cash pays off the earlier balance when it is more than today accrues', () => {
    render(<Harness paid="5497.37" cash="9000.00" />);
    expect(screen.getByText('Paid off the earlier balance')).toBeInTheDocument();
    expect(screen.getByText('Paid off the earlier balance').parentElement).toHaveTextContent(
      '− 37.37 ₴',
    );
    expect(screen.queryByText('Debt from this delivery')).toBeNull();
  });

  it('shows the paid figure formatted like the total at rest, raw while typed into', async () => {
    const user = userEvent.setup();
    render(<Harness paid="1200.5" cash="9000.00" />);
    const input = screen.getByLabelText('Paid in cash');
    expect(input).toHaveValue('1,200.50');
    await user.click(input);
    expect(input).toHaveValue('1200.5');
  });

  it('reads «Settled in full» once the whole total is paid out', () => {
    // A drawer that can cover it — over the cap the payout is refused (R1)
    // and nothing below the field may read as settled.
    render(<Harness paid="5497.37" cash="9000.00" />);
    expect(screen.getByText('Settled in full')).toBeInTheDocument();
    expect(screen.queryByText('Owed by us after this')).toBeNull();
  });

  it('shows a neutral dash instead of a false «Settled in full» before anything has settled (M1)', () => {
    render(<Harness accrued={null} />);
    expect(screen.queryByText('Settled in full')).toBeNull();
    expect(screen.queryByText('Owed by us after this')).toBeNull();
    // The one-line row shows a bare dash instead of claiming settlement over
    // a total that isn't there yet.
    expect(screen.getByTestId('remainder-row')).toHaveTextContent('—');
  });
});

describe('TotalsSection — the cap and the clamp', () => {
  it('refuses an over-cap figure instead of clamping it, naming the DRAWER when that is what limits it (R1, M2)', async () => {
    const user = userEvent.setup();
    // The default fixture's cap is the cash drawer (1616.10), not the total
    // (5497.37) — so the hint has to say "the berry drawer", not "the total".
    render(<Harness />);
    const input = screen.getByLabelText('Paid in cash');

    await user.type(input, '9999');
    expect(input).toHaveValue('9999');
    expect(
      screen.getByText('Cannot pay out more than is in the berry drawer — at most 1,616.10 ₴'),
    ).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: /Accept/ })).toBeDisabled();
    // Nothing below the field claims a balance for a payout that cannot go out.
    expect(screen.getByTestId('remainder-row')).toHaveTextContent(/^—$/);
    expect(screen.queryByText('Paying down earlier balance')).toBeNull();

    // Leaving the field canonicalises the figure — it never moves it to the cap.
    await user.tab();
    expect(input).toHaveValue('9,999.00');
    expect(screen.getByRole('button', { name: /Accept/ })).toBeDisabled();

    // Bringing it under the cap is what re-enables «Accept».
    await user.clear(input);
    await user.type(input, '1616.10');
    expect(screen.queryByText(/Cannot pay out more than/)).toBeNull();
    expect(screen.getByRole('button', { name: /Accept/ })).toBeEnabled();
  });

  it('names the TOTAL instead once cash is ample enough that the cap IS the total (M2)', async () => {
    const user = userEvent.setup();
    render(<Harness cash="9000.00" />);
    const input = screen.getByLabelText('Paid in cash');

    await user.type(input, '9999');
    expect(
      screen.getByText('Cannot pay out more than the total — at most 5,497.37 ₴'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/is in the berry drawer/)).toBeNull();
  });

  it('gives the over-cap hint a warning tone and leaves the plain and unavailable-drawer states muted', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    const input = screen.getByLabelText('Paid in cash');

    // Plain state: no hint yet, so nothing to warn about.
    expect(screen.queryByText(/Cannot pay out more than/)).toBeNull();

    await user.type(input, '9999');
    expect(
      screen.getByText('Cannot pay out more than is in the berry drawer — at most 1,616.10 ₴'),
    ).toHaveClass('text-amber');
    unmount();

    // A failed cash read is information, not a warning about what was typed.
    render(<Harness cash={null} cashUnavailable />);
    expect(
      screen.getByText(
        'The berry cash drawer could not be read — the server will check the amount when the receipt is recorded',
      ),
    ).not.toHaveClass('text-amber');
  });

  it('caps a null (unread) drawer at the TOTAL, never at zero, and says so when typed over (review finding 2, R1)', async () => {
    const user = userEvent.setup();
    // `cash === null` must never read as an empty drawer: the cap is the
    // uncapped total (`suggestedPaid`). Typing above it is refused against
    // 5497.37 — the reason the button is disabled is said even though the
    // drawer could not be read, and no cash note claims a drawer figure.
    render(<Harness cash={null} cashUnavailable />);
    const input = screen.getByLabelText('Paid in cash');

    await user.type(input, '5497.37');
    expect(screen.getByRole('button', { name: /Accept/ })).toBeEnabled();

    await user.clear(input);
    await user.type(input, '9999');
    expect(
      screen.getByText('Cannot pay out more than the total — at most 5,497.37 ₴'),
    ).toHaveClass('text-amber');
    expect(screen.getByRole('button', { name: /Accept/ })).toBeDisabled();
    expect(screen.queryByText(/Only .* is in the berry drawer/)).toBeNull();
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
        lineCount={1}
        debt="37.37"
        cash="1616.10"
        debtStatus="ready"
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
    expect(input).toHaveValue('1,200.00');
  });
});

describe('TotalsSection — the submit label', () => {
  // R2 (client, 23.10): the money only — «нам не важливі ці кілограми».
  it('names the payout once something is paid out', () => {
    render(<Harness paid="1616.10" />);
    expect(screen.getByRole('button', { name: 'Accept · pay out 1,616.10 ₴' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /kg/ })).toBeNull();
  });

  it('says «without payout» when nothing is being paid out', () => {
    render(<Harness paid="0" />);
    expect(screen.getByRole('button', { name: 'Accept without payout' })).toBeInTheDocument();
  });

  it('says «without payout» for an empty field too — empty means nothing paid', () => {
    render(<Harness paid="" />);
    expect(screen.getByRole('button', { name: 'Accept without payout' })).toBeInTheDocument();
  });

  it('falls back to the bare label while the preview has not settled', () => {
    render(<Harness accrued={null} paid="1616.10" />);
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

  it('shows the shared format message for a malformed sum once the field is left, none while empty (#72)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const input = screen.getByLabelText('Paid in cash');
    // A second separator is kept, never silently dropped — and refused.
    await user.type(input, '1.2.3');
    expect(input).toHaveValue('1.2.3');
    // Mid-keystroke the message waits; leaving the field shows it.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number, e.g. 12000 or 980.40');
    await user.clear(input);
    await user.type(input, '12.5');
    await user.tab();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('never lets a space into «Видано готівкою» (#72)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Paid in cash');
    await user.type(input, '1 200,5');
    expect(input).toHaveValue('1200.5');
  });

  it('renders the form-level banner as its own alert', () => {
    render(<Harness formErrorKey="reception.errors.failed" />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't record the receipt. Try again, and if it happens again, tell the network owner.",
    );
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

// «Звідки це число» (client, 24.10): every figure the card derives points at its rows.
describe('TotalsSection — traced figures', () => {
  it('«Разом» lights the accrual and the carried-in balance; the remainder «Разом» and the cash', () => {
    render(
      <TraceScope>
        <Harness paid="1616.10" />
      </TraceScope>,
    );
    const accrued = screen.getByText('5,460.00 ₴');
    const debt = screen.getByText('+ 37.37 ₴');
    const paid = screen.getByLabelText('Paid in cash');
    const total = screen.getByText('Total to pay out').parentElement!.querySelector('[data-trace]')!;

    fireEvent.pointerEnter(screen.getByText('5,497.37 ₴'));
    expect(accrued).toHaveAttribute('data-trace-hit', 'neutral');
    expect(debt).toHaveAttribute('data-trace-hit', 'neutral');
    expect(paid).not.toHaveAttribute('data-trace-hit');

    fireEvent.pointerEnter(screen.getByText('3,881.27 ₴'));
    expect(total).toHaveAttribute('data-trace-hit', 'amber');
    expect(paid).toHaveAttribute('data-trace-hit', 'amber');
    expect(accrued).not.toHaveAttribute('data-trace-hit');
    // A result that shares an operand is not lit with it.
    expect(screen.getByText('3,843.90 ₴')).not.toHaveAttribute('data-trace-hit');

    fireEvent.pointerEnter(screen.getByText('3,843.90 ₴'));
    expect(accrued).toHaveAttribute('data-trace-hit', 'amber');
    expect(paid).toHaveAttribute('data-trace-hit', 'amber');
    expect(debt).not.toHaveAttribute('data-trace-hit');
  });
});
