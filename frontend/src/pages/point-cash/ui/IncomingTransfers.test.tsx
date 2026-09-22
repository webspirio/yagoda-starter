import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Transfer } from '@/entities/transfer';
import { IncomingTransfers } from './IncomingTransfers';

const { transfersMock, acceptMock, disputeMock, toastSuccessMock } = vi.hoisted(() => ({
  transfersMock: vi.fn(),
  acceptMock: vi.fn(),
  disputeMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock('@/entities/transfer', () => ({
  useTransfersQuery: (filter: unknown) => transfersMock(filter),
}));

vi.mock('@/shared/ui/toast', () => ({
  toast: { success: toastSuccessMock, error: vi.fn() },
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

/** A disputed transfer always carries the point's counted figures (§7.9 step 4б). */
const disputedTransfer = (over: Partial<Transfer> = {}): Transfer =>
  transfer({
    id: 'd1',
    status: 'disputed',
    cash: '50000.00',
    crates: 120,
    reported_cash: '48000.00',
    reported_crates: 118,
    dispute_note: 'Two crates cracked on the road',
    resolved_at: null,
    ...over,
  });

const page = (data: Transfer[]) => ({
  data: { data, total: data.length, page: 1, limit: 100 },
  isPending: false,
  isError: false,
});

/**
 * `useTransfersQuery` is called TWICE now — `status: 'sent'` and
 * `status: 'disputed'` — so a plain `transfersMock.mockReturnValue(...)`
 * would hand the SAME rows to both calls, bleeding «sent» fixtures into the
 * disputed card (and vice versa). This keeps each status its own list, the
 * way the real backend filter does.
 */
function mockTransfers({
  sent = [],
  disputed = [],
}: { sent?: Transfer[]; disputed?: Transfer[] } = {}) {
  transfersMock.mockImplementation((filter: { status?: string }) =>
    page(filter.status === 'disputed' ? disputed : sent),
  );
}

beforeEach(() => {
  transfersMock.mockReset();
  mockTransfers();
  acceptMock.mockReset().mockResolvedValue(transfer());
  toastSuccessMock.mockReset();
});

describe('IncomingTransfers', () => {
  it('renders nothing when both the in-transit and disputed lists are empty', () => {
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

  it('asks the transfers entity for sent AND disputed transfers at this point', () => {
    render(<IncomingTransfers pointId="p1" canAct />);
    expect(transfersMock).toHaveBeenCalledWith({ pointId: 'p1', status: 'sent' });
    expect(transfersMock).toHaveBeenCalledWith({ pointId: 'p1', status: 'disputed' });
  });

  it('shows the operator both actions and accepts on click', async () => {
    const user = userEvent.setup();
    mockTransfers({ sent: [transfer()] });
    render(<IncomingTransfers pointId="p1" canAct />);

    expect(screen.getByText(/50,000.00/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(acceptMock).toHaveBeenCalledWith('t1'));
  });

  it('toasts the accepted title plus the figures that joined the cash and the target', async () => {
    const user = userEvent.setup();
    mockTransfers({ sent: [transfer()] });
    render(<IncomingTransfers pointId="p1" canAct />);

    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith('Transfer accepted', {
        description: '50,000.00 ₴ and 120 crates joined the cash and the target.',
      }),
    );
  });

  it('shows «1 crate», not «1 crates», when exactly one crate is on the way', () => {
    mockTransfers({ sent: [transfer({ crates: 1 })] });
    render(<IncomingTransfers pointId="p1" canAct />);

    expect(screen.getByText(/1 crate$/)).toBeInTheDocument();
  });

  it('shows «5 crates» when several are on the way', () => {
    mockTransfers({ sent: [transfer({ crates: 5 })] });
    render(<IncomingTransfers pointId="p1" canAct />);

    expect(screen.getByText(/5 crates$/)).toBeInTheDocument();
  });

  describe('the in-transit caption — via shared/lib/date, pinned to TZ=UTC for a fixed literal', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('formats the sent date and time separately with formatShortDate and formatTime', () => {
      vi.stubEnv('TZ', 'UTC');
      mockTransfers({ sent: [transfer({ sent_at: '2026-09-10T08:05:00.000Z' })] });
      render(<IncomingTransfers pointId="p1" canAct />);

      // Test locale is 'en' (test-setup.ts) — same fixed literal
      // TransferHistory.test.tsx asserts for the same instant.
      expect(screen.getByText(/sent 09\/10 at 08:05 AM/)).toBeInTheDocument();
    });

    it("joins carrier, date, time and the «don't move» reminder with middots", () => {
      vi.stubEnv('TZ', 'UTC');
      mockTransfers({
        sent: [transfer({ carrier: 'Ivan', sent_at: '2026-09-10T08:05:00.000Z' })],
      });
      render(<IncomingTransfers pointId="p1" canAct />);

      expect(
        screen.getByText(/^Ivan · sent 09\/10 at 08:05 AM · until you press/),
      ).toBeInTheDocument();
      expect(screen.getByText(/the cash and the target don't move$/)).toBeInTheDocument();
    });
  });

  it('opens the dispute dialog for the clicked transfer', async () => {
    const user = userEvent.setup();
    mockTransfers({ sent: [transfer({ id: 't9' })] });
    render(<IncomingTransfers pointId="p1" canAct />);

    await user.click(screen.getByRole('button', { name: "Doesn't match" }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('hides both actions from someone who cannot act — §10.3', () => {
    mockTransfers({ sent: [transfer()] });
    render(<IncomingTransfers pointId="p1" canAct={false} />);

    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    expect(screen.queryByRole('button', { name: "Doesn't match" })).toBeNull();
    expect(screen.getByText('the point accepts')).toBeInTheDocument();
  });

  describe('a disputed transfer — the red card (R5)', () => {
    it('renders the header, the sent figures and what the point counted', () => {
      mockTransfers({ disputed: [disputedTransfer({ sent_at: '2026-09-10T08:00:00Z' })] });
      render(<IncomingTransfers pointId="p1" canAct />);

      expect(screen.getByText(/Flagged .doesn't match./)).toBeInTheDocument();
      expect(screen.getByText(/transfer from 09\/10/)).toBeInTheDocument();
      expect(screen.getByText(/Sent 50,000.00 ₴ and 120 crates/)).toBeInTheDocument();
      expect(screen.getByText(/you counted 48,000.00 ₴ and 118 crates/)).toBeInTheDocument();
    });

    it('shows the dispute note, italicised, in guillemets', () => {
      mockTransfers({
        disputed: [disputedTransfer({ dispute_note: 'Two crates cracked on the road' })],
      });
      render(<IncomingTransfers pointId="p1" canAct />);

      const note = screen.getByText('"Two crates cracked on the road"');
      expect(note).toBeInTheDocument();
      expect(note).toHaveClass('italic');
    });

    it('omits the note line when there is no dispute note', () => {
      mockTransfers({ disputed: [disputedTransfer({ dispute_note: null })] });
      const { container } = render(<IncomingTransfers pointId="p1" canAct />);

      expect(container.querySelector('.italic')).toBeNull();
    });

    it("shows the starter's footer — the owner resolves it, the point does not touch the figure", () => {
      mockTransfers({ disputed: [disputedTransfer()] });
      render(<IncomingTransfers pointId="p1" canAct />);

      expect(screen.getByText(/The cash hasn't moved by a single kopiyka/)).toBeInTheDocument();
      expect(screen.getByText(/the point doesn't touch this figure/)).toBeInTheDocument();
    });

    it('renders the red card for the owner too — it is informational, not an action', () => {
      mockTransfers({ disputed: [disputedTransfer()] });
      render(<IncomingTransfers pointId="p1" canAct={false} />);

      expect(screen.getByText(/Flagged .doesn't match./)).toBeInTheDocument();
    });

    it('does not render a disputed transfer the owner has already resolved', () => {
      mockTransfers({ disputed: [disputedTransfer({ resolved_at: '2026-09-11T09:00:00Z' })] });
      const { container } = render(<IncomingTransfers pointId="p1" canAct />);

      expect(container).toBeEmptyDOMElement();
    });

    it('renders both the in-transit and the disputed card together without mixing their figures', () => {
      mockTransfers({
        sent: [transfer({ id: 's1', crates: 7 })],
        disputed: [disputedTransfer({ id: 'd1', crates: 3, reported_crates: 2 })],
      });
      render(<IncomingTransfers pointId="p1" canAct />);

      expect(screen.getByText(/In transit: .* 7 crates/)).toBeInTheDocument();
      expect(screen.getByText(/Sent .* 3 crates/)).toBeInTheDocument();
      expect(screen.getByText(/you counted .* 2 crates/)).toBeInTheDocument();
    });
  });
});
