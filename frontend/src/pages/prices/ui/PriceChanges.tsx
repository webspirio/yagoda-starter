import { useEffect, useId } from 'react';
import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { SectionCard } from '@/shared/ui/section-card';
import { Spinner } from '@/shared/ui/spinner';
import { Chip } from '@/shared/ui/chip';
import { DateBound } from '@/shared/ui/date-bound';
import { formatDecimal, formatUah } from '@/shared/lib/money';
import { formatLongDate, todayIso } from '@/shared/lib/date';
import { useUrlPatch } from '@/shared/lib/url-state';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import { usePriceChangesQuery } from '../api/priceChanges';
import type { PriceChange } from '../model/gradePrice';
import {
  groupByLocalDay,
  isOneDay,
  periodOfPreset,
  presetOf,
  readPeriod,
  withFrom,
  withTo,
  type ChangesPeriod,
  type ChangesPreset,
} from '../model/changesPeriod';

/** URL keys, prefixed so they cannot collide with anything else the prices
 *  page ever keeps in its query string. */
const FROM_PARAM = 'changes_from';
const TO_PARAM = 'changes_to';
const PRESETS: ChangesPreset[] = ['today', 'yesterday', 'week'];

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
 * A PERIOD, not only today (#151's follow-up): presets and two date bounds,
 * kept in the URL so a link reopens the same period. With no period the server
 * still picks its own today. Any chosen period groups the rows under one
 * heading per date, so «yesterday» and «a week» never read as today.
 *
 * Rows arrive NEWEST FIRST and are rendered as returned, as the history dialog
 * does. Money is formatted, never computed: no delta, because a delta is
 * arithmetic on `numeric` strings and the two numbers side by side already say
 * it.
 */
export function PriceChanges() {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const patch = useUrlPatch();
  const today = todayIso();
  const rawFrom = searchParams.get(FROM_PARAM);
  const rawTo = searchParams.get(TO_PARAM);
  const period = readPeriod(rawFrom, rawTo, today);
  // A period `readPeriod` refused is read as today; take it out of the address
  // bar too, or the chips say «Сьогодні» while a re-copied link still carries
  // the broken period.
  const refused =
    (rawFrom !== null || rawTo !== null) && period.from === null && period.to === null;
  useEffect(() => {
    if (refused) patch({ [FROM_PARAM]: null, [TO_PARAM]: null });
  }, [refused, patch]);
  const preset = presetOf(period, today);
  const query = usePriceChangesQuery(period);
  const changes = query.data?.changes ?? [];
  const isDefault = period.from === null && period.to === null;
  const oneDay = isOneDay(period, today);
  const headingId = useId();

  const setPeriod = (next: ChangesPeriod) =>
    patch({ [FROM_PARAM]: next.from, [TO_PARAM]: next.to });
  // What the inputs show for a bound the URL leaves to the server.
  const shownTo = period.to ?? query.data?.to ?? today;
  const shownFrom = period.from ?? query.data?.from ?? shownTo;

  // ONE `Intl.DateTimeFormat` over `new Date(created_at)`: the viewer's wall
  // clock, as `PriceHistoryDialog` reads the same column.
  const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' });
  const money = (value: string) => formatDecimal(value, i18n.language);

  const renderRow = (c: PriceChange) => (
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
        <b>{formatUah(c.base_price, i18n.language)}</b>
      </span>
      {c.reason ? (
        <span className="min-w-0 truncate text-xs italic text-muted-foreground">«{c.reason}»</span>
      ) : null}
      <span className="ml-auto text-xs text-muted-foreground">{c.author_name}</span>
    </li>
  );

  return (
    <SectionCard eyebrow={oneDay ? t('prices.changes.title') : t('prices.changes.titlePeriod')}>
      <div
        role="group"
        aria-label={t('prices.changes.period')}
        className="mb-4 flex flex-wrap items-center gap-2"
      >
        {PRESETS.map((p) => (
          <Chip key={p} selected={preset === p} onClick={() => setPeriod(periodOfPreset(p, today))}>
            {t(`prices.changes.presets.${p}`)}
          </Chip>
        ))}
        <DateBound
          label={t('prices.changes.from')}
          value={shownFrom}
          max={today}
          onCommit={(value) => setPeriod(withFrom(period, value, today))}
        />
        <DateBound
          label={t('prices.changes.to')}
          value={shownTo}
          max={today}
          onCommit={(value) => setPeriod(withTo(period, value, today))}
        />
      </div>

      {query.isPending ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t(apiErrorToBanner(query.error, 'common.somethingWentWrong'))}
        </p>
      ) : changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {isDefault ? t('prices.changes.empty') : t('prices.changes.emptyPeriod')}
        </p>
      ) : isDefault ? (
        <ul className="flex flex-col gap-1.5">{changes.map(renderRow)}</ul>
      ) : (
        <div className="flex flex-col gap-4">
          {groupByLocalDay(changes).map((group) => (
            <section key={group.date} aria-labelledby={`${headingId}-${group.date}`}>
              <h2
                id={`${headingId}-${group.date}`}
                className="mb-1.5 text-xs font-semibold text-muted-foreground"
              >
                {formatLongDate(group.date, i18n.language)}
              </h2>
              <ul className="flex flex-col gap-1.5">{group.rows.map(renderRow)}</ul>
            </section>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
