import { sub } from '../common/money';
import { CashBook } from './cash-book.enum';
import { CashCountKind } from './cash-count-kind.enum';

/** The raw projection — every numeric already `::text`. */
export interface CashCountRow {
  id: string;
  shift_id: string;
  collection_point_id: string;
  business_date: string;
  book: CashBook;
  kind: CashCountKind;
  counted_amount: string;
  expected_amount: string;
  counted_by_user_id: string;
  counted_at: Date;
  explanation: string | null;
}

/**
 * One line of the owner's incident list.
 *
 * `discrepancy` IS COMPUTED AND STORED NOWHERE — `counted − expected`, through
 * `common/money.ts` rather than a bare `-` on the decimal strings (§5.1).
 * There is no input field for it in any role and there are no thresholds
 * (§7.7): a kopiyka out is the same kind of event as 350 ₴ out.
 *
 * THE SIGN: positive is a SURPLUS (more in the drawer than expected), negative
 * is a SHORTAGE. This is the OPPOSITE convention from a transfer's
 * `cash_discrepancy`, where positive means a shortage — and the difference is
 * not sloppiness. A transfer's discrepancy asks «how much did we NOT get», a
 * count's asks «what is in the drawer, relative to what should be». Both read
 * naturally in their own screen and neither can be flipped without making the
 * other read backwards.
 *
 * `is_open` — a discrepancy, on a count that has not been superseded, on a
 * shift with no explanation. This is the owner's working list, and it shrinks
 * as it is worked (§6.5).
 *
 * `midday` IS NEVER OPEN, matching the SQL filter in `CashCountsService.list`
 * and `unexplained_difference` in `point-cash.service.ts` — all three exclude
 * it, and they have to agree or the owner reads one drift as two. A reopen
 * demotes the first closing count to `midday` (§6.3); the re-close writes the
 * count that now stands. The demoted row keeps its discrepancy and its place
 * in the unfiltered list, because §7.6 forbids destroying evidence — it simply
 * is not the row anyone still has to act on.
 *
 * TWO SOURCES WRITE `midday` NOW, not one: a demoted closing count (§6.3) and
 * a recount's own row (R2, since 2026-09-22). Both are excluded from
 * `is_open` by the same line below, and by design rather than by accident —
 * a demoted row is superseded evidence, a recount's row was never an
 * incident to begin with (§7.6 — «перерахунок — це свідчення, а не
 * коригування»), and either way `midday` never belongs on the owner's
 * working list. See `CashCountsService`'s own doc comment for the same check
 * against `only_discrepancies` and `point-cash.service.ts`'s
 * `unexplained_difference`.
 */
export interface CashCountRowResponse {
  id: string;
  shift_id: string;
  collection_point_id: string;
  business_date: string;
  book: CashBook;
  kind: CashCountKind;
  counted_amount: string;
  expected_amount: string;
  discrepancy: string;
  is_open: boolean;
  counted_by_user_id: string;
  /** D-8 — `displayNameOf` on `counted_by_user_id`, via `loadDisplayNames`.
   *  `null` only if the caller's map has no entry for that id. */
  counted_by_name: string | null;
  counted_at: Date;
  explanation: string | null;
}

/**
 * `names` is loaded by the caller, ONCE per page — see `loadDisplayNames`.
 * This function does no I/O of its own; it only reads the map.
 */
export function toCashCountRowResponse(
  row: CashCountRow,
  names: ReadonlyMap<string, string>,
): CashCountRowResponse {
  const discrepancy = sub(row.counted_amount, row.expected_amount);
  return {
    id: row.id,
    shift_id: row.shift_id,
    collection_point_id: row.collection_point_id,
    business_date: row.business_date,
    book: row.book,
    kind: row.kind,
    counted_amount: row.counted_amount,
    expected_amount: row.expected_amount,
    discrepancy,
    is_open:
      discrepancy !== '0.00' &&
      row.kind !== CashCountKind.Midday &&
      (row.explanation === null || row.explanation === ''),
    counted_by_user_id: row.counted_by_user_id,
    counted_by_name: names.get(row.counted_by_user_id) ?? null,
    counted_at: row.counted_at,
    explanation: row.explanation,
  };
}
