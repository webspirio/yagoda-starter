# Suppliers list with totals (#230) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The suppliers page shows each supplier's all-time delivered weight, main product and accrued amount, ranked server-side by clickable column headers, with «показати ще» paging.

**Architecture:** `suppliers` is first split into commands/queries with a shared search helper (no behaviour change). A new `GET /supplier-totals` in `supplier-balance` reuses the debt-term SQL and a weight expression shared with the supplier card. The shared `DataTable` gains opt-in sortable headers; the page reads the new endpoint through `useInfiniteQuery` and keeps the sort in the URL.

**Tech Stack:** NestJS 12 + TypeORM (QueryBuilder, `getRawAndEntities`), PostgreSQL 16, Jest (unit + `*.db-spec.ts`); React 19, TanStack Query v5 (`useInfiniteQuery`), React Router v8, Vitest + Testing Library, i18next, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-14-supplier-totals-design.md`

## Global Constraints

- Branch `feat/230-supplier-totals`, main checkout (no worktree). Four code commits in this order: `refactor(suppliers)`, `feat(supplier-balance)`, `feat(data-table)`, `feat(suppliers)`. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No migration, no schema change.
- Numbers are strings end to end; no JS arithmetic on `kg_total` / `accrued` (backend: `supplier-balance/**` is in eslint's money `files`; frontend: format only with `formatKg` / `formatUah` from `@/shared/lib/money`).
- `kg_total` is all-time, live intakes only; `accrued` = `debtTermsSql.intakes + debtTermsSql.topUps`; main product by PRODUCT, tie → name A→Z → id; no intakes → `0.00`, `0.00`, `null`.
- Active suppliers only on `/supplier-totals`; no `include_inactive`.
- Sort keys `weight | amount | name`; default `weight`; default order `desc` for weight/amount, `asc` for name; tail always `last_name ASC, first_name ASC, s.id ASC` (name sort: `s.id ASC` only).
- Page size 100 on the frontend (`limit: 100`).
- `applySupplierSearch` assumes the supplier alias is `s` (both callers use it); spec §2.1's `alias` parameter is dropped as YAGNI.
- No user-visible literal outside `uk.json` / `en.json`; keep the two in step. Frontend tests run in English.
- Verification: `npm run verify:full` once at the end, plus `npx tsc -b` in `frontend/`. Never raise a baseline or the bundle ceiling.

## Review Focus

1. **Weight sorted as text.** `9.50 kg` must rank below `100.00 kg`. A `::text` cast inside the sorted expression would rank it above. Pinned in Task 2's db-spec («orders weight numerically»).
2. **Search plus sort plus count.** `q` must narrow both the page AND `total`, and the sort must still apply. Pinned in Task 2's unit spec (count taken after search) and db-spec (`q` + sort).
3. **A junk `?sort=` / `?order=` in the URL** (hand-edited or stale link) must fall back to the default and not 400 the page. Pinned in Task 4's `supplierSort.test.ts` (`readSort`).
4. **Changing sort while page 2 is loaded** must restart from page 1, not append page 2 of the new order to page 1 of the old one. Pinned in Task 4's hook test (sort is in the query key, `initialPageParam` is 1).
5. **Two suppliers with the same name** (ordinary per §6.3/§3.9) stay two rows in a stable order across pages. Pinned in Task 2's db-spec (a second «Ольга Ярема», page walk with no repeats or drops).

---

### Task 1: Split `suppliers` into commands and queries (no behaviour change)

**Files:**
- Create: `backend/src/suppliers/supplier-search.ts`, `backend/src/suppliers/supplier-search.spec.ts`
- Create: `backend/src/suppliers/supplier-access.ts`
- Create: `backend/src/suppliers/commands/create-supplier.command.ts`, `.../create-supplier.command.spec.ts`
- Create: `backend/src/suppliers/commands/update-supplier.command.ts`, `.../update-supplier.command.spec.ts`
- Create: `backend/src/suppliers/queries/list-suppliers.query.ts`, `.../list-suppliers.query.spec.ts`
- Create: `backend/src/suppliers/queries/find-supplier.query.ts`, `.../find-supplier.query.spec.ts`
- Modify: `backend/src/suppliers/suppliers.controller.ts`, `backend/src/suppliers/suppliers.module.ts`
- Modify (type swap only): `backend/src/crates/crate-balance.controller.ts`, `backend/src/crates/crates.service.ts`, `backend/src/intakes/queries/price-intake.query.ts`, `backend/src/supplier-balance/supplier-balance.controller.ts`, `backend/src/payouts/commands/create-payout.command.ts`
- Delete: `backend/src/suppliers/suppliers.service.ts`, `backend/src/suppliers/suppliers.service.spec.ts`
- Modify: `backend/CLAUDE.md` (the `suppliers/` line of the structure block)

**Interfaces:**
- Produces: `applySupplierSearch(qb: SelectQueryBuilder<Supplier>, raw: string | undefined): void` (alias `s`); `FindSupplierQuery.findOne(actor: AuthenticatedUser, id: string): Promise<SupplierResponse>`; `SuppliersModule` exports `[TypeOrmModule, FindSupplierQuery]`.

- [ ] **Step 1: Write the search spec (fails: module missing)**

`backend/src/suppliers/supplier-search.spec.ts`:

```ts
import { applySupplierSearch } from './supplier-search';

/** Moved verbatim from `SuppliersService.list`'s spec — the `q` lanes are now one
 *  function both `/suppliers` and `/supplier-totals` call. */
describe('applySupplierSearch', () => {
  const run = (q: string | undefined) => {
    const qb = { andWhere: jest.fn().mockReturnThis() };
    applySupplierSearch(qb as never, q);
    return qb.andWhere;
  };
  const NAME_LANE = "(s.first_name ILIKE :q ESCAPE '\\' OR s.last_name ILIKE :q ESCAPE '\\')";

  it('takes the PHONE lane for a digits-only q, matching on the suffix', () => {
    expect(run('45 67')).toHaveBeenCalledWith('s.phone LIKE :phone', { phone: '%4567' });
  });

  it('matches a FULL number exactly, canonicalized', () => {
    expect(run('067 123 45 67')).toHaveBeenCalledWith('s.phone = :phone', { phone: '+380671234567' });
  });

  it('takes the NAME lane for anything else, across both name columns', () => {
    expect(run('Ковал')).toHaveBeenCalledWith(NAME_LANE, { q: '%Ковал%' });
  });

  it('escapes a literal % and _ rather than letting them wildcard-match', () => {
    expect(run('%')).toHaveBeenCalledWith(NAME_LANE, { q: '%\\%%' });
    expect(run('_')).toHaveBeenCalledWith(NAME_LANE, { q: '%\\_%' });
  });

  it('adds nothing for a missing, whitespace-only or pure-punctuation q', () => {
    expect(run(undefined)).not.toHaveBeenCalled();
    expect(run('   ')).not.toHaveBeenCalled();
    expect(run('()')).not.toHaveBeenCalled();
  });

  it('does NOT throw when q is an unparseable phone — search is not entry', () => {
    expect(() => run('4567')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `npm test -w backend -- supplier-search`
Expected: FAIL, `Cannot find module './supplier-search'`.

- [ ] **Step 3: Implement `supplier-search.ts`**

```ts
import type { SelectQueryBuilder } from 'typeorm';
import type { Supplier } from './supplier.entity';
import { canonicalizePhone } from './phone';

/** A `q` made only of digits and phone punctuation takes the phone lane.
 *  Unicode dashes are written as code points for the same reason as in
 *  `phone.ts` — a literal range is invisible in review. */
const LOOKS_LIKE_PHONE = /^[+\d\s()\-‐-―]+$/;

/**
 * THE supplier search box, shared by `GET /suppliers` and `GET /supplier-totals`
 * so the two cannot drift. The builder's supplier alias MUST be `s`.
 *
 * Phone lane: a FULL number matches its canonical form exactly, a partial one
 * its digit suffix («останні чотири цифри?»); a partial number that
 * `canonicalizePhone` rejects falls back to the suffix rather than 400ing a
 * SEARCH. Pure punctuation reduces to no digits and drops the filter — the
 * same end state as a blank box.
 *
 * Name lane: `%`, `_` and `\` are escaped with a named ESCAPE clause, or `?q=%`
 * would match every supplier in scope.
 *
 * Neither predicate is sargable; at hundreds of suppliers per point that is a
 * cheap scan, and the answer past that is a `pg_trgm` GIN index — additive, not
 * pre-built.
 */
export function applySupplierSearch(qb: SelectQueryBuilder<Supplier>, raw: string | undefined): void {
  const q = raw?.trim();
  if (!q) return;

  if (LOOKS_LIKE_PHONE.test(q)) {
    const digits = q.replace(/\D/g, '');
    if (!digits) return;
    const exact = tryCanonicalize(q);
    if (exact) qb.andWhere('s.phone = :phone', { phone: exact });
    else qb.andWhere('s.phone LIKE :phone', { phone: `%${digits}` });
    return;
  }

  const escaped = q.replace(/[%_\\]/g, '\\$&');
  qb.andWhere("(s.first_name ILIKE :q ESCAPE '\\' OR s.last_name ILIKE :q ESCAPE '\\')", {
    q: `%${escaped}%`,
  });
}

function tryCanonicalize(raw: string): string | null {
  try {
    return canonicalizePhone(raw);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `npm test -w backend -- supplier-search`
Expected: PASS, 6 tests.

- [ ] **Step 5: Create `supplier-access.ts`**

Move `resolveWritePoint`, `visibleTo` and `assertPhoneFree` out of `SuppliersService` as plain functions, with their doc comments kept word for word:

```ts
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { Supplier } from './supplier.entity';
import { assertOwnsPoint } from '../auth/access/point-scope';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/** An operator's point is derived from their token — a body value naming a
 *  different point is refused. An owner has no point of their own and must
 *  name one, which is then validated with `assertOwnsPoint` (a no-op for an
 *  owner, since they own every point). */
export function resolveWritePoint(actor: AuthenticatedUser, requested?: string): string {
  if (actor.collection_point_id && !requested) return actor.collection_point_id;
  if (!requested) {
    throw new BadRequestException({
      message: 'collection_point_id is required',
      code: 'COLLECTION_POINT_REQUIRED',
    });
  }
  assertOwnsPoint(actor, requested);
  return requested;
}

export function visibleTo(actor: AuthenticatedUser, supplier: Supplier): boolean {
  if (actor.role === UserRole.NetworkOwner) return true;
  return actor.collection_point_id === supplier.collection_point_id;
}

/**
 * The friendly 409. `UQ_suppliers_point_phone` is the real guarantee — this
 * is a check-then-act and two concurrent creates can both pass it, leaving
 * the loser with a 500 instead of a 409. That matches the pre-existing shape
 * in `CollectionPointsService`, `UserAdminService` and the three catalog
 * services; recorded for consistency, not as a new defect.
 */
export async function assertPhoneFree(
  repo: Repository<Supplier>,
  pointId: string,
  phone: string,
  excludeId?: string,
): Promise<void> {
  const existing = await repo
    .createQueryBuilder('s')
    .where('s.collection_point_id = :pointId AND s.phone = :phone', { pointId, phone })
    .getOne();

  if (existing && existing.id !== excludeId) {
    throw new ConflictException({
      message: 'A supplier with that phone already exists at this point',
      code: 'SUPPLIER_PHONE_TAKEN',
    });
  }
}
```

- [ ] **Step 6: Write the four class specs (they fail: classes missing)**

Each new spec starts with the **fixture block of `suppliers.service.spec.ts` lines 1–81 copied verbatim** (imports, `POINT_A`/`POINT_B`, `owner`/`operator`, the `repo`/`txRepo`/`manager`/`audit`/`points`/`dataSource`/`qb` mocks, the `supplier()` factory and `beforeEach`). Only the import of the class under test and the last lines of `beforeEach` change:

| Spec | Import | Construct (replaces `service = new SuppliersService(...)`) | Body moved verbatim from the old spec |
|---|---|---|---|
| `commands/create-supplier.command.spec.ts` | `import { CreateSupplierCommand } from './create-supplier.command';` | `command = new CreateSupplierCommand(repo as never, dataSource as never, audit as never, points as never);` | `describe('create', …)` (old lines 83–175), with `service.create` → `command.create` |
| `commands/update-supplier.command.spec.ts` | `import { UpdateSupplierCommand } from './update-supplier.command';` | `command = new UpdateSupplierCommand(repo as never, dataSource as never, audit as never);` | `describe('update', …)` (old lines 177–233), `service.update` → `command.update` |
| `queries/list-suppliers.query.spec.ts` | `import { ListSuppliersQuery } from './list-suppliers.query';` | `query = new ListSuppliersQuery(repo as never);` | the five `list` cases that are NOT about `q` (operator pin, owner span, owner-requested point, id tie-break, hides inactive), `service.list` → `query.list`, plus the one below |
| `queries/find-supplier.query.spec.ts` | `import { FindSupplierQuery } from './find-supplier.query';` | `query = new FindSupplierQuery(repo as never);` | `describe('findOne', …)` (old lines 328–341), `service.findOne` → `query.findOne` |

In the copied fixture, the relative import paths move one directory up: `'../users/user-role.enum'` → `'../../users/user-role.enum'`, `'./supplier-kind.enum'` → `'../supplier-kind.enum'`. Drop the mocks a spec never uses (e.g. `audit` and `points` from the two query specs) so eslint's unused-vars rule stays green.

The `q` cases now live in `supplier-search.spec.ts`. Add one wiring case to `list-suppliers.query.spec.ts`, so the query is proven to call the helper:

```ts
it('applies the shared search to its builder', async () => {
  await query.list(operator, { page: 1, limit: 20, q: 'Ковал' } as never);
  expect(qb.andWhere).toHaveBeenCalledWith(
    "(s.first_name ILIKE :q ESCAPE '\\' OR s.last_name ILIKE :q ESCAPE '\\')",
    { q: '%Ковал%' },
  );
});
```

Run: `npm test -w backend -- suppliers/`
Expected: the four new specs FAIL with `Cannot find module`. The old `suppliers.service.spec.ts` still passes.

- [ ] **Step 7: Implement the four classes**

`commands/create-supplier.command.ts`: the body of `SuppliersService.create`, verbatim, including its comment about the body-supplied point.

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Supplier } from '../supplier.entity';
import { SupplierKind } from '../supplier-kind.enum';
import { canonicalizePhone } from '../phone';
import { CreateSupplierDto } from '../dto/create-supplier.dto';
import { SupplierResponse, toSupplierResponse } from '../supplier.mapper';
import { assertPhoneFree, resolveWritePoint } from '../supplier-access';
import { AuditService } from '../../audit/audit.service';
import { CollectionPointsService } from '../../collection-points/collection-points.service';
import { assertTrimmedName } from '../../common/trimmed-name';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

@Injectable()
export class CreateSupplierCommand {
  constructor(
    @InjectRepository(Supplier)
    private readonly repo: Repository<Supplier>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly points: CollectionPointsService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateSupplierDto): Promise<SupplierResponse> {
    // … SuppliersService.create's body verbatim, with
    //   this.resolveWritePoint(…)          → resolveWritePoint(…)
    //   this.assertPhoneFree(pointId, phone) → assertPhoneFree(this.repo, pointId, phone)
  }
}
```

`commands/update-supplier.command.ts`: the body of `SuppliersService.update` verbatim, together with its long doc comment (TODO on deactivation, 403 vs 404, a rename reassigns a balance). `SUPPLIER_FIELDS` and `snapshot` move here as a module-level `const` and function. Constructor: `(@InjectRepository(Supplier) repo, dataSource: DataSource, audit: AuditService)`. Replace `this.assertPhoneFree(a, b, c)` with `assertPhoneFree(this.repo, a, b, c)` and `this.snapshot(x)` with `snapshot(x)`.

`queries/list-suppliers.query.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from '../supplier.entity';
import { ListSuppliersQueryDto } from '../dto/list-suppliers.query';
import { SupplierResponse, toSupplierResponse } from '../supplier.mapper';
import { applySupplierSearch } from '../supplier-search';
import { resolvePointFilter } from '../../auth/access/point-scope';
import { Paginated } from '../../common/dto/paginated';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/** The browsable directory: the pickers, the journal filter, the day screen. Totals
 *  per supplier are `GET /supplier-totals`'s job — a picker must not pay for them. */
@Injectable()
export class ListSuppliersQuery {
  constructor(@InjectRepository(Supplier) private readonly repo: Repository<Supplier>) {}

  async list(actor: AuthenticatedUser, query: ListSuppliersQueryDto): Promise<Paginated<SupplierResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);

    const qb = this.repo.createQueryBuilder('s');
    if (pointId) qb.andWhere('s.collection_point_id = :pointId', { pointId });
    if (!query.include_inactive) qb.andWhere('s.is_active = true');
    applySupplierSearch(qb, query.q);

    const [data, total] = await qb
      .orderBy('s.last_name', 'ASC')
      .addOrderBy('s.first_name', 'ASC')
      // Tiebreaker, not a third sort key anyone reads. §6.3 refuses name
      // uniqueness outright — two «Іван Коваль»s at one point are ordinary —
      // and §3.9 makes the tie STRUCTURAL for an owner reading network-wide,
      // since one person delivering to two points is two rows with identical
      // names. Postgres promises no order among tied rows, so without this
      // `skip`/`take` can return one twice across pages or drop it entirely.
      .addOrderBy('s.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    return { data: data.map(toSupplierResponse), total, page: query.page, limit: query.limit };
  }
}
```

`queries/find-supplier.query.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from '../supplier.entity';
import { SupplierResponse, toSupplierResponse } from '../supplier.mapper';
import { visibleTo } from '../supplier-access';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/**
 * 404 — NOT 403 — for a supplier at another point. `GET
 * /collection-points/:id` distinguishes the two, and the foundation
 * follow-ups flag that as a weak existence oracle «worth remembering before
 * this shape is copied onto a guessable id». This is the copy, and these
 * rows are real people's names and phone numbers.
 *
 * Exported: every module that takes a `supplier_id` (intakes, payouts, crates,
 * supplier-balance) validates it here rather than growing its own query.
 */
@Injectable()
export class FindSupplierQuery {
  constructor(@InjectRepository(Supplier) private readonly repo: Repository<Supplier>) {}

  async findOne(actor: AuthenticatedUser, id: string): Promise<SupplierResponse> {
    const supplier = await this.repo.findOne({ where: { id } });
    if (!supplier || !visibleTo(actor, supplier)) {
      throw new NotFoundException('Supplier not found');
    }
    return toSupplierResponse(supplier);
  }
}
```

- [ ] **Step 8: Rewire the controller and module, delete the service**

In `suppliers.controller.ts`, keep the class doc comment and swap the constructor and handlers:

```ts
constructor(
  private readonly listSuppliers: ListSuppliersQuery,
  private readonly findSupplier: FindSupplierQuery,
  private readonly createSupplier: CreateSupplierCommand,
  private readonly updateSupplier: UpdateSupplierCommand,
) {}
// list   → this.listSuppliers.list(actor, query)
// findOne→ this.findSupplier.findOne(actor, id)
// create → this.createSupplier.create(actor, dto)
// update → this.updateSupplier.update(actor, id, dto)
```

In `suppliers.module.ts`, set `providers: [ListSuppliersQuery, FindSupplierQuery, CreateSupplierCommand, UpdateSupplierCommand]` and `exports: [TypeOrmModule, FindSupplierQuery]`. In the module doc comment, replace the paragraph «`SuppliersService` is exported for …» with: «`FindSupplierQuery` is exported: every module that takes a `supplier_id` validates it through its owner rather than growing its own query.»

In each of the five consumers, replace `import { SuppliersService } from '…/suppliers/suppliers.service'` with `import { FindSupplierQuery } from '…/suppliers/queries/find-supplier.query'`. Change the constructor type `SuppliersService` → `FindSupplierQuery` and keep the property name `suppliers`, so every `this.suppliers.findOne(…)` call is unchanged. Update the doc-comment mentions of `SuppliersService.findOne` in `crate-balance.controller.ts`, `supplier-balance.controller.ts` and `supplier-balance.controller.spec.ts` to `FindSupplierQuery.findOne`.

Then run `git rm backend/src/suppliers/suppliers.service.ts backend/src/suppliers/suppliers.service.spec.ts`.

Comment mentions of `SuppliersService.list` / `.update` elsewhere: `grep -rn "SuppliersService" backend/src --exclude-dir=coverage`. Rewrite each to `ListSuppliersQuery.list` / `applySupplierSearch` (pipeline.db-spec's ESCAPE remark) / `UpdateSupplierCommand.update`, as appropriate.

In `backend/CLAUDE.md`, append to the `suppliers/` structure line: «— `commands/` (create, update), `queries/` (list, find — `FindSupplierQuery` is the export every `supplier_id` taker validates through), `supplier-search.ts` (the one `q` box, shared with `/supplier-totals`)».

- [ ] **Step 9: Run the backend unit suite and lint**

Run: `npm test -w backend && npm run lint -w backend`
Expected: PASS. Every case of the deleted `suppliers.service.spec.ts` now exists in exactly one new spec, either moved verbatim or, for the `q` cases, rewritten in `supplier-search.spec.ts`. `grep -rn "SuppliersService" backend/src --exclude-dir=coverage` prints nothing.

- [ ] **Step 10: Commit**

```bash
git add -A backend
git commit -m "refactor(suppliers): commands and queries, one shared search box (#230)

SuppliersService split per nest-module-conventions; behaviour unchanged —
the old spec's cases moved verbatim. FindSupplierQuery replaces the service
as the module's export.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `GET /supplier-totals`

**Files:**
- Create: `backend/src/supplier-balance/supplier-totals.sql.ts`
- Modify: `backend/src/supplier-balance/queries/supplier-balance-breakdown.query.ts` (reuse `kgTotalSql`)
- Create: `backend/src/supplier-balance/dto/list-supplier-totals.query.ts`, `.../list-supplier-totals.query.spec.ts`
- Modify: `backend/src/supplier-balance/supplier-balance.mapper.ts` (row type + mapper)
- Create: `backend/src/supplier-balance/queries/list-supplier-totals.query.ts`, `.../list-supplier-totals.query.spec.ts`
- Create: `backend/src/supplier-balance/supplier-totals.controller.ts`
- Modify: `backend/src/supplier-balance/supplier-balance.module.ts`
- Create: `backend/src/supplier-balance/supplier-totals.db-spec.ts`
- Modify: `backend/CLAUDE.md` (the `supplier-balance/` line)

**Interfaces:**
- Consumes: `applySupplierSearch` (Task 1), `debtTermsSql` (`supplier-debt.sql.ts`), `resolvePointFilter`, `skipOf`, `toSupplierResponse`.
- Produces: `GET /supplier-totals?q&collection_point_id&sort&order&page&limit` → `Paginated<SupplierTotalsRowResponse>` where `SupplierTotalsRowResponse = SupplierResponse & { kg_total: string; accrued: string; main_product_name: string | null }`.

- [ ] **Step 1: SQL fragments + breakdown reuse**

`supplier-totals.sql.ts`:

```ts
import { debtTermsSql } from './supplier-debt.sql';

/**
 * The supplier-totals fragments. `supplier` is a code literal (`$1` or a
 * correlated `s.id`), never request input — same contract as `debtSql`.
 *
 * NUMERIC, NOT TEXT: `/supplier-totals` ORDERS BY these, and a `::text` here
 * would rank «9.50» above «100.00». The card's breakdown casts at its own
 * projection instead.
 */

/** Σ net kg over live receipts — the card's `kg_total` tile and the list's column, one SQL. */
export const kgTotalSql = (supplier: string): string =>
  `COALESCE((SELECT SUM(ii.net_kg) FROM intake_items ii
               JOIN intakes i ON i.id = ii.intake_id
              WHERE i.supplier_id = ${supplier} AND i.voided_at IS NULL), 0.00)`;

/** «Нараховано» — the debt formula's first two terms, reused rather than restated. */
export const accruedSql = (supplier: string): string =>
  `(${debtTermsSql.intakes(supplier)} + ${debtTermsSql.topUps(supplier)})`;

/** The PRODUCT (grades summed) with the most live net kg; tie → name, then id. NULL with no receipts. */
export const mainProductSql = (supplier: string): string =>
  `(SELECT p.name FROM intake_items ii
      JOIN intakes i ON i.id = ii.intake_id
      JOIN product_grades g ON g.id = ii.product_grade_id
      JOIN products p ON p.id = g.product_id
     WHERE i.supplier_id = ${supplier} AND i.voided_at IS NULL
     GROUP BY p.id, p.name
     ORDER BY SUM(ii.net_kg) DESC, p.name ASC, p.id ASC
     LIMIT 1)`;
```

In `supplier-balance-breakdown.query.ts`, add `import { kgTotalSql } from '../supplier-totals.sql';` and replace the `kg_total` subquery (the three lines from `(SELECT COALESCE(SUM(ii.net_kg)::text` to `AS kg_total,`) with:

```ts
      ${kgTotalSql('$1')}::text AS kg_total,
```

Run: `npm test -w backend -- supplier-balance-breakdown`
Expected: PASS. The unit spec does not inspect the SQL text for `kg_total`. Task 2's db-spec and the existing `supplier-balance-breakdown.db-spec.ts` (`verify:full`) prove the output is unchanged.

- [ ] **Step 2: DTO spec (fails)**

`dto/list-supplier-totals.query.spec.ts`:

```ts
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListSupplierTotalsQueryDto } from './list-supplier-totals.query';

const parse = (q: Record<string, unknown>) => plainToInstance(ListSupplierTotalsQueryDto, q);
const errors = (q: Record<string, unknown>) => validateSync(parse(q));

describe('ListSupplierTotalsQueryDto', () => {
  it('defaults to sort=weight and leaves order to the query', () => {
    const dto = parse({});
    expect(dto.sort).toBe('weight');
    expect(dto.order).toBeUndefined();
    expect(errors({})).toHaveLength(0);
  });

  it('accepts every sort key and both directions', () => {
    for (const sort of ['weight', 'amount', 'name']) {
      for (const order of ['asc', 'desc']) expect(errors({ sort, order })).toHaveLength(0);
    }
  });

  it('refuses an unknown sort or order rather than silently falling back', () => {
    expect(errors({ sort: 'phone' })).not.toHaveLength(0);
    expect(errors({ order: 'up' })).not.toHaveLength(0);
  });
});
```

Run: `npm test -w backend -- list-supplier-totals.query.spec`
Expected: FAIL, module missing.

- [ ] **Step 3: DTO**

`dto/list-supplier-totals.query.ts`:

```ts
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const SUPPLIER_TOTALS_SORTS = ['weight', 'amount', 'name'] as const;
export type SupplierTotalsSort = (typeof SUPPLIER_TOTALS_SORTS)[number];
export type SortOrder = 'asc' | 'desc';

/**
 * §11.4's «топ здавальників». Active suppliers only — the page has no Стан
 * column to show an inactive one with. `order` has no DTO default because the
 * natural direction depends on the key (heaviest first, names A→Z); the query
 * resolves it. `collection_point_id` is IGNORED for an operator, as on
 * `/suppliers`.
 */
export class ListSupplierTotalsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  q?: string;

  @IsOptional()
  @IsIn(SUPPLIER_TOTALS_SORTS)
  sort: SupplierTotalsSort = 'weight';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: SortOrder;
}
```

Run: `npm test -w backend -- list-supplier-totals.query.spec`
Expected: the DTO spec passes. (The query spec of Step 4 has a different path: `queries/…`.)

- [ ] **Step 4: Query unit spec (fails)**

`queries/list-supplier-totals.query.spec.ts`:

```ts
import { ListSupplierTotalsQuery } from './list-supplier-totals.query';
import { UserRole } from '../../users/user-role.enum';
import { SupplierKind } from '../../suppliers/supplier-kind.enum';

const POINT_A = '11111111-1111-1111-1111-111111111111';
const POINT_B = '22222222-2222-2222-2222-222222222222';
const owner = { sub: 'u-owner', username: 'owner', role: UserRole.NetworkOwner, collection_point_id: null };
const operator = { sub: 'u-op', username: 'op', role: UserRole.PointOperator, collection_point_id: POINT_A };

describe('ListSupplierTotalsQuery', () => {
  const supplier = {
    id: 's-1',
    collection_point_id: POINT_A,
    first_name: 'Іван',
    last_name: 'Коваль',
    phone: null,
    note: null,
    kind: SupplierKind.Wholesale,
    is_active: true,
    created_at: new Date('2026-07-15T06:00:00.000Z'),
    updated_at: new Date('2026-07-15T06:00:00.000Z'),
  };
  let qb: Record<string, jest.Mock>;
  let query: ListSupplierTotalsQuery;

  beforeEach(() => {
    qb = {};
    for (const m of ['where', 'andWhere', 'addSelect', 'orderBy', 'addOrderBy', 'offset', 'limit']) {
      qb[m] = jest.fn().mockReturnValue(qb);
    }
    qb.getCount = jest.fn().mockResolvedValue(1);
    qb.getRawAndEntities = jest.fn().mockResolvedValue({
      entities: [supplier],
      raw: [{ kg_total: '950.00', accrued: '9650.00', main_product_name: 'Малина' }],
    });
    query = new ListSupplierTotalsQuery({ createQueryBuilder: () => qb } as never);
  });

  const list = (actor: typeof owner | typeof operator, over: Record<string, unknown> = {}) =>
    query.list(actor, { page: 1, limit: 100, sort: 'weight', ...over } as never);

  it('lists active suppliers only', async () => {
    await list(owner);
    expect(qb.where).toHaveBeenCalledWith('s.is_active = true');
  });

  it('pins an operator to their own point, ignoring the requested one', async () => {
    await list(operator, { collection_point_id: POINT_B });
    expect(qb.andWhere).toHaveBeenCalledWith('s.collection_point_id = :pointId', { pointId: POINT_A });
  });

  it('applies the shared search, and counts AFTER it so total matches the filtered list', async () => {
    await list(operator, { q: 'Ковал' });
    expect(qb.andWhere).toHaveBeenCalledWith(
      "(s.first_name ILIKE :q ESCAPE '\\' OR s.last_name ILIKE :q ESCAPE '\\')",
      { q: '%Ковал%' },
    );
    const searched = Math.max(...qb.andWhere.mock.invocationCallOrder);
    expect(qb.getCount.mock.invocationCallOrder[0]).toBeGreaterThan(searched);
    expect(qb.getCount.mock.invocationCallOrder[0]).toBeLessThan(qb.addSelect.mock.invocationCallOrder[0]);
  });

  it('defaults to heaviest first, with the name-then-id tail', async () => {
    await list(owner);
    expect(qb.orderBy).toHaveBeenCalledWith('kg_total', 'DESC');
    expect(qb.addOrderBy.mock.calls).toEqual([
      ['s.last_name', 'ASC'],
      ['s.first_name', 'ASC'],
      ['s.id', 'ASC'],
    ]);
  });

  it('sorts by accrued in the requested direction', async () => {
    await list(owner, { sort: 'amount', order: 'asc' });
    expect(qb.orderBy).toHaveBeenCalledWith('accrued', 'ASC');
  });

  it('sorts by name A→Z by default and Z→A on request, id last either way', async () => {
    await list(owner, { sort: 'name' });
    expect(qb.orderBy).toHaveBeenCalledWith('s.last_name', 'ASC');
    expect(qb.addOrderBy.mock.calls).toEqual([['s.first_name', 'ASC'], ['s.id', 'ASC']]);

    qb.orderBy.mockClear();
    qb.addOrderBy.mockClear();
    await list(owner, { sort: 'name', order: 'desc' });
    expect(qb.orderBy).toHaveBeenCalledWith('s.last_name', 'DESC');
    expect(qb.addOrderBy.mock.calls).toEqual([['s.first_name', 'DESC'], ['s.id', 'ASC']]);
  });

  it('pages with offset/limit and returns the supplier plus its three totals', async () => {
    const page = await list(owner, { page: 3, limit: 100 });
    expect(qb.offset).toHaveBeenCalledWith(200);
    expect(qb.limit).toHaveBeenCalledWith(100);
    expect(page).toEqual({
      data: [
        expect.objectContaining({
          id: 's-1',
          kind: SupplierKind.Wholesale,
          created_at: '2026-07-15T06:00:00.000Z',
          kg_total: '950.00',
          accrued: '9650.00',
          main_product_name: 'Малина',
        }),
      ],
      total: 1,
      page: 3,
      limit: 100,
    });
  });
});
```

Run: `npm test -w backend -- queries/list-supplier-totals`
Expected: FAIL, module missing.

- [ ] **Step 5: Mapper, query, controller, module**

Append to `supplier-balance.mapper.ts` (merge the imports with the existing ones):

```ts
import type { Supplier } from '../suppliers/supplier.entity';
import { SupplierResponse, toSupplierResponse } from '../suppliers/supplier.mapper';

/** The three aggregates `/supplier-totals` adds to a supplier — numeric strings, never parsed. */
export interface SupplierTotals {
  kg_total: string;
  accrued: string;
  main_product_name: string | null;
}

export type SupplierTotalsRowResponse = SupplierResponse & SupplierTotals;

export function toSupplierTotalsRowResponse(
  supplier: Supplier,
  totals: SupplierTotals,
): SupplierTotalsRowResponse {
  return {
    ...toSupplierResponse(supplier),
    kg_total: totals.kg_total,
    accrued: totals.accrued,
    main_product_name: totals.main_product_name,
  };
}
```

`queries/list-supplier-totals.query.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from '../../suppliers/supplier.entity';
import { applySupplierSearch } from '../../suppliers/supplier-search';
import {
  ListSupplierTotalsQueryDto,
  SortOrder,
  SupplierTotalsSort,
} from '../dto/list-supplier-totals.query';
import {
  SupplierTotals,
  SupplierTotalsRowResponse,
  toSupplierTotalsRowResponse,
} from '../supplier-balance.mapper';
import { accruedSql, kgTotalSql, mainProductSql } from '../supplier-totals.sql';
import { resolvePointFilter } from '../../auth/access/point-scope';
import { Paginated } from '../../common/dto/paginated';
import { skipOf } from '../../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

const DEFAULT_ORDER: Record<SupplierTotalsSort, SortOrder> = { weight: 'desc', amount: 'desc', name: 'asc' };
const AGGREGATE: Record<Exclude<SupplierTotalsSort, 'name'>, string> = { weight: 'kg_total', amount: 'accrued' };

/**
 * §11.4's «топ здавальників»: every active supplier in scope with all-time
 * weight, accrued and main product, ranked and paged in Postgres. Each total is
 * a correlated subquery on an indexed `supplier_id`; ranking by one evaluates
 * it for every supplier in scope — hundreds, not a concern.
 *
 * Counted BEFORE the aggregates are selected, on the same builder, so the page
 * and `total` share scope and search by construction. The tail
 * (names, then id) keeps paging stable: same-named people at two points are
 * ordinary (§3.9).
 */
@Injectable()
export class ListSupplierTotalsQuery {
  constructor(@InjectRepository(Supplier) private readonly repo: Repository<Supplier>) {}

  async list(
    actor: AuthenticatedUser,
    query: ListSupplierTotalsQueryDto,
  ): Promise<Paginated<SupplierTotalsRowResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);
    const qb = this.repo.createQueryBuilder('s').where('s.is_active = true');
    if (pointId) qb.andWhere('s.collection_point_id = :pointId', { pointId });
    applySupplierSearch(qb, query.q);

    const total = await qb.getCount();

    const sort = query.sort ?? 'weight';
    const dir = (query.order ?? DEFAULT_ORDER[sort]) === 'asc' ? 'ASC' : 'DESC';
    qb.addSelect(kgTotalSql('s.id'), 'kg_total')
      .addSelect(accruedSql('s.id'), 'accrued')
      .addSelect(mainProductSql('s.id'), 'main_product_name');
    if (sort === 'name') {
      qb.orderBy('s.last_name', dir).addOrderBy('s.first_name', dir);
    } else {
      qb.orderBy(AGGREGATE[sort], dir).addOrderBy('s.last_name', 'ASC').addOrderBy('s.first_name', 'ASC');
    }
    qb.addOrderBy('s.id', 'ASC').offset(skipOf(query)).limit(query.limit);

    // No joins, so raw rows and entities are one-to-one and in the same order.
    const { entities, raw } = await qb.getRawAndEntities<SupplierTotals>();
    return {
      data: entities.map((s, i) => toSupplierTotalsRowResponse(s, raw[i])),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
}
```

`supplier-totals.controller.ts`:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ListSupplierTotalsQuery } from './queries/list-supplier-totals.query';
import { ListSupplierTotalsQueryDto } from './dto/list-supplier-totals.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/** The suppliers page (#230): each supplier with weight, accrued and main product. Both roles;
 *  scope is `resolvePointFilter`'s, inside the query. Own prefix, so no route-order caveat. */
@Controller('supplier-totals')
export class SupplierTotalsController {
  constructor(private readonly totals: ListSupplierTotalsQuery) {}

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListSupplierTotalsQueryDto) {
    return this.totals.list(actor, query);
  }
}
```

In `supplier-balance.module.ts`, add `ListSupplierTotalsQuery` to `providers` and `SupplierTotalsController` to `controllers`. Add one sentence to the module doc: «Also serves `/supplier-totals` (#230), which reuses the debt terms for «нараховано».» `Repository<Supplier>` resolves because `SuppliersModule` exports `TypeOrmModule`.

Run: `npm test -w backend -- supplier-balance && npm run lint -w backend`
Expected: PASS.

- [ ] **Step 6: db-spec against a real Postgres**

`supplier-totals.db-spec.ts`, modelled on `supplier-balance-list.db-spec.ts`: service-level, per-run uuid on every name.

```ts
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { ListSupplierTotalsQuery } from './queries/list-supplier-totals.query';
import { SupplierBalanceBreakdownQuery } from './queries/supplier-balance-breakdown.query';
import { ListSupplierTotalsQueryDto } from './dto/list-supplier-totals.query';
import { Supplier } from '../suppliers/supplier.entity';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * `/supplier-totals`'s SQL against a real Postgres — the unit spec can only
 * assert the builder calls. Point A, products Малина (two grades) and Полуниця:
 *
 *   Іван    R1 live: Малина-1 300 + Малина-2 250 kg, 5500.00, live top-up 150
 *           R2 live: Полуниця 400 kg, 4000.00, VOIDED top-up 70
 *           R3 VOIDED: Полуниця 1000 kg, 99999.00, live top-up 999
 *             → 950.00 kg · 9650.00 · Малина (by product, not grade)
 *   Ольга   Малина-1 100 kg, 3000.00          → 100.00 · 3000.00 · Малина
 *   Марія   Полуниця 30 + Малина-1 30 kg, 600  → 60.00 · 600.00 · Малина (tie → name)
 *   Андрій  Полуниця 9.50 kg, 95.00            → 9.50 — sorts BELOW 100 (numeric, not text)
 *   Петро   nothing                            → 0.00 · 0.00 · null
 *   Степан  INACTIVE, 10 kg                    → absent
 *   Ольга²  second «Ольга Ярема» at A, nothing → same name, told apart by id
 * Point B: Богдан 500 kg — an operator at A never sees him.
 */
describe('ListSupplierTotalsQuery.list (Postgres)', () => {
  let ds: DataSource;
  let service: ListSupplierTotalsQuery;
  let breakdown: SupplierBalanceBreakdownQuery;
  let run: string;
  let pointA: string;
  let pointB: string;
  let userId: string;
  let shiftA: string;
  let ivanId: string;
  let raspberry1: string;
  let raspberry2: string;
  let strawberry: string;
  let operatorAtA: AuthenticatedUser;
  const owner: AuthenticatedUser = {
    sub: 'u-owner',
    username: 'owner',
    role: UserRole.NetworkOwner,
    collection_point_id: null,
  };
  const q = (over: Partial<ListSupplierTotalsQueryDto> = {}): ListSupplierTotalsQueryDto =>
    ({ page: 1, limit: 100, sort: 'weight', collection_point_id: pointA, ...over }) as ListSupplierTotalsQueryDto;

  let seq = 0;
  const insertSupplier = async (point: string, first: string, last: string, active = true) => {
    const [row] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [point, first, `${last}-${run}`, active],
    );
    return row.id as string;
  };
  /** One receipt with its lines; `lines` is [grade, net kg]. Amount is given, not derived — the SQL under test only sums it. */
  const insertIntake = async (
    shift: string,
    supplier: string,
    amount: string,
    lines: [string, string][],
    voided = false,
  ): Promise<string> => {
    const [intake] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id,
                            voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, $3, $4, $5,
               CASE WHEN $6 THEN now() END, CASE WHEN $6 THEN $5::uuid END,
               CASE WHEN $6 THEN 'test' END) RETURNING id`,
      [`IN-${run}-${++seq}`, shift, supplier, amount, userId, voided],
    );
    for (const [i, [grade, kg]] of lines.entries()) {
      await ds.query(
        `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
             gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
         VALUES ($1, $2, $3, $4, '0.00', '0.00', $4, '0.00', '0.00', '0.00')`,
        [intake.id, i + 1, grade, kg],
      );
    }
    return intake.id as string;
  };
  const insertTopUp = async (intake: string, amount: string, voided = false) => {
    await ds.query(
      `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id,
                                   voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, 'test', $3,
               CASE WHEN $4 THEN now() END, CASE WHEN $4 THEN $3::uuid END,
               CASE WHEN $4 THEN 'test' END)`,
      [intake, amount, userId, voided],
    );
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new ListSupplierTotalsQuery(ds.getRepository(Supplier));
    breakdown = new SupplierBalanceBreakdownQuery(ds);
    run = randomUUID();
    const short = run.slice(0, 4).toUpperCase();

    const [a] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Підсумки А-${run}`, `A${short}`],
    );
    const [b] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Підсумки Б-${run}`, `B${short}`],
    );
    pointA = a.id;
    pointB = b.id;
    operatorAtA = { sub: 'u-op', username: 'op', role: UserRole.PointOperator, collection_point_id: pointA };

    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role) VALUES ('Оксана', 'Тест', 'network_owner') RETURNING id`,
    );
    userId = user.id;
    const [sa] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
       VALUES ($1, $2, '2026-09-08') RETURNING id`,
      [pointA, userId],
    );
    const [sb] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
       VALUES ($1, $2, '2026-09-08') RETURNING id`,
      [pointB, userId],
    );
    shiftA = sa.id;

    const [rasp] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [`Малина ${run}`]);
    const [straw] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [`Полуниця ${run}`]);
    const grade = async (product: string, name: string) =>
      (
        await ds.query(`INSERT INTO product_grades (product_id, name) VALUES ($1, $2) RETURNING id`, [
          product,
          name,
        ])
      )[0].id as string;
    raspberry1 = await grade(rasp.id, 'Перший');
    raspberry2 = await grade(rasp.id, 'Другий');
    strawberry = await grade(straw.id, 'Стандарт');

    ivanId = await insertSupplier(pointA, 'Іван', 'Коваль');
    const r1 = await insertIntake(shiftA, ivanId, '5500.00', [[raspberry1, '300.00'], [raspberry2, '250.00']]);
    await insertTopUp(r1, '150.00');
    const r2 = await insertIntake(shiftA, ivanId, '4000.00', [[strawberry, '400.00']]);
    await insertTopUp(r2, '70.00', true);
    const r3 = await insertIntake(shiftA, ivanId, '99999.00', [[strawberry, '1000.00']], true);
    await insertTopUp(r3, '999.00');

    const olha = await insertSupplier(pointA, 'Ольга', 'Ярема');
    await insertIntake(shiftA, olha, '3000.00', [[raspberry1, '100.00']]);
    const maria = await insertSupplier(pointA, 'Марія', 'Бондар');
    await insertIntake(shiftA, maria, '600.00', [[strawberry, '30.00'], [raspberry1, '30.00']]);
    const andriy = await insertSupplier(pointA, 'Андрій', 'Шевчук');
    await insertIntake(shiftA, andriy, '95.00', [[strawberry, '9.50']]);
    await insertSupplier(pointA, 'Петро', 'Мельник');
    await insertSupplier(pointA, 'Ольга', 'Ярема');
    const stepan = await insertSupplier(pointA, 'Степан', 'Гнатюк', false);
    await insertIntake(shiftA, stepan, '100.00', [[strawberry, '10.00']]);

    const bohdan = await insertSupplier(pointB, 'Богдан', 'Сусід');
    await insertIntake(sb.id, bohdan, '5000.00', [[strawberry, '500.00']]);
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const row = (page: { data: { id: string }[] }, id: string) => page.data.find((r) => r.id === id);
  const names = (page: { data: { first_name: string }[] }) => page.data.map((r) => r.first_name);

  it('sums live weight, accrues receipts plus live top-ups on live receipts, and names the main PRODUCT', async () => {
    const page = await service.list(owner, q());
    expect(row(page, ivanId)).toMatchObject({
      kg_total: '950.00',
      accrued: '9650.00',
      main_product_name: `Малина ${run}`,
    });
  });

  it('breaks a main-product tie by name', async () => {
    const page = await service.list(owner, q());
    expect(page.data.find((r) => r.first_name === 'Марія')?.main_product_name).toBe(`Малина ${run}`);
  });

  it('reads 0.00 / 0.00 / null for a supplier with no receipts', async () => {
    const page = await service.list(owner, q());
    expect(page.data.find((r) => r.first_name === 'Петро')).toMatchObject({
      kg_total: '0.00',
      accrued: '0.00',
      main_product_name: null,
    });
  });

  it('orders weight numerically, heaviest first — 9.50 below 100.00 — and leaves inactive suppliers out', async () => {
    const page = await service.list(owner, q());
    expect(names(page)).toEqual(['Іван', 'Ольга', 'Марія', 'Андрій', 'Петро', 'Ольга']);
    expect(page.total).toBe(6);
  });

  it('orders by accrued ascending on request', async () => {
    const page = await service.list(owner, q({ sort: 'amount', order: 'asc' }));
    expect(names(page).slice(0, 4)).toEqual(['Петро', 'Ольга', 'Андрій', 'Марія']);
  });

  it('narrows page AND total by q while keeping the sort', async () => {
    const page = await service.list(owner, q({ q: 'Ярема' }));
    expect(page.total).toBe(2);
    expect(page.data.map((r) => r.kg_total)).toEqual(['100.00', '0.00']);
  });

  it('walks pages of 2 with no row repeated or dropped, same-named people included', async () => {
    const all = await service.list(owner, q());
    const walked: string[] = [];
    for (let p = 1; p <= 3; p++) {
      walked.push(...(await service.list(owner, q({ page: p, limit: 2 }))).data.map((r) => r.id));
    }
    expect(walked).toEqual(all.data.map((r) => r.id));
  });

  it('keeps an operator to their own point', async () => {
    const page = await service.list(operatorAtA, q({ collection_point_id: pointB }));
    expect(names(page)).not.toContain('Богдан');
    expect(page.total).toBe(6);
  });

  it('agrees with the supplier card on kg_total', async () => {
    const page = await service.list(owner, q());
    const card = await breakdown.breakdownFor(ivanId);
    expect(row(page, ivanId)?.kg_total).toBe(card.kg_total);
  });
});
```

Where the two expected orders come from:
- **Weight ↓:** 950, 100, 60, 9.50, then the two zeros.
- **Accrued ↑:** the two zeros first, then 95 (Андрій), then 600 (Марія).

The two zero rows are Петро and the second Ольга. They tie, so the tail sorts them by `last_name ASC`: «Мельник-…» comes before «Ярема-…», which puts Петро first.

Run: `npm run test:db -w backend -- supplier-totals`
Expected: PASS, 9 tests. Also run `npm run test:db -w backend -- supplier-balance-breakdown` to prove the card's `kg_total` is unchanged.

- [ ] **Step 7: Docs and commit**

In `backend/CLAUDE.md`, in the `supplier-balance/` line, after the `SupplierBalanceBreakdownQuery` sentence, add: «`ListSupplierTotalsQuery` serves `GET /supplier-totals` (#230, the suppliers page): every active supplier in scope with all-time `kg_total`, `accrued` (`debtTermsSql.intakes + topUps`) and `main_product_name` (by product, tie → name), sorted `weight|amount|name` and paged in Postgres; the fragments live in `supplier-totals.sql.ts`, and `kgTotalSql` is the card's `kg_total` too.»

```bash
git add backend/src/supplier-balance backend/CLAUDE.md
git commit -m "feat(supplier-balance): GET /supplier-totals — weight, accrued, main product (#230)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `DataTable` opt-in sortable headers

**Files:**
- Modify: `frontend/src/shared/ui/data-table.tsx`, `frontend/src/shared/ui/data-table.test.tsx`
- Modify: `frontend/src/shared/ui/templates/list-page.tsx`, `frontend/src/shared/ui/templates/list-page.test.tsx`

**Interfaces:**
- Produces: `Column<Row>.sortable?: boolean`; `type SortState = { key: string; order: 'asc' | 'desc' }` (exported from `@/shared/ui/data-table`); `DataTable` / `ListPage` props `sort?: SortState`, `onSortChange?: (key: string) => void`.

- [ ] **Step 1: Failing tests**

Append to `data-table.test.tsx`:

```tsx
const sortable: Column<Row>[] = [
  { id: 'name', header: 'Назва', sortable: true, cell: (r) => r.name },
  { id: 'qty', header: 'К-сть', sortable: true, align: 'right', cell: (r) => r.qty },
  { id: 'note', header: 'Примітка', cell: () => '' },
];

it('renders plain headers when no sort is given, even for sortable columns', () => {
  render(<DataTable columns={sortable} rows={rows} rowKey={(r) => r.id} />);
  expect(screen.queryByRole('button', { name: 'Назва' })).toBeNull();
  expect(screen.getByRole('columnheader', { name: 'Назва' })).not.toHaveAttribute('aria-sort');
});

it('makes sortable headers buttons, marks the active one, and reports the clicked key', async () => {
  const onSortChange = vi.fn();
  render(
    <DataTable
      columns={sortable}
      rows={rows}
      rowKey={(r) => r.id}
      sort={{ key: 'qty', order: 'desc' }}
      onSortChange={onSortChange}
    />,
  );
  expect(screen.getByRole('columnheader', { name: 'К-сть' })).toHaveAttribute('aria-sort', 'descending');
  expect(screen.getByRole('columnheader', { name: 'Назва' })).toHaveAttribute('aria-sort', 'none');
  expect(screen.getByRole('columnheader', { name: 'Примітка' })).not.toHaveAttribute('aria-sort');
  expect(screen.queryByRole('button', { name: 'Примітка' })).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: 'Назва' }));
  expect(onSortChange).toHaveBeenCalledWith('name');
});

it('marks an ascending sort and stays axe-clean', async () => {
  const { container } = render(
    <DataTable
      columns={sortable}
      rows={rows}
      rowKey={(r) => r.id}
      sort={{ key: 'name', order: 'asc' }}
      onSortChange={() => {}}
    />,
  );
  expect(screen.getByRole('columnheader', { name: 'Назва' })).toHaveAttribute('aria-sort', 'ascending');
  await expectNoAxeViolations(container);
});
```

Append to `list-page.test.tsx`. If the file does not already import them, add `vi` from `vitest` and `userEvent` from `@testing-library/user-event`:

```tsx
it('forwards sort and onSortChange to the table', async () => {
  const onSortChange = vi.fn();
  render(
    <ListPage<{ id: string; name: string }>
      title="T"
      columns={[{ id: 'name', header: 'Name', sortable: true, cell: (r) => r.name }]}
      rows={[{ id: '1', name: 'A' }]}
      rowKey={(r) => r.id}
      sort={{ key: 'name', order: 'asc' }}
      onSortChange={onSortChange}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Name' }));
  expect(onSortChange).toHaveBeenCalledWith('name');
});
```

Run: `npm test -w frontend -- data-table list-page`
Expected: the new cases FAIL (no button, no `aria-sort`). TypeScript errors on `sortable` and `sort` do not fail Vitest, but they appear in `tsc -b`.

- [ ] **Step 2: Implement**

`data-table.tsx`: add the `ArrowDown` / `ArrowUp` import, extend `Column` and the props, and render the header:

```tsx
import { ArrowDown, ArrowUp } from 'lucide-react';

export interface Column<Row> {
  // …existing fields…
  /** Clickable when the table is given `sort` + `onSortChange`; inert otherwise. */
  sortable?: boolean;
}

/** Which column the rows are ordered by. The table renders it; the page decides it. */
export interface SortState {
  key: string;
  order: 'asc' | 'desc';
}
```

Props: add `sort?: SortState;` and `onSortChange?: (key: string) => void;` with the doc «Opt-in. The table reports which header was clicked; direction rules belong to the caller.». Replace the header cell:

```tsx
{columns.map((c) => {
  const sortableHere = c.sortable && sort && onSortChange;
  const active = sortableHere && sort.key === c.id;
  const ariaSort = !sortableHere
    ? undefined
    : active
      ? sort.order === 'asc'
        ? 'ascending'
        : 'descending'
      : 'none';
  const Arrow = active && sort.order === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead key={c.id} className={colClass(c)} aria-sort={ariaSort}>
      {sortableHere ? (
        <button
          type="button"
          onClick={() => onSortChange(c.id)}
          className={cn(
            'inline-flex items-center gap-1 hover:text-foreground',
            c.align === 'right' && 'flex-row-reverse',
            active ? 'text-foreground' : undefined,
          )}
        >
          {c.header}
          <Arrow aria-hidden className={cn('size-3.5', !active && 'invisible')} />
        </button>
      ) : (
        c.header
      )}
    </TableHead>
  );
})}
```

The arrow is `invisible`, not absent, on inactive columns, so the header does not shift width when the sort moves.

`list-page.tsx`: add `sort?: SortState;` and `onSortChange?: (key: string) => void;` to `ListPageProps` (import `type SortState` from `@/shared/ui/data-table`), destructure them, and pass `sort={sort} onSortChange={onSortChange}` to `<DataTable>`.

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w frontend -- data-table list-page && (cd frontend && npx tsc -b)`
Expected: PASS. No type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/shared/ui/data-table.tsx frontend/src/shared/ui/data-table.test.tsx frontend/src/shared/ui/templates/list-page.tsx frontend/src/shared/ui/templates/list-page.test.tsx
git commit -m "feat(data-table): opt-in sortable headers with aria-sort (#230)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The suppliers page — totals, sort in the URL, «показати ще»

**Files:**
- Modify: `frontend/src/entities/supplier/model/supplier.ts`, `frontend/src/entities/supplier/index.ts`
- Create: `frontend/src/entities/supplier/api/useSupplierTotals.ts`, `.../useSupplierTotals.test.tsx`
- Modify: `frontend/src/features/edit-supplier/api/suppliers.ts`
- Create: `frontend/src/pages/suppliers/model/supplierSort.ts`, `.../supplierSort.test.ts`
- Modify: `frontend/src/pages/suppliers/ui/SuppliersPage.tsx`, `.../SuppliersPage.test.tsx`
- Modify: `frontend/src/shared/lib/i18n/locales/uk.json`, `.../en.json`
- Modify: `frontend/CLAUDE.md` (the `entities/supplier/` line)

**Interfaces:**
- Consumes: `GET /supplier-totals` (Task 2), `SortState` / `sortable` / `ListPage.sort` (Task 3), `useUrlParam` (`@/shared/lib/url-state`).
- Produces: `type SupplierTotalsRow = Supplier & { kg_total: string; accrued: string; main_product_name: string | null }`; `type SupplierTotalsSort = 'weight' | 'amount' | 'name'`; `useSupplierTotalsInfiniteQuery({ search, sort, order })`; `nextTotalsPage(last: Paginated<unknown>): number | undefined`; `readSort(sort: string | null, order: string | null): SortState`; `nextSort(current: SortState, key: string): SortState`; `toUrl(s: SortState): { sort: string | null; order: string | null }`.

- [ ] **Step 1: Types and hook test (fails)**

In `model/supplier.ts`, add after `Supplier`:

```ts
/** One row of `GET /supplier-totals` (#230): the supplier plus all-time totals — numeric strings, formatted, never summed. */
export type SupplierTotalsRow = Supplier & {
  kg_total: string;
  accrued: string;
  main_product_name: string | null;
};

export type SupplierTotalsSort = 'weight' | 'amount' | 'name';
```

Add `SupplierTotalsRow` and `SupplierTotalsSort` to the type export in `index.ts`, and `export { useSupplierTotalsInfiniteQuery } from './api/useSupplierTotals';`.

`api/useSupplierTotals.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { nextTotalsPage, useSupplierTotalsInfiniteQuery } from './useSupplierTotals';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('@/shared/api', () => ({ httpClient: { get: getMock } }));

const page = (n: number, total: number) => ({ data: [], total, page: n, limit: 100 });

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('nextTotalsPage', () => {
  it('asks for the next page while rows remain, and stops on the last', () => {
    expect(nextTotalsPage(page(1, 193))).toBe(2);
    expect(nextTotalsPage(page(2, 193))).toBeUndefined();
    expect(nextTotalsPage(page(1, 100))).toBeUndefined();
    expect(nextTotalsPage(page(1, 0))).toBeUndefined();
  });
});

describe('useSupplierTotalsInfiniteQuery', () => {
  beforeEach(() => getMock.mockReset().mockResolvedValue({ data: page(1, 1) }));

  it('starts at page 1 with the sort, order and trimmed search in the request', async () => {
    renderHook(() => useSupplierTotalsInfiniteQuery({ search: ' Ков ', sort: 'amount', order: 'asc' }), { wrapper });
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    expect(getMock).toHaveBeenCalledWith('/supplier-totals', {
      params: { q: 'Ков', sort: 'amount', order: 'asc', page: 1, limit: 100 },
    });
  });

  it('a new sort is a new list from page 1, not page 2 appended to the old order', async () => {
    const { rerender } = renderHook(
      ({ sort }: { sort: 'weight' | 'amount' }) =>
        useSupplierTotalsInfiniteQuery({ search: '', sort, order: 'desc' }),
      { wrapper, initialProps: { sort: 'weight' } },
    );
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    rerender({ sort: 'amount' });
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    expect(getMock.mock.calls[1][1].params).toMatchObject({ sort: 'amount', page: 1 });
  });
});
```

Run: `npm test -w frontend -- useSupplierTotals`
Expected: FAIL, module missing.

- [ ] **Step 2: Hook**

`api/useSupplierTotals.ts`:

```ts
import { useInfiniteQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { Paginated, SupplierTotalsRow, SupplierTotalsSort } from '../model/supplier';

const PAGE_SIZE = 100;

/** The next page number while the server still has rows beyond the last page fetched. */
export function nextTotalsPage(last: Paginated<unknown>): number | undefined {
  return last.page * last.limit < last.total ? last.page + 1 : undefined;
}

/**
 * The suppliers page (#230): `GET /supplier-totals`, 100 at a time, «показати ще».
 * UNDER THE `supplierBalances` PREFIX on purpose — every receipt, payout and
 * top-up write (and its void) already invalidates it, so a new receipt moves
 * the weight here with no new invalidation. Sort and search are in the key, so
 * changing either starts a fresh list at page 1.
 */
export function useSupplierTotalsInfiniteQuery(filter: {
  search: string;
  sort: SupplierTotalsSort;
  order: 'asc' | 'desc';
}) {
  const q = filter.search.trim();
  const { sort, order } = filter;
  return useInfiniteQuery({
    queryKey: [...queryKeys.supplierBalances, 'totals', { q, sort, order }],
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<Paginated<SupplierTotalsRow>> =>
      (
        await httpClient.get<Paginated<SupplierTotalsRow>>('/supplier-totals', {
          params: { ...(q ? { q } : {}), sort, order, page: pageParam, limit: PAGE_SIZE },
        })
      ).data,
    getNextPageParam: nextTotalsPage,
    staleTime: STALE.list,
  });
}
```

In `features/edit-supplier/api/suppliers.ts`, make both `onSuccess` handlers invalidate the totals too: a rename or a kind change must reach the list.

```ts
onSuccess: () =>
  Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.suppliers }),
    qc.invalidateQueries({ queryKey: queryKeys.supplierBalances }),
  ]),
```

Run: `npm test -w frontend -- useSupplierTotals edit-supplier`
Expected: PASS.

- [ ] **Step 3: Sort model test (fails)**

`pages/suppliers/model/supplierSort.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_SORT, nextSort, readSort, toUrl } from './supplierSort';

describe('supplier sort', () => {
  it('defaults to heaviest first', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'weight', order: 'desc' });
    expect(readSort(null, null)).toEqual(DEFAULT_SORT);
  });

  it('reads a valid URL pair, and a missing order as the key’s own default', () => {
    expect(readSort('amount', 'asc')).toEqual({ key: 'amount', order: 'asc' });
    expect(readSort('name', null)).toEqual({ key: 'name', order: 'asc' });
  });

  it('falls back to the default on a junk URL instead of sending it to the server', () => {
    expect(readSort('phone', 'asc')).toEqual(DEFAULT_SORT);
    expect(readSort('amount', 'sideways')).toEqual({ key: 'amount', order: 'desc' });
  });

  it('flips the active column, and opens another in its own direction', () => {
    expect(nextSort({ key: 'weight', order: 'desc' }, 'weight')).toEqual({ key: 'weight', order: 'asc' });
    expect(nextSort({ key: 'weight', order: 'desc' }, 'name')).toEqual({ key: 'name', order: 'asc' });
    expect(nextSort({ key: 'name', order: 'asc' }, 'amount')).toEqual({ key: 'amount', order: 'desc' });
  });

  it('writes nothing to the URL for the default, so a clean URL means it', () => {
    expect(toUrl(DEFAULT_SORT)).toEqual({ sort: null, order: null });
    expect(toUrl({ key: 'weight', order: 'asc' })).toEqual({ sort: 'weight', order: 'asc' });
    expect(toUrl({ key: 'name', order: 'asc' })).toEqual({ sort: 'name', order: 'asc' });
  });
});
```

Run: `npm test -w frontend -- supplierSort`
Expected: FAIL.

- [ ] **Step 4: Sort model**

`pages/suppliers/model/supplierSort.ts`:

```ts
import type { SupplierTotalsSort } from '@/entities/supplier';

export interface SupplierSort {
  key: SupplierTotalsSort;
  order: 'asc' | 'desc';
}

const KEYS: readonly SupplierTotalsSort[] = ['weight', 'amount', 'name'];
/** Where a column starts when first clicked: the biggest numbers on top, names A→Z. */
const FIRST_ORDER: Record<SupplierTotalsSort, 'asc' | 'desc'> = { weight: 'desc', amount: 'desc', name: 'asc' };

export const DEFAULT_SORT: SupplierSort = { key: 'weight', order: 'desc' };

/** The URL pair → a sort. Anything unrecognised reads as the default, never a 400. */
export function readSort(sort: string | null, order: string | null): SupplierSort {
  const key = KEYS.find((k) => k === sort) ?? DEFAULT_SORT.key;
  const dir = order === 'asc' || order === 'desc' ? order : FIRST_ORDER[key];
  return { key, order: dir };
}

/** Same column flips; another column opens in its own first direction. */
export function nextSort(current: SupplierSort, clicked: string): SupplierSort {
  const key = KEYS.find((k) => k === clicked) ?? current.key;
  if (key === current.key) return { key, order: current.order === 'asc' ? 'desc' : 'asc' };
  return { key, order: FIRST_ORDER[key] };
}

/** The default writes nulls, so `/suppliers` with no query string IS the default. */
export function toUrl(s: SupplierSort): { sort: string | null; order: string | null } {
  if (s.key === DEFAULT_SORT.key && s.order === DEFAULT_SORT.order) return { sort: null, order: null };
  return { sort: s.key, order: s.order };
}
```

Run: `npm test -w frontend -- supplierSort`
Expected: PASS.

- [ ] **Step 5: i18n**

In `uk.json` → `suppliers`:
- set `description` to «Хто скільки здав за весь час — вага, основний товар і нараховане.»;
- add `col.weight` «Загальна вага», `col.mainProduct` «Основний товар», `col.accrued` «Нараховано»;
- add `shownOf` «Показано {{shown}} з {{total}}» and `showMore` «Показати ще»;
- delete `col.phone`, `col.point`, `col.status`, `active`, `inactive`. Their only consumer is `SuppliersPage.tsx`, checked with `grep -rn "suppliers\.\(active\|inactive\|col\.phone\|col\.point\|col\.status\)" frontend/src`. `suppliers.form.active` and `suppliers.form.phone` are different keys and stay.

Mirror this in `en.json`:
- `description` «Who delivered how much, all time — weight, main product and accrued.»;
- `col.weight` «Total weight», `col.mainProduct` «Main product», `col.accrued` «Accrued»;
- `shownOf` «Showing {{shown}} of {{total}}», `showMore` «Show more».

- [ ] **Step 6: Page tests (fail)**

In `SuppliersPage.test.tsx`:
- Change the entity mock to `useSupplierTotalsInfiniteQuery: (args: unknown) => queryMock(args)`.
- Delete the `@/entities/collection-point` mock.
- Give `ivan` and `petro` the totals. Type both as `SupplierTotalsRow`. Make `petro` active and give it `kg_total: '0.00', accrued: '0.00', main_product_name: null`. Give `ivan` `kg_total: '3603.99', accrued: '466180.00', main_product_name: 'Raspberry'`.
- Rewrite `loaded` and add a two-page helper:

```ts
const infinite = (pages: { rows: SupplierTotalsRow[]; total: number }[], over: Record<string, unknown> = {}) => ({
  data: { pages: pages.map((p, i) => ({ data: p.rows, total: p.total, page: i + 1, limit: 100 })), pageParams: [] },
  isPending: false,
  isError: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
  ...over,
});
const loaded = (rows: SupplierTotalsRow[]) => infinite([{ rows, total: rows.length }]);
```

- Let `renderSuppliers(initial = '/suppliers')` take the initial entry, and return the `router` alongside the render result, so a test can read `router.state.location.search`.
- Replace `'renders suppliers and the New action when loaded'` with:

```tsx
it('renders weight, main product, kind and accrued — and no phone, point or status', async () => {
  queryMock.mockReturnValue(loaded([ivan, petro]));
  const { container } = renderSuppliers();
  expect(screen.getByRole('heading', { level: 1, name: 'Suppliers' })).toBeInTheDocument();
  const ivanRow = screen.getByText('Ivan Koval').closest('tr') as HTMLElement;
  expect(within(ivanRow).getByText('3,603.99 kg')).toBeInTheDocument();
  expect(within(ivanRow).getByText('Raspberry')).toBeInTheDocument();
  expect(within(ivanRow).getByText('Farmer')).toBeInTheDocument();
  expect(within(ivanRow).getByText('466,180.00 ₴')).toBeInTheDocument();
  const petroRow = screen.getByText('Petro Melnyk').closest('tr') as HTMLElement;
  expect(within(petroRow).getByText('—')).toBeInTheDocument();
  expect(screen.queryByText('+380671234567')).toBeNull();
  expect(screen.queryByRole('columnheader', { name: /phone|point|status/i })).toBeNull();
  expect(screen.getByRole('button', { name: 'New supplier' })).toBeInTheDocument();
  await expectNoAxeViolations(container);
});

it('asks for heaviest first by default and marks Total weight as the active sort', () => {
  queryMock.mockReturnValue(loaded([ivan]));
  renderSuppliers();
  expect(queryMock).toHaveBeenLastCalledWith({ search: '', sort: 'weight', order: 'desc' });
  expect(screen.getByRole('columnheader', { name: 'Total weight' })).toHaveAttribute('aria-sort', 'descending');
});

it('a click on Accrued puts the sort in the URL and asks the server for it', async () => {
  queryMock.mockReturnValue(loaded([ivan]));
  const { router } = renderSuppliers();
  await userEvent.click(screen.getByRole('button', { name: 'Accrued' }));
  expect(router.state.location.search).toBe('?sort=amount&order=desc');
  expect(queryMock).toHaveBeenLastCalledWith({ search: '', sort: 'amount', order: 'desc' });
});

it('restores the sort from the URL, e.g. after Back from a card', () => {
  queryMock.mockReturnValue(loaded([ivan]));
  renderSuppliers('/suppliers?sort=name&order=desc');
  expect(queryMock).toHaveBeenLastCalledWith({ search: '', sort: 'name', order: 'desc' });
});

it('shows N of M and loads the next page on Show more', async () => {
  const fetchNextPage = vi.fn();
  queryMock.mockReturnValue(infinite([{ rows: [ivan], total: 193 }], { hasNextPage: true, fetchNextPage }));
  renderSuppliers();
  expect(screen.getByText('Showing 1 of 193')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
  expect(fetchNextPage).toHaveBeenCalledTimes(1);
});

it('flattens loaded pages and hides Show more once everything is in', () => {
  queryMock.mockReturnValue(
    infinite([
      { rows: [ivan], total: 2 },
      { rows: [petro], total: 2 },
    ]),
  );
  renderSuppliers();
  expect(screen.getByText('Ivan Koval')).toBeInTheDocument();
  expect(screen.getByText('Petro Melnyk')).toBeInTheDocument();
  expect(screen.getByText('Showing 2 of 2')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
});
```

Keep the remaining cases (the spinner, the two dialog point-select cases, «no phone», the three card-link cases) as they are. They already go through `queryMock` / `loaded`. The spinner case returns `{ data: undefined, isPending: true, isError: false }`.

Tests pin English (`test-setup`), and the page formats with `i18n.language`, so the numbers render as `3,603.99 kg` and `466,180.00 ₴`. If `formatKg` resolves the `en` unit to something other than `kg`, assert what `formatKg('3603.99', 'en')` returns instead.

Run: `npm test -w frontend -- SuppliersPage`
Expected: FAIL. The page still calls `useSuppliersQuery`.

- [ ] **Step 7: Page**

Rewrite `SuppliersPage.tsx`. Keep the dialog state and handlers unchanged. Delete `usePointOptionsQuery`, `Badge` and `pointName`.

```tsx
import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListPage } from '@/shared/ui/templates/list-page';
import type { Column } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { TextInput } from '@/shared/ui/text-input';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue';
import { useUrlPatch, useUrlParam } from '@/shared/lib/url-state';
import { formatKg, formatUah } from '@/shared/lib/money';
import { useSupplierTotalsInfiniteQuery } from '@/entities/supplier';
import type { Supplier, SupplierTotalsRow } from '@/entities/supplier';
import { SupplierFormDialog } from '@/features/edit-supplier';
import { nextSort, readSort, toUrl } from '../model/supplierSort';

export function SuppliersPage() {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState('');
  // Debounced so each keystroke does not fire its own request.
  const debouncedSearch = useDebouncedValue(search);
  // In the URL so Back from a card returns to the same ranking (#230).
  const [sortParam] = useUrlParam('sort');
  const [orderParam] = useUrlParam('order');
  const patchUrl = useUrlPatch();
  const sort = readSort(sortParam, orderParam);
  const { data, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useSupplierTotalsInfiniteQuery({ search: debouncedSearch, sort: sort.key, order: sort.order });

  // …editing / dialogOpen / dialogInstance / openCreate / openEdit unchanged…

  const rows = data?.pages.flatMap((p) => p.data) ?? [];
  const total = data?.pages[0]?.total ?? 0;
  const locale = i18n.language;

  const columns: Column<SupplierTotalsRow>[] = [
    {
      id: 'name',
      header: t('suppliers.col.name'),
      sortable: true,
      cell: (s) => <span className="font-medium">{`${s.first_name} ${s.last_name}`}</span>,
    },
    {
      id: 'weight',
      header: t('suppliers.col.weight'),
      sortable: true,
      align: 'right',
      className: 'tabular-nums',
      cell: (s) => formatKg(s.kg_total, locale),
    },
    {
      id: 'mainProduct',
      header: t('suppliers.col.mainProduct'),
      hideBelow: 'sm',
      cell: (s) => s.main_product_name ?? '—',
    },
    {
      id: 'kind',
      header: t('suppliers.col.kind'),
      hideBelow: 'sm',
      cell: (s) => t(`suppliers.kindLabel.${s.kind}`),
    },
    {
      id: 'amount',
      header: t('suppliers.col.accrued'),
      sortable: true,
      align: 'right',
      className: 'tabular-nums',
      cell: (s) => formatUah(s.accrued, locale),
    },
    // …the existing 'card' column, unchanged…
  ];

  const footer =
    rows.length > 0 ? (
      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>{t('suppliers.shownOf', { shown: rows.length, total })}</span>
        {hasNextPage ? (
          <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? <Spinner /> : null}
            {t('suppliers.showMore')}
          </Button>
        ) : null}
      </div>
    ) : null;

  return (
    <>
      <ListPage<SupplierTotalsRow>
        // …eyebrow, title, description, actions, toolbar unchanged…
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        onRowClick={(s: Supplier) => openEdit(s)}
        sort={sort}
        onSortChange={(key) => patchUrl(toUrl(nextSort(sort, key)))}
        footer={footer}
        isEmpty={!isPending && !isError && rows.length === 0}
        empty={<EmptyState title={t('suppliers.empty.title')} hint={t('suppliers.empty.hint')} />}
      >
        {/* spinner / error children unchanged */}
      </ListPage>
      {/* SupplierFormDialog unchanged */}
    </>
  );
}
```

`useUrlPatch` and `useUrlParam` come from the `@/shared/lib/url-state` barrel, and `formatKg` and `formatUah` from `@/shared/lib/money`. All four are exported there.

Use one `patchUrl` call so `sort` and `order` change in a single history replace. Do not call two separate `useUrlParam` setters.

Under `ListPage`, `SupplierTotalsRow` is a `Supplier`, so `openEdit` accepts it as-is. `onRowClick={openEdit}` also type-checks; the arrow function is optional.

Run: `npm test -w frontend -- SuppliersPage supplierSort useSupplierTotals data-table && (cd frontend && npx tsc -b) && npm run lint -w frontend`
Expected: PASS. No type errors.

- [ ] **Step 8: Docs and commit**

In `frontend/CLAUDE.md`, append to the `entities/supplier/` line: «; `useSupplierTotalsInfiniteQuery` (`GET /supplier-totals`, #230) — the suppliers page's ranked list with all-time weight, accrued and main product, 100 per page, cached under the `supplierBalances` prefix so every document write refreshes it». In the `pages/points/, pages/users/, pages/suppliers/ …` row, nothing changes.

```bash
git add frontend/src/entities/supplier frontend/src/features/edit-supplier frontend/src/pages/suppliers frontend/src/shared/lib/i18n/locales frontend/CLAUDE.md
git commit -m "feat(suppliers): weight, main product and accrued, sortable, with show-more (#230)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Full verification

**Files:** none, unless a row is red.

- [ ] **Step 1: Run the full tier**

Run: `npm run verify:full`
Expected: the verdict line shows no failing row. Name every `SKIPPED` row and why. Read `coverage`'s own percentages; never quote a floor.

- [ ] **Step 2: If `bundle` is red**

Do not touch `bundle-budget.json`. Make `/suppliers` a router-level `lazy` route, the same shape as `/ui-kit` in `frontend/src/app/router.tsx`: `lazy: async () => ({ Component: (await import('@/pages/suppliers')).SuppliersPage })` with `RouteFallback` as `HydrateFallback`, keeping the `RequireAuth` wrapper outside. Add a `router.test.tsx` case asserting the route is lazy. Commit as `perf(router): /suppliers loads on demand (#230)` and re-run `npm run verify:full`.

- [ ] **Step 3: If anything else is red**

Read the failing row's output before re-running. Fix the code or the measurement, never the ceiling. Commit the fix with the task it belongs to (`fix(…)`).

- [ ] **Step 4: Frontend typecheck**

Run: `(cd frontend && npx tsc -b)`
Expected: exit 0.
