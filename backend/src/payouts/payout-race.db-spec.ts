import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

const pointCode = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

/**
 * THE LOCKING PRIMITIVE, NOT THE ROUTE — and the distinction matters, because
 * an earlier version of this header claimed otherwise.
 *
 * Nothing here calls `PayoutsService`: these two tests issue the `SELECT … FOR
 * UPDATE` by hand on two real connections, so what they establish is that the
 * statement `PayoutsService.writePayout` relies on blocks, that it is HELD rather
 * than merely requested, and that contention is per supplier rather than
 * table-wide. Delete the `FOR UPDATE` from the service and this file stays
 * green — it is a test of Postgres semantics and of the shape of the lock, not
 * of the ceiling.
 *
 * The two tests that DO guard the ceiling live elsewhere, and both are
 * necessary:
 *   - `payouts.service.spec.ts` «locks the supplier row BEFORE reading the
 *     debt» — the ORDER, which is what breaks if someone moves the line.
 *   - `documents-pipeline.db-spec.ts` «lets exactly ONE of two simultaneous
 *     payouts through» — the consequence: two requests in flight together
 *     against a debt that admits one, and the second refused with
 *     `PAYOUT_EXCEEDS_DEBT`. That is §11's «blocks AND THEN FAILS».
 */
describe('payout concurrency', () => {
  let ds: DataSource;
  let supplierId: string;

  beforeAll(async () => {
    ds = await openTestDataSource();
    const run = randomUUID();

    const [point] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Race-${run}`, pointCode()],
    );
    const [supplier] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name)
       VALUES ($1, 'Іван', $2) RETURNING id`,
      [point.id, `Гонка-${run}`],
    );
    supplierId = supplier.id;
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('serializes two transactions that lock the same supplier row', async () => {
    const a = ds.createQueryRunner();
    const b = ds.createQueryRunner();
    await a.connect();
    await b.connect();
    await a.startTransaction();
    await b.startTransaction();

    try {
      await a.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId]);

      // B blocks on the same row. Racing it against a timer is what proves the
      // lock is HELD rather than merely requested — without the FOR UPDATE both
      // statements return immediately and `bAcquired` is true at the check.
      let bAcquired = false;
      const bWaiter = b
        .query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId])
        .then(() => {
          bAcquired = true;
        });

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(bAcquired).toBe(false);

      await a.commitTransaction();
      await bWaiter;
      expect(bAcquired).toBe(true);

      await b.rollbackTransaction();
    } finally {
      if (a.isTransactionActive) await a.rollbackTransaction();
      if (b.isTransactionActive) await b.rollbackTransaction();
      await a.release();
      await b.release();
    }
  });

  it('does NOT block payouts to a different supplier', async () => {
    // Contention is per supplier. If this ever fails, someone widened the lock
    // to a table lock and every point in the network now queues behind one
    // busy counter.
    const [other] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name)
       SELECT collection_point_id, 'Інший', $2 FROM suppliers WHERE id = $1 RETURNING id`,
      [supplierId, `Інший-${randomUUID()}`],
    );

    const a = ds.createQueryRunner();
    const b = ds.createQueryRunner();
    await a.connect();
    await b.connect();
    await a.startTransaction();
    await b.startTransaction();

    try {
      await a.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId]);
      // Returns immediately: a different row, a different lock.
      await expect(
        b.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [other.id]),
      ).resolves.toBeDefined();
    } finally {
      await a.rollbackTransaction();
      await b.rollbackTransaction();
      await a.release();
      await b.release();
    }
  });
});
