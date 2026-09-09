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

  beforeEach(() => {
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      save: jest.fn().mockImplementation((s) => Promise.resolve(shift(s))),
      create: jest.fn().mockImplementation((s) => shift(s)),
      createQueryBuilder: jest.fn(),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    time = {
      now: jest.fn().mockReturnValue(DateTime.fromISO('2026-09-08T07:30', { zone: 'Europe/Kyiv' })),
    };
    service = new ShiftsService(repo as never, {} as never, audit as never, time as never);
  });

  describe('open', () => {
    it('derives business_date from TimeService in the app zone, not from a request', async () => {
      // foundation §5.2 — server-derived, never editable. There is no DTO on
      // this route at all, so there is nothing a caller could smuggle in.
      await service.open(operator);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ business_date: '2026-09-08' }),
      );
    });

    it('files a 23:30 Kyiv shift under that day, not the UTC next day', async () => {
      // The whole reason APP_TIMEZONE is load-bearing from this slice onward:
      // under UTC this shift, and every document in it, files under the 9th.
      time.now.mockReturnValue(DateTime.fromISO('2026-09-08T23:30', { zone: 'Europe/Kyiv' }));

      await service.open(operator);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ business_date: '2026-09-08' }),
      );
    });

    it('always takes the point from the operator token', async () => {
      // §10.3 — the owner has no open verb at all, so there is no body point to
      // validate and no `resolveWritePoint` call here.
      await service.open(operator);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ collection_point_id: POINT_A, opened_by_user_id: 'u-op' }),
      );
    });

    it('refuses an actor with no point rather than opening one nowhere', async () => {
      // CHK_users_role_point should make this unreachable and the guard should
      // stop an owner earlier still; this is what happens if both ever fail.
      await expect(service.open(owner)).rejects.toThrow(ForbiddenException);
    });

    it('translates a 23505 on the partial index into a readable 409', async () => {
      repo.save.mockRejectedValue({ code: '23505', constraint: 'UQ_shifts_open_per_point' });

      await expect(service.open(operator)).rejects.toMatchObject({
        response: { code: 'SHIFT_ALREADY_OPEN' },
      });
    });

    it('translates a 23505 on the day index into a DIFFERENT 409', async () => {
      // Two constraints, two causes, two remedies: «close the open one» versus
      // «ask the owner to reopen today's». One message for both would send the
      // operator down the wrong path with cars waiting.
      repo.save.mockRejectedValue({ code: '23505', constraint: 'UQ_shifts_point_business_date' });

      await expect(service.open(operator)).rejects.toMatchObject({
        response: { code: 'SHIFT_DAY_ALREADY_USED' },
      });
    });

    it('audits shift.opened', async () => {
      await service.open(operator);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'shift.opened', actor_id: 'u-op' }),
      );
    });
  });

  describe('close', () => {
    it('stamps closed_at, closed_by and status', async () => {
      repo.findOne.mockResolvedValue(shift());

      await service.close(operator, SHIFT_ID);

      expect(repo.save).toHaveBeenCalledWith(
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

      await service.close(operator, SHIFT_ID);

      const saved = repo.save.mock.calls[0][0] as { status: ShiftStatus; explanation: unknown };
      expect(saved.status).toBe(ShiftStatus.Closed);
      expect(saved.explanation).toBeNull();
    });

    it('409s an already closed shift', async () => {
      repo.findOne.mockResolvedValue(
        shift({ closed_at: new Date(), closed_by_user_id: 'u-op', status: ShiftStatus.Closed }),
      );

      await expect(service.close(operator, SHIFT_ID)).rejects.toThrow(ConflictException);
    });

    it('404s another point’s shift', async () => {
      repo.findOne.mockResolvedValue(shift());

      await expect(service.close(otherOperator, SHIFT_ID)).rejects.toThrow(NotFoundException);
    });

    it('closes a stale shift from a previous day without complaint', async () => {
      // The forgotten-close path: Friday's shift closed on Saturday morning.
      // `close` must not read business_date at all — that is what makes this
      // work, and it is why the assertion is on the absence of a refusal.
      repo.findOne.mockResolvedValue(shift({ business_date: '2026-09-04' }));

      await expect(service.close(operator, SHIFT_ID)).resolves.toBeDefined();
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

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          closed_at: null,
          closed_by_user_id: null,
          status: ShiftStatus.Open,
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'shift.reopened', note: 'закрив помилково' }),
      );
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
