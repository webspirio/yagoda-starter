import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { ShiftsService } from './shifts.service';
import { Shift } from './shift.entity';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/audit-log.entity';
import { TimeService } from '../time/time.service';
import { PointCashService } from '../point-cash/point-cash.service';
import type { CollectionPointsService } from '../collection-points/collection-points.service';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * CLOSING A SHIFT THAT PAID OUT MORE THAN IT TOOK IN.
 *
 * `expectedForClosing` is the opening count plus this shift's SIGNED movements
 * (spec §3.3), and nothing bounds that sum below zero: payouts are subtracted,
 * and a transfer that was accepted and then voided stops being added while the
 * payouts it funded stay gone (§9.3 — «інакше сторно стає способом красти»).
 *
 * The flow below is the one `TransfersService.void` documents as the intended
 * way to undo a mistaken «Прийняв», and before `1788600000010` it ended in a
 * 500 from `POST /shifts/:id/close`: the insert violated
 * `CHK_cash_counts_expected_non_negative`. The shift could then never be
 * closed, `UQ_shifts_open_per_point` forbade opening the next day's, and
 * `close` is operator-only (§10.3) so the owner could not rescue it. The point
 * stopped trading.
 *
 * WHY THE SERVICE IS CONSTRUCTED BY HAND rather than resolved from a booted
 * `AppModule`: everything under test here is SQL and one INSERT, and this
 * file's whole subject — the expectation the close writes — needs a real
 * Postgres and nothing else. `point-cash.db-spec.ts` builds `PointCashService`
 * the same way for the same reason.
 *
 * `CollectionPointsService` IS PASSED AS `null`, and that is safe today for a
 * checkable reason rather than a hopeful one: `ShiftsService` injects it and
 * never calls it — `grep points shifts.service.ts` finds the import and the
 * constructor parameter and nothing else. If that changes, this spec throws a
 * TypeError naming the method, which is a legible failure rather than a silent
 * one. The dead injection is recorded in the follow-ups.
 */
describe('ShiftsService.close with negative expected movements (Postgres)', () => {
  let ds: DataSource;
  let service: ShiftsService;
  let ownerId: string;
  let operator: AuthenticatedUser;
  let pointId: string;
  let operatorDisplayName: string;

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new ShiftsService(
      ds.getRepository(Shift),
      null as unknown as CollectionPointsService,
      new AuditService(ds.getRepository(AuditLog)),
      new TimeService({ appTimezone: 'Europe/Kyiv' }),
      ds,
      new PointCashService(ds, { appTimezone: 'Europe/Kyiv' }),
    );

    const run = randomUUID().slice(0, 8);
    // A FRESH POINT per run. `open` derives `business_date` from the real
    // clock, and `UQ_shifts_point_business_date` allows one shift per point
    // per day — a shared point would make the second run of the day red.
    [{ id: pointId }] = (await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`Точка ${run}`, `N${run.slice(0, 6).toUpperCase()}`],
    )) as { id: string }[];

    [{ id: ownerId }] = (await ds.query(
      `INSERT INTO users (first_name, last_name, role, is_active)
       VALUES ('Тест', $1, 'network_owner', true) RETURNING id`,
      [`Owner ${run}`],
    )) as { id: string }[];

    const operatorLastName = `Приймальник ${run}`;
    const [{ id: operatorId }] = (await ds.query(
      `INSERT INTO users (first_name, last_name, role, collection_point_id, is_active)
       VALUES ('Оксана', $1, 'point_operator', $2, true) RETURNING id`,
      [operatorLastName, pointId],
    )) as { id: string }[];
    operator = {
      sub: operatorId,
      username: `oksana-${run}`,
      role: UserRole.PointOperator,
      collection_point_id: pointId,
    };
    // D-8 — `displayNameOf(user)`: "first last" trimmed.
    operatorDisplayName = `Оксана ${operatorLastName}`;
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('closes a shift whose voided transfer left the expectation at −8000.00', async () => {
    // 1. The drawer holds 1 000 at open. This is the point's first count, so
    //    `expected` equals `counted` and the chain starts at 1 000.
    const shift = await service.open(operator, { counted_amount: '1000.00' });
    // D-8 — the opener's name, resolved through `loadDisplayNames`.
    expect(shift.opened_by_name).toBe(operatorDisplayName);
    expect(shift.closed_by_name).toBeNull();

    // 2. A transfer of 10 000 arrives and is accepted into this shift. Seeded
    //    directly: what is under test is the CLOSE, and the accept path has
    //    its own specs. `accepted_date` is the shift's business date, which is
    //    how `movementsSql` joins a transfer to a shift (§4.2).
    const [{ id: transferId }] = (await ds.query(
      `INSERT INTO transfers (collection_point_id, cash, crates, carrier, sent_by_user_id,
                              sent_at, status, accepted_by_user_id, accepted_date, accepted_at)
       VALUES ($1, '10000.00', 0, 'Іван, Ducato', $2, now(), 'accepted', $3, $4, now())
       RETURNING id`,
      [pointId, ownerId, operator.sub, shift.business_date],
    )) as { id: string }[];

    // 3. 9 000 goes out to suppliers during the day.
    const [{ id: supplierId }] = (await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, kind, is_active)
       VALUES ($1, 'Петро', $2, 'none', true) RETURNING id`,
      [pointId, `Мельник ${randomUUID().slice(0, 8)}`],
    )) as { id: string }[];
    await ds.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id)
       VALUES ($1, $2, $3, '9000.00', $4)`,
      [`PO-${randomUUID().slice(0, 12)}`, shift.id, supplierId, operator.sub],
    );

    // 4. The owner voids the transfer — §9.3's correction for a mistaken
    //    «Прийняв». The transfer stops being added; the payouts it funded stay
    //    subtracted, because that money physically left the drawer.
    await ds.query(
      `UPDATE transfers SET voided_at = now(), voided_by_user_id = $2,
                            void_reason = 'Помилково прийнято' WHERE id = $1`,
      [transferId, ownerId],
    );

    // 1 000 + (0 − 9 000) = −8 000. The expectation is a real fact: the drawer
    // owes more than it holds.
    const cash = new PointCashService(ds, { appTimezone: 'Europe/Kyiv' });
    await expect(cash.expectedForClosing(shift.id)).resolves.toBe('-8000.00');

    // THE ASSERTION THIS FILE EXISTS FOR. Against `1788600000009`'s
    // `CHK_cash_counts_expected_non_negative` this line throws a
    // QueryFailedError and the point is stranded.
    const closed = await service.close(operator, shift.id, { counted_amount: '0.00', broken_crates: 0 });
    expect(closed.status).toBe('closed');
    // D-8 — same operator opened and closed, so both names match.
    expect(closed.opened_by_name).toBe(operatorDisplayName);
    expect(closed.closed_by_name).toBe(operatorDisplayName);

    const [row] = (await ds.query(
      `SELECT counted_amount::text AS counted, expected_amount::text AS expected
         FROM cash_counts WHERE shift_id = $1 AND kind = 'closing' AND book = 'berry'`,
      [shift.id],
    )) as { counted: string; expected: string }[];
    // The negative expectation is STORED, not clamped: clamping would turn a
    // 8 000 deficit into an 8 000 surplus in `Σ (counted − expected)`.
    expect(row).toEqual({ counted: '0.00', expected: '-8000.00' });
  });
});
