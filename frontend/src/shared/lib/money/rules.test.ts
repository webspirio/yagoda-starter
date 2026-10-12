import { describe, it, expect } from 'vitest';
import { amountRules, cratesRules, decimalRules } from './rules';

describe('amountRules', () => {
  const rules = amountRules('some.error.key');

  it('required is the caller-supplied error key', () => {
    expect(rules.required).toBe('some.error.key');
  });

  it('validate accepts a canonical decimal amount', () => {
    expect(rules.validate('1234.50')).toBe(true);
  });

  it('validate normalizes before checking — a comma decimal and thousands spaces both pass', () => {
    expect(rules.validate('1 234,50')).toBe(true);
  });

  it('validate rejects a malformed amount with the error key', () => {
    expect(rules.validate('12.345')).toBe('some.error.key');
  });

  it('validate rejects an empty string with the error key', () => {
    expect(rules.validate('')).toBe('some.error.key');
  });
});

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
  it('allows a minus only when asked', () => {
    expect(decimalRules().validate('-5')).toBe('errors.decimalFormat');
    expect(decimalRules({ allowNegative: true }).validate('-5')).toBe(true);
  });
});
