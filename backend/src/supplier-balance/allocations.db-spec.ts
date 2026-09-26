import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { AllocationsService } from './allocations.service';
import { allocationViolations } from '../testing/allocation-invariants';
import { seededRandom } from '../testing/seeded-random';

/**
 * The live allocator (spec 2026-09-26 §4). Every event below is its own
 * transaction — `lockSupplier` → write → `allocate` — mirroring exactly what
 * a real write path does. `created_at = clock_timestamp()` on every insert
 * (not the column default `now()`, which is the TRANSACTION start) so two
 * inserts in the same event still queue by real time rather than tie and
 * fall back to a random uuid order.
 */
describe('AllocationsService (db)', () => {
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
  const intake = async (m: EntityManager, s: string, shiftId: string, amount: string): Promise<string> => {
    const [row] = await m.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp()) RETURNING id`,
      [`IN-${run}-${++seq}`, shiftId, s, amount, userId],
    );
    return row.id as string;
  };
  const topUp = async (m: EntityManager, intakeId: string, amount: string): Promise<string> => {
    const [row] = await m.query(
      `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id, created_at)
       VALUES ($1, $2, 'доплата', $3, clock_timestamp()) RETURNING id`,
      [intakeId, amount, userId],
    );
    return row.id as string;
  };
  const payout = async (
    m: EntityManager,
    s: string,
    shiftId: string,
    amount: string,
    intakeId: string | null,
  ): Promise<string> => {
    const [row] = await m.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id, intake_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp()) RETURNING id`,
      [`PO-${run}-${++seq}`, shiftId, s, amount, userId, intakeId],
    );
    return row.id as string;
  };

  const alloc = new AllocationsService();
  const event = (supplierId: string, write: (m: EntityManager) => Promise<void>) =>
    ds.transaction(async (m) => {
      await alloc.lockSupplier(m, supplierId);
      await write(m);
      await alloc.allocate(m, supplierId);
    });
  const voidDoc =
    (table: 'intakes' | 'payouts' | 'intake_top_ups', id: string) =>
    (m: EntityManager): Promise<unknown[]> =>
      m.query(
        `UPDATE ${table} SET voided_at = now(), voided_by_user_id = $2, void_reason = 'test' WHERE id = $1`,
        [id, userId],
      );
  const live = (s: string) =>
    ds.query(
      `SELECT a.id, a.payout_id, a.intake_id, a.intake_top_up_id, a.amount::text AS amount
         FROM payout_allocations a JOIN payouts p ON p.id = a.payout_id
        WHERE p.supplier_id = $1 AND a.voided_at IS NULL ORDER BY a.created_at, a.id`,
      [s],
    );

  beforeAll(async () => {
    ds = await openTestDataSource();
    run = randomUUID();
    const [point] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Алокатор-${run}`, `B${run.slice(0, 4).toUpperCase()}`],
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

  it('frozen: a void re-routes freed money by NEW rows and leaves others untouched', async () => {
    const s = await supplier();
    const sh = await shift('2026-06-01');
    let r1 = '', r2 = '', p1 = '', p2 = '';
    await event(s, async (m) => { r1 = await intake(m, s, sh, '100.00'); });
    await event(s, async (m) => { p1 = await payout(m, s, sh, '60.00', null); });
    await event(s, async (m) => { r2 = await intake(m, s, sh, '100.00'); });
    await event(s, async (m) => { p2 = await payout(m, s, sh, '100.00', null); });
    // p1→r1 60, p2→r1 40, p2→r2 60
    const before = await live(s);
    const p2r2 = before.find((a: { payout_id: string; intake_id: string }) => a.payout_id === p2 && a.intake_id === r2);
    expect(p2r2.amount).toBe('60.00');

    await event(s, async (m) => { await voidDoc('intakes', r1)(m); await alloc.release(m, { intakeId: r1 }); });
    const after = await live(s);
    // The p2→r2 60 row is the SAME row, still live; p1's freed 60 covers r2's last 40 by a new row.
    expect(after.find((a: { id: string }) => a.id === p2r2.id)).toEqual(p2r2);
    expect(after).toEqual(expect.arrayContaining([
      expect.objectContaining({ payout_id: p1, intake_id: r2, amount: '40.00' }),
    ]));
    expect(after).toHaveLength(2);
    expect(await ds.transaction((m) => allocationViolations(m, s))).toEqual([]);
  });

  it('keep: a bound payout whose receipt is voided frees its money, and the next receipt takes it', async () => {
    const s = await supplier();
    const sh = await shift('2026-06-02');
    let old = '', r = '', r3 = '';
    await event(s, async (m) => { old = await intake(m, s, sh, '1000.00'); });
    await event(s, async (m) => {
      r = await intake(m, s, sh, '500.00');
      await payout(m, s, sh, '1500.00', r);
    });
    await event(s, async (m) => { await voidDoc('intakes', r)(m); await alloc.release(m, { intakeId: r }); });
    const settled = await ds.transaction((m) => allocationViolations(m, s));
    expect(settled).toEqual([]);
    await event(s, async (m) => { r3 = await intake(m, s, sh, '300.00'); });
    expect(await live(s)).toEqual(expect.arrayContaining([
      expect.objectContaining({ intake_id: old, amount: '1000.00' }),
      expect.objectContaining({ intake_id: r3, amount: '300.00' }),
    ]));
    expect(await ds.transaction((m) => allocationViolations(m, s))).toEqual([]);
  });

  it('voiding a top-up releases only its rows', async () => {
    const s = await supplier();
    const sh = await shift('2026-06-03');
    let r = '', t = '';
    await event(s, async (m) => { r = await intake(m, s, sh, '100.00'); t = await topUp(m, r, '50.00'); });
    await event(s, async (m) => { await payout(m, s, sh, '150.00', null); });
    await event(s, async (m) => { await voidDoc('intake_top_ups', t)(m); await alloc.release(m, { topUpId: t }); });
    const rows = await live(s);
    expect(rows).toEqual([expect.objectContaining({ intake_id: r, amount: '100.00' })]);
    expect(await ds.transaction((m) => allocationViolations(m, s))).toEqual([]);
  });

  it('top-up on a voided receipt gets nothing', async () => {
    const s = await supplier();
    const sh = await shift('2026-06-04');
    let r = '';
    await event(s, async (m) => { r = await intake(m, s, sh, '100.00'); });
    await event(s, async (m) => { await voidDoc('intakes', r)(m); await alloc.release(m, { intakeId: r }); });
    await event(s, async (m) => { await payout(m, s, sh, '40.00', null); });
    await event(s, async (m) => { await topUp(m, r, '70.00'); });
    const rows = await live(s);
    expect(rows).toEqual([]);
    expect(await ds.transaction((m) => allocationViolations(m, s))).toEqual([]);
  });

  it('allocate twice in a row writes nothing the second time', async () => {
    const s = await supplier();
    const sh = await shift('2026-06-05');
    await event(s, async (m) => { await intake(m, s, sh, '100.00'); await payout(m, s, sh, '30.00', null); });
    await expect(ds.transaction(async (m) => { await alloc.lockSupplier(m, s); return alloc.allocate(m, s); })).resolves.toBe(0);
  });

  it('a seeded random sequence of 40 events keeps all four invariants after every event', async () => {
    const s = await supplier();
    const sh = await shift('2026-06-06');
    const { pick, cash, index } = seededRandom(20260926);
    const intakes: string[] = [];
    const topUps: string[] = [];
    const payouts: string[] = [];
    for (let i = 0; i < 40; i++) {
      const kind = pick(['intake', 'intake', 'payout', 'payout', 'bound', 'topUp', 'voidIntake', 'voidPayout', 'voidTopUp']);
      await event(s, async (m) => {
        if (kind === 'intake' || intakes.length === 0) intakes.push(await intake(m, s, sh, cash()));
        else if (kind === 'payout') payouts.push(await payout(m, s, sh, cash(), null));
        else if (kind === 'bound') payouts.push(await payout(m, s, sh, cash(), pick(intakes)));
        else if (kind === 'topUp') topUps.push(await topUp(m, pick(intakes), cash()));
        else if (kind === 'voidIntake') {
          const id = intakes.splice(index(intakes.length), 1)[0];
          await voidDoc('intakes', id)(m);
          await alloc.release(m, { intakeId: id });
        } else if (kind === 'voidPayout' && payouts.length > 0) {
          const id = payouts.splice(index(payouts.length), 1)[0];
          await voidDoc('payouts', id)(m);
          await alloc.release(m, { payoutId: id });
        } else if (kind === 'voidTopUp' && topUps.length > 0) {
          const id = topUps.splice(index(topUps.length), 1)[0];
          await voidDoc('intake_top_ups', id)(m);
          await alloc.release(m, { topUpId: id });
        }
      });
      expect({ step: i, kind, violations: await ds.transaction((m) => allocationViolations(m, s)) })
        .toEqual({ step: i, kind, violations: [] });
    }
  });
});
