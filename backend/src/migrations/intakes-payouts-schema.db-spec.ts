import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/**
 * Constraint proofs for the five document tables. Every fixture value carries a
 * per-RUN uuid: `app_test` persists between runs and this suite never
 * truncates, so a literal would pass on a fresh database and then fail on every
 * later run with a duplicate-key error from the WRONG insert. Same convention
 * as `suppliers-prices-schema.db-spec.ts`.
 *
 * SEVERAL TESTS HERE ARE INVERTED — they assert that a constraint is ABSENT.
 * Those exist because a well-meaning `migration:generate` run, or a reviewer
 * "tidying up", would add the missing constraint and silently break a rule the
 * DBML argues for at length. Read the comment on each before deleting one.
 */
describe('YagodaIntakesAndPayouts', () => {
  let ds: DataSource;
  let run: string;
  let short: string;
  let pointA: string;
  let pointB: string;
  let userId: string;
  let supplierA: string;
  let gradeId: string;
  let tareId: string;

  const closeShift = (id: string) =>
    ds.query(
      `UPDATE shifts SET closed_at = now(), closed_by_user_id = $2, status = 'closed' WHERE id = $1`,
      [id, userId],
    );

  /**
   * Closes whatever is open at the point before opening the next shift.
   *
   * NOT a convenience — it is `UQ_shifts_open_per_point` being obeyed. §7.8
   * allows exactly one open shift per point at a time, so a fixture that opens
   * a second one is not "setting up test data", it is doing the thing the index
   * exists to forbid. The blocks below each want their own shift, and this is
   * the only lawful way to give them one.
   */
  const openShift = async (point: string, date: string): Promise<string> => {
    await ds.query(
      `UPDATE shifts SET closed_at = now(), closed_by_user_id = $2, status = 'closed'
        WHERE collection_point_id = $1 AND closed_at IS NULL`,
      [point, userId],
    );
    const rows: { id: string }[] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
       VALUES ($1, $2, $3) RETURNING id`,
      [point, userId, date],
    );
    return rows[0].id;
  };

  const insertIntake = (shift: string, code: string, amount = '100.00'): Promise<string> =>
    ds
      .query(
        `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [code, shift, supplierA, amount, userId],
      )
      .then((rows: { id: string }[]) => rows[0].id);

  const insertPayout = (shift: string, code: string, amount = '50.00'): Promise<string> =>
    ds
      .query(
        `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [code, shift, supplierA, amount, userId],
      )
      .then((rows: { id: string }[]) => rows[0].id);

  beforeAll(async () => {
    ds = await openTestDataSource();
    run = randomUUID();
    short = run.slice(0, 4).toUpperCase();

    const [a] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Точка А-${run}`, `A${short}`],
    );
    const [b] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Точка Б-${run}`, `B${short}`],
    );
    pointA = a.id;
    pointB = b.id;

    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role)
       VALUES ('Оксана', 'Приймальник', 'network_owner') RETURNING id`,
    );
    userId = user.id;

    const [supplier] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name)
       VALUES ($1, 'Іван', $2) RETURNING id`,
      [pointA, `Коваль-${run}`],
    );
    supplierA = supplier.id;

    const [product] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [
      `Малина-${run}`,
    ]);
    const [grade] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, $2) RETURNING id`,
      [product.id, `1 сорт-${run}`],
    );
    gradeId = grade.id;

    const [tare] = await ds.query(
      `INSERT INTO tare_types (name, weight_kg, deposit_price, is_crate)
       VALUES ($1, '1.20', '0.00', true) RETURNING id`,
      [`Ящик-${run}`],
    );
    tareId = tare.id;
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it.each(['shifts', 'intakes', 'intake_items', 'intake_item_tare_types', 'payouts'])(
    'creates the %s table',
    async (table) => {
      const [row] = await ds.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [
        `public.${table}`,
      ]);
      expect(row.present).toBe(true);
    },
  );

  describe('collection_points.code', () => {
    it('is NOT NULL, unique and upper-alphanumeric', async () => {
      await expect(
        ds.query(`INSERT INTO collection_points (name, code) VALUES ($1, NULL)`, [`X-${run}`]),
      ).rejects.toThrow(/null value|not-null/i);

      await expect(
        ds.query(`INSERT INTO collection_points (name, code) VALUES ($1, 'kpg')`, [`Y-${run}`]),
      ).rejects.toThrow(/CHK_collection_points_code/);

      await expect(
        ds.query(`INSERT INTO collection_points (name, code) VALUES ($1, $2)`, [
          `Z-${run}`,
          `A${short}`,
        ]),
      ).rejects.toThrow(/UQ_collection_points_code/);
    });

    it('backfilled every pre-existing row', async () => {
      const [row] = await ds.query(
        `SELECT count(*)::int AS missing FROM collection_points WHERE code IS NULL`,
      );
      expect(row.missing).toBe(0);
    });
  });

  describe('shifts', () => {
    it('allows only ONE OPEN shift per point, whatever the date', async () => {
      const first = await openShift(pointB, '2026-06-01');
      // RAW insert, bypassing openShift's close-first helper — otherwise this
      // test would prove only that the helper works.
      const openAgain = () =>
        ds.query(
          `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
           VALUES ($1, $2, $3) RETURNING id`,
          [pointB, userId, '2026-06-02'],
        );
      // A second open shift at the same point on a DIFFERENT day is still
      // refused: §7.8, «дві відкриті зміни це дві книги на одну шухляду».
      await expect(openAgain()).rejects.toThrow(/UQ_shifts_open_per_point/);
      await closeShift(first);
      // With the first one closed, the next day opens normally.
      const second = await openShift(pointB, '2026-06-02');
      expect(second).toBeTruthy();
      await closeShift(second);
    });

    it('allows only ONE shift per point per business_date, even after closing', async () => {
      // Spec §8.1 — an ADDITION to the DBML, which writes this index
      // non-unique. It is what `POST /shifts/:id/reopen` exists to survive.
      const first = await openShift(pointB, '2026-06-03');
      await closeShift(first);
      await expect(openShift(pointB, '2026-06-03')).rejects.toThrow(
        /UQ_shifts_point_business_date/,
      );
    });

    it('refuses a closed_at without a closer and vice versa', async () => {
      const shift = await openShift(pointB, '2026-06-04');
      await expect(
        ds.query(`UPDATE shifts SET closed_at = now(), status = 'closed' WHERE id = $1`, [shift]),
      ).rejects.toThrow(/CHK_shifts_closed_pair/);
      await closeShift(shift);
    });

    it('ties status to closed_at without forbidding awaiting_explanation later', async () => {
      const shift = await openShift(pointB, '2026-06-05');
      // open + closed_at is incoherent
      await expect(
        ds.query(`UPDATE shifts SET closed_at = now(), closed_by_user_id = $2 WHERE id = $1`, [
          shift,
          userId,
        ]),
      ).rejects.toThrow(/CHK_shifts_open_status/);
      // BUT the enum value this slice cannot reach must still be STORABLE, or
      // the cash_counts slice needs a migration to use its own column.
      await ds.query(
        `UPDATE shifts SET closed_at = now(), closed_by_user_id = $2,
                           status = 'awaiting_explanation', explanation = 'розбіжність 350 ₴'
          WHERE id = $1`,
        [shift, userId],
      );
      const [row] = await ds.query(`SELECT status, explanation FROM shifts WHERE id = $1`, [shift]);
      expect(row.status).toBe('awaiting_explanation');
      expect(row.explanation).toBe('розбіжність 350 ₴');
    });

    it('has NO void_* columns — a shift is reopened, not voided', async () => {
      const [row] = await ds.query(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_name = 'shifts'
            AND column_name IN ('voided_at','voided_by_user_id','void_reason')`,
      );
      expect(row.n).toBe(0);
    });

    it('has NO opened_at — created_at is the open instant (spec §8.3)', async () => {
      const [row] = await ds.query(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_name = 'shifts' AND column_name = 'opened_at'`,
      );
      expect(row.n).toBe(0);
    });
  });

  describe('void trios', () => {
    let shift: string;
    beforeAll(async () => {
      shift = await openShift(pointA, '2026-07-01');
    });

    it.each(['intakes', 'payouts'])('%s refuses a partial void trio', async (table) => {
      const id =
        table === 'intakes'
          ? await insertIntake(shift, `${short}-IN-partial`)
          : await insertPayout(shift, `${short}-PO-partial`);

      // §9.3 makes the reason MANDATORY. Two of three is the shape a hand-run
      // UPDATE produces, and it is exactly what must not be storable.
      await expect(
        ds.query(`UPDATE ${table} SET voided_at = now(), voided_by_user_id = $2 WHERE id = $1`, [
          id,
          userId,
        ]),
      ).rejects.toThrow(/void_trio/);

      await ds.query(
        `UPDATE ${table} SET voided_at = now(), voided_by_user_id = $2, void_reason = 'помилка'
          WHERE id = $1`,
        [id, userId],
      );
      const [row] = await ds.query(`SELECT void_reason FROM ${table} WHERE id = $1`, [id]);
      expect(row.void_reason).toBe('помилка');
    });
  });

  describe('payouts return settlement', () => {
    let shift: string;
    beforeAll(async () => {
      shift = await openShift(pointA, '2026-07-02');
    });

    it('cannot be settled unless the payout is voided', async () => {
      const id = await insertPayout(shift, `${short}-PO-settle-a`);
      // §9.3 — «каса НЕ виросла на 8 000… інакше сторно стає способом красти».
      // Settling a LIVE payout would claim money came back that never left.
      await expect(
        ds.query(
          `UPDATE payouts SET return_settled_at = now(), return_settled_by_user_id = $2
            WHERE id = $1`,
          [id, userId],
        ),
      ).rejects.toThrow(/return_requires_void/);
    });

    it('requires a settler alongside the timestamp, but NOT a note', async () => {
      const id = await insertPayout(shift, `${short}-PO-settle-b`);
      await ds.query(
        `UPDATE payouts SET voided_at = now(), voided_by_user_id = $2, void_reason = 'помилка'
          WHERE id = $1`,
        [id, userId],
      );
      await expect(
        ds.query(`UPDATE payouts SET return_settled_at = now() WHERE id = $1`, [id]),
      ).rejects.toThrow(/return_pair/);

      // The note is OPTIONAL — unlike void_reason, which §9.3 makes mandatory.
      // Two similar-looking trios, two different rules; this test is the
      // difference written down.
      await ds.query(
        `UPDATE payouts SET return_settled_at = now(), return_settled_by_user_id = $2
          WHERE id = $1`,
        [id, userId],
      );
      const [row] = await ds.query(`SELECT return_note FROM payouts WHERE id = $1`, [id]);
      expect(row.return_note).toBeNull();
    });

    it('refuses a zero payout', async () => {
      // Spec §8.6 — stricter than §3.7. A receipt for handing over nothing.
      await expect(insertPayout(shift, `${short}-PO-zero`, '0.00')).rejects.toThrow(
        /CHK_payouts_amount/,
      );
    });
  });

  describe('intake_items', () => {
    let intakeId: string;
    beforeAll(async () => {
      const shift = await openShift(pointA, '2026-07-03');
      intakeId = await insertIntake(shift, `${short}-IN-items`);
    });

    const insertItem = (order: number, overrides: Record<string, string> = {}) => {
      const v = {
        gross_kg: '42.00',
        pallet_kg: '1.50',
        tare_weight_kg: '3.60',
        net_kg: '36.90',
        price: '57.00',
        bonus: '0.00',
        amount: '2103.30',
        ...overrides,
      };
      return ds.query(
        `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
             gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          intakeId,
          order,
          gradeId,
          v.gross_kg,
          v.pallet_kg,
          v.tare_weight_kg,
          v.net_kg,
          v.price,
          v.bonus,
          v.amount,
        ],
      );
    };

    it('numbers its lines uniquely within one intake', async () => {
      await insertItem(1);
      await expect(insertItem(1)).rejects.toThrow(/UQ_intake_items_order/);
      await insertItem(2);
    });

    it('ACCEPTS a negative bonus', async () => {
      // §2.8 — «від'ємний bonus це м'ята чи цвіла ягода». There is deliberately
      // no `bonus >= 0` CHECK, and adding one would make docking for spoiled
      // fruit impossible. Inverted test on purpose.
      const [row] = await insertItem(3, { bonus: '-5.00', amount: '1918.80' });
      expect(row.id).toBeTruthy();
    });

    it('refuses a non-positive net weight', async () => {
      // Without this, tare heavier than gross writes a negative amount, which
      // becomes a silent credit to the supplier's debt, frozen by §2.7.
      await expect(insertItem(4, { net_kg: '0.00', amount: '0.00' })).rejects.toThrow(
        /CHK_intake_items_net_kg/,
      );
      await expect(insertItem(5, { net_kg: '-1.00', amount: '0.00' })).rejects.toThrow(
        /CHK_intake_items_net_kg/,
      );
    });

    it('has NO created_at, NO updated_at and NO equality CHECK on amount', async () => {
      // Composition children are frozen with their parent and have no
      // independent lifecycle. The equality CHECK is refused by foundation
      // §5.4: stored values are rounded, so an exact check rejects legitimate
      // rows and a tolerant one is the «допустима розбіжність» the schema
      // refuses to have. Proven by storing a deliberately WRONG amount.
      const [cols] = await ds.query(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_name = 'intake_items' AND column_name IN ('created_at','updated_at')`,
      );
      expect(cols.n).toBe(0);

      const [row] = await insertItem(6, { amount: '1.00' });
      expect(row.id).toBeTruthy();
    });

    it('cascades to items and tare lines when the intake is deleted', async () => {
      // No route deletes an intake and none ever will (§5.5). The constraint is
      // asserted because the CASCADE is what makes the children parts of a
      // document rather than rows in their own right.
      const shift = await openShift(pointA, '2026-07-04');
      const doomed = await insertIntake(shift, `${short}-IN-cascade`);
      const [item] = await ds.query(
        `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
             gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
         VALUES ($1, 1, $2, '10.00', '0.00', '1.20', '8.80', '50.00', '0.00', '440.00')
         RETURNING id`,
        [doomed, gradeId],
      );
      await ds.query(
        `INSERT INTO intake_item_tare_types (item_id, tare_type_id, units) VALUES ($1, $2, 1)`,
        [item.id, tareId],
      );

      await ds.query(`DELETE FROM intakes WHERE id = $1`, [doomed]);
      const [left] = await ds.query(`SELECT count(*)::int AS n FROM intake_items WHERE id = $1`, [
        item.id,
      ]);
      expect(left.n).toBe(0);
      const [lines] = await ds.query(
        `SELECT count(*)::int AS n FROM intake_item_tare_types WHERE item_id = $1`,
        [item.id],
      );
      expect(lines.n).toBe(0);
    });
  });

  describe('intake_item_tare_types', () => {
    let itemId: string;
    beforeAll(async () => {
      const shift = await openShift(pointA, '2026-07-05');
      const intake = await insertIntake(shift, `${short}-IN-tare`);
      const [item] = await ds.query(
        `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
             gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
         VALUES ($1, 1, $2, '10.00', '0.00', '1.20', '8.80', '50.00', '0.00', '440.00')
         RETURNING id`,
        [intake, gradeId],
      );
      itemId = item.id;
    });

    it('keys on (item_id, tare_type_id) so a type appears once per line', async () => {
      await ds.query(
        `INSERT INTO intake_item_tare_types (item_id, tare_type_id, units) VALUES ($1, $2, 3)`,
        [itemId, tareId],
      );
      await expect(
        ds.query(
          `INSERT INTO intake_item_tare_types (item_id, tare_type_id, units) VALUES ($1, $2, 1)`,
          [itemId, tareId],
        ),
      ).rejects.toThrow(/PK_intake_item_tare_types/);
    });

    it('refuses zero or negative units', async () => {
      const [other] = await ds.query(
        `INSERT INTO tare_types (name, weight_kg, deposit_price) VALUES ($1, '0.50', '0.00')
         RETURNING id`,
        [`Ведро-${run}`],
      );
      await expect(
        ds.query(
          `INSERT INTO intake_item_tare_types (item_id, tare_type_id, units) VALUES ($1, $2, 0)`,
          [itemId, other.id],
        ),
      ).rejects.toThrow(/CHK_intake_item_tare_types_units/);
    });
  });

  describe('document codes', () => {
    it('are globally unique', async () => {
      const shiftA = await openShift(pointA, '2026-07-06');
      await insertIntake(shiftA, `${short}-IN-dup`);
      await expect(insertIntake(shiftA, `${short}-IN-dup`)).rejects.toThrow(/UQ_intakes_code/);
    });

    it('do not collide ACROSS the two document tables', async () => {
      // Separate tables, separate constraints. The IN/PO prefix is legibility,
      // not a uniqueness mechanism, and this records that.
      const shift = await openShift(pointA, '2026-07-07');
      const shared = `${short}-SHARED`;
      await insertIntake(shift, shared);
      const payout = await insertPayout(shift, shared);
      expect(payout).toBeTruthy();
    });
  });
});
