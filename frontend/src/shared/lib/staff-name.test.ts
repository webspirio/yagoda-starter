import { describe, it, expect } from 'vitest';
import { staffName } from './staff-name';

describe('staffName', () => {
  it('is a dash when there is no staff member', () => {
    expect(staffName(null)).toBe('—');
    expect(staffName(undefined)).toBe('—');
  });
  it('is «Last First»', () => {
    expect(staffName({ first_name: 'Тарас', last_name: 'Бондар' })).toBe('Бондар Тарас');
  });
});
