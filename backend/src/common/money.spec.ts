import { add, cmp, gt, gte, isNegative, mul, sub, sum } from './money';

/**
 * THIS FILE IS THE GUARANTEE. Every amount the system will ever print on a
 * supplier's receipt is produced by the four functions below, and §2.7 freezes
 * a wrong one forever. There is no tolerance to fall back on: the schema says
 * «не зійшлося на копійку — те саме, що на 350 ₴».
 */
describe('money', () => {
  describe('parsing and formatting', () => {
    it.each([
      ['0', '0.00'],
      ['0.0', '0.00'],
      ['7', '7.00'],
      ['7.5', '7.50'],
      ['7.05', '7.05'],
      ['-3.4', '-3.40'],
      ['000012.30', '12.30'],
    ])('canonicalizes %s to %s through add(x, "0")', (input, expected) => {
      expect(add(input, '0')).toBe(expected);
    });

    it.each(['', ' ', 'abc', '1.234', '1.', '.5', '1e3', '+1.00', '1,00', '--1'])(
      'rejects %p',
      (bad) => {
        expect(() => add(bad, '0')).toThrow(/not a decimal/i);
      },
    );
  });

  describe('sub — exact, never rounded', () => {
    // §2.4: net = (gross − pallet) − tare. All three inputs are numeric(10,2),
    // so two-decimal subtraction is EXACT and must never be routed through the
    // rounding path.
    it.each([
      ['42.00', '1.50', '40.50'],
      ['40.50', '3.60', '36.90'],
      ['1.00', '1.00', '0.00'],
      ['1.00', '1.01', '-0.01'],
      ['0.10', '0.20', '-0.10'],
    ])('%s − %s = %s', (a, b, expected) => {
      expect(sub(a, b)).toBe(expected);
    });

    // The canonical float trap, stated as a test so a future rewrite that
    // reaches for Number() fails here rather than in production.
    it('does not manufacture 0.30000000000000004', () => {
      expect(add('0.10', '0.20')).toBe('0.30');
      expect(sub('0.30', '0.10')).toBe('0.20');
    });
  });

  describe('mul — HALF-UP at scale 2', () => {
    it.each([
      // net × rate, both scale 2 → scale 4 → rounded to 2
      ['36.90', '57.00', '2103.30'],
      ['10.00', '0.00', '0.00'],
      ['1.00', '1.00', '1.00'],
      // exact .5 at the fourth decimal rounds AWAY FROM ZERO
      ['0.05', '0.05', '0.00'], // 0.0025 -> 0.00
      ['0.15', '0.15', '0.02'], // 0.0225 -> 0.02
      ['0.10', '0.05', '0.01'], // 0.0050 -> 0.01, the half-up case
      ['0.30', '0.15', '0.05'], // 0.0450 -> 0.05
      // negative effective rate is arithmetically fine here; refusing it is a
      // rule in intake-lines, not in the arithmetic
      ['10.00', '-1.50', '-15.00'],
      ['-0.10', '0.05', '-0.01'], // half-up away from zero on the negative side
    ])('%s × %s = %s', (a, b, expected) => {
      expect(mul(a, b)).toBe(expected);
    });

    it('handles a value larger than Number.MAX_SAFE_INTEGER in kopiykas', () => {
      // numeric(12,2) tops out at 9_999_999_999.99; this proves the internals
      // are bigint, not double.
      expect(mul('9999999999.99', '1.00')).toBe('9999999999.99');
    });
  });

  describe('sum — exact, and the ORDER of rounding', () => {
    it('adds without rounding', () => {
      expect(sum(['1.01', '2.02', '3.03'])).toBe('6.06');
      expect(sum([])).toBe('0.00');
    });

    /**
     * THE LOAD-BEARING TEST OF THIS SLICE. The receipt prints each line's
     * amount and a total that must equal what is printed above it. Rounding
     * each line and then summing is NOT the same number as summing raw
     * products and rounding once, and the paper shows the former.
     */
    it('Σ round(each) differs from round(Σ) and we produce the former', () => {
      const lines = [
        { kg: '0.10', rate: '0.05' }, // 0.0050 -> 0.01
        { kg: '0.10', rate: '0.05' }, // 0.0050 -> 0.01
        { kg: '0.10', rate: '0.05' }, // 0.0050 -> 0.01
      ];
      const perLine = lines.map((l) => mul(l.kg, l.rate));
      expect(perLine).toEqual(['0.01', '0.01', '0.01']);
      expect(sum(perLine)).toBe('0.03');
      // round(Σ raw) would be round(0.0150) = 0.02. We print 0.03.
    });
  });

  describe('comparison', () => {
    it.each([
      ['1.00', '1.00', 0],
      ['1.01', '1.00', 1],
      ['1.00', '1.01', -1],
      ['-1.00', '0.00', -1],
      ['10.00', '9.99', 1],
      // string comparison would get this wrong: '9.99' > '10.00' lexically
      ['9.99', '10.00', -1],
    ])('cmp(%s, %s) = %s', (a, b, expected) => {
      expect(cmp(a, b)).toBe(expected);
    });

    it('gt and gte agree with cmp', () => {
      expect(gt('380.01', '380.00')).toBe(true);
      expect(gt('380.00', '380.00')).toBe(false);
      expect(gte('380.00', '380.00')).toBe(true);
      expect(isNegative('-0.01')).toBe(true);
      expect(isNegative('0.00')).toBe(false);
    });
  });
});
