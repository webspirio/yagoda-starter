import { describe, it, expect } from 'vitest';
import { normalizeCode, isValidCode } from './receiptCode';

describe('normalizeCode', () => {
  it('trims and upper-cases', () => {
    expect(normalizeCode(' 00412 ')).toBe('00412');
    expect(normalizeCode('ab-1')).toBe('AB-1');
  });
});

describe('isValidCode', () => {
  it('accepts a code that is valid once normalized', () => {
    expect(isValidCode('ab-1')).toBe(true);
  });

  it('accepts a bare alphanumeric code', () => {
    expect(isValidCode('00412')).toBe(true);
  });

  it('rejects an empty code', () => {
    expect(isValidCode('')).toBe(false);
  });

  it('rejects a code that is only whitespace', () => {
    expect(isValidCode('   ')).toBe(false);
  });

  it('rejects a code over 16 characters', () => {
    expect(isValidCode('a'.repeat(17))).toBe(false);
  });

  it('accepts a code at the 16-character ceiling', () => {
    expect(isValidCode('a'.repeat(16))).toBe(true);
  });

  it('rejects a code starting with a dash', () => {
    expect(isValidCode('-ab1')).toBe(false);
  });
});
