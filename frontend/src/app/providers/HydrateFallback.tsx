import { useTranslation } from 'react-i18next';

/**
 * `/ui-kit`'s `hydrateFallbackElement` — the app's one route-level `lazy`. A
 * data router must resolve a matched route's `lazy` module before its very
 * first render, so a DIRECT load of that URL has nothing on screen yet while
 * the module downloads. Without this, React Router renders nothing there and
 * warns "No HydrateFallback element provided" in the console. (The owner-only
 * screens are React.lazy components instead, covered by AppLayout's Suspense
 * boundary — see `layouts/RouteFallback.tsx`.)
 *
 * Split out from `router.tsx` only because it needs `useTranslation`, which a
 * route `element` cannot use directly.
 */
export function HydrateFallback() {
  const { t } = useTranslation();
  return <p className="p-6 text-sm text-muted-foreground">{t('common.loading')}</p>;
}
