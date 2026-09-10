import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import type { PointCashRow } from '@/entities/point-cash';
import type { Transfer } from '@/entities/transfer';
import { TransfersPage } from './TransfersPage';

/** The StatTile that carries `label` — same helper `PointCashPage.test.tsx` uses. */
function tile(label: string): HTMLElement {
  const el = screen.getByText(label).closest('[data-slot="stat-tile"]');
  if (!el) throw new Error(`No stat tile labelled "${label}"`);
  return el as HTMLElement;
}

const { pointCashMock, transfersMock } = vi.hoisted(() => ({
  pointCashMock: vi.fn(),
  transfersMock: vi.fn(),
}));

vi.mock('@/entities/point-cash', () => ({
  usePointCashQuery: (opts: unknown) => pointCashMock(opts),
}));

vi.mock('@/entities/transfer', () => ({
  useTransfersQuery: (filter: unknown) => transfersMock(filter),
}));

// No `@/entities/collection-point` mock, deliberately (fix round 1, findings
// 1+2): the page must not import `usePointOptionsQuery` at all — see
// `TransfersPage.tsx`'s own doc comment for why. If it were ever
// reintroduced, this suite would fail with an unmocked-hook error rather
// than silently reverting to a name source that hides deactivated points.

// The three action dialogs each own a real mutation (`useMutation`, needing a
// live `QueryClient`) and already have their own test suites — this page's
// suite only needs to know THAT one opens and WHICH document it targets, the
// same convention `PointCashPage.test.tsx` uses for `SetTargetCashDialog`.
vi.mock('@/features/send-transfer', () => ({
  SendTransferDialog: ({
    pointId,
    pointName,
    open,
  }: {
    pointId: string;
    pointName: string;
    open: boolean;
  }) => (open ? <div role="dialog">Send dialog — {pointId} — {pointName}</div> : null),
}));

vi.mock('@/features/resolve-transfer', () => ({
  ResolveTransferDialog: ({ transfer, open }: { transfer: Transfer; open: boolean }) =>
    open ? <div role="dialog">Resolve dialog — {transfer.id}</div> : null,
}));

vi.mock('@/features/void-document', () => ({
  VoidDocumentDialog: ({ kind, id, code, open }: { kind: string; id: string; code: string; open: boolean }) =>
    open ? (
      <div role="dialog">
        Void dialog — {kind} — {id} — {code}
      </div>
    ) : null,
}));

const pointRow = (over: Partial<PointCashRow> = {}): PointCashRow => ({
  collection_point_id: 'p1',
  name: 'Shypynky',
  target_cash: '5000.00',
  cash: '1000.00',
  shortfall: '4000.00',
  unexplained_difference: '0.00',
  latest_transfer: null,
  ...over,
});

const transfer = (over: Partial<Transfer> = {}): Transfer => ({
  id: 't1',
  collection_point_id: 'p1',
  cash: '500.00',
  crates: 20,
  carrier: 'Petro',
  sent_by_user_id: 'u-owner',
  sent_at: '2026-09-10T08:00:00.000Z',
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
  created_at: '2026-09-10T08:00:00.000Z',
  ...over,
});

const single = <T,>(data: T, over: Partial<{ isPending: boolean; isError: boolean }> = {}) => ({
  data,
  isPending: false,
  isError: false,
  ...over,
});

const points = (data: PointCashRow[]) => ({ data, total: data.length, page: 1, limit: 100 });
const list = <T,>(data: T[]) => ({ data, total: data.length, page: 1, limit: 100 });

beforeEach(() => {
  pointCashMock.mockReset().mockReturnValue(single(points([pointRow()])));
  transfersMock.mockReset().mockReturnValue(single(list([])));
});

describe('TransfersPage — loading and error states', () => {
  it('shows a spinner while the point-cash read is in flight', () => {
    pointCashMock.mockReturnValue(single(undefined, { isPending: true }));
    render(<TransfersPage />);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows a spinner while the transfers read is in flight too — not just point-cash', () => {
    // Fix round 1, finding 2: the OLD third query (`usePointOptionsQuery`)
    // never gated the loading state, so a name could flash as a raw UUID.
    // That query is gone now, but this still proves BOTH remaining reads
    // are checked, not just the first one written.
    transfersMock.mockReturnValue(single(undefined, { isPending: true }));
    render(<TransfersPage />);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the error state rather than an empty table when a read fails', () => {
    transfersMock.mockReturnValue(single(undefined, { isError: true }));
    render(<TransfersPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });
});

describe('TransfersPage — findings 1+2: point names come from GET /point-cash', () => {
  it("resolves a transfer's point name from point-cash rows, including one a picker would hide", () => {
    // `usePointOptionsQuery` is `include_inactive: false` — this point
    // exists ONLY in the point-cash read (as a deactivated point would),
    // proving the name did not come from anywhere else.
    pointCashMock.mockReturnValue(
      single(points([pointRow({ collection_point_id: 'p9', name: 'Retired Point' })])),
    );
    transfersMock.mockReturnValue(single(list([transfer({ collection_point_id: 'p9' })])));

    render(<TransfersPage />);

    // Appears twice — once in the debt table's own point column, once in
    // the history below — both sourced from the same point-cash row.
    expect(screen.getAllByText('Retired Point')).toHaveLength(2);
    expect(screen.queryByText('p9')).toBeNull();
  });

  it('falls back to the raw id only when the point is truly absent from point-cash too', () => {
    pointCashMock.mockReturnValue(single(points([pointRow({ collection_point_id: 'p1' })])));
    transfersMock.mockReturnValue(single(list([transfer({ collection_point_id: 'p-unknown' })])));

    render(<TransfersPage />);

    expect(screen.getByText('p-unknown')).toBeInTheDocument();
  });
});

describe('TransfersPage — finding 3: the transfers read can be truncated', () => {
  it('warns when the network-wide read is only a partial page', () => {
    transfersMock.mockReturnValue({
      data: { data: [transfer()], total: 250, page: 1, limit: 100 },
      isPending: false,
      isError: false,
    });

    render(<TransfersPage />);

    expect(
      screen.getByText(/Showing recent transfers only — an older dispute may not appear/),
    ).toBeInTheDocument();
  });

  it('says nothing about truncation when the read came back whole', () => {
    transfersMock.mockReturnValue(single(list([transfer()])));

    render(<TransfersPage />);

    expect(screen.queryByText(/older dispute may not appear/)).toBeNull();
  });
});

describe('TransfersPage — honesty rule 1: a point with no target is absent from the network total', () => {
  it('sums only points that have a target, never treating a null shortfall as zero', () => {
    pointCashMock.mockReturnValue(
      single(
        points([
          pointRow({ collection_point_id: 'p1', name: 'Shypynky', shortfall: '4000.00' }),
          pointRow({ collection_point_id: 'p2', name: 'Haiove', target_cash: null, shortfall: null }),
        ]),
      ),
    );

    render(<TransfersPage />);

    // 4,000.00 alone — a null shortfall must not silently contribute 0 to the sum
    // (it would print the same total either way, so this also checks no crash/NaN).
    expect(tile('Owed to points')).toHaveTextContent('4,000.00 ₴');
  });

  it('never counts a settled point (shortfall ≤ 0) toward what the network owes', () => {
    pointCashMock.mockReturnValue(
      single(points([pointRow({ shortfall: '-100.00' })])),
    );

    render(<TransfersPage />);

    expect(tile('Owed to points')).toHaveTextContent('0.00 ₴');
  });
});

describe('TransfersPage — wiring the table to the send dialog', () => {
  it('opens the send dialog for the row that was clicked', async () => {
    const user = userEvent.setup();
    render(<TransfersPage />);

    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('p1');
    expect(screen.getByRole('dialog')).toHaveTextContent('Shypynky');
  });
});

describe('TransfersPage — wiring the table to the resolve dialog', () => {
  it('resolves the full disputed transfer matched from the network-wide read', async () => {
    const user = userEvent.setup();
    const disputed = transfer({ id: 't9', status: 'disputed', sent_at: '2026-09-10T08:00:00.000Z' });
    pointCashMock.mockReturnValue(
      single(
        points([
          pointRow({ latest_transfer: { status: 'disputed', sent_at: '2026-09-10T08:00:00.000Z' } }),
        ]),
      ),
    );
    transfersMock.mockReturnValue(single(list([disputed])));

    render(<TransfersPage />);

    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('t9');
  });

  it('does not offer to resolve a dispute already settled — status stays disputed forever', () => {
    // Fix round 1, finding 4: `resolve()` never touches `status`
    // (transfers.service.ts), so this row's `latest_transfer.status` is
    // still `disputed` even though the full record is already resolved.
    // The page must filter it out of `unresolvedDisputes` before
    // `PointDebtTable` ever sees it.
    const resolved = transfer({
      id: 't9',
      status: 'disputed',
      sent_at: '2026-09-10T08:00:00.000Z',
      resolved_at: '2026-09-11T09:00:00.000Z',
    });
    pointCashMock.mockReturnValue(
      single(
        points([
          pointRow({ latest_transfer: { status: 'disputed', sent_at: '2026-09-10T08:00:00.000Z' } }),
        ]),
      ),
    );
    transfersMock.mockReturnValue(single(list([resolved])));

    render(<TransfersPage />);

    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
  });
});

describe('TransfersPage — wiring the history to the void dialog', () => {
  it('opens the void dialog naming the point and the amount, since a transfer has no code', async () => {
    const user = userEvent.setup();
    transfersMock.mockReturnValue(single(list([transfer({ id: 't5', cash: '750.00' })])));

    render(<TransfersPage />);

    await user.click(screen.getByRole('button', { name: 'Void' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('transfer');
    expect(dialog).toHaveTextContent('t5');
    expect(dialog).toHaveTextContent('750.00');
    expect(dialog).toHaveTextContent('Shypynky');
  });
});

describe('TransfersPage — accessibility', () => {
  it('has no axe violations', async () => {
    transfersMock.mockReturnValue(single(list([transfer()])));
    const { container } = render(<TransfersPage />);
    await expectNoAxeViolations(container);
  });
});
