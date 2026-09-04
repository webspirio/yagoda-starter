import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAppTheme } from './useAppTheme';
import { useThemePreference } from './theme-preference';

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
}

describe('useAppTheme', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark');
    useThemePreference.setState({ preference: 'system' });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('system: follows prefers-color-scheme dark', () => {
    mockMatchMedia(true);
    renderHook(() => useAppTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('system: follows prefers-color-scheme light', () => {
    mockMatchMedia(false);
    renderHook(() => useAppTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('light override wins over prefers-color-scheme dark', () => {
    mockMatchMedia(true);
    useThemePreference.setState({ preference: 'light' });
    renderHook(() => useAppTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('dark override wins over prefers-color-scheme light', () => {
    mockMatchMedia(false);
    useThemePreference.setState({ preference: 'dark' });
    renderHook(() => useAppTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
