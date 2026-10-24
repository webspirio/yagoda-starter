import { add, cmp } from '@/shared/lib/money';

/**
 * The one place that adds a supplier's carried-in balance onto today's
 * accrual (§2.1 ⑥, §3.1, §3.6) — `TotalsSection` (the on-screen total) and
 * `ReceptionPage` (the default «Видано готівкою» and its ceiling) both read
 * it, rather than each re-deriving the same two lines of arithmetic.
 *
 * The balance is added SIGNED (§3.5, correction 04.09.2026: «"Разом"
 * дорівнює балансу»): a supplier who owes US (a negative balance, e.g. a paid
 * receipt voided later) lowers «Разом», exactly as the server's payout
 * ceiling does (`payout-writer.ts` caps at the debt including this intake).
 * The result may be negative — that is the supplier still owing us after
 * today's berries; `suggestedPaid` is what never goes below zero.
 */
export function totalToPay(accrued: string | null, debt: string | null): string | null {
  if (accrued === null) return null;
  return add(accrued, debt ?? '0.00');
}

/**
 * What «Видано готівкою» defaults to before the operator types anything, and
 * the most it may hold (R1, spec 2026-10-23): the total above, capped at what
 * the point's berry drawer actually holds (`cash`) — never more than that,
 * and never negative.
 *
 * `cash === null` means UNKNOWN, not empty — the read hasn't settled (or
 * errored) yet, and treating that as a zero drawer used to zero out a good
 * suggestion and (via `toCreateBody`'s "only send a genuine positive figure"
 * rule) silently drop `paid_amount` from the request entirely on a failed
 * read. `cash === null` is therefore capped by the total alone here, and the
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
  const owed = cmp(total, '0') === 1 ? total : '0.00';
  if (cash === null) return owed;
  const drawer = cmp(cash, '0') === 1 ? cash : '0.00';
  return cmp(owed, drawer) === 1 ? drawer : owed;
}
