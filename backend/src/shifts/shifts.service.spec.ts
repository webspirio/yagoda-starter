import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { UserRole } from '../users/user-role.enum';
import { ShiftsService } from './shifts.service';
import { ShiftStatus } from './shift-status.enum';

const POINT_A = '11111111-1111-1111-1111-111111111111';
const POINT_B = '22222222-2222-2222-2222-222222222222';
const SHIFT_ID = '33333333-3333-3333-3333-333333333333';

const owner = {
  sub: 'u-owner',
  username: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
};
const operator = {
  sub: 'u-op',
  username: 'op',
  role: UserRole.PointOperator,
  collection_point_id: POINT_A,
};
const otherOperator = {
  sub: 'u-op-b',
  username: 'opb',
  role: UserRole.PointOperator,
  collection_point_id: POINT_B,
};

describe('ShiftsService', () => {
  let repo: {
    findOne: jest.Mock;
    findAndCount: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let manager: {
    save: jest.Mock;
    update: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    getRepository: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };
  let cash: { expectedForOpening: jest.Mock; expectedForClosing: jest.Mock };
  let audit: { record: jest.Mock };
  let time: { now: jest.Mock };
  let service: ShiftsService;

  const shift = (over: Record<string, unknown> = {}) => ({
    id: SHIFT_ID,
    collection_point_id: POINT_A,
    opened_by_user_id: 'u-op',
    closed_by_user_id: null,
    business_date: '2026-09-08',
    closed_at: null,
    status: ShiftStatus.Open,
    explanation: null,
    created_at: new Date('2026-09-08T04:30:00.000Z'),
    updated_at: new Date('2026-09-08T04:30:00.000Z'),
    ...over,
  });

  // §6.1's opening count, minimal and unused by anything outside the `open`
  // describe block below — most tests here care only that a shift row lands,
  // not what the drawer held.
  const openDto = { counted_amount: '100.00' } as never;

  beforeEach(() => {
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      save: jest.fn().mockImplementation((s) => Promise.resolve(shift(s))),
      create: jest.fn().mockImplementation((s) => shift(s)),
      createQueryBuilder: jest.fn(),
    };
    // `open`, `close` and `reopen` ALL run inside `this.dataSource.transaction`,
    // writing through the transaction's own `EntityManager` rather than through
    // `repo` directly — and since the close/reopen race fix, READING through it
    // too: `loadVisible`, `findOpenAtPoint` and the newest-shift check all take
    // the row lock, so they must go through the manager or they are not locked.
    //
    // BOTH READ SEAMS DELEGATE TO `repo`, so a test still says what it means by
    // `repo.findOne.mockResolvedValue(...)` and does not have to know which of
    // the two the production code reached for.
    manager = {
      save: jest.fn().mockImplementation((_entityClass: unknown, data: Record<string, unknown>) =>
        Promise.resolve({ id: SHIFT_ID, ...data }),
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn((_entityClass: unknown, opts: unknown) => repo.findOne(opts)),
      // D-8's `loadDisplayNames` — no test in this file asserts a name, so an
      // empty result (every name reads `null`) is enough.
      find: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn(() => repo),
    };
    dataSource = { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)) };
    cash = {
      expectedForOpening: jest.fn().mockResolvedValue(null),
      expectedForClosing: jest.fn().mockResolvedValue(null),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    time = {
      now: jest.fn().mockReturnValue(DateTime.fromISO('2026-09-08T07:30', { zone: 'Europe/Kyiv' })),
    };
    service = new ShiftsService(
      repo as never,
      {} as never,
      audit as never,
      time as never,
      dataSource as never,
      cash as never,
    );
  });

  describe('open', () => {
    it('derives business_date from TimeService in the app zone, not from a request', async () => {
      // foundation §5.2 — server-derived, never editable. The DTO carries only
      // `counted_amount` (§6.1); there is no `business_date` field a caller
      // could smuggle in.
      await service.open(operator, openDto);

      expect(manager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ business_date: '2026-09-08' }),
      );
    });

    it('files a 23:30 Kyiv shift under that day, not the UTC next day', async () => {
      // The whole reason APP_TIMEZONE is load-bearing from this slice onward:
      // under UTC this shift, and every document in it, files under the 9th.
      time.now.mockReturnValue(DateTime.fromISO('2026-09-08T23:30', { zone: 'Europe/Kyiv' }));

      await service.open(operator, openDto);

      expect(manager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ business_date: '2026-09-08' }),
      );
    });

    it('always takes the point from the operator token', async () => {
      // §10.3 — the owner has no open verb at all, so there is no body point to
      // validate and no `resolveWritePoint` call here.
      await service.open(operator, openDto);

      expect(manager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ collection_point_id: POINT_A, opened_by_user_id: 'u-op' }),
      );
    });

    it('refuses an actor with no point rather than opening one nowhere', async () => {
      // CHK_users_role_point should make this unreachable and the guard should
      // stop an owner earlier still; this is what happens if both ever fail.
      await expect(service.open(owner, openDto)).rejects.toThrow(ForbiddenException);
    });

    it('translates a 23505 on the partial index into a readable 409', async () => {
      manager.save.mockRejectedValue({ code: '23505', constraint: 'UQ_shifts_open_per_point' });

      await expect(service.open(operator, openDto)).rejects.toMatchObject({
        response: { code: 'SHIFT_ALREADY_OPEN' },
      });
    });

    it('translates a 23505 on the day index into a DIFFERENT 409', async () => {
      // Two constraints, two causes, two remedies: «close the open one» versus
      // «ask the owner to reopen today's». One message for both would send the
      // operator down the wrong path with cars waiting.
      manager.save.mockRejectedValue({ code: '23505', constraint: 'UQ_shifts_point_business_date' });

      await expect(service.open(operator, openDto)).rejects.toMatchObject({
        response: { code: 'SHIFT_DAY_ALREADY_USED' },
      });
    });

    it('audits shift.opened', async () => {
      await service.open(operator, openDto);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'shift.opened', actor_id: 'u-op' }),
        expect.anything(),
      );
    });
  });

  // §6.1's closing count, minimal and unused by anything outside the
  // `ShiftsService.close with a count` describe block below — these tests
  // (and `reopen`'s) care only that a shift row lands and refuses correctly,
  // not what the drawer held.
  const closeDto = { counted_amount: '100.00' } as never;

  describe('close', () => {
    it('stamps closed_at, closed_by and status', async () => {
      repo.findOne.mockResolvedValue(shift());
      cash.expectedForClosing.mockResolvedValue('100.00');

      await service.close(operator, SHIFT_ID, closeDto);

      expect(manager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          closed_by_user_id: 'u-op',
          status: ShiftStatus.Closed,
          closed_at: expect.any(Date),
        }),
      );
    });

    it('writes NO explanation and never sets awaiting_explanation', async () => {
      // The dead-state guarantee. If this fails, someone wired a discrepancy
      // path in ahead of cash_counts.
      repo.findOne.mockResolvedValue(shift());
      cash.expectedForClosing.mockResolvedValue('100.00');

      const result = await service.close(operator, SHIFT_ID, closeDto);

      expect(result.status).toBe(ShiftStatus.Closed);
      expect(result.status).not.toBe(ShiftStatus.AwaitingExplanation);
    });

    it('409s an already closed shift', async () => {
      repo.findOne.mockResolvedValue(
        shift({ closed_at: new Date(), closed_by_user_id: 'u-op', status: ShiftStatus.Closed }),
      );

      await expect(service.close(operator, SHIFT_ID, closeDto)).rejects.toThrow(ConflictException);
    });

    it('404s another point’s shift', async () => {
      repo.findOne.mockResolvedValue(shift());

      await expect(service.close(otherOperator, SHIFT_ID, closeDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('stores broken_crates on the closed shift', async () => {
      // §6.8's «бій» — the operator's count of what broke, written inside the
      // same transaction as the close.
      repo.findOne.mockResolvedValue(shift());
      cash.expectedForClosing.mockResolvedValue('100.00');

      const saved = await service.close(operator, SHIFT_ID, {
        counted_amount: '100.00',
        broken_crates: 3,
      } as never);

      expect(saved.broken_crates).toBe(3);
    });

    it('stores a zero — «нуль це нормальне значення»', async () => {
      // Zero is a positive claim that nothing broke. It must survive as 0, not
      // become null, and not be dropped as falsy.
      repo.findOne.mockResolvedValue(shift());
      cash.expectedForClosing.mockResolvedValue('100.00');

      const saved = await service.close(operator, SHIFT_ID, {
        counted_amount: '100.00',
        broken_crates: 0,
      } as never);

      expect(saved.broken_crates).toBe(0);
    });

    it('records the breakage in the shift.closed audit entry', async () => {
      // The overwritten value survives ONLY here — see the entity's doc comment.
      repo.findOne.mockResolvedValue(shift());
      cash.expectedForClosing.mockResolvedValue('100.00');

      await service.close(operator, SHIFT_ID, {
        counted_amount: '100.00',
        broken_crates: 3,
      } as never);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'shift.closed',
          after: expect.objectContaining({ broken_crates: 3 }),
        }),
        expect.anything(),
      );
    });

    it('closes a stale shift from a previous day without complaint', async () => {
      // The forgotten-close path: Friday's shift closed on Saturday morning.
      // `close` must not read business_date at all — that is what makes this
      // work, and it is why the assertion is on the absence of a refusal.
      repo.findOne.mockResolvedValue(shift({ business_date: '2026-09-04' }));
      cash.expectedForClosing.mockResolvedValue('100.00');

      await expect(service.close(operator, SHIFT_ID, closeDto)).resolves.toBeDefined();
    });
  });

  describe('reopen', () => {
    it('is refused for an operator at their own point', async () => {
      // The one shift verb that INVERTS §10.3, deliberately: a reopen is a
      // correction, and §10.2 gives corrections to the owner. Enforced by
      // @Auth(NetworkOwner) at the controller; belt and braces here.
      repo.findOne.mockResolvedValue(
        shift({ closed_at: new Date(), closed_by_user_id: 'u-op', status: ShiftStatus.Closed }),
      );

      await expect(
        service.reopen(operator, SHIFT_ID, { reason: 'закрив помилково' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('409s a shift that is not closed', async () => {
      repo.findOne.mockResolvedValue(shift());

      await expect(service.reopen(owner, SHIFT_ID, { reason: 'помилка' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('409s when another shift is already open at that point', async () => {
      repo.findOne
        .mockResolvedValueOnce(
          shift({ closed_at: new Date(), closed_by_user_id: 'u-op', status: ShiftStatus.Closed }),
        )
        .mockResolvedValueOnce(shift({ id: 'other-open' }));

      await expect(service.reopen(owner, SHIFT_ID, { reason: 'помилка' })).rejects.toMatchObject({
        response: { code: 'SHIFT_ALREADY_OPEN' },
      });
    });

    it('409s when the target is not the point’s newest shift', async () => {
      // Reopening an older day would let documents land on a day the point has
      // already moved past, and would create a second open shift the moment
      // the newest one is reopened too.
      repo.findOne
        .mockResolvedValueOnce(
          shift({
            business_date: '2026-09-04',
            closed_at: new Date(),
            closed_by_user_id: 'u-op',
            status: ShiftStatus.Closed,
          }),
        )
        .mockResolvedValueOnce(null) // nothing open
        .mockResolvedValueOnce(shift({ id: 'newer', business_date: '2026-09-08' }));

      await expect(service.reopen(owner, SHIFT_ID, { reason: 'помилка' })).rejects.toMatchObject({
        response: { code: 'SHIFT_NOT_NEWEST' },
      });
    });

    it('clears closed_at and closed_by and audits with the reason', async () => {
      repo.findOne
        .mockResolvedValueOnce(
          shift({ closed_at: new Date(), closed_by_user_id: 'u-op', status: ShiftStatus.Closed }),
        )
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(shift({ id: SHIFT_ID }));

      await service.reopen(owner, SHIFT_ID, { reason: 'закрив помилково' });

      // `reopen` is now transactional — see `ShiftsService.reopen demotes
      // the closing count` below for the demotion itself. Here it's still
      // going through `this.dataSource.transaction`, so the shift lands via
      // `manager.save`, not `repo.save`.
      expect(manager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          closed_at: null,
          closed_by_user_id: null,
          status: ShiftStatus.Open,
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'shift.reopened', note: 'закрив помилково' }),
        expect.anything(),
      );
    });

    it('clears broken_crates when the owner reopens', async () => {
      // CHK_shifts_broken_crates_closed forbids a count on an open shift, and
      // the re-close will ask the operator again — back to «не записано».
      repo.findOne
        .mockResolvedValueOnce(
          shift({
            closed_at: new Date(),
            closed_by_user_id: 'u-op',
            status: ShiftStatus.Closed,
            broken_crates: 3,
          }),
        )
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(shift({ id: SHIFT_ID }));

      const reopened = await service.reopen(owner, SHIFT_ID, { reason: 'помилка' });

      expect(reopened.broken_crates).toBeNull();
    });
  });

  describe('findOpenAtPoint', () => {
    it('returns null rather than throwing when nothing is open', async () => {
      // Callers turn this into a 409 with their own message; a null keeps the
      // seam usable by both document services.
      repo.findOne.mockResolvedValue(null);

      await expect(service.findOpenAtPoint(POINT_A)).resolves.toBeNull();
    });
  });
});

describe('ShiftsService.open with a count', () => {
  const build = (opts: { previous?: string | null } = {}) => {
    const saved: Record<string, unknown>[] = [];
    const manager = {
      save: jest.fn((_e: unknown, x: Record<string, unknown>) => {
        saved.push(x);
        return { id: 'sh-1', created_at: new Date(), ...x };
      }),
      // D-8's `loadDisplayNames` — no test in this describe block asserts a
      // name, so an empty result (every name reads `null`) is enough.
      find: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn(),
    };
    const dataSource = { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)) };
    const cash = {
      expectedForOpening: jest.fn().mockResolvedValue(
        opts.previous === undefined ? null : opts.previous,
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const time = {
      now: () => ({ toISODate: () => '2026-09-09', toJSDate: () => new Date('2026-09-09T04:30:00Z') }),
    };
    const service = new ShiftsService(
      { create: (x: unknown) => x } as never,
      {} as never,
      audit as never,
      time as never,
      dataSource as never,
      cash as never,
    );
    return { service, saved, audit, cash };
  };

  const operator = {
    sub: 'u-op',
    username: 'op',
    role: UserRole.PointOperator,
    collection_point_id: 'p1',
  } as never;

  it("a point's FIRST count sets expected = counted, so the discrepancy is zero", async () => {
    const { service, saved } = build({ previous: null });
    await service.open(operator, { counted_amount: '47000.00' } as never);

    const countRow = saved.find((r) => 'counted_amount' in r)!;
    // The regression test for spec §3.2 — get this wrong and every point's
    // first day reports its whole drawer as a surplus.
    expect(countRow.counted_amount).toBe('47000.00');
    expect(countRow.expected_amount).toBe('47000.00');
    expect(countRow.kind).toBe('opening');
    expect(countRow.book).toBe('berry');
  });

  it("a later opening expects the previous close's COUNTED figure", async () => {
    const { service, saved } = build({ previous: '15066.10' });
    await service.open(operator, { counted_amount: '15066.10' } as never);
    const countRow = saved.find((r) => 'counted_amount' in r)!;
    expect(countRow.expected_amount).toBe('15066.10');
  });

  it('records a discrepancy without refusing', async () => {
    const { service, saved } = build({ previous: '15416.10' });
    const result = await service.open(operator, { counted_amount: '15066.10' } as never);
    const countRow = saved.find((r) => 'counted_amount' in r)!;
    expect(countRow.counted_amount).toBe('15066.10');
    expect(countRow.expected_amount).toBe('15416.10');
    expect(result.status).toBe(ShiftStatus.Open);
  });

  it('stamps the counter, not the shift opener', async () => {
    const { service, saved } = build({ previous: null });
    await service.open(operator, { counted_amount: '10.00' } as never);
    const countRow = saved.find((r) => 'counted_amount' in r)!;
    expect(countRow.counted_by_user_id).toBe('u-op');
  });

  it('writes a cash-count.recorded audit entry inside the transaction', async () => {
    const { service, audit } = build({ previous: null });
    await service.open(operator, { counted_amount: '10.00' } as never);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cash-count.recorded' }),
      expect.anything(),
    );
  });
});

describe('ShiftsService.close with a count', () => {
  const build = (opts: { expected?: string | null; shift?: Record<string, unknown> } = {}) => {
    const saved: Record<string, unknown>[] = [];
    const shiftRow = {
      id: 'sh-1',
      collection_point_id: 'p1',
      business_date: '2026-09-09',
      closed_at: null,
      status: ShiftStatus.Open,
      created_at: new Date('2026-09-09T04:30:00Z'),
      ...opts.shift,
    };
    const manager = {
      save: jest.fn((_e: unknown, x: Record<string, unknown>) => {
        saved.push(x);
        return { id: 'cc-1', ...x };
      }),
      findOne: jest.fn().mockResolvedValue(shiftRow),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      // D-8's `loadDisplayNames` — no test in this describe block asserts a
      // name, so an empty result (every name reads `null`) is enough.
      find: jest.fn().mockResolvedValue([]),
    };
    const dataSource = { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)) };
    const cash = {
      expectedForClosing: jest
        .fn()
        .mockResolvedValue(opts.expected === undefined ? '15416.10' : opts.expected),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const time = {
      now: () => ({ toISODate: () => '2026-09-09', toJSDate: () => new Date('2026-09-09T17:55:00Z') }),
    };
    const repo = { findOne: jest.fn().mockResolvedValue(shiftRow), create: (x: unknown) => x };
    const service = new ShiftsService(
      repo as never,
      {} as never,
      audit as never,
      time as never,
      dataSource as never,
      cash as never,
    );
    return { service, saved, audit, manager };
  };

  const operator = {
    sub: 'u-op',
    username: 'op',
    role: UserRole.PointOperator,
    collection_point_id: 'p1',
  } as never;

  it('CLOSES DESPITE A DISCREPANCY — the ruling that overrules §7.7', async () => {
    const { service, saved } = build({ expected: '15416.10' });
    const result = await service.close(operator, 'sh-1', { counted_amount: '15066.10' } as never);

    expect(result.status).toBe(ShiftStatus.Closed);
    expect(result.status).not.toBe(ShiftStatus.AwaitingExplanation);
    const countRow = saved.find((r) => 'counted_amount' in r)!;
    expect(countRow.counted_amount).toBe('15066.10');
    expect(countRow.expected_amount).toBe('15416.10');
    expect(countRow.kind).toBe('closing');
  });

  it('closes cleanly when the count matches', async () => {
    const { service, saved } = build({ expected: '15416.10' });
    const result = await service.close(operator, 'sh-1', { counted_amount: '15416.10' } as never);
    expect(result.status).toBe(ShiftStatus.Closed);
    const countRow = saved.find((r) => 'counted_amount' in r)!;
    expect(countRow.counted_amount).toBe(countRow.expected_amount);
  });

  it('refuses a shift that is already closed', async () => {
    const { service } = build({ shift: { closed_at: new Date(), status: ShiftStatus.Closed } });
    await expect(
      service.close(operator, 'sh-1', { counted_amount: '1.00' } as never),
    ).rejects.toThrow(ConflictException);
  });
});

describe('ShiftsService.reopen demotes the closing count', () => {
  it("rewrites the closing count's kind to midday and preserves everything else", async () => {
    const updates: unknown[][] = [];
    const shiftRow = {
      id: 'sh-1',
      collection_point_id: 'p1',
      business_date: '2026-09-09',
      closed_at: new Date(),
      status: ShiftStatus.Closed,
      created_at: new Date('2026-09-09T04:30:00Z'),
    };
    const manager = {
      // loadVisible and the newest-shift check, both of which want the row.
      findOne: jest.fn().mockResolvedValue(shiftRow),
      save: jest.fn((_e: unknown, x: unknown) => x),
      update: jest.fn((...args: unknown[]) => {
        updates.push(args);
        return { affected: 1 };
      }),
      // findOpenAtPoint reads through the manager's repository so its SELECT
      // takes part in the same transaction — it must find NO open shift here.
      getRepository: jest.fn(() => repo),
      // D-8's `loadDisplayNames` — this test asserts only the demotion, not a
      // name, so an empty result (every name reads `null`) is enough.
      find: jest.fn().mockResolvedValue([]),
    };
    const dataSource = { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)) };
    // `reopen` reads THREE times with different intents: loadVisible and the
    // newest-shift check go through `manager.findOne`, while findOpenAtPoint
    // goes through `manager.getRepository(Shift)` and passes
    // `closed_at: IsNull()`. A mock that returns the row for that third read
    // makes findOpenAtPoint report an open shift, and reopen throws
    // SHIFT_ALREADY_OPEN before reaching the demotion. Discriminate on the
    // where clause.
    const repo = {
      findOne: jest.fn((opts: { where?: Record<string, unknown> }) =>
        Promise.resolve(
          opts?.where && 'closed_at' in opts.where ? null : shiftRow,
        ),
      ),
      create: (x: unknown) => x,
    };
    const service = new ShiftsService(
      repo as never,
      {} as never,
      { record: jest.fn() } as never,
      { now: () => ({ toISODate: () => '2026-09-09', toJSDate: () => new Date() }) } as never,
      dataSource as never,
      {} as never,
    );
    const owner = {
      sub: 'u-owner',
      username: 'owner',
      role: UserRole.NetworkOwner,
      collection_point_id: null,
    } as never;

    await service.reopen(owner, 'sh-1', { reason: 'закрили помилково' } as never);

    // Only `kind` moves — counted_amount, expected_amount, counted_at and
    // counted_by_user_id are evidence and must survive (§6.3).
    const [, criteria, patch] = updates[0] as [unknown, unknown, Record<string, unknown>];
    expect(criteria).toMatchObject({ shift_id: 'sh-1', kind: 'closing' });
    expect(patch).toEqual({ kind: 'midday' });
  });
});
