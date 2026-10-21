import { describe, it, expect } from 'vitest';
import { DEFAULT_SORT, nextSort, readSort, toUrl } from './supplierSort';

describe('supplier sort', () => {
  it('defaults to heaviest first', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'weight', order: 'desc' });
    expect(readSort(null, null)).toEqual(DEFAULT_SORT);
  });

  it('reads a valid URL pair, and a missing order as the key’s own default', () => {
    expect(readSort('amount', 'asc')).toEqual({ key: 'amount', order: 'asc' });
    expect(readSort('name', null)).toEqual({ key: 'name', order: 'asc' });
  });

  it('falls back to the default on a junk URL instead of sending it to the server', () => {
    expect(readSort('phone', 'asc')).toEqual(DEFAULT_SORT);
    expect(readSort('amount', 'sideways')).toEqual({ key: 'amount', order: 'desc' });
  });

  it('flips the active column, and opens another in its own direction', () => {
    expect(nextSort({ key: 'weight', order: 'desc' }, 'weight')).toEqual({ key: 'weight', order: 'asc' });
    expect(nextSort({ key: 'weight', order: 'desc' }, 'name')).toEqual({ key: 'name', order: 'asc' });
    expect(nextSort({ key: 'name', order: 'asc' }, 'amount')).toEqual({ key: 'amount', order: 'desc' });
  });

  it('writes nothing to the URL for the default, so a clean URL means it', () => {
    expect(toUrl(DEFAULT_SORT)).toEqual({ sort: null, order: null });
    expect(toUrl({ key: 'weight', order: 'asc' })).toEqual({ sort: 'weight', order: 'asc' });
    expect(toUrl({ key: 'name', order: 'asc' })).toEqual({ sort: 'name', order: 'asc' });
  });
});
