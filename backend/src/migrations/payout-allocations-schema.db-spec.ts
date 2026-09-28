import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { backfillPayoutAllocations } from '../common/payout-allocations-backfill';
import { AllocationsService } from '../supplier-balance/services/allocations';

/**
 * The table's constraints, and the backfill over the slice-1 fixture (spec
 * 2026-09-25 settlement §5): P1 1300 bound to voided R2 → whole payout FIFO →
 * R1 1000, T1 200, R3 100. Uuid-scoped: the test database is never truncated.
 */
describe('PayoutAllocations migration', () => {
  let ds: DataSource;
  let run: string;
  let userId: string;
  let pointId: string;
  let seq = 0;

  const shift = async (date: string): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date,
                           closed_at, closed_by_user_id, status)
       VALUES ($1, $2, $3, now(), $2, 'closed') RETURNING id`,
      [pointId, userId, date],
    );
    return row.id as string;
  };
  const supplier = async (): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Ніна', $2, true) RETURNING id`,
      [pointId, `Алок-${run}-${++seq}`],
    );
    return row.id as string;
  };
  const intake = async (s: string, shiftId: string, amount: string, at: string, voided = false) => {
    const [row] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id, created_at,
                            voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, $3, $4, $5, $6,
               CASE WHEN $7 THEN now() END, CASE WHEN $7 THEN $5::uuid END,
               CASE WHEN $7 THEN 'test' END) RETURNING id`,
      [`IN-${run}-${++seq}`, shiftId, s, amount, userId, at, voided],
    );
    return row.id as string;
  };
  const topUp = async (intakeId: string, amount: string, at: string) => {
    const [row] = await ds.query(
      `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id, created_at)
       VALUES ($1, $2, 'доплата', $3, $4) RETURNING id`,
      [intakeId, amount, userId, at],
    );
    return row.id as string;
  };
  const payout = async (
    s: string,
    shiftId: string,
    amount: string,
    intakeId: string | null,
    at: string,
  ) => {
    const [row] = await ds.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id, intake_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [`PO-${run}-${++seq}`, shiftId, s, amount, userId, intakeId, at],
    );
    return row.id as string;
  };
  const rowsOf = (s: string) =>
    ds.query(
      `SELECT a.payout_id, a.intake_id, a.intake_top_up_id, a.amount::text AS amount
         FROM payout_allocations a JOIN payouts p ON p.id = a.payout_id
        WHERE p.supplier_id = $1 AND a.voided_at IS NULL
        ORDER BY a.created_at, a.id`,
      [s],
    );

  beforeAll(async () => {
    ds = await openTestDataSource();
    run = randomUUID();
    const [point] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Алокації-${run}`, `A${run.slice(0, 4).toUpperCase()}`],
    );
    pointId = point.id;
    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role) VALUES ('Ніна', 'Керівник', 'network_owner') RETURNING id`,
    );
    userId = user.id;
  });

  afterAll(async () => {
    await ds.destroy();
  });

  it('refuses a row with no target, with two targets, or with a non-positive amount', async () => {
    const s = await supplier();
    const sh = await shift('2026-07-01');
    const r = await intake(s, sh, '100.00', '2026-07-01T08:00:00Z');
    const t = await topUp(r, '10.00', '2026-07-01T09:00:00Z');
    const p = await payout(s, sh, '50.00', null, '2026-07-01T10:00:00Z');
    const insert = (i: string | null, tu: string | null, amount: string) =>
      ds.query(
        `INSERT INTO payout_allocations (payout_id, intake_id, intake_top_up_id, amount)
         VALUES ($1, $2, $3, $4)`,
        [p, i, tu, amount],
      );
    await expect(insert(null, null, '1.00')).rejects.toThrow(/CHK_payout_allocations_one_target/);
    await expect(insert(r, t, '1.00')).rejects.toThrow(/CHK_payout_allocations_one_target/);
    await expect(insert(r, null, '0.00')).rejects.toThrow(/CHK_payout_allocations_amount/);
  });

  it('backfills bound first, then FIFO, skipping voided documents', async () => {
    const s = await supplier();
    const s0712 = await shift('2026-07-12');
    const s0715 = await shift('2026-07-15');
    const s0804 = await shift('2026-08-04');
    const r1 = await intake(s, s0712, '1000.00', '2026-07-12T08:00:00Z');
    const t1 = await topUp(r1, '200.00', '2026-08-20T12:00:00Z');
    const r2 = await intake(s, s0715, '300.00', '2026-07-15T08:00:00Z', true);
    const r3 = await intake(s, s0715, '500.00', '2026-07-15T09:00:00Z');
    const p1 = await payout(s, s0804, '1300.00', r2, '2026-08-04T10:00:00Z');

    const qr = ds.createQueryRunner();
    try {
      await expect(backfillPayoutAllocations(qr, [s])).resolves.toBe(3);
    } finally {
      await qr.release();
    }
    const rows = await rowsOf(s);
    // Order-free: the backfill inserts in cover order, but created_at is one statement time.
    expect(rows).toEqual(
      expect.arrayContaining([
        { payout_id: p1, intake_id: r1, intake_top_up_id: null, amount: '1000.00' },
        { payout_id: p1, intake_id: null, intake_top_up_id: t1, amount: '200.00' },
        { payout_id: p1, intake_id: r3, intake_top_up_id: null, amount: '100.00' },
      ]),
    );
    expect(rows).toHaveLength(3);
  });

  it('a bound payout covers its own receipt before older debt', async () => {
    const s = await supplier();
    const sh1 = await shift('2026-07-20');
    const sh2 = await shift('2026-07-21');
    const old = await intake(s, sh1, '1000.00', '2026-07-20T08:00:00Z');
    const r = await intake(s, sh2, '500.00', '2026-07-21T08:00:00Z');
    const p = await payout(s, sh2, '700.00', r, '2026-07-21T08:01:00Z');

    const qr = ds.createQueryRunner();
    try {
      await backfillPayoutAllocations(qr, [s]);
    } finally {
      await qr.release();
    }
    expect(await rowsOf(s)).toEqual(
      expect.arrayContaining([
        { payout_id: p, intake_id: r, intake_top_up_id: null, amount: '500.00' },
        { payout_id: p, intake_id: old, intake_top_up_id: null, amount: '200.00' },
      ]),
    );
  });

  it('the frozen backfill and the live allocator write the same rows over the same documents', async () => {
    // A fresh point per build() call: both build the SAME dates (2026-08-01/02), and
    // shifts.UQ_shifts_point_business_date is one shift per (point, date) — sharing the
    // suite's own `pointId` across both calls would collide on those two dates.
    const build = async () => {
      const [pt] = await ds.query(
        `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
        [`Крос-${run}-${++seq}`, `X${run.slice(0, 3).toUpperCase()}${seq}`],
      );
      const localShift = async (date: string): Promise<string> => {
        const [row] = await ds.query(
          `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date,
                               closed_at, closed_by_user_id, status)
           VALUES ($1, $2, $3, now(), $2, 'closed') RETURNING id`,
          [pt.id, userId, date],
        );
        return row.id as string;
      };
      const s = await supplier();
      const d1 = await localShift('2026-08-01');
      const d2 = await localShift('2026-08-02');
      const a = await intake(s, d1, '400.00', '2026-08-01T08:00:00Z');
      const b = await intake(s, d1, '300.00', '2026-08-01T09:00:00Z', true);
      const t = await topUp(a, '50.00', '2026-08-05T08:00:00Z');
      const c = await intake(s, d2, '200.00', '2026-08-02T08:00:00Z');
      const p1 = await payout(s, d2, '380.00', c, '2026-08-02T08:01:00Z');
      const p2 = await payout(s, d2, '100.00', b, '2026-08-02T09:00:00Z');
      return {
        s,
        names: new Map([
          [a, 'a'],
          [t, 't'],
          [c, 'c'],
          [p1, 'p1'],
          [p2, 'p2'],
        ]),
      };
    };
    const shape = async (s: string, names: Map<string, string>) =>
      (await rowsOf(s))
        .map(
          (r: {
            payout_id: string;
            intake_id: string | null;
            intake_top_up_id: string | null;
            amount: string;
          }) =>
            `${names.get(r.payout_id)}→${names.get((r.intake_id ?? r.intake_top_up_id) as string)}:${r.amount}`,
        )
        .sort();

    const frozen = await build();
    const qr = ds.createQueryRunner();
    try {
      await backfillPayoutAllocations(qr, [frozen.s]);
    } finally {
      await qr.release();
    }
    const live = await build();
    await ds.transaction(async (m) => {
      const alloc = new AllocationsService();
      await alloc.lockSupplier(m, live.s);
      await alloc.allocate(m, live.s);
    });
    expect(await shape(frozen.s, frozen.names)).toEqual(await shape(live.s, live.names));
  });
});
