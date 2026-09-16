import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ApiError } from '@/shared/api';
import { expectNoAxeViolations } from '../../../test-axe';
import type { Supplier } from '@/entities/supplier';
import type { Intake } from '@/entities/intake';
import type { Payout } from '@/entities/payout';
import type { IntakeTopUp } from '@/entities/intake-top-up';
import type { Me } from '@/entities/user';
import { SupplierCardPage } from './SupplierCardPage';

const {
  supplierMock,
  balanceMock,
  intakesMock,
  payoutsMock,
  topUpsMock,
  meMock,
  pointsMock,
  receiptDialogMock,
  voidDialogMock,
  payoutDialogMock,
  topUpDialogMock,
} = vi.hoisted(() => ({
  supplierMock: vi.fn(),
  balanceMock: vi.fn(),
  intakesMock: vi.fn(),
  payoutsMock: vi.fn(),
  topUpsMock: vi.fn(),
  meMock: vi.fn(),
  pointsMock: vi.fn(),
  receiptDialogMock: vi.fn(),
  voidDialogMock: vi.fn(),
  payoutDialogMock: vi.fn(),
  topUpDialogMock: vi.fn(),
}));

vi.mock('@/entities/supplier', () => ({
  useSupplierQuery: (id: string | null) => supplierMock(id),
  useSupplierBalanceQuery: (id: string | null) => balanceMock(id),
  supplierName: (s: { first_name: string; last_name: string }) =>
    `${s.first_name} ${s.last_name}`,
}));

vi.mock('@/entities/intake', () => ({
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

vi.mock('@/widgets/receipt', () => ({
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
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
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

const page = <T,>(data: T[], total = data.length) => ({
  data: { data, total, page: 1, limit: 100 },
  isPending: false,
  isError: false,
});

function renderCard(id = 'sup1') {
  const router = createMemoryRouter([{ path: '/suppliers/:id', element: <SupplierCardPage /> }], {
    initialEntries: [`/suppliers/${id}`],
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
      data: { supplier_id: 'sup1', debt: '500.00' },
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

  it('tiles the season totals, excluding voided documents, and is axe-clean', async () => {
    intakesMock.mockReturnValue(
      page<Intake>([
        intake({ id: 'i1', code: 'KV-0001', amount: '1000.00', created_at: '2026-09-08T07:10:00Z' }),
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
    payoutsMock.mockReturnValue(
      page<Payout>([
        payout({ id: 'y1', code: 'VD-0001', amount: '300.00', created_at: '2026-09-08T09:20:00Z' }),
      ]),
    );

    const { container } = renderCard();

    expect(tile('Receipts this season')).toHaveTextContent('2');
    expect(tile('Accrued')).toHaveTextContent('1,000.00 ₴');
    expect(tile('Paid')).toHaveTextContent('300.00 ₴');
    expect(tile('Balance')).toHaveTextContent('500.00 ₴');

    await expectNoAxeViolations(container);
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
    balanceMock.mockReturnValue({
      data: { supplier_id: 'sup1', debt: '0.00' },
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

  it('shows a not-found message and a link back to the list for a missing supplier', () => {
    supplierMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new ApiError(404, 'not found', undefined, 'NOT_FOUND'),
    });

    renderCard('nope');

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

  it('warns the Paid tile is partial when payouts were truncated, same as Accrued', () => {
    intakesMock.mockReturnValue(page<Intake>([]));
    payoutsMock.mockReturnValue(page<Payout>([], 150));

    renderCard();

    expect(tile('Paid')).toHaveTextContent('first 100');
    expect(tile('Accrued')).not.toHaveTextContent('first 100');
  });

  it('shows no truncation hints when both journals are complete', () => {
    renderCard();

    expect(tile('Accrued')).not.toHaveTextContent('first 100');
    expect(tile('Paid')).not.toHaveTextContent('first 100');
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
});

/**
 * #61 — «фантомний залишок». `GET /suppliers/:id/balance` returns ONE `debt`
 * string with no breakdown, so this timeline is the only place the owner can
 * learn why the balance is what it is. Everything below is about that.
 */
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
   * The balance is `Σ intakes + Σ top-ups − Σ payouts`. A «Нараховано» tile
   * that summed only receipts would visibly disagree with the balance tile
   * beside it, and nothing on screen would say which one to believe.
   */
  it('adds LIVE top-ups to «Нараховано» so it agrees with the balance', () => {
    topUpsMock.mockReturnValue(
      page<IntakeTopUp>([
        topUp({ id: 't1', amount: '750.00', reason: 'r', created_at: '2026-09-09T10:00:00Z' }),
        topUp({
          id: 't2',
          amount: '999.00',
          reason: 'r',
          created_at: '2026-09-09T11:00:00Z',
          counts_toward_balance: false,
        }),
      ]),
    );

    renderCard();

    // 1 000 receipt + 750 live top-up. The 999 counts for nothing and is excluded.
    // The en locale groups thousands with a comma, so match the digits loosely
    // rather than pinning a separator this assertion is not about.
    expect(within(tile('Accrued')).getByText(/1[,\s]?750\.00/)).toBeInTheDocument();
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
