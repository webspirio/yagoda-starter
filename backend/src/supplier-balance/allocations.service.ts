import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { settle, DebtLine, PayoutLine } from './settlement';

export type ReleaseTarget = { payoutId: string } | { intakeId: string } | { topUpId: string };

/** What is still open on each live line, queue-ordered. A top-up queues under its parent's date. */
const RESIDUAL_LINES_SQL = `
  SELECT r.id, r.kind, r.code, r.intake_id, r.business_date::text AS business_date,
         r.created_at::text AS created_at, r.open::text AS amount
    FROM (
      SELECT i.id, 'intake' AS kind, i.code, i.id AS intake_id, s.business_date, i.created_at,
             i.amount - COALESCE((SELECT SUM(a.amount) FROM payout_allocations a
                                   WHERE a.intake_id = i.id AND a.voided_at IS NULL), 0) AS open
        FROM intakes i JOIN shifts s ON s.id = i.shift_id
       WHERE i.supplier_id = $1 AND i.voided_at IS NULL
      UNION ALL
      SELECT t.id, 'top_up', ti.code, t.intake_id, s.business_date, t.created_at,
             t.amount - COALESCE((SELECT SUM(a.amount) FROM payout_allocations a
                                   WHERE a.intake_top_up_id = t.id AND a.voided_at IS NULL), 0)
        FROM intake_top_ups t
        JOIN intakes ti ON ti.id = t.intake_id
        JOIN shifts s ON s.id = ti.shift_id
       WHERE ti.supplier_id = $1 AND ti.voided_at IS NULL AND t.voided_at IS NULL
    ) r
   WHERE r.open > 0
   ORDER BY r.business_date, r.created_at, r.id`;

/** What is still free on each live payout, queue-ordered. */
const RESIDUAL_PAYOUTS_SQL = `
  SELECT r.id, r.code, r.intake_id, r.business_date::text AS business_date,
         r.created_at::text AS created_at, r.free::text AS amount
    FROM (
      SELECT p.id, p.code, p.intake_id, s.business_date, p.created_at,
             p.amount - COALESCE((SELECT SUM(a.amount) FROM payout_allocations a
                                   WHERE a.payout_id = p.id AND a.voided_at IS NULL), 0) AS free
        FROM payouts p JOIN shifts s ON s.id = p.shift_id
       WHERE p.supplier_id = $1 AND p.voided_at IS NULL
    ) r
   WHERE r.free > 0
   ORDER BY r.business_date, r.created_at, r.id`;

/**
 * The only writer of `payout_allocations` (spec 2026-09-26 §4.2). Rows are frozen:
 * `release` stamps `voided_at`, `allocate` appends. Callers hold `lockSupplier` first.
 */
@Injectable()
export class AllocationsService {
  /** Per-supplier mutex, taken before any document lock so every path locks in one order. */
  async lockSupplier(m: EntityManager, supplierId: string): Promise<void> {
    await m.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId]);
  }

  /** Voids a document's live rows. An intake takes its top-ups' rows with it, as `debtSql` does. */
  async release(m: EntityManager, target: ReleaseTarget): Promise<void> {
    const [where, id] =
      'payoutId' in target
        ? ['payout_id = $1', target.payoutId]
        : 'topUpId' in target
          ? ['intake_top_up_id = $1', target.topUpId]
          : [
              '(intake_id = $1 OR intake_top_up_id IN (SELECT id FROM intake_top_ups WHERE intake_id = $1))',
              target.intakeId,
            ];
    await m.query(
      `UPDATE payout_allocations SET voided_at = now() WHERE voided_at IS NULL AND ${where}`,
      [id],
    );
  }

  /** Settles residuals and appends one row per cover. Idempotent: nothing left, nothing written. */
  async allocate(m: EntityManager, supplierId: string): Promise<number> {
    const lines = (await m.query(RESIDUAL_LINES_SQL, [supplierId])) as DebtLine[];
    const payouts = (await m.query(RESIDUAL_PAYOUTS_SQL, [supplierId])) as PayoutLine[];
    const covers = settle(lines, payouts).payouts.flatMap((p) =>
      p.covers.map((c) => ({ payout_id: p.id, ...c })),
    );
    if (covers.length === 0) return 0;

    // `created_at = clock_timestamp()`, not the column default `now()` (the
    // transaction start): every row here shares one transaction, so `now()`
    // would tie them and `settle()`'s ORDER BY would fall back to a random
    // uuid within this call. Ordered by ordinality so cover order (bound
    // first, then FIFO) survives into `settle()`'s read.
    await m.query(
      `INSERT INTO payout_allocations (payout_id, intake_id, intake_top_up_id, amount, created_at)
       SELECT u.payout_id, u.intake_id, u.intake_top_up_id, u.amount, clock_timestamp()
         FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::numeric[])
              WITH ORDINALITY AS u(payout_id, intake_id, intake_top_up_id, amount, ord)
        ORDER BY u.ord`,
      [
        covers.map((c) => c.payout_id),
        covers.map((c) => (c.kind === 'intake' ? c.line_id : null)),
        covers.map((c) => (c.kind === 'top_up' ? c.line_id : null)),
        covers.map((c) => c.amount),
      ],
    );
    return covers.length;
  }
}
