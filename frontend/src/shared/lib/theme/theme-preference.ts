import { create } from 'zustand';

export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'web-starter:theme';
const PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

const isPreference = (v: string | null): v is ThemePreference =>
  v != null && (PREFERENCES as readonly string[]).includes(v);

function getStored(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return isPreference(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

interface ThemeStore {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export const useThemePreference = create<ThemeStore>((set) => ({
  preference: getStored(),
  setPreference: (preference) => {
    try {
      localStorage.setItem(KEY, preference);
    } catch {
      /* storage disabled — ignore */
    }
    set({ preference });
  },
}));
