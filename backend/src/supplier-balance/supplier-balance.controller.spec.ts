import { NotFoundException } from '@nestjs/common';
import { SupplierBalanceController } from './supplier-balance.controller';
import { UserRole } from '../users/user-role.enum';

/**
 * The route is thin on purpose: visibility is `SuppliersService.findOne`'s
 * (404, not 403, for another point's supplier — an operator must not learn
 * that a person exists elsewhere), and the body is the mapper's. Both are
 * asserted here through the controller, with the two services mocked.
 */
const SUPPLIER = '44444444-4444-4444-4444-444444444444';
const operator = {
  sub: 'u-oksana',
  username: 'oksana',
  role: UserRole.PointOperator,
  collection_point_id: '11111111-1111-1111-1111-111111111111',
};

describe('SupplierBalanceController', () => {
  const findOne = jest.fn();
  const breakdownFor = jest.fn();
  const settlementFor = jest.fn();
  const controller = new SupplierBalanceController(
    { breakdownFor } as never,
    { settlementFor } as never,
    { findOne } as never,
  );

  beforeEach(() => {
    findOne.mockReset();
    breakdownFor.mockReset();
    settlementFor.mockReset();
  });

  it('GET /suppliers/:id/settlement 404s through findOne before reading anything', async () => {
    findOne.mockRejectedValue(new NotFoundException());
    await expect(controller.settlement(operator as never, SUPPLIER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(settlementFor).not.toHaveBeenCalled();
  });

  it('GET /suppliers/:id/settlement returns the mapped settlement for a visible supplier', async () => {
    findOne.mockResolvedValue({ id: SUPPLIER });
    settlementFor.mockResolvedValue({
      debt: '0.00',
      unallocated: '0.00',
      lines: [],
      payouts: [],
    });
    await expect(controller.settlement(operator as never, SUPPLIER)).resolves.toEqual({
      supplier_id: SUPPLIER,
      debt: '0.00',
      unallocated: '0.00',
      lines: [],
      payouts: [],
    });
    expect(settlementFor).toHaveBeenCalledWith(SUPPLIER);
  });
});
