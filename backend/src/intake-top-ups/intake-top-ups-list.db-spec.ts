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
});
