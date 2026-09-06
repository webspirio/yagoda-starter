import { BadRequestException } from '@nestjs/common';
import { assertTrimmedName } from './trimmed-name';

describe('assertTrimmedName', () => {
  it('trims surrounding whitespace', () => {
    expect(assertTrimmedName('  Копайгород  ', 'name', 'POINT_NAME_EMPTY')).toBe('Копайгород');
  });

  it('does NOT lowercase — a display value keeps what was typed', () => {
    expect(assertTrimmedName('Копайгород', 'name', 'POINT_NAME_EMPTY')).toBe('Копайгород');
  });

  it('rejects an all-whitespace name with the given code', () => {
    expect(() => assertTrimmedName('   ', 'name', 'POINT_NAME_EMPTY')).toThrow(BadRequestException);
    try {
      assertTrimmedName('   ', 'name', 'POINT_NAME_EMPTY');
    } catch (err) {
      expect((err as BadRequestException).getResponse()).toEqual({
        message: 'name cannot be empty or all whitespace',
        code: 'POINT_NAME_EMPTY',
      });
    }
  });
});
