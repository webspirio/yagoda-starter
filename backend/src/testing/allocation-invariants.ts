import { EntityManager } from 'typeorm';
import { SupplierBalanceService } from '../supplier-balance/supplier-balance.service';
import { sub } from '../common/money';

/** Spec 2026-09-26 §4.5 as SQL. `[]` means all four hold for this supplier. */
export async function allocationViolations(m: EntityManager, supplierId: string): Promise<string[]> {
  const [r] = (await m.query(
    `WITH lines AS (
       SELECT i.amount, COALESCE((SELECT SUM(a.amount) FROM payout_allocations a
                                   WHERE a.intake_id = i.id AND a.voided_at IS NULL), 0) AS alloc
         FROM intakes i WHERE i.supplier_id = $1 AND i.voided_at IS NULL
       UNION ALL
       SELECT t.amount, COALESCE((SELECT SUM(a.amount) FROM payout_allocations a
                                   WHERE a.intake_top_up_id = t.id AND a.voided_at IS NULL), 0)
         FROM intake_top_ups t JOIN intakes ti ON ti.id = t.intake_id
        WHERE ti.supplier_id = $1 AND ti.voided_at IS NULL AND t.voided_at IS NULL
     ), pays AS (
       SELECT p.amount, COALESCE((SELECT SUM(a.amount) FROM payout_allocations a
                                   WHERE a.payout_id = p.id AND a.voided_at IS NULL), 0) AS alloc
         FROM payouts p WHERE p.supplier_id = $1 AND p.voided_at IS NULL
     )
     SELECT (SELECT COALESCE(SUM(amount - alloc), 0.00) FROM lines)::text AS open,
            (SELECT COALESCE(SUM(amount - alloc), 0.00) FROM pays)::text AS unallocated,
            (SELECT count(*) FROM lines WHERE amount > alloc)::int AS open_lines,
            (SELECT count(*) FROM pays WHERE amount > alloc)::int AS free_payouts,
            ((SELECT count(*) FROM lines WHERE alloc > amount)
              + (SELECT count(*) FROM pays WHERE alloc > amount))::int AS over,
            (SELECT count(*) FROM payout_allocations a
               JOIN payouts p ON p.id = a.payout_id
               LEFT JOIN intakes i ON i.id = a.intake_id
               LEFT JOIN intake_top_ups t ON t.id = a.intake_top_up_id
               LEFT JOIN intakes ti ON ti.id = t.intake_id
              WHERE p.supplier_id = $1 AND a.voided_at IS NULL
                AND (p.voided_at IS NOT NULL OR i.voided_at IS NOT NULL
                     OR t.voided_at IS NOT NULL OR ti.voided_at IS NOT NULL))::int AS dangling`,
    [supplierId],
  )) as {
    open: string;
    unallocated: string;
    open_lines: number;
    free_payouts: number;
    over: number;
    dangling: number;
  }[];

  const debt = await new SupplierBalanceService(m.connection).debtFor(supplierId, m);
  const out: string[] = [];
  if (sub(r.open, r.unallocated) !== debt) out.push(`open ${r.open} − unallocated ${r.unallocated} ≠ debt ${debt}`);
  if (r.open_lines > 0 && r.free_payouts > 0) out.push(`${r.open_lines} open lines beside ${r.free_payouts} free payouts`);
  if (r.dangling > 0) out.push(`${r.dangling} live rows on voided documents`);
  if (r.over > 0) out.push(`${r.over} documents over-allocated`);
  return out;
}
