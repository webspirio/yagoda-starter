import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Transfer } from '@/entities/transfer';
import { IncomingTransfers } from './IncomingTransfers';

const { transfersMock, acceptMock, disputeMock } = vi.hoisted(() => ({
  transfersMock: vi.fn(),
  acceptMock: vi.fn(),
  disputeMock: vi.fn(),
}));

vi.mock('@/entities/transfer', () => ({
  useTransfersQuery: (filter: unknown) => transfersMock(filter),
}));

// `DisputeTransferDialog` (imported for real, through the untouched
// `@/features/receive-transfer` index) reaches its OWN mutation via a
// relative import of this same module, one level down — mocking it here
// stubs both that and `IncomingTransfers`'s own `useAcceptTransferMutation`
// call in one place, the same convention `DayPage.test.tsx` uses for
// `CountDrawerDialog`'s mutations. The dialog's own form behaviour is
// covered by `features/receive-transfer`'s own tests.
vi.mock('@/features/receive-transfer/api/useReceiveTransfer', () => ({
  useAcceptTransferMutation: () => ({ mutateAsync: acceptMock, isPending: false }),
  useDisputeTransferMutation: () => ({ mutateAsync: disputeMock, isPending: false }),
}));

const transfer = (over: Partial<Transfer> = {}): Transfer => ({
  id: 't1',
  collection_point_id: 'p1',
  cash: '50000.00',
  crates: 120,
  carrier: 'Petro',
  sent_by_user_id: 'u-owner',
  sent_at: '2026-09-10T08:00:00Z',
  status: 'sent',
  accepted_by_user_id: null,
  accepted_date: null,
  accepted_at: null,
  reported_cash: null,
  reported_crates: null,
  dispute_note: null,
  resolved_cash: null,
  resolved_crates: null,
  resolved_by_user_id: null,
  resolved_at: null,
  cash_discrepancy: null,
  crates_discrepancy: null,
  correction_of_transfer_id: null,
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  created_at: '2026-09-10T08:00:00Z',
  ...over,
});

const page = (data: Transfer[]) => ({
  data: { data, total: data.length, page: 1, limit: 100 },
  isPending: false,
  isError: false,
});

beforeEach(() => {
  transfersMock.mockReset().mockReturnValue(page([]));
  acceptMock.mockReset().mockResolvedValue(transfer());
});

describe('IncomingTransfers', () => {
  it('renders nothing when there is nothing in transit', () => {
    const { container } = render(<IncomingTransfers pointId="p1" canAct />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says the read failed rather than passing a failure off as «nothing in transit»', () => {
    transfersMock.mockReturnValue({ data: undefined, isPending: false, isError: true });

    render(<IncomingTransfers pointId="p1" canAct />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not load the transfers on their way',
    );
  });

  it('renders nothing while the read is still in flight', () => {
    transfersMock.mockReturnValue({ data: undefined, isPending: true, isError: false });

    const { container } = render(<IncomingTransfers pointId="p1" canAct />);

    expect(container).toBeEmptyDOMElement();
  });

  it('asks the transfers entity for sent transfers at this point', () => {
    render(<IncomingTransfers pointId="p1" canAct />);
    expect(transfersMock).toHaveBeenCalledWith({ pointId: 'p1', status: 'sent' });
  });

  it("shows the operator both actions and accepts on click", async () => {
    const user = userEvent.setup();
    transfersMock.mockReturnValue(page([transfer()]));
    render(<IncomingTransfers pointId="p1" canAct />);

    expect(screen.getByText(/50,000.00/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(acceptMock).toHaveBeenCalledWith('t1'));
  });

  it('shows «1 crate», not «1 crates», when exactly one crate is on the way', () => {
    transfersMock.mockReturnValue(page([transfer({ crates: 1 })]));
    render(<IncomingTransfers pointId="p1" canAct />);

    expect(screen.getByText(/1 crate$/)).toBeInTheDocument();
  });

  it('shows «5 crates» when several are on the way', () => {
    transfersMock.mockReturnValue(page([transfer({ crates: 5 })]));
    render(<IncomingTransfers pointId="p1" canAct />);

    expect(screen.getByText(/5 crates$/)).toBeInTheDocument();
  });

  describe('the «sent» timestamp — via shared/lib/date, pinned to TZ=UTC for a fixed literal', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('formats sent_at with formatDateTime, exactly like the owner\'s TransferHistory', () => {
      vi.stubEnv('TZ', 'UTC');
      transfersMock.mockReturnValue(page([transfer({ sent_at: '2026-09-10T08:05:00.000Z' })]));
      render(<IncomingTransfers pointId="p1" canAct />);

      // Test locale is 'en' (test-setup.ts) — same fixed literal
      // TransferHistory.test.tsx asserts for the same instant.
      expect(screen.getByText(/09\/10 · 08:05 AM/)).toBeInTheDocument();
    });
  });

  it('opens the dispute dialog for the clicked transfer', async () => {
    const user = userEvent.setup();
    transfersMock.mockReturnValue(page([transfer({ id: 't9' })]));
    render(<IncomingTransfers pointId="p1" canAct />);

    await user.click(screen.getByRole('button', { name: "Doesn't match" }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('hides both actions from someone who cannot act — §10.3', () => {
    transfersMock.mockReturnValue(page([transfer()]));
    render(<IncomingTransfers pointId="p1" canAct={false} />);

    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    expect(screen.queryByRole('button', { name: "Doesn't match" })).toBeNull();
    expect(screen.getByText('the point accepts')).toBeInTheDocument();
  });
});
