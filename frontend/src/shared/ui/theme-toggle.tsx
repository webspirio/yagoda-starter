import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useThemePreference } from '@/shared/lib/theme';
import { Button } from './button';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Live `prefers-color-scheme: dark` — what a 'system' preference resolves to right now. */
function useSystemPrefersDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(DARK_QUERY);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
}

/**
 * Header control for the theme: ONE button that flips light ⇄ dark — no
 * menu, no third state to pick. The store still starts at 'system' (so a
 * fresh browser follows the OS); the toggle reads what that resolves to and
 * writes the OPPOSITE explicit preference, after which the choice sticks.
 * It only writes `useThemePreference`; `useAppTheme` (mounted once by
 * AppLayout) is what actually toggles the `.dark` class on <html>.
 *
 * `aria-pressed` = «dark is on»; the icon shows what a press will switch TO
 * (sun while dark, moon while light), the usual convention.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const preference = useThemePreference((s) => s.preference);
  const setPreference = useThemePreference((s) => s.setPreference);
  const systemDark = useSystemPrefersDark();
  const isDark = preference === 'system' ? systemDark : preference === 'dark';
  const next = isDark ? 'light' : 'dark';

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t('theme.label')}
      aria-pressed={isDark}
      title={t(`theme.${next}`)}
      className={className}
      onClick={() => setPreference(next)}
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  );
}
