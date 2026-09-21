import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  voidDialogMock,
} = vi.hoisted(() => ({
  intakeMock: vi.fn(),
  supplierMock: vi.fn(),
  balanceMock: vi.fn(),
  gradesMock: vi.fn(),
  tareTypesMock: vi.fn(),
  pointsMock: vi.fn(),
  meMock: vi.fn(),
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
    net_kg: '36.90',
    lines_count: 2,
    supplier_name: 'Ніна Ільчук',
    paid_amount: '0.00',
    payouts: [],
    received_by_name: 'Оксана Гнатюк',
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
  intakeIsError = false,
}: {
  intake?: IntakeDetail | null;
  debt?: string;
  me?: typeof OPERATOR_AUTHOR | typeof OPERATOR_OTHER | typeof OWNER;
  intakeIsError?: boolean;
} = {}) {
  intakeMock.mockReturnValue({
    data: intake ?? undefined,
    isPending: intake === null && !intakeIsError,
    isError: intakeIsError,
  });
  supplierMock.mockReturnValue({ data: SUPPLIER, isPending: false, isError: false });
  balanceMock.mockReturnValue({
    data: { supplier_id: 'supplier-1', debt },
    isPending: false,
    isError: false,
  });
  gradesMock.mockReturnValue({
    data: [{ id: 'grade-1', name: '1 сорт', productId: 'product-1', productName: 'Малина' }],
    isPending: false,
    isError: false,
  });
  tareTypesMock.mockReturnValue({
    data: [{ id: 'tare-1', name: 'Чешка', weight_kg: '1.20', is_crate: true }],
    isPending: false,
    isError: false,
  });
  pointsMock.mockReturnValue({
    data: [{ id: 'point-1', name: 'Шипинки' }],
    isPending: false,
    isError: false,
  });
  meMock.mockReturnValue({ data: me, isPending: false, isError: false });
}

beforeEach(() => {
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
    expect(screen.getAllByText('14,560.00 ₴').length).toBeGreaterThan(0);
    // received_by_name from the fixture, independent of who is logged in
    expect(screen.getByText('Оксана Гнатюк')).toBeInTheDocument();

    await expectNoAxeViolations(container);
  });

  it('shows price − bonus = total for a per-kilogram discount', () => {
    setUp();
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText('135.00 ₴ − 5.00 ₴ = 130.00 ₴')).toBeInTheDocument();
  });

  it('shows price + bonus = total for a per-kilogram markup', () => {
    setUp({
      intake: buildIntake({
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
            bonus: '5.00',
            amount: '15680.00',
            tare: [{ tare_type_id: 'tare-1', units: 12 }],
          },
        ],
      }),
    });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText('135.00 ₴ + 5.00 ₴ = 140.00 ₴')).toBeInTheDocument();
  });

  it("shows who received the document from received_by_name, regardless of who is logged in", () => {
    setUp({ me: OPERATOR_AUTHOR });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText('Оксана Гнатюк')).toBeInTheDocument();
    expect(screen.queryByText('Оксана Приймальник')).not.toBeInTheDocument();
  });

  it('falls back to a dash when received_by_name is null', () => {
    setUp({ intake: buildIntake({ received_by_name: null }) });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('prints what was paid out, with the amount and the live payout codes in muted text', () => {
    setUp({
      intake: buildIntake({
        paid_amount: '10000.00',
        payouts: [
          { id: 'payout-1', code: 'SHP-PO-20260908-00031', amount: '10000.00', voided_at: null },
        ],
      }),
    });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText('Paid out in cash')).toBeInTheDocument();
    expect(screen.getByText('10,000.00 ₴')).toBeInTheDocument();
    const codes = screen.getByText('SHP-PO-20260908-00031');
    expect(codes).toHaveClass('text-neutral-500');
  });

  it('hides the paid row when nothing has been paid out yet', () => {
    setUp();
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.queryByText('Paid out in cash')).not.toBeInTheDocument();
  });

  it('renders a voided linked payout as a muted annulment line', () => {
    setUp({
      intake: buildIntake({
        payouts: [
          {
            id: 'payout-1',
            code: 'SHP-PO-20260907-00020',
            amount: '5000.00',
            voided_at: '2026-09-07T12:00:00.000Z',
          },
        ],
      }),
    });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    const line = screen.getByText('payout SHP-PO-20260907-00020 voided');
    expect(line).toHaveClass('text-neutral-500');
  });

  describe('the date — formatDateTime, pinned to TZ=UTC for a fixed literal', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('shows the day.month and the time from created_at', () => {
      vi.stubEnv('TZ', 'UTC');
      setUp();
      render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

      expect(screen.getByText('09/08 · 08:20 AM')).toBeInTheDocument();
    });
  });

  it('counts the single line too — «· 1 line», not the bare code (M4)', () => {
    setUp();
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText('Receipt SHP-IN-20260908-00412 · 1 line')).toBeInTheDocument();
  });

  it('shows the plural title when the intake has more than one line', () => {
    const base = buildIntake();
    setUp({
      intake: buildIntake({
        items: [base.items[0], { ...base.items[0], id: 'item-2' }],
      }),
    });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText('Receipt SHP-IN-20260908-00412 · 2 lines')).toBeInTheDocument();
  });

  it('has no Pay out button — the payout now happens from the reception screen (#116)', () => {
    setUp();
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Pay out in cash' })).not.toBeInTheDocument();
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
  });

  it('keeps Close reachable while the intake query is pending', () => {
    setUp({ intake: null });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('shows an error message and a working Close button when the intake query fails', async () => {
    setUp({ intakeIsError: true });
    const onClose = vi.fn();
    render(<ReceiptDialog intakeId="intake-1" open onClose={onClose} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
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

  it('shows the voided stamp and reason, and hides Void', () => {
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
