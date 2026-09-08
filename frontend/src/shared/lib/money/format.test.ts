import { describe, it, expect } from 'vitest';
import { formatUah, formatKg, formatDecimal } from './format';

describe('money/weight formatting (strings in, strings out)', () => {
  it('groups thousands with a narrow no-break space and uses a decimal comma in uk', () => {
    expect(formatDecimal('12658.50', 'uk')).toBe('12 658,50');
    expect(formatUah('12658.50', 'uk')).toBe('12 658,50 ₴');
    expect(formatKg('40.60', 'uk')).toBe('40,60 кг');
  });
  it('keeps the sign and pads to two decimals', () => {
    expect(formatUah('-1.5', 'uk')).toBe('−1,50 ₴'); // typographic minus U+2212
    expect(formatUah('7', 'uk')).toBe('7,00 ₴');
  });
  it('formats en with a comma group and a dot decimal', () => {
    expect(formatUah('12658.50', 'en')).toBe('12,658.50 ₴');
  });
});
