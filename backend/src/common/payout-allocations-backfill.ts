import { QueryRunner } from 'typeorm';

/**
 * Backfill logic for `1788600000018-PayoutAllocations`, kept OUT of `backend/src/migrations/`
 * on purpose, for two independent reasons:
 *
 *  1. TypeORM's migration loader (`migrations: [".../migrations/[0-9]*{.ts,.js}"]`,
 *     `DirectoryExportedClassesLoader`) treats every function-typed export of a
 *     numeric-prefixed migration file as a migration class and does `new` on it — a
 *     second exported function in that same file crashes EVERY migration run with
 *     "migrationClass is not a constructor".
 *  2. `scripts/verify`'s `migrations` check enforces that `backend/src/migrations/`
 *     holds only migrations and their `*.db-spec.ts` suites — a third kind of file
 *     there is a finding on its own, loader crash or not.
 *
 * Lives in `common/` rather than a money-guarded module (`supplier-balance/`, …) because
 * it is deliberately OUTSIDE that guard: it runs in BigInt kopecks, not through
 * `money.ts`, and imports nothing from the app — a migration must not depend on
 * application code that may change after it ships. A FROZEN copy of `settle()` as of
 * 2026-09-26: bound pass, then FIFO.
 */

type Line = { id: string; kind: 'intake' | 'top_up'; intake_id: string; open: bigint };
type Pay = { id: string; intake_id: string | null; free: bigint };

const kop = (s: string): bigint => {
  const [whole, frac = ''] = s.split('.');
  return BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
};
const uah = (k: bigint): string => `${k / 100n}.${(k % 100n).toString().padStart(2, '0')}`;
const least = (a: bigint, b: bigint): bigint => (a < b ? a : b);

/** Bound pass, then FIFO. Do not edit. */
function frozenSettle(lines: Line[], pays: Pay[]): { payout_id: string; line: Line; amount: bigint }[] {
  const out: { payout_id: string; line: Line; amount: bigint }[] = [];
  const take = (p: Pay, l: Line, amount: bigint): void => {
    p.free -= amount;
    l.open -= amount;
    out.push({ payout_id: p.id, line: l, amount });
  };
  const byIntake = new Map(lines.filter((l) => l.kind === 'intake').map((l) => [l.intake_id, l]));
  for (const p of pays) {
    const l = p.intake_id === null ? undefined : byIntake.get(p.intake_id);
    if (l && l.open > 0n && p.free > 0n) take(p, l, least(p.free, l.open));
  }
  let cursor = 0;
  for (const p of pays) {
    while (p.free > 0n && cursor < lines.length) {
      const l = lines[cursor];
      if (l.open === 0n) {
        cursor += 1;
        continue;
      }
      take(p, l, least(p.free, l.open));
    }
  }
  return out;
}

/**
 * Allocates every live payout of each supplier from scratch. Assumes the suppliers have
 * no live allocation rows yet (true inside `up()`; the db-spec passes fresh suppliers).
 */
export async function backfillPayoutAllocations(
  qr: QueryRunner,
  supplierIds?: string[],
): Promise<number> {
  const suppliers = (await qr.query(
    `SELECT DISTINCT supplier_id FROM payouts
      WHERE voided_at IS NULL AND ($1::uuid[] IS NULL OR supplier_id = ANY($1::uuid[]))`,
    [supplierIds ?? null],
  )) as { supplier_id: string }[];

  let inserted = 0;
  for (const { supplier_id } of suppliers) {
    const lineRows = (await qr.query(
      `SELECT r.id, r.kind, r.intake_id, r.amount FROM (
         SELECT i.id, 'intake' AS kind, i.id AS intake_id, s.business_date, i.created_at,
                i.amount::text AS amount
           FROM intakes i JOIN shifts s ON s.id = i.shift_id
          WHERE i.supplier_id = $1 AND i.voided_at IS NULL
         UNION ALL
         SELECT t.id, 'top_up', t.intake_id, s.business_date, t.created_at, t.amount::text
           FROM intake_top_ups t
           JOIN intakes ti ON ti.id = t.intake_id
           JOIN shifts s ON s.id = ti.shift_id
          WHERE ti.supplier_id = $1 AND ti.voided_at IS NULL AND t.voided_at IS NULL
       ) r ORDER BY r.business_date, r.created_at, r.id`,
      [supplier_id],
    )) as { id: string; kind: 'intake' | 'top_up'; intake_id: string; amount: string }[];
    const payRows = (await qr.query(
      `SELECT p.id, p.intake_id, p.amount::text AS amount
         FROM payouts p JOIN shifts s ON s.id = p.shift_id
        WHERE p.supplier_id = $1 AND p.voided_at IS NULL
        ORDER BY s.business_date, p.created_at, p.id`,
      [supplier_id],
    )) as { id: string; intake_id: string | null; amount: string }[];

    const covers = frozenSettle(
      lineRows.map((r) => ({ id: r.id, kind: r.kind, intake_id: r.intake_id, open: kop(r.amount) })),
      payRows.map((r) => ({ id: r.id, intake_id: r.intake_id, free: kop(r.amount) })),
    );
    for (const c of covers) {
      await qr.query(
        `INSERT INTO payout_allocations (payout_id, intake_id, intake_top_up_id, amount)
         VALUES ($1, $2, $3, $4)`,
        [
          c.payout_id,
          c.line.kind === 'intake' ? c.line.id : null,
          c.line.kind === 'top_up' ? c.line.id : null,
          uah(c.amount),
        ],
      );
    }
    inserted += covers.length;
  }
  return inserted;
}
