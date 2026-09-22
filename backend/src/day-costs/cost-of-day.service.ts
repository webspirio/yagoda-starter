import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ShiftsService } from '../shifts/shifts.service';
import { productCostRows, ProductCostRow } from './product-cost-rows';
import { add, div, isZero, sum } from '../common/money';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

export interface CostOfDayProduct {
  product_id: string;
  product_name: string;
  /** «нараховано» for this product — Σ intake_items.amount + its allocated
   *  top-ups, non-voided. The numerator behind `price_was`, carried so §8.4's
   *  left table can print the money column it divides. */
  accrued: string;
  /** Σ intake_items.net_kg — what the POINT says it took in. */
  intake_net_kg: string;
  /** Σ reweigh_items.net_kg — «наша вага». `null`, never '0.00', whenever
   *  `complete` is false: §8.6's «Це не нуль», so the screen prints «—». */
  reweigh_net_kg: string | null;
  /** «недостача» for this product, already clamped so a surplus on one grade
   *  never lowers it. '0.00' both when nothing is missing and when the product
   *  is not `complete` — `reweigh_net_kg === null` is what tells the two apart. */
  shortfall: string;
  /** «було» — the price the day's intake actually paid, per kilogram taken in. */
  price_was: string;
  /** «собівартість» — `price_was` plus the day's per-kilogram basket share.
   *  `null` when the day's `per_kg` is itself a dash (nothing weighed at all),
   *  AND `null` for a product that is not `complete`: §3.15 keeps a partially
   *  weighed product out of `переважено` and its недостача out of the basket,
   *  so charging it a share of a denominator its own kilograms were excluded
   *  from would be arithmetic pointing two ways at once. «Contributes nothing»
   *  has to mean it collects nothing either. */
  price_cost: string | null;
  /** «нараховане ÷ НАША вага» — priced against the BASE's weight, not the receiver's. `null` when nothing was weighed. */
  price_by_our_weight: string | null;
  /** §3.15 — every grade this product had in this shift is on the scale.
   *  `false` is what makes the two nulls above a «не перезважено» dash rather
   *  than a zero, so the screen can say which of the two it is. */
  complete: boolean;
}

export interface CostOfDayResponse {
  shift_id: string;
  /** `null` while the shift is still open. Mirrors `ReconciliationResponse`
   *  so the two §8 screens can be read side by side. */
  closed_at: string | null;
  /** `closed_at === null`. §3.9: while the shift is open the недостача is
   *  not a claim yet — the reconciliation renders it as «—» — so every
   *  figure below that depends on a shortfall is still moving. §5.5 puts NO
   *  gate here: the owner watches the day take shape. This flag is how the
   *  screen says so instead of contradicting the reconciliation in silence. */
  provisional: boolean;
  /** Σ intake_items.amount + allocated top-ups, non-voided, over every grade the shift accepted. */
  accrued: string;
  reweighed_kg: string;
  /** Σ per-grade недостача, clamped so a surplus never contributes (§8.2/§8.4 — the discard is here, and only here). */
  shortfall_amount: string;
  expenses_amount: string;
  /** shortfall_amount + expenses_amount — СПІЛЬНИЙ КОШИК. */
  basket: string;
  /** basket ÷ reweighed_kg — the same figure added to every product's price. `null` when nothing was weighed. */
  per_kg: string | null;
  /** §8.4's «з них недостача 1,94» — `shortfall_amount ÷ reweighed_kg`.
   *  `null` under the same condition as `per_kg`. */
  shortfall_per_kg: string | null;
  /** §8.4's «з них витрати 4,45» — `expenses_amount ÷ reweighed_kg`.
   *
   *  THIS PAIR IS A BREAKDOWN, NOT AN ADDITION. Each rounds half-up on its
   *  own, so the two can sit a kopiyka away from `per_kg`; `per_kg` stays
   *  `basket ÷ reweighed_kg`, because that is the figure actually added to
   *  every product's price. §8.4's own numbers (1,94 + 4,45 = 6,39) land
   *  exactly — arithmetic luck, not a guarantee — and the screen prints the
   *  two under «з них» so nothing on it ever reads as a sum that fails. */
  expenses_per_kg: string | null;
  /** accrued + expenses_amount — the client's own звірка check. */
  total_check: string;
  /** §3.12 — a late top-up may still move a closed day; the screen marks that with this pair. */
  top_ups_included: true;
  top_ups_latest_at: string | null;
  products: CostOfDayProduct[];
}

/**
 * §8.4 «Собівартість кілограма» — where the whole slice converges. Everything
 * else in this branch (reweigh reconciliation, top-up allocation, day
 * expenses) is an input to exactly this one screen.
 */
@Injectable()
export class CostOfDayService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly shifts: ShiftsService,
  ) {}

  async forShift(_actor: AuthenticatedUser, shiftId: string): Promise<CostOfDayResponse> {
    const shift = await this.shifts.findOneRaw(shiftId);
    if (!shift) throw new NotFoundException('Shift not found');

    const rows = await productCostRows(this.dataSource, shiftId);

    const expensesRows = (await this.dataSource.query(
      `SELECT COALESCE(SUM(amount)::text, '0.00') AS total FROM day_expenses WHERE shift_id = $1`,
      [shiftId],
    )) as { total: string }[];
    const expenses = expensesRows[0]?.total ?? '0.00';

    // §3.12/§3.13 — dated to THIS shift's receipts, not to the top-up's own
    // creation day. `intake_top_ups`'s documented rule dates a top-up to the
    // day it was CREATED, for debt purposes: «how much do we owe RIGHT NOW».
    // Cost-of-day asks a different question — «what did THESE kilograms
    // cost» — and the kilograms were recorded on the receipt's own shift, so
    // a late top-up belongs to the day the berries were weighed in, not the
    // day someone renegotiated the price. This is a deliberate divergence
    // from that Note, not an oversight. (The allocation itself now lives in
    // `productCostRows`, which both this service and `NetworkAverageService`
    // call.)
    const latestRows = (await this.dataSource.query(
      `SELECT MAX(ti.created_at) AS latest
         FROM intake_top_ups ti
         JOIN intakes i ON i.id = ti.intake_id
        WHERE i.shift_id = $1 AND i.voided_at IS NULL AND ti.voided_at IS NULL`,
      [shiftId],
    )) as { latest: Date | string | null }[];
    const latest = latestRows[0]?.latest ?? null;
    const topUpsLatestAt = latest ? new Date(latest).toISOString() : null;

    const accrued = sum(rows.map((r) => r.accrued));
    const reweighedKg = sum(rows.map((r) => r.reweigh_net_kg ?? '0.00'));
    const shortfallAmount = sum(rows.map((r) => r.shortfall));
    const basket = add(shortfallAmount, expenses);
    // §8.6 «Це не нуль» — a day with nothing weighed gets a dash, not '0.00'.
    const weighedNothing = isZero(reweighedKg);
    const perKg = weighedNothing ? null : div(basket, reweighedKg);
    const shortfallPerKg = weighedNothing ? null : div(shortfallAmount, reweighedKg);
    const expensesPerKg = weighedNothing ? null : div(expenses, reweighedKg);

    return {
      shift_id: shiftId,
      closed_at: shift.closed_at ? shift.closed_at.toISOString() : null,
      provisional: shift.closed_at === null,
      accrued,
      reweighed_kg: reweighedKg,
      shortfall_amount: shortfallAmount,
      expenses_amount: expenses,
      basket,
      per_kg: perKg,
      shortfall_per_kg: shortfallPerKg,
      expenses_per_kg: expensesPerKg,
      total_check: add(accrued, expenses),
      top_ups_included: true,
      top_ups_latest_at: topUpsLatestAt,
      products: this.buildProducts(rows, perKg),
    };
  }

  private buildProducts(rows: ProductCostRow[], perKg: string | null): CostOfDayProduct[] {
    return rows.map((r) => {
      const priceWas = div(r.accrued, r.intake_net_kg);
      // §3.15 — `r.complete`, not just `perKg`. A partially weighed product
      // contributed no kilograms to `reweighedKg` and no недостача to the
      // basket, so it does not collect a share of either. Without the
      // `r.complete` guard such a product still read `price_was + per_kg` on
      // a day that also had a fully weighed product — a price derived from a
      // divisor it was deliberately left out of.
      const priceCost = perKg === null || !r.complete ? null : add(priceWas, perKg);
      const priceByOurWeight = r.reweigh_net_kg === null ? null : div(r.accrued, r.reweigh_net_kg);

      return {
        product_id: r.product_id,
        product_name: r.product_name,
        accrued: r.accrued,
        intake_net_kg: r.intake_net_kg,
        reweigh_net_kg: r.reweigh_net_kg,
        shortfall: r.shortfall,
        price_was: priceWas,
        price_cost: priceCost,
        price_by_our_weight: priceByOurWeight,
        complete: r.complete,
      };
    });
  }
}
