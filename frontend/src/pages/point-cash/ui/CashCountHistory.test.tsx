import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CashCount } from '@/entities/cash-count';
import { CashCountHistory } from './CashCountHistory';

const { countsMock, explainMock } = vi.hoisted(() => ({
  countsMock: vi.fn(),
  explainMock: vi.fn(),
}));

vi.mock('@/entities/cash-count', () => ({
  useCashCountsQuery: (filter: unknown) => countsMock(filter),
}));

// `ExplainDiscrepancyDialog` is the real component, only its own mutation is
// stubbed — the same convention `IncomingTransfers.test.tsx` uses.
vi.mock('@/features/set-cash-explanation/api/useSetCashExplanation', () => ({
  useSetCashExplanationMutation: () => ({ mutateAsync: explainMock, isPending: false }),
}));

vi.mock('@/features/set-operator-note/api/useSetOperatorNote', () => ({
  useSetOperatorNoteMutation: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}));

const count = (over: Partial<CashCount> = {}): CashCount => ({
  id: 'c1',
  shift_id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-10',
  book: 'berry',
  kind: 'opening',
  counted_amount: '1500.00',
  expected_amount: '1500.00',
  discrepancy: '0.00',
  is_open: false,
  counted_by_user_id: 'u1',
  counted_by_name: 'Olha',
  counted_at: '2026-09-10T07:00:00Z',
  explanation: null,
  operator_note: null,
  operator_note_editable: false,
  explainable: false,
  ...over,
  explained: over.explained ?? over.explanation != null,
});

const page = (data: CashCount[]) => ({
  data: { data, total: data.length, page: 1, limit: 100 },
  isPending: false,
});

beforeEach(() => {
  countsMock.mockReset().mockReturnValue(page([]));
  explainMock.mockReset().mockResolvedValue({});
});

afterEach(() => vi.restoreAllMocks());

describe('CashCountHistory', () => {
  it('asks the cash-count entity for this point, first page first', () => {
    render(<CashCountHistory pointId="p1" isOwner={false} meId="u1" />);
    expect(countsMock).toHaveBeenCalledWith({ pointId: 'p1', page: 1, limit: 100 });
  });

  it('shows no pager while the whole history fits on one page', () => {
    countsMock.mockReturnValue(page([count()]));
    render(<CashCountHistory pointId="p1" isOwner={false} meId="u1" />);
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('pages through a history longer than one page, and says how much there is', async () => {
    const user = userEvent.setup();
    countsMock.mockImplementation((filter: { page: number }) => ({
      data: { data: [count({ id: `c-${filter.page}` })], total: 250, page: filter.page, limit: 100 },
      isPending: false,
    }));
    render(<CashCountHistory pointId="p1" isOwner={false} meId="u1" />);

    expect(screen.getByText('1–100 of 250')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(countsMock).toHaveBeenLastCalledWith({ pointId: 'p1', page: 2, limit: 100 });
    expect(screen.getByText('101–200 of 250')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('201–250 of 250')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('starts another point’s history at its first page', async () => {
    const user = userEvent.setup();
    countsMock.mockImplementation((filter: { page: number }) => ({
      data: { data: [count({ id: `c-${filter.page}` })], total: 250, page: filter.page, limit: 100 },
      isPending: false,
    }));
    const { rerender } = render(<CashCountHistory pointId="p1" isOwner={false} meId="u1" />);
    await user.click(screen.getByRole('button', { name: 'Next' }));

    rerender(<CashCountHistory pointId="p2" isOwner={false} meId="u1" />);

    expect(countsMock).toHaveBeenLastCalledWith({ pointId: 'p2', page: 1, limit: 100 });
  });

  it('waits for the read before saying the point was never counted', () => {
    // «Цю точку ще жодного разу не рахували» is a statement about the
    // point's whole history, and an unanswered query is not evidence for it
    // — flashing it on every load teaches the reader to distrust it.
    countsMock.mockReturnValue({ data: undefined, isPending: true });

    render(<CashCountHistory pointId="p1" isOwner={false} meId="u1" />);

    expect(screen.queryByText('No cash counts recorded for this point yet.')).toBeNull();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('says there is no history yet rather than showing an empty table', () => {
    render(<CashCountHistory pointId="p1" isOwner={false} meId="u1" />);
    expect(screen.getByText('No cash counts recorded for this point yet.')).toBeInTheDocument();
  });

  it("lists a count's figures", () => {
    countsMock.mockReturnValue(page([count()]));
    render(<CashCountHistory pointId="p1" isOwner={false} meId="u1" />);

    expect(screen.getAllByText('1,500.00 ₴')).toHaveLength(2);
    expect(screen.getByText('0.00 ₴')).toBeInTheDocument();
  });

  it('names who counted', () => {
    countsMock.mockReturnValue(page([count({ counted_by_name: 'Olha' })]));
    render(<CashCountHistory pointId="p1" isOwner={false} meId="u1" />);
    expect(screen.getByText('Olha')).toBeInTheDocument();
  });

  it('shows a dash for a row recorded before names were tracked', () => {
    countsMock.mockReturnValue(page([count({ counted_by_name: null })]));
    render(<CashCountHistory pointId="p1" isOwner={false} meId="u1" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows «needs no explanation» for a closed midday recount with a real discrepancy — never «Matched»', () => {
    // R2: a midday recount is a witness, never an incident — the backend
    // never sets `is_open` for one even when the figure genuinely differs.
    // Deciding the cell off `is_open` alone used to print «Matched» beside
    // this row's own −50.00 ₴.
    countsMock.mockReturnValue(
      page([count({ kind: 'midday', discrepancy: '-50.00', is_open: false, explanation: null })]),
    );
    render(<CashCountHistory pointId="p1" isOwner={false} meId="u1" />);

    expect(screen.getByText('needs no explanation')).toBeInTheDocument();
    expect(screen.queryByText('Matched')).toBeNull();
  });

  it('a Book column names which book each count belongs to', () => {
    countsMock.mockReturnValue(
      page([count({ id: 'c1', book: 'berry' }), count({ id: 'c2', book: 'crates', kind: 'closing' })]),
    );
    render(<CashCountHistory pointId="p1" isOwner={false} meId="u1" />);

    expect(screen.getByRole('columnheader', { name: 'Book' })).toBeInTheDocument();
    const [, berryRow, cratesRow] = screen.getAllByRole('row');
    expect(within(berryRow).getByText('Cash')).toBeInTheDocument();
    expect(within(cratesRow).getByText('Deposits')).toBeInTheDocument();
  });

  it('an open crates closing of −360 is flagged, and the owner can explain it', async () => {
    const user = userEvent.setup();
    countsMock.mockReturnValue(
      page([
        count({ book: 'crates', kind: 'closing', discrepancy: '-360.00', is_open: true, explainable: true }),
      ]),
    );
    render(<CashCountHistory pointId="p1" isOwner meId="u1" />);

    const row = screen.getAllByRole('row')[1];
    expect(within(row).getByText(/360\.00/)).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Explain' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Book: Deposits');
  });

  it('offers «Explain» only to the owner, only on an open discrepancy', () => {
    countsMock.mockReturnValue(page([count({ is_open: true, explainable: true, discrepancy: '-40.00' })]));
    const { rerender } = render(<CashCountHistory pointId="p1" isOwner={false} meId="u1" />);
    expect(screen.queryByRole('button', { name: 'Explain' })).toBeNull();
    expect(screen.getByText('Unexplained')).toBeInTheDocument();

    rerender(<CashCountHistory pointId="p1" isOwner meId="u1" />);
    expect(screen.getByRole('button', { name: 'Explain' })).toBeInTheDocument();
  });

  it('shows an already-saved explanation instead of the button', () => {
    countsMock.mockReturnValue(
      page([count({ is_open: false, discrepancy: '-40.00', explanation: 'Double-paid a payout' })]),
    );
    render(<CashCountHistory pointId="p1" isOwner meId="u1" />);

    expect(screen.getByText('Double-paid a payout')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Explain' })).toBeNull();
  });

  it('opens the explain dialog scoped to that count’s shift', async () => {
    const user = userEvent.setup();
    countsMock.mockReturnValue(
      page([count({ id: 'c9', shift_id: 's9', is_open: true, explainable: true, discrepancy: '-40.00' })]),
    );
    render(<CashCountHistory pointId="p1" isOwner meId="u1" />);

    await user.click(screen.getByRole('button', { name: 'Explain' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('40.00');
  });

  const openClosing = (over: Partial<CashCount> = {}) =>
    count({ kind: 'closing', counted_amount: '1400.00', discrepancy: '-100.00', is_open: true, ...over });

  it('the closer gets «Add my explanation» on an editable row', async () => {
    countsMock.mockReturnValue(page([openClosing({ operator_note_editable: true })]));
    render(<CashCountHistory pointId="p1" isOwner={false} meId="u1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Add my explanation' }));
    expect(screen.getByRole('heading', { name: /What happened\?/ })).toBeInTheDocument();
  });

  it('once written, the closer edits it and everyone reads it', () => {
    countsMock.mockReturnValue(page([openClosing({ operator_note: 'віддав решту', operator_note_editable: true })]));
    render(<CashCountHistory pointId="p1" isOwner={false} meId="u1" />);
    expect(screen.getByText('Operator: “віддав решту”')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit my explanation' })).toBeInTheDocument();
  });

  it('a non-editable open row still just says it is unexplained', () => {
    countsMock.mockReturnValue(page([openClosing()]));
    render(<CashCountHistory pointId="p1" isOwner={false} meId="u1" />);
    expect(screen.getByText('Unexplained')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add my explanation' })).toBeNull();
  });

  it('the owner sees the operator’s note AND still has to explain — the note closes nothing', () => {
    countsMock.mockReturnValue(page([openClosing({ operator_note: 'віддав решту', explainable: true })]));
    render(<CashCountHistory pointId="p1" isOwner meId="u1" />);
    expect(screen.getByText('Operator: “віддав решту”')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Explain' })).toBeInTheDocument();
  });

  it('after the owner decides, both texts stay readable', () => {
    countsMock.mockReturnValue(
      page([openClosing({ is_open: false, explanation: 'утримати з зарплати', operator_note: 'віддав решту' })]),
    );
    render(<CashCountHistory pointId="p1" isOwner meId="u1" />);
    expect(screen.getByText('утримати з зарплати')).toBeInTheDocument();
    expect(screen.getByText('Operator: “віддав решту”')).toBeInTheDocument();
  });

  it('an operator reads «settled by the owner» — the server withholds the owner’s text from them', () => {
    countsMock.mockReturnValue(
      page([openClosing({ is_open: false, explanation: null, explained: true, operator_note: 'віддав решту' })]),
    );
    render(<CashCountHistory pointId="p1" isOwner={false} meId="u1" />);
    expect(screen.getByText('Settled by the owner')).toBeInTheDocument();
    expect(screen.getByText('Operator: “віддав решту”')).toBeInTheDocument();
    expect(screen.queryByText('needs no explanation')).toBeNull();
  });

  it('clamps both long texts to two lines, each expandable on its own, so the table keeps its width', async () => {
    const user = userEvent.setup();
    // jsdom has no layout — fake a clamp that hides text.
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(120);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40);
    countsMock.mockReturnValue(
      page([openClosing({ is_open: false, explanation: 'утримати з зарплати', operator_note: 'віддав решту' })]),
    );
    render(<CashCountHistory pointId="p1" isOwner meId="u1" />);

    expect(screen.getByText('утримати з зарплати')).toHaveClass('line-clamp-2');
    expect(screen.getByText('Operator: “віддав решту”')).toHaveClass('line-clamp-2');

    await user.click(screen.getByRole('button', { name: "Show more: the owner's explanation" }));
    expect(screen.getByText('утримати з зарплати')).not.toHaveClass('line-clamp-2');
    expect(screen.getByText('Operator: “віддав решту”')).toHaveClass('line-clamp-2');
    expect(screen.getByRole('button', { name: "Show more: the operator's note" })).toBeInTheDocument();
  });

  it('renders each row its own texts and buttons — an explained opening does not touch the closing', () => {
    const opening = count({ id: 'o', kind: 'opening', explanation: 'недостача з учора', is_open: false, discrepancy: '-10.00' });
    const closing = count({ id: 'c', kind: 'closing', explanation: null, is_open: true, explainable: true, discrepancy: '-20.00' });
    countsMock.mockReturnValue(page([closing, opening]));
    render(<CashCountHistory pointId="p1" isOwner meId="u1" />);
    const [closingRow, openingRow] = screen.getAllByRole('row').slice(1);
    expect(within(openingRow).getByText('недостача з учора')).toBeInTheDocument();
    expect(within(closingRow).queryByText('недостача з учора')).toBeNull();
    expect(within(closingRow).getByRole('button', { name: 'Explain' })).toBeInTheDocument();
    expect(within(openingRow).queryByRole('button')).toBeNull();
  });

  it('a demoted closing (midday with texts) shows them and no button', () => {
    countsMock.mockReturnValue(
      page([count({ kind: 'midday', discrepancy: '-20.00', explanation: 'утримати', operator_note: 'перший раз', is_open: false })]),
    );
    render(<CashCountHistory pointId="p1" isOwner={false} meId="u1" />);
    expect(screen.getByText('утримати')).toBeInTheDocument();
    expect(screen.getByText(/перший раз/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a demoted closing with only an operator note still shows the note', () => {
    countsMock.mockReturnValue(
      page([count({ kind: 'midday', discrepancy: '-20.00', explanation: null, operator_note: 'перший раз', is_open: false })]),
    );
    render(<CashCountHistory pointId="p1" isOwner={false} meId="u1" />);
    expect(screen.getByText(/перший раз/)).toBeInTheDocument();
    expect(screen.getByText('needs no explanation')).toBeInTheDocument();
  });

  it('an open row the operator cannot explain says who counted it', () => {
    countsMock.mockReturnValue(
      page([openClosing({ operator_note_editable: false, counted_by_user_id: 'u2', counted_by_name: 'Марія' })]),
    );
    render(<CashCountHistory pointId="p1" isOwner={false} meId="u1" />);
    expect(screen.getByText(/counted by Марія/)).toBeInTheDocument();
  });

  it('an opening-count incident shows the counter’s note and passes it to the owner’s dialog', async () => {
    countsMock.mockReturnValue(
      page([count({ kind: 'opening', discrepancy: '-100.00', is_open: true, explainable: true, operator_note: 'віддав решту' })]),
    );
    render(<CashCountHistory pointId="p1" isOwner meId="u1" />);
    expect(screen.getByText('Operator: “віддав решту”')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Explain' }));
    await screen.findByRole('dialog');
    expect(screen.getByText(/The operator wrote/)).toBeInTheDocument();
  });
});
