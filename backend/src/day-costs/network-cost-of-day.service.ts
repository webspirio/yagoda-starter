import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CostOfDayService, CostOfDayProduct, CostOfDayResponse } from './cost-of-day.service';
import { add, cmp, div, sub, sum } from '../common/money';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/** One point's figures for one product — exactly what that point's own
 *  cost-of-day prints for it, plus where it came from. */
interface NetworkCostPoint {
  point_id: string;
  point_name: string;
  shift_id: string;
  /** That point's shift is still open (`CostOfDayResponse.provisional`). */
  provisional: boolean;
  /** The product is weighed in full at this point AND the point's day has a
   *  basket to share (`full_cost !== null`) — the only cells the network row
   *  sums. A point that accepted the product and has not weighed all of it
   *  keeps its sub-row, with «—» where the base's scale would speak. */
  complete: boolean;
  intake_net_kg: string;
  reweigh_net_kg: string | null;
  shortfall_kg: string;
  accrued: string;
  top_ups: string;
  shortfall: string;
  shortfall_share: string | null;
  expenses_share: string | null;
  full_cost: string | null;
  price_was: string;
  /** The point's own собівартість, identical to its page (user, 2026-10-23).
   *  It may sit a kopiyka off `full_cost ÷ reweigh_net_kg` — that quotient is
   *  the network row's, never a sub-row's. */
  price_cost: string | null;
}

interface NetworkCostProduct {
  product_id: string;
  product_name: string;
  /** At least one point weighed this product in full. `false` reads like the
   *  single-point «не переважено» row: the point-side sums over every point,
   *  «—» from the base's scale onwards. */
  complete: boolean;
  /** The row's figures sum over the COUNTED points — the `complete` ones, or
   *  every point when none is — so each column adds up over one set:
   *  `accrued − shortfall + shortfall_share + expenses_share = full_cost`
   *  holds on every point, and therefore exactly on their sum. */
  intake_net_kg: string;
  reweigh_net_kg: string | null;
  shortfall_kg: string;
  accrued: string;
  top_ups: string;
  shortfall: string;
  shortfall_share: string | null;
  expenses_share: string | null;
  full_cost: string | null;
  /** `accrued ÷ intake_net_kg` of this row. */
  price_was: string;
  /** §8.6 — `full_cost ÷ reweigh_net_kg` of this row: Σ ÷ Σ, never the mean
   *  of the points' `price_cost`. */
  price_cost: string | null;
  /** The points that accepted the product but did not weigh it in full, when
   *  the row is `complete` — reported beside it, never folded in («порожня
   *  клітинка … це не нуль»). `null` otherwise. */
  unweighed: { intake_kg: string; accrued: string } | null;
  points: NetworkCostPoint[];
}

interface NetworkCostDayPoint {
  point_id: string;
  point_name: string;
  shift_id: string;
  provisional: boolean;
  /** That point's day expenses — entered on its own page only. */
  expenses_amount: string;
  /** Something is weighed at that point (`per_kg !== null`), so its expenses
   *  are spread over kilograms; otherwise they have landed nowhere yet. */
  weighed: boolean;
}

export interface NetworkCostOfDayResponse {
  date: string;
  /** Every point with a shift on the date, ordered by name. */
  points: NetworkCostDayPoint[];
  /** Any point's shift is still open. */
  provisional: boolean;
  accrued: string;
  expenses_amount: string;
  /** Σ expenses of the `weighed` points — the expenses the day formula
   *  spreads. The rest wait for a reweigh. */
  expenses_weighed: string;
  reweighed_kg: string;
  shortfall_amount: string;
  top_ups_total: string;
  /** The total row — SUMS ONLY, over the complete product rows. `null` when
   *  nothing in the network is weighed. `full_cost === accrued +
   *  expenses_weighed` exactly, which is what lets the screen print the day
   *  formula from these operands. */
  weighed: {
    intake_kg: string;
    shortfall_kg: string;
    accrued: string;
    shortfall: string;
    shortfall_share: string;
    expenses_share: string;
    full_cost: string;
  } | null;
  /** `weighed.full_cost ÷ reweighed_kg`, an average across berries printed
   *  under the table as a formula. `null` exactly when `weighed` is. */
  price_cost_avg: string | null;
  /** Everything not in the total row: Σ over the (point, product) cells that
   *  are not `complete`. '0.00' / '0.00' when none — a real zero. */
  unweighed: { intake_kg: string; accrued: string };
  /** - `points_ok` — every weighed point's own звірка holds.
   *  - `total_ok`  — `weighed.full_cost + unweighed.accrued + (expenses_amount
   *                  − expenses_weighed) = accrued + expenses_amount`.
   *  `null` exactly when `weighed` is. */
  checks: { points_ok: boolean; total_ok: boolean } | null;
  products: NetworkCostProduct[];
}

interface ShiftRow {
  shift_id: string;
  point_id: string;
  point_name: string;
}

/**
 * §8.4 + §8.6 — «Собівартість дня» for EVERY point at once (client, 23.10:
 * «ми кажемо не Гайове, а кажемо всі»), replacing the separate network-average
 * screen that was never built.
 *
 * «Собівартість по усій мережі — це просто підсумок кожної точки»: each
 * point's day is computed by `CostOfDayService.forShift`, the very figures its
 * own page prints, and this service only SUMS them and divides once per row.
 * Nothing is re-allocated across points — a point's недостача and витрати are
 * spread over its own kilograms, as on its page.
 *
 * §8.6, literally: «сума розділити на вагу». A product's network собівартість
 * is Σ повна вартість ÷ Σ база кг — never the mean of the points' prices,
 * however the call phrased its example.
 */
@Injectable()
export class NetworkCostOfDayService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly costOfDay: CostOfDayService,
  ) {}

  /** Every point's day read inside ONE REPEATABLE READ snapshot (audit
   *  2026-10-24 M5), the shift list included — the network row is a sum of
   *  the point rows, and a sum over figures read at different instants need
   *  not equal any of them. */
  async forDate(_actor: AuthenticatedUser, date: string): Promise<NetworkCostOfDayResponse> {
    return this.dataSource.transaction('REPEATABLE READ', (manager) =>
      this.forDateIn(manager, date),
    );
  }

  private async forDateIn(manager: EntityManager, date: string): Promise<NetworkCostOfDayResponse> {
    const shiftRows = (await manager.query(
      `SELECT s.id AS shift_id, s.collection_point_id AS point_id, cp.name AS point_name
         FROM shifts s
         JOIN collection_points cp ON cp.id = s.collection_point_id
        WHERE s.business_date = $1
        ORDER BY cp.name, s.id`,
      [date],
    )) as ShiftRow[];

    const days: { shift: ShiftRow; day: CostOfDayResponse }[] = [];
    for (const shift of shiftRows) {
      days.push({ shift, day: await this.costOfDay.forShiftIn(manager, shift.shift_id) });
    }

    const byProduct = new Map<string, { product_name: string; points: NetworkCostPoint[] }>();
    for (const { shift, day } of days) {
      for (const p of day.products) {
        const entry = byProduct.get(p.product_id) ?? { product_name: p.product_name, points: [] };
        entry.points.push(pointCell(shift, day, p));
        byProduct.set(p.product_id, entry);
      }
    }

    const products: NetworkCostProduct[] = [];
    for (const [productId, entry] of byProduct) {
      products.push(productRow(productId, entry.product_name, entry.points));
    }
    products.sort((a, b) => a.product_name.localeCompare(b.product_name, 'uk'));

    const points: NetworkCostDayPoint[] = days.map(({ shift, day }) => ({
      point_id: shift.point_id,
      point_name: shift.point_name,
      shift_id: shift.shift_id,
      provisional: day.provisional,
      expenses_amount: day.expenses_amount,
      weighed: day.per_kg !== null,
    }));

    const accrued = sum(days.map(({ day }) => day.accrued));
    const expenses = sum(days.map(({ day }) => day.expenses_amount));
    const expensesWeighed = sum(points.filter((p) => p.weighed).map((p) => p.expenses_amount));
    const reweighedKg = sum(days.map(({ day }) => day.reweighed_kg));

    const cells = products.flatMap((p) => p.points);
    const left = cells.filter((c) => !c.complete);
    const unweighed = {
      intake_kg: sum(left.map((c) => c.intake_net_kg)),
      accrued: sum(left.map((c) => c.accrued)),
    };

    const rows = products.filter((p) => p.complete);
    let weighed: NetworkCostOfDayResponse['weighed'] = null;
    let priceCostAvg: string | null = null;
    let checks: NetworkCostOfDayResponse['checks'] = null;
    if (rows.length > 0) {
      weighed = {
        intake_kg: sum(rows.map((r) => r.intake_net_kg)),
        shortfall_kg: sum(rows.map((r) => r.shortfall_kg)),
        accrued: sum(rows.map((r) => r.accrued)),
        shortfall: sum(rows.map((r) => r.shortfall)),
        shortfall_share: sum(rows.map((r) => r.shortfall_share as string)),
        expenses_share: sum(rows.map((r) => r.expenses_share as string)),
        full_cost: sum(rows.map((r) => r.full_cost as string)),
      };
      priceCostAvg = div(weighed.full_cost, reweighedKg);
      const notSpread = sub(expenses, expensesWeighed);
      checks = {
        points_ok: days.every(
          ({ day }) => day.checks === null || (day.checks.shares_ok && day.checks.total_ok),
        ),
        total_ok:
          cmp(add(add(weighed.full_cost, unweighed.accrued), notSpread), add(accrued, expenses)) ===
          0,
      };
    }

    return {
      date,
      points,
      provisional: points.some((p) => p.provisional),
      accrued,
      expenses_amount: expenses,
      expenses_weighed: expensesWeighed,
      reweighed_kg: reweighedKg,
      shortfall_amount: sum(days.map(({ day }) => day.shortfall_amount)),
      top_ups_total: sum(days.map(({ day }) => day.top_ups_total)),
      weighed,
      price_cost_avg: priceCostAvg,
      unweighed,
      checks,
      products,
    };
  }
}

function pointCell(shift: ShiftRow, day: CostOfDayResponse, p: CostOfDayProduct): NetworkCostPoint {
  return {
    point_id: shift.point_id,
    point_name: shift.point_name,
    shift_id: shift.shift_id,
    provisional: day.provisional,
    complete: p.complete && p.full_cost !== null,
    intake_net_kg: p.intake_net_kg,
    reweigh_net_kg: p.reweigh_net_kg,
    shortfall_kg: p.shortfall_kg,
    accrued: p.accrued,
    top_ups: p.top_ups,
    shortfall: p.shortfall,
    shortfall_share: p.shortfall_share,
    expenses_share: p.expenses_share,
    full_cost: p.full_cost,
    price_was: p.price_was,
    price_cost: p.price_cost,
  };
}

function productRow(
  productId: string,
  productName: string,
  points: NetworkCostPoint[],
): NetworkCostProduct {
  const done = points.filter((c) => c.complete);
  const complete = done.length > 0;
  const counted = complete ? done : points;
  const left = points.filter((c) => !c.complete);

  const intakeKg = sum(counted.map((c) => c.intake_net_kg));
  const accrued = sum(counted.map((c) => c.accrued));
  const reweighKg = complete ? sum(done.map((c) => c.reweigh_net_kg as string)) : null;
  const fullCost = complete ? sum(done.map((c) => c.full_cost as string)) : null;

  return {
    product_id: productId,
    product_name: productName,
    complete,
    intake_net_kg: intakeKg,
    reweigh_net_kg: reweighKg,
    // Not complete anywhere: no недостача has been established yet — the
    // single-point row's '0.00', which `reweigh_net_kg === null` disambiguates.
    shortfall_kg: complete ? sum(done.map((c) => c.shortfall_kg)) : '0.00',
    accrued,
    top_ups: sum(counted.map((c) => c.top_ups)),
    shortfall: complete ? sum(done.map((c) => c.shortfall)) : '0.00',
    shortfall_share: complete ? sum(done.map((c) => c.shortfall_share as string)) : null,
    expenses_share: complete ? sum(done.map((c) => c.expenses_share as string)) : null,
    full_cost: fullCost,
    price_was: div(accrued, intakeKg),
    price_cost: fullCost !== null && reweighKg !== null ? div(fullCost, reweighKg) : null,
    unweighed:
      complete && left.length > 0
        ? {
            intake_kg: sum(left.map((c) => c.intake_net_kg)),
            accrued: sum(left.map((c) => c.accrued)),
          }
        : null,
    points,
  };
}
