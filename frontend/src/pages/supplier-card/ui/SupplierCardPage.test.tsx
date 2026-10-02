import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ApiError } from '@/shared/api';
import { i18n } from '@/shared/lib/i18n';
import { expectNoAxeViolations } from '../../../test-axe';
import type {
  Supplier,
  SupplierBalanceOne,
  SupplierSettlement,
  SettlementLine,
} from '@/entities/supplier';
import type { Intake, IntakeItem } from '@/entities/intake';
import type { Payout } from '@/entities/payout';
import type { IntakeTopUp } from '@/entities/intake-top-up';
import type { Me } from '@/entities/user';
import { SupplierCardPage } from './SupplierCardPage';

const {
  supplierMock,
  balanceMock,
  settlementMock,
  intakesMock,
  payoutsMock,
  topUpsMock,
  meMock,
  pointsMock,
  receiptDialogMock,
  voidDialogMock,
  reopenedCodesMock,
  payoutDialogMock,
  topUpDialogMock,
} = vi.hoisted(() => ({
  supplierMock: vi.fn(),
  balanceMock: vi.fn(),
  settlementMock: vi.fn(),
  intakesMock: vi.fn(),
  payoutsMock: vi.fn(),
  topUpsMock: vi.fn(),
  meMock: vi.fn(),
  pointsMock: vi.fn(),
  receiptDialogMock: vi.fn(),
  voidDialogMock: vi.fn(),
  reopenedCodesMock: vi.fn(),
  payoutDialogMock: vi.fn(),
  topUpDialogMock: vi.fn(),
}));

vi.mock('@/entities/supplier', () => ({
  useSupplierQuery: (id: string | null) => supplierMock(id),
  useSupplierBalanceQuery: (id: string | null) => balanceMock(id),
  useSupplierSettlementQuery: (id: string | null) => settlementMock(id),
  supplierName: (s: { first_name: string; last_name: string }) =>
    `${s.first_name} ${s.last_name}`,
}));

vi.mock('@/entities/intake', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/entities/intake')>()),
  useIntakesQuery: (filter: unknown) => intakesMock(filter),
}));

vi.mock('@/entities/payout', () => ({
  usePayoutsQuery: (filter: unknown) => payoutsMock(filter),
}));

vi.mock('@/entities/intake-top-up', () => ({
  useIntakeTopUpsQuery: (filter: unknown) => topUpsMock(filter),
}));

vi.mock('@/entities/user', () => ({
  useMeQuery: () => meMock(),
}));

vi.mock('@/entities/collection-point', () => ({
  usePointOptionsQuery: () => pointsMock(),
}));

vi.mock('@/widgets/receipt', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/widgets/receipt')>()),
  ReceiptDialog: (props: Record<string, unknown>) => {
    receiptDialogMock(props);
    return props.open ? <div data-testid="receipt-dialog-mock" /> : null;
  },
}));

vi.mock('@/features/void-document', () => ({
  VoidDocumentDialog: (props: Record<string, unknown>) => {
    voidDialogMock(props);
    return props.open ? <div data-testid="void-dialog-mock" /> : null;
  },
  reopenedCodes: (...args: unknown[]) => reopenedCodesMock(...args),
}));

vi.mock('@/features/top-up-intake', () => ({
  TopUpDialog: (props: Record<string, unknown>) => {
    topUpDialogMock(props);
    return props.open ? <div data-testid="top-up-dialog-mock" /> : null;
  },
}));

vi.mock('@/features/settle-payout', () => ({
  PayoutDialog: (props: Record<string, unknown>) => {
    payoutDialogMock(props);
    return props.open ? <div data-testid="payout-dialog-mock" /> : null;
  },
}));

const SUPPLIER: Supplier = {
  id: 'sup1',
  collection_point_id: 'p1',
  first_name: 'Ivan',
  last_name: 'Koval',
  phone: '+380671234567',
  note: null,
  kind: 'farmer',
  is_active: true,
  created_at: '2026-08-01',
};

const OPERATOR: Me = {
  id: 'u1',
  username: 'operator',
  display_name: 'Olha',
  avatar_url: null,
  language_code: null,
  role: 'point_operator',
  collection_point_id: 'p1',
};

const OWNER: Me = {
  id: 'u9',
  username: 'owner',
  display_name: 'Petro',
  avatar_url: null,
  language_code: null,
  role: 'network_owner',
  collection_point_id: null,
};

const intake = (
  over: Partial<Intake> & Pick<Intake, 'id' | 'code' | 'amount' | 'created_at'>,
): Intake => ({
  shift_id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-08',
  supplier_id: 'sup1',
  received_by_user_id: 'u1',
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  shift_closed: false,
  net_kg: '36.90',
  lines_count: 2,
  supplier_name: 'Ніна Ільчук',
  paid_amount: '0.00',
  open_amount: '0.00',
  ...over,
});

const payout = (
  over: Partial<Payout> & Pick<Payout, 'id' | 'code' | 'amount' | 'created_at'>,
): Payout => ({
  shift_id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-08',
  supplier_id: 'sup1',
  paid_by_user_id: 'u1',
  intake_id: null,
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  shift_closed: false,
  return_settled_at: null,
  return_settled_by_user_id: null,
  return_note: null,
  ...over,
});

/**
 * A top-up as the API returns it. `counts_toward_balance` is the field the
 * screen actually reads — `voided_at` alone cannot tell you whether the row
 * counts, because the PARENT receipt's void makes it worthless too.
 */
const topUp = (
  over: Partial<IntakeTopUp> &
    Pick<IntakeTopUp, 'id' | 'amount' | 'reason' | 'created_at'>,
): IntakeTopUp => ({
  counts_toward_balance: true,
  intake: { id: 'i1', code: 'KV-0001', voided_at: null },
  created_by_user_id: 'u9',
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  ...over,
});

/** One receipt line as `expand=items` returns it — every field an item needs. */
const itemFixture: IntakeItem = {
  id: 'item1',
  item_order: 1,
  product_grade_id: 'pg1',
  product_name: 'Малина',
  grade_name: '1 сорт',
  gross_kg: '10.00',
  pallet_kg: '0.00',
  tare_weight_kg: '1.00',
  net_kg: '9.00',
  price: '100.00',
  bonus: '0.00',
  amount: '900.00',
  tare: [],
};

/** A whole intake header, `items` absent by default (matches «not asked»). */
const intakeFixture: Intake = intake({
  id: 'i1',
  code: 'KV-0001',
  amount: '1000.00',
  created_at: '2026-09-08T07:10:00Z',
});

/** `/balance`'s season counters. The three terms of `debt` are NOT here — the
 *  card reads them off `/settlement` (#153), see `SETTLEMENT_DEFAULT`. */
const BALANCE_DEFAULT: SupplierBalanceOne = {
  supplier_id: 'sup1',
  debt: '500.00',
  intakes_count: 0,
  kg_total: '0.00',
  last_intake_date: null,
};

/** `/settlement` with its three terms matched to arithmetic (`intakes_total
 *  + top_ups_total − payouts_total === debt`) so a test that never overrides
 *  them can't accidentally rely on an inconsistent default. */
const SETTLEMENT_DEFAULT: SupplierSettlement = {
  supplier_id: 'sup1',
  debt: '500.00',
  intakes_total: '500.00',
  top_ups_total: '0.00',
  payouts_total: '0.00',
  unallocated: '0.00',
  lines: [],
  payouts: [],
};

const settlementLine = (
  over: Partial<SettlementLine> & Pick<SettlementLine, 'id' | 'open'>,
): SettlementLine => ({
  kind: 'intake',
  code: over.id.toUpperCase(),
  intake_id: over.id,
  business_date: '2026-09-08',
  created_at: '2026-09-08T07:10:00Z',
  amount: over.open,
  paid: '0.00',
  covered_by: [],
  ...over,
});

const page = <T,>(data: T[], total = data.length) => ({
  data: { data, total, page: 1, limit: 100 },
  isPending: false,
  isError: false,
});

/**
 * `intakes`/`balance` override the respective mocks' return value BEFORE
 * rendering — for the tests that need a specific fixture rather than the
 * `beforeEach` defaults below. Existing call sites that pass neither keep
 * working unchanged.
 */
function renderCard(opts?: {
  id?: string;
  intakes?: Intake[];
  balance?: SupplierBalanceOne;
  settlement?: Partial<SupplierSettlement>;
}) {
  if (opts?.intakes) {
    intakesMock.mockReturnValue(page<Intake>(opts.intakes));
  }
  if (opts?.balance) {
    balanceMock.mockReturnValue({ data: opts.balance, isPending: false, isError: false });
  }
  if (opts?.settlement) {
    settlementMock.mockReturnValue({
      data: { ...SETTLEMENT_DEFAULT, ...opts.settlement },
      isPending: false,
      isError: false,
    });
  }
  const router = createMemoryRouter([{ path: '/suppliers/:id', element: <SupplierCardPage /> }], {
    initialEntries: [`/suppliers/${opts?.id ?? 'sup1'}`],
  });
  return render(<RouterProvider router={router} />);
}

function tile(label: string): HTMLElement {
  const el = screen.getByText(label).closest('[data-slot="stat-tile"]');
  if (!el) throw new Error(`No stat tile labelled "${label}"`);
  return el as HTMLElement;
}

beforeEach(() => {
  supplierMock.mockReset().mockReturnValue({ data: SUPPLIER, isPending: false, isError: false });
  balanceMock
    .mockReset()
    .mockReturnValue({
      data: BALANCE_DEFAULT,
      isPending: false,
      isError: false,
    });
  settlementMock.mockReset().mockReturnValue({
    data: SETTLEMENT_DEFAULT,
    isPending: false,
    isError: false,
  });
  intakesMock.mockReset().mockReturnValue(page<Intake>([]));
  payoutsMock.mockReset().mockReturnValue(page<Payout>([]));
  topUpsMock.mockReset().mockReturnValue(page<IntakeTopUp>([]));
  meMock.mockReset().mockReturnValue({ data: OPERATOR, isPending: false, isError: false });
  pointsMock.mockReset().mockReturnValue({
    data: [{ id: 'p1', name: 'Shypynky' }],
    isPending: false,
    isError: false,
  });
  receiptDialogMock.mockReset();
  voidDialogMock.mockReset();
  reopenedCodesMock.mockReset().mockReturnValue(['KV-0001', 'KV-0002']);
  payoutDialogMock.mockReset();
  topUpDialogMock.mockReset();
});

describe('SupplierCardPage', () => {
  it('renders the supplier name, phone and point in the header', () => {
    renderCard();

    expect(screen.getByRole('heading', { level: 1, name: 'Ivan Koval' })).toBeInTheDocument();
    expect(screen.getByText('+380671234567')).toBeInTheDocument();
    expect(screen.getByText('Shypynky · Farmer')).toBeInTheDocument();
  });

  /**
   * §103/#148: the tiles are READ FACTS — the counters off `/balance`, the
   * money off `/settlement` (#153) — not a sum of whatever page of `/intakes`
   * happened to load. A voided document is already excluded server-side, so
   * this is no longer a frontend filtering concern (see "reads its tiles from
   * the server" below for the case where the two sources visibly disagree).
   * The receipt carries `items` so the nested lines inside the row button
   * reach axe too.
   */
  it('tiles the season totals from the server, and is axe-clean', async () => {
    intakesMock.mockReturnValue(
      page<Intake>([
        intake({
          id: 'i1',
          code: 'KV-0001',
          amount: '1000.00',
          created_at: '2026-09-08T07:10:00Z',
          items: [itemFixture, { ...itemFixture, id: 'item2', item_order: 2 }],
        }),
      ]),
    );
    payoutsMock.mockReturnValue(
      page<Payout>([
        payout({ id: 'y1', code: 'VD-0001', amount: '300.00', created_at: '2026-09-08T09:20:00Z' }),
      ]),
    );
    balanceMock.mockReturnValue({
      data: {
        supplier_id: 'sup1',
        debt: '700.00',
        // 2, not 1 loaded row — a season total past what /intakes returned,
        // proving the tile reads the server and not `intakes.data`.
        intakes_count: 2,
        kg_total: '36.90',
        last_intake_date: '2026-09-08',
      },
      isPending: false,
      isError: false,
    });

    const { container } = renderCard({
      settlement: { debt: '700.00', intakes_total: '1000.00', payouts_total: '300.00' },
    });

    expect(tile('Receipts this season')).toHaveTextContent('2');
    expect(tile('Berries handed over')).toHaveTextContent('36.90 kg');
    expect(tile('Accrued')).toHaveTextContent('1,000.00 ₴');
    expect(tile('Balance')).toHaveTextContent('700.00 ₴');

    await expectNoAxeViolations(container);
  });

  /**
   * §103/#148 — pinned with a fixture where the two sources would visibly
   * disagree: the loaded page has ONE receipt worth 1 000, but the season
   * had ninety more. If a tile ever went back to summing `intakes.data`,
   * this is the test that would catch it.
   */
  it('reads its tiles from the server, not from the page it happened to load', async () => {
    renderCard({
      intakes: [{ ...intakeFixture, amount: '1000.00', net_kg: '10.00' }],
      balance: {
        supplier_id: 'sup1',
        debt: '4000.00',
        intakes_count: 91,
        kg_total: '2500.50',
        last_intake_date: '2026-09-20',
      },
      settlement: { debt: '4000.00', intakes_total: '10000.00', payouts_total: '6000.00' },
    });

    expect(await screen.findByText('91')).toBeInTheDocument();
    expect(tile('Accrued')).toHaveTextContent('10,000.00 ₴');
    expect(tile('Accrued')).not.toHaveTextContent('1,000.00 ₴');
    // Kilograms diverge the same way: the one loaded row weighs 10.00.
    expect(tile('Berries handed over')).toHaveTextContent('2,500.50 kg');
  });

  /**
   * #153 — the tile and the line that explains it read ONE snapshot. Here
   * `/balance` answers a stale 4 200 while `/settlement` answers 4 000: the
   * tile and every term of the line must come from `/settlement`, so the
   * line always adds up to the number above it.
   */
  it('explains the balance from the same snapshot the balance tile reads', () => {
    renderCard({
      balance: { ...BALANCE_DEFAULT, debt: '4200.00' },
      settlement: {
        debt: '4000.00',
        intakes_total: '9000.00',
        top_ups_total: '1000.00',
        payouts_total: '6000.00',
      },
    });

    expect(tile('Balance')).toHaveTextContent('4,000.00 ₴');
    expect(
      screen.getByText('receipts 9,000.00 ₴ + top-ups 1,000.00 ₴ − paid out 6,000.00 ₴'),
    ).toBeInTheDocument();
  });

  it('strikes the voided row through and shows the reason', () => {
    intakesMock.mockReturnValue(
      page<Intake>([
        intake({
          id: 'i2',
          code: 'KV-0002',
          amount: '99.00',
          created_at: '2026-09-08T08:00:00Z',
          voided_at: '2026-09-08T09:00:00Z',
          void_reason: 'Wrong supplier',
        }),
      ]),
    );

    renderCard();

    const row = screen.getByText('KV-0002').closest('li');
    expect(row).toHaveClass('line-through');
    expect(row).toHaveAttribute('title', 'Wrong supplier');
    expect(within(row as HTMLElement).getByText('Wrong supplier')).toBeInTheDocument();
  });

  it('offers to pay out the balance when the supplier owes money', () => {
    renderCard();
    expect(screen.getByRole('button', { name: /Pay out balance/ })).toBeInTheDocument();
  });

  it('hides the pay-out action once the balance is settled', () => {
    settlementMock.mockReturnValue({
      data: { ...SETTLEMENT_DEFAULT, debt: '0.00', payouts_total: '500.00' },
      isPending: false,
      isError: false,
    });

    renderCard();

    expect(screen.queryByRole('button', { name: /Pay out balance/ })).not.toBeInTheDocument();
  });

  it('opens the receipt when an intake row is clicked', async () => {
    intakesMock.mockReturnValue(
      page<Intake>([
        intake({ id: 'i1', code: 'KV-0001', amount: '1000.00', created_at: '2026-09-08T07:10:00Z' }),
      ]),
    );

    renderCard();
    await userEvent.click(screen.getByText('KV-0001'));

    expect(receiptDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true, intakeId: 'i1' }),
    );
  });

  it('shows Void on a payout row for the operator who recorded it', () => {
    payoutsMock.mockReturnValue(
      page<Payout>([
        payout({
          id: 'y1',
          code: 'VD-0001',
          amount: '300.00',
          created_at: '2026-09-08T09:20:00Z',
          paid_by_user_id: 'u1',
        }),
      ]),
    );

    renderCard();

    expect(screen.getByRole('button', { name: 'Void' })).toBeInTheDocument();
  });

  it('hides Void on a payout row recorded by a different operator', () => {
    payoutsMock.mockReturnValue(
      page<Payout>([
        payout({
          id: 'y1',
          code: 'VD-0001',
          amount: '300.00',
          created_at: '2026-09-08T09:20:00Z',
          paid_by_user_id: 'someone-else',
        }),
      ]),
    );

    renderCard();

    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
  });

  it('shows Void for the owner on any payout', () => {
    payoutsMock.mockReturnValue(
      page<Payout>([
        payout({
          id: 'y1',
          code: 'VD-0001',
          amount: '300.00',
          created_at: '2026-09-08T09:20:00Z',
          paid_by_user_id: 'someone-else',
        }),
      ]),
    );
    meMock.mockReturnValue({ data: OWNER, isPending: false, isError: false });

    renderCard();

    expect(screen.getByRole('button', { name: 'Void' })).toBeInTheDocument();
  });

  it('voids a payout with its amount, shift state and the receipts it reopens', async () => {
    payoutsMock.mockReturnValue(
      page<Payout>([
        payout({ id: 'y1', code: 'VD-0001', amount: '300.00', created_at: '2026-09-08T09:20:00Z', shift_closed: true }),
      ]),
    );
    meMock.mockReturnValue({ data: OWNER, isPending: false, isError: false });

    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));

    expect(reopenedCodesMock).toHaveBeenCalledWith(settlementMock.mock.results[0].value.data, 'y1', null);
    expect(voidDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'payout',
        id: 'y1',
        shiftClosed: true,
        payoutAmount: '300.00',
        reopens: ['KV-0001', 'KV-0002'],
      }),
    );
  });

  it('shows a not-found message and a link back to the list for a missing supplier', () => {
    supplierMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new ApiError(404, 'not found', undefined, 'NOT_FOUND'),
    });

    renderCard({ id: 'nope' });

    expect(screen.getByText('Card not found.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /All suppliers/ })).toBeInTheDocument();
  });

  it('shows the generic error state for any other query failure', () => {
    supplierMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('network down'),
    });

    renderCard();

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('shows a back link on the generic error state too', () => {
    supplierMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('network down'),
    });

    renderCard();

    expect(screen.getByRole('link', { name: /All suppliers/ })).toBeInTheDocument();
  });

  /**
   * §103/#148 — the pairing that is the whole point of the change: the
   * timeline's OWN note stays honest about the page it loaded, while the
   * tiles (now server-computed season facts) don't move at all.
   */
  it('keeps the tiles unaffected by a truncated timeline page', () => {
    intakesMock.mockReturnValue(
      page<Intake>(
        [intake({ id: 'i1', code: 'KV-0001', amount: '1000.00', created_at: '2026-09-08T07:10:00Z' })],
        150,
      ),
    );
    balanceMock.mockReturnValue({
      data: {
        ...BALANCE_DEFAULT,
        intakes_count: 200,
        kg_total: '9999.99',
        debt: '1000.00',
      },
      isPending: false,
      isError: false,
    });

    renderCard({
      settlement: { debt: '1000.00', intakes_total: '50000.00', payouts_total: '49000.00' },
    });

    expect(screen.getByText('Showing the first 100 receipts and payouts')).toBeInTheDocument();
    expect(tile('Receipts this season')).toHaveTextContent('200');
    expect(tile('Accrued')).toHaveTextContent('50,000.00 ₴');
  });

  it('shows no truncation note when every journal is complete', () => {
    renderCard();

    expect(screen.queryByText('Showing the first 100 receipts and payouts')).toBeNull();
  });

  it('shows a timeline note when intakes were truncated', () => {
    intakesMock.mockReturnValue(page<Intake>([], 150));

    renderCard();

    expect(screen.getByText('Showing the first 100 receipts and payouts')).toBeInTheDocument();
  });

  it('shows a timeline note when payouts were truncated', () => {
    payoutsMock.mockReturnValue(page<Payout>([], 150));

    renderCard();

    expect(screen.getByText('Showing the first 100 receipts and payouts')).toBeInTheDocument();
  });

  it('waits for the intakes and payouts journals before rendering tiles, so they never flash 0', () => {
    intakesMock.mockReturnValue({ data: undefined, isPending: true, isError: false });

    renderCard();

    expect(screen.getByRole('progressbar', { name: 'loading' })).toBeInTheDocument();
    expect(screen.queryByText('Accrued')).toBeNull();
    expect(screen.queryByRole('heading', { level: 1, name: 'Ivan Koval' })).toBeNull();
  });

  it('shows the open-balances section and the oldest-debt hint from the settlement', () => {
    // M6 — pin the clock so the day count is a fixed number, not a moving
    // target. Fake ONLY `Date`: faking timers wholesale is known to break
    // TanStack/Testing Library's async plumbing.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-08T12:00:00'));
    try {
      settlementMock.mockReturnValue({
        data: {
          ...SETTLEMENT_DEFAULT,
          debt: '500.00',
          unallocated: '0.00',
          lines: [settlementLine({ id: 'i1', open: '500.00', business_date: '2026-09-01' })],
          payouts: [],
        },
        isPending: false,
        isError: false,
      });
      intakesMock.mockReturnValue(
        page<Intake>([
          intake({ id: 'i1', code: 'KV-0001', amount: '500.00', created_at: '2026-09-01T07:10:00Z' }),
        ]),
      );

      renderCard();

      expect(screen.getByText('Open balances — what exactly is owed')).toBeInTheDocument();
      // 2026-09-01 to 2026-09-08 (the pinned "today") is exactly 7 whole days.
      expect(tile('Balance')).toHaveTextContent('— 7 days');
    } finally {
      vi.useRealTimers();
    }
  });

  it('clamps the day count to 0 when the oldest open line is dated AFTER today', () => {
    // M5 — a reopened-shift receipt (or clock skew) can carry a business_date
    // in the future; the hint must never print a negative day count.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-08T12:00:00'));
    try {
      settlementMock.mockReturnValue({
        data: {
          ...SETTLEMENT_DEFAULT,
          debt: '500.00',
          unallocated: '0.00',
          lines: [settlementLine({ id: 'i1', open: '500.00', business_date: '2026-09-10' })],
          payouts: [],
        },
        isPending: false,
        isError: false,
      });
      intakesMock.mockReturnValue(
        page<Intake>([
          intake({ id: 'i1', code: 'KV-0001', amount: '500.00', created_at: '2026-09-10T07:10:00Z' }),
        ]),
      );

      renderCard();

      expect(tile('Balance')).toHaveTextContent('— 0 days');
    } finally {
      vi.useRealTimers();
    }
  });

  it('captions history rows with what is open and what a payout closed', () => {
    settlementMock.mockReturnValue({
      data: {
        ...SETTLEMENT_DEFAULT,
        debt: '200.00',
        unallocated: '0.00',
        lines: [
          settlementLine({ id: 'i1', open: '0.00', amount: '300.00', paid: '300.00', business_date: '2026-09-01' }),
          settlementLine({ id: 'i2', open: '200.00', amount: '200.00', business_date: '2026-09-08' }),
        ],
        payouts: [
          {
            id: 'y1', code: 'VD-0001', business_date: '2026-09-08', created_at: '2026-09-08T09:20:00Z',
            amount: '300.00', intake_id: null,
            covers: [{ line_id: 'i1', kind: 'intake', amount: '300.00' }],
            unallocated: '0.00',
          },
        ],
      },
      isPending: false,
      isError: false,
    });
    intakesMock.mockReturnValue(
      page<Intake>([
        intake({ id: 'i1', code: 'KV-0001', amount: '300.00', created_at: '2026-09-01T07:10:00Z', business_date: '2026-09-01' }),
        intake({ id: 'i2', code: 'KV-0002', amount: '200.00', created_at: '2026-09-08T07:10:00Z' }),
      ]),
    );
    payoutsMock.mockReturnValue(
      page<Payout>([
        payout({ id: 'y1', code: 'VD-0001', amount: '300.00', created_at: '2026-09-08T09:20:00Z' }),
      ]),
    );

    renderCard();

    // `SectionCard` renders a plain `<div>` for every level (the eyebrow's own
    // wrapper included), so `closest('section, div')` would stop at the
    // eyebrow's own one-line div rather than the card. `.rounded-xl` is the
    // outer SectionCard shell's own class, and no ancestor between the title
    // text and that shell carries it, so it scopes to the whole history card.
    const history = screen.getByText('History — receipts and payouts').closest('.rounded-xl')!;
    expect(within(history as HTMLElement).getByText('KV-0002').closest('li')).toHaveTextContent(
      '200.00 ₴ still open',
    );
    expect(within(history as HTMLElement).getByText('KV-0001').closest('li')).not.toHaveTextContent(
      'still open',
    );
    expect(screen.getByText('VD-0001').closest('li')).toHaveTextContent(/closed berries of .*01/);
  });

  it('captions an overpaid payout with the unallocated amount', () => {
    settlementMock.mockReturnValue({
      data: {
        ...SETTLEMENT_DEFAULT,
        debt: '-50.00',
        unallocated: '50.00',
        lines: [],
        payouts: [
          {
            id: 'y1', code: 'VD-0001', business_date: '2026-09-08', created_at: '2026-09-08T09:20:00Z',
            amount: '50.00', intake_id: null, covers: [], unallocated: '50.00',
          },
        ],
      },
      isPending: false,
      isError: false,
    });
    payoutsMock.mockReturnValue(
      page<Payout>([
        payout({ id: 'y1', code: 'VD-0001', amount: '50.00', created_at: '2026-09-08T09:20:00Z' }),
      ]),
    );

    renderCard();

    expect(screen.getByText('VD-0001').closest('li')).toHaveTextContent('50.00 ₴ not allocated');
    expect(screen.getByText('Overpayment — not allocated')).toBeInTheDocument();
  });

  it('shows the shared error banner when the settlement fails', () => {
    settlementMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderCard();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

/**
 * #148 — the client's own complaint: «достатньо зайти на постачальника і
 * одразу розгорнуто видно, що коли і скільки». A multi-line receipt shows
 * every line beneath its row, always — no disclosure, no second click. These
 * assertions pin the actual Ukrainian copy a приймальник reads (product,
 * grade, «брутто»/«тара», the U+2212 minus, the price-per-kilogram unit), so
 * — unlike the rest of this file, which runs `en` — they switch to `uk`, the
 * locale `test-setup.ts` only overrides away from for the suite's own
 * assertions (mirrors `WeighingForm.test.tsx`'s own convention).
 */
describe('SupplierCardPage — receipt lines (uk locale)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('uk');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows what the person handed over without opening anything', async () => {
    renderCard({
      intakes: [
        {
          ...intakeFixture,
          code: 'КВ-000142',
          amount: '12480.00',
          items: [
            {
              ...itemFixture,
              id: 'item1',
              item_order: 1,
              product_name: 'Полуниця',
              grade_name: 'Альба',
              gross_kg: '86.50',
              tare_weight_kg: '2.50',
              net_kg: '84.00',
              price: '120.00',
              bonus: '0.00',
            },
            {
              ...itemFixture,
              id: 'item2',
              item_order: 2,
              product_name: 'Малина',
              grade_name: 'Полка',
              gross_kg: '60.00',
              tare_weight_kg: '2.00',
              net_kg: '58.00',
              price: '95.00',
              bonus: '0.00',
            },
          ],
        },
      ],
    });

    expect(await screen.findByText(/Полуниця «Альба»/)).toBeInTheDocument();
    expect(screen.getByText(/86,50 брутто − 2,50 тара · 120,00 ₴\/кг/)).toBeInTheDocument();
    expect(screen.getByText(/Малина «Полка»/)).toBeInTheDocument();
  });

  it('adds the bonus into the price it prints', async () => {
    renderCard({
      intakes: [
        { ...intakeFixture, items: [{ ...itemFixture, price: '120.00', bonus: '5.00' }] },
      ],
    });

    expect(await screen.findByText(/125,00 ₴\/кг/)).toBeInTheDocument();
  });

  /**
   * Review round 1 (#148): the weights line omitted `pallet_kg`, so
   * `{gross} брутто − {tare} тара` did not reconcile with `net_kg` printed
   * directly above it whenever a receipt used a pallet — the backend's own
   * formula is `net = (gross − pallet) − tare` (`intake-lines.ts:149`). This
   * pins the case that broke: gross 42,00 − pallet 1,50 − tare 3,60 = net
   * 36,90, asserted alongside the `net_kg` line above it so the test
   * documents the real arithmetic, not just the string.
   */
  it('adds the pallet term when it is non-zero, reconciling with the net kg above it', async () => {
    renderCard({
      intakes: [
        {
          ...intakeFixture,
          items: [
            {
              ...itemFixture,
              product_name: 'Малина',
              grade_name: '1 сорт',
              gross_kg: '42.00',
              pallet_kg: '1.50',
              tare_weight_kg: '3.60',
              net_kg: '36.90',
              price: '100.00',
              bonus: '0.00',
            },
          ],
        },
      ],
    });

    expect(await screen.findByText(/Малина «1 сорт» · 36,90 кг/)).toBeInTheDocument();
    expect(
      screen.getByText(/42,00 брутто − 1,50 піддон − 3,60 тара · 100,00 ₴\/кг/),
    ).toBeInTheDocument();
  });

  /**
   * The common single-crate row (no pallet) must stay byte-identical to
   * what it rendered before this fix, so the mock's row still matches.
   */
  it('keeps the two-term weights line when pallet is zero', async () => {
    renderCard({
      intakes: [
        {
          ...intakeFixture,
          items: [
            {
              ...itemFixture,
              pallet_kg: '0.00',
              gross_kg: '86.50',
              tare_weight_kg: '2.50',
              net_kg: '84.00',
              price: '120.00',
              bonus: '0.00',
            },
          ],
        },
      ],
    });

    expect(
      await screen.findByText(/86,50 брутто − 2,50 тара · 120,00 ₴\/кг/),
    ).toBeInTheDocument();
    // Not the three-term form — «піддон» must not appear anywhere on this row.
    expect(screen.queryByText(/піддон/)).not.toBeInTheDocument();
  });

  /**
   * A receipt row grew a whole block of new content; the СТОРНОВАНО
   * treatment sits on the `<li>` it grew inside, so the lines must ride
   * along with it rather than escape the struck-through row.
   */
  it('still strikes a voided receipt through, reason and all, now that it carries lines', async () => {
    renderCard({
      intakes: [
        {
          ...intakeFixture,
          voided_at: '2026-09-20T10:00:00.000Z',
          void_reason: 'Помилка ваги',
          items: [{ ...itemFixture, product_name: 'Полуниця', grade_name: 'Альба' }],
        },
      ],
    });

    expect(await screen.findByText('Помилка ваги')).toBeInTheDocument();
    // The lines are inside the struck-through row, not escaping it.
    const row = screen.getByText('Помилка ваги').closest('li');
    expect(row).toHaveClass('line-through');
    expect(within(row as HTMLElement).getByText(/Полуниця «Альба»/)).toBeInTheDocument();
  });
});

/**
 * #61 — «фантомний залишок». `GET /suppliers/:id/settlement` returns the
 * three terms that add up to `debt` (#103, #153) — the CARD's tiles and
 * breakdown line read those directly (see the describe block below this
 * one). This timeline stays the only place the owner sees each individual
 * DOCUMENT: which receipt, which top-up, when, and — since #148 — exactly
 * what was handed over per receipt line.
 */
describe('SupplierCardPage — «Void» on a receipt row (§9.4)', () => {
  const voidButton = (code: string) => screen.queryByRole('button', { name: `Void ${code}` });
  const LIVE = { id: 'i1', code: 'KV-0001', amount: '1000.00', created_at: '2026-09-08T07:10:00Z' };

  it('is shown to the owner while the shift is open', () => {
    meMock.mockReturnValue({ data: OWNER, isPending: false, isError: false });
    intakesMock.mockReturnValue(page<Intake>([intake(LIVE)]));
    renderCard();
    expect(voidButton('KV-0001')).toBeInTheDocument();
  });

  it('is hidden even from the owner once the shift is closed', () => {
    meMock.mockReturnValue({ data: OWNER, isPending: false, isError: false });
    intakesMock.mockReturnValue(page<Intake>([intake({ ...LIVE, shift_closed: true })]));
    renderCard();
    expect(voidButton('KV-0001')).not.toBeInTheDocument();
  });

  it('is shown to the author while the shift is open', () => {
    intakesMock.mockReturnValue(page<Intake>([intake(LIVE)]));
    renderCard();
    expect(voidButton('KV-0001')).toBeInTheDocument();
  });

  it('is hidden from another operator', () => {
    intakesMock.mockReturnValue(page<Intake>([intake({ ...LIVE, received_by_user_id: 'u2' })]));
    renderCard();
    expect(voidButton('KV-0001')).toBeNull();
  });

  it('is hidden from the author once the shift is closed', () => {
    intakesMock.mockReturnValue(page<Intake>([intake({ ...LIVE, shift_closed: true })]));
    renderCard();
    expect(voidButton('KV-0001')).toBeNull();
  });

  it('is hidden on a voided receipt', () => {
    meMock.mockReturnValue({ data: OWNER, isPending: false, isError: false });
    intakesMock.mockReturnValue(
      page<Intake>([intake({ ...LIVE, voided_at: '2026-09-08T08:00:00Z' })]),
    );
    renderCard();
    expect(voidButton('KV-0001')).toBeNull();
  });

  it('opens the receipt straight into its void', async () => {
    intakesMock.mockReturnValue(page<Intake>([intake(LIVE)]));
    renderCard();

    await userEvent.click(voidButton('KV-0001')!);

    expect(receiptDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true, intakeId: 'i1', startWithVoid: true }),
    );
  });

  it('a plain row click opens the receipt without the void', async () => {
    intakesMock.mockReturnValue(page<Intake>([intake(LIVE)]));
    renderCard();

    await userEvent.click(screen.getByText('KV-0001'));

    expect(receiptDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true, intakeId: 'i1', startWithVoid: false }),
    );
  });
});

describe('SupplierCardPage — top-ups', () => {
  beforeEach(() => {
    meMock.mockReturnValue({ data: OWNER, isPending: false, isError: false });
    intakesMock.mockReturnValue(
      page<Intake>([
        intake({ id: 'i1', code: 'KV-0001', amount: '1000.00', created_at: '2026-09-08T07:10:00Z' }),
      ]),
    );
  });

  it('lists a top-up with its reason and the receipt it is against', () => {
    topUpsMock.mockReturnValue(
      page<IntakeTopUp>([
        topUp({
          id: 't1',
          amount: '750.00',
          reason: 'Домовились про 48 замість 45 після здачі',
          created_at: '2026-09-09T10:00:00Z',
        }),
      ]),
    );

    renderCard();

    expect(screen.getByText('Домовились про 48 замість 45 після здачі')).toBeInTheDocument();
    expect(screen.getByText('against KV-0001')).toBeInTheDocument();
  });

  /**
   * M8 — a top-up row is captioned from ITS OWN settlement line (kind
   * `top_up`, id = the top-up's own id), not its parent receipt's.
   */
  it('captions an open top-up row with what is still open, from its own settlement line', () => {
    settlementMock.mockReturnValue({
      data: {
        ...SETTLEMENT_DEFAULT,
        debt: '750.00',
        unallocated: '0.00',
        lines: [
          settlementLine({ id: 'i1', open: '0.00', amount: '1000.00', paid: '1000.00' }),
          settlementLine({
            id: 't1',
            open: '750.00',
            kind: 'top_up',
            intake_id: 'i1',
            amount: '750.00',
          }),
        ],
        payouts: [],
      },
      isPending: false,
      isError: false,
    });
    topUpsMock.mockReturnValue(
      page<IntakeTopUp>([
        topUp({ id: 't1', amount: '750.00', reason: 'Доплата', created_at: '2026-09-09T10:00:00Z' }),
      ]),
    );

    renderCard();

    expect(screen.getByText('Доплата').closest('li')).toHaveTextContent('750.00 ₴ still open');
  });

  /**
   * THE ASYMMETRY THAT MATTERS. A row whose PARENT was voided is still live —
   * it simply counts for nothing — and hiding it is the silence
   * `counts_toward_balance` exists to prevent.
   */
  it('still lists a top-up whose PARENT receipt was voided, and says so', () => {
    topUpsMock.mockReturnValue(
      page<IntakeTopUp>([
        topUp({
          id: 't1',
          amount: '750.00',
          reason: 'Доплата',
          created_at: '2026-09-09T10:00:00Z',
          counts_toward_balance: false,
          intake: { id: 'i1', code: 'KV-0001', voided_at: '2026-09-10T09:00:00Z' },
        }),
      ]),
    );

    renderCard();

    expect(screen.getByText('Доплата')).toBeInTheDocument();
    expect(screen.getByText(/the receipt was voided/i)).toBeInTheDocument();
  });

  it('distinguishes a top-up the owner voided from one whose parent was voided', () => {
    topUpsMock.mockReturnValue(
      page<IntakeTopUp>([
        topUp({
          id: 't1',
          amount: '750.00',
          reason: 'Доплата',
          created_at: '2026-09-09T10:00:00Z',
          counts_toward_balance: false,
          voided_at: '2026-09-11T09:00:00Z',
          void_reason: 'Помилка в сумі',
        }),
      ]),
    );

    renderCard();

    expect(screen.getByText('Помилка в сумі')).toBeInTheDocument();
    expect(screen.queryByText(/the receipt was voided/i)).not.toBeInTheDocument();
  });

  /**
   * The balance is `Σ intakes + Σ top-ups − Σ payouts`, and the SERVER
   * decomposes it that way too (`SupplierDebtQuery.termsFor`, on
   * `/settlement`). «Нараховано» is what the supplier was credited — receipts
   * AND top-ups — so it cannot read 1 000 beside a 1 500 balance; the labelled
   * line under the tiles keeps the top-up term visible on its own.
   */
  it('counts top-ups into «Accrued» and names every term of the breakdown line', () => {
    renderCard({
      settlement: {
        intakes_total: '1000.00',
        top_ups_total: '750.00',
        payouts_total: '250.00',
        debt: '1500.00',
      },
    });

    expect(tile('Accrued')).toHaveTextContent('1,750.00 ₴');
    expect(
      screen.getByText('receipts 1,000.00 ₴ + top-ups 750.00 ₴ − paid out 250.00 ₴'),
    ).toBeInTheDocument();
  });

  it('drops the top-up term from the breakdown line when there are none', () => {
    renderCard({
      settlement: {
        intakes_total: '1000.00',
        top_ups_total: '0.00',
        payouts_total: '250.00',
        debt: '750.00',
      },
    });

    expect(screen.getByText('receipts 1,000.00 ₴ − paid out 250.00 ₴')).toBeInTheDocument();
    expect(screen.queryByText(/top-ups/)).toBeNull();
  });

  it('opens the top-up dialog for the receipt the owner clicked', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: /add a balance/i }));

    expect(screen.getByTestId('top-up-dialog-mock')).toBeInTheDocument();
    expect(topUpDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ intake: { id: 'i1', code: 'KV-0001' }, supplierName: 'Ivan Koval' }),
    );
  });

  /**
   * §10.2 — a whole ACTION is ABSENT for the operator, never disabled:
   * «заблокована кнопка вчить шукати обхід, відсутня не вчить нічого».
   */
  it('never offers «Додати залишок» to an operator', () => {
    meMock.mockReturnValue({ data: OPERATOR, isPending: false, isError: false });
    renderCard();
    expect(screen.queryByRole('button', { name: /add a balance/i })).not.toBeInTheDocument();
  });

  it('offers no top-up on a VOIDED receipt — it would count for nothing', () => {
    intakesMock.mockReturnValue(
      page<Intake>([
        intake({
          id: 'i1',
          code: 'KV-0001',
          amount: '1000.00',
          created_at: '2026-09-08T07:10:00Z',
          voided_at: '2026-09-09T09:00:00Z',
          void_reason: 'Помилка',
        }),
      ]),
    );

    renderCard();

    expect(screen.queryByRole('button', { name: /add a balance/i })).not.toBeInTheDocument();
  });

  it('voids a top-up through the shared dialog, titled with the PARENT code', async () => {
    const user = userEvent.setup();
    topUpsMock.mockReturnValue(
      page<IntakeTopUp>([
        topUp({ id: 't1', amount: '750.00', reason: 'Доплата', created_at: '2026-09-09T10:00:00Z' }),
      ]),
    );

    renderCard();

    const row = screen.getByText('Доплата').closest('li')!;
    await user.click(within(row).getByRole('button', { name: /void/i }));

    expect(voidDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'topUp', id: 't1', code: 'KV-0001' }),
    );
  });

  it('offers an operator no way to void a top-up', () => {
    meMock.mockReturnValue({ data: OPERATOR, isPending: false, isError: false });
    topUpsMock.mockReturnValue(
      page<IntakeTopUp>([
        topUp({ id: 't1', amount: '750.00', reason: 'Доплата', created_at: '2026-09-09T10:00:00Z' }),
      ]),
    );

    renderCard();

    const row = screen.getByText('Доплата').closest('li')!;
    expect(within(row).queryByRole('button', { name: /void/i })).not.toBeInTheDocument();
  });
});
