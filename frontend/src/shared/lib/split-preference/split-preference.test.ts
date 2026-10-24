import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getStoredCostSplit, storeCostSplit } from './index';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cost split preference', () => {
  it('remembers nothing before anything is stored', () => {
    expect(getStoredCostSplit()).toBeNull();
  });

  it('remembers the last value', () => {
    storeCostSplit('own');
    expect(getStoredCostSplit()).toBe('own');
  });

  it('reads as nothing when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getStoredCostSplit()).toBeNull();
  });

  it('swallows a write that storage refuses', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => storeCostSplit('value')).not.toThrow();
  });
});
