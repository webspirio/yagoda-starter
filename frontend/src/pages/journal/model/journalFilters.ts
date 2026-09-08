import { todayIso, isRealIsoDate } from '@/shared/lib/date';
import { keepUuids } from '@/shared/lib/url-state';

/** Rows per page, both requested (`limit`) and used for the «{{from}}–{{to}}
 *  з {{total}}» pagination footer's arithmetic — a season can run to
 *  thousands of receipts, so this is a real page, not a truncation cap like
 *  `entities/intake`'s day-screen default of 100. */
export const PAGE_SIZE = 20;

/** The journal's URL-backed filter set — everything `parseFilters` derives
 *  from `?from&to&point&supplier&voided&page` (the `kind` tab is a sibling
 *  concern the page reads with its own `useUrlParam`, not part of this
 *  filter shape). */
export interface JournalFilters {
  from: string;
  to: string;
  pointId: string | null;
  supplierId: string | null;
  includeVoided: boolean;
  page: number;
}

/**
 * The first and last calendar day of the month containing `iso` (only the
 * `YYYY-MM` prefix is read — a full `YYYY-MM-DD` works too, as the `<input
 * type="month">` toolbar control and `monthRange('2026-09-15')` callers both
 * rely on).
 *
 * The last day comes from `Date.UTC(year, month, 0)` — `month` here is the
 * REAL 1-based month number, which JS's 0-based `Date.UTC` reads as "the 0th
 * day of next month", i.e. the last day of THIS month, including a leap
 * February. That is integer calendar math the same engine `addDaysIso` and
 * `todayIso` already trust — never a division or a hand-rolled days-in-month
 * table, so nothing here risks the float arithmetic a date has no business
 * going through.
 */
export function monthRange(iso: string): { from: string; to: string } {
  const [yearStr, monthStr] = iso.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const mm = monthStr.padStart(2, '0');
  const from = `${yearStr}-${mm}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${yearStr}-${mm}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

/** `keepUuids` is built for a list; the journal's point/supplier filters are
 *  each a single id, so this takes the first (and only) surviving value. */
function singleUuid(raw: string | null): string | null {
  if (raw === null) return null;
  // `keepUuids` is typed `string[] | null` for its general (list) contract,
  // but only ever returns `null` when handed `null` itself — never for a
  // real array, which `[raw]` always is here.
  return (keepUuids([raw]) ?? [])[0] ?? null;
}

/**
 * Parses the journal's query-string filters, always returning a usable
 * value — never a value the API would 400 on.
 *
 * Defaults: the current month (via `todayIso()`), page 1, both ids `null`
 * («Усі точки» / «Усі постачальники»), and voided documents included (the
 * toolbar's «показувати анульовані» switch starts on). A `from`/`to` pair
 * that is missing, mismatched, or shaped right but not a real calendar day
 * (`isRealIsoDate`) falls back to the whole current month rather than reach
 * the API with a range it would refuse. A malformed id is dropped the same
 * way every other id filter in the app drops one (`keepUuids`) — a stray id
 * in a hand-edited or shared link should render an empty-feeling filter, not
 * an error page.
 */
export function parseFilters(params: URLSearchParams): JournalFilters {
  const rawFrom = params.get('from');
  const rawTo = params.get('to');
  const { from, to } =
    isRealIsoDate(rawFrom) && isRealIsoDate(rawTo)
      ? { from: rawFrom, to: rawTo }
      : monthRange(todayIso());

  const rawPage = params.get('page');
  const page =
    rawPage !== null && /^\d+$/.test(rawPage) && Number(rawPage) > 0 ? Number(rawPage) : 1;

  return {
    from,
    to,
    pointId: singleUuid(params.get('point')),
    supplierId: singleUuid(params.get('supplier')),
    // Absent — or anything but the explicit '0' a cleared switch writes —
    // means "show voided", matching the switch's default-on state.
    includeVoided: params.get('voided') !== '0',
    page,
  };
}
