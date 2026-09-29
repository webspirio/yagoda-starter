import { sum } from '@/shared/lib/money';

/** One line of `GET /intakes` the ledger cares about. */
export interface LedgerIntake {
  business_date: string;
  amount: string;
  voided_at: string | null;
}

/**
 * One line of `GET /payouts` the ledger cares about.
 *
 * `voided_at` is read for exactly one thing — see `returnedToday`'s comment
 * below — and it is NOT what decides whether a payout counts toward
 * `paidToday`/`paidPast`. That asymmetry is the backend's, not a choice made
 * here: `point-cash.service.ts`'s `movementsSql` subtracts every payout in
 * scope with no `voided_at` filter at all, on purpose (§9.3 — "harmonising
 * them opens a theft path: a voided TRANSFER stops being added, a voided
 * PAYOUT stays subtracted, because that money physically left the drawer and
 * comes back only when a human returns it"). `return_settled_at` can only be
 * set once `voided_at` is (`CHK_payouts_return_requires_void` on the
 * backend), so every payout counted by `returnedToday` was already counted
 * in full by `paidToday`/`paidPast` too.
 */
export interface LedgerPayout {
  business_date: string;
  amount: string;
  voided_at: string | null;
  /** When the physically-returned cash from a voided payout was handed back. */
  return_settled_at: string | null;
}

/**
 * One line of `GET /transfers` the ledger cares about. `status` is part of
 * the shape (the backend always sends it, and every fixture in this module's
 * tests carries it) but is never READ below: a transfer still `sent` has
 * `accepted_date: null`, which the date check alone already excludes.
 */
export interface LedgerTransfer {
  accepted_date: string | null;
  status: string;
  voided_at: string | null;
  cash: string;
  reported_cash: string | null;
  resolved_cash: string | null;
}

export type LedgerRowKey =
  | 'opening'
  | 'accruedToday'
  | 'paidToday'
  | 'paidPast'
  | 'returnedToday'
  | 'cashIn';

export interface LedgerRow {
  key: LedgerRowKey;
  /**
   * Always a non-negative magnitude. Whether a row reads as money IN or
   * money OUT — the minus sign, the tone — is a display decision for the
   * component that renders it, not for this function.
   */
  value: string;
  /**
   * The page this row was summed from did not carry every record, so the
   * figure covers recent history only. WHICH ROW READS WHICH PAGE IS THIS
   * FUNCTION'S KNOWLEDGE, not the renderer's — it is the same mapping the
   * sums below are built from, and splitting it across two files is how
   * `returnedToday` went uncaveated for a whole review round.
   */
  truncated: boolean;
  /**
   * Row-specific data for a hint the renderer cannot spell out as a fixed
   * translation key, because whether it appears — and what it says — depends
   * on a value only this function was handed. Today only `opening`'s row
   * uses it, carrying the point's assigned target-cash figure so the
   * renderer can interpolate «наділ {{target}}» once a target actually
   * exists (R6). Every other row still gets its hint from a fixed
   * `${key}Hint` translation key, unconditionally.
   */
  hint?: string;
}

export interface BuildLedgerInput {
  /** The business date this ledger explains — `YYYY-MM-DD`. */
  date: string;
  intakes: LedgerIntake[];
  payouts: LedgerPayout[];
  transfers: LedgerTransfer[];
  /**
   * `total > data.length` on each fetched page — every one of these reads is
   * capped at `limit: 100` (`PointCashPage`), and a row summed from a capped
   * page is not what its label claims. Default `false`: a caller that does
   * not know says nothing rather than warning at random.
   */
  intakesTruncated?: boolean;
  payoutsTruncated?: boolean;
  transfersTruncated?: boolean;
  /**
   * The day's OPENING BERRY COUNT — `counted_amount` of the `cash_counts`
   * row with `kind === 'opening' && book === 'berry'` for this date
   * (§7.6). `PointCashPage` reads it with its own date-scoped
   * `useCashCountsQuery`, separate from the unbounded one that feeds
   * `neverCounted` and `CashCountHistory`, so a busy point's older counts
   * can never push this specific day's opening row out of a capped page.
   * `null` (the default) — no count taken yet for this date — emits no row
   * at all; there is nothing to caveat as truncated, since a single
   * date+kind+book read is never a partial page the way the other three
   * reads can be.
   */
  openingCount?: string | null;
  /**
   * The point's currently assigned cash target (`target_cash`), read ONLY
   * to caption the opening row: «наділ {{target}}» when one exists. The
   * mock's caption also subtracted «борг бази» (what the base still owes
   * the point) — that figure is not derivable from anything this function
   * receives (no running base-owes-point ledger exists among
   * intakes/payouts/transfers), so it is left out rather than guessed at.
   */
  target?: string | null;
}

/**
 * The browser's LOCAL calendar date of a timestamp, `YYYY-MM-DD` — the same
 * convention `todayIso()` uses for "today". This function has no access to
 * the server's `APP_TIMEZONE` (the backend casts `return_settled_at AT TIME
 * ZONE <app tz>` for exactly this reason, per `movementsSql`'s own comment),
 * so it assumes the reader is in the same zone as the business — the same
 * assumption every other raw timestamp already rendered on this screen makes
 * (`IncomingTransfers`'s `sent_at`). Wrong only in the same narrow window the
 * backend's own comment names: a settlement made just past local midnight,
 * read from a browser in a different zone than the business.
 */
function localDateOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Explains, but does not compute, the point's cash figure. `PointCashPage`
 * shows `GET /point-cash/:pointId`'s `cash` as the total ALWAYS — never the
 * sum of the rows this function returns — so callers must not add these rows
 * up and print the result as the point's cash: a quiet discrepancy between
 * the two is worse than a visible one (Task 19 rule 1).
 *
 * A void is not a movement for `intakes` and `transfers` (§9.3): a voided
 * intake or transfer contributes nothing to any bucket, mirroring the rule
 * `pages/day` already applies to documents. A voided PAYOUT is the deliberate
 * exception — see `LedgerPayout`'s own comment — and stays fully counted in
 * `paidToday`/`paidPast` until `returnedToday` adds its cash back on the day
 * it was physically handed back.
 *
 * `opening`, `accruedToday` AND `paidPast` ARE INFORMATIONAL — none of the
 * three maps onto a term of `movementsSql` (review round 2, finding 2;
 * `opening` joined them in R6). `accruedToday` never did: berries received
 * do not move cash, only payouts do. `paidPast` does not either: the
 * server's figure is the latest drawer count PLUS that one shift's own
 * movements, so a payout from an earlier day is already folded into an
 * earlier count, not into today's math. `opening` is the count that math
 * STARTS FROM, not a movement within today either — labelling any of the
 * three as though it explained today's figure would assert a period this
 * function never defines. Only `paidToday`, `returnedToday` and `cashIn`
 * actually move today's cash; the caller is expected to render the other
 * three visibly apart from those three.
 */
export function buildLedger(input: BuildLedgerInput): LedgerRow[] {
  const {
    date,
    intakes,
    payouts,
    transfers,
    intakesTruncated = false,
    payoutsTruncated = false,
    transfersTruncated = false,
    openingCount = null,
    target = null,
  } = input;

  const accruedToday = sum(
    intakes.filter((i) => i.voided_at === null && i.business_date === date).map((i) => i.amount),
  );

  // Every payout in scope counts, voided or not — see `LedgerPayout`'s
  // comment for why filtering `voided_at` here would be wrong.
  const paidToday = sum(payouts.filter((p) => p.business_date === date).map((p) => p.amount));
  const paidPast = sum(payouts.filter((p) => p.business_date !== date).map((p) => p.amount));

  // The third term of `movementsSql`: cash physically handed back after a
  // void, booked on the day it was RETURNED, not the day the original payout
  // was made — "a payout paid on Tuesday and returned on Friday is Friday's
  // cash" (`point-cash.service.ts`).
  const returnedToday = sum(
    payouts
      .filter((p) => p.return_settled_at !== null && localDateOf(p.return_settled_at) === date)
      .map((p) => p.amount),
  );

  // §7.9 (ред. 09.09.2026): an unresolved dispute credits the POINT's own
  // number, not what the base sent — `resolved_cash` overrides it only once
  // the owner has actually settled the dispute.
  const cashIn = sum(
    transfers
      .filter((t) => t.voided_at === null && t.accepted_date === date)
      .map((t) => t.resolved_cash ?? t.reported_cash ?? t.cash),
  );

  const rows: LedgerRow[] = [];

  // R6 — the day's opening count, when one has been taken (§7.6). ALWAYS
  // FIRST: it is the balance every other row's movement is measured
  // against, so it reads first or not at all. `truncated` is always
  // `false` here — unlike the other four reads, this one is scoped to a
  // single date + kind + book, so there is no "older rows fell off a
  // capped page" story to caveat.
  if (openingCount !== null) {
    rows.push({
      key: 'opening',
      value: openingCount,
      truncated: false,
      // `?? undefined`, not `?? null` — `LedgerRow.hint` is `string |
      // undefined`, and the renderer treats "no hint" as "show nothing",
      // never as "show a hint that says null".
      hint: target ?? undefined,
    });
  }

  rows.push(
    { key: 'accruedToday', value: accruedToday, truncated: intakesTruncated },
    // `paidToday` IS THE ONE PAYOUT-FED ROW WITHOUT A CAVEAT. The payouts
    // read is bounded `to: date` and comes back newest-first
    // (`payouts.service.ts` orders by `created_at DESC`), so what a capped
    // page drops is older than `date`, not of it. The exception is a point
    // that paid out more than a hundred times in this single day — and there
    // the caveat under `paidPast` is already on screen, from the very same
    // flag.
    { key: 'paidToday', value: paidToday, truncated: false },
    { key: 'paidPast', value: paidPast, truncated: payoutsTruncated },
    { key: 'returnedToday', value: returnedToday, truncated: payoutsTruncated },
    { key: 'cashIn', value: cashIn, truncated: transfersTruncated },
  );

  return rows;
}
