import { add, cmp } from '@/shared/lib/money';

/**
 * The one place that adds a supplier's carried-in debt onto today's accrual
 * (§2.1 ⑥, §3.1, §3.6) — `TotalsSection` (the on-screen total) and
 * `ReceptionPage` (the default «Видано готівкою») both read it, rather than
 * each re-deriving the same two lines of arithmetic.
 *
 * Only a POSITIVE `debt` is carried in — a supplier the network already owes
 * (a negative balance, «переплата за нами») adds nothing here; that credit
 * stays on the balance, it is not folded into today's payout.
 */
export function totalToPay(accrued: string | null, debt: string | null): string | null {
  if (accrued === null) return null;
  const carried = debt !== null && cmp(debt, '0') === 1 ? debt : '0.00';
  return add(accrued, carried);
}

/**
 * What «Видано готівкою» defaults to before the operator types anything:
 * the total above, capped at what the point's berry drawer actually holds
 * (`cash`) — never more than that, and never negative.
 *
 * `cash === null` means UNKNOWN, not empty — the read hasn't settled (or
 * errored) yet, and treating that as a zero drawer used to zero out a good
 * suggestion, clamp a typed amount down to 0.00 on blur, and (via
 * `toCreateBody`'s "only send a genuine positive figure" rule) silently drop
 * `paid_amount` from the request entirely on a failed read. `cash === null`
 * is therefore UNCAPPED here — the suggestion is the plain total, and the
 * server's own `PAYOUT_EXCEEDS_CASH` stays the real gate if the drawer turns
 * out too small once the request actually lands.
 *
 * `''` — not `'0.00'` — while `accrued` is still `null`: there is nothing to
 * suggest paying out before the preview has settled on an amount at all.
 */
export function suggestedPaid(
  accrued: string | null,
  debt: string | null,
  cash: string | null,
): string {
  const total = totalToPay(accrued, debt);
  if (total === null) return '';
  if (cash === null) return total;
  const drawer = cmp(cash, '0') === 1 ? cash : '0.00';
  return cmp(total, drawer) === 1 ? drawer : total;
}
