import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  created_at: '2026-09-10T09:00:00Z', shift_closed: false, ...over,
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

  it('opens the void dialog with the right kind and id', async () => {
    returnsMock.mockReturnValue(ok([]));
    render(<PersonCrateDocs supplierId="s1" isOwner={false} />);
    await userEvent.click(screen.getByRole('button', { name: /void/i }));
    expect(voidDialogMock).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'crateIssuance', id: 'i1', code: 'ЯЩ-0001', open: true,
    }));
  });
});
