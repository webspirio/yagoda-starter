import { useTranslation } from 'react-i18next';
import { useMeQuery } from '@/entities/user';
import { Skeleton } from '@/shared/ui/skeleton';

/**
 * Intentionally empty. This is a starter: the dashboard exists to prove the
 * shell renders and the session resolves, and is the first thing a consuming
 * project replaces.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const { data, isPending } = useMeQuery();

  return (
    <section>
      <h1 className="text-2xl font-semibold">{t('nav.dashboard')}</h1>
      {isPending ? (
        <Skeleton className="mt-4 h-5 w-48" />
      ) : (
        <p className="mt-4 text-muted-foreground">
          {t('dashboard.signedInAs', { name: data?.display_name })}
        </p>
      )}
    </section>
  );
}
