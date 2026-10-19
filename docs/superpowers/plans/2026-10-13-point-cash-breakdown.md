# Point cash breakdown (#73) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /point-cash/:pointId` returns the breakdown behind `cash` (anchor, movement terms, closing snapshot and difference), and «Каса точки»'s ledger renders it, so the rows always add up to the number under them.

**Architecture:** Split `movementsSql` into three named SQL term builders in a new `point-cash.sql.ts`; one new statement (`breakdownFor`) reads anchor, opening count, terms, closing snapshot and `cash` together; a pure mapper turns that row into a `kind`-discriminated `breakdown`. The frontend ledger stops re-deriving movement terms and switches on `breakdown.kind`.

**Tech Stack:** NestJS 12 + TypeORM raw SQL on Postgres 16 (Jest, `*.db-spec.ts` against a real DB); React 19 + TanStack Query + i18next (Vitest + Testing Library).

**Spec:** `docs/superpowers/specs/2026-10-13-point-cash-breakdown-design.md`

## Global Constraints

- All money arithmetic in SQL or `backend/src/common/money.ts` / `frontend/src/shared/lib/money` — never `Number()`, `*`, `/`, `parseFloat`, `toFixed` (the `src/point-cash/**` lint glob already covers the new file).
- Amounts are decimal strings end to end (`::text` in SQL).
- `cashFor`, `expectedForOpening`, `expectedForClosing`, `movementsForShift` and the list must produce byte-identical results after the refactor.
- `breakdown.kind` ∈ `'open' | 'closed' | 'carried' | 'none'`; field presence per kind exactly as the spec's table.
- `closing.expected` is the stored `cash_counts.expected_amount` (snapshot), never recomputed.
- `difference = counted − expected`; `late_change = (opening + movements now) − expected`.
- No user-visible literal outside `uk.json` / `en.json`; both locales keep identical keys.
- Frontend tests run in English (`test-setup` pins `en`).
- Gate: `npm run verify:full` once at the end (money SQL — CLAUDE.md rule 1). Not per task.

## Review Focus

1. **Open shift left from an earlier day (#114)** — anchor is `opening`, `anchor_date < as_of`: must be `kind: 'open'` with full terms, not `carried`. Pinned in Task 2 (db-spec «open from an earlier day»).
2. **Reopened shift** — closing count demoted to `midday`: must read `open` again, not `closed`. Pinned in Task 2 (db-spec «reopened»).
3. **Transfer voided after close** — `late_change ≠ 0` and `expected` stays the snapshot. Pinned in Task 2.
4. **Closing difference of exactly zero** — `difference: '0.00'`, row rendered in default tone (not amber/bad). Pinned in Task 3.
5. **Detail read fails while the list succeeded** — the ledger card shows `common.somethingWentWrong`, the rest of the page still renders. Pinned in Task 4.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `backend/src/point-cash/point-cash.sql.ts` | create | `asOfSql`, `anchorSql`, `transfersInSql`, `payoutsOutSql`, `returnsSql`, `movementsSql` |
| `backend/src/point-cash/point-cash.service.ts` | modify | import SQL from the new file; add `breakdownFor` |
| `backend/src/point-cash/point-cash.mapper.ts` | modify | `PointCashBreakdownRow`, `PointCashBreakdown`, `toPointCashBreakdown` |
| `backend/src/point-cash/point-cash.mapper.spec.ts` | create | kind/null-out rules |
| `backend/src/point-cash/point-cash.controller.ts` | modify | `findOne` returns `breakdown` |
| `backend/src/point-cash/point-cash.db-spec.ts` | modify | `breakdownFor` scenarios |
| `frontend/src/entities/point-cash/model/point-cash.ts` + `index.ts` | modify | `PointCashBreakdown` type, `PointCashOne.breakdown` |
| `frontend/src/pages/point-cash/lib/buildLedger.ts` (+ test) | modify | informational rows only |
| `frontend/src/pages/point-cash/ui/CashLedger.tsx` (+ test) | modify | render by `kind` |
| `frontend/src/pages/point-cash/ui/PointCashPage.tsx` (+ test) | modify | read detail, drop two reads |
| `frontend/src/shared/lib/i18n/locales/{uk,en}.json` | modify | new ledger keys |
| `backend/CLAUDE.md`, `frontend/CLAUDE.md` | modify | one sentence each |

---

### Task 1: Split `movementsSql` into named terms (pure refactor)

**Files:**
- Create: `backend/src/point-cash/point-cash.sql.ts`
- Modify: `backend/src/point-cash/point-cash.service.ts` (lines with `asOfSql`, `movementsSql`, `anchorSql` and the trailing `export { movementsSql, anchorSql, asOfSql };`)
- Test: existing `backend/src/point-cash/point-cash.db-spec.ts`, `backend/src/shifts/shift-close.db-spec.ts`, `backend/src/cash-counts/cash-count-recount.db-spec.ts`

**Interfaces:**
- Produces (all `(…: string) => string`, SQL fragments):
  - `asOfSql(asOf, tz)` — unchanged
  - `anchorSql(point, asOf)` — now ALSO selects `s.business_date`
  - `transfersInSql(shift)` · `payoutsOutSql(shift)` · `returnsSql(shift, tz)` — each a parenthesised scalar, never NULL
  - `movementsSql(shift, tz)` = `(transfersIn − payoutsOut + returns)`

- [ ] **Step 1: Run the baseline db-specs to record green**

Run: `npm run test:db -w backend -- point-cash.db-spec shift-close.db-spec cash-count-recount.db-spec`
Expected: PASS (all). If red before any change, stop and report.

- [ ] **Step 2: Create `point-cash.sql.ts`**

Move the three builders from `point-cash.service.ts` **with their doc comments verbatim** (the asOf comment block, the «THE MOVEMENTS OF ONE SHIFT» block, the anchor comment). Split the movements body into three builders; the SQL of each term is copied unchanged from the current `movementsSql`:

```ts
export const asOfSql = (asOf: string, tz: string): string =>
  `COALESCE(${asOf}::date, (now() AT TIME ZONE ${tz}::text)::date)`;

/** Accepted transfers credited to the shift's day — a voided one stops counting (§9.3). */
export const transfersInSql = (shift: string): string => `
    COALESCE((SELECT SUM(CASE
                WHEN t.status = 'accepted' THEN t.cash
                WHEN t.status = 'disputed' AND t.resolved_at IS NOT NULL THEN t.resolved_cash
                WHEN t.status = 'disputed' THEN t.reported_cash
              END)
         FROM transfers t
         JOIN shifts s ON s.collection_point_id = t.collection_point_id
                      AND s.business_date = t.accepted_date
        WHERE s.id = ${shift}
          AND t.voided_at IS NULL), 0.00)`;

/** Every payout of the shift, voided or not — the cash left the drawer (§9.3). */
export const payoutsOutSql = (shift: string): string => `
    COALESCE((SELECT SUM(p.amount) FROM payouts p
        WHERE p.shift_id = ${shift}), 0.00)`;

/** Cash back in the drawer: returned at void time in this shift, plus closed-shift returns settled on its day. */
export const returnsSql = (shift: string, tz: string): string => `(
    COALESCE((SELECT SUM(p.amount) FROM payouts p
        WHERE p.shift_id = ${shift}
          AND p.returned_on_void), 0.00)
  + COALESCE((SELECT SUM(p.amount)
         FROM payouts p
         JOIN shifts ps ON ps.id = p.shift_id
         JOIN shifts s  ON s.id = ${shift}
        WHERE p.return_settled_at IS NOT NULL
          AND NOT p.returned_on_void
          AND ps.collection_point_id = s.collection_point_id
          AND (p.return_settled_at AT TIME ZONE ${tz}::text)::date = s.business_date), 0.00))`;

export const movementsSql = (shift: string, tz: string): string =>
  `(${transfersInSql(shift)} - ${payoutsOutSql(shift)} + ${returnsSql(shift, tz)})`;

export const anchorSql = (point: string, asOf: string): string => `(
  SELECT c.counted_amount, c.kind, c.shift_id, s.business_date
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

Before deleting the originals, diff the old `movementsSql` body against the three new term bodies — the only allowed difference is the grouping parentheses around `returnsSql`'s two terms (addition is associative; `- payouts + a + b` ≡ `- payouts + (a + b)`).

- [ ] **Step 3: Point the service at the new file**

In `point-cash.service.ts`: delete the three local `const` builders and their comments, delete the trailing `export { movementsSql, anchorSql, asOfSql };` (nothing imports them — `grep -rn "import.*movementsSql" backend/src` returns nothing), and add:

```ts
import { anchorSql, asOfSql, movementsSql } from './point-cash.sql';
```

- [ ] **Step 4: Re-run the same db-specs + unit suite**

Run: `npm run test:db -w backend -- point-cash.db-spec shift-close.db-spec cash-count-recount.db-spec && npm test -w backend -- point-cash`
Expected: PASS, same test count as Step 1.

- [ ] **Step 5: Commit**

```bash
git add backend/src/point-cash/point-cash.sql.ts backend/src/point-cash/point-cash.service.ts
git commit -m "refactor(point-cash): movementsSql as three named terms in point-cash.sql.ts (#73)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `breakdownFor` + mapper + `GET /point-cash/:pointId`

**Files:**
- Modify: `backend/src/point-cash/point-cash.mapper.ts`
- Create: `backend/src/point-cash/point-cash.mapper.spec.ts`
- Modify: `backend/src/point-cash/point-cash.service.ts`
- Modify: `backend/src/point-cash/point-cash.controller.ts` (`findOne`)
- Test: `backend/src/point-cash/point-cash.db-spec.ts` (new nested `describe` inside the first top-level `describe('PointCashService.cashFor (Postgres)'…)`, just before its closing `});` at ~line 926, so it reuses `newPoint`/`shift`/`count`/`payoutIn`/`transfer`/`CLOSED_AT`)

**Interfaces:**
- Consumes: Task 1's `anchorSql`, `asOfSql`, `movementsSql`, `transfersInSql`, `payoutsOutSql`, `returnsSql`.
- Produces:
  ```ts
  // point-cash.mapper.ts
  export interface PointCashBreakdownRow {
    cash: string;
    anchor_kind: 'opening' | 'closing' | null;
    anchor_date: string | null;
    same_day: boolean | null;
    opening: string | null;
    transfers_in: string | null;
    payouts: string | null;
    returns: string | null;
    counted: string | null;
    expected: string | null;
    difference: string | null;
    late_change: string | null;
  }
  export type PointCashBreakdownKind = 'open' | 'closed' | 'carried' | 'none';
  export interface PointCashBreakdown {
    kind: PointCashBreakdownKind;
    anchor_date: string | null;
    opening: string | null;
    transfers_in: string | null;
    payouts: string | null;
    returns: string | null;
    closing: {
      counted: string;
      expected: string | null;
      difference: string | null;
      late_change: string | null;
    } | null;
  }
  export function toPointCashBreakdown(row: PointCashBreakdownRow): PointCashBreakdown;
  // point-cash.service.ts
  breakdownFor(pointId: string, asOf?: string): Promise<{ cash: string; breakdown: PointCashBreakdown }>;
  // GET /point-cash/:pointId response
  { collection_point_id, cash, crate_deposits, crate_deposit_units, breakdown: PointCashBreakdown }
  ```

- [ ] **Step 1: Write the failing mapper spec**

`backend/src/point-cash/point-cash.mapper.spec.ts`:

```ts
import { PointCashBreakdownRow, toPointCashBreakdown } from './point-cash.mapper';

const row = (over: Partial<PointCashBreakdownRow>): PointCashBreakdownRow => ({
  cash: '0.00',
  anchor_kind: null,
  anchor_date: null,
  same_day: null,
  opening: null,
  transfers_in: null,
  payouts: null,
  returns: null,
  counted: null,
  expected: null,
  difference: null,
  late_change: null,
  ...over,
});

const terms = {
  opening: '21820.00',
  transfers_in: '35000.00',
  payouts: '13000.00',
  returns: '0.00',
};

describe('toPointCashBreakdown', () => {
  it('none — no anchor at all', () => {
    expect(toPointCashBreakdown(row({}))).toEqual({
      kind: 'none',
      anchor_date: null,
      opening: null,
      transfers_in: null,
      payouts: null,
      returns: null,
      closing: null,
    });
  });

  it('open — an opening anchor carries the terms and no closing, whatever its date', () => {
    expect(
      toPointCashBreakdown(
        row({
          anchor_kind: 'opening',
          anchor_date: '2026-09-20',
          same_day: false,
          ...terms,
          counted: '21820.00',
          expected: null,
          difference: null,
          late_change: null,
        }),
      ),
    ).toEqual({ kind: 'open', anchor_date: '2026-09-20', ...terms, closing: null });
  });

  it('closed — a closing anchor on the same day carries everything', () => {
    expect(
      toPointCashBreakdown(
        row({
          anchor_kind: 'closing',
          anchor_date: '2026-09-22',
          same_day: true,
          ...terms,
          counted: '43730.00',
          expected: '43820.00',
          difference: '-90.00',
          late_change: '0.00',
        }),
      ),
    ).toEqual({
      kind: 'closed',
      anchor_date: '2026-09-22',
      ...terms,
      closing: { counted: '43730.00', expected: '43820.00', difference: '-90.00', late_change: '0.00' },
    });
  });

  it('carried — a closing anchor from an earlier day keeps only the counted figure', () => {
    expect(
      toPointCashBreakdown(
        row({
          anchor_kind: 'closing',
          anchor_date: '2026-09-22',
          same_day: false,
          ...terms,
          counted: '43730.00',
          expected: '43820.00',
          difference: '-90.00',
          late_change: '0.00',
        }),
      ),
    ).toEqual({
      kind: 'carried',
      anchor_date: '2026-09-22',
      opening: null,
      transfers_in: null,
      payouts: null,
      returns: null,
      closing: { counted: '43730.00', expected: null, difference: null, late_change: null },
    });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm test -w backend -- point-cash.mapper`
Expected: FAIL — `toPointCashBreakdown` / `PointCashBreakdownRow` not exported.

- [ ] **Step 3: Implement the mapper**

Append to `point-cash.mapper.ts` (types from the Interfaces block above, then):

```ts
/**
 * THE KIND IS DECIDED HERE, THE NUMBERS ARE NOT. Every figure comes from
 * `breakdownFor`'s one statement; this only nulls out what a kind must not
 * show — a carried day's terms belong to another day (spec 2026-10-13 §3).
 */
export function toPointCashBreakdown(row: PointCashBreakdownRow): PointCashBreakdown {
  const none = { anchor_date: null, opening: null, transfers_in: null, payouts: null, returns: null };
  if (row.anchor_kind === null) return { kind: 'none', ...none, closing: null };

  const terms = {
    anchor_date: row.anchor_date,
    opening: row.opening,
    transfers_in: row.transfers_in,
    payouts: row.payouts,
    returns: row.returns,
  };
  if (row.anchor_kind === 'opening') return { kind: 'open', ...terms, closing: null };

  // A closing anchor's own count IS `counted`, so it is never null here.
  const counted = row.counted as string;
  if (!row.same_day) {
    return {
      kind: 'carried',
      ...none,
      anchor_date: row.anchor_date,
      closing: { counted, expected: null, difference: null, late_change: null },
    };
  }
  return {
    kind: 'closed',
    ...terms,
    closing: {
      counted,
      expected: row.expected,
      difference: row.difference,
      late_change: row.late_change,
    },
  };
}
```

If lint rejects `as string`, use `row.counted ?? '0.00'` instead — the CHECK on `cash_counts.counted_amount` (NOT NULL) makes the fallback unreachable.

- [ ] **Step 4: Run it — expect PASS**

Run: `npm test -w backend -- point-cash.mapper`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing db-spec scenarios**

Inside `describe('PointCashService.cashFor (Postgres)', …)`, before its closing `});`:

```ts
  describe('breakdownFor — the rows add up to the figure under them (#73)', () => {
    /** Every scenario also pins the one rule that matters most: same cash as cashFor. */
    const both = async (p: string, asOf: string) => {
      const b = await service.breakdownFor(p, asOf);
      await expect(service.cashFor(p, asOf)).resolves.toBe(b.cash);
      return b;
    };

    it('open — opening + transfers − payouts + returns = cash (Шипинки 23.09)', async () => {
      const p = await newPoint();
      const sh = await shift(p, '2026-09-23', false);
      await count(sh, 'opening', '43730.00', '43730.00');
      await payoutIn(sh, '4000.00');
      await transfer(p, { cash: '15000.00', accepted_date: '2026-09-23' });

      const b = await both(p, '2026-09-23');

      expect(b.cash).toBe('54730.00');
      expect(b.breakdown).toEqual({
        kind: 'open',
        anchor_date: '2026-09-23',
        opening: '43730.00',
        transfers_in: '15000.00',
        payouts: '4000.00',
        returns: '0.00',
        closing: null,
      });
    });

    it('closed — the snapshot, the count and the difference by number (Шипинки 22.09, −90)', async () => {
      const p = await newPoint();
      const sh = await shift(p, '2026-09-22');
      await count(sh, 'opening', '21820.00', '21820.00');
      await payoutIn(sh, '13000.00');
      await transfer(p, { cash: '35000.00', accepted_date: '2026-09-22' });
      await count(sh, 'closing', '43730.00', '43820.00', CLOSED_AT);

      const b = await both(p, '2026-09-22');

      expect(b.cash).toBe('43730.00');
      expect(b.breakdown).toEqual({
        kind: 'closed',
        anchor_date: '2026-09-22',
        opening: '21820.00',
        transfers_in: '35000.00',
        payouts: '13000.00',
        returns: '0.00',
        closing: { counted: '43730.00', expected: '43820.00', difference: '-90.00', late_change: '0.00' },
      });
    });

    it('closed — a transfer voided after close is late_change; expected stays the snapshot', async () => {
      const p = await newPoint();
      const sh = await shift(p, '2026-09-22');
      await count(sh, 'opening', '21820.00', '21820.00');
      await payoutIn(sh, '13000.00');
      await transfer(p, { cash: '35000.00', accepted_date: '2026-09-22' });
      await transfer(p, {
        cash: '1000.00',
        accepted_date: '2026-09-22',
        voided_at: new Date(),
        voided_by_user_id: ownerId,
        void_reason: 'дубль',
      });
      // Counted when the 1 000 was still live: expected 44 820.
      await count(sh, 'closing', '44820.00', '44820.00', CLOSED_AT);

      const b = await both(p, '2026-09-22');

      expect(b.breakdown.closing).toEqual({
        counted: '44820.00',
        expected: '44820.00',
        difference: '0.00',
        late_change: '-1000.00',
      });
      // 21 820 + 35 000 − 13 000 + 0 − (−1 000) = 44 820 = expected.
      expect(b.breakdown.transfers_in).toBe('35000.00');
    });

    it('carried — a date with no shift reads the last close, and only that', async () => {
      const p = await newPoint();
      const sh = await shift(p, '2026-09-22');
      await count(sh, 'opening', '21820.00', '21820.00');
      await count(sh, 'closing', '43730.00', '43820.00', CLOSED_AT);

      const b = await both(p, '2026-09-24');

      expect(b.cash).toBe('43730.00');
      expect(b.breakdown).toEqual({
        kind: 'carried',
        anchor_date: '2026-09-22',
        opening: null,
        transfers_in: null,
        payouts: null,
        returns: null,
        closing: { counted: '43730.00', expected: null, difference: null, late_change: null },
      });
    });

    it('none — never counted reads 0.00 and no breakdown', async () => {
      const p = await newPoint();

      const b = await both(p, '2026-09-24');

      expect(b.cash).toBe('0.00');
      expect(b.breakdown.kind).toBe('none');
    });

    it('open from an earlier day (#114) — full terms of THAT shift, not carried', async () => {
      const p = await newPoint();
      const sh = await shift(p, '2026-09-20', false);
      await count(sh, 'opening', '1000.00', '1000.00');
      await payoutIn(sh, '300.00');

      const b = await both(p, '2026-09-22');

      expect(b.cash).toBe('700.00');
      expect(b.breakdown).toMatchObject({
        kind: 'open',
        anchor_date: '2026-09-20',
        opening: '1000.00',
        payouts: '300.00',
        closing: null,
      });
    });

    it('reopened — the demoted closing count reads as open again', async () => {
      const p = await newPoint();
      const sh = await shift(p, '2026-09-22', false);
      await count(sh, 'opening', '1000.00', '1000.00');
      await count(sh, 'midday', '900.00', '1000.00', CLOSED_AT); // the demoted close

      const b = await both(p, '2026-09-22');

      expect(b.breakdown.kind).toBe('open');
      expect(b.cash).toBe('1000.00');
    });
  });
```

- [ ] **Step 6: Run — expect FAIL**

Run: `npm run test:db -w backend -- point-cash.db-spec -t breakdownFor`
Expected: FAIL — `service.breakdownFor is not a function`.

- [ ] **Step 7: Implement `breakdownFor`**

In `point-cash.service.ts`, extend the import to `import { anchorSql, asOfSql, movementsSql, payoutsOutSql, returnsSql, transfersInSql } from './point-cash.sql';`, import `PointCashBreakdown, PointCashBreakdownRow, toPointCashBreakdown` from the mapper, and add after `cashFor`:

```ts
  /**
   * `cashFor` PLUS THE TERMS IT IS MADE OF, in ONE statement so the two can
   * never disagree (#73). `cash` is the same CASE `cashFor` runs; the closing
   * count's `expected_amount` is the stored snapshot, and `late_change` is
   * how far the shift's movements moved after it was taken (spec 2026-10-13).
   */
  async breakdownFor(
    pointId: string,
    asOf?: string,
  ): Promise<{ cash: string; breakdown: PointCashBreakdown }> {
    const sql = `
      SELECT COALESCE(a.counted_amount
                      + CASE WHEN a.kind = 'opening' THEN ${movementsSql('a.shift_id', '$3')}
                             ELSE 0.00 END, 0.00)::text AS cash,
             a.kind AS anchor_kind,
             a.business_date::text AS anchor_date,
             (a.business_date = b.as_of) AS same_day,
             o.counted_amount::text AS opening,
             ${transfersInSql('a.shift_id')}::text AS transfers_in,
             ${payoutsOutSql('a.shift_id')}::text AS payouts,
             ${returnsSql('a.shift_id', '$3')}::text AS returns,
             a.counted_amount::text AS counted,
             cl.expected_amount::text AS expected,
             (cl.counted_amount - cl.expected_amount)::text AS difference,
             (o.counted_amount + ${movementsSql('a.shift_id', '$3')} - cl.expected_amount)::text AS late_change
        FROM (SELECT ${asOfSql('$2', '$3')} AS as_of) b
        LEFT JOIN LATERAL ${anchorSql('$1::uuid', 'b.as_of')} a ON TRUE
        LEFT JOIN cash_counts o
               ON o.shift_id = a.shift_id AND o.book = 'berry' AND o.kind = 'opening'
        LEFT JOIN cash_counts cl
               ON cl.shift_id = a.shift_id AND cl.book = 'berry' AND cl.kind = 'closing'`;
    const [row] = (await this.dataSource.manager.query(sql, [
      pointId,
      asOf ?? null,
      this.tz.appTimezone,
    ])) as PointCashBreakdownRow[];

    return { cash: row.cash, breakdown: toPointCashBreakdown(row) };
  }
```

Notes for the implementer: with no anchor every `a.*` is NULL, so the term sub-selects see `s.id = NULL` and return `0.00` — harmless, the mapper nulls them for `none`. `cl` joins only `kind = 'closing'`, so a demoted (`midday`) close never matches. `UQ_cash_counts_shift_book_kind` guarantees at most one `o` and one `cl` row.

- [ ] **Step 8: Run — expect PASS**

Run: `npm run test:db -w backend -- point-cash.db-spec`
Expected: PASS (all old scenarios + 7 new).

- [ ] **Step 9: Wire the controller**

In `point-cash.controller.ts` `findOne`, replace `this.cash.cashFor(pointId, query.as_of)` and the return:

```ts
    const [{ cash, breakdown }, crateDeposits, crateDepositUnits] = await Promise.all([
      this.cash.breakdownFor(pointId, query.as_of),
      // Never bounded by `as_of` — see `crateDepositsFor`'s doc comment.
      this.cash.crateDepositsFor(pointId),
      // Same exemption, same shape, in units rather than money (R8).
      this.cash.crateUnitsFor(pointId),
    ]);
    return {
      collection_point_id: pointId,
      cash,
      crate_deposits: crateDeposits,
      crate_deposit_units: crateDepositUnits,
      breakdown,
    };
```

- [ ] **Step 10: Unit + lint**

Run: `npm test -w backend -- point-cash && npm run lint -w backend`
Expected: PASS, no lint errors.

- [ ] **Step 11: Commit**

```bash
git add backend/src/point-cash
git commit -m "feat(point-cash): GET /point-cash/:id carries the breakdown behind cash (#73)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Frontend type, trimmed `buildLedger`, `CashLedger` by kind, locales

**Files:**
- Modify: `frontend/src/entities/point-cash/model/point-cash.ts`, `frontend/src/entities/point-cash/index.ts`
- Modify: `frontend/src/pages/point-cash/lib/buildLedger.ts`, `buildLedger.test.ts`
- Modify: `frontend/src/pages/point-cash/ui/CashLedger.tsx`, `CashLedger.test.tsx`
- Modify: `frontend/src/shared/lib/i18n/locales/uk.json`, `en.json` (`pointCash.ledger`)

**Interfaces:**
- Consumes: Task 2's response shape.
- Produces:
  ```ts
  // entities/point-cash (exported from index.ts)
  export type PointCashBreakdownKind = 'open' | 'closed' | 'carried' | 'none';
  export interface PointCashBreakdown { /* same fields as backend */ }
  PointCashOne.breakdown: PointCashBreakdown
  // pages/point-cash/lib/buildLedger.ts
  type LedgerRowKey = 'accruedToday' | 'paidPast';
  buildLedger({ date, intakes, payouts, intakesTruncated?, payoutsTruncated? }): LedgerRow[]
  // CashLedger props
  { date: string; cash: string | undefined; breakdown: PointCashBreakdown | undefined;
    failed?: boolean; intakes: LedgerIntake[]; payouts: LedgerPayout[];
    intakesTruncated?: boolean; payoutsTruncated?: boolean; target?: string | null }
  ```

- [ ] **Step 1: Entity type**

In `entities/point-cash/model/point-cash.ts`, above `PointCashOne`:

```ts
/** Дзеркалить `PointCashBreakdown` (`point-cash/point-cash.mapper.ts`, #73). */
export type PointCashBreakdownKind = 'open' | 'closed' | 'carried' | 'none';

export interface PointCashBreakdown {
  kind: PointCashBreakdownKind;
  anchor_date: string | null;
  opening: string | null;
  transfers_in: string | null;
  /** Невід'ємна величина — знак ставить екран. */
  payouts: string | null;
  returns: string | null;
  closing: {
    counted: string;
    /** Знімок при закритті, не перерахунок. */
    expected: string | null;
    difference: string | null;
    late_change: string | null;
  } | null;
}
```

Add `breakdown: PointCashBreakdown;` to `PointCashOne` and change its doc line to «сума однієї точки і розклад, з якого вона складається». In `index.ts` add `PointCashBreakdown, PointCashBreakdownKind, PointCashOne` to the exported types (keep the existing ones).

- [ ] **Step 2: Locales**

In `uk.json` `pointCash.ledger`: delete `cashInTruncated`; add:

```json
      "lateChange": "Поправка на зміни після закриття",
      "lateChangeHint": "перекази чи повернення, записані вже після закриття",
      "expected": "Мало бути",
      "countedAtClose": "Пораховано при закритті",
      "difference": "Розбіжність",
      "differenceHint": "див. підрахунок при закритті",
      "totalAtClose": "У касі за ягоду — пораховано при закритті",
      "carried": "Пораховано при закритті {{date}}",
      "carriedNote": "Цього дня зміни не було — у касі те, що порахували при останньому закритті.",
      "openSince": "Зміна відкрита з {{date}} — рядки показують рух цієї зміни.",
      "neverCounted": "Касу цієї точки ще не рахували."
```

In `en.json` the same keys:

```json
      "lateChange": "Adjustment for changes after close",
      "lateChangeHint": "transfers or returns recorded after the close",
      "expected": "Expected",
      "countedAtClose": "Counted at close",
      "difference": "Difference",
      "differenceHint": "see the closing count",
      "totalAtClose": "Berry cash — counted at close",
      "carried": "Counted at close on {{date}}",
      "carriedNote": "No shift on this day — the drawer holds what was counted at the last close.",
      "openSince": "The shift has been open since {{date}} — the rows show that shift's movements.",
      "neverCounted": "This point's drawer has never been counted."
```

- [ ] **Step 3: Rewrite `buildLedger.test.ts` (failing first)**

Replace the file's tests with tests of the two remaining rows. Keep any existing `accruedToday`/`paidPast` cases that still apply (voided intake excluded, other-day intake excluded, past payouts summed, voided past payout still counted, truncation flags) and delete every case about `opening`, `paidToday`, `returnedToday`, `cashIn`. Add:

```ts
it('returns only the two informational rows — the movement rows come from the server (#73)', () => {
  const rows = buildLedger({ date: '2026-09-10', intakes: [], payouts: [] });
  expect(rows.map((r) => r.key)).toEqual(['accruedToday', 'paidPast']);
});
```

Run: `npm test -w frontend -- src/pages/point-cash/lib`
Expected: FAIL on the new test (rows still include the removed keys).

- [ ] **Step 4: Trim `buildLedger.ts`**

- `LedgerPayout` → `{ business_date: string; amount: string }` (doc: «every payout in scope counts, voided or not — §9.3»).
- Delete `LedgerTransfer`, `localDateOf`, the `transfers`/`transfersTruncated`/`openingCount`/`target` inputs, the `hint` field on `LedgerRow`.
- `LedgerRowKey = 'accruedToday' | 'paidPast'`.
- Body keeps `accruedToday` and `paidPast` exactly as today; returns:

```ts
  return [
    { key: 'accruedToday', value: accruedToday, truncated: intakesTruncated },
    { key: 'paidPast', value: paidPast, truncated: payoutsTruncated },
  ];
```

- Rewrite the function doc to two sentences: these rows are informational and never part of the total; the rows that move cash come from `GET /point-cash/:id`'s `breakdown` (#73).

Run: `npm test -w frontend -- src/pages/point-cash/lib`
Expected: PASS.

- [ ] **Step 5: Rewrite `CashLedger.test.tsx` (failing first)**

Replace the whole file:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../../test-axe';
import type { PointCashBreakdown } from '@/entities/point-cash';
import { CashLedger } from './CashLedger';

const open = (over: Partial<PointCashBreakdown> = {}): PointCashBreakdown => ({
  kind: 'open',
  anchor_date: '2026-09-23',
  opening: '43730.00',
  transfers_in: '15000.00',
  payouts: '4000.00',
  returns: '0.00',
  closing: null,
  ...over,
});

const closed = (closing: Partial<NonNullable<PointCashBreakdown['closing']>> = {}): PointCashBreakdown => ({
  kind: 'closed',
  anchor_date: '2026-09-22',
  opening: '21820.00',
  transfers_in: '35000.00',
  payouts: '13000.00',
  returns: '0.00',
  closing: { counted: '43730.00', expected: '43820.00', difference: '-90.00', late_change: '0.00', ...closing },
});

/**
 * The `LedgerRow` whose LABEL is exactly `label`. `getByText(label)` cannot do
 * it: a hint renders inside the label span, so «Difference» reads
 * «Differencesee the closing count» as one textContent.
 */
const row = (label: string): HTMLElement => {
  const [span] = screen.getAllByText(
    (_, el) => el?.tagName === 'SPAN' && el.firstChild?.nodeType === 3 && el.firstChild.textContent === label,
  );
  return span.closest('div') as HTMLElement;
};

const ledger = (breakdown: PointCashBreakdown | undefined, cash: string | undefined, date = '2026-09-23', failed = false) =>
  render(
    <CashLedger date={date} cash={cash} breakdown={breakdown} failed={failed} intakes={[]} payouts={[]} />,
  );

describe('CashLedger', () => {
  it('open day — the rows add up to the total exactly (Shypynky 23.09: 43 730 − 4 000 + 0 + 15 000 = 54 730)', () => {
    ledger(open(), '54730.00');

    expect(row('Opening count')).toHaveTextContent('43,730.00 ₴');
    expect(row('Paid out today')).toHaveTextContent('−4,000.00 ₴');
    expect(row('Returned to the drawer')).toHaveTextContent('0.00 ₴');
    expect(row('Received by transfer today')).toHaveTextContent('15,000.00 ₴');
    expect(row('Berry cash')).toHaveTextContent('54,730.00 ₴');
    expect(screen.queryByText('Expected')).toBeNull();
  });

  it('closed day — expected, counted and the difference by number; the total says it is the closing count', () => {
    ledger(closed(), '43730.00', '2026-09-22');

    expect(row('Expected')).toHaveTextContent('43,820.00 ₴');
    expect(row('Counted at close')).toHaveTextContent('43,730.00 ₴');
    expect(row('Difference')).toHaveTextContent('−90.00 ₴');
    expect(row('Berry cash — counted at close')).toHaveTextContent('43,730.00 ₴');
    expect(screen.queryByText('Adjustment for changes after close')).toBeNull();
  });

  it('closed day — a shortage reads bad, a surplus amber, zero neither', () => {
    const { unmount } = ledger(closed(), '43730.00', '2026-09-22');
    expect(screen.getByText('−90.00 ₴')).toHaveClass('text-destructive');
    unmount();

    const surplus = ledger(closed({ counted: '43900.00', difference: '80.00' }), '43900.00', '2026-09-22');
    expect(screen.getByText('80.00 ₴')).toHaveClass('text-[var(--amber)]');
    surplus.unmount();

    ledger(closed({ counted: '43820.00', difference: '0.00' }), '43820.00', '2026-09-22');
    const zero = row('Difference').querySelector('.font-mono') as HTMLElement;
    expect(zero).not.toHaveClass('text-destructive');
    expect(zero).not.toHaveClass('text-[var(--amber)]');
  });

  it('closed day — a change after close is its own line, signed so the rows still reach Expected', () => {
    // Transfer of 1 000 voided after close: late_change −1 000, the line adds it back.
    ledger(
      closed({ expected: '44820.00', counted: '44820.00', difference: '0.00', late_change: '-1000.00' }),
      '44820.00',
      '2026-09-22',
    );

    expect(row('Adjustment for changes after close')).toHaveTextContent('1,000.00 ₴');
    expect(row('Expected')).toHaveTextContent('44,820.00 ₴');
  });

  it('carried — one line for the last close, no movement rows', () => {
    ledger(
      {
        kind: 'carried',
        anchor_date: '2026-09-22',
        opening: null,
        transfers_in: null,
        payouts: null,
        returns: null,
        closing: { counted: '43730.00', expected: null, difference: null, late_change: null },
      },
      '43730.00',
      '2026-09-24',
    );

    expect(screen.getByText('Counted at close on 09/22')).toBeInTheDocument();
    expect(screen.getByText(/No shift on this day/)).toBeInTheDocument();
    expect(screen.queryByText('Paid out today')).toBeNull();
    expect(row('Berry cash')).toHaveTextContent('43,730.00 ₴');
  });

  it('none — says the drawer was never counted', () => {
    ledger(
      { kind: 'none', anchor_date: null, opening: null, transfers_in: null, payouts: null, returns: null, closing: null },
      '0.00',
    );

    expect(screen.getByText("This point's drawer has never been counted.")).toBeInTheDocument();
    expect(row('Berry cash')).toHaveTextContent('0.00 ₴');
  });

  it('open since an earlier day (#114) — says whose movements the rows are', () => {
    ledger(open({ anchor_date: '2026-09-20' }), '54730.00', '2026-09-23');

    expect(screen.getByText(/open since 09\/20/)).toBeInTheDocument();
  });

  it('a failed detail read says so inside the card and prints no total', () => {
    ledger(undefined, undefined, '2026-09-23', true);

    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
    expect(screen.queryByText('Berry cash')).toBeNull();
  });

  it('keeps the informational rows, apart from the sum', () => {
    render(
      <CashLedger
        date="2026-09-23"
        cash="54730.00"
        breakdown={open()}
        intakes={[{ business_date: '2026-09-23', amount: '700.00', voided_at: null }]}
        payouts={[{ business_date: '2026-09-20', amount: '300.00' }]}
      />,
    );

    expect(row('Accrued today')).toHaveTextContent('700.00 ₴');
    expect(row('Paid for past days')).toHaveTextContent('−300.00 ₴');
  });

  it('has no axe violations', async () => {
    const { container } = ledger(closed(), '43730.00', '2026-09-22');
    await expectNoAxeViolations(container);
  });
});
```

Before relying on them, check two facts and adjust the assertions (not the component) if they differ: the tone classes in `shared/ui/ledger-row.tsx`'s `TONE` map (`bad`/`amber`); and the existing negative-total / `twoRowsNote` tests from the old file — port them over unchanged except for the new props (`breakdown={open()}`).

Run: `npm test -w frontend -- src/pages/point-cash/ui/CashLedger`
Expected: FAIL (component still takes the old props).

- [ ] **Step 6: Rewrite `CashLedger.tsx`**

Keep the file's `INFORMATIONAL` rendering pattern, `negative` notice and `twoRowsNote`. Delete `TRUNCATION_KEY`'s `paidToday`/`returnedToday`/`cashIn` entries (only `accruedToday` and `paidPast` remain) and the `opening`-specific hint logic. Shape:

```tsx
import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/shared/ui/section-card';
import { LedgerRow as LedgerRowView } from '@/shared/ui/ledger-row';
import { Spinner } from '@/shared/ui/spinner';
import { sub, cmp, isNegative, isZero, formatUah } from '@/shared/lib/money';
import { formatShortDate } from '@/shared/lib/date';
import type { PointCashBreakdown } from '@/entities/point-cash';
import { buildLedger, type LedgerIntake, type LedgerPayout, type LedgerRowKey } from '../lib/buildLedger';

const TRUNCATION_KEY: Record<LedgerRowKey, string> = {
  accruedToday: 'pointCash.ledger.accruedTodayTruncated',
  paidPast: 'pointCash.ledger.paidPastTruncated',
};

/**
 * «Звідки взялося це число». Every row under the divider comes from the
 * server's `breakdown` (#73), read in the same statement as `cash`, so the
 * rows add up to the total by construction: on an open day to `cash`, on a
 * closed day to «Мало бути», which the count then corrects by the difference.
 * The two rows above the divider are informational and never summed.
 */
export function CashLedger({
  date,
  cash,
  breakdown,
  failed = false,
  intakes,
  payouts,
  intakesTruncated = false,
  payoutsTruncated = false,
  target = null,
}: {
  date: string;
  cash: string | undefined;
  breakdown: PointCashBreakdown | undefined;
  /** The detail read failed — the card says so; the rest of the page does not depend on it. */
  failed?: boolean;
  intakes: LedgerIntake[];
  payouts: LedgerPayout[];
  intakesTruncated?: boolean;
  payoutsTruncated?: boolean;
  /** Captions the opening row: «наділ {{target}}». */
  target?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const money = (v: string) => formatUah(v, locale);
  const info = buildLedger({ date, intakes, payouts, intakesTruncated, payoutsTruncated });

  const body = (): ReactNode => {
    if (failed) return <p className="text-sm text-destructive">{t('common.somethingWentWrong')}</p>;
    if (!breakdown || cash === undefined) {
      return (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      );
    }
    const b = breakdown;
    const movements =
      b.kind === 'open' || b.kind === 'closed' ? (
        <>
          <LedgerRowView
            label={t('pointCash.ledger.opening')}
            hint={target ? t('pointCash.ledger.openingHint', { target: money(target) }) : undefined}
            value={money(b.opening ?? '0.00')}
          />
          <LedgerRowView label={t('pointCash.ledger.paidToday')} value={money(sub('0', b.payouts ?? '0.00'))} />
          <LedgerRowView label={t('pointCash.ledger.returnedToday')} value={money(b.returns ?? '0.00')} tone="leaf" />
          <LedgerRowView label={t('pointCash.ledger.cashIn')} value={money(b.transfers_in ?? '0.00')} tone="leaf" />
        </>
      ) : null;

    const c = b.closing;
    const closing =
      b.kind === 'closed' && c ? (
        <>
          {c.late_change && !isZero(c.late_change) ? (
            <LedgerRowView
              label={t('pointCash.ledger.lateChange')}
              hint={t('pointCash.ledger.lateChangeHint')}
              value={money(sub('0', c.late_change))}
            />
          ) : null}
          <div className="my-2 border-t border-dashed border-border" />
          <LedgerRowView label={t('pointCash.ledger.expected')} value={money(c.expected ?? '0.00')} />
          <LedgerRowView label={t('pointCash.ledger.countedAtClose')} value={money(c.counted)} />
          <LedgerRowView
            label={t('pointCash.ledger.difference')}
            hint={t('pointCash.ledger.differenceHint')}
            value={money(c.difference ?? '0.00')}
            tone={differenceTone(c.difference)}
          />
        </>
      ) : null;

    return (
      <>
        {movements}
        {b.kind === 'open' && b.anchor_date && b.anchor_date !== date ? (
          <p className="pt-1 text-xs text-muted-foreground">
            {t('pointCash.ledger.openSince', { date: formatShortDate(b.anchor_date, locale) })}
          </p>
        ) : null}
        {b.kind === 'carried' && c && b.anchor_date ? (
          <>
            <LedgerRowView
              label={t('pointCash.ledger.carried', { date: formatShortDate(b.anchor_date, locale) })}
              value={money(c.counted)}
            />
            <p className="pt-1 text-xs text-muted-foreground">{t('pointCash.ledger.carriedNote')}</p>
          </>
        ) : null}
        {b.kind === 'none' ? (
          <p className="pt-1 text-xs text-muted-foreground">{t('pointCash.ledger.neverCounted')}</p>
        ) : null}
        {closing}
        <div className="my-2 border-t border-border" />
        <LedgerRowView
          label={t(b.kind === 'closed' ? 'pointCash.ledger.totalAtClose' : 'pointCash.ledger.total')}
          value={money(cash)}
          strong
          tone={isNegative(cash) ? 'bad' : 'default'}
        />
        {isNegative(cash) ? <p className="pt-1 text-xs text-destructive">{t('pointCash.ledger.negative')}</p> : null}
      </>
    );
  };

  return (
    <SectionCard eyebrow={t('pointCash.ledger.title')}>
      <div className="flex flex-col">
        {info.map((row) => (
          <Fragment key={row.key}>
            <LedgerRowView
              label={t(`pointCash.ledger.${row.key}`)}
              hint={t(`pointCash.ledger.${row.key}Hint`)}
              value={money(row.key === 'paidPast' ? sub('0', row.value) : row.value)}
              className="opacity-70"
            />
            {row.truncated ? (
              <p className="pb-1 text-xs text-muted-foreground">{t(TRUNCATION_KEY[row.key])}</p>
            ) : null}
          </Fragment>
        ))}
        <div className="my-2 border-b border-dashed border-border" />
        {body()}
        <p className="pt-3 text-xs leading-relaxed text-muted-foreground">{t('pointCash.ledger.twoRowsNote')}</p>
      </div>
    </SectionCard>
  );
}

/** A shortage reads bad, a surplus amber, an exact match plain — same reading as the shift panel's pill. */
function differenceTone(difference: string | null): 'bad' | 'amber' | 'default' {
  if (difference === null) return 'default';
  const c = cmp(difference, '0');
  return c < 0 ? 'bad' : c > 0 ? 'amber' : 'default';
}
```

If `LedgerRowView` puts the `label` text in a node whose closest `div` is not the row, adjust the test's `row()` helper to match `ledger-row.tsx`'s markup, not the component.

- [ ] **Step 7: Run — expect PASS**

Run: `npm test -w frontend -- src/pages/point-cash/ui/CashLedger src/pages/point-cash/lib`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/entities/point-cash frontend/src/pages/point-cash/lib frontend/src/pages/point-cash/ui/CashLedger.tsx frontend/src/pages/point-cash/ui/CashLedger.test.tsx frontend/src/shared/lib/i18n/locales
git commit -m "feat(point-cash): the ledger renders the server breakdown — expected, counted, difference (#73)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Wire `PointCashPage` to the detail read

**Files:**
- Modify: `frontend/src/pages/point-cash/ui/PointCashPage.tsx`
- Modify: `frontend/src/pages/point-cash/ui/PointCashPage.test.tsx`

**Interfaces:**
- Consumes: `usePointCashForPointQuery(pointId: string | null, asOf?: string, enabled = true)` from `@/entities/point-cash`; Task 3's `CashLedger` props.

- [ ] **Step 1: Update the test mocks and failing tests**

In `PointCashPage.test.tsx`:

1. Add `pointCashOneMock: vi.fn()` to the hoisted mocks and to the `@/entities/point-cash` mock:
   ```ts
   usePointCashForPointQuery: (pointId: string | null, asOf?: string) => pointCashOneMock(pointId, asOf),
   ```
2. In `beforeEach`:
   ```ts
   pointCashOneMock.mockReset().mockReturnValue({
     data: {
       collection_point_id: 'p1',
       cash: pointRow().cash,
       crate_deposits: '0.00',
       crate_deposit_units: 0,
       breakdown: {
         kind: 'open',
         anchor_date: '2026-09-08',
         opening: '1000.00',
         transfers_in: '0.00',
         payouts: '0.00',
         returns: '0.00',
         closing: null,
       },
     },
     isPending: false,
     isError: false,
   });
   ```
   If `pointRow().cash` is not `'1000.00'`, set `opening` to that same value so the open-day rows still add up.
3. Replace the whole `describe('PointCashPage — R6: the ledger’s opening row', …)` with:
   ```ts
   describe('PointCashPage — the ledger reads the server breakdown (#73)', () => {
     it('asks the detail read for THIS point and THIS date', () => {
       renderPointCash();
       expect(pointCashOneMock).toHaveBeenCalledWith('p1', '2026-09-08');
     });

     it('no longer reads a day-scoped opening count of its own', () => {
       renderPointCash();
       expect(cashCountsMock).not.toHaveBeenCalledWith({ pointId: 'p1', from: '2026-09-08', to: '2026-09-08' });
     });

     it('captions the opening row with the point’s target', () => {
       pointCashMock.mockImplementation((opts: { asOf?: string } = {}) =>
         'asOf' in opts ? list([pointRow({ target_cash: '5000.00' })]) : list([]),
       );
       renderPointCash();
       expect(screen.getByText('target 5,000.00 ₴')).toBeInTheDocument();
     });

     it('a failed detail read stays inside the ledger card — the stats still render', () => {
       pointCashOneMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
       renderPointCash();
       expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
       expect(tile('Target')).toBeInTheDocument();
     });
   });
   ```
4. In the truncation describe: the payouts test now expects ONE caveat (`toHaveLength(1)` — only `paidPast` reads payouts; update its comment), and the «transfers and intakes» test drops the transfers half (rename to «carries the same caveat to the row fed by intakes», delete `ledgerTransfersMock.mockReturnValue(truncated([]))` and the `Showing recent transfers only` assertion).
5. In the «Select a point» empty-state test: delete the `ledgerTransfersMock` `toHaveBeenCalledWith({ pointId: undefined, limit: 100, enabled: false })` assertion and the `cashCountsMock).toHaveBeenCalledWith({})` assertion with its R6 comment; add `expect(pointCashOneMock).toHaveBeenCalledWith(null, '2026-09-08');`.
6. Keep `ledgerTransfersMock` itself — `IncomingTransfers` (rendered for real or stubbed — check) still goes through `@/entities/transfer`.

Run: `npm test -w frontend -- src/pages/point-cash/ui/PointCashPage`
Expected: FAIL on the new detail-read tests.

- [ ] **Step 2: Wire the page**

In `PointCashPage.tsx`:

- Import `usePointCashForPointQuery` alongside `usePointCashQuery`.
- Delete `ledgerTransfers` (`useTransfersQuery` call), its import if now unused, `openingCashCounts`, `transfersTruncated`, `openingCount` and their comments; remove `ledgerTransfers.isError` and `openingCashCounts.isError` from `isError`.
- Add, next to `pointCash`:
  ```ts
  // #73 — the ledger's rows and its total, read in ONE server statement so
  // they cannot disagree. Kept out of `isError`: a failed breakdown degrades
  // the ledger card only, never the stats above it.
  const pointCashOne = usePointCashForPointQuery(pointId, date);
  ```
- Replace the `<CashLedger …/>` props:
  ```tsx
  <CashLedger
    date={date}
    cash={pointCashOne.data?.cash}
    breakdown={pointCashOne.data?.breakdown}
    failed={pointCashOne.isError}
    intakes={intakes.data?.data ?? []}
    payouts={payouts.data?.data ?? []}
    intakesTruncated={intakesTruncated}
    payoutsTruncated={payoutsTruncated}
    target={shownRow.target_cash}
  />
  ```
- Update the page's top doc comment (the part saying `CashLedger`'s rows are built from a bounded page of `transfers`) to: the movement rows come from `GET /point-cash/:pointId`'s `breakdown`; only the two informational rows still read intakes/payouts.

- [ ] **Step 3: Run the page + whole point-cash folder**

Run: `npm test -w frontend -- src/pages/point-cash && npx tsc -b frontend`
Expected: PASS; `tsc` clean (Vitest does not typecheck — the `tsc -b` is the only proof the removed props are gone everywhere).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/point-cash/ui/PointCashPage.tsx frontend/src/pages/point-cash/ui/PointCashPage.test.tsx
git commit -m "feat(point-cash): the page reads the breakdown; two client reads gone (#73)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Docs and the gate

**Files:**
- Modify: `backend/CLAUDE.md` (the `point-cash/` line in Structure)
- Modify: `frontend/CLAUDE.md` (the `pages/point-cash/` line in Structure)

- [ ] **Step 1: Docs**

`backend/CLAUDE.md`, `point-cash/` entry — after «Serves `GET /point-cash` … and `GET /point-cash/:pointId`.» insert:
«The detail also carries `breakdown` (#73): `breakdownFor` reads the anchor, its shift's opening count, the three movement terms (`point-cash.sql.ts`: `transfersInSql`, `payoutsOutSql`, `returnsSql` — `movementsSql` is their sum), the closing count's stored `expected_amount` and `cash` in ONE statement, so the ledger's rows add up to the figure by construction; `kind` is `open` / `closed` / `carried` / `none`, and `late_change` is how far a closed shift's movements moved after its snapshot.»

`frontend/CLAUDE.md`, `pages/point-cash/` entry — replace «the ledger explaining the server's own figure (incl. its opening-count row)» with «the ledger rendering `GET /point-cash/:pointId`'s `breakdown` by `kind` (#73 — an open day's rows add up to the total; a closed day's reach «Мало бути», then the closing count and the difference by number), with «Нараховано сьогодні» / «Видано за минулі дні» informational above the divider».

- [ ] **Step 2: The gate**

Run: `npm run verify:full`
Expected: verdict line green. Paste the verdict line; name every `SKIPPED` row aloud. A red row: read it, fix the code or test — never widen a baseline (`error-codes`, `plain-text`, `bundle` included; the point-cash page is lazy, but if `bundle` reds, report it rather than raising the ceiling).

- [ ] **Step 3: Commit**

```bash
git add backend/CLAUDE.md frontend/CLAUDE.md
git commit -m "docs: point-cash breakdown (#73)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
