import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateReweighItemDto } from './create-reweigh-item.dto';

/**
 * Every weight here is `numeric(10,2)`. With no digit bound, `gross_kg:
 * '9999999999'` reaches Postgres and returns a numeric-field-overflow 500,
 * because this backend maps no `QueryFailedError`. And `units` with no upper
 * bound is worse than it looks: `Number.isInteger(1e21)` is `true`, so
 * `@IsInt()` passes it, `` `${1e21}.00` `` becomes the string `'1e+21.00'`,
 * and `money.parse` throws inside the request — another 500 from a value a
 * regex-shaped 400 should have caught at the edge.
 */
const grade = '11111111-1111-4111-8111-111111111111';
const dtoFor = (patch: Record<string, unknown>): CreateReweighItemDto =>
  plainToInstance(CreateReweighItemDto, {
    product_grade_id: grade,
    gross_kg: '100.00',
    tare: [],
    ...patch,
  });
const errorsFor = (patch: Record<string, unknown>): string[] =>
  validateSync(dtoFor(patch), { whitelist: false }).flatMap((e) => [
    ...Object.keys(e.constraints ?? {}),
    ...(e.children ?? []).flatMap((c) =>
      (c.children ?? []).flatMap((g) => Object.keys(g.constraints ?? {})),
    ),
  ]);

describe('CreateReweighItemDto', () => {
  it('accepts a real line', () => {
    expect(errorsFor({})).toEqual([]);
  });

  it('canonicalises the weights so the echo matches the stored row', () => {
    const dto = dtoFor({ gross_kg: '12.5', pallet_kg: '1' });
    expect(dto.gross_kg).toBe('12.50');
    expect(dto.pallet_kg).toBe('1.00');
  });

  it('REFUSES a gross_kg numeric(10,2) cannot hold — a 400, never an overflow 500', () => {
    expect(errorsFor({ gross_kg: '9999999999' })).toContain('matches');
  });

  it('REFUSES a pallet_kg numeric(10,2) cannot hold', () => {
    expect(errorsFor({ pallet_kg: '9999999999' })).toContain('matches');
  });

  it('REFUSES units: 1e21, which @IsInt alone waves through', () => {
    expect(errorsFor({ tare: [{ tare_type_id: grade, units: 1e21 }] })).toContain('max');
  });
});
