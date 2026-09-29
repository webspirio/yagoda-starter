import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import { PersonCrateDocs } from './PersonCrateDocs';
import type { CrateIssuance, CrateReturn } from '@/entities/crate';

const { issuancesMock, returnsMock, voidDialogMock } = vi.hoisted(() => ({
  issuancesMock: vi.fn(), returnsMock: vi.fn(), voidDialogMock: vi.fn(),
}));
vi.mock('@/entities/crate', () => ({
  useCrateIssuancesQuery: (f: unknown) => issuancesMock(f),
  useCrateReturnsQuery: (f: unknown) => returnsMock(f),
}));
vi.mock('@/features/void-document', () => ({
  VoidDocumentDialog: (props: Record<string, unknown>) => {
    voidDialogMock(props);
    return props.open ? <div data-testid="void-dialog" /> : null;
  },
}));

const issuance = (over: Partial<CrateIssuance> = {}): CrateIssuance => ({
  id: 'i1', code: 'ЯЩ-0001', shift_id: 'sh1', collection_point_id: 'p1', business_date: '2026-09-10',
  supplier_id: 's1', units: 20, mode: 'deposit', deposit_per_unit: '120.00', deposit_taken: '2400.00',
  issued_by_user_id: 'u1', voided_at: null, voided_by_user_id: null, void_reason: null,
  created_at: '2026-09-10T08:00:00Z', shift_closed: false, has_live_returns: false, ...over,
});
const ret = (over: Partial<CrateReturn> = {}): CrateReturn => ({
  id: 'r1', shift_id: 'sh1', collection_point_id: 'p1', business_date: '2026-09-10', supplier_id: 's1',
  units: 5, deposit_refund: '600.00', allocations: [], accepted_by_user_id: 'u1',
  voided_at: null, voided_by_user_id: null, void_reason: null,
  created_at: '2026-09-10T09:00:00Z', shift_closed: false, intake_id: null, intake_code: null, ...over,
});
const ok = <T,>(data: T[]) => ({ data: { data, total: data.length, page: 1, limit: 100 }, isPending: false, isError: false });

beforeEach(() => {
  vi.clearAllMocks();
  issuancesMock.mockReturnValue(ok([issuance()]));
  returnsMock.mockReturnValue(ok([ret()]));
});

describe('PersonCrateDocs', () => {
  it('asks for live AND voided documents of this person', () => {
    render(<PersonCrateDocs supplierId="s1" isOwner={false} />);
    expect(issuancesMock).toHaveBeenCalledWith({ supplierId: 's1', includeVoided: true, limit: 100 });
    expect(returnsMock).toHaveBeenCalledWith({ supplierId: 's1', includeVoided: true, limit: 100 });
  });

  it('lists newest first', () => {
    render(<PersonCrateDocs supplierId="s1" isOwner={false} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/accepted 5 crates/);
    expect(items[1]).toHaveTextContent(/issued 20 crates/);
  });

  it.each([
    // role, shift_closed, has_live_returns, voided, expect button
    ['operator', false, false, false, true],
    ['operator', true, false, false, false],
    ['owner', true, false, false, true],
    ['owner', false, true, false, false],
    ['owner', false, false, true, false],
  ] as const)('%s · closed=%s · underReturn=%s · voided=%s → button %s',
    (role, closed, under, voided, shown) => {
      returnsMock.mockReturnValue(ok([]));
      issuancesMock.mockReturnValue(ok([issuance({
        shift_closed: closed, has_live_returns: under,
        ...(voided ? { voided_at: '2026-09-10T10:00:00Z', void_reason: 'дубль', voided_by_user_id: 'u1' } : {}),
      })]));
      render(<PersonCrateDocs supplierId="s1" isOwner={role === 'owner'} />);
      expect(screen.queryByRole('button', { name: /void/i }) !== null).toBe(shown);
    });

  it('says why an issuance under a live return cannot be voided', () => {
    returnsMock.mockReturnValue(ok([]));
    issuancesMock.mockReturnValue(ok([issuance({ has_live_returns: true })]));
    render(<PersonCrateDocs supplierId="s1" isOwner />);
    expect(screen.getByText(/void the return first/i)).toBeInTheDocument();
  });

  it('strikes a voided line through and shows the reason', () => {
    returnsMock.mockReturnValue(ok([]));
    issuancesMock.mockReturnValue(ok([issuance({ voided_at: '2026-09-11T10:00:00Z', void_reason: 'дубль', voided_by_user_id: 'u1' })]));
    render(<PersonCrateDocs supplierId="s1" isOwner />);
    expect(screen.getByText(/issued 20 crates/)).toHaveClass('line-through');
    expect(screen.getByText(/дубль/)).toBeInTheDocument();
  });

  it('points a receipt-linked return at its receipt instead of offering a void, even for the owner', () => {
    issuancesMock.mockReturnValue(ok([]));
    returnsMock.mockReturnValue(ok([ret({ intake_id: 'in1', intake_code: 'ПР-0007' })]));
    render(<PersonCrateDocs supplierId="s1" isOwner />);
    expect(screen.getByText(/recorded with receipt ПР-0007 — void the receipt/i)).toBeInTheDocument();
    expect(screen.getByText(/with berries · no deposit/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /void/i })).not.toBeInTheDocument();
  });

  it('still offers the void button on an unlinked return', () => {
    issuancesMock.mockReturnValue(ok([]));
    returnsMock.mockReturnValue(ok([ret()]));
    render(<PersonCrateDocs supplierId="s1" isOwner={false} />);
    expect(screen.getByRole('button', { name: /void/i })).toBeInTheDocument();
    expect(screen.queryByText(/void the receipt/i)).not.toBeInTheDocument();
  });

  it('opens the void dialog with the right kind and id', async () => {
    returnsMock.mockReturnValue(ok([]));
    render(<PersonCrateDocs supplierId="s1" isOwner={false} />);
    await userEvent.click(screen.getByRole('button', { name: /void/i }));
    expect(voidDialogMock).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'crateIssuance', id: 'i1', code: 'ЯЩ-0001', open: true,
    }));
  });

  it('formats a void date in local time, not UTC', () => {
    // 2026-09-10T22:30 UTC is 2026-09-11 in a positive UTC offset — slicing
    // to the first 10 chars of the ISO string would print the wrong day.
    returnsMock.mockReturnValue(ok([]));
    issuancesMock.mockReturnValue(ok([issuance({
      voided_at: '2026-09-10T22:30:00Z', void_reason: 'дубль', voided_by_user_id: 'u1',
    })]));
    render(<PersonCrateDocs supplierId="s1" isOwner />);
    const expected = new Date('2026-09-10T22:30:00Z').toLocaleDateString('en', { day: '2-digit', month: '2-digit' });
    expect(screen.getByText(new RegExp(`voided ${expected.replace('.', '\\.')}`))).toBeInTheDocument();
  });

  it('shows one line noting the list is truncated when either kind is', () => {
    issuancesMock.mockReturnValue({ data: { data: [issuance()], total: 200, page: 1, limit: 100 }, isPending: false, isError: false });
    render(<PersonCrateDocs supplierId="s1" isOwner={false} />);
    expect(screen.getByText(/latest 100 of each kind/i)).toBeInTheDocument();
  });

  it('shows no truncation line when neither list is truncated', () => {
    render(<PersonCrateDocs supplierId="s1" isOwner={false} />);
    expect(screen.queryByText(/latest 100 of each kind/i)).not.toBeInTheDocument();
  });

  it('is accessible', async () => {
    const { container } = render(<PersonCrateDocs supplierId="s1" isOwner={false} />);
    await expectNoAxeViolations(container);
  });
});
