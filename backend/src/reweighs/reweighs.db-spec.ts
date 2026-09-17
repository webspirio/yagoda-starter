import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { ReweighsService } from './reweighs.service';
import { Shift } from '../shifts/shift.entity';
import { TareType } from '../tare-types/tare-type.entity';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { UserRole } from '../users/user-role.enum';

const pointCode = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

/**
 * `ReweighsService.addItem` exercised against real Postgres, for the two
 * things a mocked `manager.query` cannot prove: that `ensureHeader`'s
 * `ON CONFLICT DO NOTHING` really does collapse two concurrent first lines
 * into one header, and that `UQ_reweigh_items_order` really does let a voided
 * line keep its number.
 *
 * `shifts` and `tareTypes` below are NOT the real `ShiftsService`/
 * `TareTypesService` — constructing those needs a web of unrelated
 * dependencies (`PointCashService`, `CollectionPointsService`, …) that this
 * spec has no use for. They are thin, DB-backed stand-ins that satisfy the
 * exact two methods `ReweighsService` calls (`findOneRaw`, `findManyRaw`),
 * so what is under test is `ReweighsService`'s OWN transaction and SQL, not a
 * mock's choreography.
 *
 * The void case uses a direct SQL `UPDATE`, not a void endpoint — Task 4 (the
 * void path) does not exist yet; see the task brief.
 */
describe('ReweighsService.addItem (DB)', () => {
  let ds: DataSource;
  let service: ReweighsService;
  let ownerId: string;

  const shiftsStub = {
    findOneRaw: async (id: string) => ds.manager.getRepository(Shift).findOne({ where: { id } }),
  };
  const tareTypesStub = {
    findManyRaw: async (ids: string[]) => {
      if (ids.length === 0) return [];
      return ds.manager
        .getRepository(TareType)
        .createQueryBuilder('t')
        .where('t.id IN (:...ids)', { ids })
        .getMany();
    },
  };
  const auditStub = { record: async () => undefined };

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new ReweighsService(
      ds,
      shiftsStub as never,
      tareTypesStub as never,
      auditStub as never,
    );

    const [owner] = await ds.query(
      `INSERT INTO users (first_name, last_name, role) VALUES ('Керівник', 'Тест', 'network_owner')
       RETURNING id`,
    );
    ownerId = owner.id;
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const actor = (): AuthenticatedUser =>
    ({ sub: ownerId, username: 'owner', role: UserRole.NetworkOwner, collection_point_id: null }) as AuthenticatedUser;

  /**
   * A point with one open shift, one accepted intake for one grade — the
   * minimum a line can be written against. Every value carries a per-call
   * uuid: `app_test` is never truncated between runs.
   */
  const fixture = async () => {
    const tag = randomUUID();
    const short = tag.slice(0, 8).toUpperCase();

    const [point] = await ds.query(
      `INSERT INTO collection_points (name, code, kind) VALUES ($1, $2, 'reception') RETURNING id`,
      [`Точка ${tag}`, pointCode()],
    );
    const [shift] = await ds.query(
      `INSERT INTO shifts (collection_point_id, business_date, status, opened_by_user_id)
       VALUES ($1, CURRENT_DATE, 'open', $2) RETURNING id`,
      [point.id, ownerId],
    );
    const [supplier] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name)
       VALUES ($1, 'Іван', $2) RETURNING id`,
      [point.id, `Постачальник-${tag}`],
    );
    const [product] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [
      `Товар ${tag}`,
    ]);
    const [grade] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, $2) RETURNING id`,
      [product.id, `Сорт ${tag}`],
    );
    const [tare] = await ds.query(
      `INSERT INTO tare_types (name, weight_kg, deposit_price) VALUES ($1, '1.20', '0.00')
       RETURNING id`,
      [`Тара ${tag}`],
    );
    const [intake] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '100.00', $4) RETURNING id`,
      [`${short}-IN-1`, shift.id, supplier.id, ownerId],
    );
    await ds.query(
      `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
       VALUES ($1, 1, $2, '50.00', '0.00', '0.00', '50.00', '2.00', '0.00', '100.00')`,
      [intake.id, grade.id],
    );

    return { shiftId: shift.id as string, gradeId: grade.id as string, tareId: tare.id as string };
  };

  /**
   * `POST` and `POST …/void` share one `ReweighItemResponse` type, so they must
   * share one SHAPE. `m.save()` hands back the entity it was given, relations
   * unloaded, and the mapper then reads `product_grade.name` off `undefined`
   * — the void path, which re-reads with relations, filled these in while the
   * create path returned nulls for all of them.
   */
  it('returns the grade, product and tare NAMES from create — the same shape void returns', async () => {
    const { shiftId, gradeId, tareId } = await fixture();

    const created = await service.addItem(actor(), shiftId, {
      product_grade_id: gradeId,
      gross_kg: '100.00',
      tare: [{ tare_type_id: tareId, units: 5 }],
    });

    expect(created.product_grade_name).toBeTruthy();
    expect(created.product_id).toBeTruthy();
    expect(created.product_name).toBeTruthy();
    expect(created.tare[0].tare_type_name).toBeTruthy();

    const voided = await service.voidItem(actor(), created.id, {
      reason: 'переважили не ту партію',
    });
    expect(Object.keys(created).sort()).toEqual(Object.keys(voided).sort());
    expect(voided.product_grade_name).toBe(created.product_grade_name);
    expect(voided.tare[0].tare_type_name).toBe(created.tare[0].tare_type_name);
  });

  /**
   * The same tare type twice on one line would be summed into
   * `tare_weight_kg` and then die on `PK_reweigh_item_tare_types` — a 23505
   * nothing here maps, so a generic 500. `intakes` refuses it by name; so
   * does this.
   */
  it('REFUSES the same tare type listed twice on one line, with a code', async () => {
    const { shiftId, gradeId, tareId } = await fixture();

    await expect(
      service.addItem(actor(), shiftId, {
        product_grade_id: gradeId,
        gross_kg: '100.00',
        tare: [
          { tare_type_id: tareId, units: 5 },
          { tare_type_id: tareId, units: 3 },
        ],
      }),
    ).rejects.toMatchObject({ response: { code: 'TARE_TYPE_DUPLICATED' } });

    const rows = await ds.query(
      `SELECT count(*)::int AS n FROM reweigh_items ri
         JOIN reweighs r ON r.id = ri.reweigh_id WHERE r.shift_id = $1`,
      [shiftId],
    );
    expect(rows[0].n).toBe(0);
  });

  it('creates exactly ONE header for two concurrent first lines', async () => {
    const { shiftId, gradeId } = await fixture();
    const addLine = (gross: string) =>
      service.addItem(actor(), shiftId, { product_grade_id: gradeId, gross_kg: gross, tare: [] });

    await Promise.all([addLine('100.00'), addLine('200.00')]);

    const rows = await ds.query(`SELECT count(*)::int AS n FROM reweighs WHERE shift_id = $1`, [
      shiftId,
    ]);
    expect(rows[0].n).toBe(1);
  });

  it('numbers lines 1, 2 and keeps a voided number taken', async () => {
    const { shiftId, gradeId } = await fixture();
    const addLine = (gross: string) =>
      service.addItem(actor(), shiftId, { product_grade_id: gradeId, gross_kg: gross, tare: [] });

    const a = await addLine('100.00');
    expect(a.item_order).toBe(1);

    await ds.query(
      `UPDATE reweigh_items SET voided_at = now(), voided_by_user_id = $2, void_reason = $3
        WHERE id = $1`,
      [a.id, ownerId, 'переважили не ту партію'],
    );

    const b = await addLine('200.00');
    expect(b.item_order).toBe(2);
  });

  it('accepts two lines of the same grade', async () => {
    const { shiftId, gradeId } = await fixture();
    const addLine = (gross: string) =>
      service.addItem(actor(), shiftId, { product_grade_id: gradeId, gross_kg: gross, tare: [] });

    await addLine('100.00');
    await expect(addLine('120.00')).resolves.toBeDefined();
  });

  /**
   * THE NON-FIRST-LINE CASE — what the first concurrency test above does NOT
   * cover. Once a header already exists, `ensureHeader`'s `ON CONFLICT DO
   * NOTHING` no-ops immediately without blocking, so the ONLY thing standing
   * between two concurrent later lines and a raw `23505` on
   * `UQ_reweigh_items_order` is the `FOR UPDATE` on the header read. This is
   * exactly the case the fix-round finding was about: two pallets weighed in
   * close succession, later in an ordinary shift.
   */
  it('numbers two CONCURRENT non-first lines 2 and 3, with no gaps or duplicates', async () => {
    const { shiftId, gradeId } = await fixture();
    const addLine = (gross: string) =>
      service.addItem(actor(), shiftId, { product_grade_id: gradeId, gross_kg: gross, tare: [] });

    // Line 1 — commits and establishes the header before the race starts.
    await addLine('50.00');

    const [b, c] = await Promise.all([addLine('60.00'), addLine('70.00')]);

    expect(new Set([b.item_order, c.item_order]).size).toBe(2);
    expect([b.item_order, c.item_order].sort()).toEqual([2, 3]);

    const rows = (await ds.query(
      `SELECT item_order FROM reweigh_items WHERE reweigh_id = (
         SELECT id FROM reweighs WHERE shift_id = $1
       ) ORDER BY item_order`,
      [shiftId],
    )) as { item_order: number }[];
    expect(rows.map((r) => r.item_order)).toEqual([1, 2, 3]);
  });
});
