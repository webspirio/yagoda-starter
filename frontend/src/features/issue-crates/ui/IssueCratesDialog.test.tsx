import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/shared/api';
import { IssueCratesDialog } from './IssueCratesDialog';

const { issueMock, suppliersMock, standingMock, tareMock, toastMock } = vi.hoisted(() => ({
  issueMock: vi.fn(),
  suppliersMock: vi.fn(),
  standingMock: vi.fn(),
  tareMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('@/entities/tare-type', () => ({ useTareTypeOptionsQuery: () => tareMock() }));
vi.mock('@/shared/ui/toast', () => ({ toast: { success: toastMock, error: vi.fn() } }));

vi.mock('@/entities/crate', () => ({ useCrateStandingQuery: (a: unknown) => standingMock(a) }));

vi.mock('../api/useIssueCrates', () => ({
  useIssueCratesMutation: () => ({ mutateAsync: issueMock }),
}));

vi.mock('@/entities/supplier', () => ({
  useSuppliersQuery: () => suppliersMock(),
  supplierName: (s: { first_name: string; last_name: string }) => `${s.first_name} ${s.last_name}`,
}));

let queryClient: QueryClient;
const open = (pointId?: string) =>
  render(
    <QueryClientProvider client={queryClient}>
      <IssueCratesDialog pointId={pointId} open onClose={() => {}} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient();
  suppliersMock.mockReturnValue({
    data: { data: [{ id: 's1', first_name: 'Василь', last_name: 'Яремчук' }], total: 1 },
    isPending: false,
    isError: false,
  });
  issueMock.mockResolvedValue({});
  standingMock.mockReturnValue({ data: { on_hand: 100, in_transit: 0 } });
  tareMock.mockReturnValue({
    data: [
      { id: 't1', name: 'Box', weight_kg: '0.30', is_crate: false, deposit_price: '0.00' },
      { id: 't2', name: 'Crate', weight_kg: '0.50', is_crate: true, deposit_price: '25.00' },
    ],
  });
});

describe('IssueCratesDialog', () => {
  it('shows how many empties the point has', () => {
    standingMock.mockReturnValue({ data: { on_hand: 7, in_transit: 0 } });
    open();
    expect(screen.getByText(/7 empty crates at the point/i)).toBeInTheDocument();
  });

  it('lets an issuance take the point below zero, saying where it will land (§6.9, 23.10.2026)', async () => {
    standingMock.mockReturnValue({ data: { on_hand: 7, in_transit: 0 } });
    const user = userEvent.setup();
    open();
    await user.selectOptions(screen.getByLabelText('Person'), 's1');
    await user.type(screen.getByLabelText('Crates'), '10');
    expect(
      await screen.findByText(/after this issue the point will have −3 cr\./i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^issue$/i }));
    await waitFor(() =>
      expect(issueMock).toHaveBeenCalledWith({ supplier_id: 's1', units: 10, mode: 'deposit' }),
    );
  });

  it('says nothing about going negative while the issue fits', async () => {
    standingMock.mockReturnValue({ data: { on_hand: 7, in_transit: 0 } });
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText('Crates'), '7');
    expect(screen.queryByText(/after this issue/i)).not.toBeInTheDocument();
  });

  it('at a point already below zero, shows the minus and still lets Issue through', () => {
    standingMock.mockReturnValue({ data: { on_hand: -5, in_transit: 20 } });
    open();
    expect(screen.getByText(/−5 empty crates at the point/)).toBeInTheDocument();
    expect(screen.getByText(/20 cr\. in transit/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^issue$/i })).toBeEnabled();
  });

  // Audit 2026-10-24, F5: the operator sees the money before they take it.
  it('shows the deposit as units × the crate price = total, only for a deposit', async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText('Crates'), '6');
    // The operands are boxed terms, so the line is read as one text.
    await waitFor(() =>
      expect(document.querySelector('[data-deposit-line]')).toHaveTextContent(
        'Deposit: 6 cr. × 25.00 ₴ = 150.00 ₴',
      ),
    );

    await user.selectOptions(screen.getByLabelText('Taken as'), 'receipt');
    expect(screen.queryByText(/^Deposit: /)).not.toBeInTheDocument();
  });

  // 24.10 — «звідки це число»: the count lights the field it was typed in.
  it('traces the deposit line: the count and the total light the «Crates» field', async () => {
    const user = userEvent.setup();
    open();
    const field = screen.getByLabelText('Crates');
    await user.type(field, '6');
    const terms = [
      ...document.querySelectorAll<HTMLElement>('[data-deposit-line] [data-slot="trace-term"]'),
    ];
    expect(terms).toHaveLength(3);
    fireEvent.pointerEnter(terms[0]);
    expect(field).toHaveAttribute('data-trace-hit', 'neutral');
    fireEvent.pointerLeave(terms[0]);
    expect(field).not.toHaveAttribute('data-trace-hit');
    fireEvent.pointerEnter(terms[2]);
    expect(field).toHaveAttribute('data-trace-hit');
    expect(terms[1]).toHaveAttribute('data-trace-hit');
  });

  it('shows no deposit line while the count is not a whole number', async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText('Crates'), '2.5');
    expect(screen.queryByText(/^Deposit: /)).not.toBeInTheDocument();
  });

  it("prints the server's deposit_taken in the toast", async () => {
    issueMock.mockResolvedValue({ deposit_taken: '150.00' });
    const user = userEvent.setup();
    open();
    await user.selectOptions(screen.getByLabelText('Person'), 's1');
    await user.type(screen.getByLabelText('Crates'), '6');
    await user.click(screen.getByRole('button', { name: /^issue$/i }));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        'Crates issued, deposit 150.00 ₴ — in the crates cash',
      ),
    );
  });

  it('says only «issued» when no money was taken', async () => {
    issueMock.mockResolvedValue({ deposit_taken: '0.00' });
    const user = userEvent.setup();
    open();
    await user.selectOptions(screen.getByLabelText('Person'), 's1');
    await user.type(screen.getByLabelText('Crates'), '6');
    await user.selectOptions(screen.getByLabelText('Taken as'), 'receipt');
    await user.click(screen.getByRole('button', { name: /^issue$/i }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Crates issued'));
  });

  it('reads the OWNER-picked point', () => {
    open('p1');
    expect(standingMock).toHaveBeenCalledWith({ pointId: 'p1', isOwner: true });
  });

  it('sends the person, a whole number of crates and the mode', async () => {
    const user = userEvent.setup();
    open();

    await user.selectOptions(screen.getByLabelText('Person'), 's1');
    await user.type(screen.getByLabelText('Crates'), '20');
    await user.click(screen.getByRole('button', { name: /^issue$/i }));

    await waitFor(() => expect(issueMock).toHaveBeenCalledTimes(1));
    expect(issueMock).toHaveBeenCalledWith({ supplier_id: 's1', units: 20, mode: 'deposit' });
  });

  it('carries the point an OWNER picked, since they have none of their own', async () => {
    const user = userEvent.setup();
    open('p1');

    await user.selectOptions(screen.getByLabelText('Person'), 's1');
    await user.type(screen.getByLabelText('Crates'), '5');
    await user.click(screen.getByRole('button', { name: /^issue$/i }));

    await waitFor(() => expect(issueMock).toHaveBeenCalledTimes(1));
    expect(issueMock.mock.calls[0][0].collection_point_id).toBe('p1');
  });

  /**
   * §6.4 — «різниця лише в грошах». An operator who does not know which mode
   * they are choosing is choosing whether the network is covered, so the
   * consequence is spelled out beside the control rather than left to a label.
   */
  it('explains what each mode means, beside the choice', async () => {
    const user = userEvent.setup();
    open();

    expect(screen.getByText(/money is taken now/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Taken as'), 'receipt');

    expect(screen.getByText(/NO money changes hands/i)).toBeInTheDocument();
    expect(screen.queryByText(/money is taken now/i)).not.toBeInTheDocument();
  });

  it('refuses a fractional count before the server sees it', async () => {
    const user = userEvent.setup();
    open();

    await user.selectOptions(screen.getByLabelText('Person'), 's1');
    await user.type(screen.getByLabelText('Crates'), '2.5');
    await user.click(screen.getByRole('button', { name: /^issue$/i }));

    await waitFor(() => expect(screen.getByText(/whole number of crates/i)).toBeInTheDocument());
    expect(issueMock).not.toHaveBeenCalled();
  });

  it('refuses a missing person', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText('Crates'), '20');
    await user.click(screen.getByRole('button', { name: /^issue$/i }));

    // NOT the placeholder's wording: a validation message that repeats the
    // placeholder verbatim tells the operator nothing they were not already
    // looking at.
    await waitFor(() =>
      expect(screen.getByText(/pick who is taking the crates/i)).toBeInTheDocument(),
    );
    expect(issueMock).not.toHaveBeenCalled();
  });

  /** No tare type marked as the crate — the operator is told where to fix it. */
  it('names NO_CRATE_TYPE rather than showing a generic failure', async () => {
    const user = userEvent.setup();
    issueMock.mockRejectedValue(new ApiError(400, 'no crate', undefined, 'NO_CRATE_TYPE'));
    open();

    await user.selectOptions(screen.getByLabelText('Person'), 's1');
    await user.type(screen.getByLabelText('Crates'), '20');
    await user.click(screen.getByRole('button', { name: /^issue$/i }));

    await waitFor(() => expect(screen.getByText(/marked as the crate/i)).toBeInTheDocument());
  });

  it('falls back to a generic banner for an unmapped failure', async () => {
    const user = userEvent.setup();
    issueMock.mockRejectedValue(new ApiError(500, 'boom'));
    open();

    await user.selectOptions(screen.getByLabelText('Person'), 's1');
    await user.type(screen.getByLabelText('Crates'), '20');
    await user.click(screen.getByRole('button', { name: /^issue$/i }));

    await waitFor(() => expect(screen.getByText(/the server failed/i)).toBeInTheDocument());
  });
});
