# Yagoda Catalog Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three catalog tables — `products`, `product_grades`, `tare_types` — as two backend modules with owner-only writes and case-insensitive name uniqueness.

**Architecture:** Two NestJS feature modules following this repo's existing flat shape (`<name>.service.ts` / `.controller.ts` / `.mapper.ts` / `dto/`, entity co-located). `ProductsModule` owns two entities (`Product`, `ProductGrade`) because they are one aggregate; `TareTypesModule` owns one. One hand-written migration creates all three tables plus four `lower(name)` unique indexes, and retrofits `collection_points` onto the fourth. Two shared helpers are extracted first so three new modules cannot copy known defects.

**Tech Stack:** NestJS 11, TypeORM 1.1, PostgreSQL, class-validator 0.15 / class-transformer 0.5, Jest (two suites: `npm test` mocked, `npm run test:db` against a real Postgres).

**Spec:** `docs/superpowers/specs/2026-09-06-yagoda-catalog-slice.md`

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from the spec.

- **`numeric` is a `string` end to end** — database, entity, DTO, JSON. Never a `number`. No arithmetic operator is applied to any monetary or weight value in this slice. (Foundation spec §5.1.)
- **Timestamps are `timestamptz`**; entities use `@CreateDateColumn({ type: 'timestamptz' })` / `@UpdateDateColumn({ type: 'timestamptz' })`.
- **Names are trimmed, never lowercased.** Storage preserves the owner's capitalization; only *comparison* folds case. (`normalize-login.ts` doc comment.)
- **`@Length(1, 128)` on every name.** All-whitespace is a 400 before the uniqueness check and before the save.
- **No `DELETE` route anywhere, ever.** Deactivation is the only removal verb; `products` does not even have that.
- **No `GET /:id` on any of the three tables.**
- **`ORDER BY name ASC`** on every list. There is no `display_order` column in this slice.
- **List DTOs extend `PaginationQueryDto` and override `limit` to default 100**, `@Max(100)` unchanged, returning `Paginated<T>`.
- **Reads `@Auth()` (both roles); writes `@Auth(UserRole.NetworkOwner)`.**
- **Every write is wrapped in `dataSource.transaction()` and passes the `EntityManager` to `audit.record()`.**
- **Entities carry NO `@Unique` decorator on any name column.** A `lower(name)` index cannot be expressed in TypeORM metadata; it lives only in the migration, and a decorator would make `migration:generate` propose re-creating a plain case-sensitive constraint forever.
- **`migration:generate` is inspection-only for this slice.** TypeORM's schema builder drops indices it finds in the database but not in entity metadata, so it *will* propose dropping all four `lower()` indexes. That output must never be applied. Migrations here are hand-written, as `YagodaFoundation` was.
- **Commit after every task.** Conventional-commit prefixes, matching this repo's history (`feat:`, `fix:`, `refactor:`, `test:`).

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `backend/src/common/dto/boolean-query-param.ts` | One `@BooleanQueryParam()` decorator: parse `'true'/'1'/'false'/'0'`, 400 on anything else, typed `boolean`. |
| `backend/src/common/dto/boolean-query-param.spec.ts` | Its spec, including that `'2'` is a 400. |
| `backend/src/common/diff-fields.ts` | `diffFields(before, after, keys)` → `{ changed, before, after }` or `null`. |
| `backend/src/common/diff-fields.spec.ts` | Its spec. |
| `backend/src/common/trimmed-name.ts` | `assertTrimmedName(raw, field, code)` — trim, reject all-whitespace with a 400. |
| `backend/src/common/trimmed-name.spec.ts` | Its spec. |
| `backend/src/products/product.entity.ts` | `products` row. No `is_active`, no `@Unique`. |
| `backend/src/products/product-grade.entity.ts` | `product_grades` row, FK to `Product`. |
| `backend/src/products/products.service.ts` | Product list/create/update. |
| `backend/src/products/products.controller.ts` | `/products`. |
| `backend/src/products/product.mapper.ts` | `toProductResponse`. |
| `backend/src/products/product-grades.service.ts` | Grade list/create/update. |
| `backend/src/products/product-grades.controller.ts` | `/product-grades`. |
| `backend/src/products/product-grade.mapper.ts` | `toProductGradeResponse`. |
| `backend/src/products/products.module.ts` | Owns both entities and both controllers. |
| `backend/src/products/dto/*.ts` | Six DTOs (create/update/list × 2). |
| `backend/src/products/products.service.spec.ts` | Mocked-repo spec. |
| `backend/src/products/product-grades.service.spec.ts` | Mocked-repo spec. |
| `backend/src/tare-types/tare-type.entity.ts` | `tare_types` row with both CHECKs. |
| `backend/src/tare-types/tare-types.service.ts` | List/create/update. |
| `backend/src/tare-types/tare-types.controller.ts` | `/tare-types`. |
| `backend/src/tare-types/tare-type.mapper.ts` | `toTareTypeResponse`. |
| `backend/src/tare-types/tare-types.module.ts` | Module. |
| `backend/src/tare-types/dto/*.ts` | Three DTOs. |
| `backend/src/tare-types/tare-types.service.spec.ts` | Mocked-repo spec. |
| `backend/src/migrations/1788600000005-YagodaCatalog.ts` | Three tables, four `lower()` indexes, the `collection_points` retrofit. |
| `backend/src/migrations/catalog-schema.db-spec.ts` | Everything provable only against a real Postgres. |
| `backend/src/testing/catalog-pipeline.db-spec.ts` | HTTP-level: owner writes, operator 403. |

**Modified:**

| File | Change |
|---|---|
| `backend/src/user-admin/dto/list-users.query.ts` | `include_inactive` → `@BooleanQueryParam()`, typed `boolean`. |
| `backend/src/collection-points/dto/list-collection-points.query.ts` | Same. |
| `backend/src/user-admin/user-admin.service.ts` | Drop `=== 'true'`; use `diffFields`. |
| `backend/src/collection-points/collection-points.service.ts` | Drop `!== 'true'`; use `diffFields` (2 sites) and `assertTrimmedName`. |
| `backend/src/current-user/current-user.service.ts` | Use `diffFields`. |
| `backend/src/collection-points/collection-point.entity.ts` | Remove `@Unique('UQ_collection_points_name')`; document where uniqueness now lives. |
| `backend/src/audit/audit-log.entity.ts` | Six new `AUDIT_ACTIONS`. |
| `backend/src/app.module.ts` | Register `ProductsModule`, `TareTypesModule`. |

---

## Task 1: Shared boolean query param

Closes the follow-up "`include_inactive` accepts values it then ignores". `@IsBooleanString()` passes `'1'`, `'0'`, `'TRUE'` while both services test `=== 'true'`, so `?include_inactive=1` is accepted and silently means *false*. Four DTOs will share one answer instead of four copies of the bug.

**Files:**
- Create: `backend/src/common/dto/boolean-query-param.ts`
- Test: `backend/src/common/dto/boolean-query-param.spec.ts`
- Modify: `backend/src/user-admin/dto/list-users.query.ts`
- Modify: `backend/src/collection-points/dto/list-collection-points.query.ts`
- Modify: `backend/src/user-admin/user-admin.service.ts:36`
- Modify: `backend/src/collection-points/collection-points.service.ts:41`

**Interfaces:**
- Produces: `BooleanQueryParam(): PropertyDecorator` and `toBooleanQueryValue(value: unknown): unknown`, both from `../common/dto/boolean-query-param` (path relative to a feature module's `dto/` directory: `../../common/dto/boolean-query-param`). Tasks 5 and 6 consume the decorator; the field it decorates is typed `boolean | undefined`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/common/dto/boolean-query-param.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BooleanQueryParam, toBooleanQueryValue } from './boolean-query-param';

class Query {
  @BooleanQueryParam()
  include_inactive?: boolean;
}

const parse = async (raw: Record<string, unknown>) => {
  const dto = plainToInstance(Query, raw);
  const errors = await validate(dto);
  return { dto, errors };
};

describe('toBooleanQueryValue', () => {
  it.each([
    ['true', true],
    ['1', true],
    ['TRUE', true],
    ['  true  ', true],
    ['false', false],
    ['0', false],
    ['FALSE', false],
  ])('maps %j to %j', (raw, expected) => {
    expect(toBooleanQueryValue(raw)).toBe(expected);
  });

  it('passes a real boolean straight through', () => {
    expect(toBooleanQueryValue(true)).toBe(true);
  });

  // The whole point of the helper: an unrecognised string is NOT silently
  // turned into false. It is returned unchanged so @IsBoolean() rejects it.
  it.each(['2', 'yes', 'on', ''])('leaves %j unchanged for the validator to reject', (raw) => {
    expect(toBooleanQueryValue(raw)).toBe(raw);
  });
});

describe('@BooleanQueryParam()', () => {
  it('accepts an absent field', async () => {
    const { dto, errors } = await parse({});
    expect(errors).toHaveLength(0);
    expect(dto.include_inactive).toBeUndefined();
  });

  it('transforms "1" to true', async () => {
    const { dto, errors } = await parse({ include_inactive: '1' });
    expect(errors).toHaveLength(0);
    expect(dto.include_inactive).toBe(true);
  });

  it('transforms "false" to false', async () => {
    const { dto, errors } = await parse({ include_inactive: 'false' });
    expect(errors).toHaveLength(0);
    expect(dto.include_inactive).toBe(false);
  });

  // This is the bug being closed: under @IsBooleanString() this passed
  // validation and then compared unequal to 'true', i.e. meant false.
  it('rejects "2" instead of silently meaning false', async () => {
    const { errors } = await parse({ include_inactive: '2' });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isBoolean');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/common/dto/boolean-query-param.spec.ts`
Expected: FAIL — `Cannot find module './boolean-query-param'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/common/dto/boolean-query-param.ts`:

```ts
import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * The one answer to "is this query flag on?".
 *
 * It replaces `@IsBooleanString()`, which accepted `'1'`, `'0'` and `'TRUE'`
 * while every consuming service compared `=== 'true'` — so `?flag=1` passed
 * validation and then silently meant FALSE. A flag that is accepted and
 * ignored is worse than one that is rejected: the caller believes it worked.
 *
 * Unrecognised input is deliberately returned UNCHANGED rather than coerced or
 * thrown on here. Leaving it a string lets `@IsBoolean()` reject it through the
 * normal validation pipeline, so the caller gets a 400 with a field name and
 * the global ValidationPipe's usual shape — not an exception raised from inside
 * a transformer, which bypasses that machinery.
 */
export function toBooleanQueryValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return value;
}

export const BooleanQueryParam = (): PropertyDecorator =>
  applyDecorators(
    IsOptional(),
    Transform(({ value }: { value: unknown }) => toBooleanQueryValue(value)),
    IsBoolean(),
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/common/dto/boolean-query-param.spec.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Adopt it in both existing DTOs**

`backend/src/user-admin/dto/list-users.query.ts` — replace the whole file:

```ts
import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

export class ListUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @BooleanQueryParam()
  include_inactive?: boolean;
}
```

`backend/src/collection-points/dto/list-collection-points.query.ts` — replace the whole file:

```ts
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

export class ListCollectionPointsQueryDto extends PaginationQueryDto {
  /** Deactivated points are hidden by default — they exist for history, not
   *  for picking from a list. */
  @BooleanQueryParam()
  include_inactive?: boolean;
}
```

- [ ] **Step 6: Update both call sites to read the typed boolean**

In `backend/src/user-admin/user-admin.service.ts` (line 36), replace:

```ts
      include_inactive: query.include_inactive === 'true',
```

with:

```ts
      include_inactive: query.include_inactive ?? false,
```

In `backend/src/collection-points/collection-points.service.ts` (line 41), replace:

```ts
    if (query.include_inactive !== 'true') where.is_active = true;
```

with:

```ts
    if (!query.include_inactive) where.is_active = true;
```

- [ ] **Step 7: Run the full unit suite**

Run: `cd backend && npm test`
Expected: PASS. If any existing spec constructs a query object with `include_inactive: 'true'` as a *string*, change it to the boolean `true` — the DTO's field is now `boolean`, and TypeScript will point at every such site.

- [ ] **Step 8: Commit**

```bash
git add backend/src/common/dto/boolean-query-param.ts \
        backend/src/common/dto/boolean-query-param.spec.ts \
        backend/src/user-admin/dto/list-users.query.ts \
        backend/src/collection-points/dto/list-collection-points.query.ts \
        backend/src/user-admin/user-admin.service.ts \
        backend/src/collection-points/collection-points.service.ts
git commit -m "fix: one shared boolean query param, replacing four silent coercions"
```

---

## Task 2: Shared `diffFields` and `assertTrimmedName`

`diffFields` closes the follow-up "field diffing is hand-rolled in four places"; the three new `update()` methods would make it seven.

`assertTrimmedName` is **an addition this plan makes beyond the spec's §11 list**, for the same stated reason: the trim-and-reject-blank check is currently private in `CollectionPointsService` and duplicated in `UserAdminService`, and this slice would copy it three more times.

**Files:**
- Create: `backend/src/common/diff-fields.ts`, `backend/src/common/diff-fields.spec.ts`
- Create: `backend/src/common/trimmed-name.ts`, `backend/src/common/trimmed-name.spec.ts`
- Modify: `backend/src/collection-points/collection-points.service.ts` (2 diff sites + `assertNameValid`)
- Modify: `backend/src/user-admin/user-admin.service.ts:216-246`
- Modify: `backend/src/current-user/current-user.service.ts:~39-66`

**Interfaces:**
- Produces: `diffFields<T extends object>(before: T, after: T, keys: readonly (keyof T & string)[]): FieldDiff | null` where `FieldDiff = { changed: string[]; before: Record<string, unknown>; after: Record<string, unknown> }`. Returns `null` when nothing moved, which is exactly the `if (moved.length > 0)` guard every call site already has.
- Produces: `assertTrimmedName(raw: string, field: string, code: string): string` — returns the trimmed value, throws `BadRequestException` on empty.
- Both consumed by Tasks 4, 5 and 6.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/common/diff-fields.spec.ts`:

```ts
import { diffFields } from './diff-fields';

describe('diffFields', () => {
  const before = { name: 'Малина', kind: 'reception', is_active: true };

  it('returns null when nothing in the key set moved', () => {
    expect(diffFields(before, { ...before }, ['name', 'kind', 'is_active'])).toBeNull();
  });

  it('returns only the keys that moved', () => {
    const after = { ...before, name: 'Полуниця' };
    expect(diffFields(before, after, ['name', 'kind', 'is_active'])).toEqual({
      changed: ['name'],
      before: { name: 'Малина' },
      after: { name: 'Полуниця' },
    });
  });

  it('ignores changes outside the key set', () => {
    const after = { ...before, kind: 'base' };
    expect(diffFields(before, after, ['name'])).toBeNull();
  });

  it('treats null and undefined as different values', () => {
    const diff = diffFields({ target: null }, { target: undefined }, ['target']);
    expect(diff).toEqual({ changed: ['target'], before: { target: null }, after: { target: undefined } });
  });

  it('reports several moved keys at once', () => {
    const after = { name: 'Полуниця', kind: 'base', is_active: true };
    expect(diffFields(before, after, ['name', 'kind', 'is_active'])?.changed).toEqual(['name', 'kind']);
  });
});
```

Create `backend/src/common/trimmed-name.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { assertTrimmedName } from './trimmed-name';

describe('assertTrimmedName', () => {
  it('trims surrounding whitespace', () => {
    expect(assertTrimmedName('  Копайгород  ', 'name', 'POINT_NAME_EMPTY')).toBe('Копайгород');
  });

  it('does NOT lowercase — a display value keeps what was typed', () => {
    expect(assertTrimmedName('Копайгород', 'name', 'POINT_NAME_EMPTY')).toBe('Копайгород');
  });

  it('rejects an all-whitespace name with the given code', () => {
    expect(() => assertTrimmedName('   ', 'name', 'POINT_NAME_EMPTY')).toThrow(BadRequestException);
    try {
      assertTrimmedName('   ', 'name', 'POINT_NAME_EMPTY');
    } catch (err) {
      expect((err as BadRequestException).getResponse()).toEqual({
        message: 'name cannot be empty or all whitespace',
        code: 'POINT_NAME_EMPTY',
      });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/common/diff-fields.spec.ts src/common/trimmed-name.spec.ts`
Expected: FAIL — both modules not found.

- [ ] **Step 3: Write minimal implementations**

Create `backend/src/common/diff-fields.ts`:

```ts
export interface FieldDiff {
  changed: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/**
 * The one field-diff used to build an audit payload.
 *
 * Returns `null` — not an empty diff — when nothing in `keys` moved, because
 * every call site already guards on exactly that: a no-op PATCH must not write
 * an entry, and an audit log full of noise is one nobody reads.
 *
 * Comparison is `!==`, matching the four hand-rolled versions this replaces.
 * That is identity for the value types actually diffed here (string, boolean,
 * null, and `numeric` columns, which TypeORM returns as strings).
 */
export function diffFields<T extends object>(
  before: T,
  after: T,
  keys: readonly (keyof T & string)[],
): FieldDiff | null {
  const changed = keys.filter((key) => before[key] !== after[key]);
  if (changed.length === 0) return null;

  return {
    changed,
    before: Object.fromEntries(changed.map((key) => [key, before[key]])),
    after: Object.fromEntries(changed.map((key) => [key, after[key]])),
  };
}
```

Create `backend/src/common/trimmed-name.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

/**
 * Trims a display name and rejects an all-whitespace one with a 400 — called
 * BEFORE both the uniqueness check and the save.
 *
 * `@Length(1, 128)` counts whitespace toward length, so " " alone already
 * passes it. Without trimming here, "Малина" and " Малина " render identically
 * everywhere a human reads them but compare unequal to the unique index,
 * defeating the whole point of the constraint.
 *
 * It trims and does NOT lowercase: a name is a display value, and rewriting
 * what someone typed is data loss rather than normalization. Case-insensitive
 * COMPARISON is a separate mechanism and lives in the database, as a
 * `lower(name)` unique index. See `normalize-login.ts` for the full argument.
 */
export function assertTrimmedName(raw: string, field: string, code: string): string {
  const name = raw.trim();
  if (!name) {
    throw new BadRequestException({
      message: `${field} cannot be empty or all whitespace`,
      code,
    });
  }
  return name;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/common/diff-fields.spec.ts src/common/trimmed-name.spec.ts`
Expected: PASS.

- [ ] **Step 5: Adopt `diffFields` at all four existing sites**

In `backend/src/collection-points/collection-points.service.ts`, replace the target-diff block:

```ts
    const movedTargets = TARGET_FIELDS.filter((f) => targetsBefore[f] !== targetsAfter[f]);
    if (movedTargets.length > 0) {
```

...and its `before:`/`after:` payload, with:

```ts
    const targetDiff = diffFields(targetsBefore, targetsAfter, TARGET_FIELDS);
    if (targetDiff) {
```

using `before: targetDiff.before, after: targetDiff.after` in the `audit.record` call. Then replace the general field-diff block:

```ts
    const movedFields = (Object.keys(before) as (keyof typeof before)[]).filter(
      (k) => before[k] !== after[k],
    );
    if (movedFields.length > 0) {
```

with:

```ts
    const fieldDiff = diffFields(before, after, ['name', 'kind', 'is_active']);
    if (fieldDiff) {
```

again using `before: fieldDiff.before, after: fieldDiff.after`.

Apply the same substitution in `backend/src/user-admin/user-admin.service.ts` (keys `['login', 'first_name', 'last_name', 'role', 'collection_point_id', 'is_active']`) and in `backend/src/current-user/current-user.service.ts` (its existing `changed` computation, over the same keys it already uses).

Keep every surrounding comment — notably user-admin's "A no-op PATCH must not write an entry" — since the guard it explains still exists, now as `if (diff)`.

- [ ] **Step 6: Adopt `assertTrimmedName` in `CollectionPointsService`**

Delete the private `assertNameValid` method and call
`assertTrimmedName(dto.name, 'name', 'POINT_NAME_EMPTY')` at both of its call sites. Move its doc comment's surviving argument into `trimmed-name.ts` if anything there is not already covered.

- [ ] **Step 7: Run the full unit suite**

Run: `cd backend && npm test`
Expected: PASS, with no change in any existing assertion — this is a pure refactor and every audit payload must be byte-identical.

- [ ] **Step 8: Commit**

```bash
git add backend/src/common/diff-fields.ts backend/src/common/diff-fields.spec.ts \
        backend/src/common/trimmed-name.ts backend/src/common/trimmed-name.spec.ts \
        backend/src/collection-points/collection-points.service.ts \
        backend/src/user-admin/user-admin.service.ts \
        backend/src/current-user/current-user.service.ts
git commit -m "refactor: extract diffFields and assertTrimmedName before three modules copy them"
```

---

## Task 3: Schema — entities, migration, and the case-insensitive retrofit

The slice's most important guarantee lives here and **cannot be unit-tested**: a `lower(name)` index is invisible to entity metadata and to every mocked repository. This task is therefore driven by a `db-spec`, not a `spec`.

**Files:**
- Create: `backend/src/products/product.entity.ts`
- Create: `backend/src/products/product-grade.entity.ts`
- Create: `backend/src/tare-types/tare-type.entity.ts`
- Create: `backend/src/migrations/1788600000005-YagodaCatalog.ts`
- Test: `backend/src/migrations/catalog-schema.db-spec.ts`
- Modify: `backend/src/collection-points/collection-point.entity.ts` (remove `@Unique`)

**Interfaces:**
- Produces: `Product { id: string; name: string; created_at: Date; updated_at: Date }`
- Produces: `ProductGrade { id: string; product_id: string; product: Product; name: string; is_active: boolean; created_at: Date; updated_at: Date }`
- Produces: `TareType { id: string; name: string; weight_kg: string; deposit_price: string; is_crate: boolean; is_active: boolean; created_at: Date; updated_at: Date }` — note `weight_kg` and `deposit_price` are **`string`**.
- Consumed by Tasks 4, 5, 6.

**Prerequisite:** the test database must exist. If `npm run test:db` has never been run here: `docker compose exec postgres createdb -U app app_test`.

- [ ] **Step 1: Write the failing database spec**

Create `backend/src/migrations/catalog-schema.db-spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/**
 * Everything in the catalog schema that exists ONLY in hand-written SQL.
 *
 * Every name is suffixed with a per-RUN uuid: `app_test` persists between runs
 * and this suite never truncates, so a literal name passes on a fresh database
 * and then fails on every later run — with a duplicate-key error that looks
 * exactly like the one being asserted, from the WRONG insert. Same convention
 * as `schema.db-spec.ts` and `pipeline.db-spec.ts`.
 */
describe('YagodaCatalog', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await openTestDataSource();
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const tables = ['products', 'product_grades', 'tare_types'];

  it.each(tables)('creates the %s table', async (table) => {
    const [row] = await ds.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [
      `public.${table}`,
    ]);
    expect(row.present).toBe(true);
  });

  const insertProduct = async (name: string): Promise<string> => {
    const [row] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [name]);
    return row.id;
  };

  it('rejects a product whose name differs only by case', async () => {
    const name = `Малина-${randomUUID()}`;
    await insertProduct(name);
    await expect(insertProduct(name.toLowerCase())).rejects.toThrow(/duplicate key/i);
  });

  it('keeps the capitalization exactly as written', async () => {
    const name = `Ожина-${randomUUID()}`;
    const id = await insertProduct(name);
    const [row] = await ds.query(`SELECT name FROM products WHERE id = $1`, [id]);
    expect(row.name).toBe(name);
  });

  it('rejects a grade whose name differs only by case WITHIN one product', async () => {
    const productId = await insertProduct(`Смородина-${randomUUID()}`);
    await ds.query(`INSERT INTO product_grades (product_id, name) VALUES ($1, '1 сорт')`, [
      productId,
    ]);
    await expect(
      ds.query(`INSERT INTO product_grades (product_id, name) VALUES ($1, '1 СОРТ')`, [productId]),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('allows the same grade name under two different products', async () => {
    const first = await insertProduct(`Аґрус-${randomUUID()}`);
    const second = await insertProduct(`Порічка-${randomUUID()}`);
    await ds.query(`INSERT INTO product_grades (product_id, name) VALUES ($1, 'Екстра')`, [first]);
    await expect(
      ds.query(`INSERT INTO product_grades (product_id, name) VALUES ($1, 'Екстра')`, [second]),
    ).resolves.toBeDefined();
  });

  it('rejects a grade pointing at no product', async () => {
    await expect(
      ds.query(`INSERT INTO product_grades (product_id, name) VALUES ($1, '1 сорт')`, [
        randomUUID(),
      ]),
    ).rejects.toThrow(/foreign key/i);
  });

  const insertTare = (name: string, weight: string, deposit: string) =>
    ds.query(
      `INSERT INTO tare_types (name, weight_kg, deposit_price) VALUES ($1, $2, $3) RETURNING id`,
      [name, weight, deposit],
    );

  it('rejects a tare type whose name differs only by case', async () => {
    const name = `Ящик-${randomUUID()}`;
    await insertTare(name, '1.20', '120.00');
    await expect(insertTare(name.toLowerCase(), '1.20', '120.00')).rejects.toThrow(
      /duplicate key/i,
    );
  });

  it('permits a zero weight and a zero deposit', async () => {
    await expect(insertTare(`Відро-${randomUUID()}`, '0.00', '0.00')).resolves.toBeDefined();
  });

  it('rejects a negative weight', async () => {
    await expect(insertTare(`Bad-w-${randomUUID()}`, '-1.00', '0.00')).rejects.toThrow(
      /CHK_tare_types_weight_kg/,
    );
  });

  it('rejects a negative deposit', async () => {
    await expect(insertTare(`Bad-d-${randomUUID()}`, '0.00', '-1.00')).rejects.toThrow(
      /CHK_tare_types_deposit_price/,
    );
  });

  it('returns numeric columns as strings, never numbers', async () => {
    const [row] = await insertTare(`Чешка-${randomUUID()}`, '0.85', '95.50');
    const [read] = await ds.query(
      `SELECT weight_kg, deposit_price FROM tare_types WHERE id = $1`,
      [row.id],
    );
    expect(typeof read.weight_kg).toBe('string');
    expect(read.weight_kg).toBe('0.85');
    expect(read.deposit_price).toBe('95.50');
  });

  it('no longer carries the case-sensitive point-name constraint', async () => {
    const [row] = await ds.query(
      `SELECT COUNT(*)::int AS n FROM pg_constraint WHERE conname = 'UQ_collection_points_name'`,
    );
    expect(row.n).toBe(0);
  });

  it('rejects a collection point whose name differs only by case', async () => {
    const name = `Копайгород-${randomUUID()}`;
    await ds.query(`INSERT INTO collection_points (name) VALUES ($1)`, [name]);
    await expect(
      ds.query(`INSERT INTO collection_points (name) VALUES ($1)`, [name.toLowerCase()]),
    ).rejects.toThrow(/duplicate key/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npm run test:db -- src/migrations/catalog-schema.db-spec.ts`
Expected: FAIL — `to_regclass` returns null for all three tables, and the `UQ_collection_points_name` assertion finds 1, not 0.

- [ ] **Step 3: Write the three entities**

Create `backend/src/products/product.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * A product is the REPORTING key (§4.1); the price key is its grade.
 *
 * THERE IS NO `is_active` COLUMN, and that is a decision the DBML argues for
 * at length: «видимість товару ВИВОДИТЬСЯ, а не зберігається». §4.1 states the
 * mechanism literally — «Товар без жодного АКТИВНОГО сорту приймальнику не
 * показується» — with Кизил, which has no grades at all, as the worked
 * example. A flag here would be a second copy of a fact that already lives in
 * `product_grades.is_active`, and would create a state no rule answers: product
 * off, grade on, day price set.
 *
 * Retirement is therefore deactivating the grades, and deactivating the LAST
 * active grade is never blocked — that IS the mechanism.
 *
 * NO `@Unique` ON `name`, deliberately. Uniqueness is case-INSENSITIVE and
 * lives in the migration as `UQ_products_name_lower`, a unique index on
 * `lower(name)`, which TypeORM metadata cannot express. A decorator here would
 * make `migration:generate` propose re-creating a plain case-sensitive
 * constraint on every run. The reason case matters is the DBML's own: the
 * `villages` table was deleted because one village appeared four ways in the
 * client's book — «копайгород» 571 rows, «Копайгород» 175, «Копайгород » 45,
 * «Копай».
 *
 * NO `display_order` either. The DBML has one; nothing consumes it and no rule
 * cites it, so it is not implemented — see the spec's §8.1. Lists order by name.
 */
@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
```

Create `backend/src/products/product-grade.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Product } from './product.entity';

/**
 * The grade is the PRICE key (§4.1) and the thing every later table points at:
 * `grade_prices.product_grade_id` and `intake_items.product_grade_id` both name
 * a grade and never mention its product. That is why the API addresses grades
 * flatly at `/product-grades/:id` rather than under their parent.
 *
 * `product_id` IS IMMUTABLE — it is absent from the update DTO. Re-parenting a
 * grade would silently rewrite history: `intake_items` stores the grade id
 * alone, so moving "1 сорт" from Малина to Полуниця moves every receipt line
 * ever written against it into another product's totals, with no document
 * changing and no trail explaining it. A grade under the wrong product is
 * deactivated and recreated.
 *
 * The name IS mutable, and a rename is retroactive by construction — nothing
 * downstream snapshots it. That is accepted: a rename corrects spelling, it
 * does not change identity. A different berry is a new product.
 *
 * NO `@Unique`: uniqueness is `UQ_product_grades_product_name_lower`, a unique
 * index on `(product_id, lower(name))` in the migration. Same name is legal
 * under two different products — "1 сорт" exists for every berry.
 */
@Entity('product_grades')
@Index('IDX_product_grades_product', ['product_id'])
export class ProductGrade {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  product_id: string;

  // The relation exists so TypeORM knows about the foreign key, and
  // `foreignKeyConstraintName` is what makes that work: the schema builder
  // matches foreign keys by NAME, so without it a future `migration:generate`
  // compares the database's `FK_product_grades_product` against a computed
  // `FK_<sha1>`, never matches, and proposes a drop-and-recreate. Same reasoning
  // as `User.collection_point`.
  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id', foreignKeyConstraintName: 'FK_product_grades_product' })
  product: Product;

  @Column({ type: 'varchar' })
  name: string;

  /** §4.1 — this flag is what makes a product visible or not. There is no
   *  deletion; deactivation is the only removal verb. */
  @Column({ type: 'bool', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
```

Create `backend/src/tare-types/tare-type.entity.ts`:

```ts
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * §2.5 — a tare's weight is subtracted automatically on the intake screen.
 *
 * BOTH NUMBERS ARE OWNER-EDITABLE AND BOTH ARE SNAPSHOTTED DOWNSTREAM (§2.7):
 * `intake_items.tare_weight_kg` and `crate_issuances.deposit_per_unit` copy
 * them at write time. That is what lets this module edit money while owning no
 * money logic — raising a crate from 120 to 130 cannot move a July issuance.
 *
 * `weight_kg` and `deposit_price` are `numeric`, therefore STRINGS in
 * TypeScript, never numbers. No arithmetic is performed on them anywhere in
 * this module. See the foundation spec's §5.1.
 *
 * The two CHECKs permit ZERO and forbid NEGATIVE. A negative `weight_kg` would
 * ADD weight in §2.4's `net = (gross − pallet) − tare`, which is nonsense in
 * every direction; a genuine zero-weight row (a supplier's own bucket) and a
 * zero-deposit non-crate tare are both plausible catalog entries.
 *
 * THERE IS DELIBERATELY NO CROSS-RULE between `is_crate` and `deposit_price`.
 * `is_crate = false ⇒ deposit_price = 0` is tempting, since §6.3's завдаток is
 * a crate concept — but no rule states it, and a CHECK encoding an unstated
 * rule is exactly the trap the DBML warns about: «читач… відтворить заборону,
 * якої правило не просить». A nonsense row is inert; a wrong constraint blocks
 * a real case later.
 *
 * ЗАПИТАННЯ 12 — whether «Ящик» and «Чешка» are one unit for counting — is
 * still OPEN in the schema. It does not block this table: the counting question
 * lives in `crate_issuances` and `collection_points.target_crates`.
 *
 * NO `@Unique`: uniqueness is `UQ_tare_types_name_lower` in the migration.
 */
@Entity('tare_types')
@Check('CHK_tare_types_weight_kg', `"weight_kg" >= 0`)
@Check('CHK_tare_types_deposit_price', `"deposit_price" >= 0`)
export class TareType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  /** `numeric` — a STRING in TypeScript, never a number. */
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  weight_kg: string;

  /** `numeric` — a STRING in TypeScript, never a number. */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  deposit_price: string;

  /** §6.2/§6.3 — which tare counts as a "ящик" for crate targets and deposits. */
  @Column({ type: 'bool', default: false })
  is_crate: boolean;

  @Column({ type: 'bool', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
```

- [ ] **Step 4: Remove the case-sensitive constraint from `CollectionPoint`**

In `backend/src/collection-points/collection-point.entity.ts`, delete the `@Unique('UQ_collection_points_name', ['name'])` decorator and its `Unique` import, and replace the doc comment's paragraph beginning "`name` is UNIQUE — AN ADDITION THIS PROJECT MAKES" with:

```ts
 * `name` is UNIQUE — AN ADDITION THIS PROJECT MAKES; `28-db-schema.dbml` does
 * not specify it. The DBML marks `products.name` and `tare_types.name` unique
 * explicitly and is silent here with no Note defending the silence, so this
 * reads as an oversight: two points both called "Копайгород" would be a live
 * hazard on the transfer screen, where a mistaken transfer is money in dispute.
 *
 * That uniqueness is now CASE-INSENSITIVE and is NOT declared here. It lives in
 * `1788600000005-YagodaCatalog` as `UQ_collection_points_name_lower`, a unique
 * index on `lower(name)` — a shape TypeORM metadata cannot express, so a
 * `@Unique` decorator here would make `migration:generate` propose re-creating
 * the old case-sensitive constraint on every run. The case fold is the DBML's
 * own argument, applied here: the `villages` table was deleted because one
 * village appeared four ways in the client's book.
```

- [ ] **Step 5: Write the migration**

Create `backend/src/migrations/1788600000005-YagodaCatalog.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Yagoda catalogs: products, their grades, and tare types.
 *
 * FOUR UNIQUE INDEXES ON `lower(name)`, NOT UNIQUE CONSTRAINTS. Postgres
 * compares text case-sensitively, so a plain UNIQUE accepts «Малина» and
 * «малина» as two products. The DBML contains the evidence that this is what
 * happens to hand-typed catalog data — it is the argument that deleted the
 * `villages` table, where one village appeared four ways in the client's own
 * book: «копайгород» 571 rows, «Копайгород» 175, «Копайгород » with a trailing
 * space 45, «Копай». Names are still STORED exactly as typed; only comparison
 * folds case, so nothing anyone wrote is rewritten.
 *
 * `collection_points` is brought onto the same rule here rather than left
 * behind: two different answers to "are names case-insensitive" in one codebase
 * means the next module copies whichever it reads first.
 *
 * These indexes are invisible to TypeORM metadata. `migration:generate` will
 * propose DROPPING all four; that output must not be applied.
 */
export class YagodaCatalog1788600000005 implements MigrationInterface {
  name = 'YagodaCatalog1788600000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fail loudly rather than destroying data: if two points already differ
    // only by case, the unique index below cannot be created, and the operator
    // must decide which name survives. Naming the values is the difference
    // between a fixable message and a bare constraint-violation stack.
    const collisions: { name: string; occurrences: string }[] = await queryRunner.query(`
      SELECT lower("name") AS name, count(*)::text AS occurrences
        FROM "collection_points"
       GROUP BY lower("name")
      HAVING count(*) > 1
    `);
    if (collisions.length > 0) {
      const detail = collisions.map((c) => `"${c.name}" (${c.occurrences})`).join(', ');
      throw new Error(
        `Cannot make collection_points.name case-insensitive: these names already ` +
          `collide when case is ignored — ${detail}. Rename or deactivate the duplicates, ` +
          `then re-run this migration.`,
      );
    }

    await queryRunner.query(`
      CREATE TABLE "products" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_products" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_products_name_lower" ON "products" (lower("name"))`,
    );

    await queryRunner.query(`
      CREATE TABLE "product_grades" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "product_id" uuid NOT NULL,
        "name" character varying NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_grades" PRIMARY KEY ("id"),
        CONSTRAINT "FK_product_grades_product" FOREIGN KEY ("product_id")
          REFERENCES "products"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_product_grades_product_name_lower"
         ON "product_grades" ("product_id", lower("name"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_product_grades_product" ON "product_grades" ("product_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "tare_types" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "weight_kg" numeric(10,2) NOT NULL,
        "deposit_price" numeric(12,2) NOT NULL,
        "is_crate" boolean NOT NULL DEFAULT false,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tare_types" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_tare_types_weight_kg" CHECK ("weight_kg" >= 0),
        CONSTRAINT "CHK_tare_types_deposit_price" CHECK ("deposit_price" >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tare_types_name_lower" ON "tare_types" (lower("name"))`,
    );

    await queryRunner.query(
      `ALTER TABLE "collection_points" DROP CONSTRAINT "UQ_collection_points_name"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_collection_points_name_lower"
         ON "collection_points" (lower("name"))`,
    );
  }

  /**
   * Reverses the schema, not the intent: restoring the case-SENSITIVE point
   * constraint fails if case-variant point names were created while this
   * migration was applied. That is the safe direction — the same posture
   * `BootstrapOwner.down()` takes.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_collection_points_name_lower"`);
    await queryRunner.query(
      `ALTER TABLE "collection_points" ADD CONSTRAINT "UQ_collection_points_name" UNIQUE ("name")`,
    );

    // product_grades before products: the foreign key points that way.
    await queryRunner.query(`DROP TABLE "product_grades"`);
    await queryRunner.query(`DROP TABLE "products"`);
    await queryRunner.query(`DROP TABLE "tare_types"`);
  }
}
```

- [ ] **Step 6: Verify the collision guard by reading it, and record that it is unproven**

The `up()` guard that aborts on pre-existing case collisions is NOT covered by a
test, and this is an accepted gap (spec §12). Migrations run once inside the test
harness, so exercising that branch needs a bespoke fixture database. Read the
guard once against the spec's requirement — it must name the colliding values,
not just fail — and add it to the follow-ups document at the end of the slice.

- [ ] **Step 7: Run the database spec to verify it passes**

Run: `cd backend && npm run test:db -- src/migrations/catalog-schema.db-spec.ts`
Expected: PASS, every case.

- [ ] **Step 8: Run the whole database suite for regressions**

Run: `cd backend && npm run test:db`
Expected: PASS. `schema.db-spec.ts` must still pass — it asserts the *earlier* tables and does not reference `UQ_collection_points_name`.

- [ ] **Step 9: Commit**

```bash
git add backend/src/products/product.entity.ts \
        backend/src/products/product-grade.entity.ts \
        backend/src/tare-types/tare-type.entity.ts \
        backend/src/migrations/1788600000005-YagodaCatalog.ts \
        backend/src/migrations/catalog-schema.db-spec.ts \
        backend/src/collection-points/collection-point.entity.ts
git commit -m "feat: catalog tables with case-insensitive name uniqueness"
```

---

## Task 4: Products module

**Files:**
- Create: `backend/src/common/dto/catalog-pagination-query.dto.ts`
- Create: `backend/src/products/product.mapper.ts`
- Create: `backend/src/products/dto/create-product.dto.ts`
- Create: `backend/src/products/dto/update-product.dto.ts`
- Create: `backend/src/products/dto/list-products.query.ts`
- Create: `backend/src/products/products.service.ts`
- Create: `backend/src/products/products.controller.ts`
- Create: `backend/src/products/products.module.ts`
- Test: `backend/src/products/products.service.spec.ts`
- Modify: `backend/src/audit/audit-log.entity.ts` (all six new actions, one edit)
- Modify: `backend/src/app.module.ts` (register `ProductsModule`)

**Interfaces:**
- Consumes: `Product` (Task 3), `assertTrimmedName` / `diffFields` (Task 2).
- Produces: `CatalogPaginationQueryDto` (base class with `limit` defaulting to 100 — Tasks 5 and 6 extend it), `ProductResponse { id, name, created_at }`, `toProductResponse(product: Product): ProductResponse`, and `ProductsService.findOneRaw(id: string): Promise<Product | null>`, which Task 5 uses to validate a grade's parent.

- [ ] **Step 1: Add all six audit actions**

In `backend/src/audit/audit-log.entity.ts`, extend `AUDIT_ACTIONS` (all six at once — one file, one edit, so Tasks 5 and 6 do not re-touch it):

```ts
  'point.target-changed',
  'product.created',
  'product.updated',
  'product-grade.created',
  'product-grade.updated',
  'tare-type.created',
  'tare-type.updated',
] as const;
```

- [ ] **Step 2: Write the shared catalog pagination base**

Create `backend/src/common/dto/catalog-pagination-query.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto';

/**
 * Pagination for a BOUNDED reference table read by a picker, not a browsable
 * list. `PaginationQueryDto`'s default of 20 is right for users and documents
 * and wrong here, and wrong QUIETLY: ten products at three grades apiece is 30
 * rows, so an operator opens the grade picker on the intake screen, the last
 * third of the catalog is not there, and nothing errors.
 *
 * `@Max(100)` is unchanged — the guard rail against an unbounded query stays.
 * Clients compare `data.length` against `total` and warn if they differ: if
 * this business ever exceeds 100 grades the assumption behind this default has
 * broken and someone must know, because silent truncation is the one outcome
 * that is not acceptable.
 *
 * `limit` MUST carry an initializer here. This repo targets ES2023, so
 * `useDefineForClassFields` is TRUE and a re-declared field without one would
 * define `limit` as `undefined`, wiping the parent's default rather than
 * raising it.
 */
export class CatalogPaginationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 100;
}
```

- [ ] **Step 3: Write the failing service spec**

Create `backend/src/products/products.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import { ProductsService } from './products.service';

const owner = {
  sub: 'u-owner',
  username: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
};

describe('ProductsService', () => {
  let repo: {
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let audit: { record: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let service: ProductsService;
  let nameLookup: jest.Mock;

  const product = (over: Record<string, unknown> = {}) => ({
    id: 'prod-1',
    name: 'Малина',
    created_at: new Date('2026-07-15T06:00:00.000Z'),
    updated_at: new Date('2026-07-15T06:00:00.000Z'),
    ...over,
  });

  beforeEach(() => {
    // `getOne` backs assertNameFree's case-insensitive lookup. Default "no such
    // row" so a create() never sees its own name as taken.
    nameLookup = jest.fn().mockResolvedValue(null);
    repo = {
      findAndCount: jest.fn().mockResolvedValue([[product()], 1]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((p) => Promise.resolve(p)),
      create: jest.fn().mockImplementation((p) => product(p)),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getOne: nameLookup,
      }),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    // Run the callback against the same mock repo, so a transactional write is
    // exercised exactly like a plain one.
    dataSource = {
      transaction: jest.fn().mockImplementation((cb) => cb({ getRepository: () => repo })),
    };
    service = new ProductsService(repo as never, dataSource as never, audit as never);
  });

  describe('list', () => {
    it('orders by name and returns the paginated envelope', async () => {
      const result = await service.list({ page: 1, limit: 100 });
      expect(repo.findAndCount).toHaveBeenCalledWith({
        order: { name: 'ASC' },
        skip: 0,
        take: 100,
      });
      expect(result).toEqual({
        data: [{ id: 'prod-1', name: 'Малина', created_at: '2026-07-15T06:00:00.000Z' }],
        total: 1,
        page: 1,
        limit: 100,
      });
    });
  });

  describe('create', () => {
    it('trims the name and records an audit entry inside the transaction', async () => {
      const result = await service.create(owner, { name: '  Малина  ' });
      expect(repo.create).toHaveBeenCalledWith({ name: 'Малина' });
      expect(result.name).toBe('Малина');
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'product.created',
          actor_id: 'u-owner',
          target_type: 'product',
          after: { name: 'Малина' },
        }),
        expect.anything(),
      );
    });

    it('rejects an all-whitespace name with a 400', async () => {
      await expect(service.create(owner, { name: '   ' })).rejects.toThrow(BadRequestException);
    });

    it('rejects a name that already exists, ignoring case', async () => {
      nameLookup.mockResolvedValue(product({ name: 'малина' }));
      await expect(service.create(owner, { name: 'Малина' })).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('404s on an unknown id', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.update(owner, 'nope', { name: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('renames and audits only the field that moved', async () => {
      repo.findOne.mockResolvedValue(product());
      await service.update(owner, 'prod-1', { name: 'Полуниця' });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'product.updated',
          before: { name: 'Малина' },
          after: { name: 'Полуниця' },
        }),
        expect.anything(),
      );
    });

    it('writes no audit entry for a no-op PATCH', async () => {
      repo.findOne.mockResolvedValue(product());
      await service.update(owner, 'prod-1', {});
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('allows a pure case correction without a uniqueness conflict', async () => {
      repo.findOne.mockResolvedValue(product({ name: 'малина' }));
      await service.update(owner, 'prod-1', { name: 'Малина' });
      // The row is itself — no lookup, no 409.
      expect(nameLookup).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd backend && npx jest src/products/products.service.spec.ts`
Expected: FAIL — `Cannot find module './products.service'`.

- [ ] **Step 5: Write the mapper and DTOs**

Create `backend/src/products/product.mapper.ts`:

```ts
import { Product } from './product.entity';

/** `created_at` only, no `updated_at` — matching `toCollectionPointResponse`.
 *  "When did this change" is the audit log's question, not the row's. */
export interface ProductResponse {
  id: string;
  name: string;
  created_at: string;
}

export function toProductResponse(product: Product): ProductResponse {
  return {
    id: product.id,
    name: product.name,
    created_at: product.created_at.toISOString(),
  };
}
```

Create `backend/src/products/dto/create-product.dto.ts`:

```ts
import { IsString, Length } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @Length(1, 128)
  name: string;
}
```

Create `backend/src/products/dto/update-product.dto.ts`:

```ts
import { IsString, Length, ValidateIf } from 'class-validator';

/**
 * `@ValidateIf(... !== undefined)` rather than `@IsOptional()`: `name` is a NOT
 * NULL column, and `@IsOptional()` treats an explicit `null` like an absent
 * field, skipping every later validator — so `{"name": null}` would sail
 * through class-validator and crash on the constraint at save time, a 500 where
 * a 400 belongs. `@ValidateIf` skips only a truly ABSENT field.
 *
 * There is no `is_active` here because `products` has no such column, and no
 * `display_order` because this slice does not implement one.
 */
export class UpdateProductDto {
  @ValidateIf((o: UpdateProductDto) => o.name !== undefined)
  @IsString()
  @Length(1, 128)
  name?: string;
}
```

Create `backend/src/products/dto/list-products.query.ts`:

```ts
import { CatalogPaginationQueryDto } from '../../common/dto/catalog-pagination-query.dto';

/**
 * No `include_inactive`: `products` has no `is_active` column at all —
 * visibility is derived from its grades (§4.1). No `q` search either; nothing
 * has asked for one and a bounded list does not need it.
 */
export class ListProductsQueryDto extends CatalogPaginationQueryDto {}
```

- [ ] **Step 6: Write the service**

Create `backend/src/products/products.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Product } from './product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsQueryDto } from './dto/list-products.query';
import { ProductResponse, toProductResponse } from './product.mapper';
import { AuditService } from '../audit/audit.service';
import { assertTrimmedName } from '../common/trimmed-name';
import { diffFields } from '../common/diff-fields';
import { Paginated } from '../common/dto/paginated';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly repo: Repository<Product>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListProductsQueryDto): Promise<Paginated<ProductResponse>> {
    const [data, total] = await this.repo.findAndCount({
      order: { name: 'ASC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return { data: data.map(toProductResponse), total, page: query.page, limit: query.limit };
  }

  /** The entity, unmapped — for `ProductGradesService`, which must confirm a
   *  product exists before hanging a grade off it. Reads across modules are
   *  open; going through the owner keeps them from growing their own query. */
  async findOneRaw(id: string): Promise<Product | null> {
    return this.repo.findOne({ where: { id } });
  }

  async create(actor: AuthenticatedUser, dto: CreateProductDto): Promise<ProductResponse> {
    const name = assertTrimmedName(dto.name, 'name', 'PRODUCT_NAME_EMPTY');
    await this.assertNameFree(name);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Product);
      const product = await repo.save(repo.create({ name }));

      await this.audit.record(
        {
          action: 'product.created',
          actor_id: actor.sub,
          target_type: 'product',
          target_id: product.id,
          after: { name: product.name },
        },
        manager,
      );

      return toProductResponse(product);
    });
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateProductDto,
  ): Promise<ProductResponse> {
    const product = await this.repo.findOne({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');

    const before = { name: product.name };

    // `!= null`, not `!== undefined`: the DTO rejects an explicit null with a
    // 400, and this guard stays defensive rather than trusting that alone.
    if (dto.name != null) {
      const name = assertTrimmedName(dto.name, 'name', 'PRODUCT_NAME_EMPTY');
      // Compared case-INSENSITIVELY, matching the unique index. A pure case
      // correction ("малина" → "Малина") is the same row, so it must not be
      // checked against itself and must not 409.
      if (name.toLowerCase() !== product.name.toLowerCase()) {
        await this.assertNameFree(name, product.id);
      }
      product.name = name;
    }

    return this.dataSource.transaction(async (manager) => {
      const saved = await manager.getRepository(Product).save(product);
      const diff = diffFields(before, { name: saved.name }, ['name']);

      // A no-op PATCH must not write an entry: an audit log full of noise is
      // one nobody reads.
      if (diff) {
        await this.audit.record(
          {
            action: 'product.updated',
            actor_id: actor.sub,
            target_type: 'product',
            target_id: saved.id,
            before: diff.before,
            after: diff.after,
          },
          manager,
        );
      }

      return toProductResponse(saved);
    });
  }

  /**
   * A pre-check for a friendly 409. `UQ_products_name_lower` is still the real
   * guarantee — two simultaneous writes both pass this, and the loser gets a
   * 500 rather than a silent duplicate.
   *
   * `lower(...) = lower(...)` on BOTH sides, matching the index exactly: a
   * case-sensitive pre-check would let «малина» through to a constraint
   * violation, turning a 409 into a 500.
   */
  private async assertNameFree(name: string, excludeId?: string): Promise<void> {
    const existing = await this.repo
      .createQueryBuilder('product')
      .where('lower(product.name) = lower(:name)', { name })
      .getOne();

    if (existing && existing.id !== excludeId) {
      throw new ConflictException({ message: 'That name is taken', code: 'PRODUCT_NAME_TAKEN' });
    }
  }
}
```

- [ ] **Step 7: Run the spec to verify it passes**

Run: `cd backend && npx jest src/products/products.service.spec.ts`
Expected: PASS.

- [ ] **Step 8: Write the controller and module**

Create `backend/src/products/products.controller.ts`:

```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user-role.enum';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsQueryDto } from './dto/list-products.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * There is no DELETE here and there never will be — deactivation is this
 * domain's only removal verb, and `products` does not even have that: a product
 * is retired by deactivating its grades (§4.1).
 *
 * There is no `GET /:id` either: the list returns the whole catalog in one
 * request, so nothing needs a single-row read.
 *
 * Reads are open to both roles — the operator's intake screen needs the whole
 * catalog. Writes are owner-only: §10.1 knows two roles, and everything
 * configurable belongs to the керівник.
 */
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @Auth()
  list(@Query() query: ListProductsQueryDto) {
    return this.products.list(query);
  }

  @Post()
  @Auth(UserRole.NetworkOwner)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateProductDto) {
    return this.products.create(actor, dto);
  }

  @Patch(':id')
  @Auth(UserRole.NetworkOwner)
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(actor, id, dto);
  }
}
```

Create `backend/src/products/products.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './product.entity';
import { ProductGrade } from './product-grade.entity';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { AuditModule } from '../audit/audit.module';

/**
 * Owns `products` AND `product_grades` — one aggregate. A grade is meaningless
 * without its product, and §4.1's visibility rule spans both tables, so it can
 * only be evaluated by something that can see both.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Product, ProductGrade]), AuditModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [TypeOrmModule, ProductsService],
})
export class ProductsModule {}
```

- [ ] **Step 9: Register the module**

In `backend/src/app.module.ts`, add `import { ProductsModule } from './products/products.module';` alongside the other feature imports, and `ProductsModule,` to the `imports` array after `CollectionPointsModule`.

- [ ] **Step 10: Verify the whole unit suite and the build**

Run: `cd backend && npm test && npm run build && npm run lint`
Expected: all PASS.

- [ ] **Step 11: Commit**

```bash
git add backend/src/common/dto/catalog-pagination-query.dto.ts backend/src/products backend/src/audit/audit-log.entity.ts backend/src/app.module.ts
git commit -m "feat: products module with owner-only writes"
```

---

## Task 5: Product grades

Same module, second entity. `product_id` is required on create, immutable thereafter.

**Files:**
- Create: `backend/src/products/product-grade.mapper.ts`
- Create: `backend/src/products/dto/create-product-grade.dto.ts`
- Create: `backend/src/products/dto/update-product-grade.dto.ts`
- Create: `backend/src/products/dto/list-product-grades.query.ts`
- Create: `backend/src/products/product-grades.service.ts`
- Create: `backend/src/products/product-grades.controller.ts`
- Test: `backend/src/products/product-grades.service.spec.ts`
- Modify: `backend/src/products/products.module.ts` (register the second service and controller)

**Interfaces:**
- Consumes: `ProductGrade` (Task 3), `ProductsService.findOneRaw` (Task 4), `CatalogPaginationQueryDto` (Task 4), `BooleanQueryParam` (Task 1), `assertTrimmedName` / `diffFields` (Task 2).
- Produces: `ProductGradeResponse { id, product_id, name, is_active, created_at }`.

- [ ] **Step 1: Write the failing service spec**

Create `backend/src/products/product-grades.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import { ProductGradesService } from './product-grades.service';

const owner = {
  sub: 'u-owner',
  username: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
};

describe('ProductGradesService', () => {
  let repo: {
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let products: { findOneRaw: jest.Mock };
  let audit: { record: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let service: ProductGradesService;
  let nameLookup: jest.Mock;

  const grade = (over: Record<string, unknown> = {}) => ({
    id: 'grade-1',
    product_id: 'prod-1',
    name: '1 сорт',
    is_active: true,
    created_at: new Date('2026-07-15T06:00:00.000Z'),
    updated_at: new Date('2026-07-15T06:00:00.000Z'),
    ...over,
  });

  beforeEach(() => {
    nameLookup = jest.fn().mockResolvedValue(null);
    repo = {
      findAndCount: jest.fn().mockResolvedValue([[grade()], 1]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((g) => Promise.resolve(g)),
      create: jest.fn().mockImplementation((g) => grade(g)),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: nameLookup,
      }),
    };
    products = { findOneRaw: jest.fn().mockResolvedValue({ id: 'prod-1', name: 'Малина' }) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    dataSource = {
      transaction: jest.fn().mockImplementation((cb) => cb({ getRepository: () => repo })),
    };
    service = new ProductGradesService(
      repo as never,
      products as never,
      dataSource as never,
      audit as never,
    );
  });

  describe('list', () => {
    it('hides inactive grades by default', async () => {
      await service.list({ page: 1, limit: 100 });
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { is_active: true }, order: { name: 'ASC' } }),
      );
    });

    it('includes inactive grades when asked', async () => {
      await service.list({ page: 1, limit: 100, include_inactive: true });
      expect(repo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });

    it('filters by product_id', async () => {
      await service.list({ page: 1, limit: 100, product_id: 'prod-1' });
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { product_id: 'prod-1', is_active: true } }),
      );
    });
  });

  describe('create', () => {
    it('404s when the parent product does not exist', async () => {
      products.findOneRaw.mockResolvedValue(null);
      await expect(
        service.create(owner, { product_id: 'nope', name: '1 сорт' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates and audits inside the transaction', async () => {
      const result = await service.create(owner, { product_id: 'prod-1', name: ' 1 сорт ' });
      expect(repo.create).toHaveBeenCalledWith({ product_id: 'prod-1', name: '1 сорт' });
      expect(result.product_id).toBe('prod-1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'product-grade.created',
          target_type: 'product_grade',
          after: { product_id: 'prod-1', name: '1 сорт' },
        }),
        expect.anything(),
      );
    });

    it('rejects an all-whitespace name with a 400', async () => {
      await expect(
        service.create(owner, { product_id: 'prod-1', name: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('409s on a name already used under the SAME product, ignoring case', async () => {
      nameLookup.mockResolvedValue(grade({ name: '1 СОРТ' }));
      await expect(
        service.create(owner, { product_id: 'prod-1', name: '1 сорт' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('deactivates the last active grade without complaint — that is the retirement mechanism', async () => {
      repo.findOne.mockResolvedValue(grade());
      const result = await service.update(owner, 'grade-1', { is_active: false });
      expect(result.is_active).toBe(false);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'product-grade.updated',
          before: { is_active: true },
          after: { is_active: false },
        }),
        expect.anything(),
      );
    });

    it('never moves a grade to another product', async () => {
      repo.findOne.mockResolvedValue(grade());
      // `product_id` is not part of UpdateProductGradeDto; passing it must not
      // reach the row. The global ValidationPipe's forbidNonWhitelisted would
      // already 400 it over HTTP — this proves the service does not read it.
      await service.update(owner, 'grade-1', { product_id: 'prod-2' } as never);
      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ product_id: 'prod-1' }));
    });

    it('writes no audit entry for a no-op PATCH', async () => {
      repo.findOne.mockResolvedValue(grade());
      await service.update(owner, 'grade-1', {});
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/products/product-grades.service.spec.ts`
Expected: FAIL — `Cannot find module './product-grades.service'`.

- [ ] **Step 3: Write the mapper and DTOs**

Create `backend/src/products/product-grade.mapper.ts`:

```ts
import { ProductGrade } from './product-grade.entity';

/** `product_id` IS in the response — the client builds its product→grades tree
 *  from it — and is NOT in the update DTO: a grade never changes parent. */
export interface ProductGradeResponse {
  id: string;
  product_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export function toProductGradeResponse(grade: ProductGrade): ProductGradeResponse {
  return {
    id: grade.id,
    product_id: grade.product_id,
    name: grade.name,
    is_active: grade.is_active,
    created_at: grade.created_at.toISOString(),
  };
}
```

Create `backend/src/products/dto/create-product-grade.dto.ts`:

```ts
import { IsString, IsUUID, Length } from 'class-validator';

export class CreateProductGradeDto {
  /** Required, and the only time a grade's parent is ever set. */
  @IsUUID()
  product_id: string;

  @IsString()
  @Length(1, 128)
  name: string;
}
```

Create `backend/src/products/dto/update-product-grade.dto.ts`:

```ts
import { IsBoolean, IsString, Length, ValidateIf } from 'class-validator';

/**
 * THERE IS NO `product_id` HERE, and its absence is the rule. Re-parenting a
 * grade rewrites history silently: `intake_items` stores the grade id alone and
 * §4.1 makes the PRODUCT the reporting key, so moving "1 сорт" from Малина to
 * Полуниця moves every receipt line ever written against it into another
 * product's totals — a report correct last month becomes wrong with no document
 * changing. A grade under the wrong product is deactivated and recreated.
 *
 * `@ValidateIf(... !== undefined)` rather than `@IsOptional()` on both fields:
 * both back NOT NULL columns, and `@IsOptional()` would let an explicit `null`
 * skip every validator and reach the database as a 500.
 */
export class UpdateProductGradeDto {
  @ValidateIf((o: UpdateProductGradeDto) => o.name !== undefined)
  @IsString()
  @Length(1, 128)
  name?: string;

  @ValidateIf((o: UpdateProductGradeDto) => o.is_active !== undefined)
  @IsBoolean()
  is_active?: boolean;
}
```

Create `backend/src/products/dto/list-product-grades.query.ts`:

```ts
import { IsOptional, IsUUID } from 'class-validator';
import { CatalogPaginationQueryDto } from '../../common/dto/catalog-pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

export class ListProductGradesQueryDto extends CatalogPaginationQueryDto {
  /** The filter the owner UI's product→grades tree actually needs. */
  @IsOptional()
  @IsUUID()
  product_id?: string;

  /** Deactivated grades are hidden by default — they exist for history. */
  @BooleanQueryParam()
  include_inactive?: boolean;
}
```

- [ ] **Step 4: Write the service**

Create `backend/src/products/product-grades.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ProductGrade } from './product-grade.entity';
import { ProductsService } from './products.service';
import { CreateProductGradeDto } from './dto/create-product-grade.dto';
import { UpdateProductGradeDto } from './dto/update-product-grade.dto';
import { ListProductGradesQueryDto } from './dto/list-product-grades.query';
import { ProductGradeResponse, toProductGradeResponse } from './product-grade.mapper';
import { AuditService } from '../audit/audit.service';
import { assertTrimmedName } from '../common/trimmed-name';
import { diffFields } from '../common/diff-fields';
import { Paginated } from '../common/dto/paginated';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const GRADE_FIELDS = ['name', 'is_active'] as const;

@Injectable()
export class ProductGradesService {
  constructor(
    @InjectRepository(ProductGrade)
    private readonly repo: Repository<ProductGrade>,
    private readonly products: ProductsService,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListProductGradesQueryDto): Promise<Paginated<ProductGradeResponse>> {
    const where: Record<string, unknown> = {};
    if (query.product_id) where.product_id = query.product_id;
    if (!query.include_inactive) where.is_active = true;

    const [data, total] = await this.repo.findAndCount({
      where,
      order: { name: 'ASC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      data: data.map(toProductGradeResponse),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateProductGradeDto,
  ): Promise<ProductGradeResponse> {
    // Through the owning service, not a second query of our own: the foreign
    // key would catch an unknown product with a 500; this makes it a 404.
    const product = await this.products.findOneRaw(dto.product_id);
    if (!product) throw new NotFoundException('Product not found');

    const name = assertTrimmedName(dto.name, 'name', 'GRADE_NAME_EMPTY');
    await this.assertNameFree(dto.product_id, name);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ProductGrade);
      const grade = await repo.save(repo.create({ product_id: dto.product_id, name }));

      await this.audit.record(
        {
          action: 'product-grade.created',
          actor_id: actor.sub,
          target_type: 'product_grade',
          target_id: grade.id,
          after: { product_id: grade.product_id, name: grade.name },
        },
        manager,
      );

      return toProductGradeResponse(grade);
    });
  }

  /**
   * Deactivating the LAST active grade of a product is deliberately NOT
   * blocked: that is exactly how a product is retired (§4.1, with Кизил as the
   * worked example). A guard here would remove the only retirement path.
   *
   * TODO (when `grade_prices` lands): decide whether deactivating a grade that
   * has a price set for today deserves a WARNING. Expectation: no — §4.5
   * already hides an inactive grade from the intake screen. Never a refusal.
   */
  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateProductGradeDto,
  ): Promise<ProductGradeResponse> {
    const grade = await this.repo.findOne({ where: { id } });
    if (!grade) throw new NotFoundException('Product grade not found');

    const before = { name: grade.name, is_active: grade.is_active };

    if (dto.name != null) {
      const name = assertTrimmedName(dto.name, 'name', 'GRADE_NAME_EMPTY');
      if (name.toLowerCase() !== grade.name.toLowerCase()) {
        await this.assertNameFree(grade.product_id, name, grade.id);
      }
      grade.name = name;
    }
    if (dto.is_active != null) grade.is_active = dto.is_active;

    return this.dataSource.transaction(async (manager) => {
      const saved = await manager.getRepository(ProductGrade).save(grade);
      const diff = diffFields(
        before,
        { name: saved.name, is_active: saved.is_active },
        GRADE_FIELDS,
      );

      if (diff) {
        await this.audit.record(
          {
            action: 'product-grade.updated',
            actor_id: actor.sub,
            target_type: 'product_grade',
            target_id: saved.id,
            before: diff.before,
            after: diff.after,
          },
          manager,
        );
      }

      return toProductGradeResponse(saved);
    });
  }

  /** Scoped to the product, matching `UQ_product_grades_product_name_lower`:
   *  "1 сорт" exists for every berry, so uniqueness is per product, not global. */
  private async assertNameFree(
    productId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.repo
      .createQueryBuilder('grade')
      .where('grade.product_id = :productId', { productId })
      .andWhere('lower(grade.name) = lower(:name)', { name })
      .getOne();

    if (existing && existing.id !== excludeId) {
      throw new ConflictException({
        message: 'That grade name is already used for this product',
        code: 'GRADE_NAME_TAKEN',
      });
    }
  }
}
```

- [ ] **Step 5: Run the spec to verify it passes**

Run: `cd backend && npx jest src/products/product-grades.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Write the controller and register it**

Create `backend/src/products/product-grades.controller.ts`:

```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user-role.enum';
import { ProductGradesService } from './product-grades.service';
import { CreateProductGradeDto } from './dto/create-product-grade.dto';
import { UpdateProductGradeDto } from './dto/update-product-grade.dto';
import { ListProductGradesQueryDto } from './dto/list-product-grades.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * Flat, not nested under `/products/:id/grades`: every later table
 * (`grade_prices`, `intake_items`) addresses a grade by id alone and never
 * mentions its product, so demanding a parent id here would be a shape unique
 * to this one module. No DELETE, no `GET /:id`.
 */
@Controller('product-grades')
export class ProductGradesController {
  constructor(private readonly grades: ProductGradesService) {}

  @Get()
  @Auth()
  list(@Query() query: ListProductGradesQueryDto) {
    return this.grades.list(query);
  }

  @Post()
  @Auth(UserRole.NetworkOwner)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateProductGradeDto) {
    return this.grades.create(actor, dto);
  }

  @Patch(':id')
  @Auth(UserRole.NetworkOwner)
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductGradeDto,
  ) {
    return this.grades.update(actor, id, dto);
  }
}
```

In `backend/src/products/products.module.ts`, add both to the module: `controllers: [ProductsController, ProductGradesController]`, `providers: [ProductsService, ProductGradesService]`, and add `ProductGradesService` to `exports`.

- [ ] **Step 7: Verify the whole unit suite and the build**

Run: `cd backend && npm test && npm run build && npm run lint`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/products
git commit -m "feat: product grades, addressed flat and never re-parented"
```

---

## Task 6: Tare types module

**Files:**
- Create: `backend/src/tare-types/tare-type.mapper.ts`
- Create: `backend/src/tare-types/dto/create-tare-type.dto.ts`
- Create: `backend/src/tare-types/dto/update-tare-type.dto.ts`
- Create: `backend/src/tare-types/dto/list-tare-types.query.ts`
- Create: `backend/src/tare-types/tare-types.service.ts`
- Create: `backend/src/tare-types/tare-types.controller.ts`
- Create: `backend/src/tare-types/tare-types.module.ts`
- Test: `backend/src/tare-types/tare-types.service.spec.ts`
- Modify: `backend/src/app.module.ts` (register `TareTypesModule`)

**Interfaces:**
- Consumes: `TareType` (Task 3), `CatalogPaginationQueryDto` (Task 4), `BooleanQueryParam` (Task 1), `assertTrimmedName` / `diffFields` (Task 2).
- Produces: `TareTypeResponse { id, name, weight_kg, deposit_price, is_crate, is_active, created_at }` — `weight_kg` and `deposit_price` are **strings**.

- [ ] **Step 1: Write the failing service spec**

Create `backend/src/tare-types/tare-types.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import { TareTypesService } from './tare-types.service';

const owner = {
  sub: 'u-owner',
  username: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
};

describe('TareTypesService', () => {
  let repo: {
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let audit: { record: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let service: TareTypesService;
  let nameLookup: jest.Mock;

  const tare = (over: Record<string, unknown> = {}) => ({
    id: 'tare-1',
    name: 'Ящик',
    weight_kg: '1.20',
    deposit_price: '120.00',
    is_crate: true,
    is_active: true,
    created_at: new Date('2026-07-15T06:00:00.000Z'),
    updated_at: new Date('2026-07-15T06:00:00.000Z'),
    ...over,
  });

  beforeEach(() => {
    nameLookup = jest.fn().mockResolvedValue(null);
    repo = {
      findAndCount: jest.fn().mockResolvedValue([[tare()], 1]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
      create: jest.fn().mockImplementation((t) => tare(t)),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getOne: nameLookup,
      }),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    dataSource = {
      transaction: jest.fn().mockImplementation((cb) => cb({ getRepository: () => repo })),
    };
    service = new TareTypesService(repo as never, dataSource as never, audit as never);
  });

  it('returns both numbers as strings, never numbers', async () => {
    const result = await service.list({ page: 1, limit: 100 });
    expect(result.data[0].weight_kg).toBe('1.20');
    expect(typeof result.data[0].weight_kg).toBe('string');
    expect(typeof result.data[0].deposit_price).toBe('string');
  });

  it('hides inactive tare types by default', async () => {
    await service.list({ page: 1, limit: 100 });
    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { is_active: true }, order: { name: 'ASC' } }),
    );
  });

  describe('create', () => {
    it('stores both numbers verbatim and audits inside the transaction', async () => {
      const result = await service.create(owner, {
        name: ' Ящик ',
        weight_kg: '1.20',
        deposit_price: '120.00',
        is_crate: true,
      });
      expect(repo.create).toHaveBeenCalledWith({
        name: 'Ящик',
        weight_kg: '1.20',
        deposit_price: '120.00',
        is_crate: true,
      });
      expect(result.deposit_price).toBe('120.00');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tare-type.created', target_type: 'tare_type' }),
        expect.anything(),
      );
    });

    it('defaults is_crate to false when not given', async () => {
      await service.create(owner, { name: 'Відро', weight_kg: '0.30', deposit_price: '0.00' });
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ is_crate: false }));
    });

    it('rejects an all-whitespace name with a 400', async () => {
      await expect(
        service.create(owner, { name: '  ', weight_kg: '1.00', deposit_price: '0.00' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('409s on a name that exists in another case', async () => {
      nameLookup.mockResolvedValue(tare({ name: 'ящик' }));
      await expect(
        service.create(owner, { name: 'Ящик', weight_kg: '1.20', deposit_price: '120.00' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('404s on an unknown id', async () => {
      await expect(service.update(owner, 'nope', { weight_kg: '1.00' })).rejects.toThrow(
        NotFoundException,
      );
    });

    // tare_types keeps no history of its own, and §2.7 snapshots these values
    // downstream — so the audit log is the ONLY record that a deposit moved.
    it('audits a deposit change, which nothing else in the database records', async () => {
      repo.findOne.mockResolvedValue(tare());
      await service.update(owner, 'tare-1', { deposit_price: '130.00' });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tare-type.updated',
          before: { deposit_price: '120.00' },
          after: { deposit_price: '130.00' },
        }),
        expect.anything(),
      );
    });

    it('allows a non-crate to carry a deposit price — there is no cross-rule', async () => {
      repo.findOne.mockResolvedValue(tare({ is_crate: false }));
      await expect(
        service.update(owner, 'tare-1', { deposit_price: '50.00' }),
      ).resolves.toBeDefined();
    });

    it('writes no audit entry for a no-op PATCH', async () => {
      repo.findOne.mockResolvedValue(tare());
      await service.update(owner, 'tare-1', {});
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/tare-types/tare-types.service.spec.ts`
Expected: FAIL — `Cannot find module './tare-types.service'`.

- [ ] **Step 3: Write the mapper and DTOs**

Create `backend/src/tare-types/tare-type.mapper.ts`:

```ts
import { TareType } from './tare-type.entity';

/** `weight_kg` and `deposit_price` are STRINGS on the wire — `numeric` is
 *  carried end to end so no value ever passes through a binary float. */
export interface TareTypeResponse {
  id: string;
  name: string;
  weight_kg: string;
  deposit_price: string;
  is_crate: boolean;
  is_active: boolean;
  created_at: string;
}

export function toTareTypeResponse(tare: TareType): TareTypeResponse {
  return {
    id: tare.id,
    name: tare.name,
    weight_kg: tare.weight_kg,
    deposit_price: tare.deposit_price,
    is_crate: tare.is_crate,
    is_active: tare.is_active,
    created_at: tare.created_at.toISOString(),
  };
}
```

Create `backend/src/tare-types/dto/create-tare-type.dto.ts`:

```ts
import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * Both numbers are REQUIRED: the DBML gives neither a default, and a tare type
 * that does not say what it weighs is unusable by §2.5's automatic subtraction.
 *
 * Both are STRINGS, and the regexes are the columns' own shapes —
 * `numeric(10,2)` is 8 integer digits, `numeric(12,2)` is 10. The pattern
 * accepts no sign, which is the first half of "zero yes, negative no"; the
 * CHECK constraints are the real guarantee.
 */
export class CreateTareTypeDto {
  @IsString()
  @Length(1, 128)
  name: string;

  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message: 'weight_kg must be a decimal string with at most 2 decimal places',
  })
  weight_kg: string;

  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'deposit_price must be a decimal string with at most 2 decimal places',
  })
  deposit_price: string;

  @IsOptional()
  @IsBoolean()
  is_crate?: boolean;
}
```

Create `backend/src/tare-types/dto/update-tare-type.dto.ts`:

```ts
import { IsBoolean, IsString, Length, Matches, ValidateIf } from 'class-validator';

/**
 * Every field here backs a NOT NULL column, so all five use
 * `@ValidateIf(... !== undefined)` rather than `@IsOptional()`: the latter
 * treats an explicit `null` as absent and skips every later validator, letting
 * `{"weight_kg": null}` reach the database as a 500 where a 400 belongs.
 *
 * Editing these numbers is SAFE for history by construction: §2.7 snapshots
 * them into `intake_items.tare_weight_kg` and `crate_issuances.deposit_per_unit`
 * at write time, so raising a crate from 120 to 130 cannot move a July
 * issuance. There is deliberately no rule tying `deposit_price` to `is_crate`.
 */
export class UpdateTareTypeDto {
  @ValidateIf((o: UpdateTareTypeDto) => o.name !== undefined)
  @IsString()
  @Length(1, 128)
  name?: string;

  @ValidateIf((o: UpdateTareTypeDto) => o.weight_kg !== undefined)
  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message: 'weight_kg must be a decimal string with at most 2 decimal places',
  })
  weight_kg?: string;

  @ValidateIf((o: UpdateTareTypeDto) => o.deposit_price !== undefined)
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'deposit_price must be a decimal string with at most 2 decimal places',
  })
  deposit_price?: string;

  @ValidateIf((o: UpdateTareTypeDto) => o.is_crate !== undefined)
  @IsBoolean()
  is_crate?: boolean;

  @ValidateIf((o: UpdateTareTypeDto) => o.is_active !== undefined)
  @IsBoolean()
  is_active?: boolean;
}
```

Create `backend/src/tare-types/dto/list-tare-types.query.ts`:

```ts
import { CatalogPaginationQueryDto } from '../../common/dto/catalog-pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

export class ListTareTypesQueryDto extends CatalogPaginationQueryDto {
  /** Deactivated tare types are hidden by default — they exist for history,
   *  since old receipts still snapshot their weight. */
  @BooleanQueryParam()
  include_inactive?: boolean;
}
```

- [ ] **Step 4: Write the service**

Create `backend/src/tare-types/tare-types.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TareType } from './tare-type.entity';
import { CreateTareTypeDto } from './dto/create-tare-type.dto';
import { UpdateTareTypeDto } from './dto/update-tare-type.dto';
import { ListTareTypesQueryDto } from './dto/list-tare-types.query';
import { TareTypeResponse, toTareTypeResponse } from './tare-type.mapper';
import { AuditService } from '../audit/audit.service';
import { assertTrimmedName } from '../common/trimmed-name';
import { diffFields } from '../common/diff-fields';
import { Paginated } from '../common/dto/paginated';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const TARE_FIELDS = ['name', 'weight_kg', 'deposit_price', 'is_crate', 'is_active'] as const;

@Injectable()
export class TareTypesService {
  constructor(
    @InjectRepository(TareType)
    private readonly repo: Repository<TareType>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListTareTypesQueryDto): Promise<Paginated<TareTypeResponse>> {
    const where: Record<string, unknown> = {};
    if (!query.include_inactive) where.is_active = true;

    const [data, total] = await this.repo.findAndCount({
      where,
      order: { name: 'ASC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return { data: data.map(toTareTypeResponse), total, page: query.page, limit: query.limit };
  }

  async create(actor: AuthenticatedUser, dto: CreateTareTypeDto): Promise<TareTypeResponse> {
    const name = assertTrimmedName(dto.name, 'name', 'TARE_TYPE_NAME_EMPTY');
    await this.assertNameFree(name);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(TareType);
      const tare = await repo.save(
        repo.create({
          name,
          // Stored verbatim as strings. No arithmetic is performed on either
          // value anywhere in this module.
          weight_kg: dto.weight_kg,
          deposit_price: dto.deposit_price,
          is_crate: dto.is_crate ?? false,
        }),
      );

      await this.audit.record(
        {
          action: 'tare-type.created',
          actor_id: actor.sub,
          target_type: 'tare_type',
          target_id: tare.id,
          after: {
            name: tare.name,
            weight_kg: tare.weight_kg,
            deposit_price: tare.deposit_price,
            is_crate: tare.is_crate,
          },
        },
        manager,
      );

      return toTareTypeResponse(tare);
    });
  }

  /**
   * TODO (when `crate_issuances` lands): decide whether deactivating a tare
   * type with outstanding deposits deserves a WARNING. Never a refusal — the
   * schema's stance throughout is that a management decision gets a warning and
   * not a locked button (§6.1, правка 14).
   */
  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateTareTypeDto,
  ): Promise<TareTypeResponse> {
    const tare = await this.repo.findOne({ where: { id } });
    if (!tare) throw new NotFoundException('Tare type not found');

    const before = this.snapshot(tare);

    if (dto.name != null) {
      const name = assertTrimmedName(dto.name, 'name', 'TARE_TYPE_NAME_EMPTY');
      if (name.toLowerCase() !== tare.name.toLowerCase()) {
        await this.assertNameFree(name, tare.id);
      }
      tare.name = name;
    }
    if (dto.weight_kg != null) tare.weight_kg = dto.weight_kg;
    if (dto.deposit_price != null) tare.deposit_price = dto.deposit_price;
    if (dto.is_crate != null) tare.is_crate = dto.is_crate;
    if (dto.is_active != null) tare.is_active = dto.is_active;

    return this.dataSource.transaction(async (manager) => {
      const saved = await manager.getRepository(TareType).save(tare);
      const diff = diffFields(before, this.snapshot(saved), TARE_FIELDS);

      // These two numbers keep NO history of their own, and §2.7 snapshots them
      // downstream — so this entry is the only record anywhere that a crate
      // deposit went 120 → 130, and when, and who did it.
      if (diff) {
        await this.audit.record(
          {
            action: 'tare-type.updated',
            actor_id: actor.sub,
            target_type: 'tare_type',
            target_id: saved.id,
            before: diff.before,
            after: diff.after,
          },
          manager,
        );
      }

      return toTareTypeResponse(saved);
    });
  }

  private snapshot(tare: TareType): Record<(typeof TARE_FIELDS)[number], unknown> {
    return {
      name: tare.name,
      weight_kg: tare.weight_kg,
      deposit_price: tare.deposit_price,
      is_crate: tare.is_crate,
      is_active: tare.is_active,
    };
  }

  /** Case-insensitive, matching `UQ_tare_types_name_lower`. */
  private async assertNameFree(name: string, excludeId?: string): Promise<void> {
    const existing = await this.repo
      .createQueryBuilder('tare')
      .where('lower(tare.name) = lower(:name)', { name })
      .getOne();

    if (existing && existing.id !== excludeId) {
      throw new ConflictException({ message: 'That name is taken', code: 'TARE_TYPE_NAME_TAKEN' });
    }
  }
}
```

- [ ] **Step 5: Run the spec to verify it passes**

Run: `cd backend && npx jest src/tare-types/tare-types.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Write the controller and module**

Create `backend/src/tare-types/tare-types.controller.ts`:

```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user-role.enum';
import { TareTypesService } from './tare-types.service';
import { CreateTareTypeDto } from './dto/create-tare-type.dto';
import { UpdateTareTypeDto } from './dto/update-tare-type.dto';
import { ListTareTypesQueryDto } from './dto/list-tare-types.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * No DELETE, no `GET /:id`.
 *
 * Reads are open to BOTH roles, which means an operator can see
 * `deposit_price`. That is deliberate: it is money they physically collect
 * (§6.3), and their intake screen needs `weight_kg` for §2.5's automatic tare
 * subtraction. Writes are owner-only — the `tare_types` Note says it outright:
 * «Обидва числа РЕДАГУЮТЬСЯ керівником».
 */
@Controller('tare-types')
export class TareTypesController {
  constructor(private readonly tareTypes: TareTypesService) {}

  @Get()
  @Auth()
  list(@Query() query: ListTareTypesQueryDto) {
    return this.tareTypes.list(query);
  }

  @Post()
  @Auth(UserRole.NetworkOwner)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateTareTypeDto) {
    return this.tareTypes.create(actor, dto);
  }

  @Patch(':id')
  @Auth(UserRole.NetworkOwner)
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTareTypeDto,
  ) {
    return this.tareTypes.update(actor, id, dto);
  }
}
```

Create `backend/src/tare-types/tare-types.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TareType } from './tare-type.entity';
import { TareTypesService } from './tare-types.service';
import { TareTypesController } from './tare-types.controller';
import { AuditModule } from '../audit/audit.module';

/**
 * Its own module, not folded into `ProductsModule`: tare types share no
 * relationship with products. Their only links in the schema are to
 * `intake_item_tare_types` and the `is_crate` flag, neither of which touches a
 * product or a grade.
 */
@Module({
  imports: [TypeOrmModule.forFeature([TareType]), AuditModule],
  controllers: [TareTypesController],
  providers: [TareTypesService],
  exports: [TypeOrmModule, TareTypesService],
})
export class TareTypesModule {}
```

- [ ] **Step 7: Register the module**

In `backend/src/app.module.ts`, add `import { TareTypesModule } from './tare-types/tare-types.module';` and `TareTypesModule,` to the `imports` array after `ProductsModule`.

- [ ] **Step 8: Verify the whole unit suite and the build**

Run: `cd backend && npm test && npm run build && npm run lint`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/tare-types backend/src/app.module.ts
git commit -m "feat: tare types module"
```

---

## Task 7: HTTP-level authorization proof

The one assertion that proves the role split actually reached the decorators. Every other spec in this slice mocks its collaborators and never sees a guard run.

**Files:**
- Test: `backend/src/testing/catalog-pipeline.db-spec.ts`

**Interfaces:**
- Consumes: every controller from Tasks 4–6, plus `resolveTestDatabaseName` from `./db-harness`.

- [ ] **Step 1: Write the failing pipeline spec**

Create `backend/src/testing/catalog-pipeline.db-spec.ts`:

```ts
import { randomUUID } from 'crypto';
// `export = supertest`: this repo's tsconfig has no `esModuleInterop`, so a
// default import type-checks and then resolves to `undefined` at runtime.
import request = require('supertest');
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
// MUST be imported before `../app.module` — it loads `.env` as a side effect,
// and AppModule's decorator runs ConfigModule.forRoot() eagerly at import time.
import { resolveTestDatabaseName } from './db-harness';
import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';
import { CredentialsService } from '../users/credentials.service';
import { LOCAL_PROVIDER } from '../users/user-identity.entity';
import { UserRole } from '../users/user-role.enum';

describe('catalog pipeline (HTTP)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DB_NAME = resolveTestDatabaseName();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // Mirrors main.ts: this spec exists to run under the real pipe chain.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('lets the owner write all three catalogs and refuses the operator every write', async () => {
    const users = app.get(UsersService);
    const credentials = app.get(CredentialsService);
    const jwt = app.get(JwtService);

    // Signed directly, not through /auth/login: that route is rate-limited at
    // 10/min per IP and `npm run test:db` is not idempotent within a minute.
    // The token is still real — JwtStrategy.validate() reloads the user row on
    // every request below.
    const tokenFor = (userId: string): string => jwt.sign({ sub: userId });

    const { user: owner } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `cat-owner-${randomUUID()}`,
        first_name: 'Net',
        last_name: 'Owner',
        role: UserRole.NetworkOwner,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    const ownerToken = tokenFor(owner.id);

    const pointRes = await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `cat-point-${randomUUID()}` })
      .expect(201);

    const { user: operator } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `cat-op-${randomUUID()}`,
        first_name: 'Оксана',
        last_name: 'Приймальник',
        role: UserRole.PointOperator,
        collection_point_id: pointRes.body.id as string,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    const operatorToken = tokenFor(operator.id);

    // Names are unique per RUN: app_test persists and is never truncated.
    const productName = `Малина-${randomUUID()}`;
    const tareName = `Ящик-${randomUUID()}`;

    // --- the owner writes ---
    const productRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: productName })
      .expect(201);
    expect(productRes.body).toEqual({
      id: expect.any(String),
      name: productName,
      created_at: expect.any(String),
    });

    const gradeRes = await request(app.getHttpServer())
      .post('/product-grades')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ product_id: productRes.body.id, name: '1 сорт' })
      .expect(201);
    expect(gradeRes.body.product_id).toBe(productRes.body.id);
    expect(gradeRes.body.is_active).toBe(true);

    const tareRes = await request(app.getHttpServer())
      .post('/tare-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: tareName, weight_kg: '1.20', deposit_price: '120.00', is_crate: true })
      .expect(201);
    // Strings on the wire, not numbers — the money representation rule, proved
    // through the real serializer rather than asserted against a mapper.
    expect(tareRes.body.weight_kg).toBe('1.20');
    expect(tareRes.body.deposit_price).toBe('120.00');

    // --- the operator reads all three ---
    for (const path of ['/products', '/product-grades', '/tare-types']) {
      const res = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      expect(res.body).toEqual(
        expect.objectContaining({ data: expect.any(Array), total: expect.any(Number) }),
      );
      // The bounded-catalog default, not PaginationQueryDto's 20.
      expect(res.body.limit).toBe(100);
    }

    // --- and is refused every write. This is the RolesGuard, running for real ---
    await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: `nope-${randomUUID()}` })
      .expect(403);

    await request(app.getHttpServer())
      .post('/product-grades')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ product_id: productRes.body.id, name: '2 сорт' })
      .expect(403);

    await request(app.getHttpServer())
      .post('/tare-types')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: `nope-${randomUUID()}`, weight_kg: '1.00', deposit_price: '0.00' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/tare-types/${tareRes.body.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ deposit_price: '999.00' })
      .expect(403);

    // --- and no DELETE route exists for anyone ---
    await request(app.getHttpServer())
      .delete(`/products/${productRes.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
  });

  it('rejects a query flag that used to be accepted and ignored', async () => {
    const users = app.get(UsersService);
    const credentials = app.get(CredentialsService);
    const jwt = app.get(JwtService);

    const { user: owner } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `cat-flag-${randomUUID()}`,
        first_name: 'Flag',
        last_name: 'Owner',
        role: UserRole.NetworkOwner,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    const token = jwt.sign({ sub: owner.id });

    // '1' now MEANS true rather than silently meaning false…
    await request(app.getHttpServer())
      .get('/tare-types?include_inactive=1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // …and '2' is a 400 rather than a silent false.
    await request(app.getHttpServer())
      .get('/tare-types?include_inactive=2')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd backend && npm run test:db -- src/testing/catalog-pipeline.db-spec.ts`
Expected: PASS. If the `DELETE` assertion returns 405 rather than 404 in this Nest version, change the expectation to match observed behaviour and note it — the point is that no handler exists, not the specific status.

- [ ] **Step 3: Run everything**

Run: `cd backend && npm test && npm run test:db && npm run build && npm run lint`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/testing/catalog-pipeline.db-spec.ts
git commit -m "test: prove catalog authorization over the real HTTP pipeline"
```

---

## Definition of done

- [ ] Nine endpoints exist; no `DELETE` and no `GET /:id` on any of the three tables.
- [ ] `npm test`, `npm run test:db`, `npm run build`, `npm run lint` all pass.
- [ ] Case-variant duplicates are rejected by the database on all four tables, including `collection_points`.
- [ ] `weight_kg` and `deposit_price` are strings from column to JSON; no arithmetic operator touches either.
- [ ] An operator can read all three catalogs and write none.
- [ ] Every create and update writes its audit entry inside the same transaction.
- [ ] `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` is updated: strike the two closed items, record that the three "Blocks the users admin UI" items are now the first task of the UI slice, and add the two new entries this slice creates — the untested migration collision guard, and `CollectionPointsService` still recording its audit entries outside a transaction.
