import { describe, it, expect } from 'vitest';
import { totalToPay, suggestedPaid } from './suggestedPaid';

describe('totalToPay', () => {
  it('is null while the preview has not settled on an accrued amount', () => {
    expect(totalToPay(null, '37.37')).toBeNull();
    expect(totalToPay(null, null)).toBeNull();
  });

  it('adds a positive debt onto the accrual', () => {
    expect(totalToPay('5460.00', '37.37')).toBe('5497.37');
  });

  it('adds nothing for a zero debt', () => {
    expect(totalToPay('5460.00', '0.00')).toBe('5460.00');
  });

  it('adds a NEGATIVE balance signed — «Разом» is the balance (§3.5, 04.09.2026)', () => {
    expect(totalToPay('5460.00', '-250.00')).toBe('5210.00');
  });

  it('may itself be negative — the supplier still owes us after today', () => {
    expect(totalToPay('300.00', '-500.00')).toBe('-200.00');
  });

  it('adds nothing when debt is null (no supplier picked yet)', () => {
    expect(totalToPay('5460.00', null)).toBe('5460.00');
  });
});

describe('suggestedPaid', () => {
  it('is empty while the preview has not settled', () => {
    expect(suggestedPaid(null, '37.37', '1616.10')).toBe('');
  });

  it('is the whole total when the drawer holds enough', () => {
    expect(suggestedPaid('5460.00', '37.37', '9000.00')).toBe('5497.37');
  });

  it('is capped at the drawer when cash is below the total', () => {
    expect(suggestedPaid('5460.00', '37.37', '1616.10')).toBe('1616.10');
  });

  it('is the UNCAPPED total when cash is null (unread or errored), not zero — the server checks the real ceiling', () => {
    expect(suggestedPaid('5460.00', '37.37', null)).toBe('5497.37');
  });

  it('is zero when cash is a GENUINE zero drawer and the total is positive', () => {
    expect(suggestedPaid('5460.00', '37.37', '0.00')).toBe('0.00');
  });

  it('is the total (zero) when the total itself is zero, even with no cash', () => {
    expect(suggestedPaid('0.00', null, null)).toBe('0.00');
  });

  it('is the signed total when the supplier owes us part of today — the server ceiling', () => {
    // 1 000 accrued − 500 they owe = 500, the most the server lets out.
    expect(suggestedPaid('1000.00', '-500.00', '9000.00')).toBe('500.00');
  });

  it('never goes below zero when the supplier still owes us after today', () => {
    expect(suggestedPaid('300.00', '-500.00', '9000.00')).toBe('0.00');
    expect(suggestedPaid('300.00', '-500.00', null)).toBe('0.00');
  });
});
