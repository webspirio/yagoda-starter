import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { monthRange, parseFilters } from './journalFilters';

describe('monthRange', () => {
  it('bounds a mid-month date to the first and last day of its month', () => {
    expect(monthRange('2026-09-15')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('bounds the first of the month to itself', () => {
    expect(monthRange('2026-01-01')).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });

  it('resolves February of a leap year to the 29th', () => {
    expect(monthRange('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('resolves February of a non-leap year to the 28th', () => {
    expect(monthRange('2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('resolves December without rolling into next year', () => {
    expect(monthRange('2026-12-25')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('parseFilters', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-08T09:00:00') });
  });

  afterEach(() => vi.useRealTimers());

  it('defaults to the current month, page 1, every id null, and voided included', () => {
    expect(parseFilters(new URLSearchParams())).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      pointId: null,
      supplierId: null,
      includeVoided: true,
      page: 1,
    });
  });

  it('reads a well-formed range, ids and page from the URL', () => {
    const params = new URLSearchParams({
      from: '2026-07-01',
      to: '2026-07-31',
      point: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      supplier: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      page: '3',
    });
    expect(parseFilters(params)).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
      pointId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      supplierId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      includeVoided: true,
      page: 3,
    });
  });

  it('falls back to the current month when only one of from/to is present', () => {
    const params = new URLSearchParams({ from: '2026-07-01' });
    expect(parseFilters(params)).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('falls back to the current month when from/to are shaped right but not real dates', () => {
    const params = new URLSearchParams({ from: '2026-02-31', to: '2026-02-31' });
    expect(parseFilters(params)).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('falls back to the current month when from/to are unparseable garbage', () => {
    const params = new URLSearchParams({ from: 'not-a-date', to: 'also-not-a-date' });
    expect(parseFilters(params)).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('drops a malformed point id rather than passing it through', () => {
    const params = new URLSearchParams({ point: 'garbage' });
    expect(parseFilters(params).pointId).toBeNull();
  });

  it('drops a malformed supplier id rather than passing it through', () => {
    const params = new URLSearchParams({ supplier: '../etc/passwd' });
    expect(parseFilters(params).supplierId).toBeNull();
  });

  it('reads voided=0 as excluding voided documents', () => {
    expect(parseFilters(new URLSearchParams({ voided: '0' })).includeVoided).toBe(false);
  });

  it('treats anything other than voided=0 as including voided documents', () => {
    expect(parseFilters(new URLSearchParams({ voided: '1' })).includeVoided).toBe(true);
    expect(parseFilters(new URLSearchParams({ voided: 'garbage' })).includeVoided).toBe(true);
  });

  it('falls back to page 1 for a malformed page value', () => {
    expect(parseFilters(new URLSearchParams({ page: '0' })).page).toBe(1);
    expect(parseFilters(new URLSearchParams({ page: '-3' })).page).toBe(1);
    expect(parseFilters(new URLSearchParams({ page: 'abc' })).page).toBe(1);
    expect(parseFilters(new URLSearchParams({ page: '2.5' })).page).toBe(1);
  });
});
