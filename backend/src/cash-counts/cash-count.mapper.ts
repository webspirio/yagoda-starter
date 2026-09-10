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
 * Same limit the service names: this reads «midday» as «superseded», true only
 * while demotion is the sole source of a midday row.
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
  counted_at: Date;
  explanation: string | null;
}

export function toCashCountRowResponse(row: CashCountRow): CashCountRowResponse {
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
    counted_at: row.counted_at,
    explanation: row.explanation,
  };
}
