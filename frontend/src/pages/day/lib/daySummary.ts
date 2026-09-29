import { sum, sub, isNegative } from '@/shared/lib/money';
import { toLocalIsoDate } from '@/shared/lib/date';

export interface SummaryIntake {
  amount: string;
  net_kg: string;
  voided_at: string | null;
}

export interface SummaryPayout {
  amount: string;
  intake_id: string | null;
  voided_at: string | null;
  return_settled_at: string | null;
  returned_on_void: boolean;
}

export interface DaySummary {
  /** Σ net_kg of the live receipts. */
  netKg: string;
  receipts: number;
  accrued: string;
  /** Cash handed over WITH a receipt (`payouts.intake_id` set, §2.1 ⑥). */
  paidAtReception: string;
  /** §3.7's «Видати без ягоди» — a payout with no visit. */
  paidWithoutBerry: string;
  /**
   * The DRAWER's reading: `movementsSql`'s three payout terms, as far as this
   * shift's own payouts can reach them (`point-cash.service.ts`) —
   *   − every payout of the shift
   *   + those whose cash came back AT VOID TIME (`returned_on_void`, an
   *     open-shift void, 2026-09-28)
   *   + those whose owner-confirmed `settle-return` falls on THIS business
   *     date (read as the browser's local date — #75 is the known edge).
   * Not reachable from here: a return settled today against an EARLIER
   * shift's payout, which also credits today's drawer. The journals this
   * screen reads are shift-scoped, so the note under the ledger says so.
   */
  cashOut: string;
  /** Σ квитанцій дня − Σ ЖИВИХ виплат дня — the DEBT's reading. Negative when
   *  old balances were paid down, or when a receipt was voided with its payout
   *  still live (§3.5's one path). */
  debtGrowth: string;
  /** `debtGrowth < 0`, decided once so the tile and the ledger cannot disagree. */
  paidDown: boolean;
  /** The part of `cashOut` that sits on voided payouts — voids that did not
   *  return their cash at void time and have not come back on this date. */
  voidedOut: string;
  /** …of which the owner has not yet confirmed the return. */
  voidedNotReturned: string;
}

/**
 * The day's figures, as the corrected «Інваріант дня» in `26-rules-by-example.md`
 * defines them: accrued = live payouts + growth of the debt.
 *
 * THERE IS NO «погашено того ж дня» AND NO «за ягоду іншого пункту». Both need a
 * payout to remember WHICH debt it settled, and the correction to §3.3 cancelled
 * exactly that («система не знає, яка виплата що закрила»); the second one is
 * also §3.9's «борг, набутий на одній точці, не можна забрати на іншій». The
 * split below is by `intake_id` — with which visit the cash left the drawer —
 * which is a signature, not an allocation (migration …0017).
 *
 * TWO READINGS OF A VOIDED PAYOUT, as `Payout`'s header names them: the debt
 * rows (split, growth) drop it like `supplier-balance` does; `cashOut` keeps
 * it until its cash is back in THIS shift's drawer (see `cashOut`).
 */
export function buildDaySummary(
  intakes: readonly SummaryIntake[],
  payouts: readonly SummaryPayout[],
  /** The shift's business date, `YYYY-MM-DD`. */
  date: string,
): DaySummary {
  const liveIntakes = intakes.filter((i) => i.voided_at === null);
  const livePayouts = payouts.filter((p) => p.voided_at === null);
  const accrued = sum(liveIntakes.map((i) => i.amount));
  const paidAtReception = sum(livePayouts.filter((p) => p.intake_id !== null).map((p) => p.amount));
  const paidWithoutBerry = sum(
    livePayouts.filter((p) => p.intake_id === null).map((p) => p.amount),
  );
  const debtGrowth = sub(accrued, sum([paidAtReception, paidWithoutBerry]));
  // Cash that came back into THIS drawer: at void time, or by an owner's
  // settle-return dated today. Everything else that was paid is still out.
  const backHere = (p: SummaryPayout): boolean =>
    p.returned_on_void ||
    (p.return_settled_at !== null && toLocalIsoDate(p.return_settled_at) === date);
  const stillOut = payouts.filter((p) => !backHere(p));
  const voided = stillOut.filter((p) => p.voided_at !== null);
  return {
    netKg: sum(liveIntakes.map((i) => i.net_kg)),
    receipts: liveIntakes.length,
    accrued,
    paidAtReception,
    paidWithoutBerry,
    cashOut: sum(stillOut.map((p) => p.amount)),
    debtGrowth,
    paidDown: isNegative(debtGrowth),
    voidedOut: sum(voided.map((p) => p.amount)),
    voidedNotReturned: sum(voided.filter((p) => p.return_settled_at === null).map((p) => p.amount)),
  };
}
