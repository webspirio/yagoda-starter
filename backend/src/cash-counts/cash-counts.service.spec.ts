import { toCashCountRowResponse, type CashCountRow } from './cash-count.mapper';
import { CashBook } from './cash-book.enum';
import { CashCountKind } from './cash-count-kind.enum';
import { CashCountsService } from './cash-counts.service';
import type { CreateCashCountDto } from './dto/create-cash-count.dto';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const row = (over: Partial<CashCountRow> = {}): CashCountRow => ({
  id: 'cc-1',
  shift_id: 'sh-1',
  collection_point_id: 'p1',
  business_date: '2026-09-09',
  book: CashBook.Berry,
  kind: CashCountKind.Closing,
  counted_amount: '15066.10',
  expected_amount: '15416.10',
  counted_by_user_id: 'u-op',
  counted_at: new Date('2026-09-09T17:55:00Z'),
  explanation: null,
  ...over,
});

const NO_NAMES = new Map<string, string>();

describe('toCashCountRowResponse', () => {
  it('a shortage is NEGATIVE — the opposite of a transfer discrepancy, deliberately', () => {
    expect(toCashCountRowResponse(row(), NO_NAMES).discrepancy).toBe('-350.00');
  });

  it('a surplus is positive', () => {
    expect(
      toCashCountRowResponse(row({ counted_amount: '15766.10' }), NO_NAMES).discrepancy,
    ).toBe('350.00');
  });

  it('a matching count reads 0.00 and is not open', () => {
    const r = toCashCountRowResponse(row({ counted_amount: '15416.10' }), NO_NAMES);
    expect(r.discrepancy).toBe('0.00');
    expect(r.is_open).toBe(false);
  });

  it('a discrepancy with no explanation is OPEN', () => {
    expect(toCashCountRowResponse(row(), NO_NAMES).is_open).toBe(true);
  });

  it('an explained discrepancy is closed, and its numbers do not move', () => {
    const r = toCashCountRowResponse(row({ explanation: 'касир помилився решткою' }), NO_NAMES);
    expect(r.is_open).toBe(false);
    // §7.7 — «розбіжність у документі лишається, її не підганяють».
    expect(r.discrepancy).toBe('-350.00');
    expect(r.counted_amount).toBe('15066.10');
  });

  // D-8 — `counted_by_name` is a pure map read: the mapper does no I/O.
  it('reads counted_by_name from the caller’s map', () => {
    const names = new Map([['u-op', 'Оксана Ткач']]);
    expect(toCashCountRowResponse(row(), names).counted_by_name).toBe('Оксана Ткач');
  });

  it('reads null when the counting user is not in the map', () => {
    expect(toCashCountRowResponse(row(), NO_NAMES).counted_by_name).toBeNull();
  });
});

describe('CashCountsService.recount', () => {
  const POINT = 'p-1';
  const SHIFT_ID = 'sh-1';
  const COUNT_ID = 'cc-recount-1';

  const operator: AuthenticatedUser = {
    sub: 'u-oksana',
    username: 'oksana',
    role: UserRole.PointOperator,
    collection_point_id: POINT,
  };

  const operatorWithoutPoint: AuthenticatedUser = {
    sub: 'u-nopoint',
    username: 'nopoint',
    role: UserRole.PointOperator,
    collection_point_id: null,
  };

  const openShift = {
    id: SHIFT_ID,
    collection_point_id: POINT,
    business_date: '2026-09-22',
    explanation: null,
  };

  const dto = (over: Partial<CreateCashCountDto> = {}): CreateCashCountDto => ({
    book: CashBook.Berry,
    counted_amount: '1100.00',
    ...over,
  });

  let manager: { save: jest.Mock; find: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let shifts: { findOpenAtPoint: jest.Mock };
  let cash: { cashFor: jest.Mock };
  let audit: { record: jest.Mock };
  let service: CashCountsService;

  beforeEach(() => {
    manager = {
      save: jest
        .fn()
        .mockImplementation((_entity: unknown, v: Record<string, unknown>) =>
          Promise.resolve({ id: COUNT_ID, ...v }),
        ),
      // D-8's `loadDisplayNames` — the fixture user behind `operator.sub`.
      find: jest.fn().mockResolvedValue([
        { id: 'u-oksana', first_name: 'Оксана', last_name: 'Ткач' },
      ]),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation((cb: (m: unknown) => unknown) => cb(manager)),
    };
    shifts = { findOpenAtPoint: jest.fn().mockResolvedValue(openShift) };
    cash = { cashFor: jest.fn().mockResolvedValue('1100.00') };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    service = new CashCountsService(
      dataSource as never,
      shifts as never,
      cash as never,
      audit as never,
    );
  });

  const saved = () => manager.save.mock.calls[0][1] as Record<string, unknown>;

  it('refuses an operator with no assigned point', async () => {
    await expect(service.recount(operatorWithoutPoint, dto())).rejects.toMatchObject({
      response: { code: 'NO_COLLECTION_POINT' },
    });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('refuses when no shift is open at the point (§7.6 — a recount clings to an open shift)', async () => {
    shifts.findOpenAtPoint.mockResolvedValue(null);

    await expect(service.recount(operator, dto())).rejects.toMatchObject({
      response: { code: 'SHIFT_NOT_OPEN' },
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('reads the open shift at the ACTOR’s point, inside the transaction', async () => {
    await service.recount(operator, dto());

    expect(shifts.findOpenAtPoint).toHaveBeenCalledWith(POINT, manager);
  });

  it('reads the drawer figure inside the same transaction', async () => {
    await service.recount(operator, dto());

    expect(cash.cashFor).toHaveBeenCalledWith(POINT, undefined, manager);
  });

  it('saves a midday berry count, expected_amount from cashFor, signed by whoever pressed the button', async () => {
    cash.cashFor.mockResolvedValue('1100.00');

    await service.recount(operator, dto({ counted_amount: '1100.00' }));

    expect(saved()).toMatchObject({
      shift_id: SHIFT_ID,
      book: CashBook.Berry,
      kind: CashCountKind.Midday,
      counted_amount: '1100.00',
      expected_amount: '1100.00',
      counted_by_user_id: 'u-oksana',
    });
  });

  it('records the audit entry with the manager', async () => {
    await service.recount(operator, dto());

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cash-count.recorded',
        actor_id: 'u-oksana',
        target_type: 'cash_count',
        target_id: COUNT_ID,
      }),
      manager,
    );
  });

  it('returns the row mapped through the shared mapper — a shortage reads negative and stays NOT open', async () => {
    cash.cashFor.mockResolvedValue('1100.00');

    const row = await service.recount(operator, dto({ counted_amount: '1000.00' }));

    expect(row.kind).toBe(CashCountKind.Midday);
    expect(row.discrepancy).toBe('-100.00');
    expect(row.is_open).toBe(false);
  });

  it('resolves counted_by_name for the recording operator (D-8)', async () => {
    const row = await service.recount(operator, dto());

    expect(row.counted_by_name).toBe('Оксана Ткач');
  });

  it('reads counted_by_name as null when the id is not in the loaded map', async () => {
    manager.find.mockResolvedValue([]);

    const row = await service.recount(operator, dto());

    expect(row.counted_by_name).toBeNull();
  });
});
