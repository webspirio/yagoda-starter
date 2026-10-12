import { describe, it, expect } from 'vitest';
import { cratesRules, decimalRules } from './rules';

describe('cratesRules', () => {
  const rules = cratesRules('crates.error.key');

  it('required is the caller-supplied error key', () => {
    expect(rules.required).toBe('crates.error.key');
  });

  it('validate accepts a non-negative integer', () => {
    expect(rules.validate('120')).toBe(true);
  });

  it('validate trims surrounding whitespace before checking', () => {
    expect(rules.validate(' 7 ')).toBe(true);
  });

  it('validate rejects a decimal crates count with the error key', () => {
    expect(rules.validate('1.5')).toBe('crates.error.key');
  });

  it('validate rejects an empty string with the error key', () => {
    expect(rules.validate('')).toBe('crates.error.key');
  });
});

describe('decimalRules', () => {
  it('uses the one shared key for required and for the shape', () => {
    const rules = decimalRules();
    expect(rules.required).toBe('errors.decimalFormat');
    expect(rules.validate('12.')).toBe('errors.decimalFormat');
    expect(rules.validate('')).toBe('errors.decimalFormat');
    expect(rules.validate('12 000')).toBe(true);
    expect(rules.validate('980,40')).toBe(true);
  });
  it('lets an optional field be empty but not malformed', () => {
    const rules = decimalRules({ required: false });
    expect(rules.required).toBe(false);
    expect(rules.validate('')).toBe(true);
    expect(rules.validate('  ')).toBe(true);
    expect(rules.validate('12.')).toBe('errors.decimalFormat');
  });
  it('stores the canonical form, and a refused text as typed so validate still refuses it', () => {
    const { setValueAs, validate } = decimalRules();
    expect(setValueAs?.('12 000')).toBe('12000');
    expect(setValueAs?.('980,40')).toBe('980.40');
    expect(setValueAs?.('1.2.3')).toBe('1.2.3');
    expect(validate(setValueAs?.('1.2.3') ?? '')).toBe('errors.decimalFormat');
    expect(decimalRules({ allowNegative: true }).setValueAs?.('-2,5')).toBe('-2.5');
  });
  it('allows a minus only when asked', () => {
    expect(decimalRules().validate('-5')).toBe('errors.decimalFormat');
    expect(decimalRules({ allowNegative: true }).validate('-5')).toBe(true);
  });
});
