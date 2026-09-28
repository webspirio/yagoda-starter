import { sum, sub } from '@/shared/lib/money';

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
  cashOut: string;
  /** Σ квитанцій дня − Σ виплат дня. Negative when old balances were paid down,
   *  or when a receipt was voided with its payout still live (§3.5's one path). */
  debtGrowth: string;
  /** Voided payouts whose cash nobody has put back yet (see `Payout`'s header). */
  voidedNotReturned: string;
}

/**
 * The day's figures, as the corrected «Інваріант дня» in `26-rules-by-example.md`
 * defines them: accrued = cash out + growth of the debt.
 *
 * THERE IS NO «погашено того ж дня» AND NO «за ягоду іншого пункту». Both need a
 * payout to remember WHICH debt it settled, and the correction to §3.3 cancelled
 * exactly that («система не знає, яка виплата що закрила»); the second one is
 * also §3.9's «борг, набутий на одній точці, не можна забрати на іншій». The
 * split below is by `intake_id` — with which visit the cash left the drawer —
 * which is a signature, not an allocation (migration …0017).
 *
 * A voided payout is out of every figure but the last, the same DEBT reading
 * `supplier-balance` uses; its cash only returns when `return_settled_at` is set.
 */
export function buildDaySummary(
  intakes: readonly SummaryIntake[],
  payouts: readonly SummaryPayout[],
): DaySummary {
  const liveIntakes = intakes.filter((i) => i.voided_at === null);
  const livePayouts = payouts.filter((p) => p.voided_at === null);
  const accrued = sum(liveIntakes.map((i) => i.amount));
  const paidAtReception = sum(livePayouts.filter((p) => p.intake_id !== null).map((p) => p.amount));
  const paidWithoutBerry = sum(
    livePayouts.filter((p) => p.intake_id === null).map((p) => p.amount),
  );
  const cashOut = sum([paidAtReception, paidWithoutBerry]);
  return {
    netKg: sum(liveIntakes.map((i) => i.net_kg)),
    receipts: liveIntakes.length,
    accrued,
    paidAtReception,
    paidWithoutBerry,
    cashOut,
    debtGrowth: sub(accrued, cashOut),
    voidedNotReturned: sum(
      payouts
        .filter((p) => p.voided_at !== null && p.return_settled_at === null)
        .map((p) => p.amount),
    ),
  };
}
