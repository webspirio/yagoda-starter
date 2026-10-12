# Count Explanations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the owner's `explanation` and the operator's `operator_note` from `shifts` onto
`cash_counts`, so every opening/closing discrepancy is explained on its own — closing S3, S4,
S6 and S2 from the PR #218 review.

**Architecture:** One migration adds two text columns to `cash_counts`, copies the shift
explanations onto the disagreeing counts and drops `shifts.explanation`. One pure function
(`countNoteRefusal`) decides who may write which text on which count; two `PUT
/cash-counts/:id/...` routes throw what it returns, and the list's flags are `refusal === null`.
The shift-level routes, columns and the `is_newest` window are deleted. The frontend moves
both mutations to the count routes, renders texts per row, offers the note after an OPEN as
well as a close, and shows the result after a close from `OpenShiftAlert`.

**Tech Stack:** NestJS 11 + TypeORM (Postgres), Jest (unit + `test:db` db-specs), React 19 +
TanStack Query 5 + react-hook-form, Vitest + Testing Library, i18next.

**Spec:** `docs/superpowers/specs/2026-10-08-yagoda-count-explanations-design.md` (read it
first; it argues every decision this plan only executes).

**Branch:** `feat/operator-note` (PR #218), in the main checkout — no worktree.

## Global Constraints

- Migration file `backend/src/migrations/1788600000022-CashCountExplanations.ts`; delete
  `1788600000021-ShiftOperatorNote.ts` and `migrations/shift-operator-note-schema.db-spec.ts`.
- Text rules, both fields: `@IsString() @Length(1, 2000) @Matches(/\S/)`, stored trimmed.
- DB: `NULL` is the only «none» — `CHECK (col IS NULL OR btrim(col) <> '')`.
- Error codes: new `NOT_COUNTER` (403), `COUNT_NOT_EXPLAINABLE` (409); kept `OWNER_ONLY`,
  `NO_DISCREPANCY`, `OWNER_ALREADY_EXPLAINED`; removed `NOT_SHIFT_CLOSER`,
  `OPERATOR_NOTE_WINDOW_CLOSED`.
- Audit actions: add `cash-count.explained`, `cash-count.operator_noted` (hyphen, like the
  existing `cash-count.recorded`); remove `shift.operator_noted` (never shipped); KEEP
  `shift.explained` (historic rows on `main` use it).
- Every user-visible string in `uk.json` and `en.json`; error copy follows `frontend/CLAUDE.md`'s
  tone rule (what happened, then what to do).
- `cash-counts/` is a money module: no `*`, `/`, `Number()`, `toFixed` — compare amounts with
  `cmp` from `common/money.ts`.
- No Docker on this machine: every `*.db-spec.ts` runs only in CI. Write them anyway; Task 9
  pushes and reads CI's `test:db` result.

## Review Focus

1. **A count of another point** — an operator `PUT`s a count id from another point: 404, never
   403 (a 403 would confirm the id exists). → Task 2 test.
2. **Owner explains a count while the operator's note form is open** — the operator saves after
   the owner: 409 `OWNER_ALREADY_EXPLAINED`, both writes serialized by the row lock. → Task 2
   test (sequential; the lock itself is covered by `pessimistic_write`).
3. **A reopened shift's demoted closing row** — still shows its texts in history, but no button
   and a `PUT` is 409 `COUNT_NOT_EXPLAINABLE`. → Task 2 db-spec + Task 6 test.
4. **First-ever count at a point** (discrepancy 0 by construction) — opening result shows no
   discrepancy and no note form. → Task 7 test.
5. **Closing a stale shift from the banner on a page dated today** — result shows THAT shift's
   closing count, not today's. → Task 7 test.

---

### Task 1: Schema — migration, entities, DBML column lines

**Files:**
- Delete: `backend/src/migrations/1788600000021-ShiftOperatorNote.ts`, `backend/src/migrations/shift-operator-note-schema.db-spec.ts`
- Create: `backend/src/migrations/1788600000022-CashCountExplanations.ts`
- Create: `backend/src/migrations/cash-count-explanations-schema.db-spec.ts`
- Modify: `backend/src/cash-counts/cash-count.entity.ts` (two columns, two `@Check`s)
- Modify: `backend/src/migrations/intakes-payouts-schema.db-spec.ts:206-226` (drop the `explanation` half of that test)

**Interfaces:**
- Produces: `CashCount.explanation: string | null`, `CashCount.operator_note: string | null`.
  `Shift.explanation` / `Shift.operator_note` are removed in Task 4, not here, so the backend
  keeps compiling between tasks.

- [ ] **Step 1: Write the failing schema db-spec**

`backend/src/migrations/cash-count-explanations-schema.db-spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { CashCountExplanations1788600000022 } from './1788600000022-CashCountExplanations';

/** Spec 2026-10-08 §3 — the columns, their CHECKs, and the copy off `shifts.explanation`. */
describe('cash_counts explanations (Postgres)', () => {
  let ds: DataSource;
  let pointId: string;
  let userId: string;
  let day = 0;

  const shift = async () => {
    day += 1;
    const [{ id }] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date, status, closed_at, closed_by_user_id)
       VALUES ($1, $2, $3, 'closed', now(), $2) RETURNING id`,
      [pointId, userId, `2026-03-${String(day).padStart(2, '0')}`],
    );
    return id as string;
  };
  const count = async (shiftId: string, kind: string, counted: string, expected: string) => {
    const [{ id }] = await ds.query(
      `INSERT INTO cash_counts (shift_id, book, kind, counted_amount, expected_amount, counted_by_user_id, counted_at)
       VALUES ($1, 'berry', $2, $3, $4, $5, now()) RETURNING id`,
      [shiftId, kind, counted, expected, userId],
    );
    return id as string;
  };
  const texts = async (id: string) =>
    (await ds.query(`SELECT explanation, operator_note FROM cash_counts WHERE id = $1`, [id]))[0];

  beforeAll(async () => {
    ds = await openTestDataSource();
    const run = randomUUID().slice(0, 8);
    [{ id: pointId }] = await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`Точка ${run}`, `E${run.slice(0, 6).toUpperCase()}`],
    );
    [{ id: userId }] = await ds.query(
      `INSERT INTO users (first_name, last_name, role, is_active)
       VALUES ('Тест', $1, 'point_operator', true) RETURNING id`,
      [`Op ${run}`],
    );
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('drops shifts.explanation', async () => {
    const cols = await ds.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'shifts' AND column_name IN ('explanation', 'operator_note')`,
    );
    expect(cols).toEqual([]);
  });

  it('refuses a blank explanation and a blank operator note', async () => {
    const id = await count(await shift(), 'closing', '90.00', '100.00');
    await expect(
      ds.query(`UPDATE cash_counts SET explanation = '  ' WHERE id = $1`, [id]),
    ).rejects.toThrow(/CHK_cash_counts_explanation_not_blank/);
    await expect(
      ds.query(`UPDATE cash_counts SET operator_note = '' WHERE id = $1`, [id]),
    ).rejects.toThrow(/CHK_cash_counts_operator_note_not_blank/);
  });

  describe('the copy (decision 4) — replayed by running down() then up() on fixture rows', () => {
    const migration = new CashCountExplanations1788600000022();
    let both: { s: string; opening: string; closing: string };
    let matchedOnly: { s: string; opening: string; closing: string };
    let blank: { s: string; closing: string };

    beforeAll(async () => {
      const qr = ds.createQueryRunner();
      await migration.down(qr); // shifts.explanation is back, the count columns are gone
      const a = await shift();
      both = { s: a, opening: await count(a, 'opening', '120.00', '100.00'), closing: await count(a, 'closing', '80.00', '100.00') };
      const b = await shift();
      matchedOnly = { s: b, opening: await count(b, 'opening', '100.00', '100.00'), closing: await count(b, 'closing', '100.00', '100.00') };
      const c = await shift();
      blank = { s: c, closing: await count(c, 'closing', '90.00', '100.00') };
      await ds.query(`UPDATE shifts SET explanation = 'одне пояснення на зміну' WHERE id = $1`, [a]);
      await ds.query(`UPDATE shifts SET explanation = 'зійшлося, але написав' WHERE id = $1`, [b]);
      await ds.query(`UPDATE shifts SET explanation = '' WHERE id = $1`, [c]);
      await migration.up(qr);
      await qr.release();
    });

    it('puts one shift text on BOTH disagreeing counts', async () => {
      expect((await texts(both.opening)).explanation).toBe('одне пояснення на зміну');
      expect((await texts(both.closing)).explanation).toBe('одне пояснення на зміну');
    });

    it('keeps a text from a shift with no disagreeing count, on its closing count', async () => {
      expect((await texts(matchedOnly.closing)).explanation).toBe('зійшлося, але написав');
      expect((await texts(matchedOnly.opening)).explanation).toBeNull();
    });

    it("copies nothing for '' (yesterday's «undecided»)", async () => {
      expect((await texts(blank.closing)).explanation).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Write the migration**

`backend/src/migrations/1788600000022-CashCountExplanations.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 2026-10-08 — a discrepancy belongs to a COUNT, so both texts live there:
 * `explanation` (owner, closes the incident) and `operator_note` (whoever counted).
 * One shift text is copied onto EVERY disagreeing opening/closing count so no
 * incident reopens; a text on a shift with none disagreeing goes to its closing
 * count (else opening) so it is not lost. `''` was «undecided» and is not copied.
 *
 * Numbered 022: PR #222 claims 021. Whichever merges second re-checks.
 */
export class CashCountExplanations1788600000022 implements MigrationInterface {
  name = 'CashCountExplanations1788600000022';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "cash_counts" ADD "explanation" text`);
    await q.query(`ALTER TABLE "cash_counts" ADD "operator_note" text`);
    await q.query(`ALTER TABLE "cash_counts" ADD CONSTRAINT "CHK_cash_counts_explanation_not_blank"
      CHECK ("explanation" IS NULL OR btrim("explanation") <> '')`);
    await q.query(`ALTER TABLE "cash_counts" ADD CONSTRAINT "CHK_cash_counts_operator_note_not_blank"
      CHECK ("operator_note" IS NULL OR btrim("operator_note") <> '')`);
    await q.query(`
      UPDATE "cash_counts" c SET "explanation" = btrim(s."explanation")
        FROM "shifts" s
       WHERE c."shift_id" = s."id" AND btrim(coalesce(s."explanation", '')) <> ''
         AND c."book" = 'berry' AND c."kind" IN ('opening', 'closing')
         AND c."counted_amount" <> c."expected_amount"`);
    await q.query(`
      UPDATE "cash_counts" c SET "explanation" = btrim(s."explanation")
        FROM "shifts" s
       WHERE c."shift_id" = s."id" AND btrim(coalesce(s."explanation", '')) <> ''
         AND NOT EXISTS (SELECT 1 FROM "cash_counts" x
                          WHERE x."shift_id" = s."id" AND x."explanation" IS NOT NULL)
         AND c."id" = (SELECT y."id" FROM "cash_counts" y
                        WHERE y."shift_id" = s."id" AND y."book" = 'berry'
                          AND y."kind" IN ('opening', 'closing')
                        ORDER BY (y."kind" = 'closing') DESC LIMIT 1)`);
    await q.query(`ALTER TABLE "shifts" DROP COLUMN "explanation"`);
  }

  /** LOSSY: two counts with different texts come back as ONE — the closing count's. */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "shifts" ADD "explanation" text`);
    await q.query(`
      UPDATE "shifts" s SET "explanation" = (
        SELECT c."explanation" FROM "cash_counts" c
         WHERE c."shift_id" = s."id" AND c."explanation" IS NOT NULL
         ORDER BY (c."kind" = 'closing') DESC, (c."kind" = 'opening') DESC LIMIT 1)`);
    await q.query(`ALTER TABLE "cash_counts" DROP CONSTRAINT "CHK_cash_counts_operator_note_not_blank"`);
    await q.query(`ALTER TABLE "cash_counts" DROP CONSTRAINT "CHK_cash_counts_explanation_not_blank"`);
    await q.query(`ALTER TABLE "cash_counts" DROP COLUMN "operator_note"`);
    await q.query(`ALTER TABLE "cash_counts" DROP COLUMN "explanation"`);
  }
}
```

Delete the 021 migration and its db-spec: `git rm backend/src/migrations/1788600000021-ShiftOperatorNote.ts backend/src/migrations/shift-operator-note-schema.db-spec.ts`.
Check how migrations are registered (`grep -rn "ShiftOperatorNote" backend/src`) and swap the
class in that list if one exists.

- [ ] **Step 3: Entity columns**

In `backend/src/cash-counts/cash-count.entity.ts`, above the class add the two `@Check`s next to
the existing one, and add the columns after `counted_at`:

```ts
@Check('CHK_cash_counts_explanation_not_blank', `"explanation" IS NULL OR btrim("explanation") <> ''`)
@Check('CHK_cash_counts_operator_note_not_blank', `"operator_note" IS NULL OR btrim("operator_note") <> ''`)
```

```ts
  /** The owner's decision on THIS count's discrepancy — the only thing that closes it
   *  (spec 2026-10-08). A demoted closing row keeps it as history. */
  @Column({ type: 'text', nullable: true })
  explanation: string | null;

  /** Whoever counted (`counted_by_user_id`): their account. Informs, never closes. */
  @Column({ type: 'text', nullable: true })
  operator_note: string | null;
```

Also edit the class header's last paragraph: «NO `void_*` TRIO AND NO `PATCH`» stays true; add
one line: «The two texts are annotations, never the figures — `counted_amount` and
`expected_amount` stay untouchable.»

- [ ] **Step 4: Drop the `explanation` half of `intakes-payouts-schema.db-spec.ts:206`**

That test inserts `explanation = 'розбіжність 350 ₴'` into `shifts`; the column is gone.
Remove `explanation` from its INSERT/SELECT and the `expect(row.explanation)` line, keep the
`awaiting_explanation` status assertion.

- [ ] **Step 5: Typecheck and lint the backend**

Run: `npm run typecheck -w backend && npx eslint backend/src/migrations backend/src/cash-counts`
Expected: no errors. (db-specs run in CI only — see Global Constraints.)

- [ ] **Step 6: Commit**

```bash
git add -A backend/src/migrations backend/src/cash-counts/cash-count.entity.ts
git commit -m "feat(cash-counts): explanation and operator note live on the count"
```

---

### Task 2: Write rules and routes — `PUT /cash-counts/:id/{explanation,operator-note}`

**Files:**
- Create: `backend/src/cash-counts/count-notes.ts`, `backend/src/cash-counts/count-notes.spec.ts`
- Create: `backend/src/cash-counts/dto/set-count-explanation.dto.ts`, `backend/src/cash-counts/dto/set-count-operator-note.dto.ts`
- Create: `backend/src/cash-counts/count-notes.db-spec.ts`
- Modify: `backend/src/cash-counts/cash-counts.service.ts` (two methods + `writeNote`)
- Modify: `backend/src/cash-counts/cash-counts.controller.ts` (two routes, header comment)
- Modify: `backend/src/audit/audit-log.entity.ts` (`AUDIT_ACTIONS`)

**Interfaces:**
- Consumes: `CashCount.explanation`, `CashCount.operator_note` (Task 1).
- Produces:
  - `type CountNoteField = 'explanation' | 'operator_note'`
  - `countNoteRefusal(actor: AuthenticatedUser, count: NoteCount, field: CountNoteField): HttpException | null`
  - `countNoteAllowed(actor, count, field): boolean` — role matches the field AND refusal is null
  - `CashCountsService.setExplanation(actor, id, dto): Promise<CashCountRowResponse>`
  - `CashCountsService.setOperatorNote(actor, id, dto): Promise<CashCountRowResponse>`
  - `PUT /cash-counts/:id/explanation` body `{ explanation }`, `PUT /cash-counts/:id/operator-note` body `{ operator_note }`

- [ ] **Step 1: Failing unit tests for the rule**

`backend/src/cash-counts/count-notes.spec.ts`:

```ts
import { countNoteAllowed, countNoteRefusal, type NoteCount } from './count-notes';
import { CashBook } from './cash-book.enum';
import { CashCountKind } from './cash-count-kind.enum';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const OPERATOR = { sub: 'op-1', role: UserRole.PointOperator, collection_point_id: 'p1' } as AuthenticatedUser;
const OTHER_OP = { sub: 'op-2', role: UserRole.PointOperator, collection_point_id: 'p1' } as AuthenticatedUser;
const OWNER = { sub: 'own', role: UserRole.NetworkOwner, collection_point_id: null } as AuthenticatedUser;

const count = (over: Partial<NoteCount> = {}): NoteCount => ({
  book: CashBook.Berry,
  kind: CashCountKind.Closing,
  counted_amount: '90.00',
  expected_amount: '100.00',
  counted_by_user_id: 'op-1',
  explanation: null,
  ...over,
});
const code = (e: ReturnType<typeof countNoteRefusal>) =>
  (e?.getResponse() as { code?: string } | undefined)?.code ?? null;

describe('countNoteRefusal', () => {
  it('lets the counter write a note on a disagreeing opening or closing count', () => {
    expect(countNoteRefusal(OPERATOR, count(), 'operator_note')).toBeNull();
    expect(countNoteRefusal(OPERATOR, count({ kind: CashCountKind.Opening }), 'operator_note')).toBeNull();
  });

  it('refuses another operator — NOT_COUNTER', () => {
    expect(code(countNoteRefusal(OTHER_OP, count(), 'operator_note'))).toBe('NOT_COUNTER');
  });

  it('refuses an operator the explanation — OWNER_ONLY', () => {
    expect(code(countNoteRefusal(OPERATOR, count(), 'explanation'))).toBe('OWNER_ONLY');
  });

  it('refuses a midday row and the crates book — COUNT_NOT_EXPLAINABLE', () => {
    expect(code(countNoteRefusal(OPERATOR, count({ kind: CashCountKind.Midday }), 'operator_note'))).toBe('COUNT_NOT_EXPLAINABLE');
    expect(code(countNoteRefusal(OWNER, count({ book: CashBook.Crates }), 'explanation'))).toBe('COUNT_NOT_EXPLAINABLE');
  });

  it('refuses a matched count — NO_DISCREPANCY', () => {
    expect(code(countNoteRefusal(OWNER, count({ counted_amount: '100.00' }), 'explanation'))).toBe('NO_DISCREPANCY');
  });

  it("refuses the operator once the owner explained THIS count — OWNER_ALREADY_EXPLAINED", () => {
    expect(code(countNoteRefusal(OPERATOR, count({ explanation: 'вирішено' }), 'operator_note'))).toBe('OWNER_ALREADY_EXPLAINED');
  });

  it('lets the owner replace an explanation', () => {
    expect(countNoteRefusal(OWNER, count({ explanation: 'було' }), 'explanation')).toBeNull();
  });

  it('checks the author before the row: another operator on a midday row is NOT_COUNTER', () => {
    expect(code(countNoteRefusal(OTHER_OP, count({ kind: CashCountKind.Midday }), 'operator_note'))).toBe('NOT_COUNTER');
  });
});

describe('countNoteAllowed', () => {
  it('is false for the owner on the operator note, whatever the count', () => {
    expect(countNoteAllowed(OWNER, count({ counted_by_user_id: 'own' }), 'operator_note')).toBe(false);
  });
  it('is true for the owner on a disagreeing count', () => {
    expect(countNoteAllowed(OWNER, count(), 'explanation')).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx jest -w backend count-notes.spec` → «Cannot find module './count-notes'».

- [ ] **Step 3: Implement `count-notes.ts`**

```ts
import { ConflictException, ForbiddenException, HttpException } from '@nestjs/common';
import { cmp } from '../common/money';
import { CashBook } from './cash-book.enum';
import { CashCountKind } from './cash-count-kind.enum';
import type { CashCount } from './cash-count.entity';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * Spec 2026-10-08 — who may write which text on which count. ONE definition: the
 * PUTs throw what this returns and every read flag is `refusal === null`, so a
 * button and the server cannot disagree. No window: the next shift opening
 * closes nothing; only the owner's explanation of THIS count does.
 */
export type CountNoteField = 'explanation' | 'operator_note';

export type NoteCount = Pick<
  CashCount,
  'book' | 'kind' | 'counted_amount' | 'expected_amount' | 'counted_by_user_id' | 'explanation'
>;

export function countNoteRefusal(
  actor: AuthenticatedUser,
  count: NoteCount,
  field: CountNoteField,
): HttpException | null {
  if (field === 'explanation' && actor.role !== UserRole.NetworkOwner) {
    return new ForbiddenException({
      message: 'Only the network owner may explain a discrepancy',
      code: 'OWNER_ONLY',
    });
  }
  // §10.6 — the account belongs to whoever pressed the button for this count.
  if (field === 'operator_note' && count.counted_by_user_id !== actor.sub) {
    return new ForbiddenException({
      message: 'Only the operator who made this count may explain it',
      code: 'NOT_COUNTER',
    });
  }
  // A midday row is a recount (a witness, §7.6) or a demoted close (superseded history).
  if (count.book !== CashBook.Berry || count.kind === CashCountKind.Midday) {
    return new ConflictException({
      message: 'Only an opening or closing count can be explained',
      code: 'COUNT_NOT_EXPLAINABLE',
    });
  }
  if (cmp(count.counted_amount, count.expected_amount) === 0) {
    return new ConflictException({ message: 'That count has no discrepancy', code: 'NO_DISCREPANCY' });
  }
  if (field === 'operator_note' && count.explanation !== null) {
    return new ConflictException({
      message: 'The owner has already explained this discrepancy',
      code: 'OWNER_ALREADY_EXPLAINED',
    });
  }
  return null;
}

/** The read flag: the field's own role AND no refusal. */
export function countNoteAllowed(
  actor: AuthenticatedUser,
  count: NoteCount,
  field: CountNoteField,
): boolean {
  const role = field === 'explanation' ? UserRole.NetworkOwner : UserRole.PointOperator;
  return actor.role === role && countNoteRefusal(actor, count, field) === null;
}
```

- [ ] **Step 4: Run, expect PASS** — `npx jest -w backend count-notes.spec`.

- [ ] **Step 5: DTOs**

`dto/set-count-explanation.dto.ts`:

```ts
import { IsString, Length, Matches } from 'class-validator';

export class SetCountExplanationDto {
  @IsString()
  @Length(1, 2000)
  @Matches(/\S/, { message: 'explanation must not be blank' })
  explanation: string;
}
```

`dto/set-count-operator-note.dto.ts`: the same with `operator_note` and
`'operator_note must not be blank'`.

- [ ] **Step 6: Service methods**

In `cash-counts.service.ts` add imports (`NotFoundException`, `Shift`, `countNoteRefusal`,
`CountNoteField`, the two DTOs, `UserRole`, `assertOwnsPoint` from where `shifts.service.ts`
imports it) and:

```ts
  setExplanation(actor: AuthenticatedUser, id: string, dto: SetCountExplanationDto) {
    return this.writeNote(actor, id, 'explanation', dto.explanation);
  }

  setOperatorNote(actor: AuthenticatedUser, id: string, dto: SetCountOperatorNoteDto) {
    return this.writeNote(actor, id, 'operator_note', dto.operator_note);
  }

  /** Under the count's row lock, so the owner's write and the operator's serialize (spec §4.1). */
  private writeNote(
    actor: AuthenticatedUser,
    id: string,
    field: CountNoteField,
    text: string,
  ): Promise<CashCountRowResponse> {
    return this.dataSource.transaction(async (m) => {
      const count = await m.findOne(CashCount, { where: { id }, lock: { mode: 'pessimistic_write' } });
      const shift = count ? await m.findOneBy(Shift, { id: count.shift_id }) : null;
      // Another point's count is 404, never 403 — a 403 would confirm the id exists.
      if (!count || !shift || (actor.role !== UserRole.NetworkOwner && actor.collection_point_id !== shift.collection_point_id)) {
        throw new NotFoundException('Cash count not found');
      }
      if (actor.role !== UserRole.NetworkOwner) assertOwnsPoint(actor, shift.collection_point_id);

      const refusal = countNoteRefusal(actor, count, field);
      if (refusal) throw refusal;

      const before = { [field]: count[field] };
      count[field] = text.trim();
      const saved = await m.save(CashCount, count);
      await this.audit.record(
        {
          action: field === 'explanation' ? 'cash-count.explained' : 'cash-count.operator_noted',
          actor_id: actor.sub,
          target_type: 'cash_count',
          target_id: saved.id,
          before,
          after: { [field]: saved[field] },
        },
        m,
      );

      const names = await loadDisplayNames(m, [saved.counted_by_user_id]);
      return toCashCountRowResponse(
        { ...saved, collection_point_id: shift.collection_point_id, business_date: shift.business_date },
        names,
        actor,
      );
    });
  }
```

`toCashCountRowResponse(row, names, actor)` is the mapper signature Step 6b introduces.

- [ ] **Step 6b: Mapper takes the actor**

Do Task 3's Steps 1-3 here (mapper spec + mapper), so this task compiles on its own; Task 3
then only changes the list SQL, `recount` and the db-specs. In `list` and `recount` pass
`actor` as the third argument for now (Task 3 rewrites both properly).

- [ ] **Step 7: Routes**

`cash-counts.controller.ts`:

```ts
  @Put(':id/explanation')
  @Auth(UserRole.NetworkOwner)
  setExplanation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCountExplanationDto,
  ) {
    return this.counts.setExplanation(actor, id, dto);
  }

  @Put(':id/operator-note')
  @Auth(UserRole.PointOperator)
  setOperatorNote(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCountOperatorNoteDto,
  ) {
    return this.counts.setOperatorNote(actor, id, dto);
  }
```

Add one paragraph to the controller header: «`PUT :id/explanation` is the owner's, `PUT
:id/operator-note` is the counter's (spec 2026-10-08) — both through `countNoteRefusal`.»

- [ ] **Step 8: Audit actions**

In `audit/audit-log.entity.ts` `AUDIT_ACTIONS`: add `'cash-count.explained'`,
`'cash-count.operator_noted'` after `'cash-count.recorded'`; delete `'shift.operator_noted'`;
keep `'shift.explained'` with a trailing comment `// historic rows only — since 2026-10-08 explanations are per count`.

- [ ] **Step 9: db-spec for the scenarios**

`backend/src/cash-counts/count-notes.db-spec.ts` — model it on the deleted
`shifts/shift-operator-note.db-spec.ts` (read it with `git show HEAD:backend/src/shifts/shift-operator-note.db-spec.ts`
for its point/user/shift fixtures and its `code()` helper; reuse them verbatim). Cases:

```ts
it('S6: an explained opening leaves the closing discrepancy open and writable', async () => {
  // open with a mismatch against the previous close, owner explains the OPENING count,
  // close with a mismatch
  await counts.setExplanation(owner, openingId, { explanation: 'недостача з учора' });
  const closing = await closingRow(p.closer, shiftId);
  expect(closing.is_open).toBe(true);
  expect(closing.operator_note_editable).toBe(true);
  const listed = await counts.list(owner, { only_discrepancies: true, shift_id: shiftId, page: 1, limit: 50 } as never);
  expect(listed.data.map((r) => r.id)).toContain(closing.id);
  await counts.setOperatorNote(p.closer, closing.id, { operator_note: 'віддав решту' });
});

it('S3: the closer still writes after the next shift opened', async () => {
  // close shift A with a mismatch, open shift B next day at the same point
  await expect(counts.setOperatorNote(p.closer, closingA, { operator_note: 'пізніше' })).resolves.toMatchObject({ operator_note: 'пізніше' });
});

it('S4: the opener explains the opening; another operator is NOT_COUNTER', async () => {
  await counts.setOperatorNote(p.opener, openingB, { operator_note: 'учора недорахували' });
  expect(await code(counts.setOperatorNote(p.other, openingB, { operator_note: 'я' }))).toBe('NOT_COUNTER');
});

it('reopen keeps the demoted row texts; the re-close is a fresh incident; the demoted row is COUNT_NOT_EXPLAINABLE', async () => {
  await counts.setOperatorNote(p.closer, closingId, { operator_note: 'перший раз' });
  await counts.setExplanation(owner, closingId, { explanation: 'утримати' });
  await shifts.reopen(owner, shiftId, { reason: 'перерахунок' });
  const demoted = (await rowsOf(owner, shiftId)).find((r) => r.id === closingId)!;
  expect(demoted.kind).toBe('midday');
  expect(demoted.explanation).toBe('утримати');
  expect(demoted.operator_note).toBe('перший раз');
  expect(await code(counts.setOperatorNote(p.closer, closingId, { operator_note: 'ще' }))).toBe('COUNT_NOT_EXPLAINABLE');
  await shifts.close(p.closer, shiftId, { counted_amount: '950.00', broken_crates: 0 });
  const reclosed = await closingRow(p.closer, shiftId);
  expect(reclosed.is_open).toBe(true);
  expect(reclosed.explanation).toBeNull();
});

it('an operator note never closes the incident; the owner then refuses further notes', async () => {
  await counts.setOperatorNote(p.closer, closingId, { operator_note: 'знайшов 50' });
  expect((await closingRow(owner, shiftId)).is_open).toBe(true);
  await counts.setExplanation(owner, closingId, { explanation: 'прийнято' });
  expect((await closingRow(owner, shiftId)).is_open).toBe(false);
  expect(await code(counts.setOperatorNote(p.closer, closingId, { operator_note: 'змінюю' }))).toBe('OWNER_ALREADY_EXPLAINED');
});

it("another point's operator gets 404 for a count id", async () => {
  await expect(counts.setOperatorNote(otherPointOperator, closingId, { operator_note: 'x' })).rejects.toThrow(NotFoundException);
});

it('records cash-count.operator_noted with before/after in the same transaction', async () => {
  const [row] = await ds.query(
    `SELECT before->>'operator_note' AS before, after->>'operator_note' AS after
       FROM audit_log WHERE action = 'cash-count.operator_noted' AND target_id = $1
      ORDER BY created_at DESC LIMIT 1`, [closingId]);
  expect(row.after).toBe('знайшов 50');
});
```

Fill fixtures (`p.closer`, `p.opener`, `p.other`, `otherPointOperator`, `closingRow`, `rowsOf`)
from the old spec's helpers; `closingRow(actor, shiftId)` = the `kind = 'closing'` berry row
of `counts.list(actor, { shift_id: shiftId, page: 1, limit: 50 })`.

- [ ] **Step 10: Typecheck, unit tests, lint**

Run: `npm run typecheck -w backend && npx jest -w backend cash-counts count-notes && npx eslint backend/src/cash-counts backend/src/audit`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add backend/src/cash-counts backend/src/audit/audit-log.entity.ts
git commit -m "feat(cash-counts): the owner explains and the counter notes a count, no window"
```

---

### Task 3: Reads — `is_open`, list SQL and flags from the count itself

**Files:**
- Modify: `backend/src/cash-counts/cash-count.mapper.ts`
- Modify: `backend/src/cash-counts/cash-counts.service.ts` (`list`, `recount`, drop `NoteColumns` and the `operator-note` import)
- Modify: `backend/src/cash-counts/cash-counts.service.spec.ts`
- Modify: `backend/src/cash-counts/cash-counts.db-spec.ts:159`, `backend/src/point-cash/point-cash.db-spec.ts:784`, `backend/src/seed/dev-seed.db-spec.ts:244`

**Interfaces:**
- Consumes: `countNoteAllowed` (Task 2) and the mapper signature `toCashCountRowResponse(row: CashCountRow, names, actor: AuthenticatedUser)` with `explainable: boolean` (Task 2 Step 6b, which executes Steps 1-3 below).
- Produces: list/recount reading `c.explanation`, `c.operator_note`.

> Steps 1-3 are executed inside Task 2 (Step 6b). If they are already done, start at Step 4.

- [ ] **Step 1: Update the mapper spec first**

In `cash-counts.service.spec.ts` replace the third argument of every
`toCashCountRowResponse(..., NO_NAMES, <bool>)` with an actor, and add:

```ts
const OWNER = { sub: 'own', role: UserRole.NetworkOwner, collection_point_id: null } as AuthenticatedUser;
const CLOSER = { sub: row().counted_by_user_id, role: UserRole.PointOperator, collection_point_id: 'p1' } as AuthenticatedUser;

it('derives both flags from the row — owner may explain, the counter may note', () => {
  expect(toCashCountRowResponse(row(), NO_NAMES, OWNER)).toMatchObject({ explainable: true, operator_note_editable: false });
  expect(toCashCountRowResponse(row(), NO_NAMES, CLOSER)).toMatchObject({ explainable: false, operator_note_editable: true });
});

it("is_open reads only THIS count's explanation", () => {
  expect(toCashCountRowResponse(row({ explanation: 'вирішено' }), NO_NAMES, OWNER).is_open).toBe(false);
  expect(toCashCountRowResponse(row({ explanation: null }), NO_NAMES, OWNER).is_open).toBe(true);
});
```

(`row()` already exists in that spec with a closing berry mismatch; make sure its
`counted_by_user_id` is set and `book`/`kind` are berry/closing.)

- [ ] **Step 2: Run, expect FAIL** — `npx jest -w backend cash-counts.service.spec` (type error / wrong arg).

- [ ] **Step 3: Mapper**

```ts
export function toCashCountRowResponse(
  row: CashCountRow,
  names: ReadonlyMap<string, string>,
  actor: AuthenticatedUser,
): CashCountRowResponse {
  const discrepancy = sub(row.counted_amount, row.expected_amount);
  return {
    // …unchanged fields…
    is_open: discrepancy !== '0.00' && row.kind !== CashCountKind.Midday && row.explanation === null,
    explanation: row.explanation,
    operator_note: row.operator_note,
    explainable: countNoteAllowed(actor, row, 'explanation'),
    operator_note_editable: countNoteAllowed(actor, row, 'operator_note'),
  };
}
```

Update the interface docs: `explanation` — «the owner's decision on THIS count»;
`operator_note` — «whoever counted (spec 2026-10-08)»; add `explainable` — «may THIS caller
(the owner) explain this count now». Update the `is_open` paragraph: «on a count with no
explanation of its own».

- [ ] **Step 4: List SQL and recount**

In `list`: the scope's last clause becomes `AND c.explanation IS NULL`; the SELECT takes
`c.explanation, c.operator_note` and drops `s.explanation, s.operator_note, s.closed_at,
s.closed_by_user_id, ${OPERATOR_NOTE_FACTS_SQL}`; rows are `CashCountRow[]`; the map is
`rows.map((r) => toCashCountRowResponse(r, names, actor))`. Delete `NoteColumns` and the
`../shifts/operator-note` import.

In `recount`: the response row takes `explanation: null, operator_note: null` (a fresh midday
count has neither) and the call passes `actor`. Delete the comment about «whatever explanation
is already on the shift».

- [ ] **Step 5: db-specs that wrote `shifts.explanation`**

- `cash-counts.db-spec.ts:159` → `UPDATE cash_counts SET explanation = $1 WHERE id = $2` on the
  closing count id of that fixture (the file header row «closing MISMATCH, shift EXPLAINED»
  becomes «count EXPLAINED»).
- `point-cash.db-spec.ts:784` → `UPDATE cash_counts SET explanation = 'знайшли причину' WHERE shift_id = $1 AND kind = 'closing'`.
- `dev-seed.db-spec.ts:244` → `AND c.explanation IS NULL` (check the alias the query uses for `cash_counts`).

- [ ] **Step 6: Run** — `npm run typecheck -w backend && npx jest -w backend cash-counts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/cash-counts backend/src/point-cash/point-cash.db-spec.ts backend/src/seed/dev-seed.db-spec.ts
git commit -m "feat(cash-counts): an incident is open until ITS count is explained"
```

---

### Task 4: Delete the shift-level texts

**Files:**
- Delete: `backend/src/shifts/operator-note.ts`, `backend/src/shifts/operator-note.spec.ts`, `backend/src/shifts/dto/set-operator-note.dto.ts`, `backend/src/shifts/dto/set-explanation.dto.ts`, `backend/src/shifts/shift-operator-note.db-spec.ts`
- Modify: `backend/src/shifts/shift.entity.ts` (drop `explanation`, `operator_note`, the operator-note `@Check`)
- Modify: `backend/src/shifts/shift.mapper.ts`, `shift.mapper.spec.ts`
- Modify: `backend/src/shifts/shifts.service.ts` (`reopen`, delete `setExplanation`/`setOperatorNote`, simplify `respond`)
- Modify: `backend/src/shifts/shifts.service.spec.ts`, `backend/src/shifts/shifts.controller.ts`

**Interfaces:**
- Produces: `toShiftResponse(shift, names): ShiftResponse` (two args); `ShiftResponse`
  without `explanation`, `operator_note`, `operator_note_editable`.

- [ ] **Step 1: Update `shifts.service.spec.ts` reopen tests first**

Replace the two reopen cases around lines 425-470 (operator_note cleared / explanation
cleared when the closing count disagreed) with one:

```ts
it('reopen demotes the closing count and touches no text — they stay on the demoted row', async () => {
  // reuse the existing reopen fixture of this spec
  const reopened = await service.reopen(owner, shift.id, { reason: 'перерахунок' });
  expect(reopened).not.toHaveProperty('explanation');
  expect(audit.record).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'shift.reopened',
      before: { closed_at: expect.anything(), status: 'closed', broken_crates: expect.anything() },
      after: { closed_at: null, status: 'open', broken_crates: null },
    }),
    expect.anything(),
  );
});
```

Delete every `setExplanation`/`setOperatorNote` describe block in that file and the
`explanation: null, operator_note: null` lines of its `shift()` factory. In
`shift.mapper.spec.ts` drop the same two factory lines, the `operator_note` test, and call
`toShiftResponse(shift, names)` with two arguments.

- [ ] **Step 2: Run, expect FAIL** — `npx jest -w backend shifts` (the before/after still carry texts).

- [ ] **Step 3: Remove the code**

- `shift.entity.ts`: delete the `explanation` and `operator_note` columns, the
  `CHK_shifts_operator_note_not_blank` `@Check` and their doc comments.
- `shift.mapper.ts`: delete the three fields from `ShiftResponse` and from `toShiftResponse`;
  drop its third parameter and the doc line about `operatorNoteEditable`.
- `shifts.service.ts`:
  - `reopen`: `before`/`after` lose `operator_note` and `explanation`; delete the
    `has_discrepancy` read and the two assignments with their comment.
  - delete `setExplanation` and `setOperatorNote` and their imports (`SetExplanationDto`,
    `SetOperatorNoteDto`, everything from `./operator-note`).
  - `respond`: `const names = await this.namesFor(shifts, m); return shifts.map((s) => toShiftResponse(s, names));`
    and fix its doc comment to «names load ONCE per call (D-8)».
- `shifts.controller.ts`: delete the two `@Put` routes and their imports; drop `Put` from the
  `@nestjs/common` import; update the role table in the header comment (no `explanation`/
  `operator-note` lines; add «explanations: see `cash-counts.controller.ts`»).
- `git rm` the five files listed above.

- [ ] **Step 4: Grep for leftovers**

Run: `grep -rn "operator_note\|explanation\|OPERATOR_NOTE\|operatorNote" backend/src/shifts`
Expected: only `awaiting_explanation` hits and `close-shift.dto.ts`'s comment — read each
remaining hit; a comment claiming the shift carries an explanation is now false and gets a
one-line fix pointing at `cash_counts`.

- [ ] **Step 5: Run** — `npm run typecheck -w backend && npx jest -w backend && npx eslint backend/src` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A backend/src/shifts
git commit -m "refactor(shifts): a shift no longer carries an explanation or a note"
```

---

### Task 5: Frontend data layer — types, mutations, error codes, copy

**Files:**
- Modify: `frontend/src/entities/cash-count/model/cash-count.ts` (+`explainable`)
- Modify: `frontend/src/entities/shift/model/shift.ts` (−`explanation`, −`operator_note`, −`operator_note_editable`)
- Modify: `frontend/src/features/set-operator-note/api/useSetOperatorNote.ts` + test
- Modify: `frontend/src/features/set-cash-explanation/api/useSetCashExplanation.ts` + test
- Modify: `frontend/src/shared/lib/api-error/apiErrorToBanner.ts`
- Modify: `frontend/src/shared/lib/i18n/locales/uk.json`, `en.json`
- Modify: every test fixture building a `Shift` or `CashCount` (`grep -rln "operator_note_editable\|explanation:" frontend/src`)

**Interfaces:**
- Produces: `useSetOperatorNoteMutation()` → `mutateAsync({ countId: string; operatorNote: string }): Promise<CashCount>`;
  `useSetCashExplanationMutation()` → `mutateAsync({ countId: string; explanation: string }): Promise<CashCount>`;
  `CashCount.explainable: boolean`.

- [ ] **Step 1: Failing hook tests**

In `useSetOperatorNote.test.tsx`, change the mock and assertion to the count route:

```ts
mock.onPut('/cash-counts/c1/operator-note').reply(200, { id: 'c1', operator_note: 'віддав решту' });
await result.current.mutateAsync({ countId: 'c1', operatorNote: 'віддав решту' });
expect(JSON.parse(mock.history.put[0].data)).toEqual({ operator_note: 'віддав решту' });
```

Same in `useSetCashExplanation.test.tsx` with `/cash-counts/c1/explanation` and
`{ countId: 'c1', explanation: '…' }`. Keep the existing invalidation assertions.

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/features/set-operator-note src/features/set-cash-explanation` (from `frontend/`).

- [ ] **Step 3: Mutations**

```ts
export interface SetOperatorNoteInput {
  countId: string;
  operatorNote: string;
}

/** Spec 2026-10-08 — the counter's account of THIS count. Invalidates `cashCounts`
 *  (the row carries the text and the flag) and `shifts` (the panel reads its counts). */
export function useSetOperatorNoteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ countId, operatorNote }: SetOperatorNoteInput): Promise<CashCount> =>
      (await httpClient.put<CashCount>(`/cash-counts/${countId}/operator-note`, { operator_note: operatorNote })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.cashCounts });
      qc.invalidateQueries({ queryKey: queryKeys.shifts });
    },
  });
}
```

`useSetCashExplanationMutation`: same shape, `{ countId, explanation }`, `PUT
/cash-counts/${countId}/explanation`; rewrite its doc comment to «§7.7 — the owner's
decision on ONE count (spec 2026-10-08). OWNER ONLY, replaces the text, never moves a number.»
Both import `CashCount` from `@/entities/cash-count`.

- [ ] **Step 4: Types**

`CashCount`: add `/** May THIS caller (the owner) explain this count now — the server decides. */ explainable: boolean;`
and update the `explanation`/`operator_note` doc lines to «of THIS count».
`Shift`: delete `explanation`, `operator_note`, `operator_note_editable`.

- [ ] **Step 5: Error codes and copy**

`apiErrorToBanner.ts`, the operator-note block becomes:

```ts
  // Count explanations (spec 2026-10-08) — `PUT /cash-counts/:id/{explanation,operator-note}`.
  NOT_COUNTER: 'operatorNote.errors.notCounter',
  COUNT_NOT_EXPLAINABLE: 'operatorNote.errors.notExplainable',
  OWNER_ALREADY_EXPLAINED: 'operatorNote.errors.ownerExplained',
  NO_DISCREPANCY: 'operatorNote.errors.noDiscrepancy',
```

(remove `NOT_SHIFT_CLOSER`, `OPERATOR_NOTE_WINDOW_CLOSED`).

`uk.json` → `operatorNote`:

```json
"submit": "Зберегти пояснення",
"saved": "Пояснення збережено — керівник побачить його поруч із розбіжністю",
"titleOpening": "Що сталося? Розбіжність на відкритті {{amount}}",
"titleClosing": "Що сталося? Розбіжність на закритті {{amount}}",
"errors": {
  "required": "Напишіть, що сталося",
  "tooLong": "До 2000 символів",
  "failed": "Не вдалося зберегти пояснення. Спробуйте ще раз.",
  "notCounter": "Пояснити може лише той, хто рахував цю касу.",
  "notExplainable": "Цей підрахунок уже не чинний — поясніть новий. Оновіть сторінку.",
  "ownerExplained": "Керівник уже ухвалив рішення щодо цієї розбіжності. Оновіть сторінку.",
  "noDiscrepancy": "Тут каса зійшлася — пояснювати нічого. Оновіть сторінку."
}
```

Delete `operatorNote.title`, `errors.notClosed`, `errors.notCloser`, `errors.windowClosed`.
Add `pointCash.countHistory.notYours`: «рахував {{name}}»
and `pointCash.result.openedDiscrepancy`: «Зміну відкрито. Розбіжність з учорашнім закриттям {{amount}} — керівник побачить її у своєму списку.»
Mirror every key in `en.json` («Save explanation», «Saved — the owner will see it next to
the discrepancy», «What happened? Opening discrepancy {{amount}}», «… Closing discrepancy …»,
«Only the person who counted this drawer can explain it.», «This count no longer stands —
explain the new one. Refresh the page.», «The owner has already decided on this discrepancy.
Refresh the page.», «The drawer matched here — there is nothing to explain. Refresh the
page.», «Could not save the explanation. Try again.», `notYours` «counted by {{name}}», «Shift opened. {{amount}} off last close — the owner will see it in
their list.»).

- [ ] **Step 6: Fixtures**

Run `grep -rln "operator_note_editable" frontend/src` and in every test fixture: add
`explainable: false` to `CashCount` objects, delete `explanation`/`operator_note`/
`operator_note_editable` from `Shift` objects. `tsc -b` lists the rest.

- [ ] **Step 7: Run** — from `frontend/`: `npx tsc -b && npx vitest run src/features src/entities src/shared` → PASS (pages still fail to compile until Tasks 6-7 only if they read removed `Shift` fields; if `tsc -b` reports `ShiftCountPanel`/`PointCashPage`, finish Task 6 Step 3 before committing).

- [ ] **Step 8: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): explanations and notes are written per count"
```

---

### Task 6: Per-row texts and buttons — history, panel, dialogs

**Files:**
- Modify: `frontend/src/features/set-operator-note/ui/OperatorNoteForm.tsx`, `OperatorNoteDialog.tsx` + test
- Modify: `frontend/src/features/set-cash-explanation/ui/ExplainDiscrepancyDialog.tsx` + test
- Modify: `frontend/src/pages/point-cash/ui/CashCountHistory.tsx` + test
- Modify: `frontend/src/pages/point-cash/ui/ShiftCountPanel.tsx` + test

**Interfaces:**
- Consumes: Task 5 mutations and types.
- Produces: `OperatorNoteForm({ count: CashCount; onDone; onCancel })`,
  `OperatorNoteDialog({ count: CashCount | null; open; onClose })`,
  `ExplainDiscrepancyDialog({ count: CashCount | null; open; onClose })` — each reads
  `id`, `kind`, `discrepancy`, `operator_note` off the row.

- [ ] **Step 1: Failing tests**

`CashCountHistory.test.tsx` — add:

```tsx
it('renders each row its own texts and buttons — an explained opening does not touch the closing', () => {
  const opening = countRow({ id: 'o', kind: 'opening', explanation: 'недостача з учора', is_open: false });
  const closing = countRow({ id: 'c', kind: 'closing', explanation: null, is_open: true, explainable: true });
  render(<CashCountHistory rows={[closing, opening]} isOwner />);
  const [closingRow, openingRow] = screen.getAllByRole('row').slice(1);
  expect(within(openingRow).getByText('недостача з учора')).toBeInTheDocument();
  expect(within(closingRow).queryByText('недостача з учора')).toBeNull();
  expect(within(closingRow).getByRole('button', { name: 'Explain' })).toBeInTheDocument();
});

it('a demoted closing (midday with texts) shows them and no button', () => {
  const demoted = countRow({ kind: 'midday', explanation: 'утримати', operator_note: 'перший раз', is_open: false });
  render(<CashCountHistory rows={[demoted]} isOwner={false} />);
  expect(screen.getByText('утримати')).toBeInTheDocument();
  expect(screen.getByText(/перший раз/)).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
});

it('an open row the operator cannot explain says why', () => {
  render(<CashCountHistory rows={[countRow({ is_open: true, operator_note_editable: false, counted_by_name: 'Марія' })]} isOwner={false} />);
  expect(screen.getByText(/counted by Марія/)).toBeInTheDocument();
});
```

(Use that file's existing row factory and render helper; names above are placeholders for
whatever it already calls them — read the file first. Tests pin English per
`test-setup.ts`.)

`ShiftCountPanel.test.tsx` — the explanation lines come from `counts`, per kind:

```tsx
it('shows the opening and closing explanations each under its own count', () => {
  renderPanel({ counts: [count({ kind: 'opening', explanation: 'ранок' }), count({ kind: 'closing', operator_note: 'вечір' })] });
  expect(screen.getByText(/ранок/)).toBeInTheDocument();
  expect(screen.getByText(/вечір/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/pages/point-cash src/features/set-operator-note src/features/set-cash-explanation`.

- [ ] **Step 3: Implement**

- `OperatorNoteForm`: props become `{ count: CashCount; onDone; onCancel }`; title key
  `count.kind === 'opening' ? 'operatorNote.titleOpening' : 'operatorNote.titleClosing'`;
  `mutateAsync({ countId: count.id, operatorNote: note.trim() })`; `initialNote` is
  `count.operator_note`; delete `OVERRIDES` (no override needed now) and pass
  `apiErrorToBanner(error, 'operatorNote.errors.failed')`.
- `OperatorNoteDialog`: `{ count: CashCount | null; open: boolean; onClose }`, renders the form
  when `count` is set.
- `ExplainDiscrepancyDialog`: `{ count: CashCount | null; open; onClose }`; mutation
  `{ countId: count.id, explanation }`; the quoted block shows `count.operator_note`.
- `CashCountHistory` explanation cell: drop the `row.kind === 'closing'` guard on the note
  (each row now carries its own); render `row.explanation` and `row.operator_note` whenever
  present, for any kind; button for the owner when `row.explainable`, for the operator when
  `row.operator_note_editable`; when `row.is_open` and no button, the muted «Не пояснено» plus
  `t('pointCash.countHistory.notYours', { name: row.counted_by_name ?? '—' })` for an
  operator who is not the counter (the row's `counted_by_user_id !== me.id` — pass `meId` in
  as a prop from `PointCashPage`), else nothing extra. Rows whose `explanation` is set and
  `is_open` false keep today's rendering. Dialog call sites pass `count={explainTarget}` /
  `count={noteTarget}`.
- `ShiftCountPanel`: delete the two `shift.explanation` / `shift.operator_note` lines; under
  the opening `LedgerRow` render `opening.explanation`/`opening.operator_note` and under the
  closing one `closing.*`, with the existing `pointCash.panel.explanation` /
  `pointCash.panel.operatorNote` keys. Show the opening's `DiscrepancyPill` too when its
  discrepancy is non-zero (decision 5).

- [ ] **Step 4: Run** — `npx tsc -b && npx vitest run src/pages/point-cash src/features` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(point-cash): every count shows and takes its own explanations"
```

---

### Task 7: Results — note after an open (S4), result after a banner close (S2)

**Files:**
- Modify: `frontend/src/pages/point-cash/ui/PointCashPage.tsx` + test
- Modify: `frontend/src/features/count-shift/ui/OpenShiftAlert.tsx` + test

**Interfaces:**
- Produces: `OpenShiftAlert` prop `onClosed?: (shiftId: string) => void` — when given, the
  alert calls it instead of the toast.

- [ ] **Step 1: Failing tests**

`OpenShiftAlert.test.tsx`:

```tsx
it('hands the closed shift to onClosed instead of toasting', async () => {
  const onClosed = vi.fn();
  renderAlert({ onClosed }); // existing helper with a stale open shift 's-old'
  await closeThroughDialog('500'); // existing helper: click close, type, confirm
  expect(onClosed).toHaveBeenCalledWith('s-old');
  expect(toastSuccess).not.toHaveBeenCalled();
});
```

`PointCashPage.test.tsx`:

```tsx
it('S4: after opening with a discrepancy the opener sees it and the note form opens', async () => {
  // open mutation resolves { id: 's-new' }; counts for shiftId 's-new' return an opening row
  // { kind: 'opening', discrepancy: '-20.00', operator_note_editable: true }
  await openShiftWith('980');
  expect(await screen.findByRole('dialog')).toHaveTextContent(/Opening discrepancy/);
});

it('first-ever count (discrepancy 0): plain «Shift opened», no form', async () => {
  // opening row discrepancy '0.00', operator_note_editable false
  await openShiftWith('1000');
  expect(await screen.findByText('Shift opened')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('S2: closing a stale shift from the banner shows THAT shift result and the note form', async () => {
  // page ?date= today; current shift is 's-old' (yesterday); counts for 's-old' return a
  // closing row with discrepancy '-50.00' and operator_note_editable true
  await closeStaleFromBanner('950');
  expect(await screen.findByRole('dialog')).toHaveTextContent(/Closing discrepancy/);
});
```

Build these on the file's existing mocks (`useOpenShiftMutation`, `useCashCountsQuery` keyed
by `shiftId`, `useCurrentShiftQuery`); read the file first and reuse its helpers.

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/pages/point-cash src/features/count-shift`.

- [ ] **Step 3: `OpenShiftAlert`**

Add `onClosed?: (shiftId: string) => void` to props (doc: «PointCashPage shows the result
screen instead — spec 2026-10-08, S2»); in `onConfirm`, after `mutateAsync`:

```tsx
          if (onClosed) onClosed(closingId);
          else toast.success(t('day.toast.closed'));
          setClosingId(null);
```

- [ ] **Step 4: `PointCashPage`**

- Read the result's counts by the result's shift, not the page's:
  ```tsx
  const resultCounts = useCashCountsQuery({ shiftId: resultFor?.shiftId });
  const resultBerry = (resultCounts.data?.data ?? []).filter((c) => c.book === 'berry');
  const resultRow =
    resultFor === null
      ? null
      : (resultBerry.find((c) => c.kind === (resultFor.mode === 'open' ? 'opening' : 'closing')) ?? null);
  ```
  Delete the `resultFor.shiftId !== shift.data?.id` guard and rewrite its long «minor 6»
  comment to one line: «Counts are read by the result's own shift, so a result can never show
  another day's count.» (`useCashCountsQuery({ shiftId: undefined })` must stay disabled —
  check `isScoped` in `entities/cash-count`; it already treats no scope as disabled.)
- The note is offered for both modes: `const noteRow = resultRow;`
- The open title: `isZero(resultRow.discrepancy) ? t('pointCash.result.opened') : t('pointCash.result.openedDiscrepancy', { amount })`,
  and `discrepancy` is `resultRow.discrepancy` for both modes (drop the «§7.3 opening carries
  no discrepancy» comment — decision 5 reverses it; one line: «Since 09.09 the opening is
  compared with the last close (spec 2026-10-08, decision 5).»).
- `OperatorNoteForm count={noteTarget}` (Task 6 props).
- `<OpenShiftAlert … onClosed={(id) => { setNoteTarget(null); setNoteOffered(false); setResultFor({ mode: 'close', shiftId: id }); }} />`
- Pass `meId={me?.id ?? null}` to `CashCountHistory` (Task 6).

- [ ] **Step 5: Run** — `npx tsc -b && npx vitest run src` (whole frontend; pages share fixtures) → PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat(point-cash): the opener explains the opening; a banner close shows its result"
```

---

### Task 8: Rules and docs

**Files:**
- Modify: `26-rules-by-example.md` (§7.7 06.10 amendment, 07.10 amendment, §10.3 line)
- Modify: `28-db-schema.dbml` (`cash_counts` columns + Note paragraph; `shifts` loses `explanation`, `operator_note`, the 06.10/07.10 Note text)
- Modify: `CLAUDE.md` (Architecture → Documents), `backend/CLAUDE.md` (migration list), `frontend/CLAUDE.md` (`features/set-operator-note` line if it names shifts)
- Modify: `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` (close three entries)

- [ ] **Step 1: `26-rules-by-example.md`** — replace the «Правка (замовник, 06.10.2026 — пояснення приймальника)» paragraph with:

  > → **Правка (команда, 06.10.2026; переглянуто 08.10.2026 — за #172, де замовник просив
  > кнопку «Пояснити» і для приймальника).** Розбіжність належить підрахунку, а не зміні. Тому
  > пояснення керівника і свідчення приймальника пишуться до конкретного підрахунку — відкриття
  > або закриття. Свідчення пише той, хто рахував: відкриття — той, хто відкривав, закриття —
  > той, хто закривав. Писати можна, поки керівник не пояснив цей підрахунок; відкриття
  > наступної зміни нічого не закриває. Інцидент закриває ЛИШЕ пояснення керівника. Повторне
  > відкриття нічого не стирає: знижений підрахунок зберігає свої тексти як історію.

  Mark the 07.10 amendment: prefix «~~…~~» is not used in this file — instead append «
  **Скасовано 08.10.2026:** пояснення тепер належить підрахунку, тож reopen нічого не стирає.»
  Update the §10.3 line accordingly (grep for `operator_note` in the file).

- [ ] **Step 2: DBML** — under `cash_counts` after `counted_at`: `explanation text` and
  `operator_note text`; append to its Note:

  > **ПРАВКА 08.10.2026 — ПОЯСНЕННЯ НАЛЕЖИТЬ ПІДРАХУНКУ.** `explanation` — рішення керівника щодо
  > розбіжності САМЕ ЦЬОГО підрахунку; лише воно закриває інцидент. `operator_note` — свідчення
  > того, хто рахував (`counted_by_user_id`). Обидва — лише на `opening`/`closing` книги ягоди
  > з ненульовою розбіжністю; це перевіряє код, бо знижений до `midday` рядок закриття зберігає
  > свої тексти, а перерахунок серед дня їх не отримує ніколи, і схема їх не розрізняє.
  > `CHK_cash_counts_explanation_not_blank` і `CHK_cash_counts_operator_note_not_blank`: NULL
  > або непорожній текст. Цифри підрахунку ці колонки не чіпають.

  Under `shifts`: delete `explanation text` and `operator_note text`; in its Note replace the
  sentences from «explanation ПИШЕТЬСЯ, але керівником…» and the two «ПРАВКА 06.10.2026» /
  «ПРАВКА 07.10.2026» blocks with «Пояснення розбіжностей — у `cash_counts` (правка
  08.10.2026).». `grep -c "^Table " 28-db-schema.dbml` stays 24.

- [ ] **Step 3: CLAUDE.md files** — root Architecture → Documents: replace the sentence
  starting «The operator who closed a shift with a closing-count discrepancy may write
  `shifts.operator_note`…» with «Each opening/closing count carries its own owner
  `explanation` (closes the incident) and the counter's `operator_note` (informs, never
  closes) — `PUT /cash-counts/:id/{explanation,operator-note}`, no window, reopen erases
  nothing (spec 2026-10-08).» `backend/CLAUDE.md`: swap `1788600000021-ShiftOperatorNote` for
  `1788600000022-CashCountExplanations` in the migration list. `frontend/CLAUDE.md`: fix any
  `features/set-operator-note` / `set-cash-explanation` line that says «shift».

- [ ] **Step 4: Follow-ups** — under each of «Opening-count discrepancy is invisible to the
  operator», «An explained opening discrepancy disarms the closing note» and «The owner's
  explanation renders on every count row» add «**Closed 2026-10-08** — spec
  `2026-10-08-yagoda-count-explanations-design.md`.»

- [ ] **Step 5: (done at planning time — the spec already says `cash-count.explained`.)**

- [ ] **Step 6: Commit** (docs-only — no verify per commit)

```bash
git add 26-rules-by-example.md 28-db-schema.dbml CLAUDE.md backend/CLAUDE.md frontend/CLAUDE.md docs/superpowers
git commit -m "docs: explanations belong to the count — rules, schema, follow-ups"
```

---

### Task 9: Verify, push, CI's `test:db`, PR description

- [ ] **Step 1: Full tier** — `npm run verify:full`. Expected: every row PASSED except
  `test:db` SKIPPED (no Postgres here) and possibly `smoke`. Paste the verdict line. Read any
  FAILED row's output before re-running; never widen a baseline.
- [ ] **Step 2: Push** — `git -c credential.helper='!gh auth git-credential' push https://github.com/webspirio/yagoda-starter.git HEAD:refs/heads/feat/operator-note`
- [ ] **Step 3: Read CI's `test:db`** — `gh pr checks 218 --watch`; then open the verify job's
  log and confirm `test:db` PASSED (not SKIPPED) and that `count-notes.db-spec` and
  `cash-count-explanations-schema.db-spec` are in it. A red db-spec goes back to its task.
- [ ] **Step 4: PR description** — `gh pr edit 218 --body-file …`: what changed vs the reviewed
  `053e3b8` (per-count model, no window, S2/S3/S4/S6 closed), the migration and its lossy
  `down`, the numbering note against #222, Verification with the real verdict lines and CI's
  `test:db` result, and what is still out of scope (spec §9).
- [ ] **Step 5: Reply to the review comment** on #218 with one line per finding (S2, S3, S4,
  S6, the four minors) and the commit that closes it.
