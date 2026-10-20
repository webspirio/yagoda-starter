import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CloseShiftDto } from './close-shift.dto';

const validate = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(CloseShiftDto, body)).flatMap((e) =>
    Object.keys(e.constraints ?? {}),
  );

describe('CloseShiftDto.broken_crates', () => {
  const base = { counted_amount: '100.00', counted_deposits: '0.00' };

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

describe('CloseShiftDto.counted_deposits', () => {
  const base = { counted_amount: '100.00', broken_crates: 0 };
  const errorsOn = (body: Record<string, unknown>) =>
    validateSync(plainToInstance(CloseShiftDto, body)).filter(
      (e) => e.property === 'counted_deposits',
    );

  it('rejects an absent figure — a number that can be skipped gets skipped', () => {
    expect(errorsOn(base)).not.toHaveLength(0);
  });

  it('accepts zero, canonicalised to 0.00', () => {
    const dto = plainToInstance(CloseShiftDto, { ...base, counted_deposits: '0' });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.counted_deposits).toBe('0.00');
  });

  it('rejects a decimal comma', () => {
    expect(errorsOn({ ...base, counted_deposits: '1,5' })).not.toHaveLength(0);
  });
});
