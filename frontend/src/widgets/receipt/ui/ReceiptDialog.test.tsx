import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import type { IntakeDetail } from '@/entities/intake';
import { ReceiptDialog } from './ReceiptDialog';

const {
  intakeMock,
  supplierMock,
  balanceMock,
  settlementMock,
  gradesMock,
  tareTypesMock,
  meMock,
  voidDialogMock,
  settingsMock,
} = vi.hoisted(() => ({
  intakeMock: vi.fn(),
  supplierMock: vi.fn(),
  balanceMock: vi.fn(),
  settlementMock: vi.fn(),
  gradesMock: vi.fn(),
  tareTypesMock: vi.fn(),
  meMock: vi.fn(),
  voidDialogMock: vi.fn(),
  settingsMock: vi.fn(),
}));

vi.mock('@/entities/intake', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/entities/intake')>()),
  useIntakeQuery: (id: string | null) => intakeMock(id),
}));

vi.mock('@/entities/supplier', () => ({
  useSupplierQuery: (id: string | null) => supplierMock(id),
  useSupplierBalanceQuery: (id: string | null) => balanceMock(id),
  useSupplierSettlementQuery: (id: string | null) => settlementMock(id),
  supplierName: (s: { first_name: string; last_name: string }) => `${s.first_name} ${s.last_name}`,
}));

// INERT ON PURPOSE. `ReceiptDialog` stopped importing this module in #148, so
// this factory never loads — which is precisely the regression pin: re-wire the
// dialog to the active-only catalog and the two tests below go live again and
// fail, one on a deactivated grade, one on a failing `/product-grades` read.
vi.mock('@/entities/product-grade', () => ({
  useGradeCatalogQuery: () => gradesMock(),
}));

vi.mock('@/entities/tare-type', () => ({
  useTareTypeOptionsQuery: () => tareTypesMock(),
}));

// INERT ON PURPOSE (#145 review): the dialog reads «Точка № N» from the document
// (`point_number`), never from the point list. The list answers an ERROR here, so
// re-wiring the dialog to it turns every receipt test below into «Something went wrong».
vi.mock('@/entities/collection-point', () => ({
  usePointOptionsQuery: () => ({ data: undefined, isPending: false, isError: true }),
}));

vi.mock('@/entities/user', () => ({
  useMeQuery: () => meMock(),
}));

vi.mock('@/entities/network-settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/entities/network-settings')>()),
  useNetworkSettingsQuery: () => settingsMock(),
}));

vi.mock('@/features/void-document', () => ({
  VoidDocumentDialog: (props: Record<string, unknown>) => {
    voidDialogMock(props);
    return props.open ? <div data-testid="void-dialog-mock" /> : null;
  },
  reopenedCodes: () => [],
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

const GRADE_1 = { id: 'grade-1', name: '1 сорт', productId: 'product-1', productName: 'Малина' };

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
    shift_closed: false,
    created_at: '2026-09-08T08:20:00.000Z',
    net_kg: '36.90',
    lines_count: 2,
    supplier_name: 'Ніна Ільчук',
    paid_amount: '0.00',
    open_amount: '0.00',
    payouts: [],
    received_by_name: 'Оксана Гнатюк',
    received_by_number: 2,
    point_number: 1,
    crate_return: null,
    items: [
      {
        id: 'item-1',
        item_order: 1,
        product_grade_id: 'grade-1',
        product_name: 'Малина',
        grade_name: '1 сорт',
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

const AT = '2026-10-08T09:00:00.000Z';
const refetchSettings = vi.fn();
function settingsState(over: {
  data?: { receipt_note: string | null; updated_at: string };
  isPending?: boolean;
  isFetching?: boolean;
  isError?: boolean;
}) {
  return {
    data: undefined,
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: refetchSettings,
    ...over,
  };
}

function setUp({
  intake = buildIntake(),
  debt = '9000.00',
  me = OPERATOR_OTHER,
  intakeIsError = false,
  grades = [GRADE_1],
  gradesIsError = false,
  note = null,
}: {
  intake?: IntakeDetail | null;
  debt?: string;
  me?: typeof OPERATOR_AUTHOR | typeof OPERATOR_OTHER | typeof OWNER;
  intakeIsError?: boolean;
  grades?: Array<typeof GRADE_1>;
  gradesIsError?: boolean;
  note?: string | null;
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
    data: grades,
    isPending: false,
    isError: gradesIsError,
  });
  tareTypesMock.mockReturnValue({
    data: [{ id: 'tare-1', name: 'Чешка', weight_kg: '1.20', is_crate: true }],
    isPending: false,
    isError: false,
  });
  meMock.mockReturnValue({ data: me, isPending: false, isError: false });
  settlementMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
  settingsMock.mockReturnValue(settingsState({ data: { receipt_note: note, updated_at: AT } }));
}

beforeEach(() => {
  voidDialogMock.mockReset();
  settlementMock.mockReset();
});

describe('ReceiptDialog', () => {
  it('renders the composed receipt and is axe-clean', async () => {
    setUp();
    const { container } = render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText('SHP-IN-20260908-00412')).toBeInTheDocument();
    expect(screen.getByText('Галина Кушнірук')).toBeInTheDocument();
    expect(screen.getByText('Малина')).toBeInTheDocument();
    expect(screen.getByText('112.00 kg')).toBeInTheDocument();
    expect(screen.getAllByText('14,560.00 ₴').length).toBeGreaterThan(0);
    // the point and the receiver from the fixture, by number, independent of who is logged in
    expect(screen.getByText('Point No. 1').parentElement).toHaveTextContent(
      'Point No. 1 · Operator No. 2',
    );

    await expectNoAxeViolations(container);
  });

  /**
   * #148. Deactivating a grade is the routine end-of-season action — the only
   * removal verb the schema has — and the catalog read is active-only. If the
   * line's names came from that catalog, the paper in the supplier's hand and
   * the card on the operator's screen would describe one delivery two ways.
   * The receipt names its own lines.
   */
  it('names the line from the receipt itself when the grade is no longer in the catalog', () => {
    setUp({ grades: [] });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText('Малина')).toBeInTheDocument();
  });

  it('prints the receipt even when the grade catalog read fails — it no longer depends on it', () => {
    setUp({ gradesIsError: true });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Малина')).toBeInTheDocument();
  });

  // #162: the supplier's paper names the berry, never the grade — the grade
  // shows only through the price it set.
  it('names the line by its product alone, without the grade', () => {
    setUp();
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.queryByText(/1 сорт/)).not.toBeInTheDocument();
  });

  it('prints a dash, not the grade, when the line has lost its product name', () => {
    const base = buildIntake();
    setUp({ intake: buildIntake({ items: [{ ...base.items![0], product_name: '' }] }) });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/1 сорт/)).not.toBeInTheDocument();
  });

  // #164: the supplier sees the price they were paid, not how it was built.
  it('shows only the final price for a per-kilogram discount', () => {
    setUp();
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText('130.00 ₴')).toBeInTheDocument();
    expect(screen.queryByText(/135\.00/)).not.toBeInTheDocument();
  });

  it('shows only the final price for a per-kilogram markup', () => {
    setUp({
      intake: buildIntake({
        items: [
          {
            id: 'item-1',
            item_order: 1,
            product_grade_id: 'grade-1',
            product_name: 'Малина',
            grade_name: '1 сорт',
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

    expect(screen.getByText('140.00 ₴')).toBeInTheDocument();
    expect(screen.queryByText(/135\.00/)).not.toBeInTheDocument();
  });

  it('shows who received the document in the header, regardless of who is logged in', () => {
    setUp({ me: OPERATOR_AUTHOR });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText('Point No. 1').parentElement).toHaveTextContent(
      'Point No. 1 · Operator No. 2',
    );
    expect(screen.queryByText(/Гнатюк/)).not.toBeInTheDocument();
  });

  it('falls back to a dash in the header when the receiver is unknown', () => {
    setUp({ intake: buildIntake({ received_by_name: null, received_by_number: null }) });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText('Point No. 1').parentElement).toHaveTextContent('Point No. 1 · —');
  });

  it('prints what was paid out, with the amount and the live payout codes in muted text', () => {
    setUp({
      intake: buildIntake({
        paid_amount: '10000.00',
        payouts: [
          {
            id: 'payout-1',
            code: 'SHP-PO-20260908-00031',
            amount: '10000.00',
            created_at: '2026-09-08T08:25:00.000Z',
            voided_at: null,
          },
        ],
      }),
    });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText('Paid out in cash')).toBeInTheDocument();
    expect(screen.getByText('10,000.00 ₴')).toBeInTheDocument();
    const codes = screen.getByText('SHP-PO-20260908-00031');
    expect(codes).toHaveClass('text-[0.87em]');
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
            created_at: '2026-09-07T08:25:00.000Z',
            voided_at: '2026-09-07T12:00:00.000Z',
          },
        ],
      }),
    });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    const line = screen.getByText('payout SHP-PO-20260907-00020 voided');
    expect(line).toHaveClass('text-[0.87em]');
  });

  it('prints the crates returned with the receipt, amount form, even when the return is mixed deposit/receipt', () => {
    setUp({
      intake: buildIntake({
        crate_return: {
          id: 'return-1',
          units: 8,
          deposit_refund: '250.00',
          deposit_units: 5,
          receipt_units: 3,
          voided_at: null,
        },
      }),
    });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(
      screen.getByText('Returned our crates: 8 · deposit refunded 250.00 ₴'),
    ).toBeInTheDocument();
  });

  it('prints the no-money form when deposit_refund is zero (an all-receipt return)', () => {
    setUp({
      intake: buildIntake({
        crate_return: {
          id: 'return-2',
          units: 4,
          deposit_refund: '0.00',
          deposit_units: 0,
          receipt_units: 4,
          voided_at: null,
        },
      }),
    });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText('Returned our crates: 4 · on a receipt, no money')).toBeInTheDocument();
  });

  it('prints a muted annulment line when the crate return was voided, and hides the numbers', () => {
    setUp({
      intake: buildIntake({
        crate_return: {
          id: 'return-3',
          units: 5,
          deposit_refund: '500.00',
          deposit_units: 5,
          receipt_units: 0,
          voided_at: '2026-09-08T10:00:00.000Z',
        },
      }),
    });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    const line = screen.getByText('crate return voided');
    expect(line).toHaveClass('italic');
    expect(screen.queryByText(/Returned our crates/)).not.toBeInTheDocument();
  });

  it('labels the code with the bare «№», so it shares the code’s line on 58 mm (#254)', () => {
    setUp();
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText('No.').parentElement).toHaveTextContent('No.SHP-IN-20260908-00412');
    expect(screen.queryByText('Receipt No.')).not.toBeInTheDocument();
  });

  it('prints no date row — the code already carries the day (#254)', () => {
    setUp();
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.queryByText('Date')).not.toBeInTheDocument();
    expect(screen.queryByText(/September 8, 2026/)).not.toBeInTheDocument();
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

  // Decided at the meeting (PR #234 review): no ruled lines and no blank ones
  // for handwriting — the paper ends at the thanks and the fiscal disclaimer.
  it('ends the paper at the thanks and the fiscal disclaimer when the network has no note', () => {
    setUp();
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    const tail = document.querySelector('.printable')?.lastElementChild;
    expect(Array.from(tail?.children ?? [], (line) => line.textContent)).toEqual([
      'Thank you for working with us!',
      'Not a fiscal receipt',
    ]);
  });

  // index.css's print rule hides every OTHER child of <body> while a receipt is
  // open (#212). It only matches while the dialog is a direct child of <body>,
  // and the test DOM evaluates no print CSS — so pin that DOM shape here, where a
  // portal wrapper from a Radix upgrade would otherwise bring #212 back unseen.
  it('portals the receipt dialog straight into <body>, as the print rule expects', () => {
    setUp();
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    const dialog = document.querySelector('.printable')?.closest("[data-slot='dialog-content']");
    expect(dialog?.parentElement).toBe(document.body);
  });

  it("prints the network's note as plain lines, with no rules and no blank ones", () => {
    setUp({ note: 'Ящики повертати до 20:00\nТел. 067 000 00 00' });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    const tail = document.querySelector('.printable')?.lastElementChild;
    expect(tail).toHaveClass('break-inside-avoid');
    expect(Array.from(tail?.children ?? [], (line) => line.textContent)).toEqual([
      'Ящики повертати до 20:00',
      'Тел. 067 000 00 00',
      'Thank you for working with us!',
      'Not a fiscal receipt',
    ]);
    for (const line of Array.from(tail?.children ?? [])) {
      expect(line).not.toHaveClass('border-b');
    }
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('re-reads the note each time the receipt opens, and waits for it to print', () => {
    setUp();
    const { rerender } = render(
      <ReceiptDialog intakeId="intake-1" open={false} onClose={vi.fn()} />,
    );
    refetchSettings.mockClear();

    settingsMock.mockReturnValue(
      settingsState({ data: { receipt_note: 'стара', updated_at: AT }, isFetching: true }),
    );
    rerender(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(refetchSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled();
  });

  it('prints the last-known note without the warning when a re-read fails', () => {
    setUp();
    settingsMock.mockReturnValue(
      settingsState({ data: { receipt_note: 'Тел. 067', updated_at: AT }, isError: true }),
    );
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.queryByText(/note didn't load/)).toBeNull();
    const tail = document.querySelector('.printable')?.lastElementChild;
    expect(tail?.children[0]?.textContent).toBe('Тел. 067');
  });

  it('waits to print until the note has loaded', () => {
    setUp();
    settingsMock.mockReturnValue(settingsState({ isPending: true, isFetching: true }));
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled();
  });

  it('warns and still prints, without the note, when the note fails to load', () => {
    setUp();
    settingsMock.mockReturnValue(settingsState({ isError: true }));
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText(/note didn't load/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled();
    expect(document.querySelector('.printable .print-only')).toBeNull();
  });

  it('keeps the «saved in the system» footer off the paper', () => {
    setUp();
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText(/The receipt is saved in the system/)).toHaveClass('print:hidden');
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

describe('ReceiptDialog wiring into VoidDocumentDialog (#125)', () => {
  it('builds linkedPayout from the payout with voided_at === null', () => {
    setUp({
      me: OWNER,
      intake: buildIntake({
        payouts: [
          {
            id: 'payout-1',
            code: 'SHP-PO-1',
            amount: '5000.00',
            created_at: '2026-09-08T08:25:00.000Z',
            voided_at: '2026-09-07T12:00:00.000Z',
          },
          {
            id: 'payout-2',
            code: 'SHP-PO-2',
            amount: '3000.00',
            created_at: '2026-09-08T08:25:00.000Z',
            voided_at: null,
          },
        ],
      }),
    });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(voidDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        linkedPayout: expect.objectContaining({ code: 'SHP-PO-2', amount: '3000.00' }),
      }),
    );
  });

  it('leaves linkedPayout undefined when every payout is voided', () => {
    setUp({
      me: OWNER,
      intake: buildIntake({
        payouts: [
          {
            id: 'payout-1',
            code: 'SHP-PO-1',
            amount: '5000.00',
            created_at: '2026-09-08T08:25:00.000Z',
            voided_at: '2026-09-07T12:00:00.000Z',
          },
        ],
      }),
    });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(voidDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ linkedPayout: undefined }),
    );
  });

  it('hides Void from the author operator once the shift is closed', () => {
    setUp({ me: OPERATOR_AUTHOR, intake: buildIntake({ shift_closed: true }) });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
  });

  it('hides Void even from the owner once the shift is closed', () => {
    setUp({ me: OWNER, intake: buildIntake({ shift_closed: true }) });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
  });

  it('passes reopens: null and reopensFailed when the settlement query errors', () => {
    setUp({
      me: OWNER,
      intake: buildIntake({
        payouts: [
          {
            id: 'payout-1',
            code: 'SHP-PO-1',
            amount: '3000.00',
            created_at: '2026-09-08T08:25:00.000Z',
            voided_at: null,
          },
        ],
      }),
    });
    settlementMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(voidDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        linkedPayout: expect.objectContaining({ reopens: null, reopensFailed: true }),
      }),
    );
  });

  it('still renders the receipt (not the generic error) when the settlement query errors', () => {
    setUp({
      me: OWNER,
      intake: buildIntake({
        payouts: [
          {
            id: 'payout-1',
            code: 'SHP-PO-1',
            amount: '3000.00',
            created_at: '2026-09-08T08:25:00.000Z',
            voided_at: null,
          },
        ],
      }),
    });
    settlementMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText('SHP-IN-20260908-00412')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });
});

describe('ReceiptDialog startWithVoid — the row action opens straight into the void', () => {
  it('opens the void dialog at once when the viewer may void', () => {
    setUp({ me: OWNER });
    render(<ReceiptDialog intakeId="intake-1" open startWithVoid onClose={vi.fn()} />);

    expect(screen.getByTestId('void-dialog-mock')).toBeInTheDocument();
  });

  it('opens the void dialog for the author on an open shift', () => {
    setUp({ me: OPERATOR_AUTHOR });
    render(<ReceiptDialog intakeId="intake-1" open startWithVoid onClose={vi.fn()} />);

    expect(screen.getByTestId('void-dialog-mock')).toBeInTheDocument();
  });

  it('does not open it when the viewer may not void', () => {
    setUp({ me: OPERATOR_OTHER });
    render(<ReceiptDialog intakeId="intake-1" open startWithVoid onClose={vi.fn()} />);

    expect(screen.queryByTestId('void-dialog-mock')).not.toBeInTheDocument();
  });

  it('does not open it without startWithVoid', () => {
    setUp({ me: OWNER });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.queryByTestId('void-dialog-mock')).not.toBeInTheDocument();
  });

  it('closing the void dialog leaves the receipt open, and it does not reopen', () => {
    setUp({ me: OWNER });
    const onClose = vi.fn();
    const { rerender } = render(
      <ReceiptDialog intakeId="intake-1" open startWithVoid onClose={onClose} />,
    );

    const { onClose: closeVoid } = voidDialogMock.mock.lastCall![0] as { onClose: () => void };
    act(() => closeVoid());
    rerender(<ReceiptDialog intakeId="intake-1" open startWithVoid onClose={onClose} />);

    expect(screen.queryByTestId('void-dialog-mock')).not.toBeInTheDocument();
    expect(screen.getByText('SHP-IN-20260908-00412')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('opens it again on the next opening of the same receipt', () => {
    setUp({ me: OWNER });
    const { rerender } = render(
      <ReceiptDialog intakeId="intake-1" open startWithVoid onClose={vi.fn()} />,
    );
    const { onClose: closeVoid } = voidDialogMock.mock.lastCall![0] as { onClose: () => void };
    act(() => closeVoid());

    rerender(<ReceiptDialog intakeId="intake-1" open={false} startWithVoid onClose={vi.fn()} />);
    rerender(<ReceiptDialog intakeId="intake-1" open startWithVoid onClose={vi.fn()} />);

    expect(screen.getByTestId('void-dialog-mock')).toBeInTheDocument();
  });
});
