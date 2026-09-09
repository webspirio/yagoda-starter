import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { TransferStatus } from './transfer-status.enum';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const owner: AuthenticatedUser = {
  sub: 'u-owner',
  username: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
};

const operatorA: AuthenticatedUser = {
  sub: 'u-op-a',
  username: 'opa',
  role: UserRole.PointOperator,
  collection_point_id: 'point-a',
};

describe('TransfersService.create', () => {
  const build = (over: Record<string, unknown> = {}) => {
    const repo = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn((x: Record<string, unknown>) => ({ id: 't-1', created_at: new Date(), ...x })),
      findOne: jest.fn().mockResolvedValue(null),
      ...(over.repo as object),
    };
    const points = {
      findOneRaw: jest.fn().mockResolvedValue({ id: 'point-a', is_active: true }),
      ...(over.points as object),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const time = { now: () => ({ toISODate: () => '2026-09-09', toJSDate: () => new Date() }) };
    const service = new TransfersService(
      repo as never,
      points as never,
      audit as never,
      time as never,
      { transaction: jest.fn() } as never,
      { appTimezone: 'Europe/Kyiv' },
    );
    return { service, repo, points, audit };
  };

  const dto = { collection_point_id: 'point-a', cash: '150000.00', crates: 200, carrier: 'Іван' };

  it('creates a transfer in the sent state', async () => {
    const { service, repo } = build();
    const result = await service.create(owner, dto as never);

    expect(result.status).toBe(TransferStatus.Sent);
    expect(result.accepted_date).toBeNull();
    expect(repo.save).toHaveBeenCalled();
  });

  it('refuses an operator — §7.9 step 1 puts creation with the owner', async () => {
    const { service } = build();
    await expect(service.create(operatorA, dto as never)).rejects.toThrow(ForbiddenException);
  });

  it('refuses an unknown point', async () => {
    const { service } = build({ points: { findOneRaw: jest.fn().mockResolvedValue(null) } });
    await expect(service.create(owner, dto as never)).rejects.toThrow(NotFoundException);
  });

  it('refuses a deactivated point', async () => {
    const { service } = build({
      points: { findOneRaw: jest.fn().mockResolvedValue({ id: 'point-a', is_active: false }) },
    });
    await expect(service.create(owner, dto as never)).rejects.toThrow(BadRequestException);
  });

  it('refuses a correction naming a transfer at another point', async () => {
    const { service } = build({
      repo: {
        findOne: jest.fn().mockResolvedValue({ id: 't-old', collection_point_id: 'point-b' }),
      },
    });
    await expect(
      service.create(owner, { ...dto, correction_of_transfer_id: 't-old' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('writes a transfer.created audit entry', async () => {
    const { service, audit } = build();
    await service.create(owner, dto as never);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'transfer.created', actor_id: 'u-owner' }),
    );
  });
});

describe('TransfersService.accept / dispute', () => {
  const sentTransfer = () => ({
    id: 't-1',
    collection_point_id: 'point-a',
    cash: '150000.00',
    crates: 200,
    carrier: 'Іван',
    status: TransferStatus.Sent,
    accepted_by_user_id: null,
    accepted_date: null,
    accepted_at: null,
    reported_cash: null,
    reported_crates: null,
    dispute_note: null,
    resolved_cash: null,
    resolved_crates: null,
    resolved_by_user_id: null,
    resolved_at: null,
    correction_of_transfer_id: null,
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    sent_by_user_id: 'u-owner',
    sent_at: new Date(),
    created_at: new Date(),
  });

  const build = (row: Record<string, unknown> | null = sentTransfer()) => {
    const saved: Record<string, unknown>[] = [];
    const manager = {
      findOne: jest.fn().mockResolvedValue(row),
      save: jest.fn((_e: unknown, x: Record<string, unknown>) => {
        saved.push(x);
        return x;
      }),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const dataSource = {
      transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
    };
    const time = {
      now: () => ({ toISODate: () => '2026-09-09', toJSDate: () => new Date('2026-09-09T06:00:00Z') }),
    };
    const service = new TransfersService(
      {} as never,
      {} as never,
      audit as never,
      time as never,
      dataSource as never,
      { appTimezone: 'Europe/Kyiv' },
    );
    return { service, audit, saved, manager };
  };

  it('accept stamps all three accepted_* fields and the accepted status', async () => {
    const { service, saved } = build();
    await service.accept(operatorA, 't-1');

    expect(saved[0]).toMatchObject({
      status: TransferStatus.Accepted,
      accepted_by_user_id: 'u-op-a',
      accepted_date: '2026-09-09',
    });
    expect(saved[0].accepted_at).toBeInstanceOf(Date);
  });

  it('reads the clock ONCE, so accepted_at and accepted_date cannot disagree', async () => {
    // The clock ticks over local midnight between the first call and the
    // second. Two readings would file the timestamp on the 9th and the
    // business date on the 10th — and `accepted_date` is the only field the
    // cash formula filters on (§6.5).
    const readings = [
      { toISODate: () => '2026-09-09', toJSDate: () => new Date('2026-09-09T20:59:59Z') },
      { toISODate: () => '2026-09-10', toJSDate: () => new Date('2026-09-09T21:00:00Z') },
    ];
    const saved: Record<string, unknown>[] = [];
    const manager = {
      findOne: jest.fn().mockResolvedValue(sentTransfer()),
      save: jest.fn((_e: unknown, x: Record<string, unknown>) => {
        saved.push(x);
        return x;
      }),
    };
    const service = new TransfersService(
      {} as never,
      {} as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      { now: () => (readings.length > 1 ? readings.shift()! : readings[0]) } as never,
      { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)) } as never,
      { appTimezone: 'Europe/Kyiv' },
    );

    await service.accept(operatorA, 't-1');
    expect(saved[0].accepted_date).toBe('2026-09-09');
    expect(saved[0].accepted_at).toEqual(new Date('2026-09-09T20:59:59Z'));
  });

  it('REFUSES THE OWNER — §7.9 with §10.3, only the point may press Прийняв', async () => {
    const { service } = build();
    await expect(service.accept(owner, 't-1')).rejects.toThrow(ForbiddenException);
    await expect(
      service.dispute(owner, 't-1', {
        reported_cash: '140000.00',
        reported_crates: 200,
        dispute_note: 'мішок легший',
      } as never),
    ).rejects.toThrow(ForbiddenException);
  });

  it("is a 404 for another point's transfer", async () => {
    const { service } = build({ ...sentTransfer(), collection_point_id: 'point-b' });
    await expect(service.accept(operatorA, 't-1')).rejects.toThrow(NotFoundException);
  });

  it('dispute stamps accepted_* AS WELL AS reported_* — spec §6.2', async () => {
    const { service, saved } = build();
    await service.dispute(operatorA, 't-1', {
      reported_cash: '140000.00',
      reported_crates: 195,
      dispute_note: 'мішок легший',
    } as never);

    expect(saved[0]).toMatchObject({
      status: TransferStatus.Disputed,
      // The whole ruling in one assertion: without accepted_date the cash
      // formula's disputed branch is unreachable.
      accepted_date: '2026-09-09',
      accepted_by_user_id: 'u-op-a',
      reported_cash: '140000.00',
      reported_crates: 195,
      dispute_note: 'мішок легший',
    });
  });

  it('refuses to accept a transfer that is not sent', async () => {
    const { service } = build({ ...sentTransfer(), status: TransferStatus.Accepted });
    await expect(service.accept(operatorA, 't-1')).rejects.toThrow(ConflictException);
  });

  it('refuses to accept a voided transfer', async () => {
    const { service } = build({ ...sentTransfer(), voided_at: new Date() });
    await expect(service.accept(operatorA, 't-1')).rejects.toThrow(ConflictException);
  });

  it('writes transfer.accepted and transfer.disputed audit entries', async () => {
    const a = build();
    await a.service.accept(operatorA, 't-1');
    expect(a.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'transfer.accepted' }),
      expect.anything(),
    );

    const d = build();
    await d.service.dispute(operatorA, 't-1', {
      reported_cash: '140000.00',
      reported_crates: 195,
      dispute_note: 'мішок легший',
    } as never);
    expect(d.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'transfer.disputed' }),
      expect.anything(),
    );

    // THE AUDITED NOTE IS THE STORED NOTE. The service trims before saving, so
    // logging the raw DTO would quote a string the row does not contain.
    const t = build();
    await t.service.dispute(operatorA, 't-1', {
      reported_cash: '140000.00',
      reported_crates: 195,
      dispute_note: '  мішок легший  ',
    } as never);
    expect(t.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ note: 'мішок легший' }),
      expect.anything(),
    );
  });
});

describe('TransfersService.resolve / void', () => {
  const disputed = (over: Record<string, unknown> = {}) => ({
    id: 't-1',
    collection_point_id: 'point-a',
    cash: '150000.00',
    crates: 200,
    carrier: 'Іван',
    status: TransferStatus.Disputed,
    accepted_by_user_id: 'u-op-a',
    accepted_date: '2026-09-05',
    accepted_at: new Date(),
    reported_cash: '140000.00',
    reported_crates: 195,
    dispute_note: 'мішок легший',
    resolved_cash: null,
    resolved_crates: null,
    resolved_by_user_id: null,
    resolved_at: null,
    correction_of_transfer_id: null,
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    sent_by_user_id: 'u-owner',
    sent_at: new Date(),
    created_at: new Date(),
    ...over,
  });

  const build = (row: Record<string, unknown>) => {
    const saved: Record<string, unknown>[] = [];
    const manager = {
      findOne: jest.fn().mockResolvedValue(row),
      save: jest.fn((_e: unknown, x: Record<string, unknown>) => {
        saved.push(x);
        return x;
      }),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const dataSource = { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)) };
    const time = { now: () => ({ toISODate: () => '2026-09-09', toJSDate: () => new Date() }) };
    const service = new TransfersService(
      {} as never,
      {} as never,
      audit as never,
      time as never,
      dataSource as never,
      { appTimezone: 'Europe/Kyiv' },
    );
    return { service, audit, saved };
  };

  const resolution = { resolved_cash: '140000.00', resolved_crates: 195 };

  it('resolve fills resolved_* and LEAVES THE STATUS disputed', async () => {
    const { service, saved } = build(disputed());
    const result = await service.resolve(owner, 't-1', resolution as never);

    expect(saved[0]).toMatchObject({
      status: TransferStatus.Disputed,
      resolved_cash: '140000.00',
      resolved_crates: 195,
      resolved_by_user_id: 'u-owner',
    });
    expect(result.status).toBe(TransferStatus.Disputed);
  });

  it('resolve refuses an operator', async () => {
    const { service } = build(disputed());
    await expect(service.resolve(operatorA, 't-1', resolution as never)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('resolve refuses a transfer that is not disputed', async () => {
    const { service } = build(disputed({ status: TransferStatus.Accepted }));
    await expect(service.resolve(owner, 't-1', resolution as never)).rejects.toThrow(
      ConflictException,
    );
  });

  it('resolve refuses an already-resolved dispute', async () => {
    const { service } = build(disputed({ resolved_at: new Date() }));
    await expect(service.resolve(owner, 't-1', resolution as never)).rejects.toThrow(
      ConflictException,
    );
  });

  it('void stamps the trio and LEAVES THE STATUS ALONE', async () => {
    const { service, saved } = build(disputed({ status: TransferStatus.Accepted }));
    await service.void(owner, 't-1', { reason: 'дубль' } as never);

    expect(saved[0]).toMatchObject({
      // The trap in one assertion: a voided transfer is still 'accepted', so
      // every cash query must filter voided_at itself.
      status: TransferStatus.Accepted,
      voided_by_user_id: 'u-owner',
      void_reason: 'дубль',
    });
    expect(saved[0].voided_at).toBeInstanceOf(Date);
  });

  it('void refuses an operator — §9.4, «точка сторнувати не може»', async () => {
    const { service } = build(disputed());
    await expect(service.void(operatorA, 't-1', { reason: 'дубль' } as never)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('void refuses an already-voided transfer', async () => {
    const { service } = build(disputed({ voided_at: new Date() }));
    await expect(service.void(owner, 't-1', { reason: 'дубль' } as never)).rejects.toThrow(
      ConflictException,
    );
  });

  it('writes transfer.resolved and transfer.voided audit entries', async () => {
    const r = build(disputed());
    await r.service.resolve(owner, 't-1', resolution as never);
    expect(r.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'transfer.resolved' }),
      expect.anything(),
    );

    const v = build(disputed());
    await v.service.void(owner, 't-1', { reason: 'дубль' } as never);
    expect(v.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'transfer.voided', note: 'дубль' }),
      expect.anything(),
    );
  });
});

describe('TransfersService.list / findOne', () => {
  const qb = () => {
    const b: {
      andWhere: jest.Mock;
      orderBy: jest.Mock;
      addOrderBy: jest.Mock;
      skip: jest.Mock;
      take: jest.Mock;
      getManyAndCount: jest.Mock;
    } = {
      andWhere: jest.fn(() => b),
      orderBy: jest.fn(() => b),
      addOrderBy: jest.fn(() => b),
      skip: jest.fn(() => b),
      take: jest.fn(() => b),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    return b;
  };

  const build = (findOneResult: unknown = null) => {
    const builder = qb();
    const repo = {
      createQueryBuilder: jest.fn(() => builder),
      findOne: jest.fn().mockResolvedValue(findOneResult),
    };
    const service = new TransfersService(
      repo as never,
      {} as never,
      { record: jest.fn() } as never,
      { now: () => ({ toISODate: () => '2026-09-09', toJSDate: () => new Date() }) } as never,
      {} as never,
      // The zone is PINNED, never inherited from `.env` (which sets UTC
      // here): a spec touching the list's date filter must state the zone it
      // is testing. Same argument as `point-cash.db-spec.ts`'s header.
      { appTimezone: 'Europe/Kyiv' },
    );
    return { service, builder, repo };
  };

  const query = (over: Record<string, unknown> = {}) => ({
    page: 1,
    limit: 20,
    include_voided: false,
    ...over,
  });

  it('pins an operator to their own point regardless of the query', async () => {
    const { service, builder } = build();
    await service.list(operatorA, query({ collection_point_id: 'point-b' }) as never);

    expect(builder.andWhere).toHaveBeenCalledWith('t.collection_point_id = :pointId', {
      pointId: 'point-a',
    });
  });

  it('hides voided transfers by default', async () => {
    const { service, builder } = build();
    await service.list(owner, query() as never);
    expect(builder.andWhere).toHaveBeenCalledWith('t.voided_at IS NULL');
  });

  it('filters the date range on sent_at, never on accepted_date', async () => {
    const { service, builder } = build();
    await service.list(owner, query({ from: '2026-09-01', to: '2026-09-09' }) as never);

    const clauses = builder.andWhere.mock.calls.map((c) => String(c[0]));
    expect(clauses.some((c) => c.includes('t.sent_at') && c.includes(':from'))).toBe(true);
    expect(clauses.some((c) => c.includes('accepted_date'))).toBe(false);
  });

  it('resolves the date range in APP_TIMEZONE, not the session zone', async () => {
    const { service, builder } = build();
    await service.list(owner, query({ from: '2026-09-10', to: '2026-09-10' }) as never);

    // BOTH BOUNDS, not just one. `sent_at` is a `timestamptz` and spec §4
    // filters on its LOCAL date; without the cast a transfer dispatched at
    // 01:00 Kyiv is stored at 22:00Z the previous day and drops out of its own
    // day's page whenever the session zone is not the app's.
    const dateClauses = builder.andWhere.mock.calls
      .map((c) => String(c[0]))
      .filter((c) => c.includes('t.sent_at'));
    expect(dateClauses).toHaveLength(2);
    for (const clause of dateClauses) {
      expect(clause).toContain('AT TIME ZONE');
    }

    // The zone reaches the query as a BIND, never spliced into the SQL.
    const bound = builder.andWhere.mock.calls.map((c) => c[1] as Record<string, unknown>);
    expect(bound.some((b) => b?.tz === 'Europe/Kyiv')).toBe(true);
  });

  it("findOne is a 404 for another point's transfer", async () => {
    const { service } = build({ id: 't-1', collection_point_id: 'point-b' });
    await expect(service.findOne(operatorA, 't-1')).rejects.toThrow(NotFoundException);
  });
});
