import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import { formatDateTime } from '@/shared/lib/date';
import type { CostOfDay } from '@/entities/cost-of-day';

/**
 * §4.1 step 2: the day's state as a row of neutral chips. None is amber —
 * amber is the недостача's colour and nothing else's, so an open shift is a
 * plain outline chip with a clock. Only the звірка chip carries colour
 * (leaf when it holds, destructive when it does not), and it is a real button
 * only when there IS a звірка to open: with `checks === null` nothing was
 * weighed yet, so the chip is a plain label and the disclosure is not rendered.
 */
export function StatusChips({
  day,
  locale,
  onChecksClick,
}: {
  day: CostOfDay;
  locale: string;
  onChecksClick: () => void;
}) {
  const { t } = useTranslation();
  const notWeighed = day.products.filter((p) => !p.complete).map((p) => p.product_name);

  return (
    <div className="flex flex-wrap items-center gap-2 print:gap-x-4">
      {day.provisional ? (
        <Badge variant="outline">
          <Clock aria-hidden />
          {t('costOfDay.provisional')}
        </Badge>
      ) : (
        <Badge variant="outline">
          <CheckCircle2 aria-hidden />
          {t('costOfDay.status.closed')}
        </Badge>
      )}

      {notWeighed.length === 0 ? (
        <Badge variant="outline">
          <CheckCircle2 aria-hidden />
          {t('costOfDay.status.allWeighed')}
        </Badge>
      ) : (
        <Badge variant="outline">
          <AlertTriangle aria-hidden />
          {t('costOfDay.status.notWeighed', { names: notWeighed.join(', ') })}
        </Badge>
      )}

      {day.top_ups_latest_at !== null && (
        <Badge variant="outline">
          <Clock aria-hidden />
          {t('costOfDay.status.topUps', { at: formatDateTime(day.top_ups_latest_at, locale) })}
        </Badge>
      )}

      {day.checks === null ? (
        <Badge variant="outline">{t('costOfDay.status.checksPending')}</Badge>
      ) : day.checks.shares_ok && day.checks.total_ok ? (
        <button type="button" onClick={onChecksClick} className="rounded-4xl">
          <Badge variant="outline" className="border-[var(--leaf)] text-[var(--leaf)]">
            <CheckCircle2 aria-hidden />
            {t('costOfDay.status.checked')}
          </Badge>
        </button>
      ) : (
        <button type="button" onClick={onChecksClick} className="rounded-4xl">
          <Badge variant="destructive">
            <XCircle aria-hidden />
            {t('costOfDay.status.mismatch')}
          </Badge>
        </button>
      )}
    </div>
  );
}
