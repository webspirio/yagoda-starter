import { UserRole } from '../../users/user-role.enum';
import { ShiftStatus } from '../../shifts/shift-status.enum';
import { PriceIntakeQuery } from '../../intakes/queries/price-intake.query';
import { PreviewIntakeQuery } from '../../intakes/queries/preview-intake.query';
import { LoadVisibleIntakeQuery } from '../../intakes/queries/load-visible-intake.query';
import { IntakeDetailQuery } from '../../intakes/queries/intake-detail.query';
import { GetIntakeQuery } from '../../intakes/queries/get-intake.query';
import { ListIntakesQuery } from '../../intakes/queries/list-intakes.query';
import { CreateIntakeCommand } from '../../intakes/commands/create-intake.command';
import { VoidIntakeCommand } from '../../intakes/commands/void-intake.command';

export const POINT_A = '11111111-1111-1111-1111-111111111111';
export const POINT_B = '22222222-2222-2222-2222-222222222222';
export const SHIFT_ID = '33333333-3333-3333-3333-333333333333';
export const SUPPLIER = '44444444-4444-4444-4444-444444444444';
export const GRADE = '55555555-5555-5555-5555-555555555555';
export const CRATE = '66666666-6666-6666-6666-666666666666';
export const INTAKE_ID = '77777777-7777-7777-7777-777777777777';

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
// §10.6's mid-day cashier swap: a SECOND operator at the SAME point.
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

export const intake = (over: Record<string, unknown> = {}) => ({
  id: INTAKE_ID,
  code: 'KPG-IN-20260908-004',
  shift_id: SHIFT_ID,
  supplier_id: SUPPLIER,
  amount: '2103.30',
  received_by_user_id: 'u-oksana',
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  created_at: new Date('2026-09-08T07:00:00.000Z'),
  updated_at: new Date('2026-09-08T07:00:00.000Z'),
  ...over,
});

export const dto = (over: Record<string, unknown> = {}) => ({
  supplier_id: SUPPLIER,
  items: [
    {
      product_grade_id: GRADE,
      gross_kg: '42.00',
      pallet_kg: '1.50',
      bonus: '0.00',
      tare: [{ tare_type_id: CRATE, units: 3 }],
    },
  ],
  ...over,
});

export function makeIntakesMocks() {
  const itemRepo = { find: jest.fn().mockResolvedValue([]) };
  // Shared by `manager` and `plainManager`: `extras` reads `ROW_EXTRAS_SQL`
  // (contains `AS net_kg`) and `nextDocumentCode`'s count reads everything
  // else, so branching on the SQL text is what lets one mock answer both.
  const queryExtrasOrCount = (sql: string) =>
    Promise.resolve(
      sql.includes('pg_advisory_xact_lock')
        ? [{}]
        : sql.includes('AS net_kg')
          ? [
              {
                net_kg: '36.90',
                lines_count: 2,
                supplier_name: 'Іван Коваль',
                paid_amount: '0.00',
                open_amount: '1200.00',
              },
            ]
          : // `nextDocumentCode` locks, then counts the documents already in
            // this shift. Three of them, so the next receipt is 004.
            [{ n: 3 }],
    );
  // `receiverName` reads `User` by id; branch on the entity CLASS's `.name` so
  // every other `findOne(Entity, …)` call keeps its own mock untouched.
  const findOneUserOrNull = (entity: { name?: string }) =>
    Promise.resolve(entity?.name === 'User' ? { first_name: 'Оксана', last_name: 'Гнатюк' } : null);
  const manager = {
    getRepository: jest.fn().mockReturnValue(itemRepo),
    query: jest.fn().mockImplementation(queryExtrasOrCount),
    findOne: jest.fn().mockImplementation(findOneUserOrNull),
    save: jest.fn().mockImplementation((_e, v) => Promise.resolve(intake(v))),
    create: jest.fn().mockImplementation((_e, v) => v),
  };
  const plainManager = {
    getRepository: jest.fn().mockReturnValue(itemRepo),
    query: jest.fn().mockImplementation(queryExtrasOrCount),
    findOne: jest.fn().mockImplementation(findOneUserOrNull),
    find: jest.fn().mockResolvedValue([]),
  };
  const dataSource = {
    transaction: jest.fn().mockImplementation((cb: (m: unknown) => unknown) => cb(manager)),
    manager: plainManager,
  };
  const repo = {
    findOne: jest.fn().mockResolvedValue(null),
    createQueryBuilder: jest.fn(),
    manager: plainManager,
  };
  const shifts = {
    findOpenAtPoint: jest.fn().mockResolvedValue(shift()),
    findOneRaw: jest.fn().mockResolvedValue(shift()),
  };
  const suppliers = {
    findOne: jest
      .fn()
      .mockResolvedValue({ id: SUPPLIER, collection_point_id: POINT_A, is_active: true }),
  };
  const prices = {
    currentFor: jest.fn().mockResolvedValue({
      product_grade_id: GRADE,
      base_price: '57.00',
      max_markup: '30.00',
      max_discount: '20.00',
    }),
  };
  const tare = { findManyRaw: jest.fn().mockResolvedValue([{ id: CRATE, weight_kg: '1.20' }]) };
  const points = { findOneRaw: jest.fn().mockResolvedValue({ id: POINT_A, code: 'KPG' }) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const payouts = {
    write: jest.fn().mockImplementation((_m, input: { amount: string; intakeId: string }) =>
      Promise.resolve({
        payout: {
          id: 'po-1',
          code: 'KPG-PO-20260908-001',
          amount: input.amount,
          intake_id: input.intakeId,
          voided_at: null,
        },
        shift: shift(),
      }),
    ),
    findLiveBoundToIntake: jest.fn().mockResolvedValue(null),
    void: jest
      .fn()
      .mockImplementation((_m, _a, p) => Promise.resolve({ ...p, voided_at: new Date() })),
    settleReturn: jest.fn().mockImplementation((_m, _a, p) => Promise.resolve(p)),
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
    itemRepo,
    manager,
    plainManager,
    dataSource,
    repo,
    shifts,
    suppliers,
    prices,
    tare,
    points,
    audit,
    payouts,
    allocations,
  };
}
export type IntakesMocks = ReturnType<typeof makeIntakesMocks>;

export function buildIntakes(m: IntakesMocks) {
  const pricing = new PriceIntakeQuery(
    m.points as never,
    m.suppliers as never,
    m.shifts as never,
    m.prices as never,
    m.tare as never,
  );
  const detail = new IntakeDetailQuery(m.repo as never);
  const visible = new LoadVisibleIntakeQuery(m.repo as never, m.shifts as never);
  return {
    create: new CreateIntakeCommand(
      m.dataSource as never,
      pricing,
      m.allocations as never,
      m.payouts as never,
      m.audit as never,
      detail,
    ),
    voidCmd: new VoidIntakeCommand(
      m.dataSource as never,
      visible,
      m.allocations as never,
      m.payouts as never,
      m.audit as never,
      detail,
    ),
    preview: new PreviewIntakeQuery(m.dataSource as never, pricing),
    get: new GetIntakeQuery(visible, detail),
    list: new ListIntakesQuery(m.repo as never),
  };
}
