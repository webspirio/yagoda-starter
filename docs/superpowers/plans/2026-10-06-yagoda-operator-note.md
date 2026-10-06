# Operator's Note on a Closing Discrepancy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator who closed a shift record their own account of a closing cash discrepancy (`shifts.operator_note`) while the owner's `explanation` stays the only thing that closes the incident.

**Architecture:** One nullable column on `shifts`. One pure module (`backend/src/shifts/operator-note.ts`) holds the refusal rules, and both the write (`PUT /shifts/:id/operator-note`) and the read flag (`operator_note_editable` on `ShiftResponse` and `GET /cash-counts` rows) are derived from it, so the button and the server cannot disagree. Frontend: a new `features/set-operator-note` slice (hook, form, dialog), surfaced on the close result screen (by swapping the result dialog's content, never opening a second dialog), in `CashCountHistory`, `ExplainDiscrepancyDialog` and `ShiftCountPanel`.

**Tech Stack:** NestJS 12, TypeORM, PostgreSQL 16, Jest (unit + `*.db-spec.ts`), React + TanStack Query + react-hook-form, Vitest + Testing Library, i18next.

**Spec:** `docs/superpowers/specs/2026-10-06-yagoda-operator-note-design.md`

## Global Constraints

- Branch: `feat/operator-note` (already created from `origin/main`). No worktree.
- Migration file: `backend/src/migrations/1788600000021-ShiftOperatorNote.ts`, class `ShiftOperatorNote1788600000021`. Never edit an existing migration.
- Column: `shifts.operator_note text NULL`, constraint `CHK_shifts_operator_note_not_blank` = `"operator_note" IS NULL OR btrim("operator_note") <> ''`.
- Route: `PUT /shifts/:id/operator-note`, `@Auth(UserRole.PointOperator)`, body `{ operator_note: string }`, 1–2000 chars, `/\S/`, trimmed before save.
- Refusals, in this order: `SHIFT_NOT_CLOSED` 409 → `NOT_SHIFT_CLOSER` 403 → `OPERATOR_NOTE_WINDOW_CLOSED` 409 → `OWNER_ALREADY_EXPLAINED` 409 → `NO_DISCREPANCY` 409.
- Audit action: `shift.operator_noted`, `before: { operator_note }`, `after: { operator_note }`, same transaction as the write.
- `is_open`, the `only_discrepancies` filter and `unexplained_difference` do NOT change.
- Reopen sets `operator_note = null`; the owner's `explanation` is untouched by reopen.
- Frontend tests run in English (`test-setup` pins `en`); assert English strings.
- Vitest does not typecheck: run `npm run typecheck -w frontend` (`tsc -b`) after any frontend type change.
- The migration makes this a `npm run verify:full` change. Quote the verdict line; name any SKIPPED row.
- Comments: short why-comments only; match the density of the file you are in.

## Review Focus

1. **A legacy `explanation = ''`** (the read side already treats `''` as unexplained) must count as "the owner has not decided", or the operator is locked out of a shift the owner's list still shows as open. Test added to Task 2.
2. **A stale button.** The operator opens the history page, the next shift opens elsewhere (a colleague's phone), then they press «Add my explanation»: the server returns 409 `OPERATOR_NOTE_WINDOW_CLOSED`, and the form must show the specific sentence and stay open, not a generic failure. Test added to Task 6.
3. **The note on a reopened-but-not-yet-re-closed shift** must be refused as `SHIFT_NOT_CLOSED` with operator-appropriate wording, not «Only a closed shift can be reopened» (the shared `day.errors.notClosed`). Override and test in Task 6; server-side case in Task 5.
4. **The owner's own list after an operator note.** The row must stay open (red, «Explain» button present) and show the operator's text, or the owner reads the incident as handled. Tests in Task 5 (`only_discrepancies`) and Task 8 (UI).
5. **The result screen after save.** Saving must close the dialog (not drop back to the result), and the next close the same session must show the result, not the stale form. Test added to Task 7.

---

### Task 1: Schema — `shifts.operator_note`

**Files:**
- Create: `backend/src/migrations/1788600000021-ShiftOperatorNote.ts`
- Create: `backend/src/migrations/shift-operator-note-schema.db-spec.ts`
- Modify: `backend/src/shifts/shift.entity.ts` (after the `explanation` column, ~line 136, and the class-level `@Check`s, ~line 89)
- Modify: `28-db-schema.dbml` (`Table shifts`, line ~174)

**Interfaces:**
- Produces: `Shift.operator_note: string | null` (entity property), DB column `shifts.operator_note`.

- [ ] **Step 1: Write the failing schema test**

`backend/src/migrations/shift-operator-note-schema.db-spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/** CHK_shifts_operator_note_not_blank gets a row that would be legal without it. */
describe('shifts.operator_note schema (Postgres)', () => {
  let ds: DataSource;
  let pointId: string;
  let userId: string;
  let day = 0;

  const insertShift = async (over: Record<string, unknown> = {}) => {
    day += 1;
    const row: Record<string, unknown> = {
      collection_point_id: pointId,
      opened_by_user_id: userId,
      business_date: `2026-02-${String(day).padStart(2, '0')}`,
      status: 'closed',
      closed_at: new Date(),
      closed_by_user_id: userId,
      ...over,
    };
    const keys = Object.keys(row);
    return ds.query(
      `INSERT INTO shifts (${keys.map((k) => `"${k}"`).join(', ')})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      keys.map((k) => row[k]),
    );
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    const run = randomUUID().slice(0, 8);
    [{ id: pointId }] = await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`Точка ${run}`, `O${run.slice(0, 6).toUpperCase()}`],
    );
    [{ id: userId }] = await ds.query(
      `INSERT INTO users (first_name, last_name, role, is_active)
       VALUES ('Тест', $1, 'network_owner', true) RETURNING id`,
      [`Owner ${run}`],
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('defaults to NULL', async () => {
    const [{ id }] = await insertShift();
    const [row] = await ds.query('SELECT operator_note FROM shifts WHERE id = $1', [id]);
    expect(row.operator_note).toBeNull();
  });

  it('stores a real note', async () => {
    const [{ id }] = await insertShift({ operator_note: 'віддав решту з іншої шухляди' });
    const [row] = await ds.query('SELECT operator_note FROM shifts WHERE id = $1', [id]);
    expect(row.operator_note).toBe('віддав решту з іншої шухляди');
  });

  it('refuses a blank note — only reopen puts it back to NULL', async () => {
    await expect(insertShift({ operator_note: '   ' })).rejects.toThrow(
      /CHK_shifts_operator_note_not_blank/,
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:db -w backend -- shift-operator-note-schema`
Expected: FAIL. The first test errors with `column "operator_note" does not exist`.

- [ ] **Step 3: Write the migration**

`backend/src/migrations/1788600000021-ShiftOperatorNote.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 2026-10-06 — the closing operator's own account of a cash discrepancy.
 * Informs the owner; only `explanation` closes the incident.
 *
 * NULLABLE, and a note is never blanked: the CHECK forbids '' and whitespace,
 * so NULL keeps one meaning — «nothing written» (reopen writes it back).
 */
export class ShiftOperatorNote1788600000021 implements MigrationInterface {
  name = 'ShiftOperatorNote1788600000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "shifts" ADD COLUMN "operator_note" text`);
    await queryRunner.query(`
      ALTER TABLE "shifts"
        ADD CONSTRAINT "CHK_shifts_operator_note_not_blank"
          CHECK ("operator_note" IS NULL OR btrim("operator_note") <> '')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shifts" DROP CONSTRAINT "CHK_shifts_operator_note_not_blank"`,
    );
    await queryRunner.query(`ALTER TABLE "shifts" DROP COLUMN "operator_note"`);
  }
}
```

- [ ] **Step 4: Add the column to the entity**

In `backend/src/shifts/shift.entity.ts`, add next to the existing `@Check('CHK_shifts_broken_crates_closed', …)` decorator:

```ts
// Spec 2026-10-06 — declared so `migration:generate` does not propose dropping it.
@Check('CHK_shifts_operator_note_not_blank', `"operator_note" IS NULL OR btrim("operator_note") <> ''`)
```

and directly under the `explanation` column:

```ts
  /** The closing operator's own account of the discrepancy (spec 2026-10-06).
   *  Never closes the incident — only `explanation` does. Cleared by reopen. */
  @Column({ type: 'text', nullable: true })
  operator_note: string | null;
```

- [ ] **Step 5: Add the column to the DBML**

In `28-db-schema.dbml`, `Table shifts`, directly under `  explanation text` add:

```
  operator_note text
```

(The `Note` sentence is added in Task 9 with the other docs.)

- [ ] **Step 6: Run the test and watch it pass**

Run: `npm run test:db -w backend -- shift-operator-note-schema`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
git add backend/src/migrations/1788600000021-ShiftOperatorNote.ts backend/src/migrations/shift-operator-note-schema.db-spec.ts backend/src/shifts/shift.entity.ts 28-db-schema.dbml
git commit -m "feat(shifts): operator_note column with a not-blank CHECK"
```

---

### Task 2: The rule — `shifts/operator-note.ts`

**Files:**
- Create: `backend/src/shifts/operator-note.ts`
- Create: `backend/src/shifts/operator-note.spec.ts`

**Interfaces:**
- Consumes: `Shift` (Task 1), `UserRole`, `AuthenticatedUser`.
- Produces:
  - `interface OperatorNoteFacts { is_newest: boolean; has_discrepancy: boolean }`
  - `const NO_FACTS: OperatorNoteFacts` (both `false`)
  - `type NoteShift = Pick<Shift, 'closed_at' | 'closed_by_user_id' | 'explanation'>`
  - `operatorNoteRefusal(actor: AuthenticatedUser, shift: NoteShift, facts: OperatorNoteFacts): HttpException | null`
  - `operatorNoteEditable(actor: AuthenticatedUser, shift: NoteShift, facts: OperatorNoteFacts): boolean`
  - `couldEditOperatorNote(actor: AuthenticatedUser, shift: NoteShift): boolean` (the cheap pre-filter that decides whether facts are worth loading)
  - `loadOperatorNoteFacts(m: EntityManager, shiftIds: string[]): Promise<Map<string, OperatorNoteFacts>>`

- [ ] **Step 1: Write the failing tests**

`backend/src/shifts/operator-note.spec.ts`:

```ts
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import {
  NO_FACTS,
  couldEditOperatorNote,
  loadOperatorNoteFacts,
  operatorNoteEditable,
  operatorNoteRefusal,
} from './operator-note';

const closer = { sub: 'u-op', username: 'op', role: UserRole.PointOperator, collection_point_id: 'p1' };
const colleague = { ...closer, sub: 'u-op-2', username: 'op2' };
const owner = { sub: 'u-own', username: 'own', role: UserRole.NetworkOwner, collection_point_id: null };

const closed = { closed_at: new Date(), closed_by_user_id: 'u-op', explanation: null };
const ok = { is_newest: true, has_discrepancy: true };

const code = (e: unknown) => (e as { getResponse(): { code: string } }).getResponse().code;

describe('operatorNoteRefusal', () => {
  it('allows the closer while every condition holds', () => {
    expect(operatorNoteRefusal(closer, closed, ok)).toBeNull();
  });

  it('refuses an open shift first', () => {
    const r = operatorNoteRefusal(closer, { ...closed, closed_at: null }, NO_FACTS);
    expect(r).toBeInstanceOf(ConflictException);
    expect(code(r)).toBe('SHIFT_NOT_CLOSED');
  });

  it('refuses anyone but the closer', () => {
    const r = operatorNoteRefusal(colleague, closed, ok);
    expect(r).toBeInstanceOf(ForbiddenException);
    expect(code(r)).toBe('NOT_SHIFT_CLOSER');
  });

  it('refuses once the next shift exists', () => {
    expect(code(operatorNoteRefusal(closer, closed, { ...ok, is_newest: false }))).toBe(
      'OPERATOR_NOTE_WINDOW_CLOSED',
    );
  });

  it('refuses after the owner decided', () => {
    expect(code(operatorNoteRefusal(closer, { ...closed, explanation: 'з’ясовано' }, ok))).toBe(
      'OWNER_ALREADY_EXPLAINED',
    );
  });

  it("treats a legacy '' explanation as undecided — the owner's list does too", () => {
    expect(operatorNoteRefusal(closer, { ...closed, explanation: '' }, ok)).toBeNull();
  });

  it('refuses a close that matched', () => {
    expect(code(operatorNoteRefusal(closer, closed, { ...ok, has_discrepancy: false }))).toBe(
      'NO_DISCREPANCY',
    );
  });
});

describe('operatorNoteEditable', () => {
  it('is the absence of a refusal for an operator', () => {
    expect(operatorNoteEditable(closer, closed, ok)).toBe(true);
    expect(operatorNoteEditable(closer, closed, NO_FACTS)).toBe(false);
  });

  it('is false for the owner whatever the facts', () => {
    expect(operatorNoteEditable(owner, { ...closed, closed_by_user_id: 'u-own' }, ok)).toBe(false);
  });
});

describe('couldEditOperatorNote', () => {
  it('needs no facts to rule out the owner, an open shift, another closer or a decided one', () => {
    expect(couldEditOperatorNote(closer, closed)).toBe(true);
    expect(couldEditOperatorNote(owner, closed)).toBe(false);
    expect(couldEditOperatorNote(closer, { ...closed, closed_at: null })).toBe(false);
    expect(couldEditOperatorNote(colleague, closed)).toBe(false);
    expect(couldEditOperatorNote(closer, { ...closed, explanation: 'так' })).toBe(false);
  });
});

describe('loadOperatorNoteFacts', () => {
  it('asks nothing for no ids', async () => {
    const m = { query: jest.fn() };
    expect((await loadOperatorNoteFacts(m as never, [])).size).toBe(0);
    expect(m.query).not.toHaveBeenCalled();
  });

  it('maps rows by shift id', async () => {
    const m = {
      query: jest.fn().mockResolvedValue([{ id: 's1', is_newest: true, has_discrepancy: false }]),
    };
    const facts = await loadOperatorNoteFacts(m as never, ['s1']);
    expect(facts.get('s1')).toEqual({ is_newest: true, has_discrepancy: false });
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining('NOT EXISTS'), [['s1']]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -w backend -- operator-note.spec`
Expected: FAIL with `Cannot find module './operator-note'`.

- [ ] **Step 3: Write the module**

`backend/src/shifts/operator-note.ts`:

```ts
import { ConflictException, ForbiddenException, HttpException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { Shift } from './shift.entity';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * Spec 2026-10-06 — who may write `shifts.operator_note`, and when. ONE
 * definition: the PUT throws what `operatorNoteRefusal` returns, and every read
 * flag is `refusal === null`, so the button and the server cannot disagree.
 */
export interface OperatorNoteFacts {
  /** No shift at the same point has a later business_date (the window). */
  is_newest: boolean;
  /** The standing berry closing count disagrees with its expectation. */
  has_discrepancy: boolean;
}

export const NO_FACTS: OperatorNoteFacts = { is_newest: false, has_discrepancy: false };

export type NoteShift = Pick<Shift, 'closed_at' | 'closed_by_user_id' | 'explanation'>;

export function operatorNoteRefusal(
  actor: AuthenticatedUser,
  shift: NoteShift,
  facts: OperatorNoteFacts,
): HttpException | null {
  // The count is blind until the close is written, so there is nothing to explain before it.
  if (!shift.closed_at) {
    return new ConflictException({ message: 'That shift is not closed', code: 'SHIFT_NOT_CLOSED' });
  }
  // §10.3 — the testimony belongs to whoever held the drawer.
  if (shift.closed_by_user_id !== actor.sub) {
    return new ForbiddenException({
      message: 'Only the operator who closed the shift may explain it',
      code: 'NOT_SHIFT_CLOSER',
    });
  }
  if (!facts.is_newest) {
    return new ConflictException({
      message: 'The next shift is already open — the owner decides from here',
      code: 'OPERATOR_NOTE_WINDOW_CLOSED',
    });
  }
  // `''` is undecided, matching `is_open` and `only_discrepancies`.
  if (shift.explanation) {
    return new ConflictException({
      message: 'The owner has already explained this discrepancy',
      code: 'OWNER_ALREADY_EXPLAINED',
    });
  }
  if (!facts.has_discrepancy) {
    return new ConflictException({
      message: 'That shift closed without a discrepancy',
      code: 'NO_DISCREPANCY',
    });
  }
  return null;
}

export function operatorNoteEditable(
  actor: AuthenticatedUser,
  shift: NoteShift,
  facts: OperatorNoteFacts,
): boolean {
  return actor.role === UserRole.PointOperator && operatorNoteRefusal(actor, shift, facts) === null;
}

/** The checks that need no query — so most reads never load facts at all. */
export function couldEditOperatorNote(actor: AuthenticatedUser, shift: NoteShift): boolean {
  return (
    actor.role === UserRole.PointOperator &&
    !!shift.closed_at &&
    shift.closed_by_user_id === actor.sub &&
    !shift.explanation
  );
}

/** One query for any number of shifts (D-8). */
export async function loadOperatorNoteFacts(
  m: EntityManager,
  shiftIds: string[],
): Promise<Map<string, OperatorNoteFacts>> {
  if (shiftIds.length === 0) return new Map();
  const rows = (await m.query(
    `SELECT s.id,
            NOT EXISTS (SELECT 1 FROM shifts n
                         WHERE n.collection_point_id = s.collection_point_id
                           AND n.business_date > s.business_date) AS is_newest,
            EXISTS (SELECT 1 FROM cash_counts c
                     WHERE c.shift_id = s.id AND c.book = 'berry' AND c.kind = 'closing'
                       AND c.counted_amount <> c.expected_amount) AS has_discrepancy
       FROM shifts s
      WHERE s.id = ANY($1::uuid[])`,
    [shiftIds],
  )) as { id: string; is_newest: boolean; has_discrepancy: boolean }[];
  return new Map(
    rows.map((r) => [r.id, { is_newest: r.is_newest, has_discrepancy: r.has_discrepancy }]),
  );
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm test -w backend -- operator-note.spec`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/shifts/operator-note.ts backend/src/shifts/operator-note.spec.ts
git commit -m "feat(shifts): one rule for who may write the operator note"
```

---

### Task 3: Shifts — write route, reopen clears, responses carry the note

**Files:**
- Create: `backend/src/shifts/dto/set-operator-note.dto.ts`
- Modify: `backend/src/shifts/shift.mapper.ts` (whole file, 53 lines)
- Modify: `backend/src/shifts/shift.mapper.spec.ts` (every `toShiftResponse(` call, plus the fixture)
- Modify: `backend/src/shifts/shifts.service.ts` (imports; `open` 141-142, `close` 236-237, `reopen` 301-347, `setExplanation` 351-382, `list` 407-415, `current` 425-426, `findOne` 429-433; new `setOperatorNote` and `respond`)
- Modify: `backend/src/shifts/shifts.controller.ts` (role table comment lines 27-41; new route after `setExplanation`)
- Modify: `backend/src/audit/audit-log.entity.ts:58` (add the action)
- Modify: `backend/src/shifts/shifts.service.spec.ts` (four `manager` mocks gain `query`; new `describe` blocks)

**Interfaces:**
- Consumes: everything Task 2 produces.
- Produces:
  - `ShiftResponse.operator_note: string | null`, `ShiftResponse.operator_note_editable: boolean`
  - `toShiftResponse(shift: Shift, names: ReadonlyMap<string, string>, operatorNoteEditable: boolean): ShiftResponse`
  - `ShiftsService.setOperatorNote(actor: AuthenticatedUser, id: string, dto: SetOperatorNoteDto): Promise<ShiftResponse>`
  - `SetOperatorNoteDto { operator_note: string }`
  - audit action `'shift.operator_noted'`

- [ ] **Step 1: Give every unit-test manager a `query` seam**

`respond` (Step 6) calls `loadOperatorNoteFacts`, which calls `m.query`. In `backend/src/shifts/shifts.service.spec.ts` add this line to EACH of the four `manager` object literals (lines ~90, ~436, ~533, ~613):

```ts
      // `loadOperatorNoteFacts` — no facts means «not editable», which no older test cares about.
      query: jest.fn().mockResolvedValue([]),
```

and add `query: jest.Mock;` to the `manager` type at line ~41.

- [ ] **Step 2: Write the failing service tests**

Append inside the top-level `describe('ShiftsService', …)` block of `shifts.service.spec.ts`, after `describe('reopen', …)`:

```ts
  describe('setOperatorNote', () => {
    const closedByOp = (over: Record<string, unknown> = {}) =>
      shift({ closed_at: new Date(), closed_by_user_id: 'u-op', status: ShiftStatus.Closed, ...over });
    const facts = (over: Record<string, unknown> = {}) => [
      { id: SHIFT_ID, is_newest: true, has_discrepancy: true, ...over },
    ];

    it('trims and saves the closer’s note, audits it and reports it editable', async () => {
      repo.findOne.mockResolvedValueOnce(closedByOp({ operator_note: null }));
      manager.query.mockResolvedValue(facts());

      const res = await service.setOperatorNote(operator, SHIFT_ID, {
        operator_note: '  віддав решту з іншої шухляди ',
      });

      expect(manager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ operator_note: 'віддав решту з іншої шухляди' }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'shift.operator_noted',
          before: { operator_note: null },
          after: { operator_note: 'віддав решту з іншої шухляди' },
        }),
        manager,
      );
      expect(res.operator_note).toBe('віддав решту з іншої шухляди');
      expect(res.operator_note_editable).toBe(true);
    });

    it('records the replaced text in before', async () => {
      repo.findOne.mockResolvedValueOnce(closedByOp({ operator_note: 'перша версія' }));
      manager.query.mockResolvedValue(facts());

      await service.setOperatorNote(operator, SHIFT_ID, { operator_note: 'друга версія' });

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ before: { operator_note: 'перша версія' } }),
        manager,
      );
    });

    it.each([
      ['SHIFT_NOT_CLOSED', shift(), facts()],
      ['NOT_SHIFT_CLOSER', closedByOp({ closed_by_user_id: 'u-someone' }), facts()],
      ['OPERATOR_NOTE_WINDOW_CLOSED', closedByOp(), facts({ is_newest: false })],
      ['OWNER_ALREADY_EXPLAINED', closedByOp({ explanation: 'з’ясовано' }), facts()],
      ['NO_DISCREPANCY', closedByOp(), facts({ has_discrepancy: false })],
    ])('refuses with %s and writes nothing', async (code, row, rows) => {
      repo.findOne.mockResolvedValueOnce(row);
      manager.query.mockResolvedValue(rows);

      await expect(
        service.setOperatorNote(operator, SHIFT_ID, { operator_note: 'щось' }),
      ).rejects.toMatchObject({ response: { code } });
      expect(manager.save).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('404s another point’s shift', async () => {
      repo.findOne.mockResolvedValueOnce(closedByOp());
      await expect(
        service.setOperatorNote(otherOperator, SHIFT_ID, { operator_note: 'щось' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('setExplanation', () => {
    it('writes under the row lock, inside a transaction', async () => {
      repo.findOne.mockResolvedValueOnce(
        shift({ closed_at: new Date(), closed_by_user_id: 'u-op', status: ShiftStatus.Closed }),
      );

      await service.setExplanation(owner, SHIFT_ID, { explanation: ' з’ясовано ' });

      expect(manager.findOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
      expect(manager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ explanation: 'з’ясовано' }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'shift.explained' }),
        manager,
      );
    });
  });
```

And inside `describe('reopen', …)`, after `'clears broken_crates when the owner reopens'`:

```ts
    it('clears the operator note and keeps the old text in the audit', async () => {
      repo.findOne
        .mockResolvedValueOnce(
          shift({
            closed_at: new Date(),
            closed_by_user_id: 'u-op',
            status: ShiftStatus.Closed,
            operator_note: 'віддав решту',
          }),
        )
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(shift({ id: SHIFT_ID }));

      const reopened = await service.reopen(owner, SHIFT_ID, { reason: 'помилка' });

      expect(reopened.operator_note).toBeNull();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'shift.reopened',
          before: expect.objectContaining({ operator_note: 'віддав решту' }),
          after: expect.objectContaining({ operator_note: null }),
        }),
        expect.anything(),
      );
    });
```

Also add `operator_note: null,` to the `shift` fixture in that file (after `explanation: null,`, line ~61).

- [ ] **Step 3: Run them and watch them fail**

Run: `npm test -w backend -- shifts.service.spec`
Expected: FAIL. `service.setOperatorNote is not a function`; the `setExplanation` lock assertion fails; the reopen test sees `operator_note: 'віддав решту'`.

- [ ] **Step 4: Add the DTO and the audit action**

`backend/src/shifts/dto/set-operator-note.dto.ts`:

```ts
import { IsString, Length, Matches } from 'class-validator';

/**
 * Spec 2026-10-06 — the closing operator's account, same shape as
 * `SetExplanationDto`. It informs the owner and closes nothing: `is_open`
 * still waits for `explanation`.
 */
export class SetOperatorNoteDto {
  @IsString()
  @Length(1, 2000)
  @Matches(/\S/, { message: 'operator_note must not be blank' })
  operator_note: string;
}
```

In `backend/src/audit/audit-log.entity.ts`, directly after `'shift.explained',` add:

```ts
  'shift.operator_noted',
```

- [ ] **Step 5: Extend the mapper**

Replace the tail of `backend/src/shifts/shift.mapper.ts` (from the `broken_crates` field of `ShiftResponse` to the end) so the interface gains two fields and the function a third parameter:

```ts
  /** §6.8's «бій» (#110). `null` means «не записано» — an open shift, or one
   *  closed before the column existed. `0` means nothing broke. */
  broken_crates: number | null;
  /** The closing operator's own account (spec 2026-10-06). Never closes the incident. */
  operator_note: string | null;
  /** Whether THIS caller may write `operator_note` now — `operator-note.ts`, the same rule the PUT enforces. */
  operator_note_editable: boolean;
}

/**
 * `names` is loaded by the caller, ONCE per page — see `loadDisplayNames`.
 * `operatorNoteEditable` likewise: this function does no I/O of its own.
 */
export function toShiftResponse(
  shift: Shift,
  names: ReadonlyMap<string, string>,
  operatorNoteEditable: boolean,
): ShiftResponse {
  return {
    id: shift.id,
    collection_point_id: shift.collection_point_id,
    business_date: shift.business_date,
    status: shift.status,
    opened_by_user_id: shift.opened_by_user_id,
    opened_by_name: names.get(shift.opened_by_user_id) ?? null,
    closed_by_user_id: shift.closed_by_user_id,
    closed_by_name: shift.closed_by_user_id
      ? (names.get(shift.closed_by_user_id) ?? null)
      : null,
    closed_at: shift.closed_at ? shift.closed_at.toISOString() : null,
    created_at: shift.created_at.toISOString(),
    explanation: shift.explanation,
    broken_crates: shift.broken_crates,
    operator_note: shift.operator_note,
    operator_note_editable: operatorNoteEditable,
  };
}
```

In `shift.mapper.spec.ts`: add `operator_note: null,` to the fixture, pass `false` as the third argument to every existing `toShiftResponse(` call, and add:

```ts
  it('carries the operator note and the caller’s editable flag through unchanged', () => {
    const res = toShiftResponse(shift({ operator_note: 'віддав решту' }), new Map(), true);
    expect(res.operator_note).toBe('віддав решту');
    expect(res.operator_note_editable).toBe(true);
  });
```

- [ ] **Step 6: Add `respond` and route every response through it**

In `backend/src/shifts/shifts.service.ts`:

Imports — add:

```ts
import { SetOperatorNoteDto } from './dto/set-operator-note.dto';
import {
  NO_FACTS,
  couldEditOperatorNote,
  loadOperatorNoteFacts,
  operatorNoteEditable,
  operatorNoteRefusal,
} from './operator-note';
```

Add this private method next to `namesFor`:

```ts
  /**
   * Every ShiftResponse goes through here: names and operator-note facts load
   * ONCE per call (D-8), and facts only for shifts this caller could possibly
   * annotate — an owner's read or an open shift costs no extra query.
   */
  private async respond(
    actor: AuthenticatedUser,
    shifts: Shift[],
    m: EntityManager,
  ): Promise<ShiftResponse[]> {
    const names = await this.namesFor(shifts, m);
    const candidates = shifts.filter((s) => couldEditOperatorNote(actor, s)).map((s) => s.id);
    const facts = await loadOperatorNoteFacts(m, candidates);
    return shifts.map((s) =>
      toShiftResponse(s, names, operatorNoteEditable(actor, s, facts.get(s.id) ?? NO_FACTS)),
    );
  }
```

Replace each `namesFor` + `toShiftResponse` pair:

- `open` (lines 141-142) and `close` (236-237) and `reopen` (346-347):
  ```ts
      const [response] = await this.respond(actor, [saved], m);
      return response;
  ```
  (in `open` the variable is `shift`, not `saved`).
- `list` (407-415):
  ```ts
    // ONE map and ONE facts query for the whole page (D-8).
    return {
      data: await this.respond(actor, data, this.dataSource.manager),
      total,
      page: query.page,
      limit: query.limit,
    };
  ```
- `current` (425-426) and `findOne` (431-432):
  ```ts
    const [response] = await this.respond(actor, [shift], this.dataSource.manager);
    return response;
  ```

In `reopen`, extend `before` and the save and `after`:

```ts
      const before = {
        closed_at: shift.closed_at,
        status: shift.status,
        broken_crates: shift.broken_crates,
        operator_note: shift.operator_note,
      };
```

```ts
      shift.broken_crates = null;
      // The note explained the count reopen just demoted; the re-closer writes their own.
      shift.operator_note = null;
```

```ts
          after: { closed_at: null, status: ShiftStatus.Open, broken_crates: null, operator_note: null },
```

Replace `setExplanation` (lines 351-382) with:

```ts
  /**
   * OWNER ONLY (§10.2 — corrections and judgements belong to the owner).
   * Idempotent: re-sending replaces the text. Under the row lock since spec
   * 2026-10-06 — «the operator cannot write after the owner decided» is
   * decided from this column, so it must not be written unlocked.
   */
  async setExplanation(
    actor: AuthenticatedUser,
    id: string,
    dto: SetExplanationDto,
  ): Promise<ShiftResponse> {
    if (actor.role !== UserRole.NetworkOwner) {
      throw new ForbiddenException({
        message: 'Only the network owner may explain a discrepancy',
        code: 'OWNER_ONLY',
      });
    }
    return this.dataSource.transaction(async (m) => {
      const shift = await this.loadVisible(actor, id, m);
      const before = { explanation: shift.explanation };
      shift.explanation = dto.explanation.trim();
      const saved = await m.save(Shift, shift);

      await this.audit.record(
        {
          action: 'shift.explained',
          actor_id: actor.sub,
          target_type: 'shift',
          target_id: saved.id,
          before,
          after: { explanation: saved.explanation },
        },
        m,
      );

      const [response] = await this.respond(actor, [saved], m);
      return response;
    });
  }

  /**
   * Spec 2026-10-06 — the closing operator's account. Every refusal comes from
   * `operatorNoteRefusal`, read under the row lock; facts are read in the same
   * transaction. A next shift opened a moment later is accepted (spec §4.2).
   */
  async setOperatorNote(
    actor: AuthenticatedUser,
    id: string,
    dto: SetOperatorNoteDto,
  ): Promise<ShiftResponse> {
    return this.dataSource.transaction(async (m) => {
      const shift = await this.loadVisible(actor, id, m);
      const facts = (await loadOperatorNoteFacts(m, [shift.id])).get(shift.id) ?? NO_FACTS;
      const refusal = operatorNoteRefusal(actor, shift, facts);
      if (refusal) throw refusal;

      const before = { operator_note: shift.operator_note };
      shift.operator_note = dto.operator_note.trim();
      const saved = await m.save(Shift, shift);

      await this.audit.record(
        {
          action: 'shift.operator_noted',
          actor_id: actor.sub,
          target_type: 'shift',
          target_id: saved.id,
          before,
          after: { operator_note: saved.operator_note },
        },
        m,
      );

      const [response] = await this.respond(actor, [saved], m);
      return response;
    });
  }
```

Update the `loadVisible` doc comment's last paragraph: replace «The two READ callers (`findOne`, `setExplanation`'s sibling paths) pass nothing» with «The READ callers (`findOne`) pass nothing».

- [ ] **Step 7: Add the route**

In `backend/src/shifts/shifts.controller.ts`, import `SetOperatorNoteDto`, add to the role table comment after the `explanation` line:

```
 *   operator-note → PointOperator ONLY, and only the one who closed the shift
 *                   (spec 2026-10-06). Informs the owner; closes nothing.
```

and after `setExplanation`:

```ts
  @Put(':id/operator-note')
  @Auth(UserRole.PointOperator)
  setOperatorNote(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOperatorNoteDto,
  ) {
    return this.shifts.setOperatorNote(actor, id, dto);
  }
```

- [ ] **Step 8: Run unit tests and the typecheck**

Run: `npm test -w backend -- shifts && npm run typecheck -w backend`
Expected: PASS, and `tsc` exits 0. If `tsc` names another caller of `toShiftResponse` (e.g. a seed or another module), pass it `false` — such callers have no actor, and a seed never annotates.

- [ ] **Step 9: Commit**

```bash
git add backend/src/shifts backend/src/audit/audit-log.entity.ts
git commit -m "feat(shifts): PUT /shifts/:id/operator-note; reopen clears it; explanation writes under the lock"
```

---

### Task 4: Cash counts — rows carry the note and the flag

**Files:**
- Modify: `backend/src/cash-counts/cash-count.mapper.ts` (`CashCountRow` lines 6-18, `CashCountRowResponse` lines 59-76, `toCashCountRowResponse` lines 82-105)
- Modify: `backend/src/cash-counts/cash-counts.service.ts` (`recount`'s return ~174-192, `list`'s SELECT ~234-243 and map ~258-260)
- Modify: `backend/src/cash-counts/cash-counts.service.spec.ts` (row fixtures at ~21 and ~90; calls to `toCashCountRowResponse`)

**Interfaces:**
- Consumes: `operatorNoteEditable`, `OperatorNoteFacts` (Task 2).
- Produces: `CashCountRowResponse.operator_note: string | null`, `CashCountRowResponse.operator_note_editable: boolean`; `toCashCountRowResponse(row, names, operatorNoteEditable: boolean)`.

- [ ] **Step 1: Write the failing mapper tests**

In `cash-counts.service.spec.ts`, add `operator_note: null,` next to `explanation: null,` in both row fixtures, pass `false` as a third argument to every existing `toCashCountRowResponse(` call, then add:

```ts
  it('an operator note does NOT close the incident — only the owner’s explanation does', () => {
    // The default fixture is a −350.00 closing count, unexplained.
    const r = toCashCountRowResponse(row({ operator_note: 'віддав решту' }), NO_NAMES, true);
    expect(r.is_open).toBe(true);
    expect(r.operator_note).toBe('віддав решту');
    expect(r.operator_note_editable).toBe(true);
  });
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test -w backend -- cash-counts.service.spec`
Expected: FAIL. `operator_note` is `undefined` on the response.

- [ ] **Step 3: Extend the mapper**

`CashCountRow` gains:

```ts
  explanation: string | null;
  operator_note: string | null;
```

`CashCountRowResponse` gains, after `explanation`:

```ts
  /** The closing operator's account (spec 2026-10-06) — informs, never closes `is_open`. */
  operator_note: string | null;
  /** May THIS caller write `operator_note` from this row now — closing rows only. */
  operator_note_editable: boolean;
```

`toCashCountRowResponse` gets a third parameter `operatorNoteEditable: boolean` and returns, after `explanation: row.explanation,`:

```ts
    operator_note: row.operator_note,
    operator_note_editable: operatorNoteEditable,
```

- [ ] **Step 4: Feed it from the service**

In `cash-counts.service.ts` import:

```ts
import { CashCountKind } from './cash-count-kind.enum'; // if not already imported
import { operatorNoteEditable } from '../shifts/operator-note';
```

`list`'s SELECT: replace `c.counted_by_user_id, c.counted_at, s.explanation` with

```sql
              c.counted_by_user_id, c.counted_at, s.explanation, s.operator_note,
              s.closed_at, s.closed_by_user_id,
              NOT EXISTS (SELECT 1 FROM shifts n
                           WHERE n.collection_point_id = s.collection_point_id
                             AND n.business_date > s.business_date) AS is_newest,
              (c.counted_amount <> c.expected_amount) AS has_discrepancy
```

and type the result as `(CashCountRow & NoteColumns)[]` with, at module level:

```ts
/** The shift columns `operator-note.ts` decides from, joined per row in `list`. */
interface NoteColumns {
  closed_at: Date | null;
  closed_by_user_id: string | null;
  is_newest: boolean;
  has_discrepancy: boolean;
}
```

Replace the final `data: rows.map((r) => toCashCountRowResponse(r, names)),` with:

```ts
      // Only the standing closing row is where the operator explains the day.
      data: rows.map((r) =>
        toCashCountRowResponse(
          r,
          names,
          r.kind === CashCountKind.Closing &&
            operatorNoteEditable(actor, r, { is_newest: r.is_newest, has_discrepancy: r.has_discrepancy }),
        ),
      ),
```

In `recount`'s returned row literal, after `explanation: shift.explanation ?? null,` add `operator_note: shift.operator_note ?? null,` and pass `false` as the third argument (a midday row is never where the note is written).

- [ ] **Step 5: Run unit tests and the typecheck**

Run: `npm test -w backend -- cash-counts && npm run typecheck -w backend`
Expected: PASS, `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add backend/src/cash-counts
git commit -m "feat(cash-counts): rows carry operator_note and whether the caller may write it"
```

---

### Task 5: The whole cycle against Postgres

**Files:**
- Create: `backend/src/shifts/shift-operator-note.db-spec.ts`

**Interfaces:**
- Consumes: `ShiftsService.open/close/reopen/setExplanation/setOperatorNote`, `CashCountsService.list` (Tasks 3-4).

- [ ] **Step 1: Write the spec**

```ts
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
```

- [ ] **Step 2: Run it**

Run: `npm run test:db -w backend -- shift-operator-note`
Expected: PASS, 3 tests. If the `INSERT INTO shifts` in test 2 is refused by `UQ_shifts_open_per_point`, close the first shift (it already is) — the partial index only counts `closed_at IS NULL`, and only the inserted row is open, so it should not be. If `CashCountsService.list`'s query DTO has required fields this literal lacks, add them rather than loosening the cast.

- [ ] **Step 3: Commit**

```bash
git add backend/src/shifts/shift-operator-note.db-spec.ts
git commit -m "test(shifts): operator note window, author, reopen and owner decision against Postgres"
```

---

### Task 6: Frontend — types, the `set-operator-note` feature, copy

**Files:**
- Modify: `frontend/src/entities/shift/model/shift.ts`
- Modify: `frontend/src/entities/cash-count/model/cash-count.ts`
- Modify: every test fixture `npm run typecheck -w frontend` names after the type change (about 15 `*.test.tsx` files)
- Create: `frontend/src/features/set-operator-note/api/useSetOperatorNote.ts`
- Create: `frontend/src/features/set-operator-note/api/useSetOperatorNote.test.tsx`
- Create: `frontend/src/features/set-operator-note/ui/OperatorNoteForm.tsx`
- Create: `frontend/src/features/set-operator-note/ui/OperatorNoteDialog.tsx`
- Create: `frontend/src/features/set-operator-note/ui/OperatorNoteDialog.test.tsx`
- Create: `frontend/src/features/set-operator-note/index.ts`
- Modify: `frontend/src/shared/lib/api-error/apiErrorToBanner.ts` (`CODE` map)
- Modify: `frontend/src/shared/lib/i18n/locales/en.json`, `uk.json`

**Interfaces:**
- Produces:
  - `Shift.operator_note: string | null`, `Shift.operator_note_editable: boolean`; same two on `CashCount`.
  - `useSetOperatorNoteMutation(): UseMutationResult<Shift, unknown, { shiftId: string; operatorNote: string }>`
  - `OperatorNoteForm(props: { shiftId: string; discrepancy: string; initialNote: string | null; onDone: () => void; onCancel: () => void })` — renders `DialogHeader`…`DialogFooter`, must sit inside a `DialogContent`.
  - `OperatorNoteDialog(props: { shiftId: string; discrepancy: string; initialNote: string | null; open: boolean; onClose: () => void })`
  - i18n: `operatorNote.*`, `pointCash.countHistory.operatorNote`, `pointCash.panel.operatorNote`, `cash.explainDialog.operatorNote`.

- [ ] **Step 1: Extend the two entity types**

`frontend/src/entities/shift/model/shift.ts`, after `broken_crates`:

```ts
  /** Пояснення приймальника, що закрив зміну (spec 2026-10-06). Інцидент НЕ закриває — лише `explanation`. */
  operator_note: string | null;
  /** Чи може ЦЕЙ користувач зараз написати `operator_note` — рахує сервер. */
  operator_note_editable: boolean;
```

`frontend/src/entities/cash-count/model/cash-count.ts`, after `explanation`:

```ts
  /** Пояснення приймальника до розбіжності закриття — `is_open` не змінює. */
  operator_note: string | null;
  /** Чи може ЦЕЙ користувач написати його з цього рядка зараз (лише рядок закриття). */
  operator_note_editable: boolean;
```

- [ ] **Step 2: Mend the fixtures the typecheck names**

Run: `npm run typecheck -w frontend`
Expected: errors of the form `Property 'operator_note' is missing in type …` in fixture builders across ~15 test files. In each named fixture object that builds a `Shift` or a `CashCount`, add directly after its `explanation:` line:

```ts
  operator_note: null,
  operator_note_editable: false,
```

Re-run until `tsc -b` exits 0. Do not widen any type to make this pass.

- [ ] **Step 3: Write the failing hook test**

`frontend/src/features/set-operator-note/api/useSetOperatorNote.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { useSetOperatorNoteMutation } from './useSetOperatorNote';

let mock: MockAdapter;
let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => {
  mock = new MockAdapter(httpClient);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => mock.restore());

describe('useSetOperatorNoteMutation', () => {
  it('PUTs operator_note and refreshes shifts and cash counts', async () => {
    mock.onPut('/shifts/s1/operator-note').reply(200, { id: 's1' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useSetOperatorNoteMutation(), { wrapper });

    await result.current.mutateAsync({ shiftId: 's1', operatorNote: 'віддав решту' });

    expect(JSON.parse(mock.history.put[0].data as string)).toEqual({ operator_note: 'віддав решту' });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.shifts });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.cashCounts });
    });
  });
});
```

- [ ] **Step 4: Write the failing dialog test**

`frontend/src/features/set-operator-note/ui/OperatorNoteDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/shared/api';
import { Toaster } from '@/shared/ui/sonner';
import { expectNoAxeViolations } from '../../../test-axe';
import { OperatorNoteDialog } from './OperatorNoteDialog';

const { noteMock } = vi.hoisted(() => ({ noteMock: vi.fn() }));

vi.mock('../api/useSetOperatorNote', () => ({
  useSetOperatorNoteMutation: () => ({ mutateAsync: noteMock }),
}));

function renderDialog(initialNote: string | null = null, onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <>
        <OperatorNoteDialog shiftId="s1" discrepancy="-100.00" initialNote={initialNote} open onClose={onClose} />
        <Toaster />
      </>,
    ),
  };
}

beforeEach(() => {
  noteMock.mockReset().mockResolvedValue({ id: 's1' });
});

describe('OperatorNoteDialog', () => {
  it('names the discrepancy and says the owner decides', async () => {
    const { container } = renderDialog();
    expect(screen.getByRole('heading', { name: 'What happened? Discrepancy −100.00 ₴' })).toBeInTheDocument();
    expect(screen.getByText(/The owner reads it next to the discrepancy/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('prefills the current note so it can be corrected', () => {
    renderDialog('перша версія');
    expect(screen.getByLabelText('Your explanation')).toHaveValue('перша версія');
  });

  it('refuses a blank note', async () => {
    const { onClose } = renderDialog();
    await userEvent.type(screen.getByLabelText('Your explanation'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Send to the owner' }));
    expect(await screen.findByText('Write what happened')).toBeInTheDocument();
    expect(noteMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sends the trimmed note and closes', async () => {
    const { onClose } = renderDialog();
    await userEvent.type(screen.getByLabelText('Your explanation'), '  віддав решту ');
    await userEvent.click(screen.getByRole('button', { name: 'Send to the owner' }));
    expect(noteMock).toHaveBeenCalledWith({ shiftId: 's1', operatorNote: 'віддав решту' });
    expect(await screen.findByText('Your explanation was sent to the owner')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a stale button: the window closed meanwhile — says so and stays open', async () => {
    noteMock.mockRejectedValue(new ApiError(409, 'late', undefined, 'OPERATOR_NOTE_WINDOW_CLOSED'));
    const { onClose } = renderDialog();
    await userEvent.type(screen.getByLabelText('Your explanation'), 'причина');
    await userEvent.click(screen.getByRole('button', { name: 'Send to the owner' }));
    expect(
      await screen.findByText('The next shift is already open — the owner decides from here'),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a reopened shift: SHIFT_NOT_CLOSED reads as an operator sentence, not the reopen one', async () => {
    noteMock.mockRejectedValue(new ApiError(409, 'open', undefined, 'SHIFT_NOT_CLOSED'));
    renderDialog();
    await userEvent.type(screen.getByLabelText('Your explanation'), 'причина');
    await userEvent.click(screen.getByRole('button', { name: 'Send to the owner' }));
    expect(
      await screen.findByText('The shift is open again — explain after it is closed'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Only a closed shift can be reopened')).toBeNull();
  });
});
```

- [ ] **Step 5: Run both and watch them fail**

Run: `npm test -w frontend -- set-operator-note`
Expected: FAIL — modules not found.

- [ ] **Step 6: Write the hook**

`frontend/src/features/set-operator-note/api/useSetOperatorNote.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Shift } from '@/entities/shift';

export interface SetOperatorNoteInput {
  shiftId: string;
  operatorNote: string;
}

/**
 * Spec 2026-10-06 — пояснення приймальника. `PUT`, бо замінює одне поле зміни.
 * Оновлює `shifts` і `cashCounts`: обидва несуть `operator_note` і прапорець.
 */
export function useSetOperatorNoteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ shiftId, operatorNote }: SetOperatorNoteInput): Promise<Shift> =>
      (await httpClient.put<Shift>(`/shifts/${shiftId}/operator-note`, { operator_note: operatorNote }))
        .data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.shifts });
      qc.invalidateQueries({ queryKey: queryKeys.cashCounts });
    },
  });
}
```

- [ ] **Step 7: Write the form and the dialog**

`frontend/src/features/set-operator-note/ui/OperatorNoteForm.tsx`:

```tsx
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Field } from '@/shared/ui/field';
import { Textarea } from '@/shared/ui/textarea';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import { formatUah } from '@/shared/lib/money';
import { useSetOperatorNoteMutation } from '../api/useSetOperatorNote';

/** `SHIFT_NOT_CLOSED`'s shared sentence is about reopening; here it means «reopened, close it first». */
const OVERRIDES = { SHIFT_NOT_CLOSED: 'operatorNote.errors.notClosed' } as const;

/**
 * Spec 2026-10-06 — the body only, no `Dialog`: the close result screen swaps
 * it into its OWN dialog (one `role="dialog"`, as `RecountDrawerDialog` does),
 * and `OperatorNoteDialog` wraps it for the history table.
 */
export function OperatorNoteForm({
  shiftId,
  discrepancy,
  initialNote,
  onDone,
  onCancel,
}: {
  shiftId: string;
  discrepancy: string;
  initialNote: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const setNote = useSetOperatorNoteMutation();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ note: string }>({ defaultValues: { note: initialNote ?? '' } });

  const onSubmit = handleSubmit(async ({ note }) => {
    setFormError(null);
    try {
      await setNote.mutateAsync({ shiftId, operatorNote: note.trim() });
      toast.success(t('operatorNote.saved'));
      onDone();
    } catch (error) {
      setFormError(apiErrorToBanner(error, 'operatorNote.errors.failed', OVERRIDES));
    }
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t('operatorNote.title', { amount: formatUah(discrepancy, i18n.resolvedLanguage) })}
        </DialogTitle>
        <DialogDescription>{t('operatorNote.description')}</DialogDescription>
      </DialogHeader>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field name="note" label={t('operatorNote.label')} required error={errors.note?.message}>
          {(a11y) => (
            <Textarea
              {...a11y}
              {...register('note', {
                required: 'operatorNote.errors.required',
                validate: (value) => value.trim().length > 0 || 'operatorNote.errors.required',
                maxLength: { value: 2000, message: 'operatorNote.errors.tooLong' },
              })}
              autoFocus
            />
          )}
        </Field>

        {formError ? (
          <p role="alert" className="text-sm text-destructive">
            {t(formError)}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={isSubmitting} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {t('operatorNote.submit')}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
```

`frontend/src/features/set-operator-note/ui/OperatorNoteDialog.tsx`:

```tsx
import { Dialog, DialogContent } from '@/shared/ui/dialog';
import { OperatorNoteForm } from './OperatorNoteForm';

/** The form in a dialog of its own — for `CashCountHistory`, which has no dialog to swap. */
export function OperatorNoteDialog({
  shiftId,
  discrepancy,
  initialNote,
  open,
  onClose,
}: {
  shiftId: string;
  discrepancy: string;
  initialNote: string | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <OperatorNoteForm
          shiftId={shiftId}
          discrepancy={discrepancy}
          initialNote={initialNote}
          onDone={onClose}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
```

`frontend/src/features/set-operator-note/index.ts`:

```ts
export { useSetOperatorNoteMutation } from './api/useSetOperatorNote';
export type { SetOperatorNoteInput } from './api/useSetOperatorNote';
export { OperatorNoteForm } from './ui/OperatorNoteForm';
export { OperatorNoteDialog } from './ui/OperatorNoteDialog';
```

- [ ] **Step 8: Map the codes and add the copy**

In `apiErrorToBanner.ts`'s `CODE`, after the reweigh block:

```ts
  // Operator's note (spec 2026-10-06) — `PUT /shifts/:id/operator-note` alone
  // throws these. `SHIFT_NOT_CLOSED` keeps its shared entry; the form overrides it.
  NOT_SHIFT_CLOSER: 'operatorNote.errors.notCloser',
  OPERATOR_NOTE_WINDOW_CLOSED: 'operatorNote.errors.windowClosed',
  OWNER_ALREADY_EXPLAINED: 'operatorNote.errors.ownerExplained',
  NO_DISCREPANCY: 'operatorNote.errors.noDiscrepancy',
```

`en.json` — new top-level `operatorNote` object:

```json
"operatorNote": {
  "write": "Add my explanation",
  "edit": "Edit my explanation",
  "resultAction": "Explain the discrepancy",
  "title": "What happened? Discrepancy {{amount}}",
  "description": "Write what you know while you are still at the point. The owner reads it next to the discrepancy and makes the final decision.",
  "label": "Your explanation",
  "submit": "Send to the owner",
  "saved": "Your explanation was sent to the owner",
  "errors": {
    "required": "Write what happened",
    "tooLong": "2000 characters or fewer",
    "failed": "Could not save your explanation",
    "notClosed": "The shift is open again — explain after it is closed",
    "notCloser": "Only the operator who closed this shift can explain it",
    "windowClosed": "The next shift is already open — the owner decides from here",
    "ownerExplained": "The owner has already decided on this discrepancy",
    "noDiscrepancy": "This shift closed without a discrepancy"
  }
}
```

and three single keys: `pointCash.countHistory.operatorNote`: `"Operator: “{{text}}”"`; `pointCash.panel.operatorNote`: `"Operator: “{{text}}”"`; `cash.explainDialog.operatorNote`: `"The operator wrote"`.

`uk.json` — same keys:

```json
"operatorNote": {
  "write": "Додати своє пояснення",
  "edit": "Змінити своє пояснення",
  "resultAction": "Пояснити розбіжність",
  "title": "Що сталося? Розбіжність {{amount}}",
  "description": "Напишіть, що знаєте, поки ви ще на точці. Керівник прочитає це поруч із розбіжністю і прийме остаточне рішення.",
  "label": "Ваше пояснення",
  "submit": "Надіслати керівнику",
  "saved": "Пояснення надіслано керівнику",
  "errors": {
    "required": "Напишіть, що сталося",
    "tooLong": "До 2000 символів",
    "failed": "Не вдалося зберегти пояснення",
    "notClosed": "Зміну знову відкрито — поясніть, коли її закриють",
    "notCloser": "Пояснити може лише приймальник, який закрив цю зміну",
    "windowClosed": "Наступну зміну вже відкрито — далі вирішує керівник",
    "ownerExplained": "Керівник уже ухвалив рішення щодо цієї розбіжності",
    "noDiscrepancy": "Ця зміна закрилася без розбіжності"
  }
}
```

`pointCash.countHistory.operatorNote`: `"Приймальник: «{{text}}»"`; `pointCash.panel.operatorNote`: `"Приймальник: «{{text}}»"`; `cash.explainDialog.operatorNote`: `"Приймальник написав"`.

- [ ] **Step 9: Run tests, parity and the typecheck**

Run: `npm test -w frontend -- set-operator-note locales && npm run typecheck -w frontend`
Expected: PASS (hook 1, dialog 6, locale parity green), `tsc -b` exits 0.

- [ ] **Step 10: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): set-operator-note feature — hook, form, dialog, copy"
```

---

### Task 7: Close result screen offers the note

**Files:**
- Modify: `frontend/src/features/count-shift/ui/CountResultView.tsx` (props of `CountResultBody` ~11-22, footer ~94-98, `CountResultView` ~110-122)
- Modify: `frontend/src/pages/point-cash/ui/PointCashPage.tsx` (state near `resultView` ~260; confirm handler ~609-622; `<CountResultView …>` ~638-643; imports)
- Modify: `frontend/src/pages/point-cash/ui/PointCashPage.test.tsx` (mock + new tests in `describe('PointCashPage — R4: …')`)

**Interfaces:**
- Consumes: `OperatorNoteForm` (Task 6), `CashCount.operator_note_editable`.
- Produces: `CountResultView` props `action?: ReactNode` and `swap?: ReactNode | null`.

- [ ] **Step 1: Write the failing page tests**

In `PointCashPage.test.tsx`, add `noteMock: vi.fn(),` to the hoisted mocks and:

```tsx
vi.mock('@/features/set-operator-note/api/useSetOperatorNote', () => ({
  useSetOperatorNoteMutation: () => ({ mutateAsync: noteMock }),
}));
```

with `noteMock.mockReset().mockResolvedValue({ id: 's5' });` in the file's `beforeEach`. Then add inside `describe('PointCashPage — R4: the open/close result view', …)`:

```tsx
  const closeWith = (row: Partial<CashCount>) => {
    shiftMock.mockReturnValue({ data: shift({ id: 's5', status: 'open' }), isPending: false, isError: false });
    cashCountsMock.mockImplementation((filter: { shiftId?: string }) =>
      'shiftId' in filter
        ? list([cashCount({ id: 'cl', shift_id: 's5', kind: 'closing', counted_amount: '2950.00', discrepancy: '-50.00', ...row })])
        : list([cashCount()]),
    );
  };

  it('offers the closer «Explain the discrepancy» and swaps the result for the form in the same dialog', async () => {
    const user = userEvent.setup();
    closeWith({ operator_note_editable: true });
    renderPointCash();

    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm close' }));
    await user.click(await screen.findByRole('button', { name: 'Explain the discrepancy' }));

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(
      screen.getByRole('heading', { name: `What happened? Discrepancy ${formatUah('-50.00', 'en')}` }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Explain the discrepancy' })).toBeInTheDocument();
  });

  it('saving closes the whole dialog, and the next close shows a fresh result, not the old form', async () => {
    const user = userEvent.setup();
    closeWith({ operator_note_editable: true });
    renderPointCash();

    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm close' }));
    await user.click(await screen.findByRole('button', { name: 'Explain the discrepancy' }));
    await user.type(screen.getByLabelText('Your explanation'), 'віддав решту');
    await user.click(screen.getByRole('button', { name: 'Send to the owner' }));

    expect(noteMock).toHaveBeenCalledWith({ shiftId: 's5', operatorNote: 'віддав решту' });
    await waitFor(() => expect(screen.queryByLabelText('Your explanation')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm close' }));
    expect(await screen.findByRole('button', { name: 'Explain the discrepancy' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Your explanation')).toBeNull();
  });

  it('offers nothing when the server says the note is not editable (a matched close, or not the closer)', async () => {
    const user = userEvent.setup();
    closeWith({ operator_note_editable: false });
    renderPointCash();

    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm close' }));
    await screen.findByRole('button', { name: 'Done' });
    expect(screen.queryByRole('button', { name: 'Explain the discrepancy' })).toBeNull();
  });
```

(The second close in the second test is only reachable if the panel still offers «Close shift» with the mocked shift `open` — it does, because `shiftMock` keeps returning `status: 'open'`.)

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w frontend -- PointCashPage`
Expected: the three new tests FAIL (no «Explain the discrepancy» button); all older tests PASS.

- [ ] **Step 3: Add the two slots to `CountResultView`**

In `CountResultBodyProps` add:

```ts
  /** An extra footer button before «Готово» — the page's, never this feature's (FSD). */
  action?: ReactNode;
```

destructure `action = null` in `CountResultBody`, and make the footer:

```tsx
      <DialogFooter>
        {action}
        <Button type="button" onClick={onClose}>
          {t('countResult.done')}
        </Button>
      </DialogFooter>
```

Replace `CountResultView` with:

```tsx
/**
 * … (keep the existing doc comment, then add:)
 * `swap` replaces the result INSIDE this same `DialogContent` — a caller that
 * needs a follow-up form (the operator's note) gets it without a second
 * `Dialog`, for the reason `RecountDrawerDialog` swaps its own body.
 */
export function CountResultView({
  open,
  onClose,
  swap = null,
  ...body
}: { open: boolean; onClose: () => void; swap?: ReactNode | null } & Omit<CountResultBodyProps, 'onClose'>) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>{swap ?? <CountResultBody {...body} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Wire the page**

In `PointCashPage.tsx` import:

```ts
import type { CashCount } from '@/entities/cash-count';
import { OperatorNoteForm } from '@/features/set-operator-note';
```

(`CashCount` may already be importable from the existing `@/entities/cash-count` import — extend that import instead of adding a second.)

Next to `resultView` state:

```tsx
  // Latched like `resultView`: the form keeps rendering while the dialog fades
  // out after a save, instead of flashing back to the result.
  const [noteTarget, setNoteTarget] = useState<CashCount | null>(null);
  const noteRow = resultFor?.mode === 'close' ? resultRow : null;
```

In the count dialog's `onConfirm`, right before `setCountTarget(null);`:

```tsx
          setNoteTarget(null);
```

Replace the `<CountResultView … />` element with:

```tsx
      <CountResultView
        open={resultFor !== null && resultRow !== null}
        title={resultView?.title ?? ''}
        counted={resultView?.counted ?? '0.00'}
        discrepancy={resultView?.discrepancy ?? null}
        onClose={() => setResultFor(null)}
        action={
          noteRow?.operator_note_editable ? (
            <Button type="button" variant="outline" onClick={() => setNoteTarget(noteRow)}>
              {t('operatorNote.resultAction')}
            </Button>
          ) : null
        }
        swap={
          noteTarget ? (
            <OperatorNoteForm
              shiftId={noteTarget.shift_id}
              discrepancy={noteTarget.discrepancy}
              initialNote={noteTarget.operator_note}
              onDone={() => setResultFor(null)}
              onCancel={() => setNoteTarget(null)}
            />
          ) : null
        }
      />
```

- [ ] **Step 5: Run tests and the typecheck**

Run: `npm test -w frontend -- PointCashPage CountResultView RecountDrawerDialog && npm run typecheck -w frontend`
Expected: PASS, `tsc -b` exits 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/count-shift frontend/src/pages/point-cash/ui/PointCashPage.tsx frontend/src/pages/point-cash/ui/PointCashPage.test.tsx
git commit -m "feat(point-cash): the close result offers the operator's note in the same dialog"
```

---

### Task 8: History, the owner's dialog and the shift panel show the note

**Files:**
- Modify: `frontend/src/pages/point-cash/ui/CashCountHistory.tsx` (explanation column cell ~85-115, dialogs ~136-143, imports)
- Modify: `frontend/src/pages/point-cash/ui/CashCountHistory.test.tsx`
- Modify: `frontend/src/features/set-cash-explanation/ui/ExplainDiscrepancyDialog.tsx` (props + a block above the form)
- Modify: `frontend/src/features/set-cash-explanation/ui/ExplainDiscrepancyDialog.test.tsx`
- Modify: `frontend/src/pages/point-cash/ui/ShiftCountPanel.tsx` (after the `shift.explanation` block ~262-266)
- Modify: `frontend/src/pages/point-cash/ui/ShiftCountPanel.test.tsx`

**Interfaces:**
- Consumes: `OperatorNoteDialog` (Task 6), the new `CashCount`/`Shift` fields.
- Produces: `ExplainDiscrepancyDialog` prop `operatorNote: string | null` (required, so no caller can forget it).

- [ ] **Step 1: Write the failing tests**

`ExplainDiscrepancyDialog.test.tsx` — pass `operatorNote={null}` in `renderDialog`, and add:

```tsx
  it('shows the operator’s account above the owner’s field without prefilling it', () => {
    render(
      <ExplainDiscrepancyDialog shiftId="s1" discrepancy="-320.00" operatorNote="віддав решту" open onClose={vi.fn()} />,
    );
    expect(screen.getByText('The operator wrote')).toBeInTheDocument();
    expect(screen.getByText('віддав решту')).toBeInTheDocument();
    expect(screen.getByLabelText('Explanation')).toHaveValue('');
  });
```

`CashCountHistory.test.tsx` — add `operator_note: null, operator_note_editable: false,` to the `count` fixture if Task 6 has not already, add:

```tsx
vi.mock('@/features/set-operator-note/api/useSetOperatorNote', () => ({
  useSetOperatorNoteMutation: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}));
```

and:

```tsx
  const openClosing = (over: Partial<CashCount> = {}) =>
    count({ kind: 'closing', counted_amount: '1400.00', discrepancy: '-100.00', is_open: true, ...over });

  it('the closer gets «Add my explanation» on an editable row', async () => {
    countsMock.mockReturnValue(page([openClosing({ operator_note_editable: true })]));
    render(<CashCountHistory pointId="p1" isOwner={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add my explanation' }));
    expect(screen.getByRole('heading', { name: /What happened\?/ })).toBeInTheDocument();
  });

  it('once written, the closer edits it and everyone reads it', () => {
    countsMock.mockReturnValue(page([openClosing({ operator_note: 'віддав решту', operator_note_editable: true })]));
    render(<CashCountHistory pointId="p1" isOwner={false} />);
    expect(screen.getByText('Operator: “віддав решту”')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit my explanation' })).toBeInTheDocument();
  });

  it('a non-editable open row still just says it is unexplained', () => {
    countsMock.mockReturnValue(page([openClosing()]));
    render(<CashCountHistory pointId="p1" isOwner={false} />);
    expect(screen.getByText('Unexplained')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add my explanation' })).toBeNull();
  });

  it('the owner sees the operator’s note AND still has to explain — the note closes nothing', () => {
    countsMock.mockReturnValue(page([openClosing({ operator_note: 'віддав решту' })]));
    render(<CashCountHistory pointId="p1" isOwner />);
    expect(screen.getByText('Operator: “віддав решту”')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Explain' })).toBeInTheDocument();
  });

  it('after the owner decides, both texts stay readable', () => {
    countsMock.mockReturnValue(
      page([openClosing({ is_open: false, explanation: 'утримати з зарплати', operator_note: 'віддав решту' })]),
    );
    render(<CashCountHistory pointId="p1" isOwner />);
    expect(screen.getByText('утримати з зарплати')).toBeInTheDocument();
    expect(screen.getByText('Operator: “віддав решту”')).toBeInTheDocument();
  });
```

`ShiftCountPanel.test.tsx` — after `'quotes the owner’s explanation in italics'`:

```tsx
  it('quotes the operator’s own account too, labelled as theirs', () => {
    render(
      <ShiftCountPanel
        shift={shift({ status: 'closed', closed_by_name: 'Petro', operator_note: 'віддав решту' })}
        isShiftLoading={false}
        isShiftError={false}
        counts={[]}
        isOperator={false}
        isToday={false}
        onOpenShift={noop}
        openShiftGate="allowed"
        onCloseShift={noop}
      />,
    );

    expect(screen.getByText('Operator: “віддав решту”')).toHaveClass('italic');
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w frontend -- CashCountHistory ExplainDiscrepancyDialog ShiftCountPanel`
Expected: the new tests FAIL; `tsc` would also flag the missing `operatorNote` prop (fixed in Step 3).

- [ ] **Step 3: `ExplainDiscrepancyDialog` shows the note**

Add `operatorNote: string | null;` to the props type and destructuring. Between `</DialogHeader>` and `<form …>`:

```tsx
        {/* Spec 2026-10-06 — what the closer said, as context; never prefilled into the owner's field. */}
        {operatorNote ? (
          <figure className="rounded-md border border-line2 px-3 py-2">
            <figcaption className="text-xs text-muted-foreground">
              {t('cash.explainDialog.operatorNote')}
            </figcaption>
            <blockquote className="text-sm italic">{operatorNote}</blockquote>
          </figure>
        ) : null}
```

- [ ] **Step 4: `CashCountHistory`**

Import `OperatorNoteDialog` from `@/features/set-operator-note`. Add state `const [noteTarget, setNoteTarget] = useState<CashCount | null>(null);`. Replace the explanation column's `cell` with:

```tsx
      cell: (row) => {
        const operatorNote = row.operator_note ? (
          <span className="text-xs italic text-muted-foreground">
            {t('pointCash.countHistory.operatorNote', { text: row.operator_note })}
          </span>
        ) : null;
        if (row.explanation) {
          return (
            <div className="flex flex-col gap-1">
              <span className="text-sm italic text-muted-foreground">{row.explanation}</span>
              {operatorNote}
            </div>
          );
        }
        if (discrepancyTone(row.discrepancy) === 'leaf') {
          return (
            <span className="text-xs text-muted-foreground">
              {t('pointCash.countHistory.matched')}
            </span>
          );
        }
        if (row.is_open) {
          // The operator's note informs; the incident stays open until the owner explains it.
          const action = isOwner ? (
            <Button size="xs" variant="outline" onClick={() => setExplainTarget(row)}>
              {t('pointCash.countHistory.explain')}
            </Button>
          ) : row.operator_note_editable ? (
            <Button size="xs" variant="outline" onClick={() => setNoteTarget(row)}>
              {t(row.operator_note ? 'operatorNote.edit' : 'operatorNote.write')}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">{t('pointCash.countHistory.open')}</span>
          );
          return (
            <div className="flex flex-col items-start gap-1">
              {operatorNote}
              {action}
            </div>
          );
        }
        // (keep the existing midday comment and «needs no explanation» return unchanged)
```

Pass `operatorNote={explainTarget.operator_note}` to `ExplainDiscrepancyDialog`, and after it render:

```tsx
      {noteTarget ? (
        <OperatorNoteDialog
          shiftId={noteTarget.shift_id}
          discrepancy={noteTarget.discrepancy}
          initialNote={noteTarget.operator_note}
          open
          onClose={() => setNoteTarget(null)}
        />
      ) : null}
```

Update the component's doc comment: «only `ExplainDiscrepancyDialog` (§7.7, owner only)» → «only `ExplainDiscrepancyDialog` (§7.7, owner) and `OperatorNoteDialog` (spec 2026-10-06, the closing operator)».

- [ ] **Step 5: `ShiftCountPanel`**

After the `{shift.explanation ? (…) : null}` block:

```tsx
              {shift.operator_note ? (
                <p className="text-xs italic text-muted-foreground">
                  {t('pointCash.panel.operatorNote', { text: shift.operator_note })}
                </p>
              ) : null}
```

- [ ] **Step 6: Run tests and the typecheck**

Run: `npm test -w frontend && npm run typecheck -w frontend && npm run lint -w frontend`
Expected: all PASS, `tsc -b` exits 0, eslint 0 warnings.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "feat(point-cash): history, owner dialog and shift panel show the operator's note"
```

---

### Task 9: Rules, schema notes, project docs, follow-up — and the full gate

**Files:**
- Modify: `26-rules-by-example.md` (end of §7.7, before `## 7.8` at line ~1250; §10.3 after its first paragraph, ~line 1781)
- Modify: `28-db-schema.dbml` (`Table shifts` `Note`, line ~186)
- Modify: `CLAUDE.md` (Architecture → Documents)
- Modify: `backend/CLAUDE.md` (Structure → `shifts/` line)
- Modify: `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` (append)

- [ ] **Step 1: Rules**

Append to the end of §7.7 (immediately before `## 7.8`):

```markdown
→ **Правка (замовник, 06.10.2026 — пояснення приймальника).** Приймальник, який закрив зміну з
розбіжністю, може сам записати, що сталося (`shifts.operator_note`), поки на точці не відкрито
наступну зміну і поки керівник не написав своє пояснення. Це **свідчення, а не рішення**:
інцидент лишається відкритим, доки пояснення не напише КЕРІВНИК (`shifts.explanation`).
Переоформлення (reopen) стирає свідчення приймальника — воно пояснювало підрахунок, якого вже
немає; попередній текст лишається в audit_log.
```

In §10.3, after the paragraph ending «…хто цю касу тримав у руках.», add:

```markdown
→ **Правка 06.10.2026:** з того самого принципу пояснення розбіжності закриття (§7.7) першим
пише той, хто цю касу тримав, — але остаточне рішення лишається за керівником.
```

- [ ] **Step 2: DBML note**

At the end of the `shifts` `Note:` string (before its closing `'`), append:

```
 ПРАВКА 06.10.2026: operator_note — свідчення приймальника, що закрив зміну з розбіжністю закриття; пише лише closed_by_user_id, лише поки на точці немає новішої зміни і поки explanation порожнє; інцидент закриває ТІЛЬКИ explanation. CHK_shifts_operator_note_not_blank: NULL або непорожній текст. Reopen стирає operator_note (попереднє — в audit_log).
```

- [ ] **Step 3: Project docs**

`CLAUDE.md`, Architecture → Documents, after the sentence ending «…reopening is the owner's.»:

```markdown
The operator who closed a shift with a closing-count discrepancy may write `shifts.operator_note` (`PUT /shifts/:id/operator-note`) until the point's next shift exists and the owner has not yet explained it; it informs the owner and closes nothing — `is_open` still waits for the owner's `explanation` (spec 2026-10-06).
```

`backend/CLAUDE.md`, the `shifts/` line, after «`explanation` is written by the owner AFTER the fact.»:

```markdown
 `operator_note` is the closing operator's own account (spec 2026-10-06): `operator-note.ts` holds the one rule the PUT enforces and every read flag (`operator_note_editable`) repeats, and reopen clears it.
```

- [ ] **Step 4: Follow-up**

Append to `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`:

```markdown
## Opening-count discrepancy is invisible to the operator (2026-10-06)

`ShiftsService.open` compares the morning count with the previous close
(`expectedForOpening`), and a mismatch is an `is_open` incident on the NEW shift.
`PointCashPage` deliberately shows no discrepancy pill for an open (§7.3), so the
operator neither sees it nor can explain it — the operator's note (spec
`2026-10-06-yagoda-operator-note-design.md`) covers the closing count only. Decide
whether the opening result should name the gap, and whether the opener may explain it.
```

- [ ] **Step 5: The full gate**

Run: `npm run verify:full`
Expected: the verdict line is green. Paste it. Name every `SKIPPED` row and why (e.g. no Docker daemon). If `schema-conformance` or `migration-invariants` reports a finding, fix the code or the DBML — do not add a baseline entry.

- [ ] **Step 6: Commit**

```bash
git add 26-rules-by-example.md 28-db-schema.dbml CLAUDE.md backend/CLAUDE.md docs/superpowers/2026-09-05-foundation-slice-follow-ups.md
git commit -m "docs: operator's note in the rules, schema note and project docs; opening-gap follow-up"
```
