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
 * IT TAKES SQL NAMINGS, NOT VALUES, for the same reason `cashSql` does: the
 * CALLER owns its own bind numbering. An earlier draft was a constant with
 * `$2` and `$3` baked in, which would have forced the list query in the next
 * task — five parameters of its own — to bend its bind order around a literal
 * defined in this file.
 */
const asOfSql = (asOf: string, tz: string): string =>
  `COALESCE(${asOf}::date, (now() AT TIME ZONE ${tz}::text)::date)`;

/**
 * THE BERRY CASH FORMULA, WRITTEN ONCE. `point` is the SQL naming whose drawer
 * is wanted — the bind placeholder `$1` for one point, the outer row's own
 * column `cp.id` when correlated down a list. Both call sites pass a code
 * literal; nothing from a request is ever spliced here.
 *
 * Copied from the `cash_counts` Note in `28-db-schema.dbml` as amended on
 * 09.09.2026, including every filter. FIVE OF THEM ARE LOAD-BEARING AND ONE OF
 * THEM IS A THEFT PATH IF REMOVED:
 *
 * 1. `t.voided_at IS NULL` — voided TRANSFERS drop out. They must be filtered
 *    BY ROW, not by status: `transfer_status` has no `void` member, so a voided
 *    transfer keeps `status = 'accepted'` and without this line would go on
 *    adding money to the drawer forever. The filter sits in the OUTER `WHERE`
 *    and not inside the `CASE` on purpose — a transfer can be resolved and
 *    LATER voided, and voided must win over resolved.
 *
 * 2. Payouts are summed WITHOUT a `voided_at` filter, ON PURPOSE, and this is
 *    the exact opposite of the debt formula in `supplier-balance`. §9.3: the
 *    money physically left the drawer and voiding does not put it back. It
 *    returns only when a human physically returns it, which is what
 *    `return_settled_at` stamps — the third term. «Інакше сторно стає способом
 *    красти.» A reader who harmonises these two queries has opened that path.
 *
 * 3. The three-way `CASE` is the 09.09.2026 client ruling, which overrules
 *    §7.9 step 4б. An unresolved dispute contributes the point's OWN counted
 *    figure: the money is credited at the amount actually received and the
 *    shortfall is settled outside the system. Excluding it would leave that
 *    point's expected cash wrong by the shortfall on every count from then on,
 *    burying the real discrepancy under a permanent phantom one.
 *
 * 4. `sent` transfers need no explicit filter — their `accepted_date` is NULL
 *    and `accepted_date <= D` already excludes them. §7.9 step 2: «у стані sent
 *    не рухається НІЧОГО».
 *
 * 5. `AT TIME ZONE` on `return_settled_at` is not decoration. It is a
 *    `timestamptz` compared against a business DATE, and a bare `::date` would
 *    take the session timezone and misfile a late-evening settlement by a day.
 *    Everything else in the formula is already `date`-typed.
 *
 * THE FALLBACK IS `0.00`, NOT `0`. `SUM` over no rows is NULL, and
 * `COALESCE(NULL, 0)` is an integer zero that Postgres renders as `'0'` — so a
 * brand-new point would read `"0"` where every other figure reads to two
 * places. Same literal, same reason, as `supplier-balance`.
 *
 * THERE IS NO TIMESTAMP IN THIS FORMULA AND THERE CANNOT BE ONE. Transfers
 * contribute by `accepted_date` and payouts by `shifts.business_date`, both
 * `date`-typed; «cash at 14:00» is not expressible. This is survivable because
 * a cash count's `expected_amount` is a SNAPSHOT computed at the instant of
 * counting — a midday count at 14:00 asks for `D = today` and picks up exactly
 * the payouts written so far. Do not try to add one.
 *
 * WHAT IS NOT HERE: the crates book (`cash_book = 'crates'`), which needs
 * `crate_issuances` and `crate_returns` and has no formula until they exist.
 */
const cashSql = (point: string, asOf: string, tz: string): string => `(
    COALESCE((SELECT SUM(CASE
                WHEN t.status = 'accepted' THEN t.cash
                WHEN t.status = 'disputed' AND t.resolved_at IS NOT NULL THEN t.resolved_cash
                WHEN t.status = 'disputed' THEN t.reported_cash
              END)
         FROM transfers t
        WHERE t.collection_point_id = ${point}
          AND t.voided_at IS NULL
          AND t.accepted_date <= ${asOf}), 0.00)
  - COALESCE((SELECT SUM(p.amount)
         FROM payouts p JOIN shifts s ON s.id = p.shift_id
        WHERE s.collection_point_id = ${point}
          AND s.business_date <= ${asOf}), 0.00)
  + COALESCE((SELECT SUM(p.amount)
         FROM payouts p JOIN shifts s ON s.id = p.shift_id
        WHERE s.collection_point_id = ${point}
          AND p.return_settled_at IS NOT NULL
          AND (p.return_settled_at AT TIME ZONE ${tz}::text)::date <= ${asOf}), 0.00)
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
 * THERE IS NO OPENING-BALANCE DOCUMENT AND NO `cashBookFrom` SETTING. The
 * `cash_counts` Note names `AppConfig.cashBookFrom` as an application
 * parameter; it lives in the prototype and nothing by that name exists here,
 * deliberately. On a fresh installation it would exclude rows that do not
 * exist. A point's day-one drawer is entered as an ORDINARY TRANSFER — the
 * owner creates one per point, the operator signs for it — because §7.3 makes
 * an accepted transfer the only door cash has into a drawer. That is the
 * mechanism working as designed, not a workaround. Spec §6.6.
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
    // `::text` on the numeric expression so the value never passes through a
    // JS number on its way out of the driver (foundation §5.1).
    const sql = `SELECT ${cashSql('$1::uuid', asOfSql('$2', '$3'), '$3')}::text AS cash`;
    const [row] = (await runner.query(sql, [pointId, asOf ?? null, this.tz.appTimezone])) as {
      cash: string;
    }[];

    return row.cash;
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
                ${cashSql('cp.id', asOfSql('$2', '$3'), '$3')} AS cash
           FROM collection_points cp
          WHERE ($1::uuid IS NULL OR cp.id = $1::uuid)
       )
       SELECT s.id AS collection_point_id, s.name,
              s.target_cash::text AS target_cash,
              s.cash::text        AS cash,
              -- NULL propagates: a point with no target gets a null shortfall
              -- with no CASE and no branch to forget.
              (s.target_cash - s.cash)::text AS shortfall,
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

export { cashSql, asOfSql };
