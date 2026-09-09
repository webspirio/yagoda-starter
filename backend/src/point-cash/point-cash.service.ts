import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { timezoneConfig } from '../config/timezone.config';
import { Paginated } from '../common/dto/paginated';
import { skipOf } from '../common/dto/pagination-query.dto';
import { resolvePointFilter } from '../auth/access/point-scope';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { ListPointCashQueryDto } from './dto/list-point-cash.query';
import { PointCashRow, PointCashRowResponse, toPointCashRowResponse } from './point-cash.mapper';

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
const asOfSql = (asOf: string, tz: string): string =>
  `COALESCE(${asOf}::date, (now() AT TIME ZONE ${tz}::text)::date)`;

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
 * WHAT IS NOT HERE: the crates book (`cash_book = 'crates'`), which needs
 * `crate_issuances` and `crate_returns` and has no formula until they exist.
 */
const movementsSql = (shift: string, tz: string): string => `(
    COALESCE((SELECT SUM(CASE
                WHEN t.status = 'accepted' THEN t.cash
                WHEN t.status = 'disputed' AND t.resolved_at IS NOT NULL THEN t.resolved_cash
                WHEN t.status = 'disputed' THEN t.reported_cash
              END)
         FROM transfers t
         JOIN shifts s ON s.collection_point_id = t.collection_point_id
                      AND s.business_date = t.accepted_date
        WHERE s.id = ${shift}
          AND t.voided_at IS NULL), 0.00)
  - COALESCE((SELECT SUM(p.amount) FROM payouts p
        WHERE p.shift_id = ${shift}), 0.00)
  + COALESCE((SELECT SUM(p.amount)
         FROM payouts p
         JOIN shifts ps ON ps.id = p.shift_id
         JOIN shifts s  ON s.id = ${shift}
        WHERE p.return_settled_at IS NOT NULL
          AND ps.collection_point_id = s.collection_point_id
          AND (p.return_settled_at AT TIME ZONE ${tz}::text)::date = s.business_date), 0.00)
)`;

/**
 * THE ANCHOR — the latest `opening` or `closing` count at a point, on or
 * before `asOf`. `midday` is excluded and that is load-bearing rather than
 * tidy: a demoted midday count (spec §6.3) sits mid-shift, and isolating "the
 * movements after it" would need a timestamp bound shift-bounded accounting
 * does not have.
 *
 * The ordering tiebreak puts `closing` after `opening` within one shift.
 */
const anchorSql = (point: string, asOf: string): string => `(
  SELECT c.counted_amount, c.kind, c.shift_id
    FROM cash_counts c
    JOIN shifts s ON s.id = c.shift_id
   WHERE s.collection_point_id = ${point}
     AND c.book = 'berry'
     AND c.kind <> 'midday'
     AND s.business_date <= ${asOf}
   ORDER BY s.business_date DESC, (c.kind = 'closing') DESC, c.counted_at DESC
   LIMIT 1
)`;

/**
 * A point's cash, computed and never stored.
 *
 * NOTHING IS CACHED AND NO BALANCE IS WRITTEN ANYWHERE. §7.3's list of what
 * moves cash is closed and the figure is a formula — правка 9, «система рахує
 * загальну суму в касі за допомогою денних транзакцій». A stored balance is
 * forbidden for the reason `intakes` has no `remaining` column (§3.2), and the
 * DBML supplies the field evidence: in the client's own workbook the
 * hand-copied balance chain is broken in 124 переходах із 1 473.
 *
 * RE-ANCHORED BY THE CASH COUNTS SLICE. This formula no longer runs from the
 * beginning of time: a point's cash is its latest non-midday COUNT, plus that
 * shift's movements when the count was an `opening`. Nothing is still stored
 * and nothing is still cached — the anchor is a row someone wrote by counting
 * a drawer, not a balance the system maintained.
 *
 * A POINT WITH NO COUNTS READS `0.00` NO MATTER WHAT ITS DOCUMENTS SAY. That
 * is correct — until a human has counted the drawer the system has no claim
 * about it — and it is a visible behaviour change from the transfers slice.
 * It will look like a regression on deploy and it is not one.
 *
 * THERE IS NO OPENING-BALANCE DOCUMENT AND NO `cashBookFrom` SETTING. The
 * `cash_counts` Note names `AppConfig.cashBookFrom` as an application
 * parameter; it lives in the prototype and nothing by that name exists here,
 * deliberately. On a fresh installation it would exclude rows that do not
 * exist.
 *
 * A POINT'S DAY-ONE DRAWER IS ITS FIRST COUNT, and there is no go-live
 * ceremony. The transfers spec §6.6 had the owner sending each point a
 * transfer for its opening balance; the cash counts slice §3.2 RETIRES that,
 * because the first count sets `expected = counted` and therefore BECOMES the
 * starting balance — a count of the drawer rather than a document about it.
 * Sending an opening-balance transfer now would double the money: the count
 * establishes the baseline and the transfer would be added to it as a movement
 * of the shift that accepted it.
 */
@Injectable()
export class PointCashService {
  /**
   * THE TIMEZONE IS A CONSTRUCTOR ARGUMENT WITH A DEFAULT, and the default is
   * not laziness. Nest injects the real `timezoneConfig` namespace; the
   * database spec passes `{ appTimezone: 'Europe/Kyiv' }` by hand, because a
   * test OF timezone handling must PIN its timezone rather than inherit
   * whatever `.env` happens to say — this repo's own `.env` sets
   * `APP_TIMEZONE=UTC`, and a spec that inherited it would prove nothing about
   * the `AT TIME ZONE` cast it exists to test.
   */
  constructor(
    private readonly dataSource: DataSource,
    @Inject(timezoneConfig.KEY)
    private readonly tz: ConfigType<typeof timezoneConfig> = { appTimezone: 'Europe/Kyiv' },
  ) {}

  /**
   * One point's berry cash as of `asOf` (default: today), as a decimal STRING.
   *
   * Takes an `EntityManager` so slice 2 can compute a cash count's
   * `expected_amount` inside the same transaction that writes the count —
   * otherwise the snapshot it stores is already stale.
   */
  async cashFor(pointId: string, asOf?: string, manager?: EntityManager): Promise<string> {
    const runner = manager ?? this.dataSource.manager;
    // The anchor plus, when the anchor is an OPENING count, that shift's
    // movements. There is no third term for "shifts after the anchor": §6.1
    // makes every shift opening write a count, so a later shift would hold a
    // later count and BE the anchor.
    //
    // `::text` on the numeric expression so the value never passes through a
    // JS number on its way out of the driver (foundation §5.1).
    const sql = `
      SELECT COALESCE((
        SELECT (a.counted_amount
                + CASE WHEN a.kind = 'opening' THEN ${movementsSql('a.shift_id', '$3')}
                       ELSE 0.00 END)
          FROM ${anchorSql('$1::uuid', asOfSql('$2', '$3'))} a
      ), 0.00)::text AS cash`;
    const [row] = (await runner.query(sql, [pointId, asOf ?? null, this.tz.appTimezone])) as {
      cash: string;
    }[];

    return row.cash;
  }

  /**
   * The signed movements of one shift, as a decimal STRING. A shift with
   * nothing in it reads `'0.00'`.
   */
  async movementsForShift(shiftId: string, manager?: EntityManager): Promise<string> {
    const runner = manager ?? this.dataSource.manager;
    const [row] = (await runner.query(
      `SELECT ${movementsSql('$1::uuid', '$2')}::text AS movements`,
      [shiftId, this.tz.appTimezone],
    )) as { movements: string }[];
    return row.movements;
  }

  /**
   * What an OPENING count should find: the previous non-midday count's figure,
   * or `null` when the point has never been counted.
   *
   * THERE IS NO MOVEMENTS TERM HERE, and that is a consequence of the transfers
   * reversal rather than an omission: every cash movement now belongs to a
   * shift (spec §4.1), and a shift's movements are settled by its own closing
   * count. Nothing can move between one shift's close and the next one's open.
   */
  async expectedForOpening(pointId: string, manager?: EntityManager): Promise<string | null> {
    const runner = manager ?? this.dataSource.manager;
    const rows = (await runner.query(
      `SELECT a.counted_amount::text AS expected
         FROM ${anchorSql('$1::uuid', "'infinity'::date")} a`,
      [pointId],
    )) as { expected: string }[];
    return rows[0]?.expected ?? null;
  }

  /**
   * What a CLOSING count should find: this shift's opening count plus its
   * movements. `null` when the shift has no opening count — impossible through
   * the API (§6.1 writes one in the same transaction) and therefore a signal
   * that something wrote a shift directly.
   */
  async expectedForClosing(shiftId: string, manager?: EntityManager): Promise<string | null> {
    const runner = manager ?? this.dataSource.manager;
    const rows = (await runner.query(
      `SELECT (c.counted_amount + ${movementsSql('$1::uuid', '$2')})::text AS expected
         FROM cash_counts c
        WHERE c.shift_id = $1::uuid AND c.book = 'berry' AND c.kind = 'opening'`,
      [shiftId, this.tz.appTimezone],
    )) as { expected: string }[];
    return rows[0]?.expected ?? null;
  }

  /**
   * Every point in scope with its cash — §7.10's table, and the one screen both
   * roles open. «Керівник відкриває той самий екран каси, який бачить
   * приймальник цієї точки, плюс свої блоки: одна правда для обох, різна
   * повнота» — which is why this widens by role rather than splitting in two.
   *
   * THE SAME SQL AS `cashFor`, correlated on each point row, so this list
   * cannot grow a formula of its own.
   *
   * THE SHORTFALL IS SUBTRACTED BY POSTGRES, NOT BY JAVASCRIPT, and that is
   * not stylistic: `numeric` arithmetic in SQL is exact, and `NULL - x` is
   * `NULL`, so a point with no target gets its `null` shortfall for free with
   * no branch to forget. Writing `target_cash - cash` in TypeScript is the
   * exact shape foundation §5.1 forbids, and `eslint.config.mjs` refuses it in
   * this directory.
   *
   * THE ORDER IS TOTAL — name, then id. Postgres promises no order among ties,
   * so without the id tiebreaker `LIMIT`/`OFFSET` can serve one row twice.
   *
   * A DEACTIVATED POINT KEEPS ITS ROW — there is deliberately no
   * `cp.is_active = true` here or in the count below, and reinstating one is a
   * money bug, not a tidy-up. §5.6's deactivation is «не видалення»: it stops
   * new business and does not abandon open documents (spec §6.10). A point
   * retired mid-season still holds whatever was in its drawer, and hiding the
   * row would blind the owner to real money while `GET /point-cash/:id` went on
   * reporting it — the list and the single read would disagree about cash.
   * `supplier-balance` made the same call for the same reason: a person must
   * not vanish from the debts list because their card was retired.
   */
  async list(
    actor: AuthenticatedUser,
    query: ListPointCashQueryDto,
  ): Promise<Paginated<PointCashRowResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id) ?? null;
    const manager = this.dataSource.manager;

    const rows = (await manager.query(
      `WITH scoped AS (
         SELECT cp.id, cp.name, cp.target_cash,
                COALESCE((
                  SELECT (a.counted_amount
                          + CASE WHEN a.kind = 'opening' THEN ${movementsSql('a.shift_id', '$3')}
                                 ELSE 0.00 END)
                    FROM ${anchorSql('cp.id', asOfSql('$2', '$3'))} a
                ), 0.00) AS cash,
                -- §3.1 — the count chain and the document line can differ by
                -- the recorded discrepancies and by nothing else, so this SUM
                -- IS the divergence. It is free: no second stored line, no
                -- write path of its own. EXPLAINED INCIDENTS STAY IN IT — an
                -- explanation changes what is OPEN, never what is TRUE (§7.7).
                --
                -- MIDDAY IS EXCLUDED, AND WITHOUT THAT FILTER THE HEADLINE
                -- DOUBLE-COUNTS A REOPEN. §3.1's claim that this sum IS the
                -- divergence telescopes over the ANCHORING counts only, and
                -- §6.3's demotion breaks the chain: reopening a shift rewrites
                -- its closing count's kind to midday, and the re-close then
                -- writes a FRESH count against the SAME unchanged expectation,
                -- because the expectation is a snapshot and nothing moved. A
                -- drawer that opened at 1 000, closed at 900, was reopened and
                -- closed at 900 again drifted -100 ONCE; summing every kind
                -- reports -200. The demoted row is SUPERSEDED by the re-close,
                -- not additional to it.
                --
                -- THE LIMIT, because this is not a general truth: a midday row
                -- can ONLY arise from a reopen today — §7.6's «перерахувати
                -- можна скільки завгодно разів» has no endpoint, so nothing
                -- else writes one. If a midday RECOUNT route is ever added,
                -- its discrepancies are NOT superseded by anything and this
                -- filter has to be revisited rather than left to drop them.
                --
                -- Unlike the anchor above, this is NOT
                -- only_discrepancies-filtered -- that predicate belongs to a
                -- different read with a different question.
                COALESCE((SELECT SUM(c.counted_amount - c.expected_amount)
                            FROM cash_counts c
                            JOIN shifts sh ON sh.id = c.shift_id
                           WHERE sh.collection_point_id = cp.id
                             AND c.book = 'berry'
                             AND c.kind <> 'midday'), 0.00) AS unexplained_difference
           FROM collection_points cp
          WHERE ($1::uuid IS NULL OR cp.id = $1::uuid)
       )
       SELECT s.id AS collection_point_id, s.name,
              s.target_cash::text AS target_cash,
              s.cash::text        AS cash,
              -- NULL propagates: a point with no target gets a null shortfall
              -- with no CASE and no branch to forget.
              (s.target_cash - s.cash)::text AS shortfall,
              s.unexplained_difference::text AS unexplained_difference,
              lt.status  AS latest_transfer_status,
              lt.sent_at AS latest_transfer_sent_at
         FROM scoped s
         LEFT JOIN LATERAL (
              SELECT t.status, t.sent_at
                FROM transfers t
               WHERE t.collection_point_id = s.id
                 AND t.voided_at IS NULL
               ORDER BY t.sent_at DESC, t.id DESC
               LIMIT 1) lt ON TRUE
        ORDER BY s.name ASC, s.id ASC
        LIMIT $4 OFFSET $5`,
      [pointId, query.as_of ?? null, this.tz.appTimezone, query.limit, skipOf(query)],
    )) as PointCashRow[];

    // The count runs over the same scope, so `total` and `data` cannot
    // disagree about what is listed. It does not need the formula.
    const [{ total }] = (await manager.query(
      `SELECT COUNT(*)::int AS total FROM collection_points cp
        WHERE ($1::uuid IS NULL OR cp.id = $1::uuid)`,
      [pointId],
    )) as { total: number }[];

    return {
      data: rows.map(toPointCashRowResponse),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
}

export { movementsSql, anchorSql, asOfSql };
