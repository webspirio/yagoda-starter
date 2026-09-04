import { useEffect } from 'react';
import { useThemePreference } from './theme-preference';

/**
 * Single owner of the `.dark` class on <html>. Effective dark mode = the
 * explicit light/dark preference, or the OS/browser's `prefers-color-scheme`
 * when the preference is 'system'. The inline seed in index.html pre-applies
 * the explicit override for paint 0; this hook is the runtime source of
 * truth thereafter, and keeps 'system' in sync with live OS theme changes.
 */
export function useAppTheme(): void {
  const preference = useThemePreference((s) => s.preference);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const effectiveDark = preference === 'system' ? media.matches : preference === 'dark';
      document.documentElement.classList.toggle('dark', effectiveDark);
    };
    apply();
    if (preference !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preference]);
}
