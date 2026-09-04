import { beforeEach, describe, expect, it } from 'vitest';
import { useSession, TOKEN_STORAGE_KEY } from './store';

describe('session store', () => {
  beforeEach(() => {
    localStorage.clear();
    useSession.setState({ token: null });
  });

  it('starts with no token', () => {
    expect(useSession.getState().token).toBeNull();
  });

  it('persists a token to localStorage', () => {
    useSession.getState().setToken('abc.def.ghi');
    expect(useSession.getState().token).toBe('abc.def.ghi');
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('abc.def.ghi');
  });

  it('clears the stored token on sign-out', () => {
    useSession.getState().setToken('abc.def.ghi');
    useSession.getState().setToken(null);
    expect(useSession.getState().token).toBeNull();
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('tolerates localStorage throwing (private mode, blocked storage)', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException('denied');
    };
    expect(() => useSession.getState().setToken('abc')).not.toThrow();
    expect(useSession.getState().token).toBe('abc');
    Storage.prototype.setItem = original;
  });
});
