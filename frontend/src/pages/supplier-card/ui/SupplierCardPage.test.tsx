import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ApiError } from '@/shared/api';
import { expectNoAxeViolations } from '../../../test-axe';
import type { Supplier } from '@/entities/supplier';
import type { Intake } from '@/entities/intake';
import type { Payout } from '@/entities/payout';
import type { Me } from '@/entities/user';
import { SupplierCardPage } from './SupplierCardPage';

const {
  supplierMock,
  balanceMock,
  intakesMock,
  payoutsMock,
  meMock,
  pointsMock,
  receiptDialogMock,
  voidDialogMock,
  payoutDialogMock,
} = vi.hoisted(() => ({
  supplierMock: vi.fn(),
  balanceMock: vi.fn(),
  intakesMock: vi.fn(),
  payoutsMock: vi.fn(),
  meMock: vi.fn(),
  pointsMock: vi.fn(),
  receiptDialogMock: vi.fn(),
  voidDialogMock: vi.fn(),
  payoutDialogMock: vi.fn(),
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
  meMock.mockReset().mockReturnValue({ data: OPERATOR, isPending: false, isError: false });
  pointsMock.mockReset().mockReturnValue({
    data: [{ id: 'p1', name: 'Shypynky' }],
    isPending: false,
    isError: false,
  });
  receiptDialogMock.mockReset();
  voidDialogMock.mockReset();
  payoutDialogMock.mockReset();
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
