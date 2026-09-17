import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

describe('reweigh schema', () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = await openTestDataSource();
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  const columns = async (table: string) =>
    ds.query(
      `SELECT column_name, data_type, is_nullable, numeric_scale
         FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name`,
      [table],
    );

  /** A shift + product grade + user to hang a reweigh header and lines on. */
  const fixture = async () => {
    const tag = randomUUID().slice(0, 8);
    const [point] = await ds.query(
      `INSERT INTO collection_points (name, code, kind) VALUES ($1, $2, 'reception') RETURNING id`,
      [`Точка ${tag}`, `T${tag.slice(0, 4).toUpperCase()}`],
    );
    const [user] = await ds.query(`SELECT id FROM users WHERE role = 'network_owner' LIMIT 1`);
    const [shift] = await ds.query(
      `INSERT INTO shifts (collection_point_id, business_date, status, opened_by_user_id)
       VALUES ($1, CURRENT_DATE, 'open', $2) RETURNING id`,
      [point.id, user.id],
    );
    const [product] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [
      `Товар ${tag}`,
    ]);
    const [grade] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, $2) RETURNING id`,
      [product.id, `Сорт ${tag}`],
    );
    const [reweigh] = await ds.query(
      `INSERT INTO reweighs (shift_id) VALUES ($1) RETURNING id`,
      [shift.id],
    );
    return { pointId: point.id, userId: user.id, shiftId: shift.id, gradeId: grade.id, reweighId: reweigh.id };
  };

  it('creates the three tables', async () => {
    for (const t of ['reweighs', 'reweigh_items', 'reweigh_item_tare_types']) {
      const rows = await ds.query(`SELECT to_regclass($1) AS t`, [t]);
      expect(rows[0].t).toBe(t);
    }
  });

  it('has NO code, NO posted_at and NO void columns on the header (spec §3.3, §3.4, §3.11)', async () => {
    const names = (await columns('reweighs')).map((c: { column_name: string }) => c.column_name);
    expect(names.sort()).toEqual(['created_at', 'id', 'shift_id', 'updated_at']);
  });

  it('allows exactly one reweigh per shift', async () => {
    const rows = await ds.query(`SELECT indexdef FROM pg_indexes WHERE tablename = 'reweighs'`);
    expect(rows.some((r: { indexdef: string }) => /UNIQUE.*\(shift_id\)/i.test(r.indexdef))).toBe(
      true,
    );
  });

  it('stores every weight as numeric with scale 2', async () => {
    const weights = (await columns('reweigh_items')).filter((c: { column_name: string }) =>
      c.column_name.endsWith('_kg'),
    );
    expect(weights).toHaveLength(4);
    for (const w of weights) {
      expect(w.data_type).toBe('numeric');
      expect(w.numeric_scale).toBe(2);
    }
  });

  it('refuses a partially filled void trio', async () => {
    const f = await fixture();
    await expect(
      ds.query(
        `INSERT INTO reweigh_items (reweigh_id, item_order, product_grade_id, gross_kg,
           pallet_kg, tare_weight_kg, net_kg, weighed_by_user_id, voided_at)
         VALUES ($1, 1, $2, 1, 0, 0, 1, $3, now())`,
        [f.reweighId, f.gradeId, f.userId],
      ),
    ).rejects.toThrow(/CHK_reweigh_items_void_trio/);
  });

  it('refuses a non-positive net weight', async () => {
    const rows = await ds.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'CHK_reweigh_items_net_kg'`,
    );
    expect(rows[0].def).toMatch(/net_kg.*> *\(?0/);
  });

  it('allows two lines of the SAME grade in one header (spec §3.15)', async () => {
    const rows = await ds.query(`SELECT indexdef FROM pg_indexes WHERE tablename = 'reweigh_items'`);
    expect(
      rows.some((r: { indexdef: string }) => /UNIQUE.*product_grade_id/i.test(r.indexdef)),
    ).toBe(false);
    expect(
      rows.some((r: { indexdef: string }) => /UNIQUE.*\(reweigh_id, item_order\)/i.test(r.indexdef)),
    ).toBe(true);
  });

  it('cascades lines and tare from the header, and RESTRICTs the shift', async () => {
    const fks = await ds.query(
      `SELECT c.conname, confdeltype, t.relname AS tbl
         FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
        WHERE c.contype = 'f' AND t.relname LIKE 'reweigh%'`,
    );
    const byName = Object.fromEntries(
      fks.map((f: { conname: string; confdeltype: string }) => [f.conname, f.confdeltype]),
    );
    expect(byName['FK_reweighs_shift']).toBe('r');
    expect(byName['FK_reweigh_items_reweigh']).toBe('c');
    expect(byName['FK_reweigh_item_tare_types_item']).toBe('c');
    expect(byName['FK_reweigh_item_tare_types_tare_type']).toBe('r');
  });
});
