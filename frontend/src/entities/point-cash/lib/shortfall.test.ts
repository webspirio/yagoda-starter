import { describe, it, expect } from 'vitest';
import { shortfallTone, formatNullableUah } from './shortfall';

describe('shortfallTone — §7.10\'s amber/leaf convention', () => {
  it('reads amber when the point still owes money (shortfall > 0)', () => {
    expect(shortfallTone('4000.00')).toBe('amber');
  });

  it('reads leaf when the point is settled (shortfall === 0)', () => {
    expect(shortfallTone('0.00')).toBe('leaf');
  });

  it('reads leaf when the point is overfunded (shortfall < 0)', () => {
    expect(shortfallTone('-100.00')).toBe('leaf');
  });

  it('carries no tone at all for a point with no target assigned (§6.9)', () => {
    expect(shortfallTone(null)).toBeNull();
  });
});

describe('formatNullableUah', () => {
  it('prints «—» for null, never a defaulted 0.00 (§6.9)', () => {
    expect(formatNullableUah(null, 'en')).toBe('—');
  });

  it('formats a real value the same way formatUah does', () => {
    expect(formatNullableUah('4000.00', 'en')).toBe('4,000.00 ₴');
  });
});
