import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ShiftsService } from '../shifts/shifts.service';
import { productCostRows, ProductCostGrade, ProductCostRow } from './product-cost-rows';
import { add, allocate, cmp, div, isZero, sub, sum } from '../common/money';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

export interface CostOfDayProduct {
  product_id: string;
  product_name: string;
  /** «нараховано» for this product — Σ intake_items.amount + its allocated
   *  top-ups, non-voided. The numerator behind `price_was`, carried so §8.4's
   *  left table can print the money column it divides. */
  accrued: string;
  /** The доплати inside `accrued` — Σ allocated top-ups over this product's
   *  grades, '0.00' when there are none. «Ціна закупки» (`price_was`) is
   *  printed on no receipt whenever this is non-zero, so the screen says how
   *  much of «нараховано» it is (2026-10-23 three-screens review, C3). */
  top_ups: string;
  /** Σ intake_items.net_kg — what the POINT says it took in. */
  intake_net_kg: string;
  /** Σ reweigh_items.net_kg — «наша вага». `null`, never '0.00', whenever
   *  `complete` is false: §8.6's «Це не нуль», so the screen prints «—». */
  reweigh_net_kg: string | null;
  /** «недостача» for this product as a whole, at its average accrued rate and
   *  clamped at zero. '0.00' both when nothing is missing and when the product
   *  is not `complete` — `reweigh_net_kg === null` is what tells the two apart. */
  shortfall: string;
  /** The same недостача in kilograms, clamped per product like `shortfall`. */
  shortfall_kg: string;
  /** This product's part of the day's НЕДОСТАЧА — `allocate(shortfall_amount,
   *  weighed kg)[i]` over the `complete` products' `reweigh_net_kg` (spec
   *  2026-10-23 §3.3). Largest remainder, so Σ `shortfall_share` ===
   *  `shortfall_amount` exactly. Pooled, not this product's own `shortfall`:
   *  §8.4 spreads the недостача over every kilogram that arrived.
   *
   *  `null` exactly when `basket_share` is. */
  shortfall_share: string | null;
  /** This product's part of the day's ВИТРАТИ — `allocate(expenses_amount,
   *  weighed kg)[i]`, the same weights as `shortfall_share`, so Σ
   *  `expenses_share` === `expenses_amount` exactly.
   *
   *  `null` exactly when `basket_share` is. */
  expenses_share: string | null;
  /** «із пулу» — this product's share of the СПІЛЬНИЙ КОШИК, now
   *  `shortfall_share + expenses_share` (spec 2026-10-23 §3.3), so the row's
   *  two coloured parts add up to it on screen.
   *
   *  ALLOCATED, NOT MULTIPLIED. Each part is a largest-remainder split, so
   *  Σ `basket_share` === `shortfall_amount + expenses_amount` === `basket`
   *  exactly, which is what §8.4's «жодна гривня не загубилася» claims and
   *  what `checks.shares_ok` reports. A per-row `mul(per_kg, reweigh_net_kg)`
   *  loses 2,94 ₴ of a 5 460,00 basket on §8.4's own numbers. Two splits
   *  instead of one `allocate(basket, …)` may move a kopiyka between
   *  products on some days; the sum cannot move.
   *
   *  `null` under the same two conditions as `price_cost`: nothing weighed at
   *  all, or this product is not `complete` (§3.15 — a product that
   *  contributed nothing to the denominator collects nothing from the
   *  numerator). */
  basket_share: string | null;
  /** «повна вартість» — `accrued − shortfall + basket_share`: what the
   *  kilograms that actually reached the base cost, with the day's whole
   *  basket share on top (spec 2026-10-23 §3.4). The недостача comes OUT of
   *  `accrued` and comes back IN pooled through `shortfall_share`, so Σ
   *  `full_cost` over the complete products is `weighed.accrued +
   *  expenses_amount` exactly.
   *
   *  A money figure, never a per-kilogram one: `full_cost ÷ reweigh_net_kg`
   *  sits a kopiyka off `price_cost` (the rounding of «було») and is never
   *  printed beside собівартість (spec §3.1).
   *
   *  `null` exactly when `basket_share` is. */
  full_cost: string | null;
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
  /** The product's grades, for the expandable breakdown under its row. */
  grades: ProductCostGrade[];
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
  /** Σ per-product недостача, clamped so a product's surplus never contributes (§8.2/§8.4 — the discard is here, and only here). */
  shortfall_amount: string;
  expenses_amount: string;
  /** shortfall_amount + expenses_amount — СПІЛЬНИЙ КОШИК. */
  basket: string;
  /** `shortfall_per_kg + expenses_per_kg` — the figure added to every
   *  product's price. DEFINED AS THE SUM of the two printed halves, not as
   *  `basket ÷ reweighed_kg`: the two may differ by a kopiyka, and only the
   *  sum keeps «ціна закупки + недостача + витрати = собівартість» true on
   *  every row. `null` when nothing was weighed. */
  per_kg: string | null;
  /** §8.4's «з них недостача 1,94» — `div(shortfall_amount, reweighed_kg)`,
   *  its OWN quotient, so a hand calculator dividing the two printed figures
   *  gets exactly this (2026-10-23 three-screens review, C1 — supersedes the
   *  single-table spec's §3.2 `allocate` split, which summed exactly but
   *  could miss the ÷ check by a kopiyka). `null` under the same condition
   *  as `per_kg`. */
  shortfall_per_kg: string | null;
  /** §8.4's «з них витрати 4,45» — `div(expenses_amount, reweighed_kg)`, its
   *  own quotient like `shortfall_per_kg`. Both checks hold on a calculator:
   *  each half ÷, and `per_kg` as their +. `null` under the same condition
   *  as `per_kg`. */
  expenses_per_kg: string | null;
  /** accrued + expenses_amount — the client's own звірка check. */
  total_check: string;
  /** The day's TOTAL ROW, over the `complete` products only (spec
   *  2026-10-23 §3.4, the designer's call), so every column of it adds up on
   *  its own rows: `intake_kg − reweighed_kg = shortfall_kg` (exactly, unless
   *  some product came back OVER — its surplus is clamped out of
   *  `shortfall_kg` per product, §8.2, so the difference then reads less
   *  than the shortfall). A product not weighed in full is reported in
   *  `unweighed`, never folded in here.
   *
   *  SUMS ONLY (2026-10-23 three-screens review, C2). A per-kilogram figure
   *  in this row mixed point kilograms (Σ accrued ÷ Σ point kg) with base
   *  kilograms (`price_cost_avg`), so its cells read 185,54 + 0,43 + 3,11 =
   *  189,08 against 189,07 in the same row. The day's one per-kg figure is
   *  `price_cost_avg`, printed under the table as its own formula.
   *
   *  - `intake_kg`    — Σ `intake_net_kg` of the complete products.
   *  - `shortfall_kg` — Σ `shortfall_kg` of the complete products.
   *  - `accrued`      — Σ `accrued` of the complete products.
   *  - `shortfall`    — Σ `shortfall` of the complete products; equal to
   *                     `shortfall_amount`, since an incomplete product books
   *                     none (§3.15).
   *
   *  `null` exactly when `per_kg` is: with nothing weighed there is no total
   *  row to print, only «—». */
  weighed: {
    intake_kg: string;
    shortfall_kg: string;
    accrued: string;
    shortfall: string;
  } | null;
  /** «повна вартість» of the day — Σ product `full_cost` over the complete
   *  products, which is `weighed.accrued + expenses_amount` EXACTLY (each
   *  product gives up its `shortfall` and takes back a `shortfall_share`, and
   *  both sum to `shortfall_amount`). That identity is what lets the screen
   *  print the day's formula as «(weighed.accrued + expenses_amount) ÷
   *  reweighed_kg = price_cost_avg». `null` exactly when `per_kg` is. */
  full_cost: string | null;
  /** The day's average собівартість — `full_cost ÷ reweighed_kg`, §8.6's
   *  «сума ÷ вага» over the complete products. An AVERAGE across different
   *  berries, not any one product's `price_cost`, so it is printed under the
   *  table with its operands, never in a per-kg column. `null` exactly when
   *  `per_kg` is. */
  price_cost_avg: string | null;
  /** The products NOT weighed in full (`complete === false`), reported
   *  beside the total row rather than inside it: Σ `intake_net_kg` and Σ
   *  `accrued` over them. Never `null` — '0.00' / '0.00' when every product
   *  is complete — because «nothing is left unweighed» is a real zero, not a
   *  dash. On a day with nothing weighed at all it carries the whole day
   *  (`unweighed.accrued === accrued`). */
  unweighed: { intake_kg: string; accrued: string };
  /** The two звірка facts the screen states in front of the owner, computed
   *  here so the browser compares nothing:
   *
   *  - `shares_ok` — Σ product `basket_share` === `basket` («жодна гривня не
   *                  загубилася»).
   *  - `total_ok`  — `full_cost + unweighed.accrued === total_check`: the
   *                  day's повна вартість plus what is still unweighed
   *                  accounts for every hryvnia accrued and spent.
   *
   *  Both hold by construction; they are reported, not assumed, so a
   *  regression shows up on the screen instead of in silence. `null` exactly
   *  when `per_kg` is — before anything is weighed there is nothing to
   *  reconcile («Звірка — після переважування»). */
  checks: { shares_ok: boolean; total_ok: boolean } | null;
  /** §3.12 — a late top-up may still move a closed day; the screen marks that with this pair. */
  top_ups_included: true;
  top_ups_latest_at: string | null;
  /** Σ product `top_ups` — every доплата on this shift's live receipts, the
   *  amount the status chip names. '0.00' when there are none. */
  top_ups_total: string;
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
    // Three-screens review C1 — each half is its own quotient, so «265,19 ÷
    // 611,10 = 0,43» holds on a calculator, and `per_kg` is DEFINED as their
    // sum so «+» holds too. It may sit a kopiyka off `basket ÷ reweighedKg`;
    // that quotient is never printed, and the money звірка (shares,
    // full_cost) allocates hryvnias, not ₴/кг, so it does not move.
    const shortfallPerKg = weighedNothing ? null : div(shortfallAmount, reweighedKg);
    const expensesPerKg = weighedNothing ? null : div(expenses, reweighedKg);
    const perKg =
      shortfallPerKg === null || expensesPerKg === null ? null : add(shortfallPerKg, expensesPerKg);

    const products = this.buildProducts(rows, perKg, shortfallAmount, expenses);
    const totalCheck = add(accrued, expenses);

    // §3.15 — the total row covers the complete products only; the rest are
    // reported beside it in `unweighed`.
    const complete = rows.filter((r) => r.complete);
    const incomplete = rows.filter((r) => !r.complete);
    const unweighed = {
      intake_kg: sum(incomplete.map((r) => r.intake_net_kg)),
      accrued: sum(incomplete.map((r) => r.accrued)),
    };

    let weighed: CostOfDayResponse['weighed'] = null;
    let fullCost: string | null = null;
    let priceCostAvg: string | null = null;
    let checks: CostOfDayResponse['checks'] = null;
    if (perKg !== null) {
      weighed = {
        intake_kg: sum(complete.map((r) => r.intake_net_kg)),
        shortfall_kg: sum(complete.map((r) => r.shortfall_kg)),
        accrued: sum(complete.map((r) => r.accrued)),
        shortfall: sum(complete.map((r) => r.shortfall)),
      };
      const weighedProducts = products.filter((p) => p.complete);
      fullCost = sum(weighedProducts.map((p) => p.full_cost as string));
      priceCostAvg = div(fullCost, reweighedKg);
      checks = {
        shares_ok: cmp(sum(weighedProducts.map((p) => p.basket_share as string)), basket) === 0,
        total_ok: cmp(add(fullCost, unweighed.accrued), totalCheck) === 0,
      };
    }

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
      total_check: totalCheck,
      weighed,
      full_cost: fullCost,
      price_cost_avg: priceCostAvg,
      unweighed,
      checks,
      top_ups_included: true,
      top_ups_latest_at: topUpsLatestAt,
      top_ups_total: sum(rows.map((r) => r.top_ups)),
      products,
    };
  }

  private buildProducts(
    rows: ProductCostRow[],
    perKg: string | null,
    shortfallAmount: string,
    expenses: string,
  ): CostOfDayProduct[] {
    // §3.15 — the splits run over the COMPLETE products alone, whose
    // kilograms are exactly `reweighed_kg`. `perKg === null` means that sum
    // is zero, and `allocate` would otherwise split the basket evenly across
    // weightless rows rather than refusing.
    //
    // Spec 2026-10-23 §3.3 — TWO splits over the same weights, one per part
    // of the basket, so each product's row shows its недостача and витрати
    // separately and each column sums exactly to its own day total.
    const weighed = rows.filter((r) => r.complete);
    const weights = weighed.map((r) => r.reweigh_net_kg as string);
    const shortfallShares = perKg === null ? [] : allocate(shortfallAmount, weights);
    const expensesShares = perKg === null ? [] : allocate(expenses, weights);
    const partsOf = new Map(
      weighed.map((r, i) => [
        r.product_id,
        { shortfall: shortfallShares[i], expenses: expensesShares[i] },
      ]),
    );

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
      const parts = partsOf.get(r.product_id);
      const basketShare = parts ? add(parts.shortfall, parts.expenses) : null;
      // The недостача leaves `accrued` and returns pooled inside the share.
      const fullCost = basketShare === null ? null : add(sub(r.accrued, r.shortfall), basketShare);

      return {
        product_id: r.product_id,
        product_name: r.product_name,
        accrued: r.accrued,
        top_ups: r.top_ups,
        intake_net_kg: r.intake_net_kg,
        reweigh_net_kg: r.reweigh_net_kg,
        shortfall: r.shortfall,
        shortfall_kg: r.shortfall_kg,
        shortfall_share: parts?.shortfall ?? null,
        expenses_share: parts?.expenses ?? null,
        basket_share: basketShare,
        full_cost: fullCost,
        price_was: priceWas,
        price_cost: priceCost,
        price_by_our_weight: priceByOurWeight,
        complete: r.complete,
        grades: r.grades,
      };
    });
  }
}
