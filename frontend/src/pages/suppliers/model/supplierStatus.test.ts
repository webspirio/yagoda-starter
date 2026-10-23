import { describe, it, expect } from 'vitest';
import { readStatus, statusToUrl } from './supplierStatus';

describe('supplierStatus', () => {
  it('reads nothing or junk as active', () => {
    expect(readStatus(null)).toBe('active');
    expect(readStatus('archived')).toBe('active');
  });

  it('round-trips inactive and all', () => {
    for (const s of ['inactive', 'all'] as const) expect(readStatus(statusToUrl(s))).toBe(s);
  });

  it('writes null for the default, so /suppliers is the default', () => {
    expect(statusToUrl('active')).toBeNull();
  });
});
