import { add, cmp, isZero, sub, sum } from '../common/money';

/**
 * «За що саме винні» — spec 2026-09-26 (stored allocations).
 *
 * `settle` is the allocation RULE: bound pass (a payout covers its own receipt), then
 * FIFO over `(business_date, created_at, id)`. `AllocationsService.allocate` runs it on
 * residuals and stores each cover as a frozen `payout_allocations` row.
 * `fromAllocations` rebuilds the read model from those live rows.
 *
 * Pure, no Nest/DB/Date; every amount a scale-2 string through `money.ts`.
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

interface Coverage {
  payout_id: string;
  amount: string;
}

interface Cover {
  line_id: string;
  kind: DebtKind;
  amount: string;
}

interface SettledLine extends DebtLine {
  paid: string;
  open: string;
  covered_by: Coverage[];
}

interface SettledPayout extends PayoutLine {
  covers: Cover[];
  unallocated: string;
}

export interface Settlement {
  unallocated: string;
  lines: SettledLine[];
  payouts: SettledPayout[];
}

const min = (a: string, b: string): string => (cmp(a, b) <= 0 ? a : b);

const open = (lines: DebtLine[]): SettledLine[] =>
  lines.map((l) => ({ ...l, paid: '0.00', open: l.amount, covered_by: [] }));
const unpaid = (payouts: PayoutLine[]): SettledPayout[] =>
  payouts.map((p) => ({ ...p, covers: [], unallocated: p.amount }));
const cover = (payout: SettledPayout, line: SettledLine, amount: string): void => {
  line.paid = add(line.paid, amount);
  line.open = sub(line.open, amount);
  line.covered_by.push({ payout_id: payout.id, amount });
  payout.unallocated = sub(payout.unallocated, amount);
  payout.covers.push({ line_id: line.id, kind: line.kind, amount });
};
const result = (lines: SettledLine[], payouts: SettledPayout[]): Settlement => ({
  unallocated: sum(payouts.map((p) => p.unallocated)),
  lines,
  payouts,
});

export function settle(lines: DebtLine[], payouts: PayoutLine[]): Settlement {
  const settledLines = open(lines);
  const settledPayouts = unpaid(payouts);

  // Receipts only: a top-up is never the target of a binding (spec §3.5).
  const byIntakeId = new Map<string, SettledLine>();
  for (const l of settledLines) if (l.kind === 'intake') byIntakeId.set(l.intake_id, l);

  // Pass 1 — bound.
  for (const p of settledPayouts) {
    if (p.intake_id === null) continue;
    const target = byIntakeId.get(p.intake_id);
    if (target === undefined) continue; // receipt voided or already fully covered: pass 2 takes the rest
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

  return result(settledLines, settledPayouts);
}

export interface AllocationRow {
  payout_id: string;
  intake_id: string | null;
  intake_top_up_id: string | null;
  amount: string;
}

/** The read model from live allocation rows. A row outside `lines`/`payouts` is a broken invariant: throw. */
export function fromAllocations(
  lines: DebtLine[],
  payouts: PayoutLine[],
  allocations: AllocationRow[],
): Settlement {
  const settledLines = open(lines);
  const settledPayouts = unpaid(payouts);
  const lineById = new Map(settledLines.map((l) => [l.id, l]));
  const payoutById = new Map(settledPayouts.map((p) => [p.id, p]));
  for (const a of allocations) {
    const line = lineById.get(a.intake_id ?? a.intake_top_up_id ?? '');
    const payout = payoutById.get(a.payout_id);
    if (!line || !payout) {
      throw new Error(`Allocation of payout ${a.payout_id} points outside the live documents`);
    }
    cover(payout, line, a.amount);
  }
  return result(settledLines, settledPayouts);
}
