import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { PointCashService } from './point-cash.service';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * THE FORMULA, AGAINST A REAL POSTGRES. A unit spec can only assert the text
 * of this SQL; what needs testing is what the SQL MEANS, and every scenario
 * below is one branch that would silently return the wrong number if a later
 * reader "tidied" it.
 *
 * Five of the numbered thirteen exist specifically to stop someone harmonising
 * the two opposite readings of `voided_at`: voided PAYOUTS stay subtracted (the
 * money left the drawer), voided TRANSFERS stop being added (no valid document
 * accounts for them). §9.3 — «інакше сторно стає способом красти». Scenario 13 is
 * narrower still: it defends the PLACEMENT of the transfer filter, which no
 * other scenario can distinguish.
 *
 * SINCE THE CASH COUNTS SLICE THE FORMULA IS ANCHORED ON A PHYSICAL COUNT, so
 * every numbered scenario now seeds one — see the note above scenario 1. The
 * nested `count-anchored cash` describe covers the anchoring itself.
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
   * A shift, returned by id — which is what the anchored formula needs, because
   * a count, a payout and a transfer all have to land in the SAME shift for its
   * movements to see them.
   *
   * The shift defaults to CLOSED, and that is load-bearing twice over:
   * `UQ_shifts_open_per_point` is a partial index over `closed_at IS NULL`, so
   * a second open shift at the same point would collide, and
   * `UQ_shifts_point_business_date` is why every scenario that writes two
   * payouts gives them different business dates.
   */
  const shift = async (pointId: string, businessDate: string, closed = true): Promise<string> => {
    const [{ id }] = (await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date,
                           closed_at, closed_by_user_id, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        pointId,
        ownerId,
        businessDate,
        closed ? new Date() : null,
        closed ? ownerId : null,
        closed ? 'closed' : 'open',
      ],
    )) as { id: string }[];
    return id;
  };

  /**
   * A CLOSING count is stamped LATER THAN THE OPENING it closes, and passing
   * this explicitly is not decoration. The anchor's ordering is
   * `business_date DESC, (kind = 'closing') DESC, counted_at DESC`; if both
   * counts of a shift carried the same `counted_at`, removing the middle
   * tiebreak would leave the order undefined and these scenarios would go
   * FLAKY rather than reliably red. Real timestamps make them fail either way.
   */
  const CLOSED_AT = new Date('2026-09-02T18:00:00Z');

  /**
   * A berry count on a shift. `UQ_cash_counts_shift_book_kind` is partial over
   * `kind <> 'midday'`, so one `opening` and one `closing` per shift, and as
   * many `midday` rows as a scenario wants.
   */
  const count = async (
    shiftId: string,
    kind: 'opening' | 'midday' | 'closing',
    counted: string,
    expected: string,
    at = new Date('2026-09-02T07:30:00Z'),
  ): Promise<void> => {
    await ds.query(
      `INSERT INTO cash_counts (shift_id, book, kind, counted_amount, expected_amount,
                                counted_by_user_id, counted_at)
       VALUES ($1, 'berry', $2, $3, $4, $5, $6)`,
      [shiftId, kind, counted, expected, ownerId, at],
    );
  };

  /** Puts a payout into a shift the caller already has. */
  const payoutIn = async (
    shiftId: string,
    amount: string,
    over: Record<string, unknown> = {},
  ): Promise<void> => {
    const [{ id: supplierId }] = (await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, kind, is_active)
       SELECT s.collection_point_id, 'Тест', $2, 'none', true FROM shifts s WHERE s.id = $1
       RETURNING id`,
      [shiftId, randomUUID().slice(0, 8)],
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

  /**
   * EVERY SCENARIO BELOW NOW SEEDS AN ANCHORING COUNT, and the seeding is not
   * ceremony. Since the cash counts slice a point's cash is its latest
   * non-midday COUNT plus, when that count was an `opening`, its own shift's
   * movements — so a document only reaches the figure through the shift the
   * anchor sits on. An `opening` of `'0.00'` on the shift whose `business_date`
   * matches the transfer's `accepted_date` is the smallest fixture that lets
   * these scenarios go on asserting the exact same numbers they asserted when
   * the formula ran from the beginning of time.
   */
  it('1. an accepted transfer adds its cash', async () => {
    const p = await newPoint();
    await count(await shift(p, '2026-09-02'), 'opening', '0.00', '0.00');
    await transfer(p, { cash: '150000.00' });
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('150000.00');
  });

  it('2. a sent transfer adds nothing — §7.9 step 2', async () => {
    const p = await newPoint();
    await count(await shift(p, '2026-09-02'), 'opening', '0.00', '0.00');
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
    await count(await shift(p, '2026-09-02'), 'opening', '0.00', '0.00');
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
    await count(await shift(p, '2026-09-02'), 'opening', '0.00', '0.00');
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
    await count(await shift(p, '2026-09-02'), 'opening', '0.00', '0.00');
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
    // The payout goes into the SAME shift the anchor sits on: movements are
    // shift-bounded, so a payout filed on another day is another shift's
    // business and cannot reach this figure.
    const s = await shift(p, '2026-09-02');
    await count(s, 'opening', '0.00', '0.00');
    await transfer(p, { cash: '1000.00' });
    await payoutIn(s, '250.00');
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('750.00');
  });

  it('7. a VOIDED payout STILL subtracts — the money left the drawer', async () => {
    const p = await newPoint();
    const s = await shift(p, '2026-09-02');
    await count(s, 'opening', '0.00', '0.00');
    await transfer(p, { cash: '1000.00' });
    await payoutIn(s, '250.00', {
      voided_at: new Date(),
      voided_by_user_id: ownerId,
      void_reason: 'помилка',
    });
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('750.00');
  });

  it('8. a voided payout whose cash was physically returned nets to zero', async () => {
    const p = await newPoint();
    const s = await shift(p, '2026-09-02');
    await count(s, 'opening', '0.00', '0.00');
    await transfer(p, { cash: '1000.00' });
    // Handed back the SAME business day, so it re-enters this shift's drawer.
    // A return settled on a later day belongs to that later day's shift — see
    // scenario 11.
    await payoutIn(s, '250.00', {
      voided_at: new Date('2026-09-02T10:00:00Z'),
      voided_by_user_id: ownerId,
      void_reason: 'помилка',
      return_settled_at: new Date('2026-09-02T12:00:00Z'),
      return_settled_by_user_id: ownerId,
    });
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('1000.00');
  });

  /**
   * `as_of` now bounds the ANCHOR by `shifts.business_date` rather than each
   * document by its own date, and the three-shift fixture is what keeps the two
   * assertions meaning what they meant: a day-2 shift that opened on nothing and
   * took 1 000, a day-20 shift that opened on that 1 000 and took 500, and a
   * day-25 shift that opened on the resulting 1 500 and paid 300 out.
   */
  it('9. as_of picks the anchor by business_date and ignores later shifts', async () => {
    const p = await newPoint();
    const day2 = await shift(p, '2026-09-02');
    await count(day2, 'opening', '0.00', '0.00');
    await transfer(p, { cash: '1000.00', accepted_date: '2026-09-02' });

    const day20 = await shift(p, '2026-09-20');
    await count(day20, 'opening', '1000.00', '1000.00');
    await transfer(p, { cash: '500.00', accepted_date: '2026-09-20' });

    const day25 = await shift(p, '2026-09-25');
    await count(day25, 'opening', '1500.00', '1500.00');
    await payoutIn(day25, '300.00');

    await expect(service.cashFor(p, '2026-09-10')).resolves.toBe('1000.00');
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('1200.00');
  });

  it('10. a point with no rows reads "0.00", not "0"', async () => {
    const p = await newPoint();
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('0.00');
  });

  /**
   * THE ONE SCENARIO IN THIS FILE WHOSE RESULT DEPENDS ON `APP_TIMEZONE`, which
   * is what makes the pinned `{ appTimezone: 'Europe/Kyiv' }` above worth
   * pinning. A returned payout re-enters the drawer on the day it was
   * physically handed back — in whichever shift was running that day, not the
   * shift the original payout belonged to — and «that day» is a LOCAL calendar
   * day matched against `shifts.business_date`.
   *
   * 2026-09-04 21:30 UTC is 2026-09-05 00:30 in Kyiv. Read in the session's UTC
   * it lands on the 4th and credits the day-4 shift; read correctly it lands on
   * the 5th and credits the day-5 shift. BOTH assertions flip if the
   * `AT TIME ZONE` cast on `return_settled_at` is dropped — day 4 would read
   * 1000.00 and day 5 would read 750.00, exactly the reverse of what is
   * asserted here — so this scenario cannot be made green by a bare `::date`.
   */
  it('11. a return settled just past local midnight lands in the NEXT day’s shift', async () => {
    const p = await newPoint();
    const day4 = await shift(p, '2026-09-04');
    await count(day4, 'opening', '0.00', '0.00');
    await transfer(p, { cash: '1000.00', accepted_date: '2026-09-04' });
    await payoutIn(day4, '250.00', {
      voided_at: new Date('2026-09-04T12:00:00Z'),
      voided_by_user_id: ownerId,
      void_reason: 'помилка',
      // 2026-09-05 00:30 Europe/Kyiv.
      return_settled_at: new Date('2026-09-04T21:30:00Z'),
      return_settled_by_user_id: ownerId,
    });

    // Day 5 opens on what day 4 closed with, and the cash comes back into it.
    const day5 = await shift(p, '2026-09-05');
    await count(day5, 'opening', '750.00', '750.00', new Date('2026-09-05T07:30:00Z'));

    await expect(service.movementsForShift(day4)).resolves.toBe('750.00');
    await expect(service.movementsForShift(day5)).resolves.toBe('250.00');

    await expect(service.cashFor(p, '2026-09-04')).resolves.toBe('750.00');
    await expect(service.cashFor(p, '2026-09-05')).resolves.toBe('1000.00');
  });

  it('12. defaults as_of to today when it is not given', async () => {
    const p = await newPoint();
    await count(await shift(p, '2026-09-02'), 'opening', '0.00', '0.00');
    await transfer(p, { cash: '1000.00', accepted_date: '2026-09-02' });
    await expect(service.cashFor(p)).resolves.toBe('1000.00');
  });

  /**
   * THIS SCENARIO EXISTS TO FAIL IF `voided_at IS NULL` EVER MOVES INTO THE
   * `CASE`. Scenario 3 does not defend that placement: a voided ACCEPTED
   * transfer yields NULL under either arrangement, so `WHEN t.status =
   * 'accepted' AND t.voided_at IS NULL` would keep it green. The row with no
   * coverage until now is this one — disputed, then RESOLVED, then VOIDED —
   * which under that "tidy" falls through to the `resolved_at IS NOT NULL`
   * arm and goes on adding `resolved_cash` to the drawer forever. That is the
   * theft path §9.3 names. The filter belongs in the outer `WHERE`, where
   * voided beats resolved; nothing but this test says so in code.
   */
  it('13. a RESOLVED dispute that is then voided adds nothing — the void filter must stay in the outer WHERE, not the CASE', async () => {
    const p = await newPoint();
    await count(await shift(p, '2026-09-02'), 'opening', '0.00', '0.00');
    await transfer(p, {
      cash: '150000.00',
      status: 'disputed',
      reported_cash: '140000.00',
      dispute_note: 'мішок легший',
      resolved_cash: '145000.00',
      resolved_crates: 200,
      resolved_by_user_id: ownerId,
      resolved_at: new Date(),
      voided_at: new Date(),
      voided_by_user_id: ownerId,
      void_reason: 'дубль',
    });
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('0.00');
  });

  /**
   * THE RE-ANCHORING ITSELF. Nested rather than top-level so it reuses the
   * fixtures above — a sibling `describe` cannot see the closure they live in.
   */
  describe('PointCashService — count-anchored cash (Postgres)', () => {
    it('a point with NO counts reads 0.00 even when it has accepted transfers', async () => {
      const p = await newPoint();
      await transfer(p, { cash: '150000.00' });
      // The documents are ignored entirely until someone counts the drawer
      // (spec §8). This will look like a regression on deploy and is not one.
      await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('0.00');
    });

    it('after a CLOSING count, cash is that count exactly', async () => {
      const p = await newPoint();
      const s = await shift(p, '2026-09-02');
      await transfer(p, { cash: '1000.00', accepted_date: '2026-09-02' });
      await count(s, 'opening', '500.00', '500.00');
      await count(s, 'closing', '1490.00', '1500.00', CLOSED_AT);
      // 1490 counted, 1500 expected — 10 short, and cash follows the COUNT.
      await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('1490.00');
    });

    it("after an OPENING count, cash is that count plus the shift's movements so far", async () => {
      const p = await newPoint();
      const s = await shift(p, '2026-09-02', false);
      await count(s, 'opening', '500.00', '500.00');
      await transfer(p, { cash: '1000.00', accepted_date: '2026-09-02' });
      await payoutIn(s, '250.00');
      await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('1250.00');
    });

    it('a DEMOTED midday count never becomes the anchor — spec §8', async () => {
      const p = await newPoint();
      const s = await shift(p, '2026-09-02', false);
      await count(s, 'opening', '500.00', '500.00', new Date('2026-09-02T07:30:00Z'));
      await transfer(p, { cash: '1000.00', accepted_date: '2026-09-02' });
      // Newest by counted_at, and it must be ignored: isolating "movements after
      // it" would need a timestamp bound this model does not have.
      await count(s, 'midday', '9999.00', '9999.00', new Date('2026-09-02T11:00:00Z'));
      await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('1500.00');
    });

    it('the first count is the anchor and earlier documents are not double counted', async () => {
      const p = await newPoint();
      await transfer(p, { cash: '9999.00', accepted_date: '2026-08-01' });
      const s = await shift(p, '2026-09-02');
      await count(s, 'opening', '500.00', '500.00');
      await count(s, 'closing', '500.00', '500.00', CLOSED_AT);
      await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('500.00');
    });

    it('movementsForShift signs each term correctly', async () => {
      const p = await newPoint();
      const s = await shift(p, '2026-09-02');
      await transfer(p, { cash: '1000.00', accepted_date: '2026-09-02' });
      await payoutIn(s, '250.00');
      await expect(service.movementsForShift(s)).resolves.toBe('750.00');
    });

    it('movementsForShift keeps both voided readings', async () => {
      const p = await newPoint();
      const s = await shift(p, '2026-09-02');
      await transfer(p, {
        cash: '1000.00',
        accepted_date: '2026-09-02',
        voided_at: new Date(),
        voided_by_user_id: ownerId,
        void_reason: 'дубль',
      });
      await payoutIn(s, '250.00', {
        voided_at: new Date(),
        voided_by_user_id: ownerId,
        void_reason: 'помилка',
      });
      // Voided transfer adds nothing; voided payout STILL subtracts.
      await expect(service.movementsForShift(s)).resolves.toBe('-250.00');
    });

    /**
     * THE RETURN TERM NO LONGER JOINS THROUGH `p.shift_id = <shift>`, so its
     * point-scoping is an explicit condition and this is the only thing that
     * says so in code. Drop `ps.collection_point_id = s.collection_point_id`
     * and a return handed back at ONE point credits every other point that had
     * a shift open that day.
     */
    it("a return settled at another point never credits this point's drawer", async () => {
      const mine = await newPoint();
      const theirs = await newPoint();
      const myShift = await shift(mine, '2026-09-02');
      const theirShift = await shift(theirs, '2026-09-02');

      await payoutIn(theirShift, '250.00', {
        voided_at: new Date('2026-09-02T10:00:00Z'),
        voided_by_user_id: ownerId,
        void_reason: 'помилка',
        return_settled_at: new Date('2026-09-02T12:00:00Z'),
        return_settled_by_user_id: ownerId,
      });

      // Their drawer: paid out and handed back, so it nets to nothing.
      await expect(service.movementsForShift(theirShift)).resolves.toBe('0.00');
      // Mine: untouched. Without the point-scoping this reads '250.00'.
      await expect(service.movementsForShift(myShift)).resolves.toBe('0.00');
    });

    it('a return settled on a LATER day belongs to that day’s shift, not the payout’s', async () => {
      const p = await newPoint();
      const paid = await shift(p, '2026-09-02');
      const returned = await shift(p, '2026-09-05');
      await payoutIn(paid, '250.00', {
        voided_at: new Date('2026-09-02T10:00:00Z'),
        voided_by_user_id: ownerId,
        void_reason: 'помилка',
        return_settled_at: new Date('2026-09-05T09:00:00Z'),
        return_settled_by_user_id: ownerId,
      });

      // The 2nd is already closed and counted; the money was not in that
      // drawer at its closing count and must not be booked back into it.
      await expect(service.movementsForShift(paid)).resolves.toBe('-250.00');
      await expect(service.movementsForShift(returned)).resolves.toBe('250.00');
    });

    it('movementsForShift reads 0.00, not 0, for a shift with nothing in it', async () => {
      const p = await newPoint();
      await expect(service.movementsForShift(await shift(p, '2026-09-02'))).resolves.toBe('0.00');
    });

    it('expectedForOpening is the previous non-midday count, or null for a first count', async () => {
      const p = await newPoint();
      await expect(service.expectedForOpening(p)).resolves.toBeNull();

      const s = await shift(p, '2026-09-02');
      await count(s, 'opening', '500.00', '500.00');
      await count(s, 'closing', '1490.00', '1500.00', CLOSED_AT);
      await expect(service.expectedForOpening(p)).resolves.toBe('1490.00');
    });

    it('expectedForClosing is the opening count plus the movements', async () => {
      const p = await newPoint();
      const s = await shift(p, '2026-09-02');
      await count(s, 'opening', '500.00', '500.00');
      await transfer(p, { cash: '1000.00', accepted_date: '2026-09-02' });
      await payoutIn(s, '250.00');
      await expect(service.expectedForClosing(s)).resolves.toBe('1250.00');
    });

    it('expectedForClosing is null for a shift with no opening count', async () => {
      const p = await newPoint();
      await expect(service.expectedForClosing(await shift(p, '2026-09-02'))).resolves.toBeNull();
    });
  });
});

describe('PointCashService.list (Postgres)', () => {
  // Reuses the outer describe's harness by re-opening its own — see
  // supplier-balance-list.db-spec.ts for the same shape.
  let ds: DataSource;
  let service: PointCashService;
  let ownerId: string;
  let withTarget: string;
  let withoutTarget: string;

  const owner: AuthenticatedUser = {
    sub: 'placeholder',
    username: 'owner',
    role: UserRole.NetworkOwner,
    collection_point_id: null,
  };

  const query = (over: Record<string, unknown> = {}) => ({
    page: 1,
    limit: 50,
    as_of: '2026-09-30',
    ...over,
  });

  /**
   * An `opening` count of `'0.00'` on the shift that took the transfer. The
   * list runs the SAME anchored formula as `cashFor`, so without a count these
   * points would read `'0.00'` however much they had received — see the
   * count-anchored describe above.
   */
  const anchor = async (pointId: string, businessDate: string): Promise<void> => {
    const [{ id: shiftId }] = (await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date,
                           closed_at, closed_by_user_id, status)
       VALUES ($1, $2, $3, now(), $2, 'closed') RETURNING id`,
      [pointId, ownerId, businessDate],
    )) as { id: string }[];
    await ds.query(
      `INSERT INTO cash_counts (shift_id, book, kind, counted_amount, expected_amount,
                                counted_by_user_id, counted_at)
       VALUES ($1, 'berry', 'opening', '0.00', '0.00', $2, $3)`,
      [shiftId, ownerId, new Date('2026-09-02T07:30:00Z')],
    );
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new PointCashService(ds, { appTimezone: 'Europe/Kyiv' });
    const run = randomUUID().slice(0, 8);
    [{ id: ownerId }] = (await ds.query(
      `INSERT INTO users (first_name, last_name, role, is_active)
       VALUES ('Тест', $1, 'network_owner', true) RETURNING id`,
      [`Owner list ${run}`],
    )) as { id: string }[];
    owner.sub = ownerId;

    const mk = async (target: string | null) => {
      const tag = randomUUID().slice(0, 8);
      const [{ id }] = (await ds.query(
        `INSERT INTO collection_points (name, code, kind, target_cash, is_active)
         VALUES ($1, $2, 'reception', $3, true) RETURNING id`,
        [`Точка ${tag}`, `L${tag.slice(0, 6).toUpperCase()}`, target],
      )) as { id: string }[];
      return id;
    };
    withTarget = await mk('500000.00');
    withoutTarget = await mk(null);

    await ds.query(
      `INSERT INTO transfers (collection_point_id, cash, crates, carrier, sent_by_user_id,
                              sent_at, status, accepted_by_user_id, accepted_date, accepted_at)
       VALUES ($1, '1616.10', 0, 'Іван', $2, '2026-09-01T18:00:00Z', 'accepted',
               $2, '2026-09-02', '2026-09-02T07:00:00Z')`,
      [withTarget, ownerId],
    );
    await anchor(withTarget, '2026-09-02');
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('computes the shortfall in Postgres, exact to the kopiyka', async () => {
    const page = await service.list(owner, query({ collection_point_id: withTarget }) as never);
    expect(page.data[0]).toMatchObject({
      target_cash: '500000.00',
      cash: '1616.10',
      shortfall: '498383.90',
    });
  });

  it('KEEPS a point with no target_cash, with a null shortfall — the 09.09.2026 ruling', async () => {
    const page = await service.list(owner, query({ collection_point_id: withoutTarget }) as never);
    expect(page.total).toBe(1);
    expect(page.data[0]).toMatchObject({
      target_cash: null,
      cash: '0.00',
      shortfall: null,
    });
  });

  it('carries the latest transfer state, and null when there is none', async () => {
    const withT = await service.list(owner, query({ collection_point_id: withTarget }) as never);
    expect(withT.data[0].latest_transfer?.status).toBe('accepted');

    const without = await service.list(
      owner,
      query({ collection_point_id: withoutTarget }) as never,
    );
    expect(without.data[0].latest_transfer).toBeNull();
  });

  it('KEEPS A DEACTIVATED POINT, with its cash — §5.6, deactivation is «не видалення»', async () => {
    // The failure this pins: a point retired mid-season still holds whatever
    // was in its drawer. A `cp.is_active = true` filter here would drop both
    // the row and its money from `total`, while `GET /point-cash/:id` went on
    // reporting the same cash — the owner would lose sight of real money and
    // the two reads would disagree. Spec §6.10.
    const tag = randomUUID().slice(0, 8);
    const [{ id: retired }] = (await ds.query(
      `INSERT INTO collection_points (name, code, kind, target_cash, is_active)
       VALUES ($1, $2, 'reception', NULL, false) RETURNING id`,
      [`Точка ${tag}`, `D${tag.slice(0, 6).toUpperCase()}`],
    )) as { id: string }[];

    await ds.query(
      `INSERT INTO transfers (collection_point_id, cash, crates, carrier, sent_by_user_id,
                              sent_at, status, accepted_by_user_id, accepted_date, accepted_at)
       VALUES ($1, '40000.00', 0, 'Іван', $2, '2026-09-01T18:00:00Z', 'accepted',
               $2, '2026-09-02', '2026-09-02T07:00:00Z')`,
      [retired, ownerId],
    );
    await anchor(retired, '2026-09-02');

    const page = await service.list(owner, query({ collection_point_id: retired }) as never);
    expect(page.total).toBe(1);
    expect(page.data[0]).toMatchObject({ collection_point_id: retired, cash: '40000.00' });
  });

  it('pins an operator to their own point regardless of the query', async () => {
    const operator: AuthenticatedUser = {
      sub: ownerId,
      username: 'op',
      role: UserRole.PointOperator,
      collection_point_id: withoutTarget,
    };
    const page = await service.list(
      operator,
      query({ collection_point_id: withTarget }) as never,
    );
    expect(page.data).toHaveLength(1);
    expect(page.data[0].collection_point_id).toBe(withoutTarget);
  });
});
