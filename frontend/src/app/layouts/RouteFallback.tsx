import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/shared/ui/skeleton';

/**
 * What fills the main column while a lazily-loaded route's chunk is in
 * flight. It sits INSIDE the shell (see AppLayout), so the sidebar, the top
 * bar and the active nav item stay on screen the whole time — the user sees
 * the page they clicked filling in, not the app disappearing.
 *
 * WHY A PAGE-SHAPED SKELETON AND NOT A SPINNER. Every owner screen behind
 * this boundary opens the same way: a title, a row of controls, then a wide
 * table or card. Holding that shape still means the layout does not jump
 * when the real screen arrives, and a centred spinner in an empty column
 * would do the opposite. `PendingSlice` — the repo's other "nothing here
 * yet" component — is deliberately NOT used: it means «this number has no
 * source yet», a statement about the product, and reusing it for «this file
 * is still downloading» would teach two meanings for one mark.
 *
 * The visible part is decorative, so it is `aria-hidden`; the announcement
 * is the one `sr-only` line, under `role="status"`, which is what a screen
 * reader should hear on a slow connection.
 */
export function RouteFallback() {
  const { t } = useTranslation();

  return (
    <div role="status" data-testid="route-fallback" className="flex flex-col gap-6">
      <span className="sr-only">{t('common.loading')}</span>
      <div aria-hidden className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="ml-auto h-9 w-32" />
        </div>
        <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-11/12" />
          <Skeleton className="h-5 w-10/12" />
          <Skeleton className="h-5 w-9/12" />
        </div>
      </div>
    </div>
  );
}
