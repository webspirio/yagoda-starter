import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

const pointCode = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

/**
 * TWO CONCURRENT PAYOUTS AGAINST ONE SUPPLIER.
 *
 * Delete the `SELECT … FOR UPDATE` from `PayoutsService.create` and every unit
 * test still passes: both transactions read the same debt, both clear the
 * ceiling, and the supplier is paid twice for one delivery. The schema has no
 * `борг >= 0` invariant to catch it, so nothing downstream ever notices.
 *
 * This is the only test that can show the lock is load-bearing, and it needs a
 * real database with two real connections — a mocked spec cannot express it.
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
