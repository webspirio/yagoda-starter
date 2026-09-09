# Transfers & Point Cash Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every collection point a defensible cash figure — build the `transfers` table (base → point money movement with its accept / dispute / resolve / void lifecycle) and the `point-cash` module that owns the berry cash-book formula.

**Architecture:** Two new Nest modules, backend only. `transfers` owns one table and five verbs, following the `payouts` module shape exactly (transaction + row lock + state check + save + audit). `point-cash` owns no table at all: it is one SQL formula with two call sites, in the shape `supplier-balance` established. Nothing is cached and no balance is ever stored.

**Tech Stack:** NestJS 11, TypeORM (`synchronize: false`, migrations run on boot), PostgreSQL, `class-validator` DTOs, Jest (unit `*.spec.ts`, database `*.db-spec.ts`).

**Spec:** `docs/superpowers/specs/2026-09-09-yagoda-transfers-cash-slice.md` — read it before Task 1. Every `§N.N` below without a file prefix points into that spec; `§7.9`-style references without a spec prefix point into `26-rules-by-example.md`.

## Global Constraints

- **All money is a `string`, end to end.** `numeric(12,2)` columns are strings in TypeScript, never numbers. No `Number()`, `parseFloat`, `parseInt`, `toFixed`, `*` or `/` on any monetary value — foundation spec §5.1.
- **`backend/eslint.config.mjs` enforces that**, but only inside a listed `files` glob. Task 3 adds `src/transfers/**/*.ts` and `src/point-cash/**/*.ts` to that list. Do not skip it.
- **`numeric` values are compared as strings**, so every one written by a DTO passes through `@CanonicalDecimal()` first — `'1.2'` and `'1.20'` must not be two values.
- **Money arithmetic in this slice happens in Postgres, not JavaScript.** `numeric` arithmetic in SQL is exact and `NULL` propagates for free. No call to `common/money.ts` is needed anywhere in this slice.
- **`::text` on every numeric projection**, so no value passes through the `pg` driver as a JS number.
- **Dates are server-derived.** `TimeService.now().toISODate()` gives the local calendar day in `APP_TIMEZONE`. No endpoint in this slice accepts a business date from a client.
- **A voided transfer keeps `status = 'accepted'`.** Every cash query filters `voided_at IS NULL` itself. This is the single easiest thing in the slice to get wrong.
- **Another point's row is a 404, not a 403** — matching `ShiftsService.loadVisible` and `SuppliersService`.
- Comments in this codebase explain *why*, at length, and name the rule (`§7.9`) they come from. Match that density; it is the house style, not decoration.
- Run before every commit: `npm run lint -w backend` and the focused test named in the task. Full `npm test -w backend`, `npm run test:db -w backend` and `npm run build -w backend` at the end of Task 8.
- Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

**Fixture columns, verified against the entities on 2026-09-09** — get these wrong and a database spec fails at setup, not at its assertion:

- `users` has **no `name` column**: it is `(first_name, last_name, role, is_active)`. `CHK_users_role_point` also requires `collection_point_id IS NULL` for a `network_owner`.
- `collection_points`: `(name, code, kind, target_cash, is_active)`; `code` must match `^[A-Z0-9]{2,8}$`.
- `shifts`: `(collection_point_id, opened_by_user_id, business_date, closed_at, closed_by_user_id, status)`. There is **no `opened_at`** — `created_at` is the open instant.
- `suppliers`: `(collection_point_id, first_name, last_name, kind, is_active)`.
- `payouts`: `(code, shift_id, supplier_id, amount, paid_by_user_id)` plus the optional `voided_*` / `return_settled_*` groups.

**Command reference** (run from `backend/`):

| What | Command |
|---|---|
| One unit spec | `npx jest src/transfers/transfers.service.spec.ts` |
| One unit test | `npx jest src/transfers/transfers.service.spec.ts -t 'refuses an operator'` |
| One database spec | `npm run test:db -- src/point-cash/point-cash.db-spec.ts` |
| All unit | `npm test -w backend` (from repo root) |
| All database | `npm run test:db -w backend` (from repo root) |

Database specs need Postgres up (`docker compose up -d postgres redis`) and run against `TEST_DB_NAME` (default `app_test`), never `DB_NAME`.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `backend/src/transfers/transfer-status.enum.ts` | The three-value enum. Nothing else. |
| `backend/src/transfers/transfer.entity.ts` | Columns, CHECKs, indexes, and the header explaining the void/status trap. |
| `backend/src/transfers/transfer.mapper.ts` | Wire shape + the computed discrepancy. |
| `backend/src/transfers/transfers.service.ts` | Five verbs + two reads. |
| `backend/src/transfers/transfers.controller.ts` | Routes and role guards. |
| `backend/src/transfers/transfers.module.ts` | Wiring. |
| `backend/src/transfers/dto/create-transfer.dto.ts` | |
| `backend/src/transfers/dto/dispute-transfer.dto.ts` | |
| `backend/src/transfers/dto/resolve-transfer.dto.ts` | |
| `backend/src/transfers/dto/list-transfers.query.ts` | |
| `backend/src/transfers/transfers.service.spec.ts` | Unit, mocked repositories. |
| `backend/src/migrations/transfers-schema.db-spec.ts` | Every CHECK rejects what it should. |
| `backend/src/point-cash/point-cash.service.ts` | **The formula, written once.** |
| `backend/src/point-cash/point-cash.mapper.ts` | Row → response. |
| `backend/src/point-cash/point-cash.controller.ts` | Two reads. |
| `backend/src/point-cash/point-cash.module.ts` | Exports `PointCashService` for slice 2. |
| `backend/src/point-cash/dto/list-point-cash.query.ts` | |
| `backend/src/point-cash/point-cash.db-spec.ts` | **Twelve formula scenarios against real Postgres.** |
| `backend/src/migrations/1788600000008-YagodaTransfers.ts` | One migration. |

**Modify:**

| File | Change |
|---|---|
| `26-rules-by-example.md` | Three dated amendments (Task 1). |
| `28-db-schema.dbml` | Two Note amendments (Task 1). |
| `backend/src/audit/audit-log.entity.ts` | Five new `AUDIT_ACTIONS` members. |
| `backend/src/app.module.ts` | Register `TransfersModule`, `PointCashModule`. |
| `backend/eslint.config.mjs` | Two new globs in the money-arithmetic `files` list. |
| `CLAUDE.md` | Architecture §Domain: move `transfers` from "remain" to "implemented". |

---

### Task 1: Amend the two source-of-truth documents

The client's rulings of 2026-09-09 overrule the written rules in four places. This lands **first**, so that everything after it is implementing documents that agree with it. §9 of the spec is the authority for this task.

Nothing is deleted; every amendment is a dated addition in the style both files already use, leaving the superseded text visible.

**Files:**
- Modify: `26-rules-by-example.md` (§7.9, §7.10)
- Modify: `28-db-schema.dbml` (`cash_counts` Note, `transfers` Note)

- [ ] **Step 1: Read the spec's §9 and both target sections**

```bash
sed -n '/^## 9. Amendments/,/^## 10\./p' docs/superpowers/specs/2026-09-09-yagoda-transfers-cash-slice.md
sed -n '/^## 7.9 Переказ база/,/^# Частина 8/p' 26-rules-by-example.md
```

- [ ] **Step 2: Append two notes to §7.9 of `26-rules-by-example.md`**

Insert immediately **after** the existing `→ **Примітка (схема, 03.09.2026 — закриває запитання 4)**` block and before the `## 7.10` heading:

```markdown
→ **Примітка (замовник, 09.09.2026 — закриває відкрите запитання цього ж §7.9).** Питання «як
фіксувати розбіжність» вище адресоване замовникові; замовник відповів 09.09.2026, і ця відповідь
СКАСОВУЄ крок 4б у частині «ці 140 000 у ЖОДНУ формулу не входять». Дослівно: гроші зараховуються
в касу точки в тій сумі, в якій їх ФАКТИЧНО отримали; недостача владнується поза системою;
завдання системи — показати керівникові, що проблема виникла. Механічно: поки спір не закритий,
у формулу каси входить `reported_cash`; після закриття — `resolved_cash`.

Чому саме так, щоб ніхто не повернув як було: каса відповідає на питання «скільки має бути в
шухляді». Якщо 140 000 фізично приїхали, викидати їх із формули означає, що очікувана каса цієї
точки хибна на 10 000 НА КОЖНОМУ наступному перерахунку — справжня розбіжність тоне у вічній
фальшивій. За рішенням замовника число шухляди правильне, борг мережі перед точкою (§7.10) усе
одно на 10 000 більший, бо ті гроші справді не доїхали, а самі 10 000 видно один раз — як
розбіжність на тому документі, де вона сталася.

→ **Примітка (09.09.2026).** ОБИДВІ дії точки — і «Прийняв», і «Не сходиться» — проставляють
ДЕНЬ ПРИЙНЯТТЯ. Вони фіксують один і той самий фізичний факт: гроші сьогодні приїхали на точку;
різниця між кнопками лише в тому, чи зійшлася сума. Без цього гілка `disputed` у формулі каси
(Note `cash_counts`) недосяжна взагалі, бо зовнішній фільтр тієї формули — `accepted_date <= D`.
```

- [ ] **Step 3: Append one note to §7.10 of `26-rules-by-example.md`**

Insert after the existing `→ **Примітка (схема, 03.09.2026)**` block, before the `---` that ends §7.10:

```markdown
→ **Примітка (09.09.2026).** Правило «точки без цільового значення в таблицю не потрапляють»
стосується КОЛОНКИ БОРГУ, а не всього екрана каси. На екрані каси така точка Є, і в колонці «не
вистачає» стоїть «—»: каса точки це факт незалежно від того, чи хтось задав наділ, невідомий
лише борг. Нуль там стверджував би, що мережа точці нічого не винна — той самий аргумент, яким
§6.9 вимагає «—» замість нуля для ящиків. У колонці боргу нуля як не було, так і немає.
```

- [ ] **Step 4: Amend the `cash_counts` Note in `28-db-schema.dbml`**

Replace the SQL block inside the `**Книга ягоди**` paragraph with the three-branch form, and append the paragraph explaining it:

```sql
+ Σ transfers, у яких accepted_date <= D і voided_at IS NULL:
      status = 'accepted'                              -> cash
      status = 'disputed' AND resolved_at IS NOT NULL  -> resolved_cash
      status = 'disputed' AND resolved_at IS NULL      -> reported_cash
- Σ payouts.amount, де payouts -> shifts дає цю точку і shifts.business_date <= D
      -- ВКЛЮЧНО ЗІ СТОРНОВАНИМИ
+ Σ payouts.amount, у яких (return_settled_at AT TIME ZONE <APP_TIMEZONE>)::date <= D
```

Then append, immediately after that block:

```markdown
**ТРЕТЯ ГІЛКА ДОДАНА 09.09.2026 ЗА РІШЕННЯМ ЗАМОВНИКА** і скасовує §7.9 крок 4б («ці 140 000 у
ЖОДНУ формулу не входять»). Гроші зараховуються в тій сумі, в якій фактично отримані; недостача
владнується поза системою. Наслідок, який тримає всю решту: disputed-переказ МАЄ `accepted_date`
(інакше зовнішній фільтр вбиває обидві disputed-гілки), тому інваріант у Note `transfers` про
«accepted_* рівно при status = accepted» виправлено там же.

**ЗСУВ ЧАСОВОГО ПОЯСУ В ОСТАННЬОМУ РЯДКУ НЕ ПРИКРАСА.** `return_settled_at` — це `timestamptz`,
який порівнюють із діловою ДАТОЮ; голий `::date` узяв би пояс сесії і зарахував би пізнє вечірнє
внесення наступним днем. Решта формули вже датована по-діловому.
```

- [ ] **Step 5: Amend the `transfers` Note in `28-db-schema.dbml`**

Append to the end of the existing Note string (before its closing quote):

```
ПРАВКА 09.09.2026 (рішення замовника), ДВІ ЧАСТИНИ. ПЕРША: інваріант «accepted_* заповнені рівно при status = accepted» ХИБНИЙ і виправлений — accepted_by_user_id / accepted_at / accepted_date проставляють ОБИДВІ дії точки, і «Прийняв», і «Не сходиться», бо обидві фіксують той самий фізичний факт «гроші сьогодні приїхали». Без цього гілка disputed у формулі Note cash_counts недосяжна: її зовнішній фільтр — accepted_date <= D. ДРУГА: речення «reported_* у формули не входять ніколи» СКАСОВАНЕ. Поки спір відкритий, у формулу каси входить reported_cash; після закриття — resolved_cash. Гроші зараховуються в тій сумі, в якій фактично отримані, а недостача владнується поза системою — див. §7.9, Примітка (замовник, 09.09.2026).
```

- [ ] **Step 6: Verify no other text still asserts the old rules**

```bash
grep -n "ЖОДНУ формулу\|у формули не входять\|рівно при status = accepted" 26-rules-by-example.md 28-db-schema.dbml
```

Expected: every hit is inside text that an adjacent amendment explicitly supersedes. If a hit has no amendment next to it, add one.

- [ ] **Step 7: Commit**

```bash
git add 26-rules-by-example.md 28-db-schema.dbml
git commit -m "$(cat <<'MSG'
docs: record the client's 09.09.2026 cash rulings in both source documents

§7.9 ended with «як фіксувати розбіжність — уточнити у замовника
системи». The client answered on 09.09.2026, and the answer overrules
step 4б: money is credited at the amount actually received and the
shortfall is settled outside the system.

Two mechanical consequences recorded with it: a disputed transfer must
carry accepted_date (or the formula's own disputed branch is dead code),
and a point with no target_cash appears on the cash screen with «—»
rather than vanishing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: The `transfers` table — migration, entity, schema tests

**Interfaces:**
- Consumes: nothing.
- Produces: `TransferStatus` enum (`Sent = 'sent' | Accepted = 'accepted' | Disputed = 'disputed'`), the `Transfer` entity class with columns listed in Step 3.

**Files:**
- Create: `backend/src/transfers/transfer-status.enum.ts`
- Create: `backend/src/transfers/transfer.entity.ts`
- Create: `backend/src/migrations/1788600000008-YagodaTransfers.ts`
- Create: `backend/src/migrations/transfers-schema.db-spec.ts`

- [ ] **Step 1: Write the failing schema spec**

Create `backend/src/migrations/transfers-schema.db-spec.ts`, modelled on `intakes-payouts-schema.db-spec.ts` (read it first for the harness idiom):

```ts
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/**
 * Every CHECK on `transfers` gets a row that would be legal without it. A
 * constraint nobody has watched reject anything is a constraint nobody knows
 * is there.
 */
describe('transfers schema (Postgres)', () => {
  let ds: DataSource;
  let pointId: string;
  let userId: string;

  const insert = (over: Record<string, unknown> = {}) => {
    const row = {
      collection_point_id: pointId,
      cash: '100.00',
      crates: 10,
      carrier: 'Іван, Ducato',
      sent_by_user_id: userId,
      sent_at: new Date(),
      status: 'sent',
      ...over,
    };
    const keys = Object.keys(row);
    return ds.query(
      `INSERT INTO transfers (${keys.map((k) => `"${k}"`).join(', ')})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      keys.map((k) => (row as Record<string, unknown>)[k]),
    );
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    const run = randomUUID().slice(0, 8);
    [{ id: pointId }] = await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`Точка ${run}`, `T${run.slice(0, 6).toUpperCase()}`],
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

  it('accepts an ordinary transfer', async () => {
    await expect(insert()).resolves.toHaveLength(1);
  });

  it('refuses negative cash', async () => {
    await expect(insert({ cash: '-1.00' })).rejects.toThrow(/CHK_transfers_cash_non_negative/);
  });

  it('refuses negative crates', async () => {
    await expect(insert({ crates: -1 })).rejects.toThrow(/CHK_transfers_crates_non_negative/);
  });

  it('refuses a transfer that moves nothing', async () => {
    await expect(insert({ cash: '0.00', crates: 0 })).rejects.toThrow(/CHK_transfers_not_empty/);
  });

  it('accepts a crates-only run and a cash-only run', async () => {
    await expect(insert({ cash: '0.00', crates: 200 })).resolves.toHaveLength(1);
    await expect(insert({ cash: '150000.00', crates: 0 })).resolves.toHaveLength(1);
  });

  it('refuses negative reported and resolved figures', async () => {
    await expect(insert({ status: 'disputed', reported_cash: '-5.00' })).rejects.toThrow(
      /CHK_transfers_reported_non_negative/,
    );
    await expect(insert({ status: 'disputed', resolved_cash: '-5.00' })).rejects.toThrow(
      /CHK_transfers_resolved_non_negative/,
    );
  });

  it('refuses a partial void trio', async () => {
    await expect(insert({ voided_at: new Date() })).rejects.toThrow(/CHK_transfers_void_trio/);
  });

  it('accepts a complete void trio', async () => {
    await expect(
      insert({ voided_at: new Date(), voided_by_user_id: userId, void_reason: 'дубль' }),
    ).resolves.toHaveLength(1);
  });

  it('has exactly three transfer_status values', async () => {
    const rows = (await ds.query(
      `SELECT unnest(enum_range(NULL::transfer_status))::text AS v ORDER BY v`,
    )) as { v: string }[];
    expect(rows.map((r) => r.v)).toEqual(['accepted', 'disputed', 'sent']);
  });

  it('has both indexes from the DBML', async () => {
    const rows = (await ds.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'transfers'`,
    )) as { indexname: string }[];
    const names = rows.map((r) => r.indexname);
    expect(names).toContain('IDX_transfers_point_accepted_date');
    expect(names).toContain('IDX_transfers_status');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd backend && npm run test:db -- src/migrations/transfers-schema.db-spec.ts
```

Expected: FAIL — `relation "transfers" does not exist`.

- [ ] **Step 3: Write the enum and the entity**

`backend/src/transfers/transfer-status.enum.ts`:

```ts
/**
 * THREE VALUES, AND A FOURTH MUST NEVER BE ADDED. `void` was removed on
 * 03.09.2026 because §9.3 requires a MANDATORY REASON for a void, which a
 * status cannot carry — voiding is the `void_*` trio instead.
 *
 * The consequence is the trap of this whole slice: a voided transfer keeps
 * `status = 'accepted'`, so every query about cash must filter
 * `voided_at IS NULL` for itself.
 *
 * `disputed` is TERMINAL. The owner closing a dispute fills `resolved_*` and
 * leaves the status alone — §7.7's «розбіжність у документі лишається, її не
 * підганяють». A settled dispute is still a dispute that happened.
 */
export enum TransferStatus {
  Sent = 'sent',
  Accepted = 'accepted',
  Disputed = 'disputed',
}
```

`backend/src/transfers/transfer.entity.ts`:

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
  UpdateDateColumn,
} from 'typeorm';
import { CollectionPoint } from '../collection-points/collection-point.entity';
import { User } from '../users/user.entity';
import { TransferStatus } from './transfer-status.enum';

/**
 * Money and empty crates travelling from the base to a point in one trip
 * (§7.9). The ONLY thing in §7.3's closed list that puts cash INTO a drawer.
 *
 * IT CARRIES ITS OWN POINT AND ITS OWN DATE, unlike `intakes` and `payouts`,
 * which store neither and learn both from `shift_id`. That is deliberate and
 * this module honours it: accepting a transfer requires NO OPEN SHIFT (spec
 * §6.4). The carrier arrives when they arrive — §7.9 has the point counting in
 * the morning, before the 07:30 shift opens — and forcing a shift open would
 * commit that day's business date merely to sign for a delivery.
 *
 * `accepted_date` IS STAMPED BY BOTH POINT ACTIONS, «Прийняв» AND «Не
 * сходиться» (spec §6.2, and the 09.09.2026 amendment to the `transfers` Note
 * in `28-db-schema.dbml`). Both record the same physical fact — the money
 * arrived here today — and differ only on whether the amount matched. The
 * DBML's original invariant said `accepted_*` are filled «рівно при status =
 * accepted`; that was written before the cash formula, whose outer filter is
 * `accepted_date <= D`, and under it the formula's own `disputed` branch is
 * unreachable dead code.
 *
 * WHAT ENTERS THE CASH FORMULA, by client ruling of 09.09.2026 which overrules
 * §7.9 step 4б: an accepted transfer contributes `cash`; a disputed one
 * contributes `resolved_cash` once the owner has closed the dispute and
 * `reported_cash` until then. The money is credited AT THE AMOUNT ACTUALLY
 * RECEIVED, and the shortfall is settled outside the system. Excluding it
 * would leave that point's expected cash wrong by the shortfall on every count
 * from then on, burying the real discrepancy under a permanent phantom one.
 *
 * `carrier` IS TEXT, NOT AN ACCOUNT. «Іван, Ducato» is who signs the paper
 * book. A trip is identified by its DATE and its CARRIER — §7.9 describes a
 * transfer completely and never mentions a trip number.
 *
 * NO `PATCH`. §9.3 — a correction is a NEW document pointing at the one it
 * corrects (`correction_of_transfer_id`), never a silent edit.
 */
@Entity('transfers')
@Check('CHK_transfers_cash_non_negative', `"cash" >= 0`)
@Check('CHK_transfers_crates_non_negative', `"crates" >= 0`)
@Check('CHK_transfers_not_empty', `"cash" > 0 OR "crates" > 0`)
@Check(
  'CHK_transfers_reported_non_negative',
  `("reported_cash" IS NULL OR "reported_cash" >= 0)
   AND ("reported_crates" IS NULL OR "reported_crates" >= 0)`,
)
@Check(
  'CHK_transfers_resolved_non_negative',
  `("resolved_cash" IS NULL OR "resolved_cash" >= 0)
   AND ("resolved_crates" IS NULL OR "resolved_crates" >= 0)`,
)
@Check(
  'CHK_transfers_void_trio',
  `num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3)`,
)
@Check('CHK_transfers_no_self_correction', `"correction_of_transfer_id" <> "id"`)
@Index('IDX_transfers_point_accepted_date', ['collection_point_id', 'accepted_date'])
@Index('IDX_transfers_status', ['status'])
export class Transfer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  collection_point_id: string;

  @ManyToOne(() => CollectionPoint, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'collection_point_id' })
  collection_point?: CollectionPoint;

  /** `numeric` — a STRING, never a number. */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  cash: string;

  @Column({ type: 'int' })
  crates: number;

  /** §7.9 — «без перевізника документ НЕ проводиться». */
  @Column({ type: 'varchar' })
  carrier: string;

  @Column({ type: 'uuid' })
  sent_by_user_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sent_by_user_id' })
  sent_by?: User;

  @Column({ type: 'timestamptz' })
  sent_at: Date;

  @Column({
    type: 'enum',
    enum: TransferStatus,
    enumName: 'transfer_status',
    default: TransferStatus.Sent,
  })
  status: TransferStatus;

  @Column({ type: 'uuid', nullable: true })
  accepted_by_user_id: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'accepted_by_user_id' })
  accepted_by?: User | null;

  /** THE DAY THE MONEY REACHED THE POINT, and what the cash formula filters
   *  on. Stamped by BOTH point actions — see this class's header. */
  @Column({ type: 'date', nullable: true })
  accepted_date: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  accepted_at: Date | null;

  /** What the point counted at «Не сходиться». Enters the cash formula while
   *  the dispute is open — the 09.09.2026 ruling; see this class's header. */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  reported_cash: string | null;

  @Column({ type: 'int', nullable: true })
  reported_crates: number | null;

  @Column({ type: 'text', nullable: true })
  dispute_note: string | null;

  /** The owner's final word, which supersedes `reported_*` once set. Status
   *  stays `disputed` forever. */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  resolved_cash: string | null;

  @Column({ type: 'int', nullable: true })
  resolved_crates: number | null;

  @Column({ type: 'uuid', nullable: true })
  resolved_by_user_id: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'resolved_by_user_id' })
  resolved_by?: User | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at: Date | null;

  /** §9.3 — a correction is a new document. Must name a transfer at the SAME
   *  point; the service checks that, because a cross-point correction would
   *  move money between drawers silently. */
  @Column({ type: 'uuid', nullable: true })
  correction_of_transfer_id: string | null;

  @ManyToOne(() => Transfer, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'correction_of_transfer_id' })
  correction_of?: Transfer | null;

  /** SEE THE ENUM'S HEADER: a voided transfer keeps `status = 'accepted'`. */
  @Column({ type: 'timestamptz', nullable: true })
  voided_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  voided_by_user_id: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'voided_by_user_id' })
  voided_by?: User | null;

  @Column({ type: 'text', nullable: true })
  void_reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
```

- [ ] **Step 4: Write the migration**

`backend/src/migrations/1788600000008-YagodaTransfers.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `transfers` — money and empty crates from the base to a point (§7.9). One
 * table, one enum, nothing else altered.
 *
 * FIVE THINGS IN HERE LOOK LIKE OMISSIONS AND ARE NOT. A later reader — or a
 * `migration:generate` run — will try to "fix" each one:
 *
 * 1. `transfer_status` has THREE values and must never gain a fourth. `void`
 *    was removed on 03.09.2026 because §9.3 requires a mandatory reason, which
 *    a status cannot carry.
 * 2. A voided transfer keeps `status = 'accepted'`. Every cash query filters
 *    `voided_at IS NULL` itself. This is not a bug and must not be "tidied".
 * 3. `accepted_*` are filled on DISPUTE as well as on accept (spec §6.2). The
 *    `transfers` Note in 28-db-schema.dbml originally said otherwise; it was
 *    amended on 09.09.2026, because under the old reading the cash formula's
 *    own `disputed` branch was unreachable.
 * 4. There is NO `shift_id` and there must not be one. Transfers are
 *    point-scoped by design, and accepting one requires no open shift (spec
 *    §6.4).
 * 5. There is NO stored balance, no cash-movement table and no opening-balance
 *    document. §7.3's list of what moves cash is closed and the figure is a
 *    formula (spec §6.5). A point's day-one balance is entered as an ordinary
 *    transfer (spec §6.6).
 *
 * NO CHECK ENFORCES THE accepted_* / reported_* / resolved_* STATE INVARIANTS,
 * and the DBML says why: «CHECK під це не написаний навмисно, бо стан
 * документа міняється в часі й проміжні комбінації існують». They live in the
 * service's guarded updates.
 */
export class YagodaTransfers1788600000008 implements MigrationInterface {
  name = 'YagodaTransfers1788600000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "transfer_status" AS ENUM ('sent', 'accepted', 'disputed')`,
    );

    await queryRunner.query(`
      CREATE TABLE "transfers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "collection_point_id" uuid NOT NULL,
        "cash" numeric(12,2) NOT NULL,
        "crates" integer NOT NULL,
        "carrier" character varying NOT NULL,
        "sent_by_user_id" uuid NOT NULL,
        "sent_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "status" "transfer_status" NOT NULL DEFAULT 'sent',
        "accepted_by_user_id" uuid,
        "accepted_date" date,
        "accepted_at" TIMESTAMP WITH TIME ZONE,
        "reported_cash" numeric(12,2),
        "reported_crates" integer,
        "dispute_note" text,
        "resolved_cash" numeric(12,2),
        "resolved_crates" integer,
        "resolved_by_user_id" uuid,
        "resolved_at" TIMESTAMP WITH TIME ZONE,
        "correction_of_transfer_id" uuid,
        "voided_at" TIMESTAMP WITH TIME ZONE,
        "voided_by_user_id" uuid,
        "void_reason" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_transfers" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_transfers_cash_non_negative" CHECK ("cash" >= 0),
        CONSTRAINT "CHK_transfers_crates_non_negative" CHECK ("crates" >= 0),
        CONSTRAINT "CHK_transfers_not_empty" CHECK ("cash" > 0 OR "crates" > 0),
        CONSTRAINT "CHK_transfers_reported_non_negative"
          CHECK (("reported_cash" IS NULL OR "reported_cash" >= 0)
             AND ("reported_crates" IS NULL OR "reported_crates" >= 0)),
        CONSTRAINT "CHK_transfers_resolved_non_negative"
          CHECK (("resolved_cash" IS NULL OR "resolved_cash" >= 0)
             AND ("resolved_crates" IS NULL OR "resolved_crates" >= 0)),
        CONSTRAINT "CHK_transfers_void_trio"
          CHECK (num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3)),
        CONSTRAINT "CHK_transfers_no_self_correction"
          CHECK ("correction_of_transfer_id" <> "id"),
        CONSTRAINT "FK_transfers_point" FOREIGN KEY ("collection_point_id")
          REFERENCES "collection_points"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_transfers_sent_by" FOREIGN KEY ("sent_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_transfers_accepted_by" FOREIGN KEY ("accepted_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_transfers_resolved_by" FOREIGN KEY ("resolved_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_transfers_voided_by" FOREIGN KEY ("voided_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_transfers_correction_of" FOREIGN KEY ("correction_of_transfer_id")
          REFERENCES "transfers"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_transfers_point_accepted_date"
         ON "transfers" ("collection_point_id", "accepted_date")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_transfers_status" ON "transfers" ("status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "transfers"`);
    await queryRunner.query(`DROP TYPE "transfer_status"`);
  }
}
```

- [ ] **Step 5: Register the entity and run the migration**

Add `Transfer` to the entity list in `backend/src/config/database.config.ts` or wherever `entities` is declared — check first:

```bash
cd backend && grep -rn "entities" src/app.module.ts src/config/*.ts src/data-source.ts | head
```

Follow whatever pattern is there (autoload via `TypeOrmModule.forFeature` or an explicit array). Then:

```bash
cd backend && npm run test:db -- src/migrations/transfers-schema.db-spec.ts
```

Expected: PASS, all 10 tests. Migrations run automatically when the harness opens the data source.

- [ ] **Step 6: Lint and commit**

```bash
cd backend && npm run lint
git add backend/src/transfers backend/src/migrations
git commit -m "$(cat <<'MSG'
feat(transfers): the transfers table, its enum and its constraints

One table, one three-value enum, nothing else altered. Seven CHECKs, each
with a database spec that watches it reject something.

The migration header names the five things a later reader will try to
"fix": the enum must not gain a fourth value, a voided transfer keeps
status = 'accepted', accepted_* are stamped on dispute too, there is no
shift_id, and there is no stored balance.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: Create a transfer — mapper, DTO, service, controller, wiring

**Interfaces:**
- Consumes: `Transfer`, `TransferStatus` (Task 2).
- Produces:
  - `toTransferResponse(t: Transfer): TransferResponse`
  - `TransfersService.create(actor: AuthenticatedUser, dto: CreateTransferDto): Promise<TransferResponse>`
  - `TransfersModule` exporting `TransfersService`

**Files:**
- Create: `backend/src/transfers/transfer.mapper.ts`, `dto/create-transfer.dto.ts`, `transfers.service.ts`, `transfers.controller.ts`, `transfers.module.ts`, `transfers.service.spec.ts`
- Modify: `backend/src/audit/audit-log.entity.ts`, `backend/src/app.module.ts`, `backend/eslint.config.mjs`

- [ ] **Step 1: Add the five audit actions**

In `backend/src/audit/audit-log.entity.ts`, append to `AUDIT_ACTIONS` after `'payout.return-settled'`:

```ts
  'transfer.created',
  'transfer.accepted',
  'transfer.disputed',
  'transfer.resolved',
  'transfer.voided',
```

- [ ] **Step 2: Extend the eslint money-arithmetic guard**

In `backend/eslint.config.mjs`, add two globs to the `files` array of the money block (the one whose comment begins "MONEY ARITHMETIC IS CONFINED TO"):

```js
    files: [
      'src/intakes/**/*.ts',
      'src/payouts/**/*.ts',
      'src/shifts/**/*.ts',
      'src/supplier-balance/**/*.ts',
      'src/transfers/**/*.ts',
      'src/point-cash/**/*.ts',
    ],
```

Add to that block's comment:

```js
    // `transfers` and `point-cash` join the list with the cash slice. Neither
    // does arithmetic in JavaScript today — the cash formula and the shortfall
    // are both computed in Postgres, where `numeric` is exact — and this guard
    // is what keeps it that way. `shortfall = target_cash - cash` written in
    // TypeScript is the exact shape §5.1 forbids, and it would look perfectly
    // reasonable in review.
```

- [ ] **Step 3: Write the mapper**

`backend/src/transfers/transfer.mapper.ts`:

```ts
import { Transfer } from './transfer.entity';
import { TransferStatus } from './transfer-status.enum';
import { sub } from '../common/money';

/**
 * THE DISCREPANCY IS COMPUTED HERE AND STORED NOWHERE, for the reason the
 * `cash_counts` Note gives about its own: «Розбіжність … НЕ зберігається; поля
 * вводу для неї немає в жодної ролі (§7.7)». A stored discrepancy is a second
 * copy of a fact, and there are no thresholds — a hryvnia out is the same kind
 * of event as 350 out.
 *
 * THE SIGN IS FIXED AND MUST NOT BE FLIPPED. Positive is a SHORTAGE — less
 * arrived than the base declared, `150 000 − 140 000 = 10 000`. Negative is a
 * surplus. Ticket #20 asks for both directions («як недостачу, так і фактично
 * більшу суму»), so nothing clamps this. The opposite convention is equally
 * defensible, which is exactly why it is pinned down here rather than left to
 * each reader's instinct.
 *
 * The subtraction goes through `common/money.ts`, never through a bare `-` on
 * the decimal strings — foundation §5.1.
 */
export interface TransferResponse {
  id: string;
  collection_point_id: string;
  cash: string;
  crates: number;
  carrier: string;
  sent_by_user_id: string;
  sent_at: Date;
  status: TransferStatus;
  accepted_by_user_id: string | null;
  accepted_date: string | null;
  accepted_at: Date | null;
  reported_cash: string | null;
  reported_crates: number | null;
  dispute_note: string | null;
  resolved_cash: string | null;
  resolved_crates: number | null;
  resolved_by_user_id: string | null;
  resolved_at: Date | null;
  /** `null` unless disputed. Positive = shortage. */
  cash_discrepancy: string | null;
  crates_discrepancy: number | null;
  correction_of_transfer_id: string | null;
  voided_at: Date | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  created_at: Date;
}

/**
 * `sub` FROM `common/money.ts` IS THE ARITHMETIC SEAM, and calling it is not a
 * violation of foundation §5.1 — it is what §5.1 exists to route money
 * through. It parses both strings to BigInt kopiykas, subtracts exactly, and
 * renders back to two decimals; `-` applied to the raw strings is what the
 * rule forbids.
 *
 * `crates` is an `int`, not money, so a plain `-` is correct there.
 */
export function toTransferResponse(t: Transfer): TransferResponse {
  const effective = t.resolved_cash ?? t.reported_cash;
  const effectiveCrates = t.resolved_crates ?? t.reported_crates;
  const disputed = t.status === TransferStatus.Disputed;
  return {
    id: t.id,
    collection_point_id: t.collection_point_id,
    cash: t.cash,
    crates: t.crates,
    carrier: t.carrier,
    sent_by_user_id: t.sent_by_user_id,
    sent_at: t.sent_at,
    status: t.status,
    accepted_by_user_id: t.accepted_by_user_id,
    accepted_date: t.accepted_date,
    accepted_at: t.accepted_at,
    reported_cash: t.reported_cash,
    reported_crates: t.reported_crates,
    dispute_note: t.dispute_note,
    resolved_cash: t.resolved_cash,
    resolved_crates: t.resolved_crates,
    resolved_by_user_id: t.resolved_by_user_id,
    resolved_at: t.resolved_at,
    cash_discrepancy: disputed && effective !== null ? sub(t.cash, effective) : null,
    crates_discrepancy:
      disputed && effectiveCrates !== null ? t.crates - effectiveCrates : null,
    correction_of_transfer_id: t.correction_of_transfer_id,
    voided_at: t.voided_at,
    voided_by_user_id: t.voided_by_user_id,
    void_reason: t.void_reason,
    created_at: t.created_at,
  };
}
```

- [ ] **Step 4: Write the create DTO**

`backend/src/transfers/dto/create-transfer.dto.ts`:

```ts
import { IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

/**
 * §7.9 step 1 — the owner creates the document. `carrier` is REQUIRED because
 * «без перевізника документ НЕ проводиться»: the carrier signs the paper book
 * and is half of a trip's identity, there being no trip number.
 *
 * `cash` and `crates` may each be zero — a crates-only run and a cash-only run
 * are both ordinary — but not both; `CHK_transfers_not_empty` refuses a
 * document that moves nothing.
 *
 * THE REGEX ADMITS NO SIGN. A transfer that takes money AWAY from a point is
 * not in §7.3's closed list, and a negative `cash` would be a back door to
 * exactly that.
 */
export class CreateTransferDto {
  @IsUUID()
  collection_point_id: string;

  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'cash must be a non-negative decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  cash: string;

  @IsInt()
  @Min(0)
  crates: number;

  @IsString()
  @Length(1, 200)
  carrier: string;

  /** §9.3 — a correction is a new document naming the one it corrects. The
   *  service checks it belongs to the same point. */
  @IsOptional()
  @IsUUID()
  correction_of_transfer_id?: string;
}
```

- [ ] **Step 5: Write the failing unit test**

`backend/src/transfers/transfers.service.spec.ts`:

```ts
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { TransferStatus } from './transfer-status.enum';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const owner: AuthenticatedUser = {
  sub: 'u-owner',
  username: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
};

const operatorA: AuthenticatedUser = {
  sub: 'u-op-a',
  username: 'opa',
  role: UserRole.PointOperator,
  collection_point_id: 'point-a',
};

describe('TransfersService.create', () => {
  const build = (over: Record<string, unknown> = {}) => {
    const repo = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn((x: Record<string, unknown>) => ({ id: 't-1', created_at: new Date(), ...x })),
      findOne: jest.fn().mockResolvedValue(null),
      ...(over.repo as object),
    };
    const points = {
      findOneRaw: jest.fn().mockResolvedValue({ id: 'point-a', is_active: true }),
      ...(over.points as object),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const time = { now: () => ({ toISODate: () => '2026-09-09', toJSDate: () => new Date() }) };
    const service = new TransfersService(
      repo as never,
      points as never,
      audit as never,
      time as never,
      { transaction: jest.fn() } as never,
    );
    return { service, repo, points, audit };
  };

  const dto = { collection_point_id: 'point-a', cash: '150000.00', crates: 200, carrier: 'Іван' };

  it('creates a transfer in the sent state', async () => {
    const { service, repo } = build();
    const result = await service.create(owner, dto as never);

    expect(result.status).toBe(TransferStatus.Sent);
    expect(result.accepted_date).toBeNull();
    expect(repo.save).toHaveBeenCalled();
  });

  it('refuses an operator — §7.9 step 1 puts creation with the owner', async () => {
    const { service } = build();
    await expect(service.create(operatorA, dto as never)).rejects.toThrow(ForbiddenException);
  });

  it('refuses an unknown point', async () => {
    const { service } = build({ points: { findOneRaw: jest.fn().mockResolvedValue(null) } });
    await expect(service.create(owner, dto as never)).rejects.toThrow(NotFoundException);
  });

  it('refuses a deactivated point', async () => {
    const { service } = build({
      points: { findOneRaw: jest.fn().mockResolvedValue({ id: 'point-a', is_active: false }) },
    });
    await expect(service.create(owner, dto as never)).rejects.toThrow(BadRequestException);
  });

  it('refuses a correction naming a transfer at another point', async () => {
    const { service } = build({
      repo: {
        findOne: jest.fn().mockResolvedValue({ id: 't-old', collection_point_id: 'point-b' }),
      },
    });
    await expect(
      service.create(owner, { ...dto, correction_of_transfer_id: 't-old' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('writes a transfer.created audit entry', async () => {
    const { service, audit } = build();
    await service.create(owner, dto as never);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'transfer.created', actor_id: 'u-owner' }),
    );
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

```bash
cd backend && npx jest src/transfers/transfers.service.spec.ts
```

Expected: FAIL — `Cannot find module './transfers.service'`.

- [ ] **Step 7: Write the service with `create` only**

`backend/src/transfers/transfers.service.ts`:

```ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Transfer } from './transfer.entity';
import { TransferStatus } from './transfer-status.enum';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransferResponse, toTransferResponse } from './transfer.mapper';
import { AuditService } from '../audit/audit.service';
import { CollectionPointsService } from '../collection-points/collection-points.service';
import { TimeService } from '../time/time.service';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * §7.9 — money and empty crates from the base to a point.
 *
 * THIS SERVICE DOES NOT INJECT `ShiftsService`, AND THAT IS THE RULE RATHER
 * THAN AN OMISSION. `transfers` is the only money document carrying its own
 * point and its own date; accepting one requires no open shift (spec §6.4).
 * The carrier arrives when they arrive.
 *
 * THE OWNER MAY NOT ACCEPT OR DISPUTE, which inverts this codebase's usual
 * shape where an owner may do anything an operator may. §7.9 step 3 with
 * §10.3: «Натиснути "Прийняв" може ТІЛЬКИ точка — керівник не може зробити це
 * за неї.» A signature under money must belong to whoever physically counted
 * it, and an owner pressing it from an office is a signature under money they
 * never touched.
 */
@Injectable()
export class TransfersService {
  constructor(
    @InjectRepository(Transfer)
    private readonly repo: Repository<Transfer>,
    private readonly points: CollectionPointsService,
    private readonly audit: AuditService,
    private readonly time: TimeService,
    private readonly dataSource: DataSource,
  ) {}

  /** §7.9 step 1 — OWNER ONLY. */
  async create(actor: AuthenticatedUser, dto: CreateTransferDto): Promise<TransferResponse> {
    if (actor.role !== UserRole.NetworkOwner) {
      throw new ForbiddenException({
        message: 'Only the network owner may send a transfer',
        code: 'OWNER_ONLY',
      });
    }

    const point = await this.points.findOneRaw(dto.collection_point_id);
    if (!point) throw new NotFoundException('Collection point not found');

    // THE ACTIVE CHECK BINDS `create` ONLY. A transfer already in flight to a
    // point deactivated since it was sent stays acceptable, resolvable and
    // voidable — the money physically travelled, and refusing the acceptance
    // would strand it in `sent` forever with no verb able to touch it. §5.6's
    // deactivation stops new business; it does not abandon open documents.
    if (!point.is_active) {
      throw new BadRequestException({
        message: 'That collection point is deactivated',
        code: 'POINT_INACTIVE',
      });
    }

    // `kind` IS DELIBERATELY NOT CHECKED. §7.3's «своєї каси в бази немає» is
    // about the SENDING side — creating a transfer debits no base account,
    // because the network's money comes from outside the system entirely. §4.8
    // makes the warehouse an ordinary intake point that buys berries and
    // therefore pays suppliers, and §7.3's own closed list makes an accepted
    // transfer the only way to refill any drawer. Refusing on `kind` would
    // block that point's only cash source, and the failure would surface as an
    // unexplainable growing shortage rather than as an error. Spec §8.3.

    if (dto.correction_of_transfer_id) {
      const original = await this.repo.findOne({
        where: { id: dto.correction_of_transfer_id },
      });
      if (!original) throw new NotFoundException('The transfer being corrected was not found');
      // A correction pointing at another point's document would silently move
      // money between drawers — the one cross-point write this table permits
      // by shape and must not permit in fact.
      if (original.collection_point_id !== dto.collection_point_id) {
        throw new BadRequestException({
          message: 'A correction must name a transfer at the same collection point',
          code: 'CORRECTION_POINT_MISMATCH',
        });
      }
    }

    const transfer = await this.repo.save(
      this.repo.create({
        collection_point_id: dto.collection_point_id,
        cash: dto.cash,
        crates: dto.crates,
        carrier: dto.carrier.trim(),
        sent_by_user_id: actor.sub,
        sent_at: this.time.now().toJSDate(),
        status: TransferStatus.Sent,
        correction_of_transfer_id: dto.correction_of_transfer_id ?? null,
      }),
    );

    await this.audit.record({
      action: 'transfer.created',
      actor_id: actor.sub,
      target_type: 'transfer',
      target_id: transfer.id,
      after: {
        collection_point_id: transfer.collection_point_id,
        cash: transfer.cash,
        crates: transfer.crates,
        carrier: transfer.carrier,
      },
    });

    return toTransferResponse(transfer);
  }
}
```

If `CollectionPointsService` has no `findOneRaw`, check its actual read method name and use that:

```bash
cd backend && grep -n "async \(findOne\|findOneRaw\|findById\)" src/collection-points/collection-points.service.ts
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
cd backend && npx jest src/transfers/transfers.service.spec.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 9: Write the controller and module**

`backend/src/transfers/transfers.controller.ts`:

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TransfersService } from './transfers.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * §7.9 — the base→point transfer.
 *
 * ROLE AUTHORITY IS SPLIT BETWEEN THE GUARD AND THE SERVICE, on the codebase's
 * usual line: a guard decides from the request, an `assert*` decides from the
 * row. `create` is owner-only from the request alone; accept and dispute need
 * to know WHICH point's transfer this is, so they carry `@Auth()` here and
 * refuse in the service.
 *
 * No `PATCH`, no `DELETE` — §9.3 and §10.4.
 */
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Post()
  @Auth(UserRole.NetworkOwner)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateTransferDto) {
    return this.transfers.create(actor, dto);
  }
}
```

`backend/src/transfers/transfers.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transfer } from './transfer.entity';
import { TransfersService } from './transfers.service';
import { TransfersController } from './transfers.controller';
import { CollectionPointsModule } from '../collection-points/collection-points.module';
import { AuditModule } from '../audit/audit.module';
import { TimeModule } from '../time/time.module';

/**
 * NO `ShiftsModule` IMPORT, deliberately — spec §6.4. A transfer is
 * point-scoped and its acceptance needs no open shift.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Transfer]), CollectionPointsModule, AuditModule, TimeModule],
  providers: [TransfersService],
  controllers: [TransfersController],
  exports: [TransfersService],
})
export class TransfersModule {}
```

Register `TransfersModule` in `backend/src/app.module.ts`, after `PayoutsModule`.

- [ ] **Step 10: Lint, run the full unit suite, commit**

```bash
cd backend && npm run lint && npm test
git add backend/src backend/eslint.config.mjs
git commit -m "$(cat <<'MSG'
feat(transfers): create a transfer, owner only

§7.9 step 1. The point must exist and be active — but that check binds
create alone: a transfer already in flight to a since-deactivated point
stays acceptable, or it strands in `sent` with no verb able to touch it.

`kind` is deliberately not checked, and the service says why at length:
§7.3's «своєї каси в бази немає» is about the sending side, while §4.8
makes the warehouse an ordinary point that buys berries and so needs a
drawer to refill.

Adds src/transfers and src/point-cash to the eslint money-arithmetic
guard before either can grow a `-` on a numeric.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: The point's two actions — accept and dispute

**Interfaces:**
- Consumes: `TransfersService` (Task 3).
- Produces:
  - `TransfersService.accept(actor, id): Promise<TransferResponse>`
  - `TransfersService.dispute(actor, id, dto: DisputeTransferDto): Promise<TransferResponse>`
  - `TransfersService.loadForWrite(id, manager): Promise<Transfer>` (private)

**Files:**
- Create: `backend/src/transfers/dto/dispute-transfer.dto.ts`
- Modify: `backend/src/transfers/transfers.service.ts`, `transfers.controller.ts`, `transfers.service.spec.ts`

- [ ] **Step 1: Write the dispute DTO**

`backend/src/transfers/dto/dispute-transfer.dto.ts`:

```ts
import { IsInt, IsString, Length, Matches, Min } from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

/**
 * §7.9 step 4б — «Не сходиться»: the point writes what it actually counted and
 * a comment.
 *
 * THE NOTE IS MANDATORY. §7.9 has the point writing a number AND a comment,
 * and the comment is the entire reason this document reaches the owner at all.
 * A dispute with no explanation is a number the owner cannot act on.
 *
 * BY THE CLIENT'S RULING OF 09.09.2026 these figures ENTER THE CASH FORMULA
 * while the dispute is open, overruling §7.9's «у ЖОДНУ формулу не входять».
 * The money is credited at the amount actually received; the shortfall is
 * settled outside the system. See `transfer.entity.ts`'s header.
 */
export class DisputeTransferDto {
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'reported_cash must be a non-negative decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  reported_cash: string;

  @IsInt()
  @Min(0)
  reported_crates: number;

  @IsString()
  @Length(1, 500)
  dispute_note: string;
}
```

- [ ] **Step 2: Write the failing tests**

Append to `backend/src/transfers/transfers.service.spec.ts`:

```ts
describe('TransfersService.accept / dispute', () => {
  const sentTransfer = () => ({
    id: 't-1',
    collection_point_id: 'point-a',
    cash: '150000.00',
    crates: 200,
    carrier: 'Іван',
    status: TransferStatus.Sent,
    accepted_by_user_id: null,
    accepted_date: null,
    accepted_at: null,
    reported_cash: null,
    reported_crates: null,
    dispute_note: null,
    resolved_cash: null,
    resolved_crates: null,
    resolved_by_user_id: null,
    resolved_at: null,
    correction_of_transfer_id: null,
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    sent_by_user_id: 'u-owner',
    sent_at: new Date(),
    created_at: new Date(),
  });

  const build = (row: Record<string, unknown> | null = sentTransfer()) => {
    const saved: Record<string, unknown>[] = [];
    const manager = {
      findOne: jest.fn().mockResolvedValue(row),
      save: jest.fn((_e: unknown, x: Record<string, unknown>) => {
        saved.push(x);
        return x;
      }),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const dataSource = {
      transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
    };
    const time = {
      now: () => ({ toISODate: () => '2026-09-09', toJSDate: () => new Date('2026-09-09T06:00:00Z') }),
    };
    const service = new TransfersService(
      {} as never,
      {} as never,
      audit as never,
      time as never,
      dataSource as never,
    );
    return { service, audit, saved, manager };
  };

  it('accept stamps all three accepted_* fields and the accepted status', async () => {
    const { service, saved } = build();
    await service.accept(operatorA, 't-1');

    expect(saved[0]).toMatchObject({
      status: TransferStatus.Accepted,
      accepted_by_user_id: 'u-op-a',
      accepted_date: '2026-09-09',
    });
    expect(saved[0].accepted_at).toBeInstanceOf(Date);
  });

  it('REFUSES THE OWNER — §7.9 with §10.3, only the point may press Прийняв', async () => {
    const { service } = build();
    await expect(service.accept(owner, 't-1')).rejects.toThrow(ForbiddenException);
    await expect(
      service.dispute(owner, 't-1', {
        reported_cash: '140000.00',
        reported_crates: 200,
        dispute_note: 'мішок легший',
      } as never),
    ).rejects.toThrow(ForbiddenException);
  });

  it("is a 404 for another point's transfer", async () => {
    const { service } = build({ ...sentTransfer(), collection_point_id: 'point-b' });
    await expect(service.accept(operatorA, 't-1')).rejects.toThrow(NotFoundException);
  });

  it('dispute stamps accepted_* AS WELL AS reported_* — spec §6.2', async () => {
    const { service, saved } = build();
    await service.dispute(operatorA, 't-1', {
      reported_cash: '140000.00',
      reported_crates: 195,
      dispute_note: 'мішок легший',
    } as never);

    expect(saved[0]).toMatchObject({
      status: TransferStatus.Disputed,
      // The whole ruling in one assertion: without accepted_date the cash
      // formula's disputed branch is unreachable.
      accepted_date: '2026-09-09',
      accepted_by_user_id: 'u-op-a',
      reported_cash: '140000.00',
      reported_crates: 195,
      dispute_note: 'мішок легший',
    });
  });

  it('refuses to accept a transfer that is not sent', async () => {
    const { service } = build({ ...sentTransfer(), status: TransferStatus.Accepted });
    await expect(service.accept(operatorA, 't-1')).rejects.toThrow(ConflictException);
  });

  it('refuses to accept a voided transfer', async () => {
    const { service } = build({ ...sentTransfer(), voided_at: new Date() });
    await expect(service.accept(operatorA, 't-1')).rejects.toThrow(ConflictException);
  });

  it('writes transfer.accepted and transfer.disputed audit entries', async () => {
    const a = build();
    await a.service.accept(operatorA, 't-1');
    expect(a.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'transfer.accepted' }),
      expect.anything(),
    );

    const d = build();
    await d.service.dispute(operatorA, 't-1', {
      reported_cash: '140000.00',
      reported_crates: 195,
      dispute_note: 'мішок легший',
    } as never);
    expect(d.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'transfer.disputed' }),
      expect.anything(),
    );
  });
});
```

Add `ConflictException` to the `@nestjs/common` import at the top of the spec.

- [ ] **Step 3: Run to verify it fails**

```bash
cd backend && npx jest src/transfers/transfers.service.spec.ts
```

Expected: FAIL — `service.accept is not a function`.

- [ ] **Step 4: Implement `loadForWrite`, `accept` and `dispute`**

Add to `TransfersService` (and add `ConflictException` to the `@nestjs/common` import):

```ts
  /**
   * §7.9 step 4а — «Прийняв». OPERATOR AT THAT POINT ONLY.
   *
   * No body, and that is a rule: §7.9 gives the point «рівно дві дії» and
   * «поля суми в точки НЕМАЄ». A point that could type a number here would
   * never press the other button, and the dispute record — the only thing that
   * reaches the owner — would never be written.
   */
  async accept(actor: AuthenticatedUser, id: string): Promise<TransferResponse> {
    return this.transition(actor, id, 'transfer.accepted', (transfer, now, today) => {
      transfer.status = TransferStatus.Accepted;
      this.stampArrival(transfer, actor, now, today);
      return { after: { status: TransferStatus.Accepted, accepted_date: today }, note: null };
    });
  }

  /**
   * §7.9 step 4б — «Не сходиться». OPERATOR AT THAT POINT ONLY.
   */
  async dispute(
    actor: AuthenticatedUser,
    id: string,
    dto: DisputeTransferDto,
  ): Promise<TransferResponse> {
    return this.transition(actor, id, 'transfer.disputed', (transfer, now, today) => {
      transfer.status = TransferStatus.Disputed;
      this.stampArrival(transfer, actor, now, today);
      transfer.reported_cash = dto.reported_cash;
      transfer.reported_crates = dto.reported_crates;
      transfer.dispute_note = dto.dispute_note.trim();
      return {
        after: {
          status: TransferStatus.Disputed,
          accepted_date: today,
          reported_cash: dto.reported_cash,
          reported_crates: dto.reported_crates,
        },
        note: dto.dispute_note,
      };
    });
  }

  /**
   * BOTH POINT ACTIONS STAMP THE ARRIVAL, and this shared helper is what makes
   * that visible rather than a coincidence of two code paths.
   *
   * «Прийняв» and «Не сходиться» record the same physical fact — the money got
   * here today — and differ only on whether the amount matched. §7.9's own
   * reason for using the acceptance day at all is «машина виїхала ввечері,
   * точка порахувала вранці, і гроші не мають лежати в касі за день, коли їх
   * фізично не було»: the point counted the disputed money on the 5th, so it
   * belongs in the drawer from the 5th.
   *
   * Without this on the dispute path, the `cash_counts` formula — whose outer
   * filter is `accepted_date <= D` — can never see a disputed transfer, and
   * both of its `disputed` branches are dead code. Spec §6.2.
   */
  private stampArrival(
    transfer: Transfer,
    actor: AuthenticatedUser,
    now: Date,
    today: string,
  ): void {
    transfer.accepted_by_user_id = actor.sub;
    transfer.accepted_at = now;
    transfer.accepted_date = today;
  }

  /**
   * The two point actions share everything but their body: authority, the row
   * lock, the state check and the audit entry.
   *
   * THE LOAD AND THE STATE CHECK ARE INSIDE THE TRANSACTION, under the row
   * lock, exactly as `PayoutsService.void` does and for the same reason.
   * Checking `status` before the transaction opens is a check-then-write: two
   * operators at one point — or one double-tapped button — both read `sent`,
   * both write, and `accepted_by_user_id` becomes last-writer-wins while the
   * audit log gains two entries naming different people. §6.11's 409 has to be
   * enforced where the write happens or it is not enforced at all.
   */
  private async transition(
    actor: AuthenticatedUser,
    id: string,
    action: 'transfer.accepted' | 'transfer.disputed',
    apply: (
      transfer: Transfer,
      now: Date,
      today: string,
    ) => { after: Record<string, unknown>; note: string | null },
  ): Promise<TransferResponse> {
    // §7.9 with §10.3 — «керівник не може зробити це за неї». The owner is
    // refused OUTRIGHT here, which inverts this codebase's usual shape.
    if (actor.role !== UserRole.PointOperator) {
      throw new ForbiddenException({
        message: 'Only the collection point may accept or dispute a transfer',
        code: 'POINT_OPERATOR_ONLY',
      });
    }

    return this.dataSource.transaction(async (m) => {
      const transfer = await m.findOne(Transfer, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!transfer) throw new NotFoundException('Transfer not found');

      // A 404, not a 403 — matching ShiftsService.loadVisible. Another point's
      // delivery is not this operator's business to know about.
      if (transfer.collection_point_id !== actor.collection_point_id) {
        throw new NotFoundException('Transfer not found');
      }

      if (transfer.voided_at) {
        throw new ConflictException({
          message: 'That transfer is voided',
          code: 'TRANSFER_VOIDED',
        });
      }
      if (transfer.status !== TransferStatus.Sent) {
        throw new ConflictException({
          message: 'That transfer has already been answered',
          code: 'TRANSFER_ALREADY_ANSWERED',
        });
      }

      const now = this.time.now().toJSDate();
      const today = this.time.now().toISODate()!;
      const { after, note } = apply(transfer, now, today);
      const saved = await m.save(Transfer, transfer);

      await this.audit.record(
        {
          action,
          actor_id: actor.sub,
          target_type: 'transfer',
          target_id: saved.id,
          after,
          note,
        },
        m,
      );

      return toTransferResponse(saved);
    });
  }
```

Import `DisputeTransferDto` at the top.

- [ ] **Step 5: Run to verify it passes**

```bash
cd backend && npx jest src/transfers/transfers.service.spec.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 6: Add the routes**

In `transfers.controller.ts` add `Param`, `ParseUUIDPipe` to the imports and:

```ts
  @Post(':id/accept')
  @Auth()
  accept(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.accept(actor, id);
  }

  @Post(':id/dispute')
  @Auth()
  dispute(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DisputeTransferDto,
  ) {
    return this.transfers.dispute(actor, id, dto);
  }
```

- [ ] **Step 7: Lint and commit**

```bash
cd backend && npm run lint && npx jest src/transfers
git add backend/src/transfers
git commit -m "$(cat <<'MSG'
feat(transfers): the point's two actions, accept and dispute

§7.9 step 3 gives the point «рівно дві дії» and no amount field, so
accept takes no body. Both actions are refused to the OWNER outright —
§10.3, «керівник не може зробити це за неї» — which inverts the usual
shape and is the sharpest rule in the slice.

Both stamp accepted_by/at/date through one shared helper, because both
record the same physical fact: the money got here today. Without it on
the dispute path the cash formula's disputed branches are unreachable —
its outer filter is `accepted_date <= D`.

State check and row lock are inside the transaction, matching
PayoutsService.void: two operators pressing Прийняв on one delivery is a
live race.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: The owner's two actions — resolve and void

**Interfaces:**
- Consumes: `TransfersService` (Tasks 3–4).
- Produces:
  - `TransfersService.resolve(actor, id, dto: ResolveTransferDto): Promise<TransferResponse>`
  - `TransfersService.void(actor, id, dto: VoidDocumentDto): Promise<TransferResponse>`

**Files:**
- Create: `backend/src/transfers/dto/resolve-transfer.dto.ts`
- Modify: `backend/src/transfers/transfers.service.ts`, `transfers.controller.ts`, `transfers.service.spec.ts`

- [ ] **Step 1: Write the resolve DTO**

`backend/src/transfers/dto/resolve-transfer.dto.ts`:

```ts
import { IsInt, Matches, Min } from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

/**
 * §7.9 step 4б — the owner closes the dispute. «Після підтвердження у формулу
 * обчислень потрапляє число, яке вказує керівник.»
 *
 * THE STATUS DOES NOT CHANGE. A resolved dispute keeps `status = 'disputed'`
 * forever, with `resolved_at` set — §7.7's «розбіжність у документі лишається,
 * її не підганяють», and the schema's own formula branches on exactly that
 * pair. Flipping it to `accepted` would erase from the record that anything
 * went wrong.
 *
 * WITHOUT THIS PAIR OF FIELDS the only home for the owner's number would be
 * editing `cash` on the posted document — «тихе переписування проведеного
 * документа», which §9.3 forbids.
 */
export class ResolveTransferDto {
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'resolved_cash must be a non-negative decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  resolved_cash: string;

  @IsInt()
  @Min(0)
  resolved_crates: number;
}
```

- [ ] **Step 2: Write the failing tests**

Append to `transfers.service.spec.ts`:

```ts
describe('TransfersService.resolve / void', () => {
  const disputed = (over: Record<string, unknown> = {}) => ({
    id: 't-1',
    collection_point_id: 'point-a',
    cash: '150000.00',
    crates: 200,
    carrier: 'Іван',
    status: TransferStatus.Disputed,
    accepted_by_user_id: 'u-op-a',
    accepted_date: '2026-09-05',
    accepted_at: new Date(),
    reported_cash: '140000.00',
    reported_crates: 195,
    dispute_note: 'мішок легший',
    resolved_cash: null,
    resolved_crates: null,
    resolved_by_user_id: null,
    resolved_at: null,
    correction_of_transfer_id: null,
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    sent_by_user_id: 'u-owner',
    sent_at: new Date(),
    created_at: new Date(),
    ...over,
  });

  const build = (row: Record<string, unknown>) => {
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
    const time = { now: () => ({ toISODate: () => '2026-09-09', toJSDate: () => new Date() }) };
    const service = new TransfersService(
      {} as never,
      {} as never,
      audit as never,
      time as never,
      dataSource as never,
    );
    return { service, audit, saved };
  };

  const resolution = { resolved_cash: '140000.00', resolved_crates: 195 };

  it('resolve fills resolved_* and LEAVES THE STATUS disputed', async () => {
    const { service, saved } = build(disputed());
    const result = await service.resolve(owner, 't-1', resolution as never);

    expect(saved[0]).toMatchObject({
      status: TransferStatus.Disputed,
      resolved_cash: '140000.00',
      resolved_crates: 195,
      resolved_by_user_id: 'u-owner',
    });
    expect(result.status).toBe(TransferStatus.Disputed);
  });

  it('resolve refuses an operator', async () => {
    const { service } = build(disputed());
    await expect(service.resolve(operatorA, 't-1', resolution as never)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('resolve refuses a transfer that is not disputed', async () => {
    const { service } = build(disputed({ status: TransferStatus.Accepted }));
    await expect(service.resolve(owner, 't-1', resolution as never)).rejects.toThrow(
      ConflictException,
    );
  });

  it('resolve refuses an already-resolved dispute', async () => {
    const { service } = build(disputed({ resolved_at: new Date() }));
    await expect(service.resolve(owner, 't-1', resolution as never)).rejects.toThrow(
      ConflictException,
    );
  });

  it('void stamps the trio and LEAVES THE STATUS ALONE', async () => {
    const { service, saved } = build(disputed({ status: TransferStatus.Accepted }));
    await service.void(owner, 't-1', { reason: 'дубль' } as never);

    expect(saved[0]).toMatchObject({
      // The trap in one assertion: a voided transfer is still 'accepted', so
      // every cash query must filter voided_at itself.
      status: TransferStatus.Accepted,
      voided_by_user_id: 'u-owner',
      void_reason: 'дубль',
    });
    expect(saved[0].voided_at).toBeInstanceOf(Date);
  });

  it('void refuses an operator — §9.4, «точка сторнувати не може»', async () => {
    const { service } = build(disputed());
    await expect(service.void(operatorA, 't-1', { reason: 'дубль' } as never)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('void refuses an already-voided transfer', async () => {
    const { service } = build(disputed({ voided_at: new Date() }));
    await expect(service.void(owner, 't-1', { reason: 'дубль' } as never)).rejects.toThrow(
      ConflictException,
    );
  });

  it('writes transfer.resolved and transfer.voided audit entries', async () => {
    const r = build(disputed());
    await r.service.resolve(owner, 't-1', resolution as never);
    expect(r.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'transfer.resolved' }),
      expect.anything(),
    );

    const v = build(disputed());
    await v.service.void(owner, 't-1', { reason: 'дубль' } as never);
    expect(v.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'transfer.voided', note: 'дубль' }),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd backend && npx jest src/transfers/transfers.service.spec.ts
```

Expected: FAIL — `service.resolve is not a function`.

- [ ] **Step 4: Implement `resolve` and `void`**

```ts
  /**
   * §7.9 step 4б — the owner's final word on a dispute. OWNER ONLY (§10.2:
   * corrections belong to the owner).
   *
   * THE STATUS IS NOT TOUCHED. See `ResolveTransferDto`'s header and the enum's.
   *
   * WHAT THIS IS FOR, under the 09.09.2026 ruling: the point's own figure is
   * already in the cash formula, so closing the dispute is an ACCOUNTING act,
   * not a cash movement. It is used when the point miscounted and the missing
   * money turns up in the bag, or when the owner audits and writes the final
   * figure. The discrepancy stays visible on the document forever (§7.7).
   */
  async resolve(
    actor: AuthenticatedUser,
    id: string,
    dto: ResolveTransferDto,
  ): Promise<TransferResponse> {
    return this.ownerAction(actor, id, async (transfer, m) => {
      if (transfer.status !== TransferStatus.Disputed) {
        throw new ConflictException({
          message: 'Only a disputed transfer can be resolved',
          code: 'TRANSFER_NOT_DISPUTED',
        });
      }
      if (transfer.resolved_at) {
        throw new ConflictException({
          message: 'That dispute is already resolved',
          code: 'TRANSFER_ALREADY_RESOLVED',
        });
      }

      transfer.resolved_cash = dto.resolved_cash;
      transfer.resolved_crates = dto.resolved_crates;
      transfer.resolved_by_user_id = actor.sub;
      transfer.resolved_at = this.time.now().toJSDate();
      const saved = await m.save(Transfer, transfer);

      await this.audit.record(
        {
          action: 'transfer.resolved',
          actor_id: actor.sub,
          target_type: 'transfer',
          target_id: saved.id,
          before: { reported_cash: transfer.reported_cash, reported_crates: transfer.reported_crates },
          after: { resolved_cash: dto.resolved_cash, resolved_crates: dto.resolved_crates },
        },
        m,
      );

      return saved;
    });
  }

  /**
   * §9.4 — «сторнує переказ ТІЛЬКИ керівник; точка сторнувати не може.»
   *
   * LEGAL IN ANY STATE, INCLUDING `accepted`, and that is anticipated rather
   * than tolerated: the DBML says in as many words that a voided transfer
   * «лишається зі status = accepted». Voiding an accepted transfer is how a
   * mistaken «Прийняв» is undone — the owner voids with a reason, issues a
   * correction naming this document, and the point accepts the correction
   * (§9.3, spec §6.9).
   *
   * THE MONEY LEAVES THE CASH FIGURE IMMEDIATELY, unlike a voided PAYOUT which
   * stays subtracted until someone physically returns the cash. The asymmetry
   * is deliberate: a voided transfer says «this delivery never validly
   * happened», so no document accounts for that money until the correction
   * lands. If the fix drags on, the resulting discrepancy is an accurate
   * description of reality.
   */
  async void(
    actor: AuthenticatedUser,
    id: string,
    dto: VoidDocumentDto,
  ): Promise<TransferResponse> {
    return this.ownerAction(actor, id, async (transfer, m) => {
      if (transfer.voided_at) {
        throw new ConflictException({
          message: 'That transfer is already voided',
          code: 'ALREADY_VOIDED',
        });
      }

      transfer.voided_at = this.time.now().toJSDate();
      transfer.voided_by_user_id = actor.sub;
      transfer.void_reason = dto.reason.trim();
      // `status` IS LEFT ALONE ON PURPOSE. See this method's header.
      const saved = await m.save(Transfer, transfer);

      await this.audit.record(
        {
          action: 'transfer.voided',
          actor_id: actor.sub,
          target_type: 'transfer',
          target_id: saved.id,
          after: { cash: saved.cash, crates: saved.crates, status: saved.status },
          note: dto.reason,
        },
        m,
      );

      return saved;
    });
  }

  /** The owner's two verbs share their authority check, row lock and 404. */
  private async ownerAction(
    actor: AuthenticatedUser,
    id: string,
    apply: (transfer: Transfer, m: EntityManager) => Promise<Transfer>,
  ): Promise<TransferResponse> {
    if (actor.role !== UserRole.NetworkOwner) {
      throw new ForbiddenException({
        message: 'Only the network owner may do that',
        code: 'OWNER_ONLY',
      });
    }

    return this.dataSource.transaction(async (m) => {
      const transfer = await m.findOne(Transfer, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!transfer) throw new NotFoundException('Transfer not found');
      return toTransferResponse(await apply(transfer, m));
    });
  }
```

Add `EntityManager` to the `typeorm` import, `ResolveTransferDto` and `VoidDocumentDto` (from `../intakes/dto/void-document.dto`) to the imports.

- [ ] **Step 5: Run to verify it passes**

```bash
cd backend && npx jest src/transfers/transfers.service.spec.ts
```

Expected: PASS, 21 tests.

- [ ] **Step 6: Add the routes**

```ts
  @Post(':id/resolve')
  @Auth(UserRole.NetworkOwner)
  resolve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveTransferDto,
  ) {
    return this.transfers.resolve(actor, id, dto);
  }

  @Post(':id/void')
  @Auth(UserRole.NetworkOwner)
  void(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidDocumentDto,
  ) {
    return this.transfers.void(actor, id, dto);
  }
```

- [ ] **Step 7: Lint and commit**

```bash
cd backend && npm run lint && npx jest src/transfers
git add backend/src/transfers
git commit -m "$(cat <<'MSG'
feat(transfers): the owner's two actions, resolve and void

Resolving a dispute fills resolved_* and leaves status = 'disputed'
forever — §7.7's «розбіжність у документі лишається, її не підганяють»,
and the schema's own cash formula branches on exactly that pair.

Voiding is legal on an accepted transfer, which is how a mistaken
«Прийняв» is undone: void with a reason, issue a correction naming it,
the point accepts the correction. Status is left alone, so a voided
transfer still reads 'accepted' and every cash query filters voided_at
for itself.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: Reading transfers — list and findOne

**Interfaces:**
- Consumes: `TransfersService` (Tasks 3–5), `toTransferResponse`.
- Produces:
  - `TransfersService.list(actor, query: ListTransfersQueryDto): Promise<Paginated<TransferResponse>>`
  - `TransfersService.findOne(actor, id): Promise<TransferResponse>`

**Files:**
- Create: `backend/src/transfers/dto/list-transfers.query.ts`
- Modify: `backend/src/transfers/transfers.service.ts`, `transfers.controller.ts`, `transfers.service.spec.ts`

- [ ] **Step 1: Write the list query DTO**

`backend/src/transfers/dto/list-transfers.query.ts`:

```ts
import { IsEnum, IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';
import { TransferStatus } from '../transfer-status.enum';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ListTransfersQueryDto extends PaginationQueryDto {
  /** Ignored for an operator, who is pinned to their own point. */
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsOptional()
  @IsEnum(TransferStatus)
  status?: TransferStatus;

  /**
   * `from`/`to` FILTER ON `sent_at`, NOT ON `accepted_date`, and the choice
   * matters: a `sent` transfer has no `accepted_date` at all, so filtering on
   * that column would hide exactly the in-flight rows the owner opens this
   * list to see. The dispatch day is the only date every transfer has.
   */
  @IsOptional()
  @Matches(ISO_DATE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  /** §9.3 — a voided document «лишається в журналі назавжди», but the default
   *  list is the working one. Matches `GET /intakes`. */
  @BooleanQueryParam()
  include_voided: boolean = false;
}
```

- [ ] **Step 2: Write the failing tests**

Append to `transfers.service.spec.ts`:

```ts
describe('TransfersService.list / findOne', () => {
  const qb = () => {
    const b = {
      andWhere: jest.fn(() => b),
      orderBy: jest.fn(() => b),
      addOrderBy: jest.fn(() => b),
      skip: jest.fn(() => b),
      take: jest.fn(() => b),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    return b;
  };

  const build = (findOneResult: unknown = null) => {
    const builder = qb();
    const repo = {
      createQueryBuilder: jest.fn(() => builder),
      findOne: jest.fn().mockResolvedValue(findOneResult),
    };
    const service = new TransfersService(
      repo as never,
      {} as never,
      { record: jest.fn() } as never,
      { now: () => ({ toISODate: () => '2026-09-09', toJSDate: () => new Date() }) } as never,
      {} as never,
    );
    return { service, builder, repo };
  };

  const query = (over: Record<string, unknown> = {}) => ({
    page: 1,
    limit: 20,
    include_voided: false,
    ...over,
  });

  it('pins an operator to their own point regardless of the query', async () => {
    const { service, builder } = build();
    await service.list(operatorA, query({ collection_point_id: 'point-b' }) as never);

    expect(builder.andWhere).toHaveBeenCalledWith('t.collection_point_id = :pointId', {
      pointId: 'point-a',
    });
  });

  it('hides voided transfers by default', async () => {
    const { service, builder } = build();
    await service.list(owner, query() as never);
    expect(builder.andWhere).toHaveBeenCalledWith('t.voided_at IS NULL');
  });

  it('filters the date range on sent_at, never on accepted_date', async () => {
    const { service, builder } = build();
    await service.list(owner, query({ from: '2026-09-01', to: '2026-09-09' }) as never);

    const clauses = builder.andWhere.mock.calls.map((c) => String(c[0]));
    expect(clauses.some((c) => c.includes('t.sent_at') && c.includes(':from'))).toBe(true);
    expect(clauses.some((c) => c.includes('accepted_date'))).toBe(false);
  });

  it("findOne is a 404 for another point's transfer", async () => {
    const { service } = build({ id: 't-1', collection_point_id: 'point-b' });
    await expect(service.findOne(operatorA, 't-1')).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd backend && npx jest src/transfers/transfers.service.spec.ts
```

Expected: FAIL — `service.list is not a function`.

- [ ] **Step 4: Implement `list` and `findOne`**

```ts
  /**
   * §7.9's journal, and the owner's «стан переказу» column in §7.10.
   *
   * NEWEST FIRST BY DISPATCH, with `id` as the tiebreaker. Postgres promises
   * no order among ties, so without it `skip`/`take` can serve one row twice
   * and another never — the same reasoning as `SuppliersService.list`.
   */
  async list(
    actor: AuthenticatedUser,
    query: ListTransfersQueryDto,
  ): Promise<Paginated<TransferResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);

    const qb = this.repo.createQueryBuilder('t');
    if (pointId) qb.andWhere('t.collection_point_id = :pointId', { pointId });
    if (query.status) qb.andWhere('t.status = :status', { status: query.status });
    if (!query.include_voided) qb.andWhere('t.voided_at IS NULL');
    // ON `sent_at`, NOT `accepted_date` — see the DTO's comment. A `sent`
    // transfer has no acceptance day, and those are the rows this list exists
    // to surface.
    // `CAST(:from AS date)` RATHER THAN `:from::date`. TypeORM scans for
    // `:name` parameters textually, and a `::` cast sitting against a
    // placeholder is the one place that scan misreads — `:from::date` can be
    // taken as a parameter named `date`. The ANSI form cannot be confused.
    if (query.from) qb.andWhere('t.sent_at >= CAST(:from AS date)', { from: query.from });
    if (query.to) qb.andWhere('t.sent_at < CAST(:to AS date) + 1', { to: query.to });

    const [data, total] = await qb
      .orderBy('t.sent_at', 'DESC')
      .addOrderBy('t.id', 'ASC')
      .skip(skipOf(query))
      .take(query.limit)
      .getManyAndCount();

    return { data: data.map(toTransferResponse), total, page: query.page, limit: query.limit };
  }

  async findOne(actor: AuthenticatedUser, id: string): Promise<TransferResponse> {
    const transfer = await this.repo.findOne({ where: { id } });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (actor.role !== UserRole.NetworkOwner) {
      // 404, not 403 — matching ShiftsService.loadVisible.
      if (actor.collection_point_id !== transfer.collection_point_id) {
        throw new NotFoundException('Transfer not found');
      }
      assertOwnsPoint(actor, transfer.collection_point_id);
    }
    return toTransferResponse(transfer);
  }
```

Add imports: `Paginated` from `../common/dto/paginated`, `skipOf` from `../common/dto/pagination-query.dto`, `resolvePointFilter` and `assertOwnsPoint` from `../auth/access/point-scope`, `ListTransfersQueryDto`.

- [ ] **Step 5: Run to verify it passes**

```bash
cd backend && npx jest src/transfers/transfers.service.spec.ts
```

Expected: PASS, 25 tests.

- [ ] **Step 6: Add the routes**

```ts
  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListTransfersQueryDto) {
    return this.transfers.list(actor, query);
  }

  @Get(':id')
  @Auth()
  findOne(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.findOne(actor, id);
  }
```

Add `Get` and `Query` to the `@nestjs/common` import. Place `@Get()` **before** `@Get(':id')`.

- [ ] **Step 7: Lint and commit**

```bash
cd backend && npm run lint && npx jest src/transfers
git add backend/src/transfers
git commit -m "$(cat <<'MSG'
feat(transfers): list and read

from/to filter on sent_at rather than accepted_date: a `sent` transfer
has no acceptance day, and those are exactly the in-flight rows the
owner opens this list to see.

Voided rows are hidden by default; an operator is pinned to their own
point and another point's transfer is a 404, matching the rest of the
codebase.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: `point-cash` — the formula and its twelve scenarios

This is the task the slice exists for. The formula is SQL and cannot be unit-tested, so the database spec **is** the test.

**Interfaces:**
- Consumes: `transfers` (Task 2), `payouts` and `shifts` (already shipped).
- Produces:
  - `cashSql(point: string, asOf: string, tz: string): string` (module-private)
  - `PointCashService.cashFor(pointId: string, asOf?: string, manager?: EntityManager): Promise<string>`
  - `PointCashModule` exporting `PointCashService` — **the seam slice 2 calls for `expected_amount`**

**Files:**
- Create: `backend/src/point-cash/point-cash.service.ts`, `point-cash.module.ts`, `point-cash.db-spec.ts`

- [ ] **Step 1: Write the failing database spec**

`backend/src/point-cash/point-cash.db-spec.ts`. Read `supplier-balance-list.db-spec.ts` first for the fixture idiom — every fixture carries a per-run uuid because the throwaway database persists between runs.

```ts
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { PointCashService } from './point-cash.service';

/**
 * THE FORMULA, AGAINST A REAL POSTGRES. A unit spec can only assert the text
 * of this SQL; what needs testing is what the SQL MEANS, and every scenario
 * below is one branch that would silently return the wrong number if a later
 * reader "tidied" it.
 *
 * Four of the twelve exist specifically to stop someone harmonising the two
 * opposite readings of `voided_at`: voided PAYOUTS stay subtracted (the money
 * left the drawer), voided TRANSFERS stop being added (no valid document
 * accounts for them). §9.3 — «інакше сторно стає способом красти».
 */
describe('PointCashService.cashFor (Postgres)', () => {
  let ds: DataSource;
  let service: PointCashService;
  let run: string;
  let ownerId: string;

  /** A fresh point per scenario, so nothing leaks between them. */
  const newPoint = async (targetCash: string | null = null): Promise<string> => {
    const tag = randomUUID().slice(0, 8);
    const [{ id }] = (await ds.query(
      `INSERT INTO collection_points (name, code, kind, target_cash, is_active)
       VALUES ($1, $2, 'reception', $3, true) RETURNING id`,
      [`Точка ${tag}`, `T${tag.slice(0, 6).toUpperCase()}`, targetCash],
    )) as { id: string }[];
    return id;
  };

  const transfer = async (
    pointId: string,
    over: Record<string, unknown> = {},
  ): Promise<string> => {
    const row: Record<string, unknown> = {
      collection_point_id: pointId,
      cash: '1000.00',
      crates: 0,
      carrier: 'Іван, Ducato',
      sent_by_user_id: ownerId,
      sent_at: new Date('2026-09-01T18:00:00Z'),
      status: 'accepted',
      accepted_by_user_id: ownerId,
      accepted_date: '2026-09-02',
      accepted_at: new Date('2026-09-02T07:00:00Z'),
      ...over,
    };
    const keys = Object.keys(row);
    const [{ id }] = (await ds.query(
      `INSERT INTO transfers (${keys.map((k) => `"${k}"`).join(', ')})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      keys.map((k) => row[k]),
    )) as { id: string }[];
    return id;
  };

  /** A payout needs a shift, which is where its point and business date live. */
  const payout = async (
    pointId: string,
    businessDate: string,
    amount: string,
    over: Record<string, unknown> = {},
  ): Promise<void> => {
    const [{ id: shiftId }] = (await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date,
                           closed_at, closed_by_user_id, status)
       VALUES ($1, $2, $3, now(), $2, 'closed') RETURNING id`,
      [pointId, ownerId, businessDate],
    )) as { id: string }[];

    const [{ id: supplierId }] = (await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, kind, is_active)
       VALUES ($1, 'Тест', $2, 'none', true) RETURNING id`,
      [pointId, randomUUID().slice(0, 8)],
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

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new PointCashService(ds);
    run = randomUUID().slice(0, 8);
    [{ id: ownerId }] = (await ds.query(
      `INSERT INTO users (first_name, last_name, role, is_active)
       VALUES ('Тест', $1, 'network_owner', true) RETURNING id`,
      [`Owner ${run}`],
    )) as { id: string }[];
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('1. an accepted transfer adds its cash', async () => {
    const p = await newPoint();
    await transfer(p, { cash: '150000.00' });
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('150000.00');
  });

  it('2. a sent transfer adds nothing — §7.9 step 2', async () => {
    const p = await newPoint();
    await transfer(p, {
      status: 'sent',
      accepted_by_user_id: null,
      accepted_date: null,
      accepted_at: null,
    });
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('0.00');
  });

  it('3. a VOIDED accepted transfer adds nothing, though its status is still accepted', async () => {
    const p = await newPoint();
    await transfer(p, {
      cash: '150000.00',
      voided_at: new Date(),
      voided_by_user_id: ownerId,
      void_reason: 'дубль',
    });
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('0.00');
  });

  it('4. an UNRESOLVED dispute adds reported_cash — the 09.09.2026 ruling', async () => {
    const p = await newPoint();
    await transfer(p, {
      cash: '150000.00',
      status: 'disputed',
      reported_cash: '140000.00',
      reported_crates: 195,
      dispute_note: 'мішок легший',
    });
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('140000.00');
  });

  it('5. a RESOLVED dispute adds resolved_cash, not reported_cash', async () => {
    const p = await newPoint();
    await transfer(p, {
      cash: '150000.00',
      status: 'disputed',
      reported_cash: '140000.00',
      dispute_note: 'мішок легший',
      resolved_cash: '145000.00',
      resolved_crates: 200,
      resolved_by_user_id: ownerId,
      resolved_at: new Date(),
    });
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('145000.00');
  });

  it('6. a payout subtracts', async () => {
    const p = await newPoint();
    await transfer(p, { cash: '1000.00' });
    await payout(p, '2026-09-03', '250.00');
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('750.00');
  });

  it('7. a VOIDED payout STILL subtracts — the money left the drawer', async () => {
    const p = await newPoint();
    await transfer(p, { cash: '1000.00' });
    await payout(p, '2026-09-03', '250.00', {
      voided_at: new Date(),
      voided_by_user_id: ownerId,
      void_reason: 'помилка',
    });
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('750.00');
  });

  it('8. a voided payout whose cash was physically returned nets to zero', async () => {
    const p = await newPoint();
    await transfer(p, { cash: '1000.00' });
    await payout(p, '2026-09-03', '250.00', {
      voided_at: new Date('2026-09-03T12:00:00Z'),
      voided_by_user_id: ownerId,
      void_reason: 'помилка',
      return_settled_at: new Date('2026-09-04T09:00:00Z'),
      return_settled_by_user_id: ownerId,
    });
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('1000.00');
  });

  it('9. as_of excludes a later accepted_date and a later business_date', async () => {
    const p = await newPoint();
    await transfer(p, { cash: '1000.00', accepted_date: '2026-09-02' });
    await transfer(p, { cash: '500.00', accepted_date: '2026-09-20' });
    await payout(p, '2026-09-25', '300.00');

    await expect(service.cashFor(p, '2026-09-10')).resolves.toBe('1000.00');
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('1200.00');
  });

  it('10. a point with no rows reads "0.00", not "0"', async () => {
    const p = await newPoint();
    await expect(service.cashFor(p, '2026-09-30')).resolves.toBe('0.00');
  });

  it('11. a settlement at 23:30 local lands on that local day, not the next', async () => {
    const p = await newPoint();
    await transfer(p, { cash: '1000.00' });
    // 2026-09-04 23:30 Europe/Kyiv is 2026-09-04 20:30 UTC. A bare ::date in
    // a UTC session would still read the 4th, so the test that bites is the
    // one just past midnight local: 2026-09-05 00:30 Kyiv = 2026-09-04 21:30
    // UTC, which a UTC ::date misfiles onto the 4th.
    await payout(p, '2026-09-03', '250.00', {
      voided_at: new Date('2026-09-03T12:00:00Z'),
      voided_by_user_id: ownerId,
      void_reason: 'помилка',
      return_settled_at: new Date('2026-09-04T21:30:00Z'),
      return_settled_by_user_id: ownerId,
    });

    // The settlement happened on the 5th LOCAL, so as of the 4th it has not
    // happened yet and the payout is still subtracted.
    await expect(service.cashFor(p, '2026-09-04')).resolves.toBe('750.00');
    await expect(service.cashFor(p, '2026-09-05')).resolves.toBe('1000.00');
  });

  it('12. defaults as_of to today when it is not given', async () => {
    const p = await newPoint();
    await transfer(p, { cash: '1000.00', accepted_date: '2026-09-02' });
    await expect(service.cashFor(p)).resolves.toBe('1000.00');
  });
});
```

Scenario 11 assumes `APP_TIMEZONE=Europe/Kyiv` (the default). If `.env` sets it to UTC, the test correctly fails — fix the environment, not the test.

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && npm run test:db -- src/point-cash/point-cash.db-spec.ts
```

Expected: FAIL — `Cannot find module './point-cash.service'`.

- [ ] **Step 3: Write the service**

`backend/src/point-cash/point-cash.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { timezoneConfig } from '../config/timezone.config';

/**
 * THE BERRY CASH FORMULA, WRITTEN ONCE. `point` is the SQL naming whose drawer
 * is wanted — the bind placeholder `$1` for one point, the outer row's own
 * column `cp.id` when correlated down a list. Both call sites pass a code
 * literal; nothing from a request is ever spliced here.
 *
 * Copied from the `cash_counts` Note in `28-db-schema.dbml` as amended on
 * 09.09.2026, including every filter. FIVE OF THEM ARE LOAD-BEARING AND ONE OF
 * THEM IS A THEFT PATH IF REMOVED:
 *
 * 1. `t.voided_at IS NULL` — voided TRANSFERS drop out. They must be filtered
 *    BY ROW, not by status: `transfer_status` has no `void` member, so a voided
 *    transfer keeps `status = 'accepted'` and without this line would go on
 *    adding money to the drawer forever.
 *
 * 2. Payouts are summed WITHOUT a `voided_at` filter, ON PURPOSE, and this is
 *    the exact opposite of the debt formula in `supplier-balance`. §9.3: the
 *    money physically left the drawer and voiding does not put it back. It
 *    returns only when a human physically returns it, which is what
 *    `return_settled_at` stamps — the third term. «Інакше сторно стає способом
 *    красти.» A reader who harmonises these two queries has opened that path.
 *
 * 3. The three-way `CASE` is the 09.09.2026 client ruling, which overrules
 *    §7.9 step 4б. An unresolved dispute contributes the point's OWN counted
 *    figure: the money is credited at the amount actually received and the
 *    shortfall is settled outside the system. Excluding it would leave that
 *    point's expected cash wrong by the shortfall on every count from then on,
 *    burying the real discrepancy under a permanent phantom one.
 *
 * 4. `sent` transfers need no explicit filter — their `accepted_date` is NULL
 *    and `accepted_date <= D` already excludes them. §7.9 step 2: «у стані sent
 *    не рухається НІЧОГО».
 *
 * 5. `AT TIME ZONE` on `return_settled_at` is not decoration. It is a
 *    `timestamptz` compared against a business DATE, and a bare `::date` would
 *    take the session timezone and misfile a late-evening settlement by a day.
 *    Everything else in the formula is already `date`-typed.
 *
 * THE FALLBACK IS `0.00`, NOT `0`. `SUM` over no rows is NULL, and
 * `COALESCE(NULL, 0)` is an integer zero that Postgres renders as `'0'` — so a
 * brand-new point would read `"0"` where every other figure reads to two
 * places. Same literal, same reason, as `supplier-balance`.
 *
 * THERE IS NO TIMESTAMP IN THIS FORMULA AND THERE CANNOT BE ONE. Transfers
 * contribute by `accepted_date` and payouts by `shifts.business_date`, both
 * `date`-typed; «cash at 14:00» is not expressible. This is survivable because
 * a cash count's `expected_amount` is a SNAPSHOT computed at the instant of
 * counting — a midday count at 14:00 asks for `D = today` and picks up exactly
 * the payouts written so far. Do not try to add one.
 *
 * WHAT IS NOT HERE: the crates book (`cash_book = 'crates'`), which needs
 * `crate_issuances` and `crate_returns` and has no formula until they exist.
 */
const cashSql = (point: string, asOf: string, tz: string): string => `(
    COALESCE((SELECT SUM(CASE
                WHEN t.status = 'accepted' THEN t.cash
                WHEN t.status = 'disputed' AND t.resolved_at IS NOT NULL THEN t.resolved_cash
                WHEN t.status = 'disputed' THEN t.reported_cash
              END)
         FROM transfers t
        WHERE t.collection_point_id = ${point}
          AND t.voided_at IS NULL
          AND t.accepted_date <= ${asOf}), 0.00)
  - COALESCE((SELECT SUM(p.amount)
         FROM payouts p JOIN shifts s ON s.id = p.shift_id
        WHERE s.collection_point_id = ${point}
          AND s.business_date <= ${asOf}), 0.00)
  + COALESCE((SELECT SUM(p.amount)
         FROM payouts p JOIN shifts s ON s.id = p.shift_id
        WHERE s.collection_point_id = ${point}
          AND p.return_settled_at IS NOT NULL
          AND (p.return_settled_at AT TIME ZONE ${tz})::date <= ${asOf}), 0.00)
)`;

/**
 * A point's cash, computed and never stored.
 *
 * NOTHING IS CACHED AND NO BALANCE IS WRITTEN ANYWHERE. §7.3's list of what
 * moves cash is closed and the figure is a formula — правка 9, «система рахує
 * загальну суму в касі за допомогою денних транзакцій». A stored balance is
 * forbidden for the reason `intakes` has no `remaining` column (§3.2), and the
 * DBML supplies the field evidence: in the client's own workbook the
 * hand-copied balance chain is broken in 124 переходах із 1 473.
 *
 * THERE IS NO OPENING-BALANCE DOCUMENT AND NO `cashBookFrom` SETTING. The
 * `cash_counts` Note names `AppConfig.cashBookFrom` as an application
 * parameter; it lives in the prototype and nothing by that name exists here,
 * deliberately. On a fresh installation it would exclude rows that do not
 * exist. A point's day-one drawer is entered as an ORDINARY TRANSFER — the
 * owner creates one per point, the operator signs for it — because §7.3 makes
 * an accepted transfer the only door cash has into a drawer. That is the
 * mechanism working as designed, not a workaround. Spec §6.6.
 */
@Injectable()
export class PointCashService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(timezoneConfig.KEY)
    private readonly tz: ConfigType<typeof timezoneConfig> = { appTimezone: 'Europe/Kyiv' },
  ) {}

  /**
   * One point's berry cash as of `asOf` (default: today), as a decimal STRING.
   *
   * Takes an `EntityManager` so slice 2 can compute a cash count's
   * `expected_amount` inside the same transaction that writes the count —
   * otherwise the snapshot it stores is already stale.
   */
  async cashFor(pointId: string, asOf?: string, manager?: EntityManager): Promise<string> {
    const runner = manager ?? this.dataSource.manager;
    // `::text` on the numeric expression so the value never passes through a
    // JS number on its way out of the driver (foundation §5.1).
    const sql = `SELECT ${cashSql('$1::uuid', ASOF, '$3')}::text AS cash`;
    const [row] = (await runner.query(sql, [pointId, asOf ?? null, this.tz.appTimezone])) as {
      cash: string;
    }[];

    return row.cash;
  }
}

export { cashSql };
```

**On `ASOF` and the default date.** Define it beside `cashSql`:

```ts
/**
 * «As of» resolves to TODAY IN `APP_TIMEZONE` when the caller names no date,
 * and it does so IN SQL rather than in TypeScript for one reason: Postgres's
 * bare `'today'` and `current_date` both resolve in the SESSION timezone,
 * which is not necessarily the app's. `now() AT TIME ZONE <tz>` is the same
 * local calendar day `TimeService.now().toISODate()` would give, computed in
 * the one place the timezone is already a bind parameter — so this service
 * needs no clock injected and both database specs can construct it with
 * nothing but a `DataSource`.
 */
const ASOF = `COALESCE($2::date, (now() AT TIME ZONE $3)::date)`;
```

- [ ] **Step 4: Write the module**

`backend/src/point-cash/point-cash.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PointCashService } from './point-cash.service';
import { timezoneConfig } from '../config/timezone.config';

/**
 * OWNS NO TABLE. It reads `transfers`, `payouts` and `shifts` in raw SQL and
 * writes nothing, so it registers no entity — the shape `supplier-balance`
 * established.
 *
 * `PointCashService` is EXPORTED because slice 2 (`cash_counts`) calls
 * `cashFor` for every `expected_amount` it snapshots. That is the seam; do not
 * let the formula grow a second home there.
 */
@Module({
  imports: [ConfigModule.forFeature(timezoneConfig)],
  providers: [PointCashService],
  exports: [PointCashService],
})
export class PointCashModule {}
```

- [ ] **Step 5: Run the database spec to verify it passes**

```bash
cd backend && docker compose -f ../docker-compose.yml up -d postgres
npm run test:db -- src/point-cash/point-cash.db-spec.ts
```

Expected: PASS, 12 tests. If scenario 11 fails, check `APP_TIMEZONE` before touching the SQL. If a fixture insert fails on a column name, check the real column list — `npm run test:db` runs migrations first, so `\d transfers` in `psql` is authoritative.

- [ ] **Step 6: Lint and commit**

```bash
cd backend && npm run lint && npm run test:db -- src/point-cash
git add backend/src/point-cash
git commit -m "$(cat <<'MSG'
feat(point-cash): the berry cash formula, written once

Twelve database scenarios, one per branch. Four of them exist to stop a
later reader harmonising the two opposite readings of voided_at: voided
payouts stay subtracted because the money left the drawer, voided
transfers stop being added because no valid document accounts for them.
§9.3 — «інакше сторно стає способом красти».

The three-way CASE is the 09.09.2026 client ruling: an unresolved
dispute contributes the point's own counted figure.

No stored balance, no cache, no cashBookFrom setting — a point's day-one
drawer is entered as an ordinary transfer, because §7.3 makes that the
only door cash has into a drawer.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: `GET /point-cash` — the screen both roles open

**Interfaces:**
- Consumes: `cashSql`, `PointCashService` (Task 7).
- Produces:
  - `PointCashService.list(actor, query): Promise<Paginated<PointCashRowResponse>>`
  - `GET /point-cash`, `GET /point-cash/:pointId`

**Files:**
- Create: `backend/src/point-cash/point-cash.mapper.ts`, `point-cash.controller.ts`, `dto/list-point-cash.query.ts`
- Modify: `backend/src/point-cash/point-cash.service.ts`, `point-cash.module.ts`, `point-cash.db-spec.ts`, `backend/src/app.module.ts`, `CLAUDE.md`

- [ ] **Step 1: Write the query DTO and the mapper**

`backend/src/point-cash/dto/list-point-cash.query.ts`:

```ts
import { IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListPointCashQueryDto extends PaginationQueryDto {
  /** Ignored for an operator, who is pinned to their own point. */
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  /** Defaults to today. The formula is date-granular; see the service header. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'as_of must be YYYY-MM-DD' })
  as_of?: string;
}
```

`backend/src/point-cash/point-cash.mapper.ts`:

```ts
import { TransferStatus } from '../transfers/transfer-status.enum';

/** The raw projection — every numeric already `::text`. */
export interface PointCashRow {
  collection_point_id: string;
  name: string;
  target_cash: string | null;
  cash: string;
  shortfall: string | null;
  latest_transfer_status: TransferStatus | null;
  latest_transfer_sent_at: Date | null;
}

/**
 * One line of the cash screen — §7.10's table, minus the «ящиків» column,
 * which has no source tables until the crates slice.
 *
 * `shortfall` IS `null`, NEVER `0.00`, FOR A POINT WITH NO TARGET, and the
 * point still appears. §7.10 says a point without a target «в таблицю не
 * потрапляє узагалі», but that was written about the DEBT table, where a
 * missing target leaves nothing to subtract from. This is the CASH screen: the
 * point's cash is a fact whether or not anyone set a target, and only the
 * shortfall is unknowable. `0.00` would assert the network owes that point
 * nothing — the same argument by which §6.9 requires «—» rather than a zero
 * for crates. Hiding the row would blind the owner to real money. The debt
 * rule survives where it belongs: no zero in the shortfall column. Amended
 * into §7.10 on 09.09.2026; spec §6.6.
 */
export interface PointCashRowResponse {
  collection_point_id: string;
  name: string;
  target_cash: string | null;
  cash: string;
  shortfall: string | null;
  latest_transfer: { status: TransferStatus; sent_at: Date } | null;
}

/** Field by field, not `...row`: a raw projection must not reach the client
 *  with whatever a later `SELECT` happens to add. */
export function toPointCashRowResponse(row: PointCashRow): PointCashRowResponse {
  return {
    collection_point_id: row.collection_point_id,
    name: row.name,
    target_cash: row.target_cash,
    cash: row.cash,
    shortfall: row.shortfall,
    latest_transfer:
      row.latest_transfer_status && row.latest_transfer_sent_at
        ? { status: row.latest_transfer_status, sent_at: row.latest_transfer_sent_at }
        : null,
  };
}
```

- [ ] **Step 2: Write the failing tests**

Append to `point-cash.db-spec.ts`:

```ts
describe('PointCashService.list (Postgres)', () => {
  // Reuses the outer describe's harness by re-opening its own — see
  // supplier-balance-list.db-spec.ts for the same shape.
  let ds: DataSource;
  let service: PointCashService;
  let ownerId: string;
  let withTarget: string;
  let withoutTarget: string;

  const owner: AuthenticatedUser = {
    sub: 'placeholder',
    username: 'owner',
    role: UserRole.NetworkOwner,
    collection_point_id: null,
  };

  const query = (over: Record<string, unknown> = {}) => ({
    page: 1,
    limit: 50,
    as_of: '2026-09-30',
    ...over,
  });

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new PointCashService(ds);
    const run = randomUUID().slice(0, 8);
    [{ id: ownerId }] = (await ds.query(
      `INSERT INTO users (first_name, last_name, role, is_active)
       VALUES ('Тест', $1, 'network_owner', true) RETURNING id`,
      [`Owner list ${run}`],
    )) as { id: string }[];
    owner.sub = ownerId;

    const mk = async (target: string | null) => {
      const tag = randomUUID().slice(0, 8);
      const [{ id }] = (await ds.query(
        `INSERT INTO collection_points (name, code, kind, target_cash, is_active)
         VALUES ($1, $2, 'reception', $3, true) RETURNING id`,
        [`Точка ${tag}`, `L${tag.slice(0, 6).toUpperCase()}`, target],
      )) as { id: string }[];
      return id;
    };
    withTarget = await mk('500000.00');
    withoutTarget = await mk(null);

    await ds.query(
      `INSERT INTO transfers (collection_point_id, cash, crates, carrier, sent_by_user_id,
                              sent_at, status, accepted_by_user_id, accepted_date, accepted_at)
       VALUES ($1, '1616.10', 0, 'Іван', $2, '2026-09-01T18:00:00Z', 'accepted',
               $2, '2026-09-02', '2026-09-02T07:00:00Z')`,
      [withTarget, ownerId],
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('computes the shortfall in Postgres, exact to the kopiyka', async () => {
    const page = await service.list(owner, query({ collection_point_id: withTarget }) as never);
    expect(page.data[0]).toMatchObject({
      target_cash: '500000.00',
      cash: '1616.10',
      shortfall: '498383.90',
    });
  });

  it('KEEPS a point with no target_cash, with a null shortfall — the 09.09.2026 ruling', async () => {
    const page = await service.list(owner, query({ collection_point_id: withoutTarget }) as never);
    expect(page.total).toBe(1);
    expect(page.data[0]).toMatchObject({
      target_cash: null,
      cash: '0.00',
      shortfall: null,
    });
  });

  it('carries the latest transfer state, and null when there is none', async () => {
    const withT = await service.list(owner, query({ collection_point_id: withTarget }) as never);
    expect(withT.data[0].latest_transfer?.status).toBe('accepted');

    const without = await service.list(
      owner,
      query({ collection_point_id: withoutTarget }) as never,
    );
    expect(without.data[0].latest_transfer).toBeNull();
  });

  it('pins an operator to their own point regardless of the query', async () => {
    const operator: AuthenticatedUser = {
      sub: ownerId,
      username: 'op',
      role: UserRole.PointOperator,
      collection_point_id: withoutTarget,
    };
    const page = await service.list(
      operator,
      query({ collection_point_id: withTarget }) as never,
    );
    expect(page.data).toHaveLength(1);
    expect(page.data[0].collection_point_id).toBe(withoutTarget);
  });
});
```

Add to the file's imports: `UserRole` from `../users/user-role.enum`, `type { AuthenticatedUser }` from `../auth/jwt.strategy`.

- [ ] **Step 3: Run to verify it fails**

```bash
cd backend && npm run test:db -- src/point-cash/point-cash.db-spec.ts
```

Expected: FAIL — `service.list is not a function`.

- [ ] **Step 4: Implement `list`**

Add to `PointCashService`:

```ts
  /**
   * Every point in scope with its cash — §7.10's table, and the one screen both
   * roles open. «Керівник відкриває той самий екран каси, який бачить
   * приймальник цієї точки, плюс свої блоки: одна правда для обох, різна
   * повнота» — which is why this widens by role rather than splitting in two.
   *
   * THE SAME SQL AS `cashFor`, correlated on each point row, so this list
   * cannot grow a formula of its own.
   *
   * THE SHORTFALL IS SUBTRACTED BY POSTGRES, NOT BY JAVASCRIPT, and that is
   * not stylistic: `numeric` arithmetic in SQL is exact, and `NULL - x` is
   * `NULL`, so a point with no target gets its `null` shortfall for free with
   * no branch to forget. Writing `target_cash - cash` in TypeScript is the
   * exact shape foundation §5.1 forbids, and `eslint.config.mjs` refuses it in
   * this directory.
   *
   * THE ORDER IS TOTAL — name, then id. Postgres promises no order among ties,
   * so without the id tiebreaker `LIMIT`/`OFFSET` can serve one row twice.
   */
  async list(
    actor: AuthenticatedUser,
    query: ListPointCashQueryDto,
  ): Promise<Paginated<PointCashRowResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id) ?? null;
    const manager = this.dataSource.manager;

    const rows = (await manager.query(
      `WITH scoped AS (
         SELECT cp.id, cp.name, cp.target_cash,
                ${cashSql('cp.id', ASOF, '$3')} AS cash
           FROM collection_points cp
          WHERE cp.is_active = true
            AND ($1::uuid IS NULL OR cp.id = $1::uuid)
       )
       SELECT s.id AS collection_point_id, s.name,
              s.target_cash::text AS target_cash,
              s.cash::text        AS cash,
              -- NULL propagates: a point with no target gets a null shortfall
              -- with no CASE and no branch to forget.
              (s.target_cash - s.cash)::text AS shortfall,
              lt.status  AS latest_transfer_status,
              lt.sent_at AS latest_transfer_sent_at
         FROM scoped s
         LEFT JOIN LATERAL (
              SELECT t.status, t.sent_at
                FROM transfers t
               WHERE t.collection_point_id = s.id
                 AND t.voided_at IS NULL
               ORDER BY t.sent_at DESC, t.id DESC
               LIMIT 1) lt ON TRUE
        ORDER BY s.name ASC, s.id ASC
        LIMIT $4 OFFSET $5`,
      [pointId, query.as_of ?? null, this.tz.appTimezone, query.limit, skipOf(query)],
    )) as PointCashRow[];

    // The count runs over the same scope, so `total` and `data` cannot
    // disagree about what is listed. It does not need the formula.
    const [{ total }] = (await manager.query(
      `SELECT COUNT(*)::int AS total FROM collection_points cp
        WHERE cp.is_active = true AND ($1::uuid IS NULL OR cp.id = $1::uuid)`,
      [pointId],
    )) as { total: number }[];

    return {
      data: rows.map(toPointCashRowResponse),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
```

`PointCashService` takes NO clock — `ASOF` resolves today in SQL (see Task 7). Do not add `TimeService` here; both database specs construct the service with `new PointCashService(ds)`.

Add imports: `Paginated`, `skipOf`, `resolvePointFilter`, `ListPointCashQueryDto`, `PointCashRow`, `PointCashRowResponse`, `toPointCashRowResponse`, `AuthenticatedUser`.

- [ ] **Step 5: Run to verify it passes**

```bash
cd backend && npm run test:db -- src/point-cash/point-cash.db-spec.ts
```

Expected: PASS, 16 tests.

- [ ] **Step 6: Write the controller and register both modules**

`backend/src/point-cash/point-cash.controller.ts`:

```ts
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PointCashService } from './point-cash.service';
import { ListPointCashQueryDto } from './dto/list-point-cash.query';
import { assertOwnsPoint } from '../auth/access/point-scope';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * §7.1 and §7.10 — the point's drawer, and the network's debt to it.
 *
 * ONE ENDPOINT THAT WIDENS BY ROLE rather than two: «керівник відкриває той
 * самий екран каси, який бачить приймальник цієї точки, плюс свої блоки: одна
 * правда для обох, різна повнота».
 *
 * READ-ONLY, and there is no write here at all. §7.1 — «приймальник не змінює
 * жодної суми каси в програмі»; the only things that move it are documents in
 * other modules (§7.3's closed list).
 */
@Controller('point-cash')
export class PointCashController {
  constructor(private readonly cash: PointCashService) {}

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListPointCashQueryDto) {
    return this.cash.list(actor, query);
  }

  @Get(':pointId')
  @Auth()
  async findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('pointId', ParseUUIDPipe) pointId: string,
    @Query() query: ListPointCashQueryDto,
  ) {
    assertOwnsPoint(actor, pointId);
    return {
      collection_point_id: pointId,
      cash: await this.cash.cashFor(pointId, query.as_of),
    };
  }
}
```

Add `PointCashController` to `PointCashModule`'s `controllers`. Register **`PointCashModule`** in `backend/src/app.module.ts` after `TransfersModule` — `TransfersModule` was already registered in Task 3, so do not add it twice.

- [ ] **Step 7: Update `CLAUDE.md`**

In the **Architecture → Domain** bullet, move `transfers` out of the "remain" list into the implemented list, and change "Five tables remain" to "Four tables remain, all of them crates and counting: `crate_issuances`, `crate_returns`, `crate_return_allocations`, `cash_counts`."

- [ ] **Step 8: Full suite, build, commit**

```bash
cd /Users/glebvasilevskiy/Projects/webspirio/yagoda/web-starter
npm run lint
npm test
npm run test:db -w backend
npm run build
```

Expected: all green. Then:

```bash
git add backend/src CLAUDE.md
git commit -m "$(cat <<'MSG'
feat(point-cash): GET /point-cash, the screen both roles open

One endpoint that widens by role rather than two — §7.10's «одна правда
для обох, різна повнота».

A point with no target_cash KEEPS its row with a null shortfall,
diverging from §7.10's literal text: that rule was written about the
debt table, where a missing target leaves nothing to subtract from, and
hiding the row here would blind the owner to real money. Amended into
§7.10 on 09.09.2026.

The shortfall is subtracted by Postgres, where numeric is exact and NULL
propagates for free — no JavaScript arithmetic touches money anywhere in
this slice, and eslint now refuses it in both new directories.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Follow-ups this plan creates

Record these in `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` (or a new slice follow-ups file) as the last act of Task 8:

1. **The Friday/Saturday question is slice 2's**, and is stated in spec §12. `cashFor`'s `asOf` exists so slice 2 can express either answer.
2. **Go-live needs a ceremony**: one transfer per point for its opening balance, each accepted by its operator (spec §6.6). Belongs in the deployment notes.
3. **`PointKind` is still read by nothing.** Spec §8.3 declines to make this slice the first. If a later slice branches on it, §7.3 versus §4.8 must be settled with the client first.
