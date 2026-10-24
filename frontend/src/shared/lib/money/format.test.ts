import { describe, it, expect, vi } from 'vitest';
import {
  formatUah,
  formatKg,
  formatUahPerKg,
  formatDecimal,
  formatCount,
  toDecimalField,
  unbreakable,
} from './format';
import { maskDecimalInput, parseDecimal } from './input';

describe('money/weight formatting (strings in, strings out)', () => {
  it('groups thousands with a narrow no-break space and uses a decimal comma in uk', () => {
    expect(formatDecimal('12658.50', 'uk')).toBe('12 658,50');
    expect(formatUah('12658.50', 'uk')).toBe('12 658,50 ₴');
    expect(formatKg('40.60', 'uk')).toBe('40,60 кг');
    expect(formatKg('40.60', 'en')).toBe('40.60 kg');
  });
  it('keeps the sign and pads to two decimals', () => {
    expect(formatUah('-1.5', 'uk')).toBe('−1,50 ₴'); // typographic minus U+2212
    expect(formatUah('7', 'uk')).toBe('7,00 ₴');
  });
  it('formats en with a comma group and a dot decimal', () => {
    expect(formatUah('12658.50', 'en')).toBe('12,658.50 ₴');
  });
});

// «Завжди показуй одиниці вимірювання до цифр» (2026-10-24): a formula's price
// operand carries ₴/кг like its money and weight operands carry ₴ and кг.
describe('formatUahPerKg', () => {
  it('prints a price per kilogram with the locale’s kilogram unit', () => {
    expect(formatUahPerKg('189.42', 'uk')).toBe('189,42 ₴/кг');
    expect(formatUahPerKg('1189.42', 'en')).toBe('1,189.42 ₴/kg');
  });
});

describe('unbreakable', () => {
  it('joins a figure to its unit with a no-break space, so a wrapped formula never strands the unit', () => {
    expect(unbreakable(formatUahPerKg('189.42', 'uk'))).toBe('189,42\u00a0₴/кг');
    expect(unbreakable('1,20 кг тара')).toBe('1,20\u00a0кг\u00a0тара');
  });
});

describe('formatDecimal — caches the separators per locale', () => {
  it('constructs Intl.NumberFormat once per locale, not once per call', () => {
    // Fresh locales, not touched by any other test in this file/module
    // instance, so the cache starts genuinely empty for both.
    const spy = vi.spyOn(Intl, 'NumberFormat');

    formatDecimal('1.00', 'fr-FR');
    formatDecimal('2000.00', 'fr-FR');
    formatDecimal('3.00', 'de-DE');

    expect(spy).toHaveBeenCalledTimes(2); // one construction per distinct locale
    expect(spy.mock.calls.map((call) => call[0])).toEqual(['fr-FR', 'de-DE']);

    spy.mockRestore();
  });
});

// A crate count, a receipt count: whole numbers, grouped like money, no decimals.
describe('formatCount', () => {
  it('groups thousands and keeps no decimals', () => {
    expect(formatCount(1250, 'uk')).toBe('1\u202f250');
    expect(formatCount(7, 'uk')).toBe('7');
    expect(formatCount(12500, 'en')).toBe('12,500');
  });
  it('prints a negative with the typographic minus', () => {
    expect(formatCount(-14, 'uk')).toBe('−14');
  });
  it('refuses a fractional count — that is a caller bug', () => {
    expect(() => formatCount(1.5)).toThrow();
  });
});

describe('toDecimalField — a server value as a prefilled field shows it', () => {
  it('swaps the canonical dot for the uk decimal comma', () => {
    expect(toDecimalField('500.00', 'uk')).toBe('500,00');
    expect(toDecimalField('1234.5', 'uk')).toBe('1234,5');
    expect(toDecimalField('500.00')).toBe('500,00'); // uk is the default
  });
  it('leaves en (dot decimal) unchanged', () => {
    expect(toDecimalField('1234.50', 'en')).toBe('1234.50');
  });
  it('never groups thousands — the field mask must accept what it is given', () => {
    expect(toDecimalField('12345678.90', 'uk')).toBe('12345678,90');
    expect(maskDecimalInput(toDecimalField('12345678.90', 'uk'))).toBe('12345678.90');
  });
  it('keeps a whole number and an ASCII minus as they are', () => {
    expect(toDecimalField('0', 'uk')).toBe('0');
    expect(toDecimalField('-5.50', 'uk')).toBe('-5,50');
  });
  it('passes an empty or non-canonical value through untouched', () => {
    expect(toDecimalField('', 'uk')).toBe('');
    expect(toDecimalField('abc', 'uk')).toBe('abc');
  });
  it('round-trips through parseDecimal to the canonical form', () => {
    expect(parseDecimal(toDecimalField('10944.00', 'uk'))).toBe('10944.00');
  });
});
