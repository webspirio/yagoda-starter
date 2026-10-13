import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import type { Payout } from '@/entities/payout';
import { PayoutReceiptDialog } from './PayoutReceiptDialog';

const { payoutMock, supplierMock, settlementMock, pointsMock, meMock, voidDialogMock, settingsMock, refetchSettings } =
  vi.hoisted(() => ({
    payoutMock: vi.fn(),
    supplierMock: vi.fn(),
    settlementMock: vi.fn(),
    pointsMock: vi.fn(),
    meMock: vi.fn(),
    voidDialogMock: vi.fn(),
    settingsMock: vi.fn(),
    refetchSettings: vi.fn(),
  }));

vi.mock('@/entities/payout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/entities/payout')>()),
  usePayoutQuery: (id: string | null) => payoutMock(id),
}));

vi.mock('@/entities/supplier', () => ({
  useSupplierQuery: (id: string | null) => supplierMock(id),
  useSupplierSettlementQuery: (id: string | null) => settlementMock(id),
  supplierName: (s: { first_name: string; last_name: string }) => `${s.first_name} ${s.last_name}`,
}));

vi.mock('@/entities/collection-point', () => ({
  usePointOptionsQuery: () => pointsMock(),
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
  reopenedCodes: () => ['SHP-IN-1'],
}));

const SUPPLIER = {
  id: 'supplier-1',
  collection_point_id: 'point-1',
  first_name: 'Галина',
  last_name: 'Кушнірук',
};
const OPERATOR_AUTHOR = { id: 'user-1', role: 'point_operator' as const };
const OPERATOR_OTHER = { id: 'user-2', role: 'point_operator' as const };
const OWNER = { id: 'user-9', role: 'network_owner' as const };
const AT = '2026-10-08T09:00:00.000Z';

function buildPayout(over: Partial<Payout> = {}): Payout {
  return {
    id: 'payout-1',
    code: 'SHP-PO-20260908-00031',
    shift_id: 'shift-1',
    collection_point_id: 'point-1',
    business_date: '2026-09-08',
    supplier_id: 'supplier-1',
    amount: '5000.00',
    paid_by_user_id: 'user-1',
    intake_id: null,
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    return_settled_at: null,
    return_settled_by_user_id: null,
    return_note: null,
    returned_on_void: false,
    shift_closed: false,
    created_at: '2026-09-08T08:20:00.000Z',
    balance_after: '9000.00',
    paid_by: { first_name: 'Оксана', last_name: 'Гнатюк' },
    ...over,
  };
}

function setUp({
  payout = buildPayout(),
  me = OPERATOR_AUTHOR,
  isFetching = false,
}: {
  payout?: Payout | null;
  me?: typeof OPERATOR_AUTHOR | typeof OPERATOR_OTHER | typeof OWNER;
  isFetching?: boolean;
} = {}) {
  payoutMock.mockReturnValue({ data: payout ?? undefined, isPending: payout === null, isError: false });
  supplierMock.mockReturnValue({ data: SUPPLIER, isPending: false, isError: false });
  pointsMock.mockReturnValue({ data: [{ id: 'point-1', name: 'Шипинки' }], isPending: false, isError: false });
  meMock.mockReturnValue({ data: me, isPending: false, isError: false });
  settlementMock.mockReturnValue({ data: { stub: true }, isPending: false, isError: false });
  settingsMock.mockReturnValue({
    data: { receipt_note: null, updated_at: AT },
    isPending: false,
    isFetching,
    isError: false,
    refetch: refetchSettings,
  });
}

beforeEach(() => {
  voidDialogMock.mockReset();
  settlementMock.mockReset();
  refetchSettings.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('PayoutReceiptDialog', () => {
  it('renders the payout document and is axe-clean', async () => {
    setUp();
    const { container } = render(<PayoutReceiptDialog payoutId="payout-1" open onClose={vi.fn()} />);

    expect(screen.getByText('SHP-PO-20260908-00031')).toBeInTheDocument();
    expect(screen.getByText('Галина Кушнірук')).toBeInTheDocument();
    expect(screen.getByText('Debt payout')).toBeInTheDocument();
    expect(screen.getByText('Paid out in cash')).toBeInTheDocument();
    expect(screen.getByText('Balance after payout')).toBeInTheDocument();
    expect(screen.getByText(/Гнатюк Оксана/)).toBeInTheDocument();

    await expectNoAxeViolations(container);
  });

  it('hides «Void» for a voided payout, even for the owner', () => {
    setUp({ payout: buildPayout({ voided_at: AT, void_reason: 'помилка' }), me: OWNER });
    render(<PayoutReceiptDialog payoutId="payout-1" open onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
  });

  it("hides «Void» from an operator on another's payout", () => {
    setUp({ me: OPERATOR_OTHER });
    render(<PayoutReceiptDialog payoutId="payout-1" open onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
  });

  it('opens the void dialog with the payout amount, shift state and reopened receipts', async () => {
    setUp({ payout: buildPayout({ shift_closed: true }), me: OWNER });
    render(<PayoutReceiptDialog payoutId="payout-1" open onClose={vi.fn()} />);

    // the settlement is not read until the void dialog is open
    expect(settlementMock).toHaveBeenLastCalledWith(null);

    await userEvent.click(screen.getByRole('button', { name: 'Void' }));

    expect(screen.getByTestId('void-dialog-mock')).toBeInTheDocument();
    expect(settlementMock).toHaveBeenLastCalledWith('supplier-1');
    expect(voidDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'payout',
        id: 'payout-1',
        code: 'SHP-PO-20260908-00031',
        open: true,
        shiftClosed: true,
        payoutAmount: '5000.00',
        reopens: ['SHP-IN-1'],
      }),
    );
  });

  it('passes reopens: null while the settlement is in flight', async () => {
    setUp({ me: OWNER });
    settlementMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<PayoutReceiptDialog payoutId="payout-1" open onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));

    expect(voidDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ reopens: null, reopensFailed: false }),
    );
  });

  it('passes reopensFailed when the settlement errors', async () => {
    setUp({ me: OWNER });
    settlementMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<PayoutReceiptDialog payoutId="payout-1" open onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));
    expect(voidDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ reopens: null, reopensFailed: true }),
    );
  });

  it('re-reads the note on opening and waits for it to print', () => {
    setUp({ isFetching: true });
    render(<PayoutReceiptDialog payoutId="payout-1" open onClose={vi.fn()} />);

    expect(refetchSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled();
  });

  it('warns and still renders and prints, without the note, when the note fails to load', () => {
    setUp();
    settingsMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isFetching: false,
      isError: true,
      refetch: refetchSettings,
    });
    render(<PayoutReceiptDialog payoutId="payout-1" open onClose={vi.fn()} />);

    expect(screen.getByText(/note didn't load/)).toBeInTheDocument();
    expect(screen.getByText('SHP-PO-20260908-00031')).toBeInTheDocument();
    expect(screen.getByText('Thank you for working with us!')).toBeInTheDocument();
    expect(screen.getByText('Not a fiscal receipt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled();
  });

  it('prints via window.print', async () => {
    setUp();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<PayoutReceiptDialog payoutId="payout-1" open onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Print' }));

    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('closes via the Close button', async () => {
    setUp();
    const onClose = vi.fn();
    render(<PayoutReceiptDialog payoutId="payout-1" open onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
