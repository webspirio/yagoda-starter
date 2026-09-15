import { describe, it, expect } from 'vitest';
import { isTruncated, type Paginated } from './pagination';

const page = (over: Partial<Paginated<unknown>> = {}): Paginated<unknown> => ({
  data: [],
  total: 0,
  page: 1,
  limit: 100,
  ...over,
});

describe('isTruncated', () => {
  it('is false while the read is pending or disabled (`undefined`)', () => {
    expect(isTruncated(undefined)).toBe(false);
  });

  it('is false when every row fits on the one fetched page', () => {
    expect(isTruncated(page({ data: [1, 2, 3], total: 3 }))).toBe(false);
  });

  it('is true when the server counts more rows than the page carries', () => {
    expect(isTruncated(page({ data: [1, 2, 3], total: 150 }))).toBe(true);
  });
});
