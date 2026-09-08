import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import type { IntakeDetail } from '@/entities/intake';
import { ReceiptDialog } from './ReceiptDialog';

const {
  intakeMock,
  supplierMock,
  balanceMock,
  gradesMock,
  tareTypesMock,
  pointsMock,
  meMock,
  payoutDialogMock,
  voidDialogMock,
} = vi.hoisted(() => ({
  intakeMock: vi.fn(),
  supplierMock: vi.fn(),
  balanceMock: vi.fn(),
  gradesMock: vi.fn(),
  tareTypesMock: vi.fn(),
  pointsMock: vi.fn(),
  meMock: vi.fn(),
  payoutDialogMock: vi.fn(),
  voidDialogMock: vi.fn(),
}));

vi.mock('@/entities/intake', () => ({
  useIntakeQuery: (id: string | null) => intakeMock(id),
}));

vi.mock('@/entities/supplier', () => ({
  useSupplierQuery: (id: string | null) => supplierMock(id),
  useSupplierBalanceQuery: (id: string | null) => balanceMock(id),
  supplierName: (s: { first_name: string; last_name: string }) => `${s.first_name} ${s.last_name}`,
}));

vi.mock('@/entities/product-grade', () => ({
  useGradeCatalogQuery: () => gradesMock(),
}));

vi.mock('@/entities/tare-type', () => ({
  useTareTypeOptionsQuery: () => tareTypesMock(),
}));

vi.mock('@/entities/collection-point', () => ({
  usePointOptionsQuery: () => pointsMock(),
}));

vi.mock('@/entities/user', () => ({
  useMeQuery: () => meMock(),
}));

vi.mock('@/features/settle-payout', () => ({
  PayoutDialog: (props: Record<string, unknown>) => {
    payoutDialogMock(props);
    return props.open ? <div data-testid="payout-dialog-mock" /> : null;
  },
}));

vi.mock('@/features/void-document', () => ({
  VoidDocumentDialog: (props: Record<string, unknown>) => {
    voidDialogMock(props);
    return props.open ? <div data-testid="void-dialog-mock" /> : null;
  },
}));

const SUPPLIER = {
  id: 'supplier-1',
  collection_point_id: 'point-1',
  first_name: 'Галина',
  last_name: 'Кушнірук',
  phone: null,
  note: null,
  kind: 'none' as const,
  is_active: true,
  created_at: '2026-01-01T00:00:00.000Z',
};

const OPERATOR_AUTHOR = {
  id: 'user-1',
  username: 'oksana',
  display_name: 'Оксана Приймальник',
  avatar_url: null,
  language_code: null,
  role: 'point_operator' as const,
  collection_point_id: 'point-1',
};

const OPERATOR_OTHER = {
  ...OPERATOR_AUTHOR,
  id: 'user-2',
  username: 'taras',
  display_name: 'Тарас Інший',
};

const OWNER = {
  id: 'user-9',
  username: 'owner',
  display_name: 'Мережевий Власник',
  avatar_url: null,
  language_code: null,
  role: 'network_owner' as const,
  collection_point_id: null,
};

function buildIntake(overrides: Partial<IntakeDetail> = {}): IntakeDetail {
  return {
    id: 'intake-1',
    code: 'SHP-IN-20260908-00412',
    shift_id: 'shift-1',
    collection_point_id: 'point-1',
    business_date: '2026-09-08',
    supplier_id: 'supplier-1',
    amount: '14560.00',
    received_by_user_id: 'user-1',
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    created_at: '2026-09-08T08:20:00.000Z',
    items: [
      {
        id: 'item-1',
        item_order: 1,
        product_grade_id: 'grade-1',
        gross_kg: '126.40',
        pallet_kg: '0.00',
        tare_weight_kg: '14.40',
        net_kg: '112.00',
        price: '135.00',
        bonus: '-5.00',
        amount: '14560.00',
        tare: [{ tare_type_id: 'tare-1', units: 12 }],
      },
    ],
    ...overrides,
  };
}

function setUp({
  intake = buildIntake(),
  debt = '9000.00',
  me = OPERATOR_OTHER,
}: {
  intake?: IntakeDetail | null;
  debt?: string;
  me?: typeof OPERATOR_AUTHOR | typeof OPERATOR_OTHER | typeof OWNER;
} = {}) {
  intakeMock.mockReturnValue({ data: intake ?? undefined, isPending: intake === null });
  supplierMock.mockReturnValue({ data: SUPPLIER, isPending: false });
  balanceMock.mockReturnValue({ data: { supplier_id: 'supplier-1', debt }, isPending: false });
  gradesMock.mockReturnValue({
    data: [{ id: 'grade-1', name: '1 сорт', productId: 'product-1', productName: 'Малина' }],
    isPending: false,
    isError: false,
  });
  tareTypesMock.mockReturnValue({
    data: [{ id: 'tare-1', name: 'Чешка', weight_kg: '1.20', is_crate: true }],
    isPending: false,
  });
  pointsMock.mockReturnValue({ data: [{ id: 'point-1', name: 'Шипинки' }], isPending: false });
  meMock.mockReturnValue({ data: me, isPending: false });
}

beforeEach(() => {
  payoutDialogMock.mockReset();
  voidDialogMock.mockReset();
});

describe('ReceiptDialog', () => {
  it('renders the composed receipt and is axe-clean', async () => {
    setUp();
    const { container } = render(
      <ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />,
    );

    expect(screen.getByText('SHP-IN-20260908-00412')).toBeInTheDocument();
    expect(screen.getByText('Галина Кушнірук')).toBeInTheDocument();
    expect(screen.getByText('Малина · 1 сорт')).toBeInTheDocument();
    expect(screen.getByText('112.00 kg')).toBeInTheDocument();
    expect(screen.getByText(/135\.00/)).toBeInTheDocument();
    expect(screen.getAllByText('14,560.00 ₴').length).toBeGreaterThan(0);
    // received by a different operator than the one logged in — dash
    expect(screen.getByText('—')).toBeInTheDocument();

    await expectNoAxeViolations(container);
  });

  it('shows the receiving operator\'s own name when they are the one logged in', () => {
    setUp({ me: OPERATOR_AUTHOR });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText('Оксана Приймальник')).toBeInTheDocument();
  });

  it('renders nothing while intakeId is null', () => {
    setUp();
    const { container } = render(<ReceiptDialog intakeId={null} open onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a loading state while the intake is still being fetched', () => {
    setUp({ intake: null });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Pay out in cash')).not.toBeInTheDocument();
  });

  it('opens the payout dialog prefilled with min(amount, debt) when the debt is the smaller figure', async () => {
    setUp({ debt: '9000.00' });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Pay out in cash' }));

    expect(payoutDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: true,
        debt: '9000.00',
        defaultAmount: '9000.00',
        supplier: { id: 'supplier-1', first_name: 'Галина', last_name: 'Кушнірук' },
        pointId: 'point-1',
      }),
    );
  });

  it('prefills the payout with the full amount when it is smaller than the debt', async () => {
    setUp({ debt: '99999.00' });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Pay out in cash' }));

    expect(payoutDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultAmount: '14560.00' }),
    );
  });

  it('hides Pay out when the balance is not positive', () => {
    setUp({ debt: '0.00' });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Pay out in cash' })).not.toBeInTheDocument();
  });

  it('hides Void for a non-author operator', () => {
    setUp({ me: OPERATOR_OTHER });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
  });

  it('shows Void for the author operator', () => {
    setUp({ me: OPERATOR_AUTHOR });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Void' })).toBeInTheDocument();
  });

  it('shows Void for the owner, and opens the void dialog with the intake kind/id/code', async () => {
    setUp({ me: OWNER });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Void' }));

    expect(voidDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: true,
        kind: 'intake',
        id: 'intake-1',
        code: 'SHP-IN-20260908-00412',
      }),
    );
  });

  it('shows the voided stamp and reason, and hides Pay out and Void', () => {
    setUp({
      intake: buildIntake({
        voided_at: '2026-09-08T10:00:00.000Z',
        voided_by_user_id: 'user-9',
        void_reason: 'Помилка ваги',
      }),
      me: OWNER,
    });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText('VOIDED')).toBeInTheDocument();
    expect(screen.getByText(/Помилка ваги/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pay out in cash' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
  });

  it('prints via window.print', async () => {
    setUp();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Print' }));

    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('closes via the Close button', async () => {
    setUp();
    const onClose = vi.fn();
    render(<ReceiptDialog intakeId="intake-1" open onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
