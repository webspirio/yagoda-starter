import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListSupplierTotalsQueryDto } from './list-supplier-totals.query';

const parse = (q: Record<string, unknown>) => plainToInstance(ListSupplierTotalsQueryDto, q);
const errors = (q: Record<string, unknown>) => validateSync(parse(q));

describe('ListSupplierTotalsQueryDto', () => {
  it('defaults to sort=weight and leaves order to the query', () => {
    const dto = parse({});
    expect(dto.sort).toBe('weight');
    expect(dto.order).toBeUndefined();
    expect(errors({})).toHaveLength(0);
  });

  it('accepts every sort key and both directions', () => {
    for (const sort of ['weight', 'amount', 'name']) {
      for (const order of ['asc', 'desc']) expect(errors({ sort, order })).toHaveLength(0);
    }
  });

  it('refuses an unknown sort or order rather than silently falling back', () => {
    expect(errors({ sort: 'phone' })).not.toHaveLength(0);
    expect(errors({ order: 'up' })).not.toHaveLength(0);
  });

  it('defaults status to active and accepts all three', () => {
    expect(parse({}).status).toBe('active');
    for (const status of ['active', 'inactive', 'all']) expect(errors({ status })).toHaveLength(0);
  });

  it('refuses an unknown status', () => {
    expect(errors({ status: 'archived' })).not.toHaveLength(0);
  });
});
