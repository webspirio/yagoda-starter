import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ShiftsService } from '../shifts/shifts.service';
import { productCostRows, ProductCostRow } from './product-cost-rows';
import { add, div, isZero, sum } from '../common/money';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

export interface CostOfDayProduct {
  product_id: string;
  product_name: string;
  /** «було» — the price the day's intake actually paid, per kilogram taken in. */
  price_was: string;
  /** «собівартість» — `price_was` plus the day's per-kilogram basket share. `null` when nothing was weighed (§8.6). */
  price_cost: string | null;
  /** «нараховане ÷ НАША вага» — priced against the BASE's weight, not the receiver's. `null` when nothing was weighed. */
  price_by_our_weight: string | null;
}

export interface CostOfDayResponse {
  shift_id: string;
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
    const perKg = isZero(reweighedKg) ? null : div(basket, reweighedKg);

    return {
      shift_id: shiftId,
      accrued,
      reweighed_kg: reweighedKg,
      shortfall_amount: shortfallAmount,
      expenses_amount: expenses,
      basket,
      per_kg: perKg,
      total_check: add(accrued, expenses),
      top_ups_included: true,
      top_ups_latest_at: topUpsLatestAt,
      products: this.buildProducts(rows, perKg),
    };
  }

  private buildProducts(rows: ProductCostRow[], perKg: string | null): CostOfDayProduct[] {
    return rows.map((r) => {
      const priceWas = div(r.accrued, r.intake_net_kg);
      const priceCost = perKg === null ? null : add(priceWas, perKg);
      const priceByOurWeight = r.reweigh_net_kg === null ? null : div(r.accrued, r.reweigh_net_kg);

      return {
        product_id: r.product_id,
        product_name: r.product_name,
        price_was: priceWas,
        price_cost: priceCost,
        price_by_our_weight: priceByOurWeight,
      };
    });
  }
}
