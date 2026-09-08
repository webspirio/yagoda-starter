import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expectNoAxeViolations } from '../../../test-axe';
import type { Intake } from '@/entities/intake';
import type { Payout } from '@/entities/payout';
import type { Supplier } from '@/entities/supplier';
import { PAGE_SIZE } from '../model/journalFilters';
import { JournalPage } from './JournalPage';

const { intakesMock, payoutsMock, suppliersMock, balancesMock, receiptMock } = vi.hoisted(() => ({
  intakesMock: vi.fn(),
  payoutsMock: vi.fn(),
  suppliersMock: vi.fn(),
  balancesMock: vi.fn(),
  receiptMock: vi.fn(),
}));

vi.mock('@/entities/intake', () => ({
  useIntakesQuery: (filter: unknown) => intakesMock(filter),
}));

vi.mock('@/entities/payout', () => ({
  usePayoutsQuery: (filter: unknown) => payoutsMock(filter),
}));

vi.mock('@/entities/supplier', () => ({
  useSuppliersQuery: (search: string, pointId?: string | null) => suppliersMock(search, pointId),
  useSupplierBalancesQuery: (filter: unknown) => balancesMock(filter),
  supplierName: (s: { first_name: string; last_name: string }) => `${s.first_name} ${s.last_name}`,
}));

// Real UUID-shaped ids — the point/supplier filters round-trip through
// `keepUuids` (journalFilters' `parseFilters`), which drops anything that
// isn't shaped like one, same as the production ids from `/collection-points`
// and `/suppliers` are.
const P1 = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const SUP1 = '11111111-1111-4111-8111-111111111111';

vi.mock('@/entities/collection-point', () => ({
  usePointOptionsQuery: () => ({
    data: [
      { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', name: 'Shypynky' },
      { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', name: 'Haiove' },
    ],
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/widgets/receipt', () => ({
  ReceiptDialog: (props: { intakeId: string | null; open: boolean; onClose: () => void }) => {
    receiptMock(props);
    return props.open ? <div data-testid="receipt-dialog">{props.intakeId}</div> : null;
  },
}));

const intake = (over: Partial<Intake> & Pick<Intake, 'id' | 'code' | 'amount'>): Intake => ({
  shift_id: 's1',
  collection_point_id: P1,
  business_date: '2026-09-08',
  supplier_id: SUP1,
  received_by_user_id: 'u1',
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  created_at: '2026-09-08T07:10:00Z',
  ...over,
});

const payout = (over: Partial<Payout> & Pick<Payout, 'id' | 'code' | 'amount'>): Payout => ({
  shift_id: 's1',
  collection_point_id: P1,
  business_date: '2026-09-08',
  supplier_id: SUP1,
  paid_by_user_id: 'u1',
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  return_settled_at: null,
  return_settled_by_user_id: null,
  return_note: null,
  created_at: '2026-09-08T11:00:00Z',
  ...over,
});

const supplier = (over: Partial<Supplier> & Pick<Supplier, 'id' | 'first_name' | 'last_name'>): Supplier => ({
  collection_point_id: P1,
  phone: null,
  note: null,
  kind: 'none',
  is_active: true,
  created_at: '2026-01-01',
  ...over,
});

/** `total` defaults to what was returned; pass a bigger one to stand for a
 *  journal page the server truncated by pagination. */
const page = <T,>(data: T[], total = data.length) => ({
  data: { data, total, page: 1, limit: PAGE_SIZE },
  isPending: false,
  isError: false,
});

/** The StatTile that carries `label` — tiles and other page text share
 *  strings, so a bare getByText is ambiguous. */
function tile(label: string): HTMLElement {
  const el = screen.getByText(label).closest('[data-slot="stat-tile"]');
  if (!el) throw new Error(`No stat tile labelled "${label}"`);
  return el as HTMLElement;
}

function renderJournal(entry = '/journal') {
  const router = createMemoryRouter([{ path: '/journal', element: <JournalPage /> }], {
    initialEntries: [entry],
  });
  return { ...render(<RouterProvider router={router} />), router };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-08T09:00:00') });
  intakesMock.mockReset().mockReturnValue(page<Intake>([]));
  payoutsMock.mockReset().mockReturnValue(page<Payout>([]));
  suppliersMock.mockReset().mockReturnValue(page<Supplier>([]));
  balancesMock.mockReset().mockReturnValue(page<{ supplier_id: string; first_name: string; last_name: string }>([]));
  receiptMock.mockReset();
});

afterEach(() => vi.useRealTimers());

describe('JournalPage — the default view', () => {
  it('titles the page, defaults to the current month, and offers both kind tabs', async () => {
    const { container } = renderJournal();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Receipt journal' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Receipts' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Payouts' })).toBeInTheDocument();
    expect(screen.getByLabelText('Month')).toHaveValue('2026-09');

    expect(intakesMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-09-01', to: '2026-09-30' }),
    );

    await expectNoAxeViolations(container);
  });

  it('shows the true total in the count tile, and flags the sum as page-only when truncated', () => {
    intakesMock.mockReturnValue(
      page<Intake>(
        [
          intake({ id: 'i1', code: 'KV-0001', amount: '100.00' }),
          intake({ id: 'i2', code: 'KV-0002', amount: '50.00' }),
        ],
        45,
      ),
    );

    renderJournal();

    expect(tile('Receipt count')).toHaveTextContent('45');
    expect(tile('Accrued')).toHaveTextContent('150.00 ₴');
    expect(tile('Accrued')).toHaveTextContent('on this page');
  });

  it('says nothing about a page-only sum once the whole result fits on one page', () => {
    intakesMock.mockReturnValue(
      page<Intake>([intake({ id: 'i1', code: 'KV-0001', amount: '100.00' })]),
    );

    renderJournal();

    expect(tile('Receipt count')).toHaveTextContent('1');
    expect(tile('Accrued')).not.toHaveTextContent('on this page');
  });

  it('excludes voided documents from the sum but keeps them in the count', () => {
    intakesMock.mockReturnValue(
      page<Intake>([
        intake({ id: 'i1', code: 'KV-0001', amount: '100.00' }),
        intake({
          id: 'i2',
          code: 'KV-0002',
          amount: '999.00',
          voided_at: '2026-09-08T10:00:00Z',
          void_reason: 'Wrong supplier',
        }),
      ]),
    );

    renderJournal();

    expect(tile('Receipt count')).toHaveTextContent('2');
    expect(tile('Accrued')).toHaveTextContent('100.00 ₴');
    expect(screen.getByText('Voided')).toBeInTheDocument();
  });

  it('shows the empty state when nothing matches the period', () => {
    renderJournal();
    expect(screen.getByText('No records for this period.')).toBeInTheDocument();
  });

  it('shows an explicit error state when the read fails', () => {
    intakesMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderJournal();
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });
});

describe('JournalPage — switching kind', () => {
  it('reads the payout totals and calls usePayoutsQuery with the same range as intakes', async () => {
    const user = userEvent.setup();
    intakesMock.mockReturnValue(page<Intake>([intake({ id: 'i1', code: 'KV-1', amount: '100.00' })]));
    payoutsMock.mockReturnValue(page<Payout>([payout({ id: 'y1', code: 'VD-1', amount: '80.00' })]));

    renderJournal();
    expect(tile('Receipt count')).toHaveTextContent('1');

    await user.click(screen.getByRole('tab', { name: 'Payouts' }));

    expect(tile('Payout count')).toHaveTextContent('1');
    expect(tile('Paid')).toHaveTextContent('80.00 ₴');

    const intakeArgs = intakesMock.mock.calls[intakesMock.mock.calls.length - 1][0];
    const payoutArgs = payoutsMock.mock.calls[payoutsMock.mock.calls.length - 1][0];
    expect(payoutArgs).toMatchObject({ from: intakeArgs.from, to: intakeArgs.to });
  });
});

describe('JournalPage — the month filter', () => {
  it('updates ?from and ?to when the month changes, and resets the page', () => {
    const { router } = renderJournal('/journal?page=2');

    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-07' } });

    const search = new URLSearchParams(router.state.location.search);
    expect(search.get('from')).toBe('2026-07-01');
    expect(search.get('to')).toBe('2026-07-31');
    expect(search.get('page')).toBeNull();
  });
});

describe('JournalPage — opening a receipt', () => {
  it('opens the receipt dialog for the intake behind a clicked row', async () => {
    const user = userEvent.setup();
    intakesMock.mockReturnValue(
      page<Intake>([intake({ id: 'i1', code: 'KV-0001', amount: '100.00' })]),
    );

    renderJournal();

    const row = screen.getByText('KV-0001').closest('tr');
    if (!row) throw new Error('row not found');
    await user.click(row);

    expect(receiptMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true, intakeId: 'i1' }),
    );
  });
});

describe('JournalPage — pagination', () => {
  it('labels the range, and enables only the direction that has more', async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: PAGE_SIZE }, (_, n) =>
      intake({ id: `i${n}`, code: `KV-${n}`, amount: '1.00' }),
    );
    intakesMock.mockReturnValue(page<Intake>(rows, 45));

    const { router } = renderJournal();

    expect(screen.getByText(`1–${PAGE_SIZE} of 45`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(new URLSearchParams(router.state.location.search).get('page')).toBe('2');
  });

  it('disables Next on the last page', () => {
    const rows = Array.from({ length: 5 }, (_, n) => intake({ id: `i${n}`, code: `KV-${n}`, amount: '1.00' }));
    intakesMock.mockReturnValue(page<Intake>(rows, 45));

    renderJournal('/journal?page=3');

    expect(screen.getByText(`41–45 of 45`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
  });
});

describe('JournalPage — the point and supplier filters', () => {
  it('scopes the supplier picker to the chosen point and resets the page', async () => {
    const user = userEvent.setup();
    suppliersMock.mockReturnValue(
      page<Supplier>([supplier({ id: SUP1, first_name: 'Olha', last_name: 'K.' })]),
    );

    const { router } = renderJournal('/journal?page=2');

    await user.selectOptions(screen.getByLabelText('Select a point'), P1);

    expect(new URLSearchParams(router.state.location.search).get('point')).toBe(P1);
    expect(new URLSearchParams(router.state.location.search).get('page')).toBeNull();
    expect(suppliersMock).toHaveBeenLastCalledWith('', P1);
    expect(screen.getByRole('option', { name: 'Olha K.' })).toBeInTheDocument();
  });

  it('clears a stale supplier filter when the point changes', async () => {
    const user = userEvent.setup();
    suppliersMock.mockReturnValue(
      page<Supplier>([supplier({ id: SUP1, first_name: 'Olha', last_name: 'K.' })]),
    );

    const { router } = renderJournal(`/journal?page=2&supplier=${SUP1}`);
    expect(new URLSearchParams(router.state.location.search).get('supplier')).toBe(SUP1);

    await user.selectOptions(screen.getByLabelText('Select a point'), P1);

    const search = new URLSearchParams(router.state.location.search);
    expect(search.get('point')).toBe(P1);
    expect(search.get('supplier')).toBeNull();
    expect(search.get('page')).toBeNull();
  });
});

describe('JournalPage — the voided switch', () => {
  it('resets the page when toggling «show voided»', async () => {
    const user = userEvent.setup();
    const { router } = renderJournal('/journal?page=3');

    await user.click(screen.getByRole('switch', { name: 'show voided' }));

    expect(new URLSearchParams(router.state.location.search).get('page')).toBeNull();
  });
});
