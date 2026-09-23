import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { CrateStandingService } from './crate-standing.service';
import { CrateBalancesService } from './crate-balances.service';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * `GET /crate-standing` against a real Postgres — the §6.8 20:40 day:
 * allotment 800 = 341 empty + 195 with people + 264 at base.
 *
 * Composition of the 264 at base, built below:
 *   yesterday (closed): 120 crates on receipts + 2 broken   = 122
 *   today (OPEN):       142 crates on receipts               = 142
 *   plus noise that must NOT count: 30 «Чешка» (not a crate), a voided
 *   receipt with 50 crates, a `sent` transfer of 40.
 *   plus transfers that DO net out to zero: accepted 10, disputed+resolved
 *   (resolved 6), disputed open (reported 4) = −20; and 20 extra crates on a
 *   closed shift receipt, so 122 + 142 + 20 − 20 = 264.
 *   A voided resolved transfer of 99 must count for nothing (voided wins).
 *
 * Composition of the 195 in field / 115 on deposit / 13 800,00 ₴ held, built
 * below — this exercises `openTranchesSql`'s RETURN side, which the first
 * version of this file never touched:
 *   supplier `a` is issued 125 crates on a deposit at 120,00 ₴/шт
 *     (deposit_taken 15 000,00 ₴); a REAL partial return of 10 brings her
 *     remaining tranche to 115 and refunds 1 200,00 ₴ (deposit_refund); a
 *     SECOND, VOIDED return of 20 against the SAME issuance must count for
 *     NOTHING — neither shrinking the 115 further nor refunding its
 *     2 400,00 ₴ — because `openTranchesSql` and `crateBookSql` both filter
 *     `cr.voided_at IS NULL`.
 *   supplier `b` is issued 80 on a розписка (0,00 ₴), untouched by any
 *     return, so her whole 80 stays open.
 *   supplier `c` is issued 30 on a VOIDED deposit (3 600,00 ₴) — excluded
 *     entirely, tranche and cash both, by `ci.voided_at IS NULL`.
 *   115 (a) + 80 (b) = 195 in_field; 115 (a, the only open deposit tranche)
 *     = deposit_units; 15 000,00 − 1 200,00 = 13 800,00 ₴ deposit_held — the
 *     SAME figure the pre-return fixture produced, because the voided
 *     issuance and the voided return were chosen to cancel out rather than
 *     to move the total.
 */
describe('CrateStandingService.forPoint (Postgres)', () => {
  let ds: DataSource;
  let service: CrateStandingService;
  let balances: CrateBalancesService;
  let run: string;
  let userId: string;
  let point: string;
  let bare: string;
  let crateTare: string;
  let boxTare: string;
  let grade: string;
  let yesterday: string;
  let today: string;

  const owner = () =>
    ({ sub: userId, role: UserRole.NetworkOwner, collection_point_id: null }) as AuthenticatedUser;
  const operatorAt = (pointId: string) =>
    ({ sub: userId, role: UserRole.PointOperator, collection_point_id: pointId }) as AuthenticatedUser;

  const newPoint = async (target: number | null): Promise<string> => {
    const tag = randomUUID().slice(0, 8);
    const [row] = await ds.query(
      `INSERT INTO collection_points (name, code, kind, target_crates)
       VALUES ($1, $2, 'reception', $3) RETURNING id`,
      [`Стан ${tag}`, `ST${tag.slice(0, 6).toUpperCase()}`, target],
    );
    return row.id;
  };

  const shift = async (
    pointId: string,
    date: string,
    closed: { broken: number | null } | null,
  ): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date,
                           status, closed_at, closed_by_user_id, broken_crates)
       VALUES ($1, $2, $3::date, $4::shift_status, $5, $6, $7) RETURNING id`,
      closed
        ? [pointId, userId, date, 'closed', new Date().toISOString(), userId, closed.broken]
        : [pointId, userId, date, 'open', null, null, null],
    );
    return row.id;
  };

  const supplier = async (pointId: string): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name)
       VALUES ($1, 'Стан', $2) RETURNING id`,
      [pointId, `Людина-${randomUUID().slice(0, 8)}`],
    );
    return row.id;
  };

  /** A receipt carrying `crates` crate-tare units and `boxes` non-crate units. */
  const receipt = async (
    shiftId: string,
    supplierId: string,
    crates: number,
    opts: { boxes?: number; voided?: boolean } = {},
  ): Promise<void> => {
    const [intake] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id,
                            voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, $3, '100.00', $4, $5, $6, $7) RETURNING id`,
      [
        `ST-${randomUUID().slice(0, 8)}`,
        shiftId,
        supplierId,
        userId,
        opts.voided ? new Date().toISOString() : null,
        opts.voided ? userId : null,
        opts.voided ? 'фікстура' : null,
      ],
    );
    const [item] = await ds.query(
      `INSERT INTO intake_items
         (intake_id, item_order, product_grade_id, gross_kg, tare_weight_kg, net_kg, price, amount)
       VALUES ($1, 1, $2, '10.00', '0.00', '10.00', '10.00', '100.00') RETURNING id`,
      [intake.id, grade],
    );
    await ds.query(
      `INSERT INTO intake_item_tare_types (item_id, tare_type_id, units) VALUES ($1, $2, $3)`,
      [item.id, crateTare, crates],
    );
    if (opts.boxes) {
      await ds.query(
        `INSERT INTO intake_item_tare_types (item_id, tare_type_id, units) VALUES ($1, $2, $3)`,
        [item.id, boxTare, opts.boxes],
      );
    }
  };

  const transfer = async (pointId: string, over: Record<string, unknown>): Promise<void> => {
    const row: Record<string, unknown> = {
      collection_point_id: pointId,
      cash: '0.00',
      crates: 1,
      carrier: 'Іван, Ducato',
      sent_by_user_id: userId,
      sent_at: new Date('2026-09-01T18:00:00Z'),
      status: 'sent',
      ...over,
    };
    const keys = Object.keys(row);
    await ds.query(
      `INSERT INTO transfers (${keys.map((k) => `"${k}"`).join(', ')})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
      keys.map((k) => row[k]),
    );
  };

  const issue = async (
    shiftId: string,
    supplierId: string,
    units: number,
    mode: 'deposit' | 'receipt',
    taken: string,
    opts: { voided?: boolean } = {},
  ): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO crate_issuances
         (code, shift_id, supplier_id, units, mode, deposit_per_unit, deposit_taken,
          issued_by_user_id, voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, $3, $4, $5::crate_issuance_mode, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        `STI-${randomUUID().slice(0, 8)}`,
        shiftId,
        supplierId,
        units,
        mode,
        mode === 'deposit' ? '120.00' : '0.00',
        taken,
        userId,
        opts.voided ? new Date().toISOString() : null,
        opts.voided ? userId : null,
        opts.voided ? 'фікстура' : null,
      ],
    );
    return row.id;
  };

  /**
   * A return plus the `crate_return_allocations` row that consumes
   * `issuanceId` — the shape `crate-balances.db-spec.ts`'s `giveBack` uses.
   */
  const giveBack = async (
    shiftId: string,
    supplierId: string,
    issuanceId: string,
    units: number,
    perUnit: string,
    refund: string,
    opts: { voided?: boolean } = {},
  ): Promise<void> => {
    const [ret] = await ds.query(
      `INSERT INTO crate_returns
         (shift_id, supplier_id, units, deposit_refund, accepted_by_user_id,
          voided_at, void_reason, voided_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        shiftId,
        supplierId,
        units,
        refund,
        userId,
        opts.voided ? new Date().toISOString() : null,
        opts.voided ? 'фікстура' : null,
        opts.voided ? userId : null,
      ],
    );
    await ds.query(
      `INSERT INTO crate_return_allocations (return_id, issuance_id, units, per_unit, amount)
       VALUES ($1, $2, $3, $4, $5)`,
      [ret.id, issuanceId, units, perUnit, refund],
    );
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    run = randomUUID().slice(0, 8);
    service = new CrateStandingService(ds);
    balances = new CrateBalancesService(ds);

    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role) VALUES ('Власник', $1, 'network_owner') RETURNING id`,
      [`Стан-${run}`],
    );
    userId = user.id;

    // THE crate tare is a singleton (UQ_tare_types_single_crate) shared by
    // every db-spec — reuse it if one exists, create it only if none does.
    const existing = await ds.query(`SELECT id FROM tare_types WHERE is_crate LIMIT 1`);
    if (existing.length) {
      crateTare = existing[0].id;
    } else {
      const [t] = await ds.query(
        `INSERT INTO tare_types (name, weight_kg, deposit_price, is_crate)
         VALUES ($1, '1.20', '120.00', true) RETURNING id`,
        [`Ящик-${run}`],
      );
      crateTare = t.id;
    }
    const [box] = await ds.query(
      `INSERT INTO tare_types (name, weight_kg, deposit_price) VALUES ($1, '0.40', '0.00') RETURNING id`,
      [`Чешка-${run}`],
    );
    boxTare = box.id;
    const [product] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [`Малина-${run}`]);
    const [g] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, 'Перший') RETURNING id`,
      [product.id],
    );
    grade = g.id;

    point = await newPoint(800);
    bare = await newPoint(null);
    yesterday = await shift(point, '2026-09-09', { broken: 2 });
    const older = await shift(point, '2026-09-08', { broken: null });
    today = await shift(point, '2026-09-10', null);

    const s = await supplier(point);
    await receipt(yesterday, s, 120, { boxes: 30 });
    await receipt(yesterday, s, 50, { voided: true });
    await receipt(older, s, 20);
    await receipt(today, s, 142);

    await transfer(point, { status: 'sent', crates: 40 });
    await transfer(point, {
      status: 'accepted', crates: 10,
      accepted_by_user_id: userId, accepted_date: '2026-09-10', accepted_at: new Date(),
    });
    await transfer(point, {
      status: 'disputed', crates: 9, reported_crates: 7, resolved_crates: 6,
      accepted_by_user_id: userId, accepted_date: '2026-09-10', accepted_at: new Date(),
      resolved_by_user_id: userId, resolved_at: new Date(),
    });
    await transfer(point, {
      status: 'disputed', crates: 8, reported_crates: 4,
      accepted_by_user_id: userId, accepted_date: '2026-09-10', accepted_at: new Date(),
    });
    await transfer(point, {
      status: 'disputed', crates: 99, reported_crates: 99, resolved_crates: 99,
      accepted_by_user_id: userId, accepted_date: '2026-09-10', accepted_at: new Date(),
      resolved_by_user_id: userId, resolved_at: new Date(),
      voided_at: new Date(), voided_by_user_id: userId, void_reason: 'фікстура',
    });

    // 195 out: 115 on deposit (13 800,00 ₴, after a real partial return and a
    // voided one that must count for nothing) + 80 on a розписка, plus a
    // fully voided deposit issuance that must not appear anywhere — see this
    // describe block's doc comment for the arithmetic.
    const a = await supplier(point);
    const b = await supplier(point);
    const c = await supplier(point);
    const issuanceA = await issue(today, a, 125, 'deposit', '15000.00');
    await giveBack(today, a, issuanceA, 10, '120.00', '1200.00');
    await giveBack(today, a, issuanceA, 20, '120.00', '2400.00', { voided: true });
    await issue(today, b, 80, 'receipt', '0.00');
    await issue(today, c, 30, 'deposit', '3600.00', { voided: true });
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('reproduces §6.8: 800 = 341 + 195 + 264', async () => {
    const got = await service.forPoint(owner(), { collection_point_id: point });
    expect(got).toEqual({
      collection_point_id: point,
      allotment: 800,
      in_field: 195,
      deposit_units: 115,
      deposit_held: '13800.00',
      at_base: 264,
      on_hand: 341,
      shortfall: 459,
    });
  });

  it('agrees with the sum of /crate-balances for the same point', async () => {
    const page = await balances.list(owner(), {
      collection_point_id: point, page: 1, limit: 200, include_zero: false,
    } as never);
    const sum = page.data.reduce((n, r) => n + r.outstanding_units, 0);
    const got = await service.forPoint(owner(), { collection_point_id: point });
    expect(got.in_field).toBe(sum);
  });

  it('pins an operator to their own point', async () => {
    const got = await service.forPoint(operatorAt(point), { collection_point_id: bare });
    expect(got.collection_point_id).toBe(point);
  });

  /** §6.9 — «—», not 0, and no on-hand without an allotment. */
  it('reports a point without an allotment as null, not zero', async () => {
    const got = await service.forPoint(owner(), { collection_point_id: bare });
    expect(got).toMatchObject({ allotment: null, on_hand: null, in_field: 0, at_base: 0, shortfall: 0 });
    expect(got.deposit_held).toBe('0.00');
  });

  it('lets on_hand go negative when the allotment is overdrawn', async () => {
    const small = await newPoint(10);
    const open = await shift(small, '2026-09-10', null);
    await receipt(open, await supplier(small), 25);
    const got = await service.forPoint(owner(), { collection_point_id: small });
    expect(got.on_hand).toBe(-15);
  });
});
