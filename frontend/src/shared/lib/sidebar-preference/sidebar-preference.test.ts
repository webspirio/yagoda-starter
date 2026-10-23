import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getStoredSidebarCollapsed, storeSidebarCollapsed } from './index';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sidebar preference', () => {
  it('is expanded before anything is stored', () => {
    expect(getStoredSidebarCollapsed()).toBe(false);
  });

  it('remembers both states', () => {
    storeSidebarCollapsed(true);
    expect(getStoredSidebarCollapsed()).toBe(true);
    storeSidebarCollapsed(false);
    expect(getStoredSidebarCollapsed()).toBe(false);
  });

  it('reads as expanded when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getStoredSidebarCollapsed()).toBe(false);
  });

  it('ignores a storage that refuses writes', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => storeSidebarCollapsed(true)).not.toThrow();
  });
});
