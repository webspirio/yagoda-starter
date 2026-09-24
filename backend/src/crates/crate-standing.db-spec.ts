import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { CrateStandingService } from './crate-standing.service';
import { CrateBalancesService } from './crate-balances.service';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * `GET /crate-standing` against a real Postgres — spec §8.1's crate flow as the
 * client runs it (2026-09-23), step by step at ONE fresh point, allotment 500:
 *
 *   | Step                                   | Empty | With people | With berries |
 *   | Transfer 500 empty                     |   500 |           0 |            0 |
 *   | Issue 100 (80 deposit + 20 розписка)   |   400 |         100 |            0 |
 *   | 50 full, from someone not holding ours |   350 |         100 |           50 |
 *   | 50 full in OUR crates + return of 50   |   350 |          50 |          100 |
 *   | Shift closed → next shift              |   350 |          50 |            0 |
 *
 * The steps are ordered `it`s over the same point: each one adds its documents
 * and asserts the WHOLE response, so a figure that moves when it should not is
 * caught at the step that moved it. Step 4's return is a plain standalone
 * return, written on its own rather than riding in on a receipt — but §8.2's
 * formula nets the two documents the same way either way, and it does not
 * distinguish them: a receipt-linked return (`crate_returns.intake_id`,
 * shipped 2026-09-24 — `POST /intakes`'s `returned_crates`) is netted through
 * exactly this arithmetic too, Σ returned against the receipt's own crate
 * tare (`crateTareUnitsSql`), which is why a linked write leaves `on_hand`
 * unchanged while moving units from `in_field` to `with_berry` — see the
 * standalone case below.
 *
 * The remaining cases each use their own fresh point so they cannot disturb
 * the example's figures.
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

  /** A receipt carrying `crates` crate-tare units and `boxes` non-crate units.
   *  Returns the intake's id — callers that link a `giveBack` return to it, or
   *  void it directly, need that id back. */
  const receipt = async (
    shiftId: string,
    supplierId: string,
    crates: number,
    opts: { boxes?: number; voided?: boolean } = {},
  ): Promise<string> => {
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
    return intake.id;
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
   * `opts.intakeId` links it to a receipt (`crate_returns.intake_id`, §8.3's
   * `POST /intakes` `returned_crates`) — written by raw SQL rather than the
   * real service, since this file exercises `CrateStandingService`'s reading
   * of the two tables, not `IntakesService`'s write orchestration (that is
   * `intake-crate-return.db-spec.ts`'s job).
   */
  const giveBack = async (
    shiftId: string,
    supplierId: string,
    issuanceId: string,
    units: number,
    perUnit: string,
    refund: string,
    opts: { voided?: boolean; intakeId?: string } = {},
  ): Promise<void> => {
    const [ret] = await ds.query(
      `INSERT INTO crate_returns
         (shift_id, supplier_id, units, deposit_refund, accepted_by_user_id,
          voided_at, void_reason, voided_by_user_id, intake_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        shiftId,
        supplierId,
        units,
        refund,
        userId,
        opts.voided ? new Date().toISOString() : null,
        opts.voided ? 'фікстура' : null,
        opts.voided ? userId : null,
        opts.intakeId ?? null,
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

    point = await newPoint(500);
    bare = await newPoint(null);
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const acceptedTransfer = (crates: number): Record<string, unknown> => ({
    status: 'accepted',
    crates,
    accepted_by_user_id: userId,
    accepted_date: '2026-09-10',
    accepted_at: new Date(),
  });

  /** The figures that do not move through the example, merged into each step. */
  const standing = (over: Record<string, unknown>) => ({
    collection_point_id: point,
    allotment: 500,
    received: 500,
    deposit_units: 0,
    deposit_held: '0.00',
    ...over,
  });

  describe('the client example, step by step (allotment 500)', () => {
    // These five `it`s SHARE STATE — `day1`, `holder` and `depositIssuance`
    // below are written by an earlier step and read by a later one, and each
    // step's assertion builds on the previous step's documents. They MUST run
    // in file order: don't reorder them, run one alone with `-t`/`.only`, or
    // let a randomized test order near this file.
    let day1: string;
    let holder: string;
    let depositIssuance: string;

    it('1. a transfer of 500 empties lands them all on hand', async () => {
      await transfer(point, acceptedTransfer(500));
      await expect(service.forPoint(owner(), { collection_point_id: point })).resolves.toEqual(
        standing({ on_hand: 500, in_field: 0, with_berry: 0, total: 500, shortfall: 0 }),
      );
    });

    it('2. issuing 100 (80 on deposit, 20 on a розписка) moves them from empty to people', async () => {
      day1 = await shift(point, '2026-09-10', null);
      holder = await supplier(point);
      const other = await supplier(point);
      depositIssuance = await issue(day1, holder, 80, 'deposit', '9600.00');
      await issue(day1, other, 20, 'receipt', '0.00');
      await expect(service.forPoint(owner(), { collection_point_id: point })).resolves.toEqual(
        standing({
          on_hand: 400, in_field: 100, with_berry: 0, total: 500, shortfall: 0,
          deposit_units: 80, deposit_held: '9600.00',
        }),
      );
    });

    it('3. 50 full crates from someone not holding ours come out of the empties', async () => {
      // 30 «Чешка» on the same receipt are NOT crates and must not count.
      await receipt(day1, await supplier(point), 50, { boxes: 30 });
      await expect(service.forPoint(owner(), { collection_point_id: point })).resolves.toEqual(
        standing({
          on_hand: 350, in_field: 100, with_berry: 50, total: 500, shortfall: 0,
          deposit_units: 80, deposit_held: '9600.00',
        }),
      );
    });

    it('4. 50 full in OUR crates plus a return of 50: empties unchanged, people −50, berries +50', async () => {
      await receipt(day1, holder, 50);
      await giveBack(day1, holder, depositIssuance, 50, '120.00', '6000.00');
      await expect(service.forPoint(owner(), { collection_point_id: point })).resolves.toEqual(
        standing({
          on_hand: 350, in_field: 50, with_berry: 100, total: 500, shortfall: 0,
          deposit_units: 30, deposit_held: '3600.00',
        }),
      );
    });

    it('5. closing the shift sends the berries to the base; the next shift starts with none', async () => {
      await ds.query(
        `UPDATE shifts SET status = 'closed', closed_at = now(), closed_by_user_id = $2, broken_crates = 0
          WHERE id = $1`,
        [day1, userId],
      );
      await shift(point, '2026-09-11', null);
      await expect(service.forPoint(owner(), { collection_point_id: point })).resolves.toEqual(
        standing({
          on_hand: 350, in_field: 50, with_berry: 0, total: 400, shortfall: 100,
          deposit_units: 30, deposit_held: '3600.00',
        }),
      );
    });

    it('voided documents change nothing', async () => {
      const before = await service.forPoint(owner(), { collection_point_id: point });
      const [open] = await ds.query(
        `SELECT id FROM shifts WHERE collection_point_id = $1 AND closed_at IS NULL`,
        [point],
      );
      const s = await supplier(point);
      await receipt(day1, s, 40, { voided: true });
      await receipt(open.id, s, 40, { voided: true });
      await transfer(point, {
        ...acceptedTransfer(99),
        status: 'disputed', reported_crates: 99, resolved_crates: 99,
        resolved_by_user_id: userId, resolved_at: new Date(),
        voided_at: new Date(), voided_by_user_id: userId, void_reason: 'фікстура',
      });
      await transfer(point, {
        ...acceptedTransfer(77),
        voided_at: new Date(), voided_by_user_id: userId, void_reason: 'фікстура',
      });
      await issue(open.id, s, 25, 'deposit', '3000.00', { voided: true });
      await giveBack(open.id, holder, depositIssuance, 10, '120.00', '1200.00', { voided: true });
      await expect(service.forPoint(owner(), { collection_point_id: point })).resolves.toEqual(before);
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
  });

  it('a receipt-linked return nets to 0 on on_hand, moving units field → berries; voiding the receipt restores both', async () => {
    const p = await newPoint(100);
    await transfer(p, acceptedTransfer(100));
    const open = await shift(p, '2026-09-12', null);
    const s = await supplier(p);
    const issuance = await issue(open, s, 20, 'deposit', '2400.00');

    // Before the linked write: 20 empties out with the supplier, none with
    // berries yet.
    await expect(service.forPoint(owner(), { collection_point_id: p })).resolves.toMatchObject({
      on_hand: 80, in_field: 20, with_berry: 0, total: 100,
    });

    // `POST /intakes` with `returned_crates: 20` — a receipt carrying 20
    // crate-tare units, with a return of the same 20 units riding in on it,
    // linked via `crate_returns.intake_id`.
    const intakeId = await receipt(open, s, 20);
    await giveBack(open, s, issuance, 20, '120.00', '2400.00', { intakeId });

    // Σ returned (+20) cancels the receipt's own crate tare (−20): on_hand is
    // untouched. The 20 units move off `in_field` (the tranche they closed)
    // and onto `with_berry` (the open shift's own crate-tare receipt).
    await expect(service.forPoint(owner(), { collection_point_id: p })).resolves.toMatchObject({
      on_hand: 80, in_field: 0, with_berry: 20, total: 100,
    });

    // Voiding the receipt voids the linked return with it (`voidReturnForIntake`)
    // — simulated here by voiding both rows directly, since this file tests
    // `CrateStandingService`'s reading of the two tables, not the void
    // orchestration itself. Both figures come straight back.
    await ds.query(`UPDATE intakes SET voided_at = now(), voided_by_user_id = $2, void_reason = 'фікстура' WHERE id = $1`, [
      intakeId, userId,
    ]);
    await ds.query(
      `UPDATE crate_returns SET voided_at = now(), voided_by_user_id = $2, void_reason = 'фікстура' WHERE intake_id = $1`,
      [intakeId, userId],
    );
    await expect(service.forPoint(owner(), { collection_point_id: p })).resolves.toMatchObject({
      on_hand: 80, in_field: 20, with_berry: 0, total: 100,
    });
  });

  it('takes recorded breakage out of the empties (a NULL breakage adds 0)', async () => {
    const p = await newPoint(10);
    await transfer(p, acceptedTransfer(10));
    await shift(p, '2026-09-08', { broken: null });
    await shift(p, '2026-09-09', { broken: 3 });
    const got = await service.forPoint(owner(), { collection_point_id: p });
    expect(got).toMatchObject({ received: 10, on_hand: 7, total: 7, shortfall: 3 });
  });

  it('reads transfers through the three-way CASE: sent counts nothing, disputed counts resolved else reported', async () => {
    const p = await newPoint(100);
    await transfer(p, { status: 'sent', crates: 40 });
    await transfer(p, acceptedTransfer(10));
    await transfer(p, {
      ...acceptedTransfer(9),
      status: 'disputed', reported_crates: 7, resolved_crates: 6,
      resolved_by_user_id: userId, resolved_at: new Date(),
    });
    await transfer(p, { ...acceptedTransfer(8), status: 'disputed', reported_crates: 4 });
    const got = await service.forPoint(owner(), { collection_point_id: p });
    // 10 accepted + 6 resolved + 4 reported; the 40 still `sent` has not arrived.
    expect(got).toMatchObject({ received: 20, on_hand: 20, total: 20, shortfall: 80 });
  });

  /** §6.9 — «—», not 0: without an allotment there is no shortfall. */
  it('reports a point without an allotment as null, not zero', async () => {
    await expect(service.forPoint(owner(), { collection_point_id: bare })).resolves.toEqual({
      collection_point_id: bare,
      allotment: null,
      received: 0,
      on_hand: 0,
      in_field: 0,
      deposit_units: 0,
      deposit_held: '0.00',
      with_berry: 0,
      total: 0,
      shortfall: null,
    });
  });

  it('lets on_hand go negative when the documents issue more than was received', async () => {
    const p = await newPoint(500);
    await transfer(p, acceptedTransfer(500));
    const open = await shift(p, '2026-09-10', null);
    await issue(open, await supplier(p), 600, 'receipt', '0.00');
    const got = await service.forPoint(owner(), { collection_point_id: p });
    expect(got).toMatchObject({ received: 500, on_hand: -100, in_field: 600, total: 500, shortfall: 0 });
  });
});
