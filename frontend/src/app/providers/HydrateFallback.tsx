import { useTranslation } from 'react-i18next';

/**
 * `AppLayout`'s `hydrateFallbackElement`. A data router must resolve a matched
 * route's `lazy` module before its very first render — in-app navigation to a
 * lazy route waits for that with no visible flash (there is no Suspense
 * boundary involved), but a DIRECT load of a lazy URL (a hard refresh on
 * `/users`, a bookmark) has nothing on screen yet while the module downloads.
 * Without this, React Router renders nothing there and warns "No
 * HydrateFallback element provided" in the console.
 *
 * Split out from `router.tsx` only because it needs `useTranslation`, which a
 * route `element` cannot use directly.
 */
export function HydrateFallback() {
  const { t } = useTranslation();
  return <p className="p-6 text-sm text-muted-foreground">{t('common.loading')}</p>;
}
