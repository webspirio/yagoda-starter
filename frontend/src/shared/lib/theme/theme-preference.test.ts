import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

const KEY = 'web-starter:theme';

async function freshStore() {
  const mod = await import('./theme-preference');
  return mod.useThemePreference;
}

describe('theme-preference store', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });
  afterEach(() => localStorage.clear());

  it('defaults to system when nothing is stored', async () => {
    const store = await freshStore();
    expect(store.getState().preference).toBe('system');
  });

  it('initialises from a stored value', async () => {
    localStorage.setItem(KEY, 'dark');
    const store = await freshStore();
    expect(store.getState().preference).toBe('dark');
  });

  it('setPreference updates state and persists', async () => {
    const store = await freshStore();
    store.getState().setPreference('light');
    expect(store.getState().preference).toBe('light');
    expect(localStorage.getItem(KEY)).toBe('light');
  });

  it('ignores an invalid stored value, falling back to system', async () => {
    localStorage.setItem(KEY, 'chartreuse');
    const store = await freshStore();
    expect(store.getState().preference).toBe('system');
  });
});
