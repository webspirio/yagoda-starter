import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { PointCashService } from './point-cash.service';

/**
 * THE FORMULA, AGAINST A REAL POSTGRES. A unit spec can only assert the text
 * of this SQL; what needs testing is what the SQL MEANS, and every scenario
 * below is one branch that would silently return the wrong number if a later
 * reader "tidied" it.
 *
 * Four of the twelve exist specifically to stop someone harmonising the two
 * opposite readings of `voided_at`: voided PAYOUTS stay subtracted (the money
 * left the drawer), voided TRANSFERS stop being added (no valid document
 * accounts for them). §9.3 — «інакше сторно стає способом красти».
 *
 * THE TIMEZONE IS PINNED, NOT INHERITED. The service is constructed with an
 * explicit `{ appTimezone: 'Europe/Kyiv' }` for EVERY scenario, not only
 * scenario 11. This repo's `.env` really does set `APP_TIMEZONE=UTC` while
 * `.env.example` and the Joi default say `Europe/Kyiv`, and "fix the
 * environment" is the wrong repair: editing `.env` would silently change how
 * every shift's business date is filed across the whole app, and a spec whose
 * subject IS timezone handling must state the zone it is testing rather than
 * borrow one.
 */
describe('PointCashService.cashFor (Postgres)', () => {
  let ds: DataSource;
  let service: PointCashService;
  let run: string;
  let ownerId: string;

  /** A fresh point per scenario, so nothing leaks between them. */
  const newPoint = async (targetCash: string | null = null): Promise<string> => {
    const tag = randomUUID().slice(0, 8);
    const [{ id }] = (await ds.query(
      `INSERT INTO collection_points (name, code, kind, target_cash, is_active)
       VALUES ($1, $2, 'reception', $3, true) RETURNING id`,
      [`Точка ${tag}`, `T${tag.slice(0, 6).toUpperCase()}`, targetCash],
    )) as { id: string }[];
    return id;
  };

  const transfer = async (
    pointId: string,
    over: Record<string, unknown> = {},
  ): Promise<string> => {
    const row: Record<string, unknown> = {
      collection_point_id: pointId,
      cash: '1000.00',
      crates: 0,
      carrier: 'Іван, Ducato',
      sent_by_user_id: ownerId,
      sent_at: new Date('2026-09-01T18:00:00Z'),
      status: 'accepted',
      accepted_by_user_id: ownerId,
      accepted_date: '2026-09-02',
      accepted_at: new Date('2026-09-02T07:00:00Z'),
      ...over,
    };
    const keys = Object.keys(row);
    const [{ id }] = (await ds.query(
      `INSERT INTO transfers (${keys.map((k) => `"${k}"`).join(', ')})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      keys.map((k) => row[k]),
    )) as { id: string }[];
    return id;
  };

  /**
   * A payout needs a shift, which is where its point and business date live.
   *
   * The shift is inserted CLOSED, and that is load-bearing twice over:
   * `UQ_shifts_open_per_point` is a partial index over `closed_at IS NULL`, so
   * a second open shift at the same point would collide, and
   * `UQ_shifts_point_business_date` is why every scenario that writes two
   * payouts gives them different business dates.
   */
  const payout = async (
    pointId: string,
    businessDate: string,
    amount: string,
    over: Record<string, unknown> = {},
  ): Promise<void> => {
    const [{ id: shiftId }] = (await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date,
                           closed_at, closed_by_user_id, status)
       VALUES ($1, $2, $3, now(), $2, 'closed') RETURNING id`,
      [pointId, ownerId, businessDate],
    )) as { id: string }[];

    const [{ id: supplierId }] = (await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, kind, is_active)
       VALUES ($1, 'Тест', $2, 'none', true) RETURNING id`,
      [pointId, randomUUID().slice(0, 8)],
    )) as { id: string }[];

    const row: Record<string, unknown> = {
      code: `PO-${randomUUID().slice(0, 12)}`,
      shift_id: shiftId,
      supplier_id: supplierId,
      amount,
      paid_by_user_id: ownerId,
      ...over,
    };
    const keys = Object.keys(row);
    await ds.query(
      `INSERT INTO payouts (${keys.map((k) => `"${k}"`).join(', ')})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
      keys.map((k) => row[k]),
    );
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new PointCashService(ds, { appTimezone: 'Europe/Kyiv' });
    run = randomUUID().slice(0, 8);
    [{ id: ownerId }] = (await ds.query(
      `INSERT INTO users (first_name, last_name, role, is_active)
       VALUES ('Тест', $1, 'network_owner', true) RETURNING id`,
      [`Owner ${run}`],
    )) as { id: string }[];
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('1. an accepted transfer adds its cash', async () => {
    const p = await newPoint();
    await transfer(p, { cash: '150000.00' });
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('150000.00');
  });

  it('2. a sent transfer adds nothing — §7.9 step 2', async () => {
    const p = await newPoint();
    await transfer(p, {
      status: 'sent',
      accepted_by_user_id: null,
      accepted_date: null,
      accepted_at: null,
    });
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('0.00');
  });

  it('3. a VOIDED accepted transfer adds nothing, though its status is still accepted', async () => {
    const p = await newPoint();
    await transfer(p, {
      cash: '150000.00',
      voided_at: new Date(),
      voided_by_user_id: ownerId,
      void_reason: 'дубль',
    });
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('0.00');
  });

  it('4. an UNRESOLVED dispute adds reported_cash — the 09.09.2026 ruling', async () => {
    const p = await newPoint();
    await transfer(p, {
      cash: '150000.00',
      status: 'disputed',
      reported_cash: '140000.00',
      reported_crates: 195,
      dispute_note: 'мішок легший',
    });
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('140000.00');
  });

  it('5. a RESOLVED dispute adds resolved_cash, not reported_cash', async () => {
    const p = await newPoint();
    await transfer(p, {
      cash: '150000.00',
      status: 'disputed',
      reported_cash: '140000.00',
      dispute_note: 'мішок легший',
      resolved_cash: '145000.00',
      resolved_crates: 200,
      resolved_by_user_id: ownerId,
      resolved_at: new Date(),
    });
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('145000.00');
  });

  it('6. a payout subtracts', async () => {
    const p = await newPoint();
    await transfer(p, { cash: '1000.00' });
    await payout(p, '2026-09-03', '250.00');
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('750.00');
  });

  it('7. a VOIDED payout STILL subtracts — the money left the drawer', async () => {
    const p = await newPoint();
    await transfer(p, { cash: '1000.00' });
    await payout(p, '2026-09-03', '250.00', {
      voided_at: new Date(),
      voided_by_user_id: ownerId,
      void_reason: 'помилка',
    });
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('750.00');
  });

  it('8. a voided payout whose cash was physically returned nets to zero', async () => {
    const p = await newPoint();
    await transfer(p, { cash: '1000.00' });
    await payout(p, '2026-09-03', '250.00', {
      voided_at: new Date('2026-09-03T12:00:00Z'),
      voided_by_user_id: ownerId,
      void_reason: 'помилка',
      return_settled_at: new Date('2026-09-04T09:00:00Z'),
      return_settled_by_user_id: ownerId,
    });
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('1000.00');
  });

  it('9. as_of excludes a later accepted_date and a later business_date', async () => {
    const p = await newPoint();
    await transfer(p, { cash: '1000.00', accepted_date: '2026-09-02' });
    await transfer(p, { cash: '500.00', accepted_date: '2026-09-20' });
    await payout(p, '2026-09-25', '300.00');

    await expect(service.cashFor(p, '2026-09-10')).resolves.toBe('1000.00');
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('1200.00');
  });

  it('10. a point with no rows reads "0.00", not "0"', async () => {
    const p = await newPoint();
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('0.00');
  });

  it('11. a settlement at 23:30 local lands on that local day, not the next', async () => {
    const p = await newPoint();
    await transfer(p, { cash: '1000.00' });
    // 2026-09-04 23:30 Europe/Kyiv is 2026-09-04 20:30 UTC. A bare ::date in
    // a UTC session would still read the 4th, so the test that bites is the
    // one just past midnight local: 2026-09-05 00:30 Kyiv = 2026-09-04 21:30
    // UTC, which a UTC ::date misfiles onto the 4th.
    await payout(p, '2026-09-03', '250.00', {
      voided_at: new Date('2026-09-03T12:00:00Z'),
      voided_by_user_id: ownerId,
      void_reason: 'помилка',
      return_settled_at: new Date('2026-09-04T21:30:00Z'),
      return_settled_by_user_id: ownerId,
    });

    // The settlement happened on the 5th LOCAL, so as of the 4th it has not
    // happened yet and the payout is still subtracted.
    await expect(service.cashFor(p, '2026-09-04')).resolves.toBe('750.00');
    await expect(service.cashFor(p, '2026-09-05')).resolves.toBe('1000.00');
  });

  it('12. defaults as_of to today when it is not given', async () => {
    const p = await newPoint();
    await transfer(p, { cash: '1000.00', accepted_date: '2026-09-02' });
    await expect(service.cashFor(p)).resolves.toBe('1000.00');
  });
});
