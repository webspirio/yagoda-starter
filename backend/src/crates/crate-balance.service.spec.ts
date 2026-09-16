import { CrateBalanceService } from './crate-balance.service';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';
import { UserRole } from '../users/user-role.enum';

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
  collection_point_id: 'point-1',
};

describe('CrateBalanceService lists', () => {
  const qb = () => {
    const b: {
      innerJoinAndMapOne: jest.Mock;
      andWhere: jest.Mock;
      orderBy: jest.Mock;
      addOrderBy: jest.Mock;
      skip: jest.Mock;
      take: jest.Mock;
      getManyAndCount: jest.Mock;
    } = {
      innerJoinAndMapOne: jest.fn(() => b),
      andWhere: jest.fn(() => b),
      orderBy: jest.fn(() => b),
      addOrderBy: jest.fn(() => b),
      skip: jest.fn(() => b),
      take: jest.fn(() => b),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    return b;
  };

  const build = () => {
    const issuanceBuilder = qb();
    const returnBuilder = qb();
    const issuances = { createQueryBuilder: jest.fn(() => issuanceBuilder) };
    const returns = { createQueryBuilder: jest.fn(() => returnBuilder) };
    const allocations = { find: jest.fn().mockResolvedValue([]) };
    const dataSource = { manager: { query: jest.fn().mockResolvedValue([]) } };

    const service = new CrateBalanceService(
      dataSource as never,
      issuances as never,
      returns as never,
      allocations as never,
    );
    return { service, issuanceBuilder, returnBuilder, allocations };
  };

  describe('listIssuances', () => {
    it('pins an operator to their own point whatever they ask for', async () => {
      const { service, issuanceBuilder } = build();
      await service.listIssuances(operator, {
        page: 1,
        limit: 20,
        collection_point_id: 'point-9',
      } as never);

      expect(issuanceBuilder.andWhere).toHaveBeenCalledWith('s.collection_point_id = :pointId', {
        pointId: 'point-1',
      });
    });

    it('hides voided rows unless asked', async () => {
      const { service, issuanceBuilder } = build();
      await service.listIssuances(owner, { page: 1, limit: 20 } as never);
      expect(issuanceBuilder.andWhere).toHaveBeenCalledWith('i.voided_at IS NULL');
    });

    /** The owner's voided-deposit list (spec §7, decision 10's second guard). */
    it('can list ONLY voided deposit issuances', async () => {
      const { service, issuanceBuilder } = build();
      await service.listIssuances(owner, {
        page: 1,
        limit: 20,
        voided: true,
        mode: CrateIssuanceMode.Deposit,
      } as never);

      expect(issuanceBuilder.andWhere).toHaveBeenCalledWith('i.voided_at IS NOT NULL');
      expect(issuanceBuilder.andWhere).toHaveBeenCalledWith('i.mode = :mode', {
        mode: CrateIssuanceMode.Deposit,
      });
    });

    /** Ticket #58 — «показати усі розписки постачальника в його аккаунті». */
    it('filters by supplier and mode together', async () => {
      const { service, issuanceBuilder } = build();
      await service.listIssuances(owner, {
        page: 1,
        limit: 20,
        supplier_id: 's-1',
        mode: CrateIssuanceMode.Receipt,
      } as never);

      expect(issuanceBuilder.andWhere).toHaveBeenCalledWith('i.supplier_id = :supplierId', {
        supplierId: 's-1',
      });
    });

    it('orders newest-first then by id', async () => {
      const { service, issuanceBuilder } = build();
      await service.listIssuances(owner, { page: 1, limit: 20 } as never);

      expect(issuanceBuilder.orderBy).toHaveBeenCalledWith('i.created_at', 'DESC');
      expect(issuanceBuilder.addOrderBy).toHaveBeenCalledWith('i.id', 'ASC');
    });
  });

  describe('listReturns', () => {
    it('pins an operator to their own point whatever they ask for', async () => {
      const { service, returnBuilder } = build();
      await service.listReturns(operator, {
        page: 1,
        limit: 20,
        collection_point_id: 'point-9',
      } as never);

      expect(returnBuilder.andWhere).toHaveBeenCalledWith('s.collection_point_id = :pointId', {
        pointId: 'point-1',
      });
    });

    it('hides voided rows unless asked, and can list ONLY voided ones', async () => {
      const { service: service1, returnBuilder } = build();
      await service1.listReturns(owner, { page: 1, limit: 20 } as never);
      expect(returnBuilder.andWhere).toHaveBeenCalledWith('r.voided_at IS NULL');

      const { service: service2, returnBuilder: builder2 } = build();
      await service2.listReturns(owner, { page: 1, limit: 20, voided: true } as never);
      expect(builder2.andWhere).toHaveBeenCalledWith('r.voided_at IS NOT NULL');
    });

    it('filters by supplier', async () => {
      const { service, returnBuilder } = build();
      await service.listReturns(owner, { page: 1, limit: 20, supplier_id: 's-1' } as never);
      expect(returnBuilder.andWhere).toHaveBeenCalledWith('r.supplier_id = :supplierId', {
        supplierId: 's-1',
      });
    });

    /**
     * THE N+1 GUARD. Allocations for the WHOLE PAGE come from one `find`
     * call, and issuance info for the WHOLE PAGE from one `dataSource.manager.
     * query` call — neither may grow with the number of rows on the page.
     */
    it('loads allocations and issuance info in ONE query each, not per row', async () => {
      const { returnBuilder, allocations } = build();
      const fixtureShift = {
        collection_point_id: 'point-1',
        business_date: '2026-09-15',
      };
      const page = [
        {
          id: 'r-1',
          supplier_id: 's-1',
          units: 5,
          deposit_refund: '0.00',
          created_at: new Date(),
          shift: fixtureShift,
        },
        {
          id: 'r-2',
          supplier_id: 's-1',
          units: 3,
          deposit_refund: '0.00',
          created_at: new Date(),
          shift: fixtureShift,
        },
        {
          id: 'r-3',
          supplier_id: 's-1',
          units: 2,
          deposit_refund: '0.00',
          created_at: new Date(),
          shift: fixtureShift,
        },
      ];
      returnBuilder.getManyAndCount.mockResolvedValue([page, 3]);
      allocations.find.mockResolvedValue([
        { return_id: 'r-1', issuance_id: 'i-1', units: 5, per_unit: '10.00', amount: '50.00' },
        { return_id: 'r-2', issuance_id: 'i-1', units: 3, per_unit: '10.00', amount: '30.00' },
        { return_id: 'r-3', issuance_id: 'i-2', units: 2, per_unit: '0.00', amount: '0.00' },
      ]);
      const dataSource = {
        manager: {
          query: jest.fn().mockResolvedValue([
            { issuance_id: 'i-1', mode: CrateIssuanceMode.Deposit, code: 'X-CD-1' },
            { issuance_id: 'i-2', mode: CrateIssuanceMode.Receipt, code: 'X-CR-2' },
          ]),
        },
      };
      const issuances = { createQueryBuilder: jest.fn() };
      const service2 = new CrateBalanceService(
        dataSource as never,
        issuances as never,
        { createQueryBuilder: jest.fn(() => returnBuilder) } as never,
        allocations as never,
      );

      await service2.listReturns(owner, { page: 1, limit: 20 } as never);

      expect(allocations.find).toHaveBeenCalledTimes(1);
      expect(dataSource.manager.query).toHaveBeenCalledTimes(1);
    });
  });
});
