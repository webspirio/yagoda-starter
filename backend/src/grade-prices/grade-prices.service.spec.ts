import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import { GradePricesService } from './grade-prices.service';

const POINT_A = '11111111-1111-1111-1111-111111111111';
const POINT_B = '22222222-2222-2222-2222-222222222222';
const GRADE = '33333333-3333-3333-3333-333333333333';

const owner = { sub: 'u-owner', username: 'owner', role: UserRole.NetworkOwner, collection_point_id: null };
const operator = { sub: 'u-op', username: 'op', role: UserRole.PointOperator, collection_point_id: POINT_A };

describe('GradePricesService', () => {
  let repo: {
    findAndCount: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    manager: { query: jest.Mock };
  };
  let points: { findOneRaw: jest.Mock };
  let grades: { findOneRaw: jest.Mock };
  let service: GradePricesService;

  const price = (over: Record<string, unknown> = {}) => ({
    id: 'gp-1',
    collection_point_id: POINT_A,
    product_grade_id: GRADE,
    base_price: '52.00',
    max_markup: '30.00',
    max_discount: '20.00',
    created_by_user_id: 'u-owner',
    reason: null,
    created_at: new Date('2026-07-15T07:10:00.000Z'),
    ...over,
  });

  const dto = {
    collection_point_id: POINT_A,
    product_grade_id: GRADE,
    base_price: '52.00',
    max_markup: '30.00',
    max_discount: '20.00',
  };

  beforeEach(() => {
    repo = {
      findAndCount: jest.fn().mockResolvedValue([[price()], 1]),
      save: jest.fn().mockImplementation((p) => Promise.resolve(p)),
      create: jest.fn().mockImplementation((p) => price(p)),
      manager: {
        query: jest
          .fn()
          .mockResolvedValueOnce([{ count: 1 }])
          .mockResolvedValueOnce([price()]),
      },
    };
    points = { findOneRaw: jest.fn().mockResolvedValue({ id: POINT_A, is_active: true }) };
    grades = { findOneRaw: jest.fn().mockResolvedValue({ id: GRADE, is_active: true }) };
    service = new GradePricesService(repo as never, points as never, grades as never);
  });

  describe('create', () => {
    it('records the author from the token, never from the body', async () => {
      await service.create(owner, { ...dto } as never);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ created_by_user_id: 'u-owner' }),
      );
    });

    it('stores all three numbers as the strings it was given', async () => {
      const result = await service.create(owner, { ...dto } as never);
      expect(result.base_price).toBe('52.00');
      expect(result.max_markup).toBe('30.00');
      expect(result.max_discount).toBe('20.00');
      expect(typeof result.base_price).toBe('string');
    });

    it('404s on an unknown collection point', async () => {
      points.findOneRaw.mockResolvedValue(null);
      await expect(service.create(owner, { ...dto } as never)).rejects.toThrow(NotFoundException);
    });

    it('404s on an unknown grade', async () => {
      grades.findOneRaw.mockResolvedValue(null);
      await expect(service.create(owner, { ...dto } as never)).rejects.toThrow(NotFoundException);
    });

    it('REJECTS an inactive grade rather than silently skipping it', async () => {
      // A silently-dropped grade looks exactly like success, which is the
      // failure mode worth a test.
      grades.findOneRaw.mockResolvedValue({ id: GRADE, is_active: false });
      await expect(service.create(owner, { ...dto } as never)).rejects.toThrow(BadRequestException);
    });

    it('refuses an operator entirely — the route is owner-only, but the service says so too', async () => {
      await expect(
        service.create(operator, { ...dto, collection_point_id: POINT_B } as never),
      ).rejects.toThrow(ForbiddenException);
    });

    it('never updates an existing row — a correction is a new row (§4.2)', async () => {
      await service.create(owner, { ...dto } as never);
      await service.create(owner, { ...dto, base_price: '55.00' } as never);
      expect(repo.save).toHaveBeenCalledTimes(2);
      expect(repo.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('currentFor', () => {
    it('returns the newest row for the pair', async () => {
      repo.manager.query = jest.fn().mockResolvedValue([price({ base_price: '150.00' })]);

      const found = await service.currentFor(POINT_A, GRADE);

      expect(found?.base_price).toBe('150.00');
      // The ORDER BY is what makes "newest" true; assert it is in the SQL so a
      // rewrite cannot quietly return an arbitrary row.
      const [sql] = (repo.manager.query as jest.Mock).mock.calls[0] as [string];
      expect(sql).toMatch(/ORDER BY[\s\S]*created_at DESC/);
    });

    it('returns null for a pair that has never been priced', async () => {
      repo.manager.query = jest.fn().mockResolvedValue([]);

      await expect(service.currentFor(POINT_A, GRADE)).resolves.toBeNull();
    });

    it('keys on the PAIR, so another point’s price cannot leak in', async () => {
      // §4.8 — the склад runs its own, higher list. Keying on the grade alone
      // would let a warehouse price land on a roadside intake.
      repo.manager.query = jest.fn().mockResolvedValue([]);

      await service.currentFor(POINT_A, GRADE);

      const [sql, params] = (repo.manager.query as jest.Mock).mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/collection_point_id = \$1/);
      expect(params).toEqual([POINT_A, GRADE]);
    });

    it('filters out an inactive grade in SQL (§4.5)', async () => {
      repo.manager.query = jest.fn().mockResolvedValue([]);

      await service.currentFor(POINT_A, GRADE);

      const [sql] = (repo.manager.query as jest.Mock).mock.calls[0] as [string];
      expect(sql).toMatch(/pg\.is_active = true/);
    });
  });

  describe('current', () => {
    it('pins an operator to their own point', async () => {
      await service.current(operator, { page: 1, limit: 100, collection_point_id: POINT_B } as never);
      const [, params] = repo.manager.query.mock.calls[0];
      expect(params).toContain(POINT_A);
      expect(params).not.toContain(POINT_B);
    });

    // THESE THREE ASSERT GENERATED SQL TEXT, NOT BEHAVIOUR, and their names
    // say so on purpose. `/DISTINCT ON/` still matches under `DISTINCT ON
    // (gp.product_grade_id)` — the exact bug that would leak another point's
    // price — so a name like "each grade appears once" would promise a
    // guarantee this layer cannot give. They are change-detectors against a
    // mocked query; the behaviour they gesture at is proven over real Postgres
    // in `pipeline.db-spec.ts` («keys DISTINCT ON on the (point, grade) pair»
    // and «drops a deactivated grade from /current»).
    it('emits a DISTINCT ON clause keyed on the point/grade pair', async () => {
      await service.current(operator, { page: 1, limit: 100 } as never);
      const [sql] = repo.manager.query.mock.calls[0];
      expect(sql).toMatch(/DISTINCT ON \(gp\.collection_point_id, gp\.product_grade_id\)/i);
      expect(sql).toMatch(/created_at DESC/i);
    });

    it('emits the pg.is_active predicate by default', async () => {
      await service.current(operator, { page: 1, limit: 100 } as never);
      const [sql] = repo.manager.query.mock.calls[0];
      expect(sql).toMatch(/pg\.is_active = true/);
    });

    it('omits the pg.is_active predicate when include_inactive is set', async () => {
      await service.current(operator, { page: 1, limit: 100, include_inactive: true } as never);
      const [sql] = repo.manager.query.mock.calls[0];
      expect(sql).not.toMatch(/pg\.is_active = true/);
    });

    it('returns the Paginated envelope with a real total', async () => {
      const result = await service.current(operator, { page: 1, limit: 100 } as never);
      expect(result).toMatchObject({ total: 1, page: 1, limit: 100 });
      expect(result.data).toHaveLength(1);
    });
  });

  describe('list (the journal)', () => {
    it('orders newest first, breaking ties on id', async () => {
      // The `id` half is not decoration: `created_at` defaults to `now()`,
      // which is transaction start time, so every row §4.8's bulk gesture
      // writes in one transaction will share a timestamp exactly.
      await service.list(owner, { page: 1, limit: 20 } as never);
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ order: { created_at: 'DESC', id: 'DESC' } }),
      );
    });

    it('pins an operator to their own point', async () => {
      await service.list(operator, { page: 1, limit: 20, collection_point_id: POINT_B } as never);
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ collection_point_id: POINT_A }) }),
      );
    });

    it('filters by grade when asked', async () => {
      await service.list(owner, { page: 1, limit: 20, product_grade_id: GRADE } as never);
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ product_grade_id: GRADE }) }),
      );
    });
  });
});
