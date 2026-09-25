import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { SectionCard } from '@/shared/ui/section-card';
import { Spinner } from '@/shared/ui/spinner';
import { Chip } from '@/shared/ui/chip';
import { TextInput } from '@/shared/ui/text-input';
import { formatDecimal } from '@/shared/lib/money';
import { formatLongDate, todayIso } from '@/shared/lib/date';
import { useUrlPatch } from '@/shared/lib/url-state';
import { usePriceChangesQuery } from '../api/priceChanges';
import type { PriceChange } from '../model/gradePrice';
import {
  groupByLocalDay,
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
  const period = readPeriod(searchParams.get(FROM_PARAM), searchParams.get(TO_PARAM));
  const today = todayIso();
  const preset = presetOf(period, today);
  const query = usePriceChangesQuery(period);
  const changes = query.data?.changes ?? [];
  const isDefault = period.from === null && period.to === null;
  const isOneDay = query.data ? query.data.from === query.data.to : true;

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
        <b>{money(c.base_price)} ₴</b>
      </span>
      {c.reason ? (
        <span className="min-w-0 truncate text-xs italic text-muted-foreground">«{c.reason}»</span>
      ) : null}
      <span className="ml-auto text-xs text-muted-foreground">{c.author_name}</span>
    </li>
  );

  return (
    <SectionCard eyebrow={isOneDay ? t('prices.changes.title') : t('prices.changes.titlePeriod')}>
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
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t('prices.changes.from')}
          <TextInput
            type="date"
            className="h-[34px] w-auto"
            value={shownFrom}
            max={today}
            onChange={(e) => {
              if (e.target.value) setPeriod(withFrom(period, e.target.value, today));
            }}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t('prices.changes.to')}
          <TextInput
            type="date"
            className="h-[34px] w-auto"
            value={shownTo}
            max={today}
            onChange={(e) => {
              if (e.target.value) setPeriod(withTo(period, e.target.value, today));
            }}
          />
        </label>
      </div>

      {query.isPending ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t('common.somethingWentWrong')}
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
            <section key={group.date} aria-label={formatLongDate(group.date, i18n.language)}>
              <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                {formatLongDate(group.date, i18n.language)}
              </h3>
              <ul className="flex flex-col gap-1.5">{group.rows.map(renderRow)}</ul>
            </section>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
