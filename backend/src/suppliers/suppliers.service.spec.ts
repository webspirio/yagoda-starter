import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import { SuppliersService } from './suppliers.service';
import { SupplierKind } from './supplier-kind.enum';

const POINT_A = '11111111-1111-1111-1111-111111111111';
const POINT_B = '22222222-2222-2222-2222-222222222222';

const owner = { sub: 'u-owner', username: 'owner', role: UserRole.NetworkOwner, collection_point_id: null };
const operator = { sub: 'u-op', username: 'op', role: UserRole.PointOperator, collection_point_id: POINT_A };

describe('SuppliersService', () => {
  let repo: {
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let txRepo: { create: jest.Mock; save: jest.Mock };
  let manager: { getRepository: () => typeof txRepo };
  let audit: { record: jest.Mock };
  let points: { findOneRaw: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let qb: {
    where: jest.Mock; andWhere: jest.Mock; orderBy: jest.Mock; addOrderBy: jest.Mock;
    skip: jest.Mock; take: jest.Mock; getManyAndCount: jest.Mock; getOne: jest.Mock;
  };
  let service: SuppliersService;

  const supplier = (over: Record<string, unknown> = {}) => ({
    id: 's-1',
    collection_point_id: POINT_A,
    first_name: 'Іван',
    last_name: 'Коваль',
    phone: '+380671234567',
    note: null,
    kind: SupplierKind.None,
    is_active: true,
    created_at: new Date('2026-07-15T06:00:00.000Z'),
    updated_at: new Date('2026-07-15T06:00:00.000Z'),
    ...over,
  });

  beforeEach(() => {
    qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[supplier()], 1]),
      getOne: jest.fn().mockResolvedValue(null),
    };
    repo = {
      findAndCount: jest.fn().mockResolvedValue([[supplier()], 1]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((s) => Promise.resolve(s)),
      create: jest.fn().mockImplementation((s) => supplier(s)),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    // A DISTINCT repo standing in for `manager.getRepository(Supplier)`. If it
    // were the same object as `repo`, a regression that escaped the
    // transaction — leaving an audit entry that could survive a rolled-back
    // write — would be invisible.
    txRepo = {
      create: jest.fn().mockImplementation((s) => supplier(s)),
      save: jest.fn().mockImplementation((s) => Promise.resolve(s)),
    };
    manager = { getRepository: () => txRepo };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    points = { findOneRaw: jest.fn().mockResolvedValue({ id: POINT_B, is_active: true }) };
    dataSource = { transaction: jest.fn().mockImplementation((cb) => cb(manager)) };
    service = new SuppliersService(
      repo as never,
      dataSource as never,
      audit as never,
      points as never,
    );
  });

  describe('create', () => {
    const dto = { first_name: ' Іван ', last_name: ' Коваль ', phone: '067 123 45 67' };

    it('derives the point from an OPERATOR and never from the body', async () => {
      await service.create(operator, { ...dto } as never);
      expect(txRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ collection_point_id: POINT_A }),
      );
    });

    it('requires an OWNER to name the point, since an owner has none', async () => {
      await expect(service.create(owner, { ...dto } as never)).rejects.toThrow(BadRequestException);
    });

    it('lets an owner create at any point', async () => {
      await service.create(owner, { ...dto, collection_point_id: POINT_B } as never);
      expect(txRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ collection_point_id: POINT_B }),
      );
    });

    it('404s on a body point that does not exist, rather than 500ing on the FK', async () => {
      // `assertOwnsPoint` is a pure id comparison and no-ops for an owner, so
      // nothing else validates a body-supplied uuid. Without the existence
      // check this reaches `FK_suppliers_point` and the filter — which has no
      // `QueryFailedError` mapping — turns it into a bare 500.
      points.findOneRaw.mockResolvedValue(null);
      await expect(
        service.create(owner, { ...dto, collection_point_id: POINT_B } as never),
      ).rejects.toThrow(NotFoundException);
      expect(txRepo.save).not.toHaveBeenCalled();
    });

    it('does NOT re-read the point for an operator, whose point comes from the token', async () => {
      await service.create(operator, { ...dto } as never);
      expect(points.findOneRaw).not.toHaveBeenCalled();
    });

    it('refuses an operator naming someone else’s point', async () => {
      await expect(
        service.create(operator, { ...dto, collection_point_id: POINT_B } as never),
      ).rejects.toThrow(ForbiddenException);
    });

    it('canonicalizes the phone before saving', async () => {
      await service.create(operator, { ...dto } as never);
      expect(txRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+380671234567' }),
      );
    });

    it('stores a null phone as null — правка 8’s escape hatch', async () => {
      await service.create(operator, { first_name: 'Іван', last_name: 'Коваль' } as never);
      expect(txRepo.create).toHaveBeenCalledWith(expect.objectContaining({ phone: null }));
    });

    it('trims both names', async () => {
      await service.create(operator, { ...dto } as never);
      expect(txRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ first_name: 'Іван', last_name: 'Коваль' }),
      );
    });

    it('rejects an all-whitespace last name with a 400', async () => {
      await expect(
        service.create(operator, { first_name: 'Іван', last_name: '   ' } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('409s when the phone is already used AT THIS POINT', async () => {
      qb.getOne.mockResolvedValue(supplier({ id: 'other' }));
      await expect(service.create(operator, { ...dto } as never)).rejects.toThrow(
        ConflictException,
      );
    });

    it('does NOT run the phone pre-check when there is no phone', async () => {
      await service.create(operator, { first_name: 'Іван', last_name: 'Коваль' } as never);
      expect(qb.getOne).not.toHaveBeenCalled();
    });

    it('writes the audit entry inside the transaction', async () => {
      await service.create(operator, { ...dto } as never);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'supplier.created',
          actor_id: 'u-op',
          target_type: 'supplier',
        }),
        manager,
      );
    });
  });

  describe('update', () => {
    beforeEach(() => repo.findOne.mockResolvedValue(supplier()));

    it('404s on an unknown id', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.update(operator, 's-x', {} as never)).rejects.toThrow(NotFoundException);
    });

    it('refuses an operator touching another point’s supplier', async () => {
      repo.findOne.mockResolvedValue(supplier({ collection_point_id: POINT_B }));
      await expect(service.update(operator, 's-1', { note: 'hi' } as never)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('writes NO audit entry for a no-op PATCH', async () => {
      await service.update(operator, 's-1', {} as never);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('audits only the fields that moved', async () => {
      await service.update(operator, 's-1', { kind: SupplierKind.Wholesale } as never);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'supplier.updated',
          before: { kind: SupplierKind.None },
          after: { kind: SupplierKind.Wholesale },
        }),
        manager,
      );
    });

    it('canonicalizes a changed phone', async () => {
      await service.update(operator, 's-1', { phone: '(050) 987-65-43' } as never);
      expect(txRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+380509876543' }),
      );
    });

    it('accepts an explicit null phone — clearing it is legal', async () => {
      await service.update(operator, 's-1', { phone: null } as never);
      expect(txRepo.save).toHaveBeenCalledWith(expect.objectContaining({ phone: null }));
    });

    it('skips the pre-check when the canonical phone is unchanged', async () => {
      // '067 123 45 67' canonicalizes to the value already stored, so this is
      // not a change and must not 409 against the row itself.
      await service.update(operator, 's-1', { phone: '067 123 45 67' } as never);
      expect(qb.getOne).not.toHaveBeenCalled();
    });

    it('deactivation is never blocked', async () => {
      await expect(
        service.update(operator, 's-1', { is_active: false } as never),
      ).resolves.toBeDefined();
    });
  });

  describe('list', () => {
    it('pins an operator to their own point, ignoring the requested one', async () => {
      await service.list(operator, { page: 1, limit: 20, collection_point_id: POINT_B } as never);
      expect(qb.andWhere).toHaveBeenCalledWith('s.collection_point_id = :pointId', {
        pointId: POINT_A,
      });
    });

    it('lets an owner span every point when none is requested', async () => {
      await service.list(owner, { page: 1, limit: 20 } as never);
      expect(qb.andWhere).not.toHaveBeenCalledWith(
        's.collection_point_id = :pointId',
        expect.anything(),
      );
    });

    it('honours a point an OWNER requests — the reason resolvePointFilter takes two args', async () => {
      // The operator-ignores-it and owner-spans-everything branches are both
      // covered above; this is the branch the second argument exists for, and
      // it had no assertion anywhere.
      await service.list(owner, { page: 1, limit: 20, collection_point_id: POINT_B } as never);
      expect(qb.andWhere).toHaveBeenCalledWith('s.collection_point_id = :pointId', {
        pointId: POINT_B,
      });
    });

    it('hides inactive suppliers by default', async () => {
      await service.list(operator, { page: 1, limit: 20 } as never);
      expect(qb.andWhere).toHaveBeenCalledWith('s.is_active = true');
    });

    it('takes the PHONE lane for a digits-only q, matching on the suffix', async () => {
      // «останні чотири цифри?» is how this is asked out loud.
      await service.list(operator, { page: 1, limit: 20, q: '45 67' } as never);
      expect(qb.andWhere).toHaveBeenCalledWith('s.phone LIKE :phone', { phone: '%4567' });
    });

    it('matches a FULL number exactly, canonicalized', async () => {
      await service.list(operator, { page: 1, limit: 20, q: '067 123 45 67' } as never);
      expect(qb.andWhere).toHaveBeenCalledWith('s.phone = :phone', { phone: '+380671234567' });
    });

    it('takes the NAME lane for anything else, across both name columns', async () => {
      await service.list(operator, { page: 1, limit: 20, q: 'Ковал' } as never);
      expect(qb.andWhere).toHaveBeenCalledWith(
        "(s.first_name ILIKE :q ESCAPE '\\' OR s.last_name ILIKE :q ESCAPE '\\')",
        { q: '%Ковал%' },
      );
    });

    it('escapes a literal % in q rather than letting it wildcard-match everything', async () => {
      await service.list(operator, { page: 1, limit: 20, q: '%' } as never);
      expect(qb.andWhere).toHaveBeenCalledWith(
        "(s.first_name ILIKE :q ESCAPE '\\' OR s.last_name ILIKE :q ESCAPE '\\')",
        { q: '%\\%%' },
      );
    });

    it('escapes a literal _ in q rather than letting it match any single character', async () => {
      await service.list(operator, { page: 1, limit: 20, q: '_' } as never);
      expect(qb.andWhere).toHaveBeenCalledWith(
        "(s.first_name ILIKE :q ESCAPE '\\' OR s.last_name ILIKE :q ESCAPE '\\')",
        { q: '%\\_%' },
      );
    });

    it('ignores a whitespace-only q rather than matching everything', async () => {
      await service.list(operator, { page: 1, limit: 20, q: '   ' } as never);
      expect(qb.andWhere).not.toHaveBeenCalledWith('s.phone LIKE :phone', expect.anything());
      // Matched against what the implementation ACTUALLY emits. The earlier
      // form of this assertion named the pre-ESCAPE SQL string, which the
      // service stopped producing when the escape clause landed — so it
      // passed unconditionally and would not have noticed the name lane
      // running.
      expect(qb.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        expect.anything(),
      );
    });

    it('does NOT throw when a q is an unparseable phone — search is not entry', async () => {
      // A partial number is not a valid phone and must not 400 a SEARCH.
      await expect(
        service.list(operator, { page: 1, limit: 20, q: '4567' } as never),
      ).resolves.toBeDefined();
    });
  });

  describe('findOne', () => {
    it('404s — not 403 — for another point’s supplier', async () => {
      // Deliberate divergence from GET /collection-points/:id, which the
      // foundation follow-ups flag as a weak existence oracle. Suppliers are
      // real people's names and phone numbers.
      repo.findOne.mockResolvedValue(supplier({ collection_point_id: POINT_B }));
      await expect(service.findOne(operator, 's-1')).rejects.toThrow(NotFoundException);
    });

    it('returns the supplier at the caller’s own point', async () => {
      repo.findOne.mockResolvedValue(supplier());
      await expect(service.findOne(operator, 's-1')).resolves.toMatchObject({ id: 's-1' });
    });
  });
});
