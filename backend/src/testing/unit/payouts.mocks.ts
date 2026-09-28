import { UserRole } from '../../users/user-role.enum';
import { ShiftStatus } from '../../shifts/shift-status.enum';
import { PayoutWriter } from '../../payouts/services/payout-writer';
import { CreatePayoutCommand } from '../../payouts/commands/create-payout.command';
import { VoidPayoutCommand } from '../../payouts/commands/void-payout.command';
import { SettleReturnCommand } from '../../payouts/commands/settle-return.command';
import { LoadVisiblePayoutQuery } from '../../payouts/queries/load-visible-payout.query';

export const POINT_A = '11111111-1111-1111-1111-111111111111';
export const POINT_B = '22222222-2222-2222-2222-222222222222';
export const SHIFT_ID = '33333333-3333-3333-3333-333333333333';
export const SUPPLIER = '44444444-4444-4444-4444-444444444444';
export const PAYOUT_ID = '77777777-7777-7777-7777-777777777777';

export const owner = {
  sub: 'u-owner',
  username: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
};
export const oksana = {
  sub: 'u-oksana',
  username: 'oksana',
  role: UserRole.PointOperator,
  collection_point_id: POINT_A,
};
export const maria = {
  sub: 'u-maria',
  username: 'maria',
  role: UserRole.PointOperator,
  collection_point_id: POINT_A,
};
export const elsewhere = {
  sub: 'u-b',
  username: 'b',
  role: UserRole.PointOperator,
  collection_point_id: POINT_B,
};

export const shift = (over: Record<string, unknown> = {}) => ({
  id: SHIFT_ID,
  collection_point_id: POINT_A,
  business_date: '2026-09-08',
  closed_at: null,
  status: ShiftStatus.Open,
  ...over,
});

export const payout = (over: Record<string, unknown> = {}) => ({
  id: PAYOUT_ID,
  code: 'KPG-PO-20260908-003',
  shift_id: SHIFT_ID,
  supplier_id: SUPPLIER,
  amount: '1000.00',
  paid_by_user_id: 'u-oksana',
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  return_settled_at: null,
  return_settled_by_user_id: null,
  return_note: null,
  returned_on_void: false,
  created_at: new Date('2026-09-08T07:00:00.000Z'),
  updated_at: new Date('2026-09-08T07:00:00.000Z'),
  ...over,
});

export const dto = (over: Record<string, unknown> = {}) => ({
  supplier_id: SUPPLIER,
  amount: '380.00',
  ...over,
});

export function makePayoutsMocks() {
  const manager = {
    // `nextDocumentCode`'s advisory lock and count (two payouts
    // already in this shift, so the next is 003).
    query: jest
      .fn()
      .mockImplementation((sql: string) =>
        Promise.resolve(sql.includes('count(*)') ? [{ n: 2 }] : []),
      ),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation((_e, v) => Promise.resolve(payout(v))),
    create: jest.fn().mockImplementation((_e, v) => v),
  };
  const allocations = {
    lockSupplier: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    allocate: jest.fn().mockResolvedValue(0),
    withinSupplierLedger: jest.fn(),
  };
  // Mirrors AllocationsService.withinSupplierLedger (lock → work → allocate); the real
  // order is pinned in supplier-balance/services/allocations.spec.ts.
  allocations.withinSupplierLedger.mockImplementation(
    async (m: unknown, id: string, work: () => Promise<unknown>) => {
      await allocations.lockSupplier(m, id);
      const result = await work();
      await allocations.allocate(m, id);
      return result;
    },
  );
  return {
    manager,
    dataSource: {
      transaction: jest.fn().mockImplementation((cb: (m: unknown) => unknown) => cb(manager)),
    },
    repo: { findOne: jest.fn().mockResolvedValue(null), createQueryBuilder: jest.fn() },
    shifts: {
      findOpenAtPoint: jest.fn().mockResolvedValue(shift()),
      findOneRaw: jest.fn().mockResolvedValue(shift()),
    },
    suppliers: {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: SUPPLIER, collection_point_id: POINT_A, is_active: true }),
    },
    balance: { debtFor: jest.fn().mockResolvedValue('380.00') },
    points: { findOneRaw: jest.fn().mockResolvedValue({ id: POINT_A, code: 'KPG' }) },
    audit: { record: jest.fn().mockResolvedValue(undefined) },
    pointCash: { cashFor: jest.fn().mockResolvedValue('10000.00') },
    allocations,
  };
}
export type PayoutsMocks = ReturnType<typeof makePayoutsMocks>;

/** The real classes over the mocks — commands run the REAL writer, as in production. */
export function buildPayouts(m: PayoutsMocks) {
  const writer = new PayoutWriter(
    m.shifts as never,
    m.balance as never,
    m.pointCash as never,
    m.audit as never,
    m.allocations as never,
  );
  const visible = new LoadVisiblePayoutQuery(m.repo as never, m.shifts as never);
  return {
    writer,
    create: new CreatePayoutCommand(
      m.dataSource as never,
      m.points as never,
      m.suppliers as never,
      m.allocations as never,
      writer,
    ),
    voidCmd: new VoidPayoutCommand(m.dataSource as never, m.allocations as never, visible, writer),
    settle: new SettleReturnCommand(m.dataSource as never, visible, writer),
  };
}
