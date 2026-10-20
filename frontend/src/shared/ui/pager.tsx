import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';

/**
 * «1–40 з 45» and the «Назад»/«Далі» pair under a server-paginated table —
 * the `Paginated<T>` envelope's `page`/`limit`/`total`, nothing more. Lifted
 * out of the journal's table so the count history pages the same way.
 */
export function Pager({
  page,
  limit,
  total,
  onPageChange,
}: {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
      <span>{t('common.pagination.range', { from: start, to: end, total })}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          {t('common.pagination.prev')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={end >= total}
          onClick={() => onPageChange(page + 1)}
        >
          {t('common.pagination.next')}
        </Button>
      </div>
    </div>
  );
}
