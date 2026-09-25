import { add, cmp, isZero, sub, sum } from '../common/money';

/**
 * «ЗА ЩО САМЕ ВИННІ» — THE RULE, AND NOTHING ELSE.
 *
 * Spec `docs/superpowers/specs/2026-09-25-yagoda-supplier-settlement-slice.md`
 * §3.2. Two queues, both already in `(business_date, created_at, id)` order
 * (this function does NOT sort — the order is the caller's contract, and the
 * db-spec holds it). Two passes:
 *
 *   1. BOUND — a payout with `intake_id` covers THAT receipt, up to what is
 *      still open on it.
 *   2. FIFO — every remaining amount (unbound payouts, bound excess, payouts
 *      whose receipt is voided and therefore absent from `lines`) closes open
 *      lines from the head of the debt queue.
 *
 * What is left after pass 2 is `unallocated` — the negative debt §3.5 says
 * «гаситься сам наступною здачею». It may land on a line YOUNGER than the
 * payout (spec §3.3); forbidding that would make this disagree with `debtFor`
 * after the next receipt, which is the one thing it must never do.
 *
 * NOTHING HERE IS STORED. The 04.09.2026 decision removed `payout_allocations`
 * because a stored breakdown drifts from the documents (124 breaks in the
 * client's workbook); a projection cannot drift. A void of any document simply
 * changes the input.
 *
 * Pure: no Nest, no database, no `Date`. Every amount is a scale-2 string and
 * every operation is `money.ts`'s — this module is in the eslint money list.
 */

export type DebtKind = 'intake' | 'top_up';

export interface DebtLine {
  id: string;
  kind: DebtKind;
  /** A top-up borrows its PARENT receipt's code, as the card already does. */
  code: string;
  /** Own id for an intake; the parent's for a top-up. */
  intake_id: string;
  /** The parent's for a top-up (spec §3.5). */
  business_date: string;
  created_at: string;
  amount: string;
}

export interface PayoutLine {
  id: string;
  code: string;
  business_date: string;
  created_at: string;
  amount: string;
  intake_id: string | null;
}

export interface Coverage {
  payout_id: string;
  amount: string;
}

export interface Cover {
  line_id: string;
  kind: DebtKind;
  amount: string;
}

export interface SettledLine extends DebtLine {
  paid: string;
  open: string;
  covered_by: Coverage[];
}

export interface SettledPayout extends PayoutLine {
  covers: Cover[];
  unallocated: string;
}

export interface Settlement {
  unallocated: string;
  lines: SettledLine[];
  payouts: SettledPayout[];
}

const min = (a: string, b: string): string => (cmp(a, b) <= 0 ? a : b);

export function settle(lines: DebtLine[], payouts: PayoutLine[]): Settlement {
  const settledLines: SettledLine[] = lines.map((l) => ({
    ...l,
    paid: '0.00',
    open: l.amount,
    covered_by: [],
  }));
  const settledPayouts: SettledPayout[] = payouts.map((p) => ({
    ...p,
    covers: [],
    unallocated: p.amount,
  }));

  // Receipts only: a top-up is never the target of a binding (spec §3.5).
  const byIntakeId = new Map<string, SettledLine>();
  for (const l of settledLines) if (l.kind === 'intake') byIntakeId.set(l.intake_id, l);

  const cover = (payout: SettledPayout, line: SettledLine, amount: string): void => {
    line.paid = add(line.paid, amount);
    line.open = sub(line.open, amount);
    line.covered_by.push({ payout_id: payout.id, amount });
    payout.unallocated = sub(payout.unallocated, amount);
    payout.covers.push({ line_id: line.id, kind: line.kind, amount });
  };

  // Pass 1 — bound.
  for (const p of settledPayouts) {
    if (p.intake_id === null) continue;
    const target = byIntakeId.get(p.intake_id);
    if (target === undefined) continue; // voided receipt: pass 2 takes the whole payout
    const take = min(p.unallocated, target.open);
    if (!isZero(take)) cover(p, target, take);
  }

  // Pass 2 — FIFO. The cursor only advances: a closed line stays closed, so
  // this is O(lines + payouts) rather than a rescan per payout.
  let cursor = 0;
  for (const p of settledPayouts) {
    while (!isZero(p.unallocated) && cursor < settledLines.length) {
      const target = settledLines[cursor];
      if (isZero(target.open)) {
        cursor += 1;
        continue;
      }
      cover(p, target, min(p.unallocated, target.open));
    }
  }

  return {
    unallocated: sum(settledPayouts.map((p) => p.unallocated)),
    lines: settledLines,
    payouts: settledPayouts,
  };
}
