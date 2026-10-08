# Network Settings & the Receipt Note — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The network owner saves one text on a new `/settings` page; every receipt in the network prints it on its seven ruled lines.

**Architecture:** A one-row `network_settings` table with a typed `receipt_note` column, read by `GET /network-settings` (any signed-in user) and written by `PATCH /network-settings` (owner, audited). On the frontend a new `entities/network-settings` slice carries the read; `pages/settings` owns the editor (the wrap and the 7 × 40 field move there from `widgets/receipt`); the receipt drops its per-receipt field and prints the network's text.

**Tech Stack:** NestJS 11 + TypeORM + Postgres (backend, Jest); React 19 + TanStack Query v5 + react-i18next (frontend, Vitest + Testing Library).

**Spec:** `docs/superpowers/specs/2026-10-08-yagoda-network-settings.md`

## Global Constraints

- Branch: `fix/receipt-print-and-blank-lines` (PR #222). Work in the main checkout, no worktree.
- Table `network_settings`, column `receipt_note text NULL`, `updated_at timestamptz NOT NULL DEFAULT now()`, key `id boolean PRIMARY KEY DEFAULT true CHECK (id)`.
- Migration `backend/src/migrations/1788600000021-NetworkSettings.ts`, class `NetworkSettings1788600000021`.
- A note fits when it splits on `\n` into ≤ 7 lines of ≤ 40 characters (`String.length`) and contains no `\r` or `\t`. Otherwise 400 with code `RECEIPT_NOTE_TOO_LONG`.
- Blank or all-whitespace `receipt_note` is stored as `null`.
- Audit action `network-settings.updated`, `target_type: 'network_settings'`, `target_id: null`, written only when the value changes, in the write's transaction.
- `GET /network-settings` → `@Auth()`; `PATCH /network-settings` → `@Auth(UserRole.NetworkOwner)`.
- Frontend route `/settings`, owner-only, lazy (owner chunk), nav item last in «Управління».
- Every new i18n key exists in BOTH `uk.json` and `en.json`. Tests run in English.
- Lean code, short why-comments; match the surrounding file's comment density.
- **Deviation from spec §4.1, on purpose:** the fit check lives in a pure function the command calls (`canonicalReceiptNote`), not in a class-validator decorator. `ValidationPipe` here has no `exceptionFactory`, so a decorator can only produce a code-less 400, and the frontend banner keys on `code`. The DTO keeps the type check.
- **Deviation from spec §5.1:** `useNetworkSettingsQuery` has no `enabled: token` gate. An entity may not import `entities/user` (same-layer), and no other entity query gates on the token; every consumer renders behind `RequireAuth`.

## Review Focus

1. **Owner saves the same text again, or only whitespace when it was empty** → 200, no audit entry, and «Зберегти» goes disabled (Task 3 no-op test; Task 6 canonical-dirty test).
2. **Owner pastes text with tabs or Windows line endings past the UI** (a direct API call) → 400 `RECEIPT_NOTE_TOO_LONG`, nothing stored (Task 2 tests for `\t` and `\r`).
3. **Receipt opened before the settings read resolves, or when it fails** → print waits while pending; on failure a warning shows and print works with blank lines (Task 5 tests).
4. **Operator types `/settings` into the address bar** → redirected, the owner chunk is not fetched (Task 6 router tests).
5. **Two owner tabs save at once** → each diffs against the row under `FOR UPDATE`, so no audit entry claims a stale `before` (Task 3 asserts the lock is requested).

---

## File Structure

**Backend — create**
- `backend/src/migrations/1788600000021-NetworkSettings.ts` — the table and its one row.
- `backend/src/migrations/network-settings-schema.db-spec.ts` — shape against Postgres.
- `backend/src/network-settings/network-settings.entity.ts`
- `backend/src/network-settings/receipt-note.ts` (+ `.spec.ts`) — `canonicalReceiptNote`.
- `backend/src/network-settings/network-settings.mapper.ts`
- `backend/src/network-settings/dto/update-network-settings.dto.ts`
- `backend/src/network-settings/queries/get-network-settings.query.ts` (+ `.spec.ts`)
- `backend/src/network-settings/commands/update-network-settings.command.ts` (+ `.spec.ts`)
- `backend/src/network-settings/network-settings.controller.ts`
- `backend/src/network-settings/network-settings.module.ts`

**Backend — modify**
- `backend/src/app.module.ts` — import `NetworkSettingsModule`.
- `backend/src/audit/audit-log.entity.ts` — add `'network-settings.updated'`.

**Docs — modify**
- `28-db-schema.dbml`, `26-rules-by-example.md:2013`, `CLAUDE.md` (table count), `frontend/CLAUDE.md` (structure list).

**Frontend — create**
- `frontend/src/entities/network-settings/{index.ts, model/networkSettings.ts, api/useNetworkSettingsQuery.ts}`
- `frontend/src/pages/settings/index.ts`
- `frontend/src/pages/settings/lib/fitReceiptNote.ts` (+ test) — moved from `widgets/receipt/model/receiptNote.ts`.
- `frontend/src/pages/settings/ui/ReceiptNoteField.tsx` (+ test) — moved from `widgets/receipt/ui/`.
- `frontend/src/pages/settings/api/useUpdateNetworkSettingsMutation.ts`
- `frontend/src/pages/settings/ui/{SettingsPage.tsx, ReceiptNoteForm.tsx, SettingsPage.test.tsx}`

**Frontend — modify**
- `shared/api/queryKeys.ts`, `shared/lib/api-error/apiErrorToBanner.ts` (+ test)
- `app/owner-pages.ts`, `app/lazy-routes.ts`, `app/router.tsx`, `app/router.test.tsx`, `app/layouts/AppLayout.tsx`
- `widgets/receipt/ui/{ReceiptDialog.tsx, ReceiptSheet.tsx, ReceiptDialog.test.tsx}`
- `shared/lib/i18n/locales/{uk,en}.json`

---

### Task 1: Table, migration and the schema documents

**Files:**
- Create: `backend/src/migrations/1788600000021-NetworkSettings.ts`
- Create: `backend/src/migrations/network-settings-schema.db-spec.ts`
- Create: `backend/src/network-settings/network-settings.entity.ts`
- Modify: `28-db-schema.dbml` (append), `26-rules-by-example.md:2013-2016`, `CLAUDE.md` (Domain bullet)

**Interfaces:**
- Produces: entity `NetworkSettings { id: boolean; receipt_note: string | null; updated_at: Date }`; constraint names `PK_network_settings`, `CHK_network_settings_single_row`.

- [ ] **Step 1: Write the failing db-spec**

`backend/src/migrations/network-settings-schema.db-spec.ts`:

```ts
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/**
 * `NetworkSettings1788600000021` — the network's one settings row. What a
 * mocked spec cannot see: that the migration leaves exactly one row, and that
 * the key makes a second one impossible rather than merely unusual.
 */
describe('network_settings (Postgres)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await openTestDataSource();
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('holds exactly one row, created by the migration', async () => {
    const rows = (await ds.query(`SELECT id FROM network_settings`)) as { id: boolean }[];
    expect(rows).toEqual([{ id: true }]);
  });

  it('refuses a second row on the key', async () => {
    await expect(ds.query(`INSERT INTO network_settings DEFAULT VALUES`)).rejects.toThrow(
      /PK_network_settings/,
    );
  });

  it('refuses a row keyed false', async () => {
    await expect(ds.query(`INSERT INTO network_settings (id) VALUES (false)`)).rejects.toThrow(
      /CHK_network_settings_single_row/,
    );
  });

  it('keeps receipt_note nullable text', async () => {
    const [column] = (await ds.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'network_settings'
          AND column_name = 'receipt_note'`,
    )) as { data_type: string; is_nullable: string }[];
    expect(column).toEqual({ data_type: 'text', is_nullable: 'YES' });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd backend && npm run test:db -- network-settings-schema`
Expected: FAIL — `relation "network_settings" does not exist`. (Needs the dev Postgres up: `docker compose up -d postgres`.)

- [ ] **Step 3: Write the migration**

`backend/src/migrations/1788600000021-NetworkSettings.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The network's settings — one row, one typed column per setting. A new
 * setting is a new column, so the DBML keeps saying what is configurable.
 *
 * `id boolean … CHECK (id)`: the only key value allowed is `true`, so a second
 * row cannot exist. The row is inserted here, so nothing ever has to create it.
 *
 * `receipt_note` is stored ALREADY WRAPPED onto the receipt's ruled lines; the
 * command checks it fits (≤ 7 lines × ≤ 40 characters).
 */
export class NetworkSettings1788600000021 implements MigrationInterface {
  name = 'NetworkSettings1788600000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "network_settings" (
        "id" boolean NOT NULL DEFAULT true,
        "receipt_note" text,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_network_settings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_network_settings_single_row" CHECK ("id")
      )
    `);
    await queryRunner.query(`INSERT INTO "network_settings" DEFAULT VALUES`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "network_settings"`);
  }
}
```

- [ ] **Step 4: Write the entity**

`backend/src/network-settings/network-settings.entity.ts`:

```ts
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** The network's one settings row — see the migration for why `id` is a boolean. */
@Entity('network_settings')
export class NetworkSettings {
  @PrimaryColumn({ type: 'boolean', default: true })
  id: boolean;

  /** Already wrapped onto the receipt's ruled lines; `null` prints them blank. */
  @Column({ type: 'text', nullable: true })
  receipt_note: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
```

- [ ] **Step 5: Run the db-spec to make sure it passes**

Run: `cd backend && npm run test:db -- network-settings-schema`
Expected: PASS, 4 tests. (The harness runs pending migrations on `app_test`.)

- [ ] **Step 6: Update the schema documents**

Append to `28-db-schema.dbml`:

```
Table network_settings {
  id boolean [pk, default: true]

  receipt_note text

  updated_at timestamp [not null, default: `now()`]

  Note: '''
Налаштування мережі — ОДИН РЯДОК, по типізованій колонці на кожне налаштування. Нове
налаштування — нова колонка міграцією, тож ця схема й далі каже, що саме налаштовується.
`id` має лише одне дозволене значення (`CHECK (id)`), тому другого рядка бути не може; рядок
створює міграція.

receipt_note — текст на розлінованих рядках КОЖНОЇ квитанції мережі (7 рядків по 40
символів). Зберігається ВЖЕ РОЗКЛАДЕНИМ по рядках (`\n`); сервер перевіряє лише, що він
вміщається. NULL — рядки друкуються порожніми. Знімка в квитанції немає: передрук старої
квитанції друкує ПОТОЧНИЙ текст — §2.7 заморожує кілограми й гроші, а не цей текст.

Межа дод. ціни й поріг розписки сюди ще НЕ перенесені — їх і далі підставляє код.
'''
}
```

In `26-rules-by-example.md`, replace lines 2012-2016 (the «Примітка (схема, 03.09.2026)» paragraph) with:

```
→ **Примітка (схема, 03.09.2026; оновлено 08.10.2026):** жодне з цих порогових чисел у базі
**не зберігається** — ані межа дод. ціни, ані поріг розписки: їх підставляє код застосунку.
Тобто змінити межу чи поріг — це правка коду й нова збірка, а не запис у довіднику. Запис
налаштувань мережі тепер є (`network_settings`, 08.10.2026), але в ньому поки лише текст на
квитанції; ці два числа туди ще не перенесені.
```

In `CLAUDE.md`'s **Domain** bullet, after the `payout_allocations` clause, add `, plus \`network_settings\` (network settings slice, 2026-10-08 — spec \`docs/superpowers/specs/2026-10-08-yagoda-network-settings.md\`, plan \`docs/superpowers/plans/2026-10-08-yagoda-network-settings.md\`)` and change `**twenty-three tables in all**` to `**twenty-four tables in all**`.

Check: `grep -c "^Table " 28-db-schema.dbml` → `24`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/migrations/1788600000021-NetworkSettings.ts backend/src/migrations/network-settings-schema.db-spec.ts backend/src/network-settings/network-settings.entity.ts 28-db-schema.dbml 26-rules-by-example.md CLAUDE.md
git commit -m "feat(network-settings): the network's one settings row"
```

---

### Task 2: The fit check — `canonicalReceiptNote`

**Files:**
- Create: `backend/src/network-settings/receipt-note.ts`
- Test: `backend/src/network-settings/receipt-note.spec.ts`

**Interfaces:**
- Produces: `canonicalReceiptNote(value: string | null): string | null` — returns `null` for blank, the value unchanged when it fits, throws `BadRequestException({ code: 'RECEIPT_NOTE_TOO_LONG' })` otherwise. Constants `RECEIPT_NOTE_LINES = 7`, `RECEIPT_NOTE_LINE_CHARS = 40`.

- [ ] **Step 1: Write the failing spec**

`backend/src/network-settings/receipt-note.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { canonicalReceiptNote } from './receipt-note';

const line = (n: number, ch = 'x') => ch.repeat(n);
const lines = (count: number, width = 40) => Array.from({ length: count }, () => line(width)).join('\n');

function refusal(value: string): unknown {
  try {
    canonicalReceiptNote(value);
  } catch (e) {
    return e instanceof BadRequestException ? e.getResponse() : e;
  }
  return null;
}

describe('canonicalReceiptNote', () => {
  it('stores blank as null', () => {
    expect(canonicalReceiptNote(null)).toBeNull();
    expect(canonicalReceiptNote('')).toBeNull();
    expect(canonicalReceiptNote('  \n  ')).toBeNull();
  });

  it('keeps a note that fits, exactly as sent', () => {
    expect(canonicalReceiptNote(lines(7))).toBe(lines(7));
    expect(canonicalReceiptNote('Ящики повертати до 20:00  ')).toBe('Ящики повертати до 20:00  ');
  });

  it('counts a Cyrillic letter as one character', () => {
    expect(canonicalReceiptNote(line(40, 'ї'))).toBe(line(40, 'ї'));
  });

  it.each([
    ['an eighth line', lines(8)],
    ['a 41st character', line(41)],
    ['a tab', 'Тел.\t067'],
    ['a carriage return', 'перший\r\nдругий'],
  ])('refuses %s with RECEIPT_NOTE_TOO_LONG', (_, value) => {
    expect(refusal(value)).toMatchObject({ code: 'RECEIPT_NOTE_TOO_LONG' });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd backend && npm test -- receipt-note`
Expected: FAIL — `Cannot find module './receipt-note'`.

- [ ] **Step 3: Implement**

`backend/src/network-settings/receipt-note.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

/** The receipt's ruled lines — the frontend's `NOTE_LINES`/`NOTE_LINE_CHARS`. */
export const RECEIPT_NOTE_LINES = 7;
export const RECEIPT_NOTE_LINE_CHARS = 40;

/**
 * The editor wraps the note; this only checks the result fits the paper. A tab
 * prints eight columns wide and a `\r` is a line break the receipt would not
 * split on, so both are refused rather than clipped. Blank is stored as `null`.
 */
export function canonicalReceiptNote(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  const lines = value.split('\n');
  if (
    /[\r\t]/.test(value) ||
    lines.length > RECEIPT_NOTE_LINES ||
    lines.some((line) => line.length > RECEIPT_NOTE_LINE_CHARS)
  ) {
    throw new BadRequestException({
      message: `receipt_note must fit ${RECEIPT_NOTE_LINES} lines of ${RECEIPT_NOTE_LINE_CHARS} characters`,
      code: 'RECEIPT_NOTE_TOO_LONG',
    });
  }
  return value;
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `cd backend && npm test -- receipt-note`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/network-settings/receipt-note.ts backend/src/network-settings/receipt-note.spec.ts
git commit -m "feat(network-settings): check a receipt note fits the ruled lines"
```

---

### Task 3: Read and write endpoints

**Files:**
- Create: `backend/src/network-settings/network-settings.mapper.ts`
- Create: `backend/src/network-settings/dto/update-network-settings.dto.ts`
- Create: `backend/src/network-settings/queries/get-network-settings.query.ts` (+ `.spec.ts`)
- Create: `backend/src/network-settings/commands/update-network-settings.command.ts` (+ `.spec.ts`)
- Create: `backend/src/network-settings/network-settings.controller.ts`
- Create: `backend/src/network-settings/network-settings.module.ts`
- Modify: `backend/src/audit/audit-log.entity.ts:62` (after `'crate-return.voided',`)
- Modify: `backend/src/app.module.ts` (imports list + `imports: [...]`)

**Interfaces:**
- Consumes: `NetworkSettings` (Task 1), `canonicalReceiptNote` (Task 2), `AuditService.record(entry, manager)`, `diffFields(before, after, keys)`.
- Produces: `GET /network-settings` and `PATCH /network-settings` → `{ receipt_note: string | null; updated_at: string }` (ISO). Body `{ receipt_note?: string | null }`.

- [ ] **Step 1: Add the audit action**

In `backend/src/audit/audit-log.entity.ts`, after `'crate-return.voided',`, add:

```ts
  'network-settings.updated',
```

(If more actions follow `'crate-return.voided'`, add it as the last element before `] as const`.)

- [ ] **Step 2: Write the failing command spec**

`backend/src/network-settings/commands/update-network-settings.command.spec.ts`:

```ts
import { UpdateNetworkSettingsCommand } from './update-network-settings.command';
import { NetworkSettings } from '../network-settings.entity';
import { UserRole } from '../../users/user-role.enum';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

const OWNER = { sub: 'owner-1', role: UserRole.NetworkOwner, collection_point_id: null } as AuthenticatedUser;
const AT = new Date('2026-10-08T09:00:00.000Z');

describe('UpdateNetworkSettingsCommand', () => {
  let command: UpdateNetworkSettingsCommand;
  let manager: { findOneOrFail: jest.Mock; save: jest.Mock };
  let audit: { record: jest.Mock };

  const row = (receipt_note: string | null): NetworkSettings =>
    ({ id: true, receipt_note, updated_at: AT }) as NetworkSettings;

  beforeEach(() => {
    manager = {
      findOneOrFail: jest.fn().mockResolvedValue(row('стара')),
      save: jest.fn().mockImplementation((_e, r: NetworkSettings) => ({ ...r, updated_at: AT })),
    };
    audit = { record: jest.fn() };
    const dataSource = { transaction: jest.fn((fn: (m: unknown) => unknown) => fn(manager)) };
    command = new UpdateNetworkSettingsCommand(dataSource as never, audit as never);
  });

  it('reads the row under a write lock', async () => {
    await command.update(OWNER, { receipt_note: 'нова' });
    expect(manager.findOneOrFail).toHaveBeenCalledWith(NetworkSettings, {
      where: { id: true },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('saves a changed note and audits before and after in the same transaction', async () => {
    const result = await command.update(OWNER, { receipt_note: 'нова' });

    expect(result).toEqual({ receipt_note: 'нова', updated_at: AT.toISOString() });
    expect(manager.save).toHaveBeenCalledWith(NetworkSettings, expect.objectContaining({ receipt_note: 'нова' }));
    expect(audit.record).toHaveBeenCalledWith(
      {
        action: 'network-settings.updated',
        actor_id: 'owner-1',
        target_type: 'network_settings',
        target_id: null,
        before: { receipt_note: 'стара' },
        after: { receipt_note: 'нова' },
      },
      manager,
    );
  });

  it('writes nothing when the note did not change', async () => {
    const result = await command.update(OWNER, { receipt_note: 'стара' });
    expect(result.receipt_note).toBe('стара');
    expect(manager.save).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('treats whitespace as clearing, and an empty row as unchanged by it', async () => {
    manager.findOneOrFail.mockResolvedValue(row(null));
    await command.update(OWNER, { receipt_note: '   ' });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('clears the note with null', async () => {
    await command.update(OWNER, { receipt_note: null });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ before: { receipt_note: 'стара' }, after: { receipt_note: null } }),
      manager,
    );
  });

  it('leaves the note alone when the body omits it', async () => {
    await command.update(OWNER, {});
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('refuses a note that does not fit, before saving', async () => {
    await expect(command.update(OWNER, { receipt_note: 'x'.repeat(41) })).rejects.toMatchObject({
      response: { code: 'RECEIPT_NOTE_TOO_LONG' },
    });
    expect(manager.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Write the failing query spec**

`backend/src/network-settings/queries/get-network-settings.query.spec.ts`:

```ts
import { GetNetworkSettingsQuery } from './get-network-settings.query';

describe('GetNetworkSettingsQuery', () => {
  it('returns the one row', async () => {
    const at = new Date('2026-10-08T09:00:00.000Z');
    const repo = { findOneByOrFail: jest.fn().mockResolvedValue({ id: true, receipt_note: 'текст', updated_at: at }) };
    const query = new GetNetworkSettingsQuery(repo as never);

    await expect(query.get()).resolves.toEqual({ receipt_note: 'текст', updated_at: at.toISOString() });
    expect(repo.findOneByOrFail).toHaveBeenCalledWith({ id: true });
  });
});
```

- [ ] **Step 4: Run both to make sure they fail**

Run: `cd backend && npm test -- network-settings`
Expected: FAIL — `Cannot find module './update-network-settings.command'` and `'./get-network-settings.query'`.

- [ ] **Step 5: Implement mapper, DTO, query, command**

`backend/src/network-settings/network-settings.mapper.ts`:

```ts
import { NetworkSettings } from './network-settings.entity';

export interface NetworkSettingsResponse {
  receipt_note: string | null;
  updated_at: string;
}

export const toNetworkSettingsResponse = (s: NetworkSettings): NetworkSettingsResponse => ({
  receipt_note: s.receipt_note,
  updated_at: s.updated_at.toISOString(),
});
```

`backend/src/network-settings/dto/update-network-settings.dto.ts`:

```ts
import { IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * `null` clears the note. Whether it FITS the receipt is the command's check
 * (`canonicalReceiptNote`) — a validator here could only answer with a
 * code-less 400. `MaxLength` just stops an absurd body before it is split.
 */
export class UpdateNetworkSettingsDto {
  @ValidateIf((o: UpdateNetworkSettingsDto) => o.receipt_note !== undefined && o.receipt_note !== null)
  @IsString()
  @MaxLength(1000)
  receipt_note?: string | null;
}
```

`backend/src/network-settings/queries/get-network-settings.query.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NetworkSettings } from '../network-settings.entity';
import { NetworkSettingsResponse, toNetworkSettingsResponse } from '../network-settings.mapper';

@Injectable()
export class GetNetworkSettingsQuery {
  constructor(
    @InjectRepository(NetworkSettings)
    private readonly repo: Repository<NetworkSettings>,
  ) {}

  /** The migration inserts the only row, so there is no "not created yet". */
  async get(): Promise<NetworkSettingsResponse> {
    return toNetworkSettingsResponse(await this.repo.findOneByOrFail({ id: true }));
  }
}
```

`backend/src/network-settings/commands/update-network-settings.command.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { NetworkSettings } from '../network-settings.entity';
import { UpdateNetworkSettingsDto } from '../dto/update-network-settings.dto';
import { NetworkSettingsResponse, toNetworkSettingsResponse } from '../network-settings.mapper';
import { canonicalReceiptNote } from '../receipt-note';
import { AuditService } from '../../audit/audit.service';
import { diffFields } from '../../common/diff-fields';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

@Injectable()
export class UpdateNetworkSettingsCommand {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async update(actor: AuthenticatedUser, dto: UpdateNetworkSettingsDto): Promise<NetworkSettingsResponse> {
    return this.dataSource.transaction(async (m) => {
      // Locked, so two owners saving at once each diff against the other's write.
      const before = await m.findOneOrFail(NetworkSettings, {
        where: { id: true },
        lock: { mode: 'pessimistic_write' },
      });
      const next = { ...before };
      if (dto.receipt_note !== undefined) next.receipt_note = canonicalReceiptNote(dto.receipt_note);

      const diff = diffFields(before, next, ['receipt_note']);
      if (!diff) return toNetworkSettingsResponse(before);

      const saved = await m.save(NetworkSettings, next);
      await this.audit.record(
        {
          action: 'network-settings.updated',
          actor_id: actor.sub,
          // One row with a boolean key; `target_id` is a uuid column, so it stays null.
          target_type: 'network_settings',
          target_id: null,
          before: diff.before,
          after: diff.after,
        },
        m,
      );
      return toNetworkSettingsResponse(saved);
    });
  }
}
```

- [ ] **Step 6: Run the specs to make sure they pass**

Run: `cd backend && npm test -- network-settings`
Expected: PASS — command 7 tests, query 1, receipt-note 7.

- [ ] **Step 7: Controller and module**

`backend/src/network-settings/network-settings.controller.ts`:

```ts
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user-role.enum';
import { GetNetworkSettingsQuery } from './queries/get-network-settings.query';
import { UpdateNetworkSettingsCommand } from './commands/update-network-settings.command';
import { UpdateNetworkSettingsDto } from './dto/update-network-settings.dto';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/** Read by everyone — the operator prints the receipts; written by the owner only. */
@Controller('network-settings')
export class NetworkSettingsController {
  constructor(
    private readonly getSettings: GetNetworkSettingsQuery,
    private readonly updateSettings: UpdateNetworkSettingsCommand,
  ) {}

  @Get()
  @Auth()
  get() {
    return this.getSettings.get();
  }

  @Patch()
  @Auth(UserRole.NetworkOwner)
  update(@CurrentUser() actor: AuthenticatedUser, @Body() dto: UpdateNetworkSettingsDto) {
    return this.updateSettings.update(actor, dto);
  }
}
```

`backend/src/network-settings/network-settings.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NetworkSettings } from './network-settings.entity';
import { NetworkSettingsController } from './network-settings.controller';
import { GetNetworkSettingsQuery } from './queries/get-network-settings.query';
import { UpdateNetworkSettingsCommand } from './commands/update-network-settings.command';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([NetworkSettings]), AuditModule],
  controllers: [NetworkSettingsController],
  providers: [GetNetworkSettingsQuery, UpdateNetworkSettingsCommand],
})
export class NetworkSettingsModule {}
```

In `backend/src/app.module.ts` add `import { NetworkSettingsModule } from './network-settings/network-settings.module';` after the `DayCostsModule` import, and `NetworkSettingsModule,` after `DayCostsModule,` in the `imports` array.

- [ ] **Step 8: Typecheck, lint and the backend suite**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json && npx eslint src/network-settings src/audit src/app.module.ts && npm test -- network-settings`
Expected: no tsc output, no eslint output, specs PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/network-settings backend/src/audit/audit-log.entity.ts backend/src/app.module.ts
git commit -m "feat(network-settings): GET and owner-only PATCH /network-settings, audited"
```

---

### Task 4: `entities/network-settings`

**Files:**
- Create: `frontend/src/entities/network-settings/model/networkSettings.ts`
- Create: `frontend/src/entities/network-settings/api/useNetworkSettingsQuery.ts`
- Create: `frontend/src/entities/network-settings/index.ts`
- Modify: `frontend/src/shared/api/queryKeys.ts` (append before the closing `};`)

**Interfaces:**
- Produces: `NetworkSettings` type, `NOTE_LINES = 7`, `NOTE_LINE_CHARS = 40`, `useNetworkSettingsQuery()`, `queryKeys.networkSettings = ['network-settings']`.

No test of its own: a `useQuery` wrapper with no logic; Tasks 5 and 6 exercise it through their consumers.

- [ ] **Step 1: Query key**

In `frontend/src/shared/api/queryKeys.ts`, after `dayExpenses`:

```ts
  /** The network's one settings row (`/network-settings`); a save seeds it from the response. */
  networkSettings: ['network-settings'] as const,
```

- [ ] **Step 2: Model**

`frontend/src/entities/network-settings/model/networkSettings.ts`:

```ts
/** The receipt's ruled lines: seven, forty monospace characters each — what
 *  fits the slip on paper. The backend refuses a note past either. */
export const NOTE_LINES = 7;
export const NOTE_LINE_CHARS = 40;

export interface NetworkSettings {
  /** Already wrapped onto the lines with `\n`; `null` prints them blank. */
  receipt_note: string | null;
  updated_at: string;
}
```

- [ ] **Step 3: Query**

`frontend/src/entities/network-settings/api/useNetworkSettingsQuery.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { STALE } from '@/shared/api/queryClient';
import { queryKeys } from '@/shared/api/queryKeys';
import type { NetworkSettings } from '../model/networkSettings';

/** Read by every receipt and by the owner's settings page. */
export function useNetworkSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.networkSettings,
    staleTime: STALE.reference,
    queryFn: async (): Promise<NetworkSettings> => {
      const { data } = await httpClient.get<NetworkSettings>('/network-settings');
      return data;
    },
  });
}
```

- [ ] **Step 4: Barrel**

`frontend/src/entities/network-settings/index.ts`:

```ts
export type { NetworkSettings } from './model/networkSettings';
export { NOTE_LINES, NOTE_LINE_CHARS } from './model/networkSettings';
export { useNetworkSettingsQuery } from './api/useNetworkSettingsQuery';
```

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/entities/network-settings frontend/src/shared/api/queryKeys.ts
git commit -m "feat(network-settings): the settings read on the frontend"
```

---

### Task 5: The receipt prints the network's note

**Files:**
- Modify: `frontend/src/widgets/receipt/ui/ReceiptSheet.tsx` (import line 4, prop at line 45, `noteLines` at line 104)
- Modify: `frontend/src/widgets/receipt/ui/ReceiptDialog.tsx`
- Modify: `frontend/src/widgets/receipt/ui/ReceiptDialog.test.tsx`
- Modify: `frontend/src/shared/lib/i18n/locales/{uk,en}.json`

**Interfaces:**
- Consumes: `useNetworkSettingsQuery`, `NOTE_LINES` (Task 4).
- Produces: `ReceiptSheet` prop `note: string | null`. Leaves `widgets/receipt/model/receiptNote.ts` and `ui/ReceiptNoteField.tsx` unimported, for Task 6 to move.

- [ ] **Step 1: Write the failing tests**

In `ReceiptDialog.test.tsx`:

Add `settingsMock: vi.fn(),` to the `vi.hoisted` object and to its destructuring, and add:

```tsx
vi.mock('@/entities/network-settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/entities/network-settings')>()),
  useNetworkSettingsQuery: () => settingsMock(),
}));
```

In `setUp`, add a `note = null` option (typed `note?: string | null`) and:

```tsx
  settingsMock.mockReturnValue({
    data: { receipt_note: note, updated_at: '2026-10-08T09:00:00.000Z' },
    isPending: false,
    isError: false,
  });
```

Delete the three typed-note tests: «prints the typed note onto the ruled lines and takes nothing past the seventh», «keeps the caret in place when a hard cut lands after it», and «leaves the blank lines blank after a short note, and forgets it on close». Add in their place:

```tsx
  it("prints the network's note on the ruled lines, blank after it", () => {
    setUp({ note: 'Ящики повертати до 20:00\nТел. 067 000 00 00' });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    const tail = document.querySelector('.printable')?.lastElementChild;
    expect(Array.from(tail?.children ?? [], (line) => line.textContent)).toEqual([
      'Ящики повертати до 20:00',
      'Тел. 067 000 00 00',
      ...Array(5).fill(' '),
    ]);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('waits to print until the note has loaded', () => {
    setUp();
    settingsMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled();
  });

  it('warns and still prints, with blank lines, when the note fails to load', () => {
    setUp();
    settingsMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByText(/note didn't load/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled();
    const tail = document.querySelector('.printable')?.lastElementChild;
    expect(Array.from(tail?.children ?? [], (line) => line.textContent)).toEqual(Array(7).fill(' '));
  });
```

(Check the print button's English label in `en.json` → `receipt.print`; use that string if it is not `Print`.)

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd frontend && npx vitest run src/widgets/receipt`
Expected: the three new tests FAIL — the dialog still shows the typed-note field and ignores the settings.

- [ ] **Step 2a: Locale key**

Inside `receipt` add, in `en.json`: `"noteLoadFailed": "The network's note didn't load — the ruled lines will print blank."`; in `uk.json`: `"noteLoadFailed": "Примітку мережі не вдалося завантажити — рядки надрукуються порожніми."`. Leave `receipt.note` in place — the unimported field still names it until Task 6 moves it.

- [ ] **Step 3: ReceiptSheet takes the stored note**

In `ReceiptSheet.tsx`:
- line 4: `import { NOTE_LINES } from '@/entities/network-settings';`
- the prop type: `note: string | null;`
- line 104: `const noteLines = note?.split('\n') ?? [];`
- the ruled-lines comment: `{/* Ruled lines: the network's note first, then blank ones for handwriting; they also feed the slip past the tear bar. */}`

- [ ] **Step 4: ReceiptDialog reads the settings**

In `ReceiptDialog.tsx`:
- replace `import { ReceiptNoteField } from './ReceiptNoteField';` with `import { useNetworkSettingsQuery } from '@/entities/network-settings';` (placed with the other `@/entities/*` imports);
- after `const me = meQuery.data;` add:

```tsx
  // Not part of `isError`: a missing note must never stop a supplier's receipt.
  const settingsQuery = useNetworkSettingsQuery();
```

- delete the two lines `const [note, setNote] = useState('');` / `if (!open && note !== '') setNote('');` and their comment;
- in `content`, replace `note={note}` with `note={settingsQuery.data?.receipt_note ?? null}`, and replace `<ReceiptNoteField value={note} onChange={setNote} />` with:

```tsx
        {settingsQuery.isError ? (
          <p className="print-hide text-sm text-muted-foreground">{t('receipt.noteLoadFailed')}</p>
        ) : null}
```

- the print button gets `disabled={settingsQuery.isPending}`.

- [ ] **Step 5: Run the receipt tests to make sure they pass**

Run: `cd frontend && npx vitest run src/widgets/receipt`
Expected: PASS.

- [ ] **Step 6: Typecheck and lint the widget**

Run: `cd frontend && npx tsc -b --noEmit && npx eslint src/widgets/receipt`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/widgets/receipt frontend/src/shared/lib/i18n/locales
git commit -m "feat(receipt): print the network's note on the ruled lines"
```

---

### Task 6: The `/settings` page

**Files:**
- Move: `frontend/src/widgets/receipt/model/receiptNote.ts` → `frontend/src/pages/settings/lib/fitReceiptNote.ts`
- Move: `frontend/src/widgets/receipt/model/receiptNote.test.ts` → `frontend/src/pages/settings/lib/fitReceiptNote.test.ts`
- Move: `frontend/src/widgets/receipt/ui/ReceiptNoteField.tsx` → `frontend/src/pages/settings/ui/ReceiptNoteField.tsx`
- Create: `frontend/src/pages/settings/ui/ReceiptNoteField.test.tsx`
- Create: `frontend/src/pages/settings/api/useUpdateNetworkSettingsMutation.ts`
- Create: `frontend/src/pages/settings/ui/ReceiptNoteForm.tsx`
- Create: `frontend/src/pages/settings/ui/SettingsPage.tsx`, `SettingsPage.test.tsx`
- Create: `frontend/src/pages/settings/index.ts`
- Modify: `frontend/src/shared/lib/api-error/apiErrorToBanner.ts` (+ `.test.ts`)
- Modify: `frontend/src/app/{owner-pages.ts, lazy-routes.ts, router.tsx, router.test.tsx, layouts/AppLayout.tsx}`
- Modify: `frontend/src/shared/lib/i18n/locales/{uk,en}.json`

**Interfaces:**
- Consumes: `useNetworkSettingsQuery`, `NOTE_LINES`, `NOTE_LINE_CHARS`, `NetworkSettings` (Task 4); `PATCH /network-settings` (Task 3).
- Produces: `fitReceiptNote(text: string): string | null` in `pages/settings/lib`; `SettingsPage` exported from `@/pages/settings`. After Task 5 nothing in `widgets/receipt` imports these two files any more, so moving them leaves the widget compiling.

- [ ] **Step 1: Move the wrap and the field**

```bash
cd frontend/src
mkdir -p pages/settings/lib pages/settings/ui pages/settings/api
git mv widgets/receipt/model/receiptNote.ts pages/settings/lib/fitReceiptNote.ts
git mv widgets/receipt/model/receiptNote.test.ts pages/settings/lib/fitReceiptNote.test.ts
git mv widgets/receipt/ui/ReceiptNoteField.tsx pages/settings/ui/ReceiptNoteField.tsx
```

Replace the head of `pages/settings/lib/fitReceiptNote.ts` (the two `export const` lines and their comment) so the constants come from the entity:

```ts
import { NOTE_LINE_CHARS, NOTE_LINES } from '@/entities/network-settings';
```

(The `fitReceiptNote` function body stays unchanged.)

In `pages/settings/lib/fitReceiptNote.test.ts`, change the import to:

```ts
import { NOTE_LINE_CHARS, NOTE_LINES } from '@/entities/network-settings';
import { fitReceiptNote } from './fitReceiptNote';
```

Replace `pages/settings/ui/ReceiptNoteField.tsx` with:

```tsx
import { useTranslation } from 'react-i18next';
import { NOTE_LINE_CHARS, NOTE_LINES } from '@/entities/network-settings';
import { fitReceiptNote } from '../lib/fitReceiptNote';
import { Field } from '@/shared/ui/field';
import { Textarea } from '@/shared/ui/textarea';

/**
 * The network's note, in the paper's shape (7 × 40, monospace): a long line
 * breaks onto the next by itself, and a keystroke that would need an eighth
 * line is simply not taken.
 */
export function ReceiptNoteField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const used = value === '' ? 0 : value.split('\n').length;

  return (
    <Field
      name="receipt_note"
      label={t('settings.receipt.label')}
      hint={`${t('settings.receipt.hint')} · ${t('settings.receipt.lines', { n: used, max: NOTE_LINES })}`}
    >
      {(a11y) => (
        <Textarea
          {...a11y}
          rows={NOTE_LINES}
          cols={NOTE_LINE_CHARS}
          wrap="off"
          // Lines break only where fitReceiptNote puts a \n, so the box needn't
          // match the paper's 13px — and below 16px iOS zooms on focus.
          className="font-mono"
          value={value}
          onChange={(e) => {
            const box = e.currentTarget;
            const fitted = fitReceiptNote(box.value);
            if (fitted === null) {
              // Refused: React restores `value`; put the caret back where it was.
              const caret = box.selectionStart - (box.value.length - value.length);
              requestAnimationFrame(() => box.setSelectionRange(caret, caret));
              return;
            }
            // Only breaks before the caret move it; the wrap runs left to right,
            // so fitting the text before the caret counts exactly those.
            const caret =
              fitReceiptNote(box.value.slice(0, box.selectionStart))?.length ?? box.selectionStart;
            onChange(fitted);
            requestAnimationFrame(() => box.setSelectionRange(caret, caret));
          }}
        />
      )}
    </Field>
  );
}
```

- [ ] **Step 2: i18n keys**

In `frontend/src/shared/lib/i18n/locales/en.json`:
- delete the `receipt.note` object (`label`/`hint`/`lines`);
- add `"settings": "Settings"` inside `nav`;
- add a top-level block:

```json
  "settings": {
    "eyebrow": "Network",
    "title": "Network settings",
    "description": "Apply at every collection point.",
    "receipt": {
      "title": "Receipt",
      "label": "Note on every receipt",
      "hint": "printed on the ruled lines of every receipt in the network",
      "lines": "Line {{n}} of {{max}}"
    },
    "saved": "Settings saved",
    "errors": {
      "failed": "Could not save the settings",
      "noteTooLong": "The note doesn't fit seven lines of forty characters."
    }
  },
```

In `uk.json`, the same keys:
- delete `receipt.note`;
- `nav.settings`: `"Налаштування"`;
- block:

```json
  "settings": {
    "eyebrow": "Мережа",
    "title": "Налаштування мережі",
    "description": "Діють на всіх точках мережі.",
    "receipt": {
      "title": "Квитанція",
      "label": "Примітка на квитанціях",
      "hint": "друкується в розлінованих рядках на всіх квитанціях мережі",
      "lines": "Рядок {{n}} з {{max}}"
    },
    "saved": "Налаштування збережено",
    "errors": {
      "failed": "Не вдалося зберегти налаштування",
      "noteTooLong": "Примітка не вміщається в сім рядків по сорок символів."
    }
  },
```

- [ ] **Step 3: Field test (moved from the receipt)**

`frontend/src/pages/settings/ui/ReceiptNoteField.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReceiptNoteField } from './ReceiptNoteField';

function Controlled() {
  const [value, setValue] = useState('');
  return <ReceiptNoteField value={value} onChange={setValue} />;
}

const box = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Note on every receipt' });

describe('ReceiptNoteField', () => {
  it('wraps a long line at its last space and takes nothing past the seventh', async () => {
    const user = userEvent.setup();
    render(<Controlled />);

    await user.type(box(), `${'a'.repeat(30)} ${'b'.repeat(15)}`);
    await user.type(box(), '{Enter}3{Enter}4{Enter}5{Enter}6{Enter}7');
    await user.type(box(), '{Enter}'); // an eighth line is not taken

    expect(box()).toHaveValue([`${'a'.repeat(30)}`, `${'b'.repeat(15)}`, '3', '4', '5', '6', '7'].join('\n'));
    expect(screen.getByText(/Line 7 of 7/)).toBeInTheDocument();
  });

  it('keeps the caret in place when a hard cut lands after it', async () => {
    const user = userEvent.setup();
    render(<Controlled />);

    await user.type(box(), 'x'.repeat(40));
    await user.type(box(), 'y', { initialSelectionStart: 5, initialSelectionEnd: 5 });
    expect(box()).toHaveValue(`xxxxxy${'x'.repeat(34)}\nx`);
    await waitFor(() => expect(box().selectionStart).toBe(6));
  });
});
```

- [ ] **Step 4: Mutation**

`frontend/src/pages/settings/api/useUpdateNetworkSettingsMutation.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { NetworkSettings } from '@/entities/network-settings';

export interface UpdateNetworkSettingsInput {
  receipt_note: string | null;
}

export function useUpdateNetworkSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateNetworkSettingsInput): Promise<NetworkSettings> => {
      const { data } = await httpClient.patch<NetworkSettings>('/network-settings', input);
      return data;
    },
    // The response IS the new row — every receipt reads it from this cache entry.
    onSuccess: (settings) => queryClient.setQueryData(queryKeys.networkSettings, settings),
  });
}
```

- [ ] **Step 5: Banner code**

In `frontend/src/shared/lib/api-error/apiErrorToBanner.ts`, in `CODE` after `TARE_TYPE_UNKNOWN`:

```ts
  // Network settings — the note does not fit the receipt's ruled lines. The
  // editor wraps as the owner types, so this is reachable only past the UI.
  RECEIPT_NOTE_TOO_LONG: 'settings.errors.noteTooLong',
```

In `apiErrorToBanner.test.ts`, inside the top-level `describe('apiErrorToBanner', …)`, add:

```ts
  it('maps RECEIPT_NOTE_TOO_LONG to the settings sentence', () => {
    expect(apiErrorToBanner(apiError(400, 'RECEIPT_NOTE_TOO_LONG'), 'settings.errors.failed')).toBe(
      'settings.errors.noteTooLong',
    );
  });
```

- [ ] **Step 6: Write the failing page test**

`frontend/src/pages/settings/ui/SettingsPage.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from './SettingsPage';

const { queryMock, mutateMock } = vi.hoisted(() => ({ queryMock: vi.fn(), mutateMock: vi.fn() }));

vi.mock('@/entities/network-settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/entities/network-settings')>()),
  useNetworkSettingsQuery: () => queryMock(),
}));
vi.mock('../api/useUpdateNetworkSettingsMutation', () => ({
  useUpdateNetworkSettingsMutation: () => ({ mutateAsync: mutateMock, isPending: false }),
}));

const loaded = (receipt_note: string | null) => ({
  data: { receipt_note, updated_at: '2026-10-08T09:00:00.000Z' },
  isPending: false,
  isError: false,
});
const box = () => screen.getByRole('textbox', { name: 'Note on every receipt' });
const save = () => screen.getByRole('button', { name: 'Save' });

beforeEach(() => {
  queryMock.mockReset().mockReturnValue(loaded('Ящики до 20:00'));
  mutateMock.mockReset().mockResolvedValue({ receipt_note: null, updated_at: '2026-10-08T10:00:00.000Z' });
});

describe('SettingsPage', () => {
  it('shows the saved note with Save disabled until it changes', () => {
    render(<SettingsPage />);
    expect(box()).toHaveValue('Ящики до 20:00');
    expect(save()).toBeDisabled();
  });

  it('sends the wrapped note', async () => {
    const user = userEvent.setup();
    queryMock.mockReturnValue(loaded(null));
    render(<SettingsPage />);

    await user.type(box(), `${'a'.repeat(30)} ${'b'.repeat(15)}`);
    await user.click(save());

    expect(mutateMock).toHaveBeenCalledWith({ receipt_note: `${'a'.repeat(30)}\n${'b'.repeat(15)}` });
  });

  it('sends null when the note is cleared', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.clear(box());
    await user.click(save());

    expect(mutateMock).toHaveBeenCalledWith({ receipt_note: null });
  });

  it('keeps Save disabled for whitespace over an empty note', async () => {
    const user = userEvent.setup();
    queryMock.mockReturnValue(loaded(null));
    render(<SettingsPage />);

    await user.type(box(), '   ');
    expect(save()).toBeDisabled();
  });

  it('shows a banner when the save fails', async () => {
    const user = userEvent.setup();
    mutateMock.mockRejectedValue(new Error('network'));
    render(<SettingsPage />);

    await user.type(box(), '!');
    await user.click(save());

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the settings');
  });

  it('says so when the settings fail to load', () => {
    queryMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<SettingsPage />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
```

- [ ] **Step 7: Run it to make sure it fails**

Run: `cd frontend && npx vitest run src/pages/settings`
Expected: `SettingsPage.test.tsx` FAILS — `Failed to resolve import "./SettingsPage"`; the field and wrap tests PASS.

- [ ] **Step 8: Implement the form, the page and the barrel**

`frontend/src/pages/settings/ui/ReceiptNoteForm.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/shared/ui/section-card';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import { useUpdateNetworkSettingsMutation } from '../api/useUpdateNetworkSettingsMutation';
import { ReceiptNoteField } from './ReceiptNoteField';

/** Mounted with the saved note; the page remounts it after each save (`key`). */
export function ReceiptNoteForm({ saved }: { saved: string }) {
  const { t } = useTranslation();
  const [note, setNote] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const mutation = useUpdateNetworkSettingsMutation();

  // Blank is stored as null, so whitespace over an empty note is no change.
  const next = note.trim() === '' ? null : note;
  const dirty = (next ?? '') !== saved;

  const submit = async () => {
    setError(null);
    try {
      await mutation.mutateAsync({ receipt_note: next });
      toast.success(t('settings.saved'));
    } catch (e) {
      setError(apiErrorToBanner(e, 'settings.errors.failed'));
    }
  };

  return (
    <SectionCard title={t('settings.receipt.title')}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <ReceiptNoteField value={note} onChange={setNote} />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t(error)}
          </p>
        ) : null}
        <Button type="submit" disabled={!dirty || mutation.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </SectionCard>
  );
}
```

`frontend/src/pages/settings/ui/SettingsPage.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/shared/ui/page-header';
import { Spinner } from '@/shared/ui/spinner';
import { useNetworkSettingsQuery } from '@/entities/network-settings';
import { ReceiptNoteForm } from './ReceiptNoteForm';

/** «Налаштування мережі» — owner-only (route gate). One card per setting. */
export function SettingsPage() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useNetworkSettingsQuery();

  return (
    <>
      <PageHeader
        eyebrow={t('settings.eyebrow')}
        title={t('settings.title')}
        description={t('settings.description')}
      />
      {isError ? (
        <p role="alert" className="text-destructive">
          {t('common.somethingWentWrong')}
        </p>
      ) : isPending ? (
        <Spinner />
      ) : (
        // A save seeds a new `updated_at`, which remounts the form on the saved text.
        <ReceiptNoteForm key={data.updated_at} saved={data.receipt_note ?? ''} />
      )}
    </>
  );
}
```

`frontend/src/pages/settings/index.ts`:

```ts
export { SettingsPage } from './ui/SettingsPage';
```

- [ ] **Step 9: Run the page tests to make sure they pass**

Run: `cd frontend && npx vitest run src/pages/settings src/shared/lib/api-error`
Expected: PASS.

- [ ] **Step 10: Route, lazy chunk and nav — failing router tests first**

In `frontend/src/app/router.test.tsx`, add next to the other `vi.mock('@/pages/…')` calls:

```tsx
vi.mock('@/pages/settings', () => ({
  SettingsPage: () => <p>settings page</p>,
}));
```

and after the `/cost-of-day` pair:

```tsx
  it('keeps /settings away from an operator', async () => {
    useSession.setState({ token: 'tok' });
    meMock.mockReturnValue({
      data: { role: 'point_operator', display_name: 'Оператор Тест' },
      isPending: false,
      isError: false,
    });
    renderAt('/settings');
    expect(await screen.findByRole('heading', { name: /summary/i })).toBeInTheDocument();
    expect(screen.queryByText('settings page')).not.toBeInTheDocument();
  });

  it('lets an owner onto /settings', async () => {
    useSession.setState({ token: 'tok' });
    meMock.mockReturnValue({
      data: { role: 'network_owner', display_name: 'Керівник Тест' },
      isPending: false,
      isError: false,
    });
    renderAt('/settings');
    expect(await screen.findByText('settings page')).toBeInTheDocument();
  });
```

Run: `cd frontend && npx vitest run src/app/router.test.tsx`
Expected: the owner case FAILS (renders the 404).

- [ ] **Step 11: Wire the route**

`frontend/src/app/owner-pages.ts` — append:

```ts
export { SettingsPage } from '@/pages/settings';
```

`frontend/src/app/lazy-routes.ts` — append:

```ts
export const SettingsPage = lazy(() => ownerPages().then((m) => ({ default: m.SettingsPage })));
```

`frontend/src/app/router.tsx` — add `SettingsPage,` to the `./lazy-routes` import (alphabetical, after `ReweighPage,`), change the comment's «seven screens» to «eight screens», and after the `/cost-of-day` route object add:

```tsx
      {
        path: '/settings',
        element: (
          <RequireAuth>
            <RequireRole role="network_owner">
              <SettingsPage />
            </RequireRole>
          </RequireAuth>
        ),
      },
```

`frontend/src/app/layouts/AppLayout.tsx` — add `Settings,` to the `lucide-react` import (after `Scale,`), and as the last item of the `nav.group.management` group, after `nav.refs`:

```tsx
      { labelKey: 'nav.settings', icon: Settings, to: '/settings' },
```

- [ ] **Step 12: Run the app tests, typecheck and lint**

Run: `cd frontend && npx vitest run src/app src/pages/settings && npx tsc -b --noEmit && npx eslint src/app src/pages/settings src/entities/network-settings`
Expected: tests PASS; no tsc or eslint output.

- [ ] **Step 12a: Update `frontend/CLAUDE.md`**

In the Structure tree, add after the `entities/day-expense/` line:

```
  entities/network-settings/      # useNetworkSettingsQuery, NetworkSettings type, NOTE_LINES / NOTE_LINE_CHARS — the network's one settings row; `receipt_note` (already wrapped onto the receipt's 7 × 40 ruled lines) is read by widgets/receipt and edited on pages/settings
```

and after the `pages/cost-of-day/` line:

```
  pages/settings/                 # «Налаштування мережі» — OWNER-ONLY, one SectionCard per setting; today the receipt note: ReceiptNoteField wraps as the owner types (lib/fitReceiptNote), «Зберегти» sends `PATCH /network-settings` and seeds the cache
```

In the `widgets/receipt/` line, append: `; the seven ruled lines print the network's \`receipt_note\` (entities/network-settings) — print waits while it loads and goes ahead with blank lines if it fails`.

- [ ] **Step 12b: Whole frontend suite**

Run: `cd frontend && npm test && npm run lint`
Expected: all test files pass; lint clean.

- [ ] **Step 13: Commit**

```bash
git add -A frontend/src/pages/settings frontend/src/widgets/receipt frontend/src/app frontend/src/shared/lib/api-error frontend/src/shared/lib/i18n/locales frontend/CLAUDE.md
git commit -m "feat(settings): owner page for the network's receipt note"
```

---

### Task 7: Gate

- [ ] **Step 1: Full tier** (a migration is in the change)

Run: `npm run verify:full`
Expected: verdict line `ok=true`. Name every `SKIPPED` row and why in the hand-off; do not call it all green if any row was skipped.

- [ ] **Step 2: If a row is red**, read its output in `.verify/last-run.json` before rerunning. Fix the code, never a baseline.
