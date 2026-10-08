import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { openTestDataSource } from '../testing/db-harness';
import { ShiftsService } from '../shifts/shifts.service';
import { Shift } from '../shifts/shift.entity';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/audit-log.entity';
import { TimeService } from '../time/time.service';
import { CrateStockGuard } from '../crate-stock/crate-stock.guard';
import { PointCashService } from '../point-cash/point-cash.service';
import { CashCountsService } from './cash-counts.service';
import type { CollectionPointsService } from '../collection-points/collection-points.service';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * Spec 2026-10-08 end to end: explanations and operator notes live on the count,
 * with no window. Services built by hand, as in `shift-close.db-spec.ts` (same reasons).
 */
describe('count explanations and operator notes (Postgres)', () => {
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

  /** A fresh point and its operators — `open` uses today's date, one shift per point per day. */
  const point = async (tag: string) => {
    const [{ id }] = (await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`Точка ${tag} ${run}`, `${tag}${run.slice(0, 5).toUpperCase()}`],
    )) as { id: string }[];
    const op = async (name: string, at = id): Promise<AuthenticatedUser> => {
      const [{ id: uid }] = (await ds.query(
        `INSERT INTO users (first_name, last_name, role, collection_point_id, is_active)
         VALUES ($1, $2, 'point_operator', $3, true) RETURNING id`,
        [name, `${tag} ${run}`, at],
      )) as { id: string }[];
      return { sub: uid, username: `${name}-${tag}-${run}`, role: UserRole.PointOperator, collection_point_id: at };
    };
    // `closer` doubles as the opener where one operator does both; `other` is a colleague.
    return { id, closer: await op('Оксана'), opener: await op('Ірина'), other: await op('Марія') };
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

  const rowsOf = async (actor: AuthenticatedUser, shiftId: string) =>
    (await counts.list(actor, { shift_id: shiftId, page: 1, limit: 50, only_discrepancies: false } as never)).data;

  const closingRow = async (actor: AuthenticatedUser, shiftId: string) =>
    (await rowsOf(actor, shiftId)).find((r) => r.kind === 'closing')!;

  /** A closed earlier shift whose closing count was `amount` — today's opening is measured against it. */
  const earlierClose = async (p: { id: string; closer: AuthenticatedUser }, amount: string) => {
    const [{ id }] = (await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date, status, closed_at, closed_by_user_id)
       VALUES ($1, $2, CURRENT_DATE - 2, 'closed', now() - interval '2 days', $2) RETURNING id`,
      [p.id, p.closer.sub],
    )) as { id: string }[];
    await ds.query(
      `INSERT INTO cash_counts (shift_id, book, kind, counted_amount, expected_amount, counted_by_user_id, counted_at)
       VALUES ($1, 'berry', 'closing', $3, $3, $2, now() - interval '2 days')`,
      [id, p.closer.sub, amount],
    );
  };

  it('S6: an explained opening leaves the closing discrepancy open and writable', async () => {
    const p = await point('F');
    await earlierClose(p, '1000.00');
    const opened = await shifts.open(p.closer, { counted_amount: '900.00' });
    const opening = (await rowsOf(owner, opened.id)).find((r) => r.kind === 'opening')!;
    await counts.setExplanation(owner, opening.id, { explanation: 'недостача з учора' });
    await shifts.close(p.closer, opened.id, { counted_amount: '800.00', broken_crates: 0 });

    const closing = await closingRow(p.closer, opened.id);
    expect(closing.is_open).toBe(true);
    expect(closing.operator_note_editable).toBe(true);
    const listed = await counts.list(owner, {
      only_discrepancies: true, shift_id: opened.id, page: 1, limit: 50,
    } as never);
    expect(listed.data.map((r) => r.id)).toContain(closing.id);
    await counts.setOperatorNote(p.closer, closing.id, { operator_note: 'віддав решту' });
  });

  it('S3: the closer still writes after the next shift opened', async () => {
    const p = await point('B');
    const opened = await shifts.open(p.closer, { counted_amount: '1000.00' });
    await shifts.close(p.closer, opened.id, { counted_amount: '800.00', broken_crates: 0 });
    // Tomorrow's shift, inserted directly: `open` takes today's date from the clock.
    await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date, status)
       VALUES ($1, $2, ($3::date + 1), 'open')`,
      [p.id, p.closer.sub, opened.business_date],
    );
    const closing = await closingRow(p.closer, opened.id);

    await expect(
      counts.setOperatorNote(p.closer, closing.id, { operator_note: 'пізніше' }),
    ).resolves.toMatchObject({ operator_note: 'пізніше' });
  });

  it('S4: the opener explains the opening; another operator is NOT_COUNTER', async () => {
    const p = await point('G');
    await earlierClose(p, '1000.00');
    const opened = await shifts.open(p.opener, { counted_amount: '900.00' });
    const opening = (await rowsOf(p.opener, opened.id)).find((r) => r.kind === 'opening')!;

    await counts.setOperatorNote(p.opener, opening.id, { operator_note: 'учора недорахували' });
    expect(await code(counts.setOperatorNote(p.other, opening.id, { operator_note: 'я' }))).toBe('NOT_COUNTER');
  });

  it('reopen keeps the demoted row texts; the re-close is a fresh incident; the demoted row is COUNT_NOT_EXPLAINABLE', async () => {
    const p = await point('A');
    const opened = await shifts.open(p.closer, { counted_amount: '1000.00' });
    await shifts.close(p.closer, opened.id, { counted_amount: '900.00', broken_crates: 0 });
    const closingId = (await closingRow(p.closer, opened.id)).id;

    await counts.setOperatorNote(p.closer, closingId, { operator_note: 'перший раз' });
    await counts.setExplanation(owner, closingId, { explanation: 'утримати' });
    await shifts.reopen(owner, opened.id, { reason: 'перерахунок' });

    const demoted = (await rowsOf(owner, opened.id)).find((r) => r.id === closingId)!;
    expect(demoted.kind).toBe('midday');
    expect(demoted.explanation).toBe('утримати');
    expect(demoted.operator_note).toBe('перший раз');
    expect(await code(counts.setOperatorNote(p.closer, closingId, { operator_note: 'ще' }))).toBe(
      'COUNT_NOT_EXPLAINABLE',
    );

    await shifts.close(p.closer, opened.id, { counted_amount: '950.00', broken_crates: 0 });
    const reclosed = await closingRow(p.closer, opened.id);
    expect(reclosed.is_open).toBe(true);
    expect(reclosed.explanation).toBeNull();
  });

  it('an operator note never closes the incident; the owner then refuses further notes', async () => {
    const p = await point('C');
    const opened = await shifts.open(p.closer, { counted_amount: '1000.00' });
    await shifts.close(p.closer, opened.id, { counted_amount: '900.00', broken_crates: 0 });
    const closingId = (await closingRow(p.closer, opened.id)).id;

    await counts.setOperatorNote(p.closer, closingId, { operator_note: 'знайшов 50' });
    expect((await closingRow(owner, opened.id)).is_open).toBe(true);
    await counts.setExplanation(owner, closingId, { explanation: 'прийнято' });
    expect((await closingRow(owner, opened.id)).is_open).toBe(false);
    expect(await code(counts.setOperatorNote(p.closer, closingId, { operator_note: 'змінюю' }))).toBe(
      'OWNER_ALREADY_EXPLAINED',
    );
  });

  it("another point's operator gets 404 for a count id", async () => {
    const p = await point('H');
    const q = await point('I');
    const opened = await shifts.open(p.closer, { counted_amount: '1000.00' });
    await shifts.close(p.closer, opened.id, { counted_amount: '900.00', broken_crates: 0 });
    const closingId = (await closingRow(p.closer, opened.id)).id;

    await expect(
      counts.setOperatorNote(q.closer, closingId, { operator_note: 'x' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('records cash-count.operator_noted with before/after in the same transaction', async () => {
    const p = await point('J');
    const opened = await shifts.open(p.closer, { counted_amount: '1000.00' });
    await shifts.close(p.closer, opened.id, { counted_amount: '900.00', broken_crates: 0 });
    const closingId = (await closingRow(p.closer, opened.id)).id;

    await counts.setOperatorNote(p.closer, closingId, { operator_note: 'знайшов 50' });

    const [row] = (await ds.query(
      `SELECT before->>'operator_note' AS before, after->>'operator_note' AS after
         FROM audit_log WHERE action = 'cash-count.operator_noted' AND target_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [closingId],
    )) as { before: string | null; after: string }[];
    expect(row.before).toBeNull();
    expect(row.after).toBe('знайшов 50');
  });
});
