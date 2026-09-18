import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CloseShiftDto } from './close-shift.dto';

const validate = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(CloseShiftDto, body)).flatMap((e) =>
    Object.keys(e.constraints ?? {}),
  );

describe('CloseShiftDto.broken_crates', () => {
  const base = { counted_amount: '100.00' };

  it('accepts zero', () => {
    expect(validate({ ...base, broken_crates: 0 })).toEqual([]);
  });

  it('accepts a positive integer', () => {
    expect(validate({ ...base, broken_crates: 3 })).toEqual([]);
  });

  it('rejects a negative count', () => {
    expect(validate({ ...base, broken_crates: -1 })).toContain('min');
  });

  it('rejects a fractional count — crates are whole objects', () => {
    expect(validate({ ...base, broken_crates: 3.5 })).toContain('isInt');
  });

  it('rejects an absent count — a number that can be skipped gets skipped', () => {
    expect(validate(base)).toContain('isInt');
  });
});
