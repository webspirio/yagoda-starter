import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { reportError } from '@/shared/lib/error-reporting';
import { switchLanguage } from '@/shared/lib/i18n';
import { SUPPORTED_LANGUAGES, storeLanguage } from '@/shared/lib/i18n/language-preference';
import { Segmented } from './segmented';

/**
 * Language segmented control. Manual choices are persisted
 * (language-preference) so they win on the next launch — see
 * `shared/lib/i18n/index.ts`'s `detectLanguage()`.
 *
 * Renders nothing while only one locale is configured (today: just `en`) — a
 * visible switcher with a single option is a dead control. It starts
 * rendering again the moment a second entry is added to
 * `SUPPORTED_LANGUAGES`.
 *
 * Built on the shared `<Segmented>` primitive so it gets the focus ring,
 * roving-tabindex keyboard navigation and the discrete-pick interaction for
 * free instead of re-deriving them.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();

  if (SUPPORTED_LANGUAGES.length <= 1) return null;

  const active = i18n.resolvedLanguage as (typeof SUPPORTED_LANGUAGES)[number] | undefined;
  const set = (code: string) => {
    // Fetches English first when it is not loaded yet. Stored only once the
    // switch succeeded: a persisted `en` whose chunk failed would make every
    // later start wait on the same failing fetch.
    switchLanguage(code)
      .then(() => storeLanguage(code))
      .catch((error: unknown) => reportError(error, { type: 'languageSwitch', code }));
  };
  const options = SUPPORTED_LANGUAGES.map((code) => ({ value: code, label: t(`lang.${code}`) }));

  return (
    <Segmented
      options={options}
      value={active ?? SUPPORTED_LANGUAGES[0]}
      onChange={set}
      label={t('lang.label')}
      size="sm"
      fit="content"
      // Both call sites are absolutely positioned overlays sized to their
      // content — override Segmented's default `w-full` so it doesn't stretch
      // to the positioned ancestor's full width.
      className={cn('w-auto', className)}
    />
  );
}
