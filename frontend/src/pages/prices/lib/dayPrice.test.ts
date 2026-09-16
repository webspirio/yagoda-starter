import { describe, expect, it } from 'vitest';
import { dayPrice } from './dayPrice';
import type { SheetCell } from '../model/gradePrice';

const cell = (base_price: string): SheetCell => ({
  base_price,
  max_markup: '30.00',
  max_discount: '20.00',
});

describe('dayPrice', () => {
  it('is null when no reception point has a price', () => {
    expect(dayPrice({}, ['a', 'b'])).toBeNull();
  });

  it('reports a common price only when EVERY reception point agrees', () => {
    expect(dayPrice({ a: cell('150.00'), b: cell('150.00') }, ['a', 'b'])).toEqual({
      common: '150.00',
    });
  });

  /**
   * The rule most likely to be "simplified" later: a missing point is a
   * DISAGREEMENT. Pressing «встановити всім» here would change something, so
   * the column must not read as a settled number.
   */
  it('is a RANGE when a point is missing, even though the known ones agree', () => {
    expect(dayPrice({ a: cell('150.00') }, ['a', 'b'])).toEqual({
      min: '150.00',
      max: '150.00',
    });
  });

  it('spans the known values when points disagree', () => {
    expect(dayPrice({ a: cell('145.00'), b: cell('150.00'), c: cell('147.00') }, ['a', 'b', 'c'])).toEqual(
      { min: '145.00', max: '150.00' },
    );
  });

  /**
   * §4.8 — the warehouse is not in `commonPointIds`, so its dearer price must
   * not drag the range. Without this the column would read «різні» on every
   * row forever.
   */
  it('ignores a point that is not in the common set', () => {
    expect(
      dayPrice({ a: cell('150.00'), b: cell('150.00'), warehouse: cell('160.00') }, ['a', 'b']),
    ).toEqual({ common: '150.00' });
  });

  it('compares money as decimal strings, not as floats', () => {
    // Lexicographically '100.00' < '9.90'; numerically it is not. Getting this
    // wrong is invisible until a grade crosses a power of ten.
    expect(dayPrice({ a: cell('9.90'), b: cell('100.00') }, ['a', 'b'])).toEqual({
      min: '9.90',
      max: '100.00',
    });
  });

  it('returns the price verbatim, never reformatted', () => {
    expect(dayPrice({ a: cell('150.00') }, ['a'])).toEqual({ common: '150.00' });
  });

  it('is null when the common set is empty — a network of warehouses only', () => {
    expect(dayPrice({ warehouse: cell('160.00') }, [])).toBeNull();
  });
});
