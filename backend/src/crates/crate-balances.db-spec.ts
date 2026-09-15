import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { CrateBalancesService } from './crate-balances.service';
import { CrateBalanceService } from './crate-balance.service';
import { CrateIssuance } from './crate-issuance.entity';
import { CrateReturn } from './crate-return.entity';
import { CrateReturnAllocation } from './crate-return-allocation.entity';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * `GET /crate-balances` against a real Postgres.
 *
 * THE ASSERTION THIS FILE EXISTS FOR is the last one: this list and
 * `CrateBalanceService.balanceFor` are two implementations of «what is still
 * out», one aggregating in SQL over a point and one summing in TypeScript for
 * one supplier. They must agree, and nothing but a test can make them.
 */
describe('CrateBalancesService.list (Postgres)', () => {
  let ds: DataSource;
  let list: CrateBalancesService;
  let single: CrateBalanceService;
  let run: string;
  let userId: string;
  let pointA: string;
  let pointB: string;
  let shiftA: string;
  let shiftB: string;
  /** Two deposit tranches at DIFFERENT prices — §6.5's case. */
  let deposits: string;
  /** Receipt only: units out, no cash cover anywhere. */
  let paper: string;
  /** Took some, brought all of it back. */
  let settled: string;
  /** Their only issuance was voided. */
  let voided: string;
  /** At the other point entirely. */
  let elsewhere: string;

  const owner = () =>
    ({ sub: userId, role: UserRole.NetworkOwner, collection_point_id: null }) as AuthenticatedUser;
  const operatorAt = (pointId: string) =>
    ({
      sub: userId,
      role: UserRole.PointOperator,
      collection_point_id: pointId,
    }) as AuthenticatedUser;

  const query = (over: Record<string, unknown> = {}) =>
    ({ page: 1, limit: 50, include_zero: false, ...over }) as never;

  const supplier = async (pointId: string, last: string): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Ящик', $2, true) RETURNING id`,
      [pointId, `${last}-${run}`],
    );
    return row.id;
  };

  const issue = async (
    shiftId: string,
    supplierId: string,
    units: number,
    mode: 'deposit' | 'receipt',
    perUnit: string,
    opts: { voided?: boolean } = {},
  ): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO crate_issuances
         (code, shift_id, supplier_id, units, mode, deposit_per_unit, deposit_taken,
          issued_by_user_id, voided_at, void_reason, voided_by_user_id)
       VALUES ($1, $2, $3, $4, $5::crate_issuance_mode, $6, $7, $8,
               $9, $10, $11)
       RETURNING id`,
      [
        `CB-${randomUUID().slice(0, 8)}`,
        shiftId,
        supplierId,
        units,
        mode,
        perUnit,
        // Postgres multiplies; this fixture never does money arithmetic in JS.
        mode === 'receipt' ? '0.00' : String(Number(perUnit) * units).replace(/^(\d+)$/, '$1.00'),
        userId,
        opts.voided ? new Date().toISOString() : null,
        opts.voided ? 'фікстура' : null,
        opts.voided ? userId : null,
      ],
    );
    return row.id;
  };

  /** A return plus the allocation rows that consume `issuanceId`. */
  const giveBack = async (
    shiftId: string,
    supplierId: string,
    issuanceId: string,
    units: number,
    perUnit: string,
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
        '0.00',
        userId,
        opts.voided ? new Date().toISOString() : null,
        opts.voided ? 'фікстура' : null,
        opts.voided ? userId : null,
      ],
    );
    await ds.query(
      `INSERT INTO crate_return_allocations (return_id, issuance_id, units, per_unit, amount)
       VALUES ($1, $2, $3, $4, '0.00')`,
      [ret.id, issuanceId, units, perUnit],
    );
  };

  const rowFor = async (supplierId: string, over: Record<string, unknown> = {}) => {
    const page = await list.list(owner(), query(over));
    return page.data.find((r) => r.supplier_id === supplierId);
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    run = randomUUID().slice(0, 8);
    list = new CrateBalancesService(ds);
    single = new CrateBalanceService(
      ds,
      ds.getRepository(CrateIssuance),
      ds.getRepository(CrateReturn),
      ds.getRepository(CrateReturnAllocation),
    );

    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role)
       VALUES ('Власник', $1, 'network_owner') RETURNING id`,
      [`Ящики-${run}`],
    );
    userId = user.id;

    const point = async (label: string): Promise<string> => {
      const [row] = await ds.query(
        `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
        [`Ящики ${label} ${run}`, `CB${label}${run.slice(0, 3).toUpperCase()}`],
      );
      return row.id;
    };
    pointA = await point('A');
    pointB = await point('B');

    const shift = async (pointId: string, date: string): Promise<string> => {
      const [row] = await ds.query(
        `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
         VALUES ($1, $2, $3::date) RETURNING id`,
        [pointId, userId, date],
      );
      return row.id;
    };
    shiftA = await shift(pointA, '2026-09-10');
    shiftB = await shift(pointB, '2026-09-10');

    deposits = await supplier(pointA, 'Завдаток');
    paper = await supplier(pointA, 'Розписка');
    settled = await supplier(pointA, 'Розрахувався');
    voided = await supplier(pointA, 'Сторновано');
    elsewhere = await supplier(pointB, 'Сусідній');

    // Two tranches at different prices: 20 at 120 and 20 at 130.
    await issue(shiftA, deposits, 20, 'deposit', '120.00');
    await issue(shiftA, deposits, 20, 'deposit', '130.00');
    await issue(shiftA, paper, 200, 'receipt', '0.00');
    const gone = await issue(shiftA, settled, 10, 'deposit', '100.00');
    await giveBack(shiftA, settled, gone, 10, '100.00');
    await issue(shiftA, voided, 15, 'deposit', '100.00', { voided: true });
    await issue(shiftB, elsewhere, 5, 'deposit', '100.00');
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('sums a supplier open tranches across issuances', async () => {
    const row = await rowFor(deposits);
    expect(row).toBeDefined();
    expect(row!.outstanding_units).toBe(40);
    // 20 x 120 + 20 x 130 = 5 000, computed by Postgres.
    expect(row!.deposit_held).toBe('5000.00');
    expect(row!.has_receipt).toBe(false);
  });

  /**
   * §6.4 — «різниця лише в грошах». The units are out either way; only the
   * cover differs, and `'0.00'` alone cannot say which case this is.
   */
  it('reports a receipt holder as units out with NO cash cover', async () => {
    const row = await rowFor(paper);
    expect(row!.outstanding_units).toBe(200);
    expect(row!.deposit_held).toBe('0.00');
    expect(row!.has_receipt).toBe(true);
  });

  it('drops a supplier whose returns consumed everything', async () => {
    expect(await rowFor(settled)).toBeUndefined();
  });

  it('lists that same supplier at zero when include_zero is asked for', async () => {
    const row = await rowFor(settled, { include_zero: true });
    expect(row).toBeDefined();
    expect(row!.outstanding_units).toBe(0);
    expect(row!.deposit_held).toBe('0.00');
  });

  it('ignores a VOIDED issuance entirely', async () => {
    expect(await rowFor(voided)).toBeUndefined();
  });

  /** A voided RETURN releases its allocations — no allocation row is deleted. */
  it('releases the units a voided return had consumed', async () => {
    const back = await supplier(pointA, 'Сторнували-повернення');
    const tranche = await issue(shiftA, back, 12, 'deposit', '100.00');
    await giveBack(shiftA, back, tranche, 12, '100.00', { voided: true });

    const row = await rowFor(back);
    expect(row!.outstanding_units).toBe(12);
  });

  it('scopes an operator to their own point', async () => {
    const page = await list.list(operatorAt(pointA), query({ collection_point_id: pointB }));
    expect(page.data.some((r) => r.supplier_id === elsewhere)).toBe(false);
    expect(page.data.some((r) => r.supplier_id === deposits)).toBe(true);
  });

  it('orders the heaviest holder first', async () => {
    const page = await list.list(operatorAt(pointA), query());
    const units = page.data.map((r) => r.outstanding_units);
    expect([...units].sort((a, b) => b - a)).toEqual(units);
  });

  /**
   * THE ANTI-DRIFT PIN. Two implementations of «what is still out» — this
   * list's SQL aggregate and `balanceFor`'s TypeScript sum over `tranchesFor`.
   * Nothing but this test keeps them equal.
   */
  it('agrees with GET /suppliers/:id/crate-balance, row for row', async () => {
    const page = await list.list(operatorAt(pointA), query());
    expect(page.data.length).toBeGreaterThan(1);

    for (const row of page.data) {
      const one = await single.balanceFor(row.supplier_id);
      expect({ units: row.outstanding_units, held: row.deposit_held }).toEqual({
        units: one.outstanding_units,
        held: one.deposit_held,
      });
    }
  });
});
