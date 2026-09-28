import { ConflictException } from '@nestjs/common';
import { translateUniqueViolation } from './unique-violation';

const conflict = () => new ConflictException({ message: 'taken', code: 'X_TAKEN' });

describe('translateUniqueViolation', () => {
  it("turns a 23505 on the named constraint into the caller's conflict", () => {
    const out = translateUniqueViolation({ code: '23505', constraint: 'UQ_x' }, 'UQ_x', conflict);
    expect(out).toBeInstanceOf(ConflictException);
    expect((out as ConflictException).getResponse()).toEqual({ message: 'taken', code: 'X_TAKEN' });
  });

  it('passes a 23505 on another constraint through unchanged', () => {
    const err = { code: '23505', constraint: 'UQ_other' };
    expect(translateUniqueViolation(err, 'UQ_x', conflict)).toBe(err);
  });

  it('passes any other error through unchanged', () => {
    const err = new Error('boom');
    expect(translateUniqueViolation(err, 'UQ_x', conflict)).toBe(err);
  });

  it('tolerates a null or non-object error', () => {
    expect(translateUniqueViolation(null, 'UQ_x', conflict)).toBeNull();
    expect(translateUniqueViolation('x', 'UQ_x', conflict)).toBe('x');
  });
});
