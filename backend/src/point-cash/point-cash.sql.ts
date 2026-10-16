import { CashBook } from '../cash-counts/cash-book.enum';

/**
 * «As of» resolves to TODAY IN `APP_TIMEZONE` when the caller names no date,
 * and it does so IN SQL rather than in TypeScript for one reason: Postgres's
 * bare `'today'` and `current_date` both resolve in the SESSION timezone,
 * which is not necessarily the app's. `now() AT TIME ZONE <tz>` is the same
 * local calendar day `TimeService.now().toISODate()` would give, computed in
 * the one place the timezone is already a bind parameter — so this service
 * needs no clock injected and both database specs can construct it with
 * nothing but a `DataSource`.
 *
 * IT TAKES SQL NAMINGS, NOT VALUES, because the CALLER owns its own bind
 * numbering. An earlier draft was a constant with `$2` and `$3` baked in,
 * which would have forced the list query — five parameters of its own — to
 * bend its bind order around a literal defined in this file.
 */
export const asOfSql = (asOf: string, tz: string): string =>
  `COALESCE(${asOf}::date, (now() AT TIME ZONE ${tz}::text)::date)`;

/** Transfers credited to the shift's day — a voided one stops counting (§9.3). */
export const transfersInSql = (shift: string): string => `
    COALESCE((SELECT SUM(CASE
                WHEN t.status = 'accepted' THEN t.cash
                WHEN t.status = 'disputed' AND t.resolved_at IS NOT NULL THEN t.resolved_cash
                WHEN t.status = 'disputed' THEN t.reported_cash
              END)
         FROM transfers t
         JOIN shifts s ON s.collection_point_id = t.collection_point_id
                      AND s.business_date = t.accepted_date
        WHERE s.id = ${shift}
          AND t.voided_at IS NULL), 0.00)`;

/** Every payout of the shift, voided or not — the cash left the drawer (§9.3). */
export const payoutsOutSql = (shift: string): string => `
    COALESCE((SELECT SUM(p.amount) FROM payouts p
        WHERE p.shift_id = ${shift}), 0.00)`;

/** Cash back in the drawer: returned at void time in this shift, plus closed-shift returns settled on its day. */
export const returnsSql = (shift: string, tz: string): string => `(
    COALESCE((SELECT SUM(p.amount) FROM payouts p
        WHERE p.shift_id = ${shift}
          AND p.returned_on_void), 0.00)
  + COALESCE((SELECT SUM(p.amount)
         FROM payouts p
         JOIN shifts ps ON ps.id = p.shift_id
         JOIN shifts s  ON s.id = ${shift}
        WHERE p.return_settled_at IS NOT NULL
          AND NOT p.returned_on_void
          AND ps.collection_point_id = s.collection_point_id
          AND (p.return_settled_at AT TIME ZONE ${tz}::text)::date = s.business_date), 0.00))`;

/**
 * THE MOVEMENTS OF ONE SHIFT — the `+ operations` half of every expectation.
 *
 * SHIFT-BOUNDED BY THE CLIENT'S DECISION, and the reasoning is recorded
 * because it outranks the technical argument: «closing the shift is an
 * important part of the process, and it will be easier for us to make sure
 * shifts are closed on time than to deal with time boundaries». A rule the
 * business can train and audit beats a boundary only the code can see. The
 * cost is named in the spec's §9.1 and is accepted.
 *
 * TRANSFERS JOIN BY (point, accepted_date), NOT BY A COLUMN. `transfers` has
 * no `shift_id` — the DBML omits it deliberately — and it does not need one:
 * `UQ_shifts_point_business_date` gives exactly one shift per point per day,
 * and the cash counts slice §4.1 guarantees every accepted transfer was taken
 * into an open shift whose business date it carries. A `sent` transfer has a
 * NULL `accepted_date` and cannot match, which is §7.9's «у стані sent не
 * рухається НІЧОГО» falling out for free.
 *
 * BOTH VOIDED READINGS SURVIVE FROM THE TRANSFERS SLICE, and harmonising them
 * opens a theft path (§9.3): a voided TRANSFER stops being added, a voided
 * PAYOUT stays subtracted, because that money physically left the drawer and
 * comes back only when a human returns it — the third term.
 *
 * THE RETURN IS ATTRIBUTED BY THE DAY IT WAS HANDED BACK, NOT BY THE SHIFT THE
 * PAYOUT BELONGED TO, and it mirrors the transfer attribution exactly: the
 * money physically re-enters the drawer on the day a human puts it there, so
 * it belongs to whichever shift was running at that point on that day. A
 * payout paid on Tuesday and returned on Friday is Friday's cash, and Friday's
 * closing count is what settles it. Booking it back into Tuesday's shift would
 * be wrong twice — Tuesday is already closed and counted, and every as-of read
 * before Friday would be contaminated by money that was not yet in the drawer.
 *
 * A RETURN MADE AT THE VOID IS THE EXCEPTION (2026-09-28). A payout voided while
 * its shift is open never left that drawer in any sense a count could see — the
 * supplier handed it back at the counter — so `returned_on_void` books it to the
 * payout's OWN shift. By date it would misfile twice: a void at 00:30 in a shift
 * not yet closed, and a void in a shift the owner reopened days later.
 *
 * `AT TIME ZONE` ON `return_settled_at` IS NOT DECORATION. It is the only
 * `timestamptz` in this formula and it is matched against a business DATE; a
 * bare `::date` would take the SESSION timezone and misfile a settlement just
 * past local midnight onto the previous day's shift. Everything else here is
 * already `date`-typed. Scenario 11 of the database spec is the one test whose
 * result depends on `APP_TIMEZONE`, and it exists to fail if this cast goes.
 *
 * THE POINT-SCOPING ON THE RETURN IS EXPLICIT (`ps.collection_point_id =
 * s.collection_point_id`) because the join no longer runs through
 * `p.shift_id = ${shift}`. Without it a return handed back at one point on a
 * given day would credit every other point's drawer for that same day.
 *
 * The transfer void filter sits in the OUTER `WHERE` and not inside the `CASE`
 * on purpose — a transfer can be resolved and LATER voided, and voided must win
 * over resolved. Scenario 13 of the database spec exists to fail if it moves.
 *
 * The three-way `CASE` is the 09.09.2026 client ruling, which overrules §7.9
 * step 4б. An unresolved dispute contributes the point's OWN counted figure:
 * the money is credited at the amount actually received and the shortfall is
 * settled outside the system. Excluding it would leave that point's expected
 * cash wrong by the shortfall on every count from then on, burying the real
 * discrepancy under a permanent phantom one.
 *
 * THE FALLBACK IS `0.00`, NOT `0`. `SUM` over no rows is NULL, and
 * `COALESCE(NULL, 0)` is an integer zero that Postgres renders as `'0'` — so a
 * shift with nothing in it would read `"0"` where every other figure reads to
 * two places. Same literal, same reason, as `supplier-balance`.
 *
 * `shift` and `tz` are SQL namings, never values: the bind placeholders the
 * caller chose, or the anchor row's own `a.shift_id`. Nothing from a request is
 * spliced here — `tz` is always the module's own `APP_TIMEZONE` bind.
 *
 * SPLIT INTO THREE NAMED TERMS (#73) so `breakdownFor` can show each one.
 * `movementsSql` is their sum and nothing else — every caller of the formula
 * reads the same SQL it read before the split.
 */
export const movementsSql = (shift: string, tz: string): string =>
  `(${transfersInSql(shift)}
  - ${payoutsOutSql(shift)}
  + ${returnsSql(shift, tz)}
)`;

/**
 * The crates book's movements of ONE shift (#178, spec D4) — a voided crate
 * document is out at once: in an open shift the deposit went back over the
 * counter, the same reading `returned_on_void` gives a payout. Receipt-mode
 * issuances carry 0 by CHK_crate_issuances_receipt_no_money.
 *
 * TWO CRATE FIGURES, TWO SHAPES. `crate_deposits` (the LIABILITY, what
 * suppliers are owed back) stays a point-lifetime running sum that does not
 * honour `as_of`. `crate_cash` (the DRAWER) is anchored on the crates book's
 * own counts exactly like berry cash — this term plus `anchorSql`. §7.6:
 * «фізично шухляда одна, книг дві», so neither is ever added to `cash`.
 */
export const crateMovementsSql = (shift: string): string => `(
    COALESCE((SELECT SUM(ci.deposit_taken) FROM crate_issuances ci
        WHERE ci.shift_id = ${shift} AND ci.voided_at IS NULL), 0.00)
  - COALESCE((SELECT SUM(cr.deposit_refund) FROM crate_returns cr
        WHERE cr.shift_id = ${shift} AND cr.voided_at IS NULL), 0.00)
)`;

/**
 * The book as a SQL literal, from a closed map: the statement text comes from
 * literals in this file, never from the argument's runtime value.
 */
export const BOOK_SQL: Record<CashBook, string> = {
  [CashBook.Berry]: "'berry'",
  [CashBook.Crates]: "'crates'",
};

/**
 * THE ANCHOR — the latest `opening` or `closing` count at a point, on or
 * before `asOf`. `midday` is excluded and that is load-bearing rather than
 * tidy: a demoted midday count (spec §6.3) sits mid-shift, and isolating "the
 * movements after it" would need a timestamp bound shift-bounded accounting
 * does not have.
 *
 * The ordering tiebreak puts `closing` after `opening` within one shift.
 */
export const anchorSql = (point: string, asOf: string, book: CashBook = CashBook.Berry): string => `(
  SELECT c.counted_amount, c.kind, c.shift_id, s.business_date
    FROM cash_counts c
    JOIN shifts s ON s.id = c.shift_id
   WHERE s.collection_point_id = ${point}
     AND c.book = ${BOOK_SQL[book]}
     AND c.kind <> 'midday'
     AND s.business_date <= ${asOf}
   ORDER BY s.business_date DESC, (c.kind = 'closing') DESC, c.counted_at DESC
   LIMIT 1
)`;
