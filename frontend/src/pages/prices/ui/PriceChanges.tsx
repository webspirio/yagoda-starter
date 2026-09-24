import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/shared/ui/section-card';
import { Spinner } from '@/shared/ui/spinner';
import { formatDecimal } from '@/shared/lib/money';
import { usePriceChangesQuery } from '../api/priceChanges';

/**
 * #151 — «ЗМІНИ ПРОТЯГОМ ДНЯ», the mock's feed under the sheet: when, where,
 * by how much and who. §4.2 already keeps every change as its own row; this is
 * that journal read as a DAY rather than one grade at a time (the per-cell
 * «Історія» dialog).
 *
 * «WAS» IS THE PRICE THE ROW REPLACED, not the morning's. The mock measured
 * every change against the day's first price, which on a third move hides the
 * second one; the server pairs each row with its predecessor instead, looked up
 * across days, so the first change of the morning shows yesterday's price. A
 * grade priced for the very first time has no «was» and shows the new price
 * alone.
 *
 * Rows arrive NEWEST FIRST and are rendered as returned, as the history dialog
 * does. Money is formatted, never computed: no delta, because a delta is
 * arithmetic on `numeric` strings and the two numbers side by side already say
 * it.
 */
export function PriceChanges() {
  const { t, i18n } = useTranslation();
  const query = usePriceChangesQuery();
  const changes = query.data?.changes ?? [];

  // ONE `Intl.DateTimeFormat` over `new Date(created_at)`: the viewer's wall
  // clock, as `PriceHistoryDialog` reads the same column.
  const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' });
  const money = (value: string) => formatDecimal(value, i18n.language);

  return (
    <SectionCard eyebrow={t('prices.changes.title')}>
      {query.isPending ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t('common.somethingWentWrong')}
        </p>
      ) : changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('prices.changes.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {changes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-sm">
              <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <time
                dateTime={c.created_at}
                className="font-mono text-xs text-muted-foreground tabular-nums"
              >
                {time.format(new Date(c.created_at))}
              </time>
              <span className="font-medium">{c.point_name}</span>
              <span className="text-muted-foreground">
                {c.product_name} · {c.grade_name}
              </span>
              <span className="font-mono text-xs tabular-nums">
                {c.previous_base_price !== null ? `${money(c.previous_base_price)} → ` : null}
                <b>{money(c.base_price)} ₴</b>
              </span>
              {c.reason ? (
                <span className="min-w-0 truncate text-xs italic text-muted-foreground">
                  «{c.reason}»
                </span>
              ) : null}
              <span className="ml-auto text-xs text-muted-foreground">{c.author_name}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
