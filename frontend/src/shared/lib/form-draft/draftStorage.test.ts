import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as storage from './draftStorage';

beforeEach(() => {
  localStorage.clear();
});

describe('draftStorage', () => {
  it('writes and reads localStorage', () => {
    storage.writeLocal('k', 'v1');
    expect(storage.loadLocal('k')).toBe('v1');
  });

  it('loadLocal returns null when storage throws', () => {
    // On the instance: happy-dom's localStorage never reaches Storage.prototype.
    const spy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(storage.loadLocal('k')).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('writeLocal never throws when storage is disabled', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    expect(() => storage.writeLocal('k', 'v')).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('removeLocal drops the stored draft', () => {
    storage.writeLocal('k', 'v1');
    storage.removeLocal('k');
    expect(storage.loadLocal('k')).toBeNull();
  });
});
