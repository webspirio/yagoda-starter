import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { PageHeader } from '@/shared/ui/page-header';

/** On the app's `PageHeader`, with the way back as a real button (audit 2026-10-24, F9). */
export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <section>
      <PageHeader title={t('notFound.title')} />
      <Button asChild variant="outline">
        <Link to="/">{t('notFound.backHome')}</Link>
      </Button>
    </section>
  );
}
