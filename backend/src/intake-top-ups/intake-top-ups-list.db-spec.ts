import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { IntakeTopUpsService } from './intake-top-ups.service';
import { IntakeTopUp } from './intake-top-up.entity';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * `GET /intake-top-ups`'s scoping and filtering, against a real Postgres.
 *
 * What is under test is the TWO-HOP JOIN. `intake_top_ups` has no point column
 * and neither does `intakes`, so an operator's scope is
 * `intake_top_ups → intakes → suppliers.collection_point_id`, and a unit spec
 * can only assert the text of that.
 */
describe('IntakeTopUpsService.list (Postgres)', () => {
  let ds: DataSource;
  let service: IntakeTopUpsService;
  let run: string;
  let pointA: string;
  let pointB: string;
  let ownerId: string;
  let topUpOnA: string;
  /** Point C exists only for the filter tests: two suppliers, three intakes,
   *  four top-ups, so `supplier_id` and `intake_id` cannot both be satisfied
   *  by the same subset and a page can be smaller than the total. */
  let pointC: string;
  let supplierC1: string;
  let intakeC1: string;

  const owner = (): AuthenticatedUser =>
    ({ sub: ownerId, role: UserRole.NetworkOwner, collection_point_id: null }) as AuthenticatedUser;
  const operatorAt = (pointId: string): AuthenticatedUser =>
    ({ sub: ownerId, role: UserRole.PointOperator, collection_point_id: pointId }) as AuthenticatedUser;

  const makePoint = async (label: string): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Список ${label} ${run}`, `${label}${run.slice(0, 4).toUpperCase()}`],
    );
    return row.id;
  };

  /** One point's whole chain: supplier → shift → intake → top-up. */
  const world = async (pointId: string, label: string): Promise<string> => {
    const [supplier] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Іван', $2, true) RETURNING id`,
      [pointId, `${label}-${run}`],
    );
    const [shift] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
       VALUES ($1, $2, '2026-09-08') RETURNING id`,
      [pointId, ownerId],
    );
    const [intake] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '100.00', $4) RETURNING id`,
      [`${label}-IN-${run}`, shift.id, supplier.id, ownerId],
    );
    const [topUp] = await ds.query(
      `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id)
       VALUES ($1, '750.00', 'доплата', $2) RETURNING id`,
      [intake.id, ownerId],
    );
    return topUp.id;
  };

  /** One supplier, one shift, N intakes at `pointC`, each with its own top-ups. */
  const filterWorld = async (): Promise<void> => {
    const [shift] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
       VALUES ($1, $2, '2026-09-08') RETURNING id`,
      [pointC, ownerId],
    );

    const supplier = async (label: string): Promise<string> => {
      const [row] = await ds.query(
        `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
         VALUES ($1, 'Ольга', $2, true) RETURNING id`,
        [pointC, `${label}-${run}`],
      );
      return row.id;
    };
    const intake = async (supplierId: string, label: string): Promise<string> => {
      const [row] = await ds.query(
        `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
         VALUES ($1, $2, $3, '100.00', $4) RETURNING id`,
        [`${label}-IN-${run}`, shift.id, supplierId, ownerId],
      );
      return row.id;
    };
    const topUp = async (intakeId: string, amount: string): Promise<void> => {
      await ds.query(
        `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id)
         VALUES ($1, $2, 'доплата', $3)`,
        [intakeId, amount, ownerId],
      );
    };

    supplierC1 = await supplier('C1');
    const supplierC2 = await supplier('C2');
    intakeC1 = await intake(supplierC1, 'C1a');
    const intakeC1b = await intake(supplierC1, 'C1b');
    const intakeC2 = await intake(supplierC2, 'C2');

    // supplierC1: two rows on intakeC1 + one on intakeC1b. supplierC2: one.
    // So supplier_id → 3, intake_id → 2, neither filter → 4.
    await topUp(intakeC1, '100.00');
    await topUp(intakeC1, '200.00');
    await topUp(intakeC1b, '300.00');
    await topUp(intakeC2, '400.00');
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new IntakeTopUpsService(ds.getRepository(IntakeTopUp), ds, {
      record: async () => undefined,
    } as never);
    run = randomUUID().slice(0, 8);

    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role)
       VALUES ('Власник', $1, 'network_owner') RETURNING id`,
      [`Список-${run}`],
    );
    ownerId = user.id;

    pointA = await makePoint('A');
    pointB = await makePoint('B');
    topUpOnA = await world(pointA, 'A');
    await world(pointB, 'B');

    pointC = await makePoint('C');
    await filterWorld();
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('an owner with no filter sees both points', async () => {
    const page = await service.list(owner(), {
      include_voided: true,
      page: 1,
      limit: 50,
    } as never);

    const codes = page.data.map((r) => r.intake.code);
    expect(codes).toContain(`A-IN-${run}`);
    expect(codes).toContain(`B-IN-${run}`);
  });

  it('an operator sees only their own point, through the two-hop join', async () => {
    const page = await service.list(operatorAt(pointA), {
      include_voided: true,
      page: 1,
      limit: 50,
    } as never);

    expect(page.data.map((r) => r.id)).toContain(topUpOnA);
    expect(page.total).toBe(1);
  });

  it("an operator's requested collection_point_id is ignored, not honoured", async () => {
    const page = await service.list(operatorAt(pointA), {
      collection_point_id: pointB,
      include_voided: true,
      page: 1,
      limit: 50,
    } as never);

    expect(page.data.map((r) => r.id)).toEqual([topUpOnA]);
  });

  it('include_voided=false hides rows the owner voided', async () => {
    await ds.query(
      `UPDATE intake_top_ups
          SET voided_at = now(), voided_by_user_id = $2, void_reason = 'помилка'
        WHERE id = $1`,
      [topUpOnA, ownerId],
    );

    const page = await service.list(operatorAt(pointA), {
      include_voided: false,
      page: 1,
      limit: 50,
    } as never);
    expect(page.data).toHaveLength(0);
  });

  it('include_voided=false does NOT hide a row whose PARENT is voided', async () => {
    // The row is still live; it simply counts for nothing. Hiding it here is
    // exactly the silence `counts_toward_balance` exists to prevent.
    const [{ id }] = await ds.query(
      `SELECT i.id FROM intakes i
         JOIN intake_top_ups t ON t.intake_id = i.id
        WHERE t.id = $1`,
      [topUpOnA],
    );
    await ds.query(
      `UPDATE intakes SET voided_at = now(), voided_by_user_id = $2, void_reason = 'сторно'
        WHERE id = $1`,
      [id, ownerId],
    );
    await ds.query(
      `UPDATE intake_top_ups SET voided_at = NULL, voided_by_user_id = NULL, void_reason = NULL
        WHERE id = $1`,
      [topUpOnA],
    );

    const page = await service.list(operatorAt(pointA), {
      include_voided: false,
      page: 1,
      limit: 50,
    } as never);

    expect(page.data.map((r) => r.id)).toEqual([topUpOnA]);
    expect(page.data[0].counts_toward_balance).toBe(false);
  });

  /**
   * The two filters the «картка постачальника» screen (spec §14) is built on.
   * They are separate columns on separate tables — `i.supplier_id` lives on the
   * PARENT, `t.intake_id` on the row itself — so a fixture where both return
   * the same subset would prove nothing about either.
   */
  describe('supplier_id and intake_id', () => {
    const atPointC = (extra: Record<string, unknown>) =>
      service.list(owner(), {
        collection_point_id: pointC,
        include_voided: true,
        page: 1,
        limit: 50,
        ...extra,
      } as never);

    it('unfiltered, the point has all four rows', async () => {
      const page = await atPointC({});
      expect(page.total).toBe(4);
      expect(page.data).toHaveLength(4);
    });

    it('supplier_id narrows to the PARENT intake’s supplier', async () => {
      const page = await atPointC({ supplier_id: supplierC1 });

      expect(page.total).toBe(3);
      expect(page.data.map((r) => r.amount).sort()).toEqual(['100.00', '200.00', '300.00']);
    });

    it('intake_id narrows further, to one receipt', async () => {
      const page = await atPointC({ intake_id: intakeC1 });

      expect(page.total).toBe(2);
      expect(page.data.map((r) => r.amount).sort()).toEqual(['100.00', '200.00']);
      expect(page.data.every((r) => r.intake.code === `C1a-IN-${run}`)).toBe(true);
    });

    it('a supplier from another point returns nothing, it does not widen the scope', async () => {
      // `supplier_id` is a filter, never a scope: the point filter is ANDed
      // with it, so naming someone else's supplier narrows to zero rather
      // than reaching across points.
      const page = await service.list(operatorAt(pointC), {
        supplier_id: (await ds.query(`SELECT id FROM suppliers WHERE collection_point_id = $1`, [
          pointA,
        ]))[0].id,
        include_voided: true,
        page: 1,
        limit: 50,
      } as never);

      expect(page.data).toEqual([]);
      expect(page.total).toBe(0);
    });

    it('paginates in Postgres: total counts the filter, not the page', async () => {
      const first = await atPointC({ supplier_id: supplierC1, limit: 2 });
      expect(first).toMatchObject({ total: 3, page: 1, limit: 2 });
      expect(first.data).toHaveLength(2);

      const second = await atPointC({ supplier_id: supplierC1, page: 2, limit: 2 });
      expect(second).toMatchObject({ total: 3, page: 2, limit: 2 });
      expect(second.data).toHaveLength(1);

      // The offset must actually move — a page 2 repeating page 1 would still
      // satisfy every count above.
      const ids = [...first.data, ...second.data].map((r) => r.id);
      expect(new Set(ids).size).toBe(3);
    });
  });
});
