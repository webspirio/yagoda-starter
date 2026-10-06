import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { ShiftsService } from './shifts.service';
import { Shift } from './shift.entity';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/audit-log.entity';
import { TimeService } from '../time/time.service';
import { CrateStockGuard } from '../crate-stock/crate-stock.guard';
import { PointCashService } from '../point-cash/point-cash.service';
import { CashCountsService } from '../cash-counts/cash-counts.service';
import type { CollectionPointsService } from '../collection-points/collection-points.service';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * Spec 2026-10-06 end to end: the window, the author, the owner's decision,
 * reopen — and that the owner's incident list never treats a note as an answer.
 * Services built by hand, as in `shift-close.db-spec.ts` (same reasons).
 */
describe('operator note on a closing discrepancy (Postgres)', () => {
  let ds: DataSource;
  let shifts: ShiftsService;
  let counts: CashCountsService;
  let owner: AuthenticatedUser;
  let run: string;

  const code = async (p: Promise<unknown>) =>
    p.then(
      () => 'resolved',
      (e: { response?: { code?: string } }) => e.response?.code,
    );

  /** A fresh point and its two operators — `open` uses today's date, one shift per point per day. */
  const point = async (tag: string) => {
    const [{ id }] = (await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`Точка ${tag} ${run}`, `${tag}${run.slice(0, 5).toUpperCase()}`],
    )) as { id: string }[];
    const op = async (name: string): Promise<AuthenticatedUser> => {
      const [{ id: uid }] = (await ds.query(
        `INSERT INTO users (first_name, last_name, role, collection_point_id, is_active)
         VALUES ($1, $2, 'point_operator', $3, true) RETURNING id`,
        [name, `${tag} ${run}`, id],
      )) as { id: string }[];
      return { sub: uid, username: `${name}-${tag}-${run}`, role: UserRole.PointOperator, collection_point_id: id };
    };
    return { id, closer: await op('Оксана'), colleague: await op('Марія') };
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    const audit = new AuditService(ds.getRepository(AuditLog));
    const time = new TimeService({ appTimezone: 'Europe/Kyiv' });
    const cash = new PointCashService(ds, { appTimezone: 'Europe/Kyiv' });
    shifts = new ShiftsService(
      ds.getRepository(Shift),
      null as unknown as CollectionPointsService,
      audit,
      time,
      ds,
      cash,
      new CrateStockGuard(),
    );
    counts = new CashCountsService(ds, shifts, cash, audit, time);
    run = randomUUID().slice(0, 8);
    const [{ id: ownerId }] = (await ds.query(
      `INSERT INTO users (first_name, last_name, role, is_active)
       VALUES ('Тест', $1, 'network_owner', true) RETURNING id`,
      [`Owner ${run}`],
    )) as { id: string }[];
    owner = { sub: ownerId, username: `owner-${run}`, role: UserRole.NetworkOwner, collection_point_id: null };
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const closingRow = async (actor: AuthenticatedUser, shiftId: string) => {
    const page = await counts.list(actor, { shift_id: shiftId, page: 1, limit: 100, only_discrepancies: false } as never);
    return page.data.find((r) => r.kind === 'closing')!;
  };

  it('closer writes, colleague cannot, the owner still sees an open incident, reopen clears, the owner closes it', async () => {
    const p = await point('A');
    const opened = await shifts.open(p.closer, { counted_amount: '1000.00' });
    await shifts.close(p.closer, opened.id, { counted_amount: '900.00', broken_crates: 0 });

    expect(await code(shifts.setOperatorNote(p.colleague, opened.id, { operator_note: 'не я' }))).toBe(
      'NOT_SHIFT_CLOSER',
    );

    const noted = await shifts.setOperatorNote(p.closer, opened.id, { operator_note: '  віддав решту  ' });
    expect(noted.operator_note).toBe('віддав решту');
    expect(noted.operator_note_editable).toBe(true);

    const opRow = await closingRow(p.closer, opened.id);
    expect(opRow.operator_note).toBe('віддав решту');
    expect(opRow.operator_note_editable).toBe(true);
    expect(opRow.is_open).toBe(true);

    // The owner's working list: still there, still open, not editable for them.
    const ownerList = await counts.list(owner, {
      collection_point_id: p.id, only_discrepancies: true, page: 1, limit: 100,
    } as never);
    expect(ownerList.data.map((r) => r.shift_id)).toContain(opened.id);
    expect(ownerList.data.every((r) => r.operator_note_editable === false)).toBe(true);

    const [audit] = (await ds.query(
      `SELECT before, after FROM audit_log WHERE action = 'shift.operator_noted' AND target_id = $1`,
      [opened.id],
    )) as { before: unknown; after: unknown }[];
    expect(audit).toEqual({ before: { operator_note: null }, after: { operator_note: 'віддав решту' } });

    // Reopen: the note goes, and a reopened shift refuses a note until it is closed again.
    const reopened = await shifts.reopen(owner, opened.id, { reason: 'перерахунок' });
    expect(reopened.operator_note).toBeNull();
    expect(await code(shifts.setOperatorNote(p.closer, opened.id, { operator_note: 'ще раз' }))).toBe(
      'SHIFT_NOT_CLOSED',
    );

    await shifts.close(p.closer, opened.id, { counted_amount: '950.00', broken_crates: 0 });
    await shifts.setOperatorNote(p.closer, opened.id, { operator_note: 'знайшов 50 у конверті' });

    await shifts.setExplanation(owner, opened.id, { explanation: 'прийнято, утримати з зарплати' });
    expect(
      await code(shifts.setOperatorNote(p.closer, opened.id, { operator_note: 'змінюю' })),
    ).toBe('OWNER_ALREADY_EXPLAINED');
    expect((await closingRow(p.closer, opened.id)).operator_note_editable).toBe(false);
  });

  it('the window closes when the next shift exists', async () => {
    const p = await point('B');
    const opened = await shifts.open(p.closer, { counted_amount: '1000.00' });
    await shifts.close(p.closer, opened.id, { counted_amount: '800.00', broken_crates: 0 });
    // Tomorrow's shift, inserted directly: `open` takes today's date from the clock.
    await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date, status)
       VALUES ($1, $2, ($3::date + 1), 'open')`,
      [p.id, p.closer.sub, opened.business_date],
    );

    expect(await code(shifts.setOperatorNote(p.closer, opened.id, { operator_note: 'пізно' }))).toBe(
      'OPERATOR_NOTE_WINDOW_CLOSED',
    );
    expect((await closingRow(p.closer, opened.id)).operator_note_editable).toBe(false);
  });

  it('a matched close has nothing to explain', async () => {
    const p = await point('C');
    const opened = await shifts.open(p.closer, { counted_amount: '1000.00' });
    await shifts.close(p.closer, opened.id, { counted_amount: '1000.00', broken_crates: 0 });

    expect(await code(shifts.setOperatorNote(p.closer, opened.id, { operator_note: 'все добре' }))).toBe(
      'NO_DISCREPANCY',
    );
  });
});
