# Cash Counts Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a collection point's cash drawer answerable — a mandatory count at every shift open and close, `expected = previous count + that shift's movements`, and a discrepancy that is recorded and reported to the owner but never blocks.

**Architecture:** One new table (`cash_counts`) written only inside the shift verbs, plus a re-anchoring of the `point-cash` formula from "documents since the beginning of time" to "the latest count, plus that shift's movements". The movement arithmetic lives in `point-cash` — **not** in `shifts` — because `shifts` needs it and `transfers` needs `shifts`, and putting it in `shifts` would make a module cycle. `point-cash` imports nothing but `ConfigModule`, so it can be imported by everyone.

**Tech Stack:** NestJS 11, TypeORM (`synchronize: false`, migrations run on boot), PostgreSQL, `class-validator` DTOs, Jest (unit `*.spec.ts`, database `*.db-spec.ts`); React 19 + TanStack Query + i18next for the last task.

**Spec:** `docs/superpowers/specs/2026-09-09-yagoda-cash-counts-slice.md` — read it before Task 1. `§N` without a prefix points into that spec; `§7.9`-style references point into `26-rules-by-example.md`.

## Global Constraints

- **All money is a `string`, end to end.** No `Number()`, `parseFloat`, `parseInt`, `toFixed`, `*` or `/` on a monetary value. `backend/src/common/money.ts` is the only sanctioned arithmetic seam; `eslint.config.mjs` enforces this inside `intakes/`, `payouts/`, `shifts/`, `supplier-balance/`, `transfers/` and `point-cash/`.
- **Money arithmetic in this slice happens in Postgres.** `numeric` is exact there and `NULL` propagates for free. Every numeric projection ends in `::text` so no value reaches JavaScript as a number.
- **Dates are server-derived.** `TimeService.now().toISODate()` gives the local calendar day in `APP_TIMEZONE`. No endpoint accepts a business date from a client.
- **A count is evidence, not a document.** No `void_*` trio, no `PATCH`, no correction path. §7.6 — «перерахунок це свідчення, а не коригування».
- **A discrepancy never blocks.** There is no code path where `counted <> expected` prevents a close. `shift_status.awaiting_explanation` stays unreachable *by decision*.
- **`midday` counts never anchor anything** (§6.3, §8). Every anchor query filters `kind <> 'midday'`.
- **A voided transfer still reads `status = 'accepted'`.** Every query about cash filters `voided_at IS NULL` itself. Voided *payouts* stay subtracted — the same column read two opposite ways, and §9.3 says why.
- Comments in this codebase explain *why* at length and cite the rule (`§7.6`, `§10.3`). Match that density; it is the house style.
- Run before every commit: `npm run lint` and the focused test named in the task. Full `npm test`, `npm run test:db -w backend` and `npm run build` at the end of Task 9.
- Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

**Fixture columns, verified against the entities 2026-09-09** — get these wrong and a database spec fails at setup rather than at its assertion:

- `users` — `(first_name, last_name, role, is_active)`. There is **no `name` column**; `CHK_users_role_point` requires `collection_point_id IS NULL` for a `network_owner`.
- `collection_points` — `(name, code, kind, target_cash, is_active)`; `code` matches `^[A-Z0-9]{2,8}$`.
- `shifts` — `(collection_point_id, opened_by_user_id, business_date, closed_at, closed_by_user_id, status)`. No `opened_at`. `UQ_shifts_point_business_date` and a partial `UQ_shifts_open_per_point WHERE closed_at IS NULL`.
- `suppliers` — `(collection_point_id, first_name, last_name, kind, is_active)`.
- `payouts` — `(code, shift_id, supplier_id, amount, paid_by_user_id)` plus optional `voided_*` / `return_settled_*` groups.
- `transfers` — `(collection_point_id, cash, crates, carrier, sent_by_user_id, sent_at, status)` plus optional `accepted_*`, `reported_*`, `resolved_*`, `void_*`.

**Command reference** (from `backend/`):

| What | Command |
|---|---|
| One unit spec | `npx jest src/shifts/shifts.service.spec.ts` |
| One database spec | `npm run test:db -- src/point-cash/point-cash.db-spec.ts` |
| All unit / all db | `npm test -w backend` / `npm run test:db -w backend` (repo root) |

Database specs need Postgres and Redis up (`docker compose up -d postgres redis`) and use `TEST_DB_NAME` (default `app_test`).

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `backend/src/cash-counts/cash-book.enum.ts` | `berry \| crates` |
| `backend/src/cash-counts/cash-count-kind.enum.ts` | `opening \| midday \| closing` |
| `backend/src/cash-counts/cash-count.entity.ts` | Columns + the partial-index note |
| `backend/src/cash-counts/cash-count.mapper.ts` | Wire shape + the computed discrepancy |
| `backend/src/cash-counts/cash-counts.service.ts` | The list read only — counts are WRITTEN by `shifts` |
| `backend/src/cash-counts/cash-counts.controller.ts` | `GET /cash-counts` |
| `backend/src/cash-counts/cash-counts.module.ts` | Exports nothing; `shifts` writes via `EntityManager` |
| `backend/src/cash-counts/dto/list-cash-counts.query.ts` | |
| `backend/src/cash-counts/cash-counts.service.spec.ts` | |
| `backend/src/migrations/1788600000009-YagodaCashCounts.ts` | Enums + table + partial unique index |
| `backend/src/migrations/cash-counts-schema.db-spec.ts` | The partial index and the CHECKs |
| `backend/src/shifts/dto/open-shift.dto.ts` | `{ counted_amount }` |
| `backend/src/shifts/dto/close-shift.dto.ts` | `{ counted_amount }` |
| `backend/src/shifts/dto/set-explanation.dto.ts` | `{ explanation }` |

**Modify:**

| File | Change |
|---|---|
| `26-rules-by-example.md`, `28-db-schema.dbml` | Four amendments (Task 1) |
| `docs/superpowers/specs/2026-09-09-yagoda-transfers-cash-slice.md` | §6.4/§6.6 superseded (Task 1) |
| `backend/src/transfers/transfers.service.ts` | Open shift required; `accepted_date` from the shift |
| `backend/src/transfers/transfers.module.ts` | Gains `ShiftsModule` |
| `backend/src/point-cash/point-cash.service.ts` | `movementsForShift`, `expectedForOpening`, re-anchored `cashFor`, `unexplained_difference` |
| `backend/src/point-cash/point-cash.mapper.ts` | New field |
| `backend/src/point-cash/point-cash.module.ts` | Exports stay; no new imports |
| `backend/src/shifts/shifts.service.ts` | Counts inside `open`/`close`; reopen demotion; `setExplanation` |
| `backend/src/shifts/shifts.controller.ts` | Two bodies, one new route |
| `backend/src/shifts/shifts.module.ts` | Gains `PointCashModule` + `TypeOrmModule.forFeature([CashCount])` |
| `backend/src/audit/audit-log.entity.ts` | `cash-count.recorded`, `shift.explained` |
| `backend/src/app.module.ts` | `CashCountsModule` |
| `CLAUDE.md`, `backend/CLAUDE.md` | Module map, migration list, table counts |
| `frontend/src/entities/{shift,point-cash}`, `frontend/src/pages/{transfers,point-cash,day}` | Task 9 |

---

### Task 1: Amend the source documents

The client's ruling overrules the written rules in four places. This lands **first**, so everything after implements documents that agree with it. §11 of the spec is the authority.

Dated additions leaving superseded text visible — the convention both files already use, and the one slice 1 followed.

**Files:**
- Modify: `26-rules-by-example.md` (§7.3, §7.6, §7.7, §7.9)
- Modify: `28-db-schema.dbml` (`cash_counts` Note, `shifts` Note, `transfers` Note)
- Modify: `docs/superpowers/specs/2026-09-09-yagoda-transfers-cash-slice.md` (§6.4, §6.6)

- [ ] **Step 1: Read the spec's §11 and the target sections**

```bash
sed -n '/^## 11. Divergences/,/^## 12\./p' docs/superpowers/specs/2026-09-09-yagoda-cash-counts-slice.md
grep -n "^## 7.3\|^## 7.6\|^## 7.7\|^## 7.9" 26-rules-by-example.md
```

- [ ] **Step 2: Amend §7.7 of `26-rules-by-example.md`**

Append after the existing `→ **Примітка:**` line that closes §7.7, before the `## 7.8` heading:

```markdown
→ **Примітка (замовник, 09.09.2026 — СКАСОВУЄ правило цього параграфа).** Розбіжність більше НЕ
блокує закриття зміни. Дослівно: «якщо каса не сходиться, це не блокує процес. Ми йдемо далі за
порахованою сумою, але повідомляємо керівника про розбіжність, щоб інцидент розслідували і
причину знайшли». Механічно: зміну закриває ПРИЙМАЛЬНИК як завжди (§10.3), стан
«Очікує пояснення» не настає ніколи, а `shift_status.awaiting_explanation` лишається в enum
недосяжним ЗА РІШЕННЯМ, а не через недогляд — прибирати значення з enum це міграція, якої ніхто
не має писати.

Те, що з §7.7 ЛИШАЄТЬСЯ: розбіжність нікуди не дівається («її не підганяють»), порогів немає, і
пояснення пише КЕРІВНИК — тільки тепер після факту, у `shifts.explanation`, а не як умову
закриття. Інцидент вважається відкритим, поки в зміни немає пояснення.

Примітка нижче («система підказує, а керівник вирішує проблему недостачі в ручному режимі за
межами системи») цьому рішенню не суперечила ніколи — суперечило саме правило.
```

- [ ] **Step 3: Amend §7.3 and §7.6**

To §7.3, after the «Примітка (схема, 03–04.09.2026)» block:

```markdown
→ **Примітка (09.09.2026).** Список джерел отримує ТРЕТЄ: **перший перерахунок точки задає її
початкову касу**. «Коли систему відкривають уперше, ми рахуємо гроші на кожному пункті, і це
значення стає початковим залишком для точки». Далі все як було — жоден НАСТУПНИЙ перерахунок касу
не рухає (§7.6), він лише фіксує розбіжність.
```

To §7.6, after the «Примітка (схема, 03.09.2026 — закриває запитання 3)» block:

```markdown
→ **Примітка (09.09.2026).** «Нічого не виправляє і нічого не перетирає» лишається чинним для
кожного перерахунку, КРІМ першого на точці: у першого немає попереднього, тому його
`expected_amount` дорівнює `counted_amount`, розбіжність нульова за побудовою, і саме він стає
якорем каси (§7.3). Перерахунки при відкритті та закритті зміни тепер ОБОВʼЯЗКОВІ — без них зміна
не відкривається і не закривається.
```

- [ ] **Step 4: Amend §7.9 — acceptance now requires an open shift**

Append to §7.9, after the 09.09.2026 notes added by the previous slice:

```markdown
→ **Примітка (09.09.2026, друга — СКАСОВУЄ рішення попереднього зрізу).** Натиснути «Прийняв» або
«Не сходиться» тепер можна ЛИШЕ при відкритій зміні, і `accepted_date` береться з БІЗНЕС-ДАТИ
ЦІЄЇ ЗМІНИ, а не з годинника.

Причина — каса тепер рахується в межах зміни. Переказ, прийнятий поза зміною, не потрапляє в
арифметику жодної зміни й вилазить розбіжністю там, де нічого не сталося. Гірший випадок це той
самий, що описує цей же §7.9: машина приїхала о 07:00, зміну відкривають о 07:30 — гроші вже в
шухляді на момент перерахунку відкриття, і при денній точності їх неможливо відрізнити від тих,
що приїхали після. Вони потрапили б і в шухляду відкриття, і в рух дня: надлишок на відкритті і
рівна йому недостача на закритті, два фальшиві інциденти з однієї правильної поїздки.

Аргумент §7.9 «зараховано ДНЕМ ПРИЙНЯТТЯ, а не днем відправлення» при цьому тримається: бізнес-дата
зміни І Є операційним днем прийняття.
```

- [ ] **Step 5: Amend the three DBML Notes**

`cash_counts` Note — append inside the `'''` block:

```markdown
**ПРАВКА 09.09.2026 (рішення замовника).** Перерахунок при відкритті та закритті зміни
ОБОВʼЯЗКОВИЙ і пишеться в одній транзакції з самою зміною. `expected_amount` тепер означає
«попередній перерахунок ПЛЮС рухи цієї зміни», а не формулу від початку часів; для ПЕРШОГО
перерахунку точки він дорівнює `counted_amount` (розбіжність нульова за побудовою), і цей перший
запис стає якорем каси. Розбіжність НЕ блокує закриття (§7.7 скасовано в цій частині).
Накопичена невиясненa різниця точки це Σ(`counted_amount` − `expected_amount`) по її
перерахунках — окремо вона НЕ зберігається, бо ланцюг перерахунків і лінія документів можуть
розходитися лише на самі розбіжності. `midday` НЕ є якорем ніколи: при повторному відкритті зміни
її перерахунок закриття перезаписується в `midday`, щоб частковий унікальний індекс лишався
чинним, а свідчення не знищувалось.
```

`shifts` Note — append inside its single-quoted string:

```
ПРАВКА 09.09.2026: закриття зміни більше НЕ блокується розбіжністю каси (§7.7 скасовано в цій частині), тому статус awaiting_explanation недосяжний ЗА РІШЕННЯМ і лишається в enum лише щоб його не реалізували як прогалину. explanation ПИШЕТЬСЯ, але керівником і ПІСЛЯ факту: це відповідь на інцидент, а не умова закриття. Відкриття і закриття тепер обовʼязково несуть перерахунок каси (cash_counts) в тій самій транзакції.
```

`transfers` Note — append inside its single-quoted string:

```
ПРАВКА 09.09.2026 (друга, СКАСОВУЄ першу в частині зміни): прийняти переказ можна лише при ВІДКРИТІЙ ЗМІНІ на точці, і accepted_date береться з business_date тієї зміни, а не з годинника. Причина в тому, що каса рахується в межах зміни: переказ поза зміною не входить в арифметику жодної, а прийнятий о 07:00 перед перерахунком відкриття о 07:30 при денній точності потрапив би і в шухляду відкриття, і в рухи дня. shift_id тут ПОПРИ ЦЕ НЕ ЗʼЯВЛЯЄТЬСЯ: UQ_shifts_point_business_date дає рівно одну зміну на точку на день, тому пара (collection_point_id, accepted_date) визначає її однозначно.
```

- [ ] **Step 6: Supersede the transfers spec's §6.4 and §6.6**

Insert at the top of §6.4's body in `docs/superpowers/specs/2026-09-09-yagoda-transfers-cash-slice.md`:

```markdown
> **SUPERSEDED 2026-09-09 by the cash counts slice (`2026-09-09-yagoda-cash-counts-slice.md`
> §4.1).** Accepting a transfer now REQUIRES an open shift, and `accepted_date` comes from that
> shift's `business_date` rather than from the clock. The reasoning below is preserved because it
> is still why `transfers` carries no `shift_id`; only the no-open-shift-required conclusion is
> reversed.
```

And at the top of §6.6's body:

```markdown
> **SUPERSEDED 2026-09-09 by the cash counts slice §3.2.** The go-live ceremony described here —
> the owner sending each point a transfer for its opening balance — is retired. A point's opening
> balance is now its first cash count. The rest of this section, on why there is no
> `cashBookFrom` setting, still stands.
```

- [ ] **Step 7: Verify no stale assertion survives, then commit**

```bash
grep -n "приймальник закрити не може\|Очікує пояснення\|No open shift required" 26-rules-by-example.md docs/superpowers/specs/2026-09-09-yagoda-transfers-cash-slice.md
```

Expected: every hit sits next to an amendment that supersedes it. If a hit stands alone, add one.

```bash
git add 26-rules-by-example.md 28-db-schema.dbml docs/superpowers/specs/
git commit -m "$(cat <<'MSG'
docs: record the 09.09.2026 cash-count rulings in the source documents

Four amendments. §7.7 loses its gate — a discrepancy no longer blocks a
close, and awaiting_explanation becomes unreachable by decision rather
than by omission. §7.3 gains a third source of cash: a point's first
count sets its opening balance. §7.6 keeps "a recount corrects nothing"
for every count except that first one. §7.9 now requires an open shift
to accept a transfer, which reverses the previous slice.

The transfers spec's §6.4 and §6.6 are marked superseded in place rather
than rewritten, since their reasoning is still why transfers carries no
shift_id.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: The `cash_counts` table

**Interfaces:**
- Produces: `CashBook.Berry | .Crates`, `CashCountKind.Opening | .Midday | .Closing`, the `CashCount` entity with columns `id, shift_id, book, kind, counted_amount, expected_amount, counted_by_user_id, counted_at, created_at`.

**Files:**
- Create: `backend/src/cash-counts/cash-book.enum.ts`, `cash-count-kind.enum.ts`, `cash-count.entity.ts`
- Create: `backend/src/migrations/1788600000009-YagodaCashCounts.ts`
- Create: `backend/src/migrations/cash-counts-schema.db-spec.ts`

- [ ] **Step 1: Write the failing schema spec**

`backend/src/migrations/cash-counts-schema.db-spec.ts` — read `transfers-schema.db-spec.ts` first for the harness idiom:

```ts
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/**
 * The PARTIAL unique index is the whole point of this spec: two `midday` rows
 * on one shift must be legal (a recount is evidence and may happen any number
 * of times) while two `closing` rows must not (§6.3's demotion exists because
 * of it).
 */
describe('cash_counts schema (Postgres)', () => {
  let ds: DataSource;
  let shiftId: string;
  let userId: string;

  const insert = (over: Record<string, unknown> = {}) => {
    const row = {
      shift_id: shiftId,
      book: 'berry',
      kind: 'midday',
      counted_amount: '100.00',
      expected_amount: '100.00',
      counted_by_user_id: userId,
      counted_at: new Date(),
      ...over,
    };
    const keys = Object.keys(row);
    return ds.query(
      `INSERT INTO cash_counts (${keys.map((k) => `"${k}"`).join(', ')})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      keys.map((k) => (row as Record<string, unknown>)[k]),
    );
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    const run = randomUUID().slice(0, 8);
    const [{ id: pointId }] = (await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`Точка ${run}`, `C${run.slice(0, 6).toUpperCase()}`],
    )) as { id: string }[];
    [{ id: userId }] = (await ds.query(
      `INSERT INTO users (first_name, last_name, role, is_active)
       VALUES ('Тест', $1, 'network_owner', true) RETURNING id`,
      [`Owner ${run}`],
    )) as { id: string }[];
    [{ id: shiftId }] = (await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date,
                           closed_at, closed_by_user_id, status)
       VALUES ($1, $2, '2026-09-09', now(), $2, 'closed') RETURNING id`,
      [pointId, userId],
    )) as { id: string }[];
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('accepts an ordinary count', async () => {
    await expect(insert({ kind: 'opening' })).resolves.toHaveLength(1);
  });

  it('refuses a SECOND opening count on the same shift and book', async () => {
    await expect(insert({ kind: 'closing' })).resolves.toHaveLength(1);
    await expect(insert({ kind: 'closing' })).rejects.toThrow(/UQ_cash_counts_shift_book_kind/);
  });

  it('ACCEPTS any number of midday counts — they are outside the partial index', async () => {
    await expect(insert({ kind: 'midday' })).resolves.toHaveLength(1);
    await expect(insert({ kind: 'midday' })).resolves.toHaveLength(1);
    await expect(insert({ kind: 'midday' })).resolves.toHaveLength(1);
  });

  it('separates the two books', async () => {
    await expect(insert({ kind: 'opening', book: 'crates' })).resolves.toHaveLength(1);
  });

  it('refuses negative amounts', async () => {
    await expect(insert({ counted_amount: '-1.00' })).rejects.toThrow(
      /CHK_cash_counts_counted_non_negative/,
    );
    await expect(insert({ expected_amount: '-1.00' })).rejects.toThrow(
      /CHK_cash_counts_expected_non_negative/,
    );
  });

  it('requires both amounts', async () => {
    await expect(insert({ expected_amount: null })).rejects.toThrow(/expected_amount/);
  });

  it('has the enums with exactly their documented values', async () => {
    const books = (await ds.query(
      `SELECT unnest(enum_range(NULL::cash_book))::text AS v ORDER BY v`,
    )) as { v: string }[];
    expect(books.map((b) => b.v)).toEqual(['berry', 'crates']);

    const kinds = (await ds.query(
      `SELECT unnest(enum_range(NULL::cash_count_kind))::text AS v ORDER BY v`,
    )) as { v: string }[];
    expect(kinds.map((k) => k.v)).toEqual(['closing', 'midday', 'opening']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd backend && npm run test:db -- src/migrations/cash-counts-schema.db-spec.ts
```

Expected: FAIL — `relation "cash_counts" does not exist`.

- [ ] **Step 3: Write the enums**

`backend/src/cash-counts/cash-book.enum.ts`:

```ts
/**
 * TWO BOOKS, ONE PHYSICAL DRAWER. §7.6: «фізично шухляда одна, книг дві», and
 * `book` on every row is what makes that visible in each query — a sum without
 * `GROUP BY book` cannot be written by accident.
 *
 * ONLY `berry` IS WRITTEN TODAY, from a constant, never from user input.
 * `crate_issuances` and `crate_returns` do not exist, so no deposit has ever
 * been taken and the whole drawer IS the berry book. Ticket #20 says the same:
 * «це стосується лише каси за ягоди».
 *
 * THE PROBLEM THIS DEFERS, named so the crates slice does not discover it late
 * (spec §7): one physical count has to become two book figures, and neither
 * available answer works. Asking the operator to split it asks them to
 * distinguish identical banknotes; deriving berry as
 * `counted total − expected crate deposits` makes the crates book
 * unfalsifiable, because it could then never disagree with itself.
 */
export enum CashBook {
  Berry = 'berry',
  Crates = 'crates',
}
```

`backend/src/cash-counts/cash-count-kind.enum.ts`:

```ts
/**
 * WHEN a count was taken. `opening` and `closing` are mandatory and written
 * inside the shift verbs (§6.1); `midday` is deliberately OUTSIDE the partial
 * unique index so a recount may happen any number of times (§7.6).
 *
 * `midday` HAS NO ENDPOINT in this slice. It is reachable only as a by-product
 * of reopening a shift, which demotes that shift's `closing` count to `midday`
 * so a second close has a free slot and the evidence survives (§6.3).
 *
 * A `midday` COUNT NEVER ANCHORS THE CASH FIGURE. It sits in the middle of a
 * shift, and isolating "the movements after it" would need a timestamp bound
 * that shift-bounded accounting does not have — so every anchor query filters
 * `kind <> 'midday'` (§8). This is load-bearing, not tidiness.
 */
export enum CashCountKind {
  Opening = 'opening',
  Midday = 'midday',
  Closing = 'closing',
}
```

- [ ] **Step 4: Write the entity**

`backend/src/cash-counts/cash-count.entity.ts`:

```ts
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Shift } from '../shifts/shift.entity';
import { User } from '../users/user.entity';
import { CashBook } from './cash-book.enum';
import { CashCountKind } from './cash-count-kind.enum';

/**
 * A human counting the drawer. The only thing in this system that can notice
 * money is missing.
 *
 * THE POINT IS NOT HERE — it is on `shifts`, and two copies of one fact are
 * forbidden by construction. Scoping a count query to a point is a JOIN.
 *
 * `expected_amount` IS A SNAPSHOT, frozen at the moment of counting, and the
 * DBML's defence of it names a real event: voiding a transfer drops it from
 * the cash formula retroactively, so an owner voiding a three-day-old transfer
 * would otherwise silently rewrite every discrepancy recorded since. Voided
 * PAYOUTS cannot do this — they stay subtracted.
 *
 * WHAT IT MEANS: the previous non-midday count's `counted_amount`, plus this
 * shift's movements when the count is a `closing` (spec §3). For a point's
 * FIRST count there is no predecessor, so it equals `counted_amount` and the
 * discrepancy is zero by construction — not a fudge, because the client's
 * ruling is that the counted figure BECOMES the starting balance, which means
 * at that instant the expectation genuinely is whatever is in the drawer.
 *
 * THE DISCREPANCY IS NOT STORED. It is `counted_amount − expected_amount`, it
 * has no input field for any role (§7.7), and there are no thresholds — a
 * kopiyka out is the same kind of event as 350 ₴ out. A point's accumulated
 * unexplained difference is `Σ (counted − expected)` over its counts and is
 * likewise never stored: the count chain and the document line can differ by
 * the discrepancies and by nothing else.
 *
 * `counted_by_user_id` IS WHO PRESSED THE BUTTON, not who opened the shift.
 * §10.6 — «якщо касу перерахує Марія, у документі перерахунку стоїть Марія,
 * навіть якщо зміну відкривала Оксана».
 *
 * NO `void_*` TRIO AND NO `PATCH`. A count is evidence, not a document (§7.6):
 * no code, no paper twin, no supplier copy. A count that was wrong is answered
 * by counting again, never by editing. The ONE exception is §6.3's demotion of
 * `kind` on reopen, argued there.
 */
@Entity('cash_counts')
@Check('CHK_cash_counts_counted_non_negative', `"counted_amount" >= 0`)
@Check('CHK_cash_counts_expected_non_negative', `"expected_amount" >= 0`)
@Index('IDX_cash_counts_shift_counted_at', ['shift_id', 'counted_at'])
export class CashCount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  shift_id: string;

  @ManyToOne(() => Shift, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'shift_id' })
  shift?: Shift;

  @Column({ type: 'enum', enum: CashBook, enumName: 'cash_book' })
  book: CashBook;

  @Column({ type: 'enum', enum: CashCountKind, enumName: 'cash_count_kind' })
  kind: CashCountKind;

  /** `numeric` — a STRING, never a number. */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  counted_amount: string;

  /** See this class's header — a SNAPSHOT, never recomputed. */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  expected_amount: string;

  @Column({ type: 'uuid' })
  counted_by_user_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'counted_by_user_id' })
  counted_by?: User;

  @Column({ type: 'timestamptz' })
  counted_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
```

**Note the absence of a `@Unique` decorator.** The index is partial and TypeORM metadata cannot express that; a decorator here would make `migration:generate` propose replacing the partial index with a total one on every run. It is hand-written in the migration, exactly as `UQ_shifts_open_per_point` and `UQ_collection_points_name_lower` are.

- [ ] **Step 5: Write the migration**

`backend/src/migrations/1788600000009-YagodaCashCounts.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `cash_counts` — the drawer, counted by a human (§7.6).
 *
 * FOUR THINGS IN HERE LOOK LIKE OMISSIONS AND ARE NOT:
 *
 * 1. The unique index is PARTIAL — `WHERE kind <> 'midday'`. A shift has at
 *    most one opening and one closing count per book, but any number of midday
 *    recounts (§7.6 — «перерахувати можна скільки завгодно разів»). DBML
 *    cannot express a partial index; this is the hand-written half.
 * 2. There is NO `void_*` trio and NO update path. A count is evidence, not a
 *    document. The one mutation that exists — reopening a shift rewrites its
 *    closing count's `kind` to `midday` — is argued in the spec's §6.3.
 * 3. There is NO discrepancy column. It is `counted − expected`, it is never
 *    stored, and no role has an input field for it (§7.7).
 * 4. `cash_book` gets BOTH values although only `berry` is ever written today.
 *    Adding an enum value later is a migration nobody should have to write,
 *    and 28-db-schema.dbml is the schema of record.
 *
 * `shifts.explanation` and `shift_status.awaiting_explanation` were created by
 * `YagodaIntakesAndPayouts` and left unwritten "until cash_counts lands". This
 * IS that slice, and only the first of the two gets used: the client's ruling
 * of 09.09.2026 removed the blocking, so `awaiting_explanation` stays
 * unreachable BY DECISION.
 */
export class YagodaCashCounts1788600000009 implements MigrationInterface {
  name = 'YagodaCashCounts1788600000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "cash_book" AS ENUM ('berry', 'crates')`);
    await queryRunner.query(
      `CREATE TYPE "cash_count_kind" AS ENUM ('opening', 'midday', 'closing')`,
    );

    await queryRunner.query(`
      CREATE TABLE "cash_counts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shift_id" uuid NOT NULL,
        "book" "cash_book" NOT NULL,
        "kind" "cash_count_kind" NOT NULL,
        "counted_amount" numeric(12,2) NOT NULL,
        "expected_amount" numeric(12,2) NOT NULL,
        "counted_by_user_id" uuid NOT NULL,
        "counted_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cash_counts" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_cash_counts_counted_non_negative" CHECK ("counted_amount" >= 0),
        CONSTRAINT "CHK_cash_counts_expected_non_negative" CHECK ("expected_amount" >= 0),
        CONSTRAINT "FK_cash_counts_shift" FOREIGN KEY ("shift_id")
          REFERENCES "shifts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_cash_counts_counted_by" FOREIGN KEY ("counted_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);

    // PARTIAL, and the `WHERE` is the whole point — see this class's header.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_cash_counts_shift_book_kind"
        ON "cash_counts" ("shift_id", "book", "kind")
        WHERE "kind" <> 'midday'
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_cash_counts_shift_counted_at"
        ON "cash_counts" ("shift_id", "counted_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "cash_counts"`);
    await queryRunner.query(`DROP TYPE "cash_count_kind"`);
    await queryRunner.query(`DROP TYPE "cash_book"`);
  }
}
```

- [ ] **Step 6: Run the spec to verify it passes**

```bash
cd backend && npm run test:db -- src/migrations/cash-counts-schema.db-spec.ts
```

Expected: PASS, 7 tests. No entity registration is needed — `autoLoadEntities: true` plus the `**/*.entity{.ts,.js}` glob in `data-source.ts` handle it once a module registers `TypeOrmModule.forFeature([CashCount])` (Task 5).

- [ ] **Step 7: Lint and commit**

```bash
cd backend && npm run lint
git add backend/src/cash-counts backend/src/migrations
git commit -m "$(cat <<'MSG'
feat(cash-counts): the table, its two enums and its partial unique index

The index is partial — WHERE kind <> 'midday' — so a shift has at most
one opening and one closing count per book while permitting any number
of midday recounts, which §7.6 requires. DBML cannot express that, so it
is hand-written, and a spec watches it accept three midday rows and
refuse a second closing one.

No void trio, no update path and no discrepancy column: a count is
evidence, and the discrepancy is counted − expected with no input field
for any role.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: `transfers` — an open shift is required, and the date comes from it

Lands before the formula work so the movement arithmetic is correct end to end.

**Interfaces:**
- Consumes: `ShiftsService.findOpenAtPoint(pointId, manager?)` → `Promise<Shift | null>` (already exists and already takes an `EntityManager`).
- Produces: no new signatures; `accept` and `dispute` gain a refusal and change what they stamp.

**Files:**
- Modify: `backend/src/transfers/transfers.service.ts`, `transfers.module.ts`, `transfers.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to the `TransfersService.accept / dispute` describe block in `transfers.service.spec.ts`. The existing `build()` helper constructs the service positionally — add a `shifts` stub as a new constructor argument (see Step 3) and update **every** construction site in the file:

```ts
  it('REFUSES when the point has no open shift — spec §4.1', async () => {
    const { service } = build(sentTransfer(), { openShift: null });
    await expect(service.accept(operatorA, 't-1')).rejects.toThrow(ConflictException);
    await expect(
      service.dispute(operatorA, 't-1', {
        reported_cash: '140000.00',
        reported_crates: 195,
        dispute_note: 'мішок легший',
      } as never),
    ).rejects.toThrow(ConflictException);
  });

  it("takes accepted_date from the SHIFT's business_date, not from today — spec §4.2", async () => {
    // The shift opened Friday and is being closed Saturday; the clock says
    // Saturday, and the transfer must still land on Friday or it falls outside
    // its own shift's movements.
    const { service, saved } = build(sentTransfer(), {
      openShift: { id: 's-fri', business_date: '2026-09-04' },
      today: '2026-09-05',
    });
    await service.accept(operatorA, 't-1');
    expect(saved[0].accepted_date).toBe('2026-09-04');
  });

  it('stamps the same shift date on a dispute', async () => {
    const { service, saved } = build(sentTransfer(), {
      openShift: { id: 's-fri', business_date: '2026-09-04' },
      today: '2026-09-05',
    });
    await service.dispute(operatorA, 't-1', {
      reported_cash: '140000.00',
      reported_crates: 195,
      dispute_note: 'мішок легший',
    } as never);
    expect(saved[0].accepted_date).toBe('2026-09-04');
    expect(saved[0].reported_cash).toBe('140000.00');
  });
```

Extend that block's `build()` to accept the options and pass a sixth constructor argument:

```ts
  const build = (
    row: Record<string, unknown> | null = sentTransfer(),
    opts: { openShift?: { id: string; business_date: string } | null; today?: string } = {},
  ) => {
    const saved: Record<string, unknown>[] = [];
    const manager = {
      findOne: jest.fn().mockResolvedValue(row),
      save: jest.fn((_e: unknown, x: Record<string, unknown>) => {
        saved.push(x);
        return x;
      }),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const dataSource = { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)) };
    const today = opts.today ?? '2026-09-09';
    const time = {
      now: () => ({ toISODate: () => today, toJSDate: () => new Date(`${today}T06:00:00Z`) }),
    };
    const shifts = {
      findOpenAtPoint: jest
        .fn()
        .mockResolvedValue(
          opts.openShift === undefined
            ? { id: 's-1', business_date: today }
            : opts.openShift,
        ),
    };
    const service = new TransfersService(
      {} as never,
      {} as never,
      audit as never,
      time as never,
      dataSource as never,
      { appTimezone: 'Europe/Kyiv' } as never,
      shifts as never,
    );
    return { service, audit, saved, manager, shifts };
  };
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && npx jest src/transfers/transfers.service.spec.ts
```

Expected: FAIL — the new tests, plus compile errors at the other construction sites until Step 4.

- [ ] **Step 3: Add `ShiftsService` to the constructor and the module**

In `transfers.service.ts`, add as the **last** constructor parameter:

```ts
    /**
     * §4.1 — a transfer may only be accepted into an OPEN SHIFT, which is what
     * makes shift-bounded cash arithmetic airtight. Injected last so the five
     * existing positional construction sites in the unit spec keep their order.
     */
    private readonly shifts: ShiftsService,
```

In `transfers.module.ts`, add `ShiftsModule` to `imports` and replace the module's "no ShiftsModule" comment with:

```ts
/**
 * IMPORTS `ShiftsModule` AS OF THE CASH COUNTS SLICE, reversing this module's
 * original refusal. Cash is now counted per shift, so a transfer accepted
 * outside one belongs to no shift's arithmetic — see the cash counts spec
 * §4.1. `ShiftsService.findOpenAtPoint` takes an `EntityManager`, so the
 * lookup happens inside the same transaction as the write.
 *
 * NO CYCLE: `shifts` imports `point-cash` for its movement arithmetic, and
 * `point-cash` imports nothing but `ConfigModule`.
 */
```

- [ ] **Step 4: Change `transition` to require the shift and take its date**

Replace the body of `transition`'s transaction block, between the point-ownership 404 and the state checks:

```ts
      // §4.1 — SHIFT REQUIRED. Read inside the transaction so a shift cannot
      // be closed between the check and the write.
      const shift = await this.shifts.findOpenAtPoint(transfer.collection_point_id, m);
      if (!shift) {
        throw new ConflictException({
          message: 'Open a shift before signing for a delivery',
          code: 'NO_OPEN_SHIFT',
        });
      }
```

and change the `apply` call to pass the shift's business date rather than today's:

```ts
      const now = this.time.now().toJSDate();
      // THE SHIFT'S BUSINESS DATE, NOT THE CLOCK (§4.2). A shift opened Friday
      // and closed Saturday morning has `business_date = Friday`; a transfer
      // accepted into it on Saturday must land on Friday, or it falls outside
      // its own shift's movements and shows up as a discrepancy on both sides.
      const businessDate = shift.business_date;
      const { after, note } = apply(transfer, now, businessDate);
```

`stampArrival`'s third parameter keeps its name in the signature but its doc comment must change — it is no longer "today":

```ts
  /**
   * BOTH POINT ACTIONS STAMP THE ARRIVAL … `businessDate` is the OPEN SHIFT's
   * business date as of the cash counts slice (§4.2), not the local calendar
   * day. §7.9's argument was only ever «не днем відправлення»; the shift's
   * business date IS the operational day of acceptance.
   */
```

- [ ] **Step 5: Run to verify it passes**

```bash
cd backend && npx jest src/transfers && npm test
```

Expected: PASS. The full unit suite catches any construction site missed in Step 1.

- [ ] **Step 6: Lint and commit**

```bash
cd backend && npm run lint
git add backend/src/transfers
git commit -m "$(cat <<'MSG'
feat(transfers): accepting requires an open shift, dated from that shift

Reverses this module's own §6.4. Cash is about to be counted per shift,
and a transfer accepted outside one belongs to no shift's arithmetic —
it enters no expectation and surfaces as a discrepancy when nothing went
wrong.

accepted_date now comes from the shift's business_date rather than the
clock, because date-matching otherwise breaks on the case the client
plans to tolerate: a shift opened Friday and closed Saturday morning
would stamp Saturday on a transfer belonging to Friday's movements.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: `point-cash` — movements, the opening expectation, and the re-anchored formula

The arithmetic heart. Everything after this consumes it.

**Interfaces:**
- Produces, all on `PointCashService`:
  - `movementsForShift(shiftId: string, manager?: EntityManager): Promise<string>` — signed decimal string; a shift with nothing reads `'0.00'`.
  - `expectedForOpening(pointId: string, manager?: EntityManager): Promise<string | null>` — the previous non-midday count's `counted_amount`, or `null` when the point has never been counted.
  - `expectedForClosing(shiftId: string, manager?: EntityManager): Promise<string | null>` — that shift's opening count plus `movementsForShift`, or `null` when the shift has no opening count.
  - `cashFor(pointId, asOf?, manager?)` — unchanged signature, re-anchored behaviour.

**Files:**
- Modify: `backend/src/point-cash/point-cash.service.ts`, `point-cash.db-spec.ts`

- [ ] **Step 1: Write the failing database scenarios**

Append a new `describe` to `point-cash.db-spec.ts`. It needs a count fixture; add it beside the existing `transfer` and `payout` helpers:

```ts
  const count = async (
    shiftId: string,
    kind: 'opening' | 'midday' | 'closing',
    counted: string,
    expected: string,
    at = new Date('2026-09-02T07:30:00Z'),
  ): Promise<void> => {
    await ds.query(
      `INSERT INTO cash_counts (shift_id, book, kind, counted_amount, expected_amount,
                                counted_by_user_id, counted_at)
       VALUES ($1, 'berry', $2, $3, $4, $5, $6)`,
      [shiftId, kind, counted, expected, ownerId, at],
    );
  };
```

and a shift fixture that returns its id (the existing `payout` helper makes one internally; extract it or add):

```ts
  const shift = async (pointId: string, businessDate: string, closed = true): Promise<string> => {
    const [{ id }] = (await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date,
                           closed_at, closed_by_user_id, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        pointId,
        ownerId,
        businessDate,
        closed ? new Date() : null,
        closed ? ownerId : null,
        closed ? 'closed' : 'open',
      ],
    )) as { id: string }[];
    return id;
  };
```

Then:

```ts
describe('PointCashService — count-anchored cash (Postgres)', () => {
  it('a point with NO counts reads 0.00 even when it has accepted transfers', async () => {
    const p = await newPoint();
    await transfer(p, { cash: '150000.00' });
    // The documents are ignored entirely until someone counts the drawer
    // (spec §8). This will look like a regression on deploy and is not one.
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('0.00');
  });

  it('after a CLOSING count, cash is that count exactly', async () => {
    const p = await newPoint();
    const s = await shift(p, '2026-09-02');
    await transfer(p, { cash: '1000.00', accepted_date: '2026-09-02' });
    await count(s, 'opening', '500.00', '500.00');
    await count(s, 'closing', '1490.00', '1500.00');
    // 1490 counted, 1500 expected — 10 short, and cash follows the COUNT.
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('1490.00');
  });

  it("after an OPENING count, cash is that count plus the shift's movements so far", async () => {
    const p = await newPoint();
    const s = await shift(p, '2026-09-02', false);
    await count(s, 'opening', '500.00', '500.00');
    await transfer(p, { cash: '1000.00', accepted_date: '2026-09-02' });
    await payoutIn(s, '250.00');
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('1250.00');
  });

  it('a DEMOTED midday count never becomes the anchor — spec §8', async () => {
    const p = await newPoint();
    const s = await shift(p, '2026-09-02', false);
    await count(s, 'opening', '500.00', '500.00', new Date('2026-09-02T07:30:00Z'));
    await transfer(p, { cash: '1000.00', accepted_date: '2026-09-02' });
    // Newest by counted_at, and it must be ignored: isolating "movements after
    // it" would need a timestamp bound this model does not have.
    await count(s, 'midday', '9999.00', '9999.00', new Date('2026-09-02T11:00:00Z'));
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('1500.00');
  });

  it('the first count is the anchor and earlier documents are not double counted', async () => {
    const p = await newPoint();
    await transfer(p, { cash: '9999.00', accepted_date: '2026-08-01' });
    const s = await shift(p, '2026-09-02');
    await count(s, 'opening', '500.00', '500.00');
    await count(s, 'closing', '500.00', '500.00');
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('500.00');
  });

  it('movementsForShift signs each term correctly', async () => {
    const p = await newPoint();
    const s = await shift(p, '2026-09-02');
    await transfer(p, { cash: '1000.00', accepted_date: '2026-09-02' });
    await payoutIn(s, '250.00');
    await expect(service.movementsForShift(s)).resolves.toBe('750.00');
  });

  it('movementsForShift keeps both voided readings', async () => {
    const p = await newPoint();
    const s = await shift(p, '2026-09-02');
    await transfer(p, {
      cash: '1000.00',
      accepted_date: '2026-09-02',
      voided_at: new Date(),
      voided_by_user_id: ownerId,
      void_reason: 'дубль',
    });
    await payoutIn(s, '250.00', {
      voided_at: new Date(),
      voided_by_user_id: ownerId,
      void_reason: 'помилка',
    });
    // Voided transfer adds nothing; voided payout STILL subtracts.
    await expect(service.movementsForShift(s)).resolves.toBe('-250.00');
  });

  it('expectedForOpening is the previous non-midday count, or null for a first count', async () => {
    const p = await newPoint();
    await expect(service.expectedForOpening(p)).resolves.toBeNull();

    const s = await shift(p, '2026-09-02');
    await count(s, 'opening', '500.00', '500.00');
    await count(s, 'closing', '1490.00', '1500.00');
    await expect(service.expectedForOpening(p)).resolves.toBe('1490.00');
  });

  it('expectedForClosing is the opening count plus the movements', async () => {
    const p = await newPoint();
    const s = await shift(p, '2026-09-02');
    await count(s, 'opening', '500.00', '500.00');
    await transfer(p, { cash: '1000.00', accepted_date: '2026-09-02' });
    await payoutIn(s, '250.00');
    await expect(service.expectedForClosing(s)).resolves.toBe('1250.00');
  });
});
```

The existing `payout` helper makes its own shift; the new scenarios need to put a payout into a
shift they already hold. Split it, keeping the old signature working so the existing 17 scenarios
are untouched:

```ts
  /** Puts a payout into a shift the caller already has. */
  const payoutIn = async (
    shiftId: string,
    amount: string,
    over: Record<string, unknown> = {},
  ): Promise<void> => {
    const [{ id: supplierId }] = (await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, kind, is_active)
       SELECT s.collection_point_id, 'Тест', $2, 'none', true FROM shifts s WHERE s.id = $1
       RETURNING id`,
      [shiftId, randomUUID().slice(0, 8)],
    )) as { id: string }[];

    const row: Record<string, unknown> = {
      code: `PO-${randomUUID().slice(0, 12)}`,
      shift_id: shiftId,
      supplier_id: supplierId,
      amount,
      paid_by_user_id: ownerId,
      ...over,
    };
    const keys = Object.keys(row);
    await ds.query(
      `INSERT INTO payouts (${keys.map((k) => `"${k}"`).join(', ')})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
      keys.map((k) => row[k]),
    );
  };
```

and rewrite the existing `payout(pointId, businessDate, amount, over?)` to be
`payoutIn(await shift(pointId, businessDate), amount, over)`, so the 17 existing scenarios keep
passing unchanged.

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && npm run test:db -- src/point-cash/point-cash.db-spec.ts
```

Expected: FAIL — `service.movementsForShift is not a function`, and the anchored scenarios returning document-line figures.

- [ ] **Step 3: Add the movement SQL and the three methods**

In `point-cash.service.ts`, beside `cashSql`:

```ts
/**
 * THE MOVEMENTS OF ONE SHIFT — the `+ operations` half of every expectation.
 *
 * SHIFT-BOUNDED BY THE CLIENT'S DECISION, and the reasoning is recorded
 * because it outranks the technical argument: «closing the shift is an
 * important part of the process, and it will be easier for us to make sure
 * shifts are closed on time than to deal with time boundaries». A rule the
 * business can train and audit beats a boundary only the code can see. The
 * cost is named in the spec's §9.1 and is accepted.
 *
 * TRANSFERS JOIN BY (point, accepted_date), NOT BY A COLUMN. `transfers` has
 * no `shift_id` — the DBML omits it deliberately — and it does not need one:
 * `UQ_shifts_point_business_date` gives exactly one shift per point per day,
 * and the cash counts slice §4.1 guarantees every accepted transfer was taken
 * into an open shift whose business date it carries. A `sent` transfer has a
 * NULL `accepted_date` and cannot match, which is §7.9's «у стані sent не
 * рухається НІЧОГО» falling out for free.
 *
 * BOTH VOIDED READINGS SURVIVE FROM THE TRANSFERS SLICE, and harmonising them
 * opens a theft path (§9.3): a voided TRANSFER stops being added, a voided
 * PAYOUT stays subtracted, because that money physically left the drawer and
 * comes back only when a human returns it — the third term.
 */
const movementsSql = (shift: string): string => `(
    COALESCE((SELECT SUM(CASE
                WHEN t.status = 'accepted' THEN t.cash
                WHEN t.status = 'disputed' AND t.resolved_at IS NOT NULL THEN t.resolved_cash
                WHEN t.status = 'disputed' THEN t.reported_cash
              END)
         FROM transfers t
         JOIN shifts s ON s.collection_point_id = t.collection_point_id
                      AND s.business_date = t.accepted_date
        WHERE s.id = ${shift}
          AND t.voided_at IS NULL), 0.00)
  - COALESCE((SELECT SUM(p.amount) FROM payouts p
        WHERE p.shift_id = ${shift}), 0.00)
  + COALESCE((SELECT SUM(p.amount) FROM payouts p
        WHERE p.shift_id = ${shift}
          AND p.return_settled_at IS NOT NULL), 0.00)
)`;

/**
 * THE ANCHOR — the latest `opening` or `closing` count at a point, on or
 * before `asOf`. `midday` is excluded and that is load-bearing rather than
 * tidy: a demoted midday count (spec §6.3) sits mid-shift, and isolating "the
 * movements after it" would need a timestamp bound shift-bounded accounting
 * does not have.
 *
 * The ordering tiebreak puts `closing` after `opening` within one shift.
 */
const anchorSql = (point: string, asOf: string): string => `(
  SELECT c.counted_amount, c.kind, c.shift_id
    FROM cash_counts c
    JOIN shifts s ON s.id = c.shift_id
   WHERE s.collection_point_id = ${point}
     AND c.book = 'berry'
     AND c.kind <> 'midday'
     AND s.business_date <= ${asOf}
   ORDER BY s.business_date DESC, (c.kind = 'closing') DESC, c.counted_at DESC
   LIMIT 1
)`;
```

Then the three methods:

```ts
  /** The signed movements of one shift, as a decimal STRING. */
  async movementsForShift(shiftId: string, manager?: EntityManager): Promise<string> {
    const runner = manager ?? this.dataSource.manager;
    const [row] = (await runner.query(
      `SELECT ${movementsSql('$1::uuid')}::text AS movements`,
      [shiftId],
    )) as { movements: string }[];
    return row.movements;
  }

  /**
   * What an OPENING count should find: the previous non-midday count's figure,
   * or `null` when the point has never been counted.
   *
   * THERE IS NO MOVEMENTS TERM HERE, and that is a consequence of the transfers
   * reversal rather than an omission: every cash movement now belongs to a
   * shift (spec §4.1), and a shift's movements are settled by its own closing
   * count. Nothing can move between one shift's close and the next one's open.
   */
  async expectedForOpening(pointId: string, manager?: EntityManager): Promise<string | null> {
    const runner = manager ?? this.dataSource.manager;
    const rows = (await runner.query(
      `SELECT a.counted_amount::text AS expected
         FROM ${anchorSql('$1::uuid', "'infinity'::date")} a`,
      [pointId],
    )) as { expected: string }[];
    return rows[0]?.expected ?? null;
  }

  /**
   * What a CLOSING count should find: this shift's opening count plus its
   * movements. `null` when the shift has no opening count — impossible through
   * the API (§6.1 writes one in the same transaction) and therefore a signal
   * that something wrote a shift directly.
   */
  async expectedForClosing(shiftId: string, manager?: EntityManager): Promise<string | null> {
    const runner = manager ?? this.dataSource.manager;
    const rows = (await runner.query(
      `SELECT (c.counted_amount + ${movementsSql('$1::uuid')})::text AS expected
         FROM cash_counts c
        WHERE c.shift_id = $1::uuid AND c.book = 'berry' AND c.kind = 'opening'`,
      [shiftId],
    )) as { expected: string }[];
    return rows[0]?.expected ?? null;
  }
```

- [ ] **Step 4: Re-anchor `cashFor`**

Replace `cashFor`'s query, keeping its signature:

```ts
  async cashFor(pointId: string, asOf?: string, manager?: EntityManager): Promise<string> {
    const runner = manager ?? this.dataSource.manager;
    // The anchor plus, when the anchor is an OPENING count, that shift's
    // movements. There is no third term for "shifts after the anchor": §6.1
    // makes every shift opening write a count, so a later shift would hold a
    // later count and BE the anchor.
    const sql = `
      SELECT COALESCE((
        SELECT (a.counted_amount
                + CASE WHEN a.kind = 'opening' THEN ${movementsSql('a.shift_id')}
                       ELSE 0.00 END)
          FROM ${anchorSql('$1::uuid', asOfSql('$2', '$3'))} a
      ), 0.00)::text AS cash`;
    const [row] = (await runner.query(sql, [pointId, asOf ?? null, this.tz.appTimezone])) as {
      cash: string;
    }[];
    return row.cash;
  }
```

**Re-anchor `list` in the same step — it has the other call site.** In `list`'s `scoped` CTE,
replace `${cashSql('cp.id', asOfSql('$2', '$3'), '$3')} AS cash` with the same anchored
expression:

```sql
                COALESCE((
                  SELECT (a.counted_amount
                          + CASE WHEN a.kind = 'opening' THEN ${movementsSql('a.shift_id')}
                                 ELSE 0.00 END)
                    FROM ${anchorSql('cp.id', asOfSql('$2', '$3'))} a
                ), 0.00) AS cash
```

**Then DELETE `cashSql` entirely.** Both of its call sites are now anchored, and leaving a
document-line formula in the file is how the two endpoints drift apart again. Its comment block
is not lost: `movementsSql`'s header already carries both `voided_at` asymmetries and the
three-way status `CASE`, which were the parts worth keeping. `asOfSql` STAYS — the anchor query
still bounds by business date.

Replace the module header's "NOTHING IS CACHED" paragraph's second half with:

```ts
 * RE-ANCHORED BY THE CASH COUNTS SLICE. This formula no longer runs from the
 * beginning of time: a point's cash is its latest non-midday COUNT, plus that
 * shift's movements when the count was an `opening`. Nothing is still stored
 * and nothing is still cached — the anchor is a row someone wrote by counting
 * a drawer, not a balance the system maintained.
 *
 * A POINT WITH NO COUNTS READS `0.00` NO MATTER WHAT ITS DOCUMENTS SAY. That
 * is correct — until a human has counted the drawer the system has no claim
 * about it — and it is a visible behaviour change from the transfers slice.
 * It will look like a regression on deploy and it is not one.
```

- [ ] **Step 5: Run to verify it passes**

```bash
cd backend && npm run test:db -- src/point-cash/point-cash.db-spec.ts
```

Expected: PASS. **Several of the original 17 scenarios will now fail** — they assert the document-line figures this task replaces. Update them to seed an anchoring count; do NOT weaken an assertion to make it pass. Scenarios 1-8 and 11 all need an `opening` count of `'0.00'` on a shift dated before their transfers.

- [ ] **Step 6: Lint and commit**

```bash
cd backend && npm run lint && npm run test:db -- src/point-cash
git add backend/src/point-cash
git commit -m "$(cat <<'MSG'
feat(point-cash): re-anchor the cash formula on physical counts

Cash is no longer computed from the beginning of time. It is the latest
non-midday count, plus that shift's movements when the count was an
opening. midday is excluded from anchoring and that is load-bearing: a
demoted midday count sits mid-shift, and isolating the movements after
it would need a timestamp bound shift-bounded accounting does not have.

Both voided readings survive unchanged — a voided transfer stops being
added, a voided payout stays subtracted.

A point with no counts now reads 0.00 whatever its documents say. That
is correct and will look like a regression on deploy.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: `POST /shifts` writes the opening count

**Interfaces:**
- Consumes: `PointCashService.expectedForOpening(pointId, manager?)`.
- Produces: `OpenShiftDto { counted_amount: string }`; `ShiftsService.open(actor, dto)`.

**Files:**
- Create: `backend/src/shifts/dto/open-shift.dto.ts`
- Modify: `backend/src/shifts/shifts.service.ts`, `shifts.controller.ts`, `shifts.module.ts`, `shifts.service.spec.ts`
- Modify: `backend/src/audit/audit-log.entity.ts`

- [ ] **Step 1: Add the audit actions and the DTO**

Append to `AUDIT_ACTIONS` in `audit-log.entity.ts`:

```ts
  'cash-count.recorded',
  'shift.explained',
```

`backend/src/shifts/dto/open-shift.dto.ts`:

```ts
import { Matches } from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

/**
 * §6.1 — counting the drawer is PART of opening a shift, not a step after it.
 * «Must be counted» is only true if it cannot be skipped: a separate endpoint
 * would let a shift exist with no opening count, and the closing expectation
 * would then have no anchor.
 *
 * ONE AMOUNT, and `book` is written from a constant. The crates book has no
 * source of money yet, so the whole drawer IS the berry book (spec §7).
 *
 * NO EXPECTED FIGURE IS ACCEPTED OR RETURNED BEFORE THE WRITE. §7.6 —
 * «очікувана сума СХОВАНА, поки не введено фактичну».
 */
export class OpenShiftDto {
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'counted_amount must be a non-negative decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  counted_amount: string;
}
```

- [ ] **Step 2: Write the failing tests**

Add to `shifts.service.spec.ts`:

```ts
describe('ShiftsService.open with a count', () => {
  const build = (opts: { previous?: string | null } = {}) => {
    const saved: Record<string, unknown>[] = [];
    const manager = {
      save: jest.fn((_e: unknown, x: Record<string, unknown>) => {
        saved.push(x);
        return { id: 'sh-1', created_at: new Date(), ...x };
      }),
      getRepository: jest.fn(),
    };
    const dataSource = { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)) };
    const cash = {
      expectedForOpening: jest.fn().mockResolvedValue(
        opts.previous === undefined ? null : opts.previous,
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const time = {
      now: () => ({ toISODate: () => '2026-09-09', toJSDate: () => new Date('2026-09-09T04:30:00Z') }),
    };
    const service = new ShiftsService(
      { create: (x: unknown) => x } as never,
      {} as never,
      audit as never,
      time as never,
      dataSource as never,
      cash as never,
    );
    return { service, saved, audit, cash };
  };

  const operator = {
    sub: 'u-op',
    username: 'op',
    role: UserRole.PointOperator,
    collection_point_id: 'p1',
  } as never;

  it("a point's FIRST count sets expected = counted, so the discrepancy is zero", async () => {
    const { service, saved } = build({ previous: null });
    await service.open(operator, { counted_amount: '47000.00' } as never);

    const countRow = saved.find((r) => 'counted_amount' in r)!;
    // The regression test for spec §3.2 — get this wrong and every point's
    // first day reports its whole drawer as a surplus.
    expect(countRow.counted_amount).toBe('47000.00');
    expect(countRow.expected_amount).toBe('47000.00');
    expect(countRow.kind).toBe('opening');
    expect(countRow.book).toBe('berry');
  });

  it("a later opening expects the previous close's COUNTED figure", async () => {
    const { service, saved } = build({ previous: '15066.10' });
    await service.open(operator, { counted_amount: '15066.10' } as never);
    const countRow = saved.find((r) => 'counted_amount' in r)!;
    expect(countRow.expected_amount).toBe('15066.10');
  });

  it('records a discrepancy without refusing', async () => {
    const { service, saved } = build({ previous: '15416.10' });
    const result = await service.open(operator, { counted_amount: '15066.10' } as never);
    const countRow = saved.find((r) => 'counted_amount' in r)!;
    expect(countRow.counted_amount).toBe('15066.10');
    expect(countRow.expected_amount).toBe('15416.10');
    expect(result.status).toBe(ShiftStatus.Open);
  });

  it('stamps the counter, not the shift opener', async () => {
    const { service, saved } = build({ previous: null });
    await service.open(operator, { counted_amount: '10.00' } as never);
    const countRow = saved.find((r) => 'counted_amount' in r)!;
    expect(countRow.counted_by_user_id).toBe('u-op');
  });

  it('writes a cash-count.recorded audit entry inside the transaction', async () => {
    const { service, audit } = build({ previous: null });
    await service.open(operator, { counted_amount: '10.00' } as never);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cash-count.recorded' }),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd backend && npx jest src/shifts/shifts.service.spec.ts
```

Expected: FAIL — `open` takes one argument and writes no count.

- [ ] **Step 4: Rewrite `open`**

Add `DataSource` and `PointCashService` as the fifth and sixth constructor parameters of `ShiftsService`, register `TypeOrmModule.forFeature([Shift, CashCount])` and `PointCashModule` in `shifts.module.ts`, then:

```ts
  /**
   * OPERATOR ONLY (§10.3) — unchanged. What is new is that opening a shift
   * COUNTS THE DRAWER, in the same transaction (spec §6.1).
   *
   * THE FIRST COUNT AT A POINT SETS `expected = counted`, and that is not a
   * fudge: the client's ruling is that the counted figure BECOMES the starting
   * balance, so at that instant the expectation genuinely is whatever is in
   * the drawer. It keeps `Σ (counted − expected)` — the point's accumulated
   * unexplained difference — correct with no special case, because the first
   * count contributes zero to it.
   *
   * A DISCREPANCY DOES NOT REFUSE. Client ruling of 09.09.2026, overruling
   * §7.7: «якщо каса не сходиться, це не блокує процес».
   */
  async open(actor: AuthenticatedUser, dto: OpenShiftDto): Promise<ShiftResponse> {
    const pointId = actor.collection_point_id;
    if (!pointId) {
      throw new ForbiddenException({
        message: 'No collection point assigned',
        code: 'NO_COLLECTION_POINT',
      });
    }

    const business_date = this.time.now().toISODate()!;
    const countedAt = this.time.now().toJSDate();

    return this.dataSource.transaction(async (m) => {
      let shift: Shift;
      try {
        shift = await m.save(
          Shift,
          this.repo.create({
            collection_point_id: pointId,
            opened_by_user_id: actor.sub,
            business_date,
            status: ShiftStatus.Open,
          }),
        );
      } catch (error) {
        throw this.translateUniqueViolation(error);
      }

      // `null` means this point has never been counted — see the header.
      const previous = await this.cash.expectedForOpening(pointId, m);
      const expected = previous ?? dto.counted_amount;

      const countRow = await m.save(CashCount, {
        shift_id: shift.id,
        book: CashBook.Berry,
        kind: CashCountKind.Opening,
        counted_amount: dto.counted_amount,
        expected_amount: expected,
        // §10.6 — whoever pressed the button, not whoever opened the shift.
        counted_by_user_id: actor.sub,
        counted_at: countedAt,
      });

      await this.audit.record(
        {
          action: 'shift.opened',
          actor_id: actor.sub,
          target_type: 'shift',
          target_id: shift.id,
          after: { collection_point_id: pointId, business_date },
        },
        m,
      );
      await this.audit.record(
        {
          action: 'cash-count.recorded',
          actor_id: actor.sub,
          target_type: 'cash_count',
          target_id: countRow.id,
          after: {
            shift_id: shift.id,
            kind: CashCountKind.Opening,
            counted_amount: dto.counted_amount,
            expected_amount: expected,
          },
        },
        m,
      );

      return toShiftResponse(shift);
    });
  }
```

Update the controller:

```ts
  @Post()
  @Auth(UserRole.PointOperator)
  open(@CurrentUser() actor: AuthenticatedUser, @Body() dto: OpenShiftDto) {
    return this.shifts.open(actor, dto);
  }
```

- [ ] **Step 5: Run to verify it passes**

```bash
cd backend && npx jest src/shifts && npm test
```

Expected: PASS.

- [ ] **Step 6: Lint and commit**

```bash
cd backend && npm run lint
git add backend/src/shifts backend/src/audit
git commit -m "$(cat <<'MSG'
feat(shifts): opening a shift counts the drawer

One transaction: the shift row and its opening count, or neither. "Must
be counted" is only true if it cannot be skipped — a separate endpoint
would let a shift exist with no opening count, leaving the closing
expectation with no anchor.

A point's FIRST count sets expected = counted, so its discrepancy is
zero by construction and it becomes the anchor. Get that wrong and every
point's first day reports its whole drawer as a surplus; there is a test
named for it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: `POST /shifts/:id/close` writes the closing count, and `reopen` demotes it

**Interfaces:**
- Consumes: `PointCashService.expectedForClosing(shiftId, manager?)`.
- Produces: `CloseShiftDto { counted_amount: string }`; `ShiftsService.close(actor, id, dto)`.

**Files:**
- Create: `backend/src/shifts/dto/close-shift.dto.ts`
- Modify: `backend/src/shifts/shifts.service.ts`, `shifts.controller.ts`, `shifts.service.spec.ts`

- [ ] **Step 1: Write the DTO**

`backend/src/shifts/dto/close-shift.dto.ts` — identical shape to `OpenShiftDto`, with its own header:

```ts
import { Matches } from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

/**
 * §6.1 — counting the drawer is PART of closing a shift.
 *
 * A DISCREPANCY DOES NOT REFUSE THE CLOSE. Client ruling of 09.09.2026, which
 * overrules §7.7 in full: «якщо каса не сходиться, це не блокує процес. Ми
 * йдемо далі за порахованою сумою, але повідомляємо керівника про розбіжність».
 * The shift closes, the discrepancy is recorded, and the owner is told —
 * `shift_status.awaiting_explanation` is never reached.
 *
 * The response carries the expectation and the discrepancy; nothing returns
 * them BEFORE this write (§6.2).
 */
export class CloseShiftDto {
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'counted_amount must be a non-negative decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  counted_amount: string;
}
```

- [ ] **Step 2: Write the failing tests**

```ts
describe('ShiftsService.close with a count', () => {
  const build = (opts: { expected?: string | null; shift?: Record<string, unknown> } = {}) => {
    const saved: Record<string, unknown>[] = [];
    const shiftRow = {
      id: 'sh-1',
      collection_point_id: 'p1',
      business_date: '2026-09-09',
      closed_at: null,
      status: ShiftStatus.Open,
      ...opts.shift,
    };
    const manager = {
      save: jest.fn((_e: unknown, x: Record<string, unknown>) => {
        saved.push(x);
        return { id: 'cc-1', ...x };
      }),
      findOne: jest.fn().mockResolvedValue(shiftRow),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const dataSource = { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)) };
    const cash = {
      expectedForClosing: jest
        .fn()
        .mockResolvedValue(opts.expected === undefined ? '15416.10' : opts.expected),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const time = {
      now: () => ({ toISODate: () => '2026-09-09', toJSDate: () => new Date('2026-09-09T17:55:00Z') }),
    };
    const repo = { findOne: jest.fn().mockResolvedValue(shiftRow), create: (x: unknown) => x };
    const service = new ShiftsService(
      repo as never,
      {} as never,
      audit as never,
      time as never,
      dataSource as never,
      cash as never,
    );
    return { service, saved, audit, manager };
  };

  const operator = {
    sub: 'u-op',
    username: 'op',
    role: UserRole.PointOperator,
    collection_point_id: 'p1',
  } as never;

  it('CLOSES DESPITE A DISCREPANCY — the ruling that overrules §7.7', async () => {
    const { service, saved } = build({ expected: '15416.10' });
    const result = await service.close(operator, 'sh-1', { counted_amount: '15066.10' } as never);

    expect(result.status).toBe(ShiftStatus.Closed);
    expect(result.status).not.toBe(ShiftStatus.AwaitingExplanation);
    const countRow = saved.find((r) => 'counted_amount' in r)!;
    expect(countRow.counted_amount).toBe('15066.10');
    expect(countRow.expected_amount).toBe('15416.10');
    expect(countRow.kind).toBe('closing');
  });

  it('closes cleanly when the count matches', async () => {
    const { service, saved } = build({ expected: '15416.10' });
    const result = await service.close(operator, 'sh-1', { counted_amount: '15416.10' } as never);
    expect(result.status).toBe(ShiftStatus.Closed);
    const countRow = saved.find((r) => 'counted_amount' in r)!;
    expect(countRow.counted_amount).toBe(countRow.expected_amount);
  });

  it('refuses a shift that is already closed', async () => {
    const { service } = build({ shift: { closed_at: new Date(), status: ShiftStatus.Closed } });
    await expect(
      service.close(operator, 'sh-1', { counted_amount: '1.00' } as never),
    ).rejects.toThrow(ConflictException);
  });
});

describe('ShiftsService.reopen demotes the closing count', () => {
  it("rewrites the closing count's kind to midday and preserves everything else", async () => {
    const updates: unknown[][] = [];
    const shiftRow = {
      id: 'sh-1',
      collection_point_id: 'p1',
      business_date: '2026-09-09',
      closed_at: new Date(),
      status: ShiftStatus.Closed,
    };
    const manager = {
      findOne: jest.fn().mockResolvedValue(shiftRow),
      save: jest.fn((_e: unknown, x: unknown) => x),
      update: jest.fn((...args: unknown[]) => {
        updates.push(args);
        return { affected: 1 };
      }),
    };
    const dataSource = { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)) };
    // `reopen` calls findOne THREE times with different intents: loadVisible,
    // findOpenAtPoint (which passes `closed_at: IsNull()`), and the
    // newest-shift check. A mock that returns the row for all three makes
    // findOpenAtPoint report an open shift and reopen throws
    // SHIFT_ALREADY_OPEN before reaching the demotion. Discriminate on the
    // where clause.
    const repo = {
      findOne: jest.fn((opts: { where?: Record<string, unknown> }) =>
        Promise.resolve(
          opts?.where && 'closed_at' in opts.where ? null : shiftRow,
        ),
      ),
      create: (x: unknown) => x,
    };
    const service = new ShiftsService(
      repo as never,
      {} as never,
      { record: jest.fn() } as never,
      { now: () => ({ toISODate: () => '2026-09-09', toJSDate: () => new Date() }) } as never,
      dataSource as never,
      {} as never,
    );
    const owner = {
      sub: 'u-owner',
      username: 'owner',
      role: UserRole.NetworkOwner,
      collection_point_id: null,
    } as never;

    await service.reopen(owner, 'sh-1', { reason: 'закрили помилково' } as never);

    // Only `kind` moves — counted_amount, expected_amount, counted_at and
    // counted_by_user_id are evidence and must survive (§6.3).
    const [, criteria, patch] = updates[0] as [unknown, unknown, Record<string, unknown>];
    expect(criteria).toMatchObject({ shift_id: 'sh-1', kind: 'closing' });
    expect(patch).toEqual({ kind: 'midday' });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd backend && npx jest src/shifts/shifts.service.spec.ts
```

Expected: FAIL — `close` takes two arguments; `reopen` issues no update.

- [ ] **Step 4: Rewrite `close` and extend `reopen`**

```ts
  /**
   * OPERATOR ONLY (§10.3), and it STAYS operator-only. §7.7 once made a
   * discrepancy the owner's business; the client's ruling of 09.09.2026
   * removed the blocking, and with it the only reason the owner was involved.
   *
   * A DISCREPANCY NEVER REFUSES. There is no branch here that compares counted
   * against expected and behaves differently — the comparison is the reader's,
   * not the writer's. `shift_status.awaiting_explanation` is unreachable BY
   * DECISION; see the enum's comment.
   *
   * STILL DOES NOT READ `business_date`, which is what makes the forgotten-close
   * path work: Friday's shift closed on Saturday morning, no special case. The
   * cost is named in the spec's §9.1 — a transfer accepted into that shift on
   * Saturday takes Friday's date.
   */
  async close(
    actor: AuthenticatedUser,
    id: string,
    dto: CloseShiftDto,
  ): Promise<ShiftResponse> {
    const shift = await this.loadVisible(actor, id);
    if (shift.closed_at) {
      throw new ConflictException({
        message: 'That shift is already closed',
        code: 'SHIFT_ALREADY_CLOSED',
      });
    }

    const closedAt = this.time.now().toJSDate();

    return this.dataSource.transaction(async (m) => {
      // `null` only if something wrote a shift without going through `open`.
      const expected = (await this.cash.expectedForClosing(shift.id, m)) ?? dto.counted_amount;

      const countRow = await m.save(CashCount, {
        shift_id: shift.id,
        book: CashBook.Berry,
        kind: CashCountKind.Closing,
        counted_amount: dto.counted_amount,
        expected_amount: expected,
        counted_by_user_id: actor.sub,
        counted_at: closedAt,
      });

      shift.closed_at = closedAt;
      shift.closed_by_user_id = actor.sub;
      shift.status = ShiftStatus.Closed;
      const saved = await m.save(Shift, shift);

      await this.audit.record(
        {
          action: 'shift.closed',
          actor_id: actor.sub,
          target_type: 'shift',
          target_id: saved.id,
          after: { business_date: saved.business_date },
        },
        m,
      );
      await this.audit.record(
        {
          action: 'cash-count.recorded',
          actor_id: actor.sub,
          target_type: 'cash_count',
          target_id: countRow.id,
          after: {
            shift_id: saved.id,
            kind: CashCountKind.Closing,
            counted_amount: dto.counted_amount,
            expected_amount: expected,
          },
        },
        m,
      );

      return toShiftResponse(saved);
    });
  }
```

In `reopen`, wrap the existing body in `this.dataSource.transaction(async (m) => { … })` and add, immediately before saving the reopened shift:

```ts
      // §6.3 — THE CLOSING COUNT BECOMES A MIDDAY COUNT. Reopening needs a free
      // `closing` slot (UQ_cash_counts_shift_book_kind), and the 11:00 count
      // was never a close: it was a count, taken at 11:00, which is exactly
      // what `midday` means and why `midday` sits outside that index.
      //
      // This MUTATES a posted row's `kind`, which this codebase otherwise
      // refuses to do. The defence is the one that lets a shift be reopened
      // while an intake may only be voided: a count carries no code, no paper
      // twin and no supplier copy. The alternatives are destroying evidence
      // (§7.6 forbids it) or making every closing-count lookup an ordering
      // problem, where a bug returns a wrong cash figure instead of an error.
      // Everything except `kind` is preserved.
      await m.update(
        CashCount,
        { shift_id: shift.id, kind: CashCountKind.Closing },
        { kind: CashCountKind.Midday },
      );
```

Update the controller's `close` to take `@Body() dto: CloseShiftDto`.

- [ ] **Step 5: Run to verify it passes**

```bash
cd backend && npx jest src/shifts && npm test
```

- [ ] **Step 6: Commit**

```bash
cd backend && npm run lint
git add backend/src/shifts
git commit -m "$(cat <<'MSG'
feat(shifts): closing counts the drawer, and reopening demotes that count

Closing writes its count in the same transaction and NEVER refuses on a
discrepancy — there is no branch here comparing counted against
expected, because the comparison belongs to the reader. The client's
ruling of 09.09.2026 overrules §7.7, and awaiting_explanation stays
unreachable by decision.

Reopening rewrites the closing count's kind to midday so the second
close has a free slot under the partial unique index. That mutates a
posted row, which this codebase otherwise refuses; the alternatives were
destroying evidence or making every closing-count lookup an ordering
problem where a bug returns a wrong number instead of an error.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: The owner's explanation, and `GET /cash-counts`

**Interfaces:**
- Produces: `SetExplanationDto { explanation: string }`; `ShiftsService.setExplanation(actor, id, dto)`; `CashCountsService.list(actor, query)` → `Paginated<CashCountRowResponse>`.

**Files:**
- Create: `backend/src/shifts/dto/set-explanation.dto.ts`
- Create: `backend/src/cash-counts/cash-count.mapper.ts`, `cash-counts.service.ts`, `cash-counts.controller.ts`, `cash-counts.module.ts`, `dto/list-cash-counts.query.ts`, `cash-counts.service.spec.ts`
- Modify: `backend/src/shifts/shifts.service.ts`, `shifts.controller.ts`, `backend/src/app.module.ts`

- [ ] **Step 1: The explanation DTO and service method**

`backend/src/shifts/dto/set-explanation.dto.ts`:

```ts
import { IsString, Length, Matches } from 'class-validator';

/**
 * §7.7's surviving half. The client's ruling removed the GATE, not the
 * explanation: the shift closes freely, and the owner writes down what the
 * discrepancy turned out to be whenever they find out.
 *
 * EXPLAINING IS NOT CORRECTING. «Розбіжність у документі лишається, її не
 * підганяють» — no number moves, and the point's accumulated
 * `Σ (counted − expected)` still includes explained incidents. An explanation
 * changes what is OPEN, never what is TRUE.
 *
 * ONE PER SHIFT, not per count. A shift whose opening and closing counts are
 * both off for different reasons shares this field; the shift is the unit an
 * owner investigates.
 */
export class SetExplanationDto {
  @IsString()
  @Length(1, 2000)
  @Matches(/\S/, { message: 'explanation must not be blank' })
  explanation: string;
}
```

In `ShiftsService`:

```ts
  /**
   * OWNER ONLY (§10.2 — corrections and judgements belong to the owner).
   * Idempotent: re-sending replaces the text.
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
    const shift = await this.loadVisible(actor, id);
    const before = { explanation: shift.explanation };
    shift.explanation = dto.explanation.trim();
    const saved = await this.repo.save(shift);

    await this.audit.record({
      action: 'shift.explained',
      actor_id: actor.sub,
      target_type: 'shift',
      target_id: saved.id,
      before,
      after: { explanation: saved.explanation },
    });

    return toShiftResponse(saved);
  }
```

Controller:

```ts
  @Put(':id/explanation')
  @Auth(UserRole.NetworkOwner)
  setExplanation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetExplanationDto,
  ) {
    return this.shifts.setExplanation(actor, id, dto);
  }
```

`toShiftResponse` must include `explanation` — check `shift.mapper.ts` and add the field if absent.

- [ ] **Step 2: The mapper and query DTO**

`backend/src/cash-counts/cash-count.mapper.ts`:

```ts
import { sub } from '../common/money';
import { CashBook } from './cash-book.enum';
import { CashCountKind } from './cash-count-kind.enum';

/** The raw projection — every numeric already `::text`. */
export interface CashCountRow {
  id: string;
  shift_id: string;
  collection_point_id: string;
  business_date: string;
  book: CashBook;
  kind: CashCountKind;
  counted_amount: string;
  expected_amount: string;
  counted_by_user_id: string;
  counted_at: Date;
  explanation: string | null;
}

/**
 * One line of the owner's incident list.
 *
 * `discrepancy` IS COMPUTED AND STORED NOWHERE — `counted − expected`, through
 * `common/money.ts` rather than a bare `-` on the decimal strings (§5.1).
 * There is no input field for it in any role and there are no thresholds
 * (§7.7): a kopiyka out is the same kind of event as 350 ₴ out.
 *
 * THE SIGN: positive is a SURPLUS (more in the drawer than expected), negative
 * is a SHORTAGE. This is the OPPOSITE convention from a transfer's
 * `cash_discrepancy`, where positive means a shortage — and the difference is
 * not sloppiness. A transfer's discrepancy asks «how much did we NOT get», a
 * count's asks «what is in the drawer, relative to what should be». Both read
 * naturally in their own screen and neither can be flipped without making the
 * other read backwards.
 *
 * `is_open` — a discrepancy on a shift with no explanation. This is the
 * owner's working list, and it shrinks as it is worked (§6.5).
 */
export interface CashCountRowResponse {
  id: string;
  shift_id: string;
  collection_point_id: string;
  business_date: string;
  book: CashBook;
  kind: CashCountKind;
  counted_amount: string;
  expected_amount: string;
  discrepancy: string;
  is_open: boolean;
  counted_by_user_id: string;
  counted_at: Date;
  explanation: string | null;
}

export function toCashCountRowResponse(row: CashCountRow): CashCountRowResponse {
  const discrepancy = sub(row.counted_amount, row.expected_amount);
  return {
    id: row.id,
    shift_id: row.shift_id,
    collection_point_id: row.collection_point_id,
    business_date: row.business_date,
    book: row.book,
    kind: row.kind,
    counted_amount: row.counted_amount,
    expected_amount: row.expected_amount,
    discrepancy,
    is_open: discrepancy !== '0.00' && (row.explanation === null || row.explanation === ''),
    counted_by_user_id: row.counted_by_user_id,
    counted_at: row.counted_at,
    explanation: row.explanation,
  };
}
```

`backend/src/cash-counts/dto/list-cash-counts.query.ts`:

```ts
import { IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ListCashCountsQueryDto extends PaginationQueryDto {
  /** Ignored for an operator, who is pinned to their own point. */
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsOptional()
  @IsUUID()
  shift_id?: string;

  /** Inclusive bounds on the shift's business date. */
  @IsOptional()
  @Matches(ISO_DATE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  /** The owner's working list: counts that disagree AND have no explanation. */
  @BooleanQueryParam()
  only_discrepancies: boolean = false;
}
```

- [ ] **Step 3: Write the failing service spec**

`backend/src/cash-counts/cash-counts.service.spec.ts`:

```ts
import { toCashCountRowResponse, type CashCountRow } from './cash-count.mapper';
import { CashBook } from './cash-book.enum';
import { CashCountKind } from './cash-count-kind.enum';

const row = (over: Partial<CashCountRow> = {}): CashCountRow => ({
  id: 'cc-1',
  shift_id: 'sh-1',
  collection_point_id: 'p1',
  business_date: '2026-09-09',
  book: CashBook.Berry,
  kind: CashCountKind.Closing,
  counted_amount: '15066.10',
  expected_amount: '15416.10',
  counted_by_user_id: 'u-op',
  counted_at: new Date('2026-09-09T17:55:00Z'),
  explanation: null,
  ...over,
});

describe('toCashCountRowResponse', () => {
  it('a shortage is NEGATIVE — the opposite of a transfer discrepancy, deliberately', () => {
    expect(toCashCountRowResponse(row()).discrepancy).toBe('-350.00');
  });

  it('a surplus is positive', () => {
    expect(
      toCashCountRowResponse(row({ counted_amount: '15766.10' })).discrepancy,
    ).toBe('350.00');
  });

  it('a matching count reads 0.00 and is not open', () => {
    const r = toCashCountRowResponse(row({ counted_amount: '15416.10' }));
    expect(r.discrepancy).toBe('0.00');
    expect(r.is_open).toBe(false);
  });

  it('a discrepancy with no explanation is OPEN', () => {
    expect(toCashCountRowResponse(row()).is_open).toBe(true);
  });

  it('an explained discrepancy is closed, and its numbers do not move', () => {
    const r = toCashCountRowResponse(row({ explanation: 'касир помилився решткою' }));
    expect(r.is_open).toBe(false);
    // §7.7 — «розбіжність у документі лишається, її не підганяють».
    expect(r.discrepancy).toBe('-350.00');
    expect(r.counted_amount).toBe('15066.10');
  });
});
```

- [ ] **Step 4: Run to verify it fails, then write the service, controller and module**

```bash
cd backend && npx jest src/cash-counts
```

Expected: FAIL — module not found.

`cash-counts.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ListCashCountsQueryDto } from './dto/list-cash-counts.query';
import {
  CashCountRow,
  CashCountRowResponse,
  toCashCountRowResponse,
} from './cash-count.mapper';
import { resolvePointFilter } from '../auth/access/point-scope';
import { Paginated } from '../common/dto/paginated';
import { skipOf } from '../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * READ ONLY, AND THAT IS THE WHOLE MODULE. Counts are WRITTEN by `shifts`,
 * inside the open and close transactions (§6.1), because a count that could be
 * written on its own is a count that could be skipped.
 *
 * THIS IS WHAT «NOTIFY THE OWNER» MEANS in this project: there is no email, no
 * push and no notification centre, so a notification is a read the owner's
 * screen performs. `only_discrepancies=true` is the working list.
 */
@Injectable()
export class CashCountsService {
  constructor(private readonly dataSource: DataSource) {}

  async list(
    actor: AuthenticatedUser,
    query: ListCashCountsQueryDto,
  ): Promise<Paginated<CashCountRowResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id) ?? null;
    const m = this.dataSource.manager;

    // Shared by the page and the count so the two cannot disagree about scope.
    // `only_discrepancies` filters in SQL on the two stored columns, so the
    // page size means what it says.
    const scope = `
        FROM cash_counts c
        JOIN shifts s ON s.id = c.shift_id
       WHERE ($1::uuid IS NULL OR s.collection_point_id = $1::uuid)
         AND ($2::uuid IS NULL OR c.shift_id = $2::uuid)
         AND ($3::date IS NULL OR s.business_date >= $3::date)
         AND ($4::date IS NULL OR s.business_date <= $4::date)
         AND (NOT $5::boolean
              OR (c.counted_amount <> c.expected_amount
                  AND (s.explanation IS NULL OR s.explanation = '')))`;

    const params = [
      pointId,
      query.shift_id ?? null,
      query.from ?? null,
      query.to ?? null,
      query.only_discrepancies,
    ];

    const rows = (await m.query(
      `SELECT c.id, c.shift_id, s.collection_point_id, s.business_date::text AS business_date,
              c.book, c.kind,
              c.counted_amount::text  AS counted_amount,
              c.expected_amount::text AS expected_amount,
              c.counted_by_user_id, c.counted_at, s.explanation
       ${scope}
        ORDER BY s.business_date DESC, c.counted_at DESC, c.id ASC
        LIMIT $6 OFFSET $7`,
      [...params, query.limit, skipOf(query)],
    )) as CashCountRow[];

    const [{ total }] = (await m.query(
      `SELECT COUNT(*)::int AS total ${scope}`,
      params,
    )) as { total: number }[];

    return {
      data: rows.map(toCashCountRowResponse),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
}
```

`cash-counts.controller.ts`:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CashCountsService } from './cash-counts.service';
import { ListCashCountsQueryDto } from './dto/list-cash-counts.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * §7.6's journal, and the owner's incident list.
 *
 * NO WRITE ROUTE EXISTS, deliberately — see the service's header. Both roles
 * read it; an operator is scoped to their own point server-side.
 */
@Controller('cash-counts')
export class CashCountsController {
  constructor(private readonly counts: CashCountsService) {}

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListCashCountsQueryDto) {
    return this.counts.list(actor, query);
  }
}
```

`cash-counts.module.ts` registers `TypeOrmModule.forFeature([CashCount])`, the service and the controller, and exports nothing. Register `CashCountsModule` in `app.module.ts` after `PointCashModule`.

- [ ] **Step 5: Run and commit**

```bash
cd backend && npx jest src/cash-counts src/shifts && npm run lint
git add backend/src
git commit -m "$(cat <<'MSG'
feat(cash-counts): the owner's incident list and the shift explanation

"Notify the owner" is a read in this project — there is no email, no
push and no notification centre — so GET /cash-counts?only_discrepancies
is the working list, filtered in SQL so the page size means what it says.

PUT /shifts/:id/explanation is §7.7's surviving half: the ruling removed
the gate, not the explanation. Explaining is not correcting — no number
moves, and the accumulated difference still includes explained
incidents; an explanation changes what is open, never what is true.

The count discrepancy's sign is deliberately OPPOSITE to a transfer's,
and the mapper says why: one asks what is in the drawer, the other how
much never arrived.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: `unexplained_difference` on the cash screen, and the docs

**Files:**
- Modify: `backend/src/point-cash/point-cash.service.ts`, `point-cash.mapper.ts`, `point-cash.db-spec.ts`
- Modify: `CLAUDE.md`, `backend/CLAUDE.md`

- [ ] **Step 1: Write the failing scenario**

Append to the `PointCashService.list` describe in `point-cash.db-spec.ts`:

```ts
  // NOTE: the `PointCashService.list` describe opens its OWN DataSource, so the
  // outer block's `shift`/`count`/`newPoint` helpers are not in scope here —
  // they close over a different connection. These fixtures are local on purpose.
  const localShift = async (pointId: string, businessDate: string): Promise<string> => {
    const [{ id }] = (await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date,
                           closed_at, closed_by_user_id, status)
       VALUES ($1, $2, $3, now(), $2, 'closed') RETURNING id`,
      [pointId, ownerId, businessDate],
    )) as { id: string }[];
    return id;
  };
  const localCount = (
    shiftId: string,
    kind: 'opening' | 'closing',
    counted: string,
    expected: string,
  ) =>
    ds.query(
      `INSERT INTO cash_counts (shift_id, book, kind, counted_amount, expected_amount,
                                counted_by_user_id, counted_at)
       VALUES ($1, 'berry', $2, $3, $4, $5, now())`,
      [shiftId, kind, counted, expected, ownerId],
    );

  it('unexplained_difference is Σ(counted − expected), and explaining does NOT change it', async () => {
    const tag = randomUUID().slice(0, 8);
    const [{ id: p }] = (await ds.query(
      `INSERT INTO collection_points (name, code, kind, target_cash, is_active)
       VALUES ($1, $2, 'reception', '500000.00', true) RETURNING id`,
      [`Точка ${tag}`, `D${tag.slice(0, 6).toUpperCase()}`],
    )) as { id: string }[];

    const s1 = await localShift(p, '2026-09-01');
    await localCount(s1, 'opening', '1000.00', '1000.00');
    await localCount(s1, 'closing', '990.00', '1000.00');   // −10
    const s2 = await localShift(p, '2026-09-02');
    await localCount(s2, 'opening', '990.00', '990.00');
    await localCount(s2, 'closing', '980.00', '990.00');    // −10
    await ds.query(`UPDATE shifts SET explanation = 'знайшли причину' WHERE id = $1`, [s2]);

    const page = await service.list(owner, query({ collection_point_id: p }) as never);
    // §6.5 — an explanation changes what is OPEN, never what is TRUE.
    expect(page.data[0].unexplained_difference).toBe('-20.00');
  });
```

- [ ] **Step 2: Run to verify it fails, then add the column**

In `point-cash.service.ts`'s `list`, add to the `scoped` CTE's select list:

```sql
                COALESCE((SELECT SUM(c.counted_amount - c.expected_amount)
                            FROM cash_counts c
                            JOIN shifts sh ON sh.id = c.shift_id
                           WHERE sh.collection_point_id = cp.id
                             AND c.book = 'berry'), 0.00) AS unexplained_difference
```

and project it `::text` in the outer select. Add the field to `PointCashRow` and `PointCashRowResponse` in the mapper with:

```ts
  /**
   * `Σ (counted − expected)` over every count at this point — how far the
   * drawer has drifted from what the documents say, since the first count.
   *
   * IT IS NOT A SECOND STORED LINE, and it never needed to be: the count chain
   * and the document line can differ by the recorded discrepancies and by
   * nothing else, so this sum IS the divergence (spec §3.1).
   *
   * EXPLAINED INCIDENTS ARE STILL IN IT. An explanation changes what is open,
   * never what is true — §7.7's «розбіжність у документі лишається».
   *
   * INCLUDES EVERY KIND, `midday` too: a midday count never ANCHORS the cash
   * figure (§8), but a discrepancy it recorded is still a discrepancy that
   * happened.
   */
  unexplained_difference: string;
```

- [ ] **Step 3: Update both CLAUDE.md files**

In `CLAUDE.md`'s Architecture → Domain bullet, add `cash_counts` to the implemented list and change the remaining count to **three**: `crate_issuances`, `crate_returns`, `crate_return_allocations`.

In `backend/CLAUDE.md`'s Structure block, add after `point-cash/`:

```
  cash-counts/            # the drawer, counted by a human (§7.6) — READ ONLY here; counts are WRITTEN inside the shift open/close transactions, because a count that can be written on its own can be skipped. `GET /cash-counts?only_discrepancies=true` is the owner's incident list, which is what «notify the owner» means in a project with no email and no push
```

and append `YagodaCashCounts` to the `migrations/` line. Update the `shifts/` line — it currently ends "No cash: `close` is a timestamp until cash_counts lands" — to:

```
  shifts/                 # one point's working day — the ONLY home of a document's point and business_date. Open/close are OPERATOR-only (§10.3) and each CARRIES A CASH COUNT in the same transaction; reopen is owner-only and demotes that shift's closing count to `midday`. A discrepancy never blocks a close (client ruling 09.09.2026), so `awaiting_explanation` is unreachable by decision; `explanation` is written by the owner AFTER the fact
```

- [ ] **Step 4: Run everything and commit**

```bash
cd /Users/glebvasilevskiy/Projects/webspirio/yagoda/web-starter
npm run lint && npm test && npm run test:db -w backend && npm run build
git add backend/src CLAUDE.md backend/CLAUDE.md
git commit -m "$(cat <<'MSG'
feat(point-cash): show each point's accumulated unexplained difference

Σ(counted − expected) over that point's counts — free, because the count
chain and the document line can differ by the recorded discrepancies and
by nothing else. Explained incidents stay in it: an explanation changes
what is open, never what is true.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: The frontend catches up

The entity slices and pages from the current session assume the previous model.

**THE FRONTEND IS STASHED. Start with `git stash pop`.** The controller stashed it before Task 1
so backend work ran against a clean tree; the stash message reads «frontend: transfers+point-cash
entities/pages, and CatalogPage refactor (pre cash-counts slice)». It also carries an unrelated
`CatalogPage.tsx` refactor belonging to the user — do not touch that file.

**Everything here stays uncommitted — keep it that way** unless the user says otherwise; commit
only if explicitly asked.

**Files:**
- Modify: `frontend/src/entities/shift/model/shift.ts`, `api/useShifts.ts`
- Modify: `frontend/src/entities/point-cash/model/point-cash.ts`
- Modify: `frontend/src/entities/transfer/api/useTransferActions.ts`
- Modify: `frontend/src/pages/day/ui/DayPage.tsx`, `frontend/src/pages/point-cash/ui/PointCashPage.tsx`, `frontend/src/pages/transfers/ui/TransfersPage.tsx`
- Modify: `frontend/src/shared/lib/i18n/locales/{uk,en}.json`

- [ ] **Step 1: Types and mutations**

Add to `entities/point-cash/model/point-cash.ts`'s `PointCashRow`:

```ts
  /**
   * `Σ (counted − expected)` since this point's first count. Negative means
   * the drawer has been short; positive, over. `'0.00'` means every count has
   * matched — not that no count exists.
   */
  unexplained_difference: string;
```

`entities/shift` gains the open/close bodies. Find the existing shift mutations (`pages/day` holds them today) and change their `mutationFn` signatures to take `{ counted_amount }`; add `explanation: string | null` to the `Shift` type.

- [ ] **Step 2: `DayPage` — counts on open and close**

The open and close buttons become dialogs asking for the counted amount, in the shape `pages/transfers`' `SendDialog` already uses (`Dialog` + `Field` render-prop + `TextInput` + `DialogFooter`). Copy that shape rather than inventing one. The close dialog's confirm shows the resulting discrepancy from the **response**, never before the write — §6.2, and a form that displayed the expected figure would make the count a confirmation click.

- [ ] **Step 3: `PointCashPage` — the incident column**

`PointCashPage` currently imports `{ sum, formatUah }` from `@/shared/lib/money` — add
`isNegative` to that import, or the column below will not compile. Add it after `shortfall`:

```tsx
    {
      id: 'drift',
      header: t('pointCash.col.drift'),
      cell: (r) =>
        r.unexplained_difference === '0.00' ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span
            className={
              isNegative(r.unexplained_difference) ? 'tabular-nums text-destructive' : 'tabular-nums'
            }
          >
            {formatUah(r.unexplained_difference, locale)}
          </span>
        ),
    },
```

- [ ] **Step 4: `TransfersPage` — accept and dispute need an open shift**

Both buttons must be disabled with an explanation when the point has no open shift, rather than letting the operator press them into a 409. `useCurrentShiftQuery(pointId)` already exists in `entities/shift`:

```tsx
  const { data: openShift } = useCurrentShiftQuery(pointId);
```

Gate the two buttons on `openShift !== null` and render `t('transfers.needsOpenShift')` beside them when it is null.

- [ ] **Step 5: Locale keys**

Add to both locale files: `day.countDialog.*` (title, amount, confirm, and a `discrepancy` line for the response), `pointCash.col.drift`, `transfers.needsOpenShift`. Ukrainian is the default and must read naturally; English is what tests render.

- [ ] **Step 6: Verify, and do NOT commit the frontend**

```bash
cd /Users/glebvasilevskiy/Projects/webspirio/yagoda/web-starter
npm run lint -w frontend
npx tsc --noEmit -p frontend/tsconfig.app.json
npm test -w frontend
npm run build -w frontend
```

All four must pass. Leave the frontend changes unstaged; report the file list.

---

## Follow-ups this plan creates

Record in `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` as the last act of Task 8:

1. **The crates drawer split** (spec §7) — blocking for the crates slice. One physical count must become two book figures and neither available answer works.
2. **A midday recount endpoint** (spec §6.3) if §7.6's «скільки завгодно разів» is wanted.
3. **A late close bends a transfer's date by one day** (spec §9.1) — operational, revisit if it bites.
4. **`Σ (counted − expected)` has no acknowledgement** other than a shift explanation, so a point with fifty explained incidents still shows their sum. Correct, but a future screen may want "unexplained only" separately.
5. **Historical shifts have no counts.** The seeded demo database's existing shifts predate this slice, so the first count at each of those points silently becomes its baseline. Correct behaviour, deliberately not backfilled — worth knowing before anyone reads the demo's cash figures.
