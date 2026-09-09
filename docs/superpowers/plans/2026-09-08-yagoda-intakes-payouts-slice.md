# Yagoda Intakes & Payouts Implementation Plan

> **For agentic workers:** implement this plan task-by-task, in order. Steps use checkbox (`- [ ]`) syntax for tracking. Each task is test-first: write the failing test, run it, watch it fail for the *stated* reason, then implement.

**Goal:** Add the first two documents in the system — `intakes` (with `intake_items` and `intake_item_tare_types`) and `payouts` — plus the minimal `shifts` container they cannot exist without, and the `supplier-balance` module that answers «скільки ми винні цій людині».

**Architecture:** Four new NestJS feature modules under `backend/src/` in the repo's flat layout (`<name>.entity.ts`, `<name>.service.ts`, `<name>.controller.ts`, `<name>.mapper.ts`, `dto/`), one hand-written TypeORM migration creating five tables and one enum, and one new arithmetic seam in `common/`. `shifts` is a container with no reconciliation; `intakes` is a single aggregate written in one transaction; `payouts` carries the debt half of §3.6's ceiling behind a row lock; `supplier-balance` owns one SQL formula and writes nothing.

**Tech Stack:** NestJS 10 (Express), TypeORM + PostgreSQL 16, class-validator/class-transformer, luxon (via the existing `TimeService`), Jest (two configs: `npm test` for `*.spec.ts`, `npm run test:db` for `*.db-spec.ts`), supertest.

**Spec:** `docs/superpowers/specs/2026-09-08-yagoda-intakes-payouts-slice.md`

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec.

- **`numeric` is a string end to end** — database, entity, DTO, JSON. Never a `number`. **No arithmetic operator (`+ - * /`) is ever applied to a money or weight value outside `common/money.ts`** (foundation §5.1). `decimal.js` is NOT added; §6.8 of the spec explains what replaces it.
- **Rounding is per line, then summed.** `Σ round(each)`, never `round(Σ)`. Half-up at scale 2.
- **Weights are `numeric(10,2)`, money is `numeric(12,2)`**, except `intake_items.price` and `intake_items.bonus`, which are `numeric(10,2)` per the DBML. Every decimal DTO field carries `@Matches` **and** `@CanonicalDecimal()`; omitting the latter makes `'1.2'` and `'1.20'` compare unequal and is a real bug.
- **`bonus` may be negative** — §2.8, «від'ємний bonus це м'ята чи цвіла ягода». It gets no `>= 0` CHECK, and its DTO regex must admit a leading `-`. Every other decimal field is unsigned.
- **`business_date` is server-derived** from `TimeService.now()` in `APP_TIMEZONE` and never appears in a request body (foundation §5.2).
- **No `DELETE` route anywhere, ever.** No `PATCH` anywhere in this slice — a document is corrected by voiding it and writing another (§2.7, §9.3, «Часткового сторно немає»).
- **Opening and closing a shift is `@Auth(UserRole.PointOperator)`** — §10.3, «Тільки приймальник — і це не помилка». The owner has neither verb; the open DTO has no `collection_point_id`. Reopen stays owner-only.
- **An operator may void only a document THEY wrote** — §9.4, «чужа квитанція → приймальник НІКОЛИ, навіть на своїй точці і в ту саму зміну». The check is `received_by_user_id === actor.id`, not "same point". §10.6's mid-shift cashier swap makes the forbidden case ordinary.
- **Every intake line carries at least one tare line** — §9.1. `@ArrayMinSize(1)` on `tare`, same as on `items`.
- **A refusal NAMES the number it refused against.** «maximum bonus for this grade is 30.00», «the supplier's balance is 5497.37». §2.10 («межа працює як обмеження, а не як підказка») is a UI/UX recommendation about the resting state of the screen, **not** an access rule — owner's clarification, 2026-09-08 — and the moment someone exceeds a limit is exactly when it becomes relevant. A message the operator cannot act on is the failure mode to avoid.
- **The void trio is all-or-nothing**: `CHECK (num_nulls(voided_at, voided_by_user_id, void_reason) IN (0, 3))` on both document tables. The reason is mandatory (§9.3).
- **`shift_status`** is a native Postgres enum with exactly `'open' | 'awaiting_explanation' | 'closed'`, default `'open'`. **`awaiting_explanation` is unreachable in this slice and stays in the type.** So does `shifts.explanation`, which nothing writes.
- **Two hand-written indexes** the DBML cannot express: `UNIQUE (collection_point_id) WHERE closed_at IS NULL` (partial) and `UNIQUE (collection_point_id, business_date)` (spec §8.1, an addition).
- **`shifts` has no `void_*` trio and no `opened_at`.** `created_at` is the open instant (spec §8.3).
- **Timestamps are `timestamptz`** (`@CreateDateColumn({ type: 'timestamptz' })`); `business_date` is `date`, which TypeORM returns as a `'YYYY-MM-DD'` **string** — keep it a string, never a `Date`.
- **Document codes are composed server-side**: `{POINT_CODE}-{IN|PO}-{YYYYMMDD}-{typed}` (spec §6.2). The raw typed part is never stored separately.
- **Migration id is `1788600000007`**, file `1788600000007-YagodaIntakesAndPayouts.ts`.
- **`strict: true` TypeScript. No `@ts-ignore`, no `as any`.** (`as never` in test doubles matches existing specs and is acceptable there.)
- Commands run from the repo root: `npm test -w backend`, `npm run test:db -w backend`, `npm run lint -w backend`.

### Audit actions added by this slice

Append to `AUDIT_ACTIONS` in `backend/src/audit/audit-log.entity.ts`, in this order:

```ts
'shift.opened',
'shift.closed',
'shift.reopened',
'intake.created',
'intake.voided',
'payout.created',
'payout.voided',
'payout.return-settled',
```

The hyphenated last one matches the existing `user.avatar-changed` / `point.target-changed` convention.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `backend/src/common/money.ts` | The ONLY place a decimal string is taken apart. `add`/`sub`/`mul`/`sum`/`cmp`/`gt` |
| `backend/src/common/money.spec.ts` | Exhaustive, table-driven; the highest-consequence spec in the slice |
| `backend/src/common/document-code.ts` | `normalizeTypedCode`, `composeDocumentCode` |
| `backend/src/common/document-code.spec.ts` | |
| `backend/src/shifts/shift-status.enum.ts` | `ShiftStatus` TS enum matching the PG type |
| `backend/src/shifts/shift.entity.ts` | `shifts` row + constraint metadata |
| `backend/src/shifts/shift.mapper.ts` | `ShiftResponse` + `toShiftResponse` |
| `backend/src/shifts/dto/reopen-shift.dto.ts` | `{ reason }` — mandatory |
| `backend/src/shifts/dto/list-shifts.query.ts` | `?collection_point_id= &status= &from= &to=` |
| `backend/src/shifts/dto/current-shift.query.ts` | `?collection_point_id=` |
| `backend/src/shifts/shifts.service.ts` | open, close, reopen, list, findOne, `findOpenAtPoint`, `findOneRaw` |
| `backend/src/shifts/shifts.service.spec.ts` | |
| `backend/src/shifts/shifts.controller.ts` | |
| `backend/src/shifts/shifts.module.ts` | |
| `backend/src/intakes/intake.entity.ts` | |
| `backend/src/intakes/intake-item.entity.ts` | |
| `backend/src/intakes/intake-item-tare-type.entity.ts` | Composite PK `(item_id, tare_type_id)` |
| `backend/src/intakes/intake-lines.ts` | **Pure.** Request + snapshots → item records. All arithmetic lives here |
| `backend/src/intakes/intake-lines.spec.ts` | No database, no Nest |
| `backend/src/intakes/intake.mapper.ts` | `IntakeResponse`, `IntakeDetailResponse` |
| `backend/src/intakes/dto/create-intake.dto.ts` | Nested `items[]` → `tare[]` |
| `backend/src/intakes/dto/void-document.dto.ts` | `{ reason }` — shared shape, re-exported by payouts |
| `backend/src/intakes/dto/list-intakes.query.ts` | |
| `backend/src/intakes/intakes.service.ts` | |
| `backend/src/intakes/intakes.service.spec.ts` | |
| `backend/src/intakes/intakes.controller.ts` | |
| `backend/src/intakes/intakes.module.ts` | |
| `backend/src/supplier-balance/supplier-balance.service.ts` | `debtFor(supplierId, manager?)` — the only `SUM` |
| `backend/src/supplier-balance/supplier-balance.service.spec.ts` | |
| `backend/src/supplier-balance/supplier-balance.controller.ts` | `GET /suppliers/:id/balance` |
| `backend/src/supplier-balance/supplier-balance.mapper.ts` | |
| `backend/src/supplier-balance/supplier-balance.module.ts` | |
| `backend/src/payouts/payout.entity.ts` | |
| `backend/src/payouts/payout.mapper.ts` | |
| `backend/src/payouts/dto/create-payout.dto.ts` | |
| `backend/src/payouts/dto/settle-return.dto.ts` | `{ note? }` |
| `backend/src/payouts/dto/list-payouts.query.ts` | |
| `backend/src/payouts/payouts.service.ts` | create (locked), void, settleReturn, list, findOne |
| `backend/src/payouts/payouts.service.spec.ts` | |
| `backend/src/payouts/payouts.controller.ts` | |
| `backend/src/payouts/payouts.module.ts` | |
| `backend/src/migrations/1788600000007-YagodaIntakesAndPayouts.ts` | Five tables, one enum, one `ALTER` |
| `backend/src/migrations/intakes-payouts-schema.db-spec.ts` | Constraint proofs in raw SQL |
| `backend/src/payouts/payout-race.db-spec.ts` | Two concurrent transactions; proves `FOR UPDATE` |
| `backend/src/testing/documents-pipeline.db-spec.ts` | HTTP walk: open → intake → payout → void → close |

**Modified:**

| File | Change |
|---|---|
| `backend/src/audit/audit-log.entity.ts` | Eight new `AUDIT_ACTIONS` |
| `backend/src/auth/access/point-scope.ts` | Export a shared `resolveWritePoint` |
| `backend/src/collection-points/collection-point.entity.ts` | `code` column + `UNIQUE` + `CHECK` |
| `backend/src/collection-points/collection-point.mapper.ts` | `code` in the response |
| `backend/src/collection-points/dto/create-collection-point.dto.ts` | `code` — required |
| `backend/src/collection-points/dto/update-collection-point.dto.ts` | `code` — optional |
| `backend/src/collection-points/collection-points.service.ts` | Normalise + uniqueness pre-check for `code` |
| `backend/src/grade-prices/grade-prices.service.ts` | Add `currentFor(pointId, gradeId)` |
| `backend/src/grade-prices/grade-prices.module.ts` | Export the service (already does) |
| `backend/src/tare-types/tare-types.service.ts` | Add `findManyRaw(ids)` |
| `backend/src/app.module.ts` | Import four new modules |
| `backend/CLAUDE.md` | Structure table + migrations list |
| `CLAUDE.md` | Domain line — five tables implemented, five remain |
| `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` | New section for this slice |

---

## Task 1: `common/money.ts` — the arithmetic seam

Built first, alone, with no database and no Nest, for the same reason `phone.ts` was: every number this slice writes passes through it, and §2.7 freezes a wrong `amount` forever. «Не зійшлося на копійку — те саме, що на 350 ₴.»

**Files:**
- Create: `backend/src/common/money.ts`
- Test: `backend/src/common/money.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `add`, `sub`, `mul`, `sum`, `cmp`, `gt`, `gte`, `lt`, `lte`, `isNegative`, `isZero` — all taking and returning canonical decimal **strings**. Used by `intake-lines.ts` (Task 6) and `PayoutsService` (Task 11).

- [ ] **Step 1: Write the failing test**

Create `backend/src/common/money.spec.ts`:

```ts
import { add, cmp, gt, gte, isNegative, mul, sub, sum } from './money';

/**
 * THIS FILE IS THE GUARANTEE. Every amount the system will ever print on a
 * supplier's receipt is produced by the four functions below, and §2.7 freezes
 * a wrong one forever. There is no tolerance to fall back on: the schema says
 * «не зійшлося на копійку — те саме, що на 350 ₴».
 */
describe('money', () => {
  describe('parsing and formatting', () => {
    it.each([
      ['0', '0.00'],
      ['0.0', '0.00'],
      ['7', '7.00'],
      ['7.5', '7.50'],
      ['7.05', '7.05'],
      ['-3.4', '-3.40'],
      ['000012.30', '12.30'],
    ])('canonicalizes %s to %s through add(x, "0")', (input, expected) => {
      expect(add(input, '0')).toBe(expected);
    });

    it.each(['', ' ', 'abc', '1.234', '1.', '.5', '1e3', '+1.00', '1,00', '--1'])(
      'rejects %p',
      (bad) => {
        expect(() => add(bad, '0')).toThrow(/not a decimal/i);
      },
    );
  });

  describe('sub — exact, never rounded', () => {
    // §2.4: net = (gross − pallet) − tare. All three inputs are numeric(10,2),
    // so two-decimal subtraction is EXACT and must never be routed through the
    // rounding path.
    it.each([
      ['42.00', '1.50', '40.50'],
      ['40.50', '3.60', '36.90'],
      ['1.00', '1.00', '0.00'],
      ['1.00', '1.01', '-0.01'],
      ['0.10', '0.20', '-0.10'],
    ])('%s − %s = %s', (a, b, expected) => {
      expect(sub(a, b)).toBe(expected);
    });

    // The canonical float trap, stated as a test so a future rewrite that
    // reaches for Number() fails here rather than in production.
    it('does not manufacture 0.30000000000000004', () => {
      expect(add('0.10', '0.20')).toBe('0.30');
      expect(sub('0.30', '0.10')).toBe('0.20');
    });
  });

  describe('mul — HALF-UP at scale 2', () => {
    it.each([
      // net × rate, both scale 2 → scale 4 → rounded to 2
      ['36.90', '57.00', '2103.30'],
      ['10.00', '0.00', '0.00'],
      ['1.00', '1.00', '1.00'],
      // exact .5 at the fourth decimal rounds AWAY FROM ZERO
      ['0.05', '0.05', '0.00'], // 0.0025 -> 0.00
      ['0.15', '0.15', '0.02'], // 0.0225 -> 0.02
      ['0.10', '0.05', '0.01'], // 0.0050 -> 0.01, the half-up case
      ['0.30', '0.15', '0.05'], // 0.0450 -> 0.05
      // negative effective rate is arithmetically fine here; refusing it is a
      // rule in intake-lines, not in the arithmetic
      ['10.00', '-1.50', '-15.00'],
      ['-0.10', '0.05', '-0.01'], // half-up away from zero on the negative side
    ])('%s × %s = %s', (a, b, expected) => {
      expect(mul(a, b)).toBe(expected);
    });

    it('handles a value larger than Number.MAX_SAFE_INTEGER in kopiykas', () => {
      // numeric(12,2) tops out at 9_999_999_999.99; squaring the inputs is not
      // realistic but proves the internals are bigint, not double.
      expect(mul('9999999999.99', '1.00')).toBe('9999999999.99');
    });
  });

  describe('sum — exact, and the ORDER of rounding', () => {
    it('adds without rounding', () => {
      expect(sum(['1.01', '2.02', '3.03'])).toBe('6.06');
      expect(sum([])).toBe('0.00');
    });

    /**
     * THE LOAD-BEARING TEST OF THIS SLICE. The receipt prints each line's
     * amount and a total that must equal what is printed above it. Rounding
     * each line and then summing is NOT the same number as summing raw
     * products and rounding once, and the paper shows the former.
     */
    it('Σ round(each) differs from round(Σ) and we produce the former', () => {
      const lines = [
        { kg: '0.10', rate: '0.05' }, // 0.0050 -> 0.01
        { kg: '0.10', rate: '0.05' }, // 0.0050 -> 0.01
        { kg: '0.10', rate: '0.05' }, // 0.0050 -> 0.01
      ];
      const perLine = lines.map((l) => mul(l.kg, l.rate));
      expect(perLine).toEqual(['0.01', '0.01', '0.01']);
      expect(sum(perLine)).toBe('0.03');
      // round(Σ raw) would be round(0.0150) = 0.02. We print 0.03.
    });
  });

  describe('comparison', () => {
    it.each([
      ['1.00', '1.00', 0],
      ['1.01', '1.00', 1],
      ['1.00', '1.01', -1],
      ['-1.00', '0.00', -1],
      ['10.00', '9.99', 1],
      // string comparison would get this wrong: '9.99' > '10.00' lexically
      ['9.99', '10.00', -1],
    ])('cmp(%s, %s) = %s', (a, b, expected) => {
      expect(cmp(a, b)).toBe(expected);
    });

    it('gt and gte agree with cmp', () => {
      expect(gt('380.01', '380.00')).toBe(true);
      expect(gt('380.00', '380.00')).toBe(false);
      expect(gte('380.00', '380.00')).toBe(true);
      expect(isNegative('-0.01')).toBe(true);
      expect(isNegative('0.00')).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w backend -- money.spec
```

Expect `Cannot find module './money'`. Anything else means a stale file exists — stop and look.

- [ ] **Step 3: Write the implementation**

Create `backend/src/common/money.ts`:

```ts
/**
 * THE ONLY PLACE IN THE BACKEND WHERE A DECIMAL STRING IS TAKEN APART.
 *
 * Foundation §5.1: `numeric` values are strings end to end and no arithmetic
 * operator is ever applied to one. This module is the seam that makes that
 * rule keepable — everything else calls these functions and never touches a
 * digit.
 *
 * INTERNALS ARE bigint KOPIYKAS (scale 2), and that is deliberately NOT the
 * storage model: foundation §5.1 rejected integer kopiykas as a schema choice
 * because they contradict the DBML's `numeric(12,2)` and invalidate the SQL
 * formulas in the `suppliers` and `cash_counts` Notes. Here they are a private
 * implementation detail behind a string boundary, which is a different claim.
 *
 * `Number`, `parseFloat` and `toFixed` appear NOWHERE below, on purpose. A
 * double cannot round-trip every value `numeric(12,2)` can hold, and the
 * failure is silent — exactly the class of bug §5.1 exists to forbid.
 *
 * WHY NOT `decimal.js`: deferred by the owner's decision of 2026-09-08 on the
 * grounds that this slice's business logic is provisional. When it stops being
 * provisional, the replacement is the internals of THIS FILE and nothing else.
 * That is the whole reason the seam exists — see spec §6.8.
 */

const SCALE = 2;
const UNIT = 100n;
const DECIMAL = /^-?\d+(?:\.\d{1,2})?$/;

/** `'-12.3'` → `-1230n`. Throws on anything that is not a scale-≤2 decimal. */
function parse(value: string): bigint {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw new Error(`money: ${JSON.stringify(value)} is not a decimal with at most 2 places`);
  }
  const negative = value.startsWith('-');
  const magnitude = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = magnitude.split('.');
  const units = BigInt(whole) * UNIT + BigInt(fraction.padEnd(SCALE, '0'));
  return negative ? -units : units;
}

/** `-1230n` → `'-12.30'`. Always exactly two decimal places. */
function format(units: bigint): string {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const whole = magnitude / UNIT;
  const fraction = (magnitude % UNIT).toString().padStart(SCALE, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function add(a: string, b: string): string {
  return format(parse(a) + parse(b));
}

export function sub(a: string, b: string): string {
  return format(parse(a) - parse(b));
}

/**
 * Multiplies two scale-2 values and rounds the scale-4 product back to scale 2,
 * HALF-UP AWAY FROM ZERO.
 *
 * Half-up is foundation §5.1's stated policy, «applied where paper shows a
 * number» — and this is that place: `amount = net × (price + bonus)` is printed
 * on the supplier's copy. Away-from-zero (rather than half-up toward positive
 * infinity) keeps a negative line the mirror image of its positive twin, which
 * matters because `bonus` is legitimately negative for «м'ята чи цвіла ягода».
 */
export function mul(a: string, b: string): string {
  const raw = parse(a) * parse(b); // scale 4
  const negative = raw < 0n;
  const magnitude = negative ? -raw : raw;
  const rounded = (magnitude + UNIT / 2n) / UNIT; // +50, floor -> half-up
  return format(negative ? -rounded : rounded);
}

/** Exact addition of already-rounded values. NEVER rounds — see money.spec.ts's
 *  «Σ round(each) differs from round(Σ)». */
export function sum(values: string[]): string {
  return format(values.reduce((acc, v) => acc + parse(v), 0n));
}

export function cmp(a: string, b: string): -1 | 0 | 1 {
  const ua = parse(a);
  const ub = parse(b);
  return ua < ub ? -1 : ua > ub ? 1 : 0;
}

export const gt = (a: string, b: string): boolean => cmp(a, b) === 1;
export const gte = (a: string, b: string): boolean => cmp(a, b) >= 0;
export const lt = (a: string, b: string): boolean => cmp(a, b) === -1;
export const lte = (a: string, b: string): boolean => cmp(a, b) <= 0;
export const isNegative = (value: string): boolean => parse(value) < 0n;
export const isZero = (value: string): boolean => parse(value) === 0n;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -w backend -- money.spec
```

All green. If the half-up cases fail, the bug is almost certainly `Math.round`-style behaviour creeping in via a `Number` conversion — re-read Step 3's header.

- [ ] **Step 5: Add the lint rule that keeps the seam a seam**

In `backend/eslint.config.mjs`, add a `no-restricted-syntax` rule scoped to the four new service directories, forbidding `BinaryExpression` with operators `*` and `/` on identifiers, and forbidding `Number(`/`parseFloat(`. If the flat-config surgery proves fiddly, a `no-restricted-globals` on `parseFloat` plus a review note is an acceptable fallback — record which was done.

The value is not the rule's completeness; it is that the next person who writes `price * kg` in a service gets a red squiggle pointing at `money.ts`.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint -w backend && npm test -w backend -- money.spec
git add -A && git commit -m "feat(money): decimal-string arithmetic seam for document amounts"
```

---

## Task 2: `common/document-code.ts` — receipt code composition

Small, pure, and built before the migration because the `CHECK` on `collection_points.code` and this function must agree on one alphabet.

**Files:**
- Create: `backend/src/common/document-code.ts`
- Test: `backend/src/common/document-code.spec.ts`

**Interfaces:**
- Produces: `normalizeTypedCode(raw)`, `composeDocumentCode(pointCode, kind, businessDate, typed)`. Used by `IntakesService` (Task 8) and `PayoutsService` (Task 11).

- [ ] **Step 1: Write the failing test**

Create `backend/src/common/document-code.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { composeDocumentCode, normalizeTypedCode } from './document-code';

describe('normalizeTypedCode', () => {
  it.each([
    ['04412', '04412'],
    ['  04412  ', '04412'],
    ['a-17', 'A-17'],
    ['A17', 'A17'],
  ])('normalizes %p to %p', (raw, expected) => {
    expect(normalizeTypedCode(raw)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['-17'], // must start alphanumeric
    ['04 412'], // no spaces inside
    ['04/412'],
    ['ПРИЙОМ12'], // Cyrillic would defeat the CHECK on the composed code
    ['A'.repeat(17)],
  ])('rejects %p', (raw) => {
    expect(() => normalizeTypedCode(raw)).toThrow(BadRequestException);
  });
});

describe('composeDocumentCode', () => {
  it('composes point, kind, business date and typed number', () => {
    expect(composeDocumentCode('KPG', 'IN', '2026-09-08', '04412')).toBe('KPG-IN-20260908-04412');
    expect(composeDocumentCode('KPG', 'PO', '2026-09-08', '31')).toBe('KPG-PO-20260908-31');
  });

  it('uses the SHIFT business date, not the wall clock', () => {
    // A shift opened on the 8th and still open at 00:10 on the 9th writes the
    // 8th. Passing the date in rather than reading a clock is what guarantees
    // this, so the signature is the test.
    expect(composeDocumentCode('KPG', 'IN', '2026-09-08', '1')).toContain('20260908');
  });

  it('normalizes the typed part on the way through', () => {
    expect(composeDocumentCode('KPG', 'IN', '2026-09-08', ' a-17 ')).toBe('KPG-IN-20260908-A-17');
  });

  it('rejects a business date that is not YYYY-MM-DD', () => {
    expect(() => composeDocumentCode('KPG', 'IN', '08.09.2026', '1')).toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm test -w backend -- document-code.spec
```

- [ ] **Step 3: Write the implementation**

Create `backend/src/common/document-code.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

/**
 * §6.2 of the spec. The operator types the number printed in the paper receipt
 * book; the server composes what is stored:
 *
 *     {POINT_CODE}-{IN|PO}-{YYYYMMDD}-{typed}      KPG-IN-20260908-04412
 *
 * THE PREFIX IS WHAT MAKES THE DBML'S GLOBAL `UNIQUE (code)` TRUE. Two points
 * buying identical receipt books both have an «04412»; without the point code
 * the second one is a 409 mid-transaction with a car waiting. Without the date,
 * a point collides with ITSELF when its book is replaced and restarts at 00001.
 *
 * The raw typed part is NOT stored separately — one column, one fact (DBML
 * header). Recovering it is string surgery on `code`, and nothing needs to.
 */
export type DocumentKind = 'IN' | 'PO';

/** The alphabet here and the CHECK on `collection_points.code` must agree; both
 *  are ASCII upper-alphanumeric so the composed code survives any encoding. */
const TYPED = /^[A-Z0-9][A-Z0-9-]{0,15}$/;
const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeTypedCode(raw: string): string {
  const normalized = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!TYPED.test(normalized)) {
    throw new BadRequestException({
      message:
        'code must be 1–16 characters, start with a letter or digit, and contain only A–Z, 0–9 and hyphens',
      code: 'DOCUMENT_CODE_INVALID',
    });
  }
  return normalized;
}

export function composeDocumentCode(
  pointCode: string,
  kind: DocumentKind,
  businessDate: string,
  typed: string,
): string {
  if (!BUSINESS_DATE.test(businessDate)) {
    // Not a user error — a `date` column reaching here in any other shape means
    // TypeORM stopped returning `date` as 'YYYY-MM-DD', which would silently
    // change every code the system writes.
    throw new BadRequestException({
      message: `business_date must be YYYY-MM-DD, got ${businessDate}`,
      code: 'BUSINESS_DATE_MALFORMED',
    });
  }
  return `${pointCode}-${kind}-${businessDate.replace(/-/g, '')}-${normalizeTypedCode(typed)}`;
}
```

- [ ] **Step 4: Run, lint, commit**

```bash
npm test -w backend -- document-code.spec && npm run lint -w backend
git add -A && git commit -m "feat(common): server-side receipt code composition"
```

---

## Task 3: Migration and schema proofs

Everything in this slice's schema that exists ONLY in hand-written SQL and is invisible to a mocked repository. Written test-first: the db-spec goes in before the migration, and it must fail with `relation "shifts" does not exist` rather than an assertion mismatch.

**Files:**
- Create: `backend/src/migrations/1788600000007-YagodaIntakesAndPayouts.ts`
- Test: `backend/src/migrations/intakes-payouts-schema.db-spec.ts`

**Interfaces:**
- Consumes: `collection_points`, `users`, `suppliers`, `product_grades`, `tare_types` — all existing.
- Produces: the `shift_status` type, five tables, `collection_points.code`.

- [ ] **Step 1: Write the failing db-spec**

Create `backend/src/migrations/intakes-payouts-schema.db-spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/**
 * Constraint proofs for the five document tables. Every fixture value carries a
 * per-RUN uuid: `app_test` persists between runs and this suite never
 * truncates, so a literal would pass on a fresh database and then fail on every
 * later run with a duplicate-key error from the WRONG insert. Same convention
 * as `suppliers-prices-schema.db-spec.ts`.
 *
 * SEVERAL TESTS HERE ARE INVERTED — they assert that a constraint is ABSENT.
 * Those exist because a well-meaning `migration:generate` run, or a reviewer
 * "tidying up", would add the missing constraint and silently break a rule the
 * DBML argues for at length. Read the comment on each before deleting one.
 */
describe('YagodaIntakesAndPayouts', () => {
  let ds: DataSource;
  let run: string;
  let pointA: string;
  let pointB: string;
  let userId: string;
  let supplierA: string;
  let gradeId: string;
  let tareId: string;

  const openShift = (point: string, date: string) =>
    ds
      .query(
        `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
         VALUES ($1, $2, $3) RETURNING id`,
        [point, userId, date],
      )
      .then((rows: { id: string }[]) => rows[0].id);

  const closeShift = (id: string) =>
    ds.query(
      `UPDATE shifts SET closed_at = now(), closed_by_user_id = $2, status = 'closed' WHERE id = $1`,
      [id, userId],
    );

  const insertIntake = (shift: string, code: string, amount = '100.00') =>
    ds
      .query(
        `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [code, shift, supplierA, amount, userId],
      )
      .then((rows: { id: string }[]) => rows[0].id);

  const insertPayout = (shift: string, code: string, amount = '50.00') =>
    ds
      .query(
        `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [code, shift, supplierA, amount, userId],
      )
      .then((rows: { id: string }[]) => rows[0].id);

  beforeAll(async () => {
    ds = await openTestDataSource();
    run = randomUUID();

    const [a] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Точка А-${run}`, `A${run.slice(0, 4).toUpperCase()}`],
    );
    const [b] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Точка Б-${run}`, `B${run.slice(0, 4).toUpperCase()}`],
    );
    pointA = a.id;
    pointB = b.id;

    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role) VALUES ('Оксана', 'Приймальник', 'network_owner')
       RETURNING id`,
    );
    userId = user.id;

    const [supplier] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name)
       VALUES ($1, 'Іван', $2) RETURNING id`,
      [pointA, `Коваль-${run}`],
    );
    supplierA = supplier.id;

    const [product] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [
      `Малина-${run}`,
    ]);
    const [grade] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, $2) RETURNING id`,
      [product.id, `1 сорт-${run}`],
    );
    gradeId = grade.id;

    const [tare] = await ds.query(
      `INSERT INTO tare_types (name, weight_kg, deposit_price, is_crate)
       VALUES ($1, '1.20', '0.00', true) RETURNING id`,
      [`Ящик-${run}`],
    );
    tareId = tare.id;
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it.each(['shifts', 'intakes', 'intake_items', 'intake_item_tare_types', 'payouts'])(
    'creates the %s table',
    async (table) => {
      const [row] = await ds.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [
        `public.${table}`,
      ]);
      expect(row.present).toBe(true);
    },
  );

  describe('collection_points.code', () => {
    it('is NOT NULL, unique and upper-alphanumeric', async () => {
      await expect(
        ds.query(`INSERT INTO collection_points (name, code) VALUES ($1, NULL)`, [`X-${run}`]),
      ).rejects.toThrow(/null value|not-null/i);

      await expect(
        ds.query(`INSERT INTO collection_points (name, code) VALUES ($1, 'kpg')`, [`Y-${run}`]),
      ).rejects.toThrow(/CHK_collection_points_code/);

      const [{ code }] = await ds.query(`SELECT code FROM collection_points WHERE id = $1`, [
        pointA,
      ]);
      await expect(
        ds.query(`INSERT INTO collection_points (name, code) VALUES ($1, $2)`, [`Z-${run}`, code]),
      ).rejects.toThrow(/UQ_collection_points_code/);
    });

    it('backfilled every pre-existing row', async () => {
      const [row] = await ds.query(`SELECT count(*)::int AS missing FROM collection_points
                                     WHERE code IS NULL`);
      expect(row.missing).toBe(0);
    });
  });

  describe('shifts', () => {
    it('allows only ONE OPEN shift per point, whatever the date', async () => {
      const first = await openShift(pointB, '2026-06-01');
      // A second open shift at the same point on a DIFFERENT day is still
      // refused: §7.8, «дві відкриті зміни це дві книги на одну шухляду».
      await expect(openShift(pointB, '2026-06-02')).rejects.toThrow(/UQ_shifts_open_per_point/);
      await closeShift(first);
      // With the first one closed, the next day opens normally.
      const second = await openShift(pointB, '2026-06-02');
      expect(second).toBeTruthy();
      await closeShift(second);
    });

    it('allows only ONE shift per point per business_date, even after closing', async () => {
      // Spec §8.1 — an ADDITION to the DBML, which writes this index
      // non-unique. It is what `POST /shifts/:id/reopen` exists to survive.
      const first = await openShift(pointB, '2026-06-03');
      await closeShift(first);
      await expect(openShift(pointB, '2026-06-03')).rejects.toThrow(
        /UQ_shifts_point_business_date/,
      );
    });

    it('refuses a closed_at without a closer and vice versa', async () => {
      const shift = await openShift(pointB, '2026-06-04');
      await expect(
        ds.query(`UPDATE shifts SET closed_at = now(), status = 'closed' WHERE id = $1`, [shift]),
      ).rejects.toThrow(/CHK_shifts_closed_pair/);
      await closeShift(shift);
    });

    it('ties status to closed_at without forbidding awaiting_explanation later', async () => {
      const shift = await openShift(pointB, '2026-06-05');
      // open + closed_at is incoherent
      await expect(
        ds.query(`UPDATE shifts SET closed_at = now(), closed_by_user_id = $2 WHERE id = $1`, [
          shift,
          userId,
        ]),
      ).rejects.toThrow(/CHK_shifts_open_status/);
      // BUT the enum value this slice cannot reach must still be STORABLE, or
      // the cash_counts slice needs a migration to use its own column.
      await ds.query(
        `UPDATE shifts SET closed_at = now(), closed_by_user_id = $2,
                           status = 'awaiting_explanation', explanation = 'розбіжність 350 ₴'
          WHERE id = $1`,
        [shift, userId],
      );
      const [row] = await ds.query(`SELECT status, explanation FROM shifts WHERE id = $1`, [shift]);
      expect(row.status).toBe('awaiting_explanation');
      expect(row.explanation).toBe('розбіжність 350 ₴');
    });

    it('has NO void_* columns — a shift is reopened, not voided', async () => {
      const [row] = await ds.query(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_name = 'shifts' AND column_name IN ('voided_at','voided_by_user_id','void_reason')`,
      );
      expect(row.n).toBe(0);
    });

    it('has NO opened_at — created_at is the open instant (spec §8.3)', async () => {
      const [row] = await ds.query(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_name = 'shifts' AND column_name = 'opened_at'`,
      );
      expect(row.n).toBe(0);
    });
  });

  describe('void trios', () => {
    let shift: string;
    beforeAll(async () => {
      shift = await openShift(pointA, '2026-07-01');
    });

    it.each([
      ['intakes', 'intake'],
      ['payouts', 'payout'],
    ])('%s refuses a partial void trio', async (table) => {
      const id =
        table === 'intakes'
          ? await insertIntake(shift, `${run}-IN-partial`)
          : await insertPayout(shift, `${run}-PO-partial`);

      // §9.3 makes the reason MANDATORY. Two of three is the shape a hand-run
      // UPDATE produces, and it is exactly what must not be storable.
      await expect(
        ds.query(`UPDATE ${table} SET voided_at = now(), voided_by_user_id = $2 WHERE id = $1`, [
          id,
          userId,
        ]),
      ).rejects.toThrow(/void_trio/);

      await ds.query(
        `UPDATE ${table} SET voided_at = now(), voided_by_user_id = $2, void_reason = 'помилка'
          WHERE id = $1`,
        [id, userId],
      );
      const [row] = await ds.query(`SELECT void_reason FROM ${table} WHERE id = $1`, [id]);
      expect(row.void_reason).toBe('помилка');
    });
  });

  describe('payouts return settlement', () => {
    let shift: string;
    beforeAll(async () => {
      shift = await openShift(pointA, '2026-07-02');
    });

    it('cannot be settled unless the payout is voided', async () => {
      const id = await insertPayout(shift, `${run}-PO-settle-a`);
      // §9.3 — «каса НЕ виросла на 8 000… інакше сторно стає способом красти».
      // Settling a LIVE payout would claim money came back that never left in
      // the first place.
      await expect(
        ds.query(
          `UPDATE payouts SET return_settled_at = now(), return_settled_by_user_id = $2 WHERE id = $1`,
          [id, userId],
        ),
      ).rejects.toThrow(/return_requires_void/);
    });

    it('requires a settler alongside the timestamp, but NOT a note', async () => {
      const id = await insertPayout(shift, `${run}-PO-settle-b`);
      await ds.query(
        `UPDATE payouts SET voided_at = now(), voided_by_user_id = $2, void_reason = 'помилка'
          WHERE id = $1`,
        [id, userId],
      );
      await expect(
        ds.query(`UPDATE payouts SET return_settled_at = now() WHERE id = $1`, [id]),
      ).rejects.toThrow(/return_pair/);

      // The note is OPTIONAL — unlike void_reason, which §9.3 makes mandatory.
      // Two similar-looking trios, two different rules; this test is the
      // difference written down.
      await ds.query(
        `UPDATE payouts SET return_settled_at = now(), return_settled_by_user_id = $2 WHERE id = $1`,
        [id, userId],
      );
      const [row] = await ds.query(`SELECT return_note FROM payouts WHERE id = $1`, [id]);
      expect(row.return_note).toBeNull();
    });

    it('refuses a zero payout', async () => {
      // Spec §8.6 — stricter than §3.7. A receipt for handing over nothing.
      await expect(insertPayout(shift, `${run}-PO-zero`, '0.00')).rejects.toThrow(
        /CHK_payouts_amount/,
      );
    });
  });

  describe('intake_items', () => {
    let intakeId: string;
    beforeAll(async () => {
      const shift = await openShift(pointA, '2026-07-03');
      intakeId = await insertIntake(shift, `${run}-IN-items`);
    });

    const insertItem = (order: number, overrides: Record<string, string> = {}) => {
      const v = {
        gross_kg: '42.00',
        pallet_kg: '1.50',
        tare_weight_kg: '3.60',
        net_kg: '36.90',
        price: '57.00',
        bonus: '0.00',
        amount: '2103.30',
        ...overrides,
      };
      return ds.query(
        `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
             gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          intakeId,
          order,
          gradeId,
          v.gross_kg,
          v.pallet_kg,
          v.tare_weight_kg,
          v.net_kg,
          v.price,
          v.bonus,
          v.amount,
        ],
      );
    };

    it('numbers its lines uniquely within one intake', async () => {
      await insertItem(1);
      await expect(insertItem(1)).rejects.toThrow(/UQ_intake_items_order/);
      await insertItem(2);
    });

    it('ACCEPTS a negative bonus', async () => {
      // §2.8 — «від'ємний bonus це м'ята чи цвіла ягода». There is deliberately
      // no `bonus >= 0` CHECK, and adding one would make docking for spoiled
      // fruit impossible. Inverted test on purpose.
      const [row] = await insertItem(3, { bonus: '-5.00', amount: '1918.80' });
      expect(row.id).toBeTruthy();
    });

    it('refuses a non-positive net weight', async () => {
      // Without this, tare heavier than gross writes a negative amount, which
      // becomes a silent credit to the supplier's debt, frozen by §2.7.
      await expect(insertItem(4, { net_kg: '0.00', amount: '0.00' })).rejects.toThrow(
        /CHK_intake_items_net_kg/,
      );
      await expect(insertItem(5, { net_kg: '-1.00', amount: '0.00' })).rejects.toThrow(
        /CHK_intake_items_net_kg/,
      );
    });

    it('has NO created_at, NO updated_at and NO equality CHECK on amount', async () => {
      // Composition children are frozen with their parent and have no
      // independent lifecycle. The equality CHECK is refused by foundation
      // §5.4: stored values are rounded, so an exact check rejects legitimate
      // rows and a tolerant one is the «допустима розбіжність» the schema
      // refuses to have. Proven by storing a deliberately WRONG amount.
      const [cols] = await ds.query(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_name = 'intake_items' AND column_name IN ('created_at','updated_at')`,
      );
      expect(cols.n).toBe(0);

      const [row] = await insertItem(6, { amount: '1.00' });
      expect(row.id).toBeTruthy();
    });

    it('cascades to items and tare lines when the intake is deleted', async () => {
      // No route deletes an intake and none ever will (§5.5). The constraint is
      // asserted because the CASCADE is what makes the children parts of a
      // document rather than rows in their own right.
      const shift = await openShift(pointA, '2026-07-04');
      const doomed = await insertIntake(shift, `${run}-IN-cascade`);
      const [item] = await ds.query(
        `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
             gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
         VALUES ($1, 1, $2, '10.00', '0.00', '1.20', '8.80', '50.00', '0.00', '440.00')
         RETURNING id`,
        [doomed, gradeId],
      );
      await ds.query(
        `INSERT INTO intake_item_tare_types (item_id, tare_type_id, units) VALUES ($1, $2, 1)`,
        [item.id, tareId],
      );

      await ds.query(`DELETE FROM intakes WHERE id = $1`, [doomed]);
      const [left] = await ds.query(`SELECT count(*)::int AS n FROM intake_items WHERE id = $1`, [
        item.id,
      ]);
      expect(left.n).toBe(0);
      const [lines] = await ds.query(
        `SELECT count(*)::int AS n FROM intake_item_tare_types WHERE item_id = $1`,
        [item.id],
      );
      expect(lines.n).toBe(0);
    });
  });

  describe('intake_item_tare_types', () => {
    let itemId: string;
    beforeAll(async () => {
      const shift = await openShift(pointA, '2026-07-05');
      const intake = await insertIntake(shift, `${run}-IN-tare`);
      const [item] = await ds.query(
        `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
             gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
         VALUES ($1, 1, $2, '10.00', '0.00', '1.20', '8.80', '50.00', '0.00', '440.00')
         RETURNING id`,
        [intake, gradeId],
      );
      itemId = item.id;
    });

    it('keys on (item_id, tare_type_id) so a type appears once per line', async () => {
      await ds.query(
        `INSERT INTO intake_item_tare_types (item_id, tare_type_id, units) VALUES ($1, $2, 3)`,
        [itemId, tareId],
      );
      await expect(
        ds.query(
          `INSERT INTO intake_item_tare_types (item_id, tare_type_id, units) VALUES ($1, $2, 1)`,
          [itemId, tareId],
        ),
      ).rejects.toThrow(/PK_intake_item_tare_types/);
    });

    it('refuses zero or negative units', async () => {
      const [other] = await ds.query(
        `INSERT INTO tare_types (name, weight_kg, deposit_price) VALUES ($1, '0.50', '0.00')
         RETURNING id`,
        [`Ведро-${run}`],
      );
      await expect(
        ds.query(
          `INSERT INTO intake_item_tare_types (item_id, tare_type_id, units) VALUES ($1, $2, 0)`,
          [itemId, other.id],
        ),
      ).rejects.toThrow(/CHK_intake_item_tare_types_units/);
    });
  });

  describe('document codes', () => {
    it('are globally unique', async () => {
      const shiftA = await openShift(pointA, '2026-07-06');
      await insertIntake(shiftA, `${run}-IN-dup`);
      await expect(insertIntake(shiftA, `${run}-IN-dup`)).rejects.toThrow(/UQ_intakes_code/);
    });

    it('do not collide ACROSS the two document tables', async () => {
      // Separate tables, separate constraints. The IN/PO prefix is legibility,
      // not a uniqueness mechanism, and this records that.
      const shift = await openShift(pointA, '2026-07-07');
      const shared = `${run}-SHARED`;
      await insertIntake(shift, shared);
      const payout = await insertPayout(shift, shared);
      expect(payout).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test:db -w backend -- intakes-payouts-schema
```

Expect `relation "shifts" does not exist`. If instead you see a `collection_points.code` error, a previous run left a partial migration — reset the test database before continuing.

- [ ] **Step 3: Write the migration**

Create `backend/src/migrations/1788600000007-YagodaIntakesAndPayouts.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The first two documents in the system, and the shift that contains them.
 *
 * FIVE THINGS IN HERE LOOK LIKE OMISSIONS AND ARE NOT. A later reader — or a
 * `migration:generate` run — will try to "fix" each one:
 *
 * 1. `shifts.explanation` and the `awaiting_explanation` enum value are
 *    UNWRITTEN ON PURPOSE. Both land with `cash_counts`, which is the only
 *    thing that can detect the discrepancy they describe. They stay because
 *    28-db-schema.dbml is the schema of record, and because adding an enum
 *    value later is a migration nobody should have to write.
 * 2. `intake_items` has NO `created_at`/`updated_at` and NO equality CHECK on
 *    `amount`. Foundation §5.4 refuses the latter outright: stored money is
 *    rounded to two decimals, so an exact check rejects legitimate rows and a
 *    tolerant one is the «допустима розбіжність» the schema will not have.
 * 3. `intake_items.bonus` has NO non-negative CHECK. §2.8 — «від'ємний bonus це
 *    м'ята чи цвіла ягода». Adding one makes docking for spoiled fruit
 *    impossible.
 * 4. `shifts` has NO void_* trio and NO `opened_at`. A shift is not a paper
 *    document; it is reopened, not voided (spec §8.2), and `created_at` is the
 *    open instant (spec §8.3).
 * 5. `UQ_shifts_point_business_date` is an ADDITION to the DBML, which writes
 *    that index non-unique. `POST /shifts/:id/reopen` exists BECAUSE of it —
 *    removing one without the other strands a point for a whole day after a
 *    mistaken close. Spec §8.1.
 *
 * THE CHECK REGEX IS WRITTEN WITH `[A-Z0-9]`, NOT `\w` OR `\d`, ON PURPOSE.
 * This SQL lives in a JavaScript template literal where `\d` collapses to a
 * bare `d` before Postgres ever sees it, producing a constraint that matches a
 * literal letter. Bracket expressions need no escaping and cannot be mangled
 * this way. Same warning as `1788600000006-YagodaSuppliersAndPrices`.
 */
export class YagodaIntakesAndPayouts1788600000007 implements MigrationInterface {
  name = 'YagodaIntakesAndPayouts1788600000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- collection_points.code -------------------------------------------
    // Required by the receipt-code scheme (spec §6.2): without a point
    // identifier in the code, the DBML's own global UNIQUE (code) is
    // unsatisfiable for two points using identical paper receipt books.
    await queryRunner.query(
      `ALTER TABLE "collection_points" ADD COLUMN "code" character varying`,
    );
    // Deterministic backfill so the column can be NOT NULL immediately. The
    // owner renames these to something meaningful via PATCH whenever they like.
    await queryRunner.query(`
      UPDATE "collection_points" AS cp
         SET "code" = t.generated
        FROM (SELECT id,
                     'P' || lpad(row_number() OVER (ORDER BY created_at, id)::text, 2, '0')
                       AS generated
                FROM "collection_points") AS t
       WHERE cp.id = t.id
    `);
    await queryRunner.query(
      `ALTER TABLE "collection_points" ALTER COLUMN "code" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_points"
         ADD CONSTRAINT "UQ_collection_points_code" UNIQUE ("code")`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_points"
         ADD CONSTRAINT "CHK_collection_points_code" CHECK ("code" ~ '^[A-Z0-9]{2,8}$')`,
    );

    // ---- shifts ------------------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "shift_status" AS ENUM ('open', 'awaiting_explanation', 'closed')`,
    );

    await queryRunner.query(`
      CREATE TABLE "shifts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "collection_point_id" uuid NOT NULL,
        "opened_by_user_id" uuid NOT NULL,
        "closed_by_user_id" uuid,
        "business_date" date NOT NULL,
        "closed_at" TIMESTAMP WITH TIME ZONE,
        "status" "shift_status" NOT NULL DEFAULT 'open',
        "explanation" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_shifts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_shifts_point" FOREIGN KEY ("collection_point_id")
          REFERENCES "collection_points"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_shifts_opened_by" FOREIGN KEY ("opened_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_shifts_closed_by" FOREIGN KEY ("closed_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "UQ_shifts_point_business_date"
          UNIQUE ("collection_point_id", "business_date"),
        CONSTRAINT "CHK_shifts_closed_pair"
          CHECK (("closed_at" IS NULL) = ("closed_by_user_id" IS NULL)),
        -- Written as open ⟺ no closed_at, NOT as closed ⟺ closed_at, so that
        -- 'awaiting_explanation' stays storable alongside a closed_at when
        -- cash_counts lands. The stricter form would need a migration then.
        CONSTRAINT "CHK_shifts_open_status"
          CHECK (("status" = 'open') = ("closed_at" IS NULL))
      )
    `);

    // §7.8 — «дві відкриті зміни це дві книги на одну шухляду». The DBML writes
    // `(collection_point_id) [unique]`, which would forbid a point from ever
    // having a SECOND shift; the partial form is what the rule actually says.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_shifts_open_per_point"
         ON "shifts" ("collection_point_id") WHERE "closed_at" IS NULL`,
    );

    // ---- intakes -----------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "intakes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" character varying NOT NULL,
        "shift_id" uuid NOT NULL,
        "supplier_id" uuid NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "received_by_user_id" uuid NOT NULL,
        "voided_at" TIMESTAMP WITH TIME ZONE,
        "voided_by_user_id" uuid,
        "void_reason" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_intakes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_intakes_code" UNIQUE ("code"),
        CONSTRAINT "FK_intakes_shift" FOREIGN KEY ("shift_id")
          REFERENCES "shifts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_intakes_supplier" FOREIGN KEY ("supplier_id")
          REFERENCES "suppliers"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_intakes_received_by" FOREIGN KEY ("received_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_intakes_voided_by" FOREIGN KEY ("voided_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        -- §9.3 makes the REASON mandatory, which is why voiding is a trio of
        -- columns and not a status value.
        CONSTRAINT "CHK_intakes_void_trio"
          CHECK (num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3)),
        CONSTRAINT "CHK_intakes_amount" CHECK ("amount" >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_intakes_supplier_created" ON "intakes" ("supplier_id", "created_at")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_intakes_shift" ON "intakes" ("shift_id")`);

    // ---- intake_items ------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "intake_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "intake_id" uuid NOT NULL,
        "item_order" integer NOT NULL,
        "product_grade_id" uuid NOT NULL,
        "gross_kg" numeric(10,2) NOT NULL,
        "pallet_kg" numeric(10,2) NOT NULL DEFAULT 0,
        "tare_weight_kg" numeric(10,2) NOT NULL,
        "net_kg" numeric(10,2) NOT NULL,
        "price" numeric(10,2) NOT NULL,
        "bonus" numeric(10,2) NOT NULL DEFAULT 0,
        "amount" numeric(12,2) NOT NULL,
        CONSTRAINT "PK_intake_items" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_intake_items_order" UNIQUE ("intake_id", "item_order"),
        CONSTRAINT "FK_intake_items_intake" FOREIGN KEY ("intake_id")
          REFERENCES "intakes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_intake_items_grade" FOREIGN KEY ("product_grade_id")
          REFERENCES "product_grades"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_intake_items_gross_kg" CHECK ("gross_kg" > 0),
        CONSTRAINT "CHK_intake_items_pallet_kg" CHECK ("pallet_kg" >= 0),
        CONSTRAINT "CHK_intake_items_tare_weight_kg" CHECK ("tare_weight_kg" >= 0),
        CONSTRAINT "CHK_intake_items_net_kg" CHECK ("net_kg" > 0),
        CONSTRAINT "CHK_intake_items_price" CHECK ("price" >= 0),
        CONSTRAINT "CHK_intake_items_amount" CHECK ("amount" >= 0),
        CONSTRAINT "CHK_intake_items_order" CHECK ("item_order" > 0)
        -- NO CHECK ON "bonus". §2.8 — a negative bonus is «м'ята чи цвіла ягода».
      )
    `);

    // ---- intake_item_tare_types -------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "intake_item_tare_types" (
        "item_id" uuid NOT NULL,
        "tare_type_id" uuid NOT NULL,
        "units" integer NOT NULL,
        CONSTRAINT "PK_intake_item_tare_types" PRIMARY KEY ("item_id", "tare_type_id"),
        CONSTRAINT "FK_intake_item_tare_types_item" FOREIGN KEY ("item_id")
          REFERENCES "intake_items"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_intake_item_tare_types_tare" FOREIGN KEY ("tare_type_id")
          REFERENCES "tare_types"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_intake_item_tare_types_units" CHECK ("units" > 0)
      )
    `);

    // ---- payouts -----------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "payouts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" character varying NOT NULL,
        "shift_id" uuid NOT NULL,
        "supplier_id" uuid NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "paid_by_user_id" uuid NOT NULL,
        "voided_at" TIMESTAMP WITH TIME ZONE,
        "voided_by_user_id" uuid,
        "void_reason" text,
        "return_settled_at" TIMESTAMP WITH TIME ZONE,
        "return_settled_by_user_id" uuid,
        "return_note" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payouts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_payouts_code" UNIQUE ("code"),
        CONSTRAINT "FK_payouts_shift" FOREIGN KEY ("shift_id")
          REFERENCES "shifts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_payouts_supplier" FOREIGN KEY ("supplier_id")
          REFERENCES "suppliers"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_payouts_paid_by" FOREIGN KEY ("paid_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_payouts_voided_by" FOREIGN KEY ("voided_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_payouts_return_settled_by" FOREIGN KEY ("return_settled_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_payouts_void_trio"
          CHECK (num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3)),
        -- The return NOTE is optional, unlike void_reason. Two similar trios,
        -- two different rules: §9.3 demands a reason for a void and says
        -- nothing about annotating the cash coming back.
        CONSTRAINT "CHK_payouts_return_pair"
          CHECK (("return_settled_at" IS NULL) = ("return_settled_by_user_id" IS NULL)),
        -- §9.3 — «каса НЕ виросла на 8 000… інакше сторно стає способом красти».
        -- Money can only come BACK if it went out and the payout was voided.
        CONSTRAINT "CHK_payouts_return_requires_void"
          CHECK ("return_settled_at" IS NULL OR "voided_at" IS NOT NULL),
        -- Spec §8.6, stricter than §3.7: a zero payout is a receipt for handing
        -- over nothing.
        CONSTRAINT "CHK_payouts_amount" CHECK ("amount" > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_payouts_supplier_created" ON "payouts" ("supplier_id", "created_at")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_payouts_shift" ON "payouts" ("shift_id")`);
  }

  /**
   * Drops in dependency order. This WILL fail once `crate_issuances` or
   * `cash_counts` reference a shift — the safe direction, and the same posture
   * every earlier migration in this project takes.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "payouts"`);
    await queryRunner.query(`DROP TABLE "intake_item_tare_types"`);
    await queryRunner.query(`DROP TABLE "intake_items"`);
    await queryRunner.query(`DROP TABLE "intakes"`);
    await queryRunner.query(`DROP TABLE "shifts"`);
    await queryRunner.query(`DROP TYPE "shift_status"`);
    await queryRunner.query(
      `ALTER TABLE "collection_points" DROP CONSTRAINT "CHK_collection_points_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_points" DROP CONSTRAINT "UQ_collection_points_code"`,
    );
    await queryRunner.query(`ALTER TABLE "collection_points" DROP COLUMN "code"`);
  }
}
```

- [ ] **Step 4: Run the db-spec to verify it passes**

```bash
npm run test:db -w backend -- intakes-payouts-schema
```

All green. Then confirm the migration is reversible, which the earlier slices never checked and this one can:

```bash
npm run migration:revert -w backend && npm run migration:run -w backend
```

- [ ] **Step 5: Commit**

```bash
npm run lint -w backend
git add -A && git commit -m "feat(db): shifts, intakes, intake_items, tare lines and payouts"
```

---

## Task 4: `collection_points.code` — the API surface and the ripple

The migration made the column exist. This task makes it settable, and repairs the tests the `NOT NULL` broke.

**This task touches an already-shipped module.** It is a dependency of the receipt-code decision (spec §6.2.1), not an adjacent fix — without it the DBML's global `UNIQUE (code)` is unsatisfiable. Nothing else in `collection-points` changes.

**Files:**
- Modify: `backend/src/collection-points/collection-point.entity.ts`, `collection-point.mapper.ts`, `dto/create-collection-point.dto.ts`, `dto/update-collection-point.dto.ts`, `collection-points.service.ts`
- Modify (test repair): `backend/src/migrations/schema.db-spec.ts`, `catalog-schema.db-spec.ts`, `suppliers-prices-schema.db-spec.ts`, `backend/src/testing/pipeline.db-spec.ts`, `catalog-pipeline.db-spec.ts`, `backend/src/collection-points/collection-points.service.spec.ts`

**Interfaces:**
- Produces: `CollectionPoint.code`, present on `CollectionPointResponse`; `CollectionPointsService.findOneRaw` already exists and now returns the code. Consumed by `IntakesService` and `PayoutsService`.

- [ ] **Step 1: Extend the existing service spec first**

In `backend/src/collection-points/collection-points.service.spec.ts`, add cases that must fail:

```ts
it('upper-cases and trims the code on create', async () => {
  await service.create(owner, { name: 'Копайгород', code: ' kpg ' } as CreateCollectionPointDto);
  expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ code: 'KPG' }));
});

it('rejects a code the CHECK would reject', async () => {
  // The service pre-check exists to produce a FRIENDLY error; the CHECK is the
  // guarantee. Same division of labour as the catalog slice's name uniqueness.
  await expect(
    service.create(owner, { name: 'X', code: 'КПГ' } as CreateCollectionPointDto),
  ).rejects.toThrow(BadRequestException);
});

it('reports a taken code as a conflict, not a 500', async () => {
  repo.findOne.mockResolvedValueOnce({ id: 'other', code: 'KPG' } as CollectionPoint);
  await expect(
    service.create(owner, { name: 'X', code: 'KPG' } as CreateCollectionPointDto),
  ).rejects.toMatchObject({ response: { code: 'POINT_CODE_TAKEN' } });
});
```

- [ ] **Step 2: Write the column, DTO and service changes**

`collection-point.entity.ts` — add below `name`:

```ts
/**
 * The point's short identifier, and the first segment of every receipt code
 * written at this point: `KPG-IN-20260908-04412` (spec §6.2).
 *
 * NOT IN `28-db-schema.dbml`. It exists because the operator types the number
 * from the paper receipt book, and two points buying identical books both have
 * an «04412» — without a point segment the DBML's own global UNIQUE on
 * `intakes.code` refuses the second one mid-transaction with a car waiting.
 *
 * Upper ASCII alphanumeric only, `CHECK`-enforced, so a composed code survives
 * any encoding and matches `common/document-code.ts`'s alphabet exactly. The
 * two must agree; changing one without the other writes codes the database
 * then rejects.
 *
 * MUTABLE, deliberately. Renaming a point's code does NOT rewrite the codes on
 * documents already written — those are frozen strings, not a join — so the
 * only cost of a rename is that old and new receipts read differently. That is
 * true of paper receipt books too.
 */
@Column({ type: 'varchar' })
code: string;
```

Plus `@Unique('UQ_collection_points_code', ['code'])` and
`@Check('CHK_collection_points_code', `"code" ~ '^[A-Z0-9]{2,8}$'`)` on the class.

`dto/create-collection-point.dto.ts` — **required**:

```ts
@IsString()
@Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value,
)
@Matches(/^[A-Z0-9]{2,8}$/, {
  message: 'code must be 2–8 characters, letters A–Z and digits only',
})
code: string;
```

`dto/update-collection-point.dto.ts` — the same field, `@IsOptional()`.

**Required rather than optional-with-a-default, and this is the choice to revisit if the ripple below proves annoying.** A generated `P07` would end up printed on a supplier's receipt with nobody ever having been asked; creating a point is a rare, owner-only act and is the right moment to ask. The alternative — a sequence default on the column — is a smaller diff and a worse receipt.

`collection-points.service.ts` — mirror the existing `assertNameFree` with an `assertCodeFree`, and include `code` in `POINT_FIELDS` so a change lands in the audit diff.

- [ ] **Step 3: Repair the tests the NOT NULL broke**

This is mechanical and must be done in one pass, or later tasks fail for reasons unrelated to their own code.

Raw inserts — add a `code` column with a per-run unique value (these files already build one from `randomUUID()`):

- `backend/src/migrations/schema.db-spec.ts`
- `backend/src/migrations/catalog-schema.db-spec.ts`
- `backend/src/migrations/suppliers-prices-schema.db-spec.ts`

HTTP creations — add `code` to each `POST /collection-points` body (9 call sites):

- `backend/src/testing/pipeline.db-spec.ts` (lines ~189, ~217, ~268, ~417, ~424)
- `backend/src/testing/catalog-pipeline.db-spec.ts` (lines ~62, ~179, ~189)

Codes must be unique per run. Use a short slice of the existing run uuid, upper-cased, e.g. `` `P${run.slice(0, 4).toUpperCase()}` ``.

- [ ] **Step 4: Run everything, lint, commit**

```bash
npm test -w backend && npm run test:db -w backend && npm run lint -w backend
git add -A && git commit -m "feat(points): short code, the first segment of every receipt code"
```

Both suites must be fully green here. Do not carry a red test into Task 5.

---

## Task 5: `shifts` domain — enum, entity, DTOs, mapper, service

The container. No cash, no reconciliation, no discrepancy.

**Files:**
- Create: `backend/src/shifts/shift-status.enum.ts`, `shift.entity.ts`, `shift.mapper.ts`, `dto/reopen-shift.dto.ts`, `dto/list-shifts.query.ts`, `dto/current-shift.query.ts`, `shifts.service.ts`
- Test: `backend/src/shifts/shifts.service.spec.ts`
- Modify: `backend/src/audit/audit-log.entity.ts`, `backend/src/auth/access/point-scope.ts`

**Interfaces:**
- Consumes: `CollectionPointsService.findOneRaw`, `TimeService.now()`, `AuditService.record`.
- Produces: `ShiftsService` with `open`, `close`, `reopen`, `list`, `findOne`, and two seams used by Tasks 9 and 12 — `findOpenAtPoint(pointId, manager?)` and `findOneRaw(id, manager?)`.

- [ ] **Step 1: Add the eight audit actions and the shared `resolveWritePoint`**

Append the actions listed in Global Constraints to `AUDIT_ACTIONS`.

In `backend/src/auth/access/point-scope.ts`, export the rule `SuppliersService` currently keeps private, so three new services do not each re-derive it:

```ts
/**
 * The point a WRITE lands on. An operator's comes from their token and a body
 * value naming another point is refused by `assertOwnsPoint`; an owner has no
 * point of their own, so they must name one.
 *
 * Lifted here from `SuppliersService`, which grew it first, for the reason this
 * module's own header gives: keeping the rule in one place «stops four
 * endpoints each implementing the rule slightly differently», and this slice
 * adds three more endpoints that need it.
 */
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
```

Leave `SuppliersService`'s private copy alone — switching it over is a follow-up (Task 14), not this slice's business.

- [ ] **Step 2: Write the failing service spec**

Create `backend/src/shifts/shifts.service.spec.ts`. The cases that matter, each named for the rule it protects:

```ts
describe('ShiftsService', () => {
  // ... standard mocked-repository harness, mirroring suppliers.service.spec.ts

  describe('open', () => {
    it('derives business_date from TimeService in the app zone, not from the body', async () => {
      // foundation §5.2 — server-derived, never editable. The DTO has no such
      // field; this proves the value comes from the clock service and that a
      // smuggled body key is ignored.
      time.now.mockReturnValue(DateTime.fromISO('2026-09-08T23:30', { zone: 'Europe/Kyiv' }));
      await service.open(operator);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ business_date: '2026-09-08' }),
      );
    });

    it('files a 23:30 Kyiv document under that day, not the UTC next day', async () => {
      // The whole reason APP_TIMEZONE is load-bearing from this slice onward.
      time.now.mockReturnValue(DateTime.fromISO('2026-09-08T23:30', { zone: 'Europe/Kyiv' }));
      await service.open(operator);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ business_date: '2026-09-08' }),
      );
    });

    it('always takes the point from the operator token', async () => {
      // §10.3 — the owner has no open verb at all, so there is no body point to
      // validate and no `resolveWritePoint` call here — nor any DTO at all.
      await service.open(operator);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ collection_point_id: operator.collection_point_id }),
      );
    });

    it('is refused to the owner', async () => {
      // §10.3 — «Відкрити чужий робочий день і закрити його за людину нема кому,
      // а підпис під зведеною касою мусить належати тому, хто цю касу тримав у
      // руках». Enforced by @Auth(PointOperator) at the controller, asserted at
      // the HTTP level in Task 6; here only to document that the service has no
      // owner branch to reach.
      expect(typeof (service as unknown as { resolveWritePoint?: unknown }).resolveWritePoint)
        .toBe('undefined');
    });

    it('translates a 23505 on the partial index into a readable 409', async () => {
      repo.save.mockRejectedValue({ code: '23505', constraint: 'UQ_shifts_open_per_point' });
      await expect(service.open(operator)).rejects.toMatchObject({
        response: { code: 'SHIFT_ALREADY_OPEN' },
      });
    });

    it('translates a 23505 on the day index into a DIFFERENT 409', async () => {
      // Two constraints, two causes, two remedies: close the open one, versus
      // ask the owner to reopen today's. One message for both would send the
      // operator down the wrong path.
      repo.save.mockRejectedValue({ code: '23505', constraint: 'UQ_shifts_point_business_date' });
      await expect(service.open(operator)).rejects.toMatchObject({
        response: { code: 'SHIFT_DAY_ALREADY_USED' },
      });
    });

    it('audits shift.opened', async () => { /* … */ });
  });

  describe('close', () => {
    it('stamps closed_at, closed_by and status', async () => { /* … */ });
    it('409s an already closed shift', async () => { /* … */ });
    it('404s another point’s shift for an operator', async () => { /* … */ });
    it('is refused to the owner', async () => { /* §10.3, @Auth(PointOperator) */ });
    it('closes a stale shift from a previous day without complaint', async () => {
      // The forgotten-close path: Friday's shift closed on Saturday morning.
      // No business_date check anywhere in close — that is what makes it work.
    });
    it('writes NO explanation and never sets awaiting_explanation', async () => {
      // The dead-state guarantee. If this ever fails, someone wired a
      // discrepancy path in ahead of cash_counts.
      await service.close(operator, SHIFT_ID);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ShiftStatus.Closed, explanation: null }),
      );
    });
  });

  describe('reopen', () => {
    it('is refused for an operator at their own point', async () => {
      // The one shift verb that INVERTS the §10.3 rule, and deliberately: a
      // reopen is a correction, and §10.2 gives corrections to the owner.
      await expect(service.reopen(operator, SHIFT_ID, { reason: 'помилка' })).rejects.toThrow(
        ForbiddenException,
      );
    });
    it('requires a reason', async () => { /* DTO-level, asserted in the HTTP test */ });
    it('409s when another shift is already open at that point', async () => { /* … */ });
    it('409s when the target is not the point’s newest shift', async () => {
      // Reopening an older day would create a second open shift the moment the
      // newest one is reopened too, and would let documents land on a day the
      // point has already moved past.
    });
    it('clears closed_at and closed_by and audits with the reason', async () => { /* … */ });
  });

  describe('findOpenAtPoint', () => {
    it('returns null rather than throwing when nothing is open', async () => {
      // Callers turn this into a 409 with their own message; a null keeps the
      // seam usable by both document services.
    });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
npm test -w backend -- shifts.service.spec
```

- [ ] **Step 4: Write the enum, entity and mapper**

`shift-status.enum.ts`:

```ts
/**
 * Mirrors the `shift_status` Postgres type exactly.
 *
 * `AwaitingExplanation` IS UNREACHABLE IN THIS SLICE and that is not an
 * oversight. It exists solely to express a cash discrepancy; a discrepancy is
 * `counted − expected`, and `expected` comes from a five-table formula over
 * `transfers`, `payouts`, `crate_issuances`, `crate_returns` and `intakes`.
 * Three of those five do not exist. It stays here and in the database type so
 * the `cash_counts` slice needs no migration — see spec §2.1 and §9.
 */
export enum ShiftStatus {
  Open = 'open',
  AwaitingExplanation = 'awaiting_explanation',
  Closed = 'closed',
}
```

`shift.entity.ts` — declare every constraint the migration wrote, with the header recording the four deliberate absences (no `void_*`, no `opened_at`, no cash columns, `explanation` unwritten) and the §8.1 pairing between `UQ_shifts_point_business_date` and the reopen route.

`business_date` is `@Column({ type: 'date' })` typed **`string`**. A `Date` here silently reintroduces a timezone into a column that has none.

`shift.mapper.ts` → `ShiftResponse { id, collection_point_id, business_date, status, opened_by_user_id, closed_by_user_id, closed_at, created_at }`.

- [ ] **Step 5: Write the DTOs**

- **There is no `open-shift.dto.ts`.** `POST /shifts` takes **no body at all**: `business_date` is server-derived (foundation §5.2) and the point comes from the operator's token (§10.3), which leaves nothing for a caller to send. Record in the controller doc comment that the route is nonetheless **provisional in shape** — §07:30 plus the 03.09.2026 schema note give it two opening cash counts as soon as `cash_counts` lands, and that is when a DTO appears.
- `reopen-shift.dto.ts` — `reason: string`, `@IsString()` + `assertTrimmedName`-style non-empty check. Mandatory, mirroring §9.3's posture on void reasons even though a shift is not voided.
- `list-shifts.query.ts` — extends `PaginationQueryDto`; `collection_point_id?`, `status?` (`@IsEnum(ShiftStatus)`), `from?`/`to?` as `YYYY-MM-DD` `@Matches`.
- `current-shift.query.ts` — `collection_point_id?` only.

- [ ] **Step 6: Write the service**

Key shapes, in full where they are not obvious:

```ts
async open(actor: AuthenticatedUser): Promise<ShiftResponse> {
  // §10.3 — operator only, so the point is the actor's and there is nothing to
  // validate: the users FK already guarantees it exists. No `resolveWritePoint`,
  // no body point, no 404 branch. `CHK_users_role_point` guarantees a
  // point_operator has one; the guard guarantees the actor is one.
  const pointId = actor.collection_point_id!;

  // foundation §5.2 — server-derived, never editable, no backdating path.
  // `toISODate()` on a zone-aware DateTime gives the LOCAL calendar day, which
  // is the whole point: 23:30 on the 8th in Kyiv is the 8th, not the 9th.
  const business_date = this.time.now().toISODate();

  try {
    const shift = await this.repo.save(
      this.repo.create({
        collection_point_id: pointId,
        opened_by_user_id: actor.id,
        business_date,
        status: ShiftStatus.Open,
      }),
    );
    await this.audit.record({ action: 'shift.opened', actor_id: actor.id, /* … */ });
    return toShiftResponse(shift);
  } catch (error) {
    // TWO CONSTRAINTS, TWO REMEDIES. «Close the open shift first» and «ask the
    // owner to reopen today's shift» are different instructions, and the
    // operator cannot guess which applies from a generic duplicate-key error.
    throw this.translateUniqueViolation(error);
  }
}
```

`close` loads the shift, applies `assertOwnsPoint`, 409s if `closed_at` is set, then stamps `closed_at`, `closed_by_user_id` and `ShiftStatus.Closed`. **It must not read `business_date`** — that is what makes the forgotten-close path work. Operator-only, like `open` (§10.3); `assertOwnsPoint` still runs, because an operator must not close another point's shift even though the guard has already established they are an operator.

`reopen` is owner-only at the controller, and additionally verifies (a) no other open shift at the point, (b) the target is the point's newest shift by `business_date`. Both are 409s. It clears `closed_at`/`closed_by_user_id`, sets `ShiftStatus.Open`, and records `shift.reopened` with the reason in `note`.

`findOpenAtPoint(pointId, manager?)` returns `Shift | null` and accepts an `EntityManager` so a document write reads it inside its own transaction.

- [ ] **Step 7: Run, lint, commit**

```bash
npm test -w backend -- shifts.service.spec && npm run lint -w backend
git add -A && git commit -m "feat(shifts): open, close and owner-only reopen"
```

---

## Task 6: `shifts` HTTP surface

**Files:**
- Create: `backend/src/shifts/shifts.controller.ts`, `shifts.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: a new `describe` block in `backend/src/testing/documents-pipeline.db-spec.ts` (created here, extended in Tasks 10 and 13)

- [ ] **Step 1: Write the failing HTTP test**

Create `backend/src/testing/documents-pipeline.db-spec.ts` with the shift half of the walk: an owner creates a point and an operator; the operator opens a shift; a second open is a 409; `GET /shifts/current` returns it; the operator cannot reopen; the owner can; a closed shift's `GET /shifts/current` is a 404.

Mirror the bootstrap and login helpers already in `catalog-pipeline.db-spec.ts` rather than inventing new ones.

Three assertions worth stating explicitly, because they are the slice's role boundaries:

```ts
it('refuses the OWNER the open verb entirely', async () => {
  // §10.3 — «Тільки приймальник — і це не помилка». The owner has no point of
  // their own, so there is no shift for them to open, and that is the intended
  // outcome rather than a gap. This is the test that fails first if someone
  // "helpfully" restores the body collection_point_id.
  await request(app.getHttpServer())
    .post('/shifts')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ collection_point_id: pointId })
    .expect(403);
});

it('refuses reopen to the operator who closed it', async () => {
  await request(app.getHttpServer())
    .post(`/shifts/${shiftId}/reopen`)
    .set('Authorization', `Bearer ${operatorToken}`)
    .send({ reason: 'закрив помилково' })
    .expect(403);
});

it('refuses reopen with no reason even to the owner', async () => {
  await request(app.getHttpServer())
    .post(`/shifts/${shiftId}/reopen`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({})
    .expect(400);
});
```

- [ ] **Step 2: Run it to verify it fails, then write the controller and module**

`shifts.controller.ts` — six thin handlers. `@Auth()` on all but `reopen`, which is `@Auth(UserRole.NetworkOwner)`.

**Route order matters here.** `GET /shifts/current` must be declared **before** `GET /shifts/:id`, or `current` is swallowed as a uuid param and returns a `ParseUUIDPipe` 400. Put a comment on it saying so.

The controller doc comment records what this module deliberately does not do: no cash, no discrepancy, no `explanation`, and `close` is a timestamp rather than a reconciliation — with a pointer to spec §2.1 for why.

`shifts.module.ts` imports `TypeOrmModule.forFeature([Shift])`, `AuditModule`, `CollectionPointsModule`, and **exports `ShiftsService`** — Tasks 9 and 12 depend on that export.

- [ ] **Step 3: Register, run both suites, lint, commit**

```bash
npm test -w backend && npm run test:db -w backend && npm run lint -w backend
git add -A && git commit -m "feat(shifts): HTTP surface"
```

---

## Task 7: `intake-lines.ts` — every computation in the slice, in one pure module

The highest-value file here. It is pure so that §2.4's ordering, §2.8's rounding and §2.9's clamp are provable in milliseconds without a database, a Nest context or a mock.

**Files:**
- Create: `backend/src/intakes/intake-lines.ts`
- Test: `backend/src/intakes/intake-lines.spec.ts`

**Interfaces:**
- Consumes: `common/money.ts`.
- Produces: `buildIntake(inputs, prices, tareTypes)` → `{ amount, items }`. Consumed only by `IntakesService` (Task 9).

- [ ] **Step 1: Write the failing test**

Create `backend/src/intakes/intake-lines.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { buildIntake, type PriceSnapshot, type TareSnapshot } from './intake-lines';

const GRADE = 'grade-1';
const CRATE = 'tare-crate';
const BUCKET = 'tare-bucket';

const prices = (over: Partial<PriceSnapshot> = {}): Map<string, PriceSnapshot> =>
  new Map([
    [GRADE, { base_price: '57.00', max_markup: '30.00', max_discount: '20.00', ...over }],
  ]);

const tare = (): Map<string, TareSnapshot> =>
  new Map([
    [CRATE, { id: CRATE, weight_kg: '1.20' }],
    [BUCKET, { id: BUCKET, weight_kg: '0.50' }],
  ]);

const line = (over = {}) => ({
  product_grade_id: GRADE,
  gross_kg: '42.00',
  pallet_kg: '1.50',
  bonus: '0.00',
  tare: [{ tare_type_id: CRATE, units: 3 }],
  ...over,
});

describe('buildIntake', () => {
  describe('§2.4 — pallet FIRST, tare second', () => {
    it('computes net as (gross − pallet) − tare', () => {
      const built = buildIntake([line()], prices(), tare());
      expect(built.items[0].tare_weight_kg).toBe('3.60'); // 3 × 1.20
      expect(built.items[0].net_kg).toBe('36.90'); // (42.00 − 1.50) − 3.60
    });

    /**
     * THIS TEST IS THE WHOLE REASON THE ORDER IS WRITTEN DOWN. Subtraction is
     * associative, so with these numbers the other order gives the same net —
     * and a reviewer concludes the rule does not matter. It matters at the
     * boundary: only one order can ever produce an intermediate the CHECK sees.
     * The assertion is on the ORDER OF OPERATIONS being observable, via a
     * pallet that alone exceeds the gross.
     */
    it('refuses a pallet heavier than the gross before tare is even considered', () => {
      expect(() =>
        buildIntake([line({ gross_kg: '1.00', pallet_kg: '2.00' })], prices(), tare()),
      ).toThrow(BadRequestException);
    });
  });

  describe('§2.5 — tare weight is substituted, never typed', () => {
    it('sums units × weight across several tare types on one line', () => {
      const built = buildIntake(
        [
          line({
            tare: [
              { tare_type_id: CRATE, units: 3 },
              { tare_type_id: BUCKET, units: 2 },
            ],
          }),
        ],
        prices(),
        tare(),
      );
      expect(built.items[0].tare_weight_kg).toBe('4.60'); // 3×1.20 + 2×0.50
    });

    /**
     * REVERSED after reading 26-rules-by-example.md. An earlier draft asserted
     * that an empty tare list is ACCEPTED. §9.1 lists «позиція без тари» under
     * «Заборонено — система не дає провести взагалі», and §9.2 prices the
     * mistake: 115 crates × 1,20 кг = 138 кг × 145 ₴ = 20 010,00 ₴ handed over
     * for air, «завжди на користь здавальника».
     *
     * The refusal lives in the DTO (@ArrayMinSize(1)), so this module never
     * sees an empty list from the HTTP path — but it is called directly by
     * tests and could be called directly by a future job, so it refuses too.
     *
     * THE SOURCE CONTRADICTS ITSELF: §9.2 lists the same case as a WARNING.
     * Spec §10.2 records the conflict and why the strict reading was taken.
     */
    it('refuses a line with no tare at all', () => {
      expect(() => buildIntake([line({ tare: [] })], prices(), tare())).toThrow(/tare/i);
    });

    it('rejects an unknown tare type rather than silently weighing nothing', () => {
      expect(() =>
        buildIntake([line({ tare: [{ tare_type_id: 'ghost', units: 1 }] })], prices(), tare()),
      ).toThrow(/tare/i);
    });
  });

  describe('§2.8 — price snapshot and the per-line bonus', () => {
    it('uses the snapshotted base price and adds the bonus to the RATE', () => {
      const built = buildIntake([line({ bonus: '3.00' })], prices(), tare());
      expect(built.items[0].price).toBe('57.00'); // snapshot, unchanged
      expect(built.items[0].bonus).toBe('3.00');
      expect(built.items[0].amount).toBe('2214.00'); // 36.90 × 60.00
    });

    it('accepts a negative bonus — «м’ята чи цвіла ягода»', () => {
      const built = buildIntake([line({ bonus: '-5.00' })], prices(), tare());
      expect(built.items[0].amount).toBe('1918.80'); // 36.90 × 52.00
    });

    it('carries a DIFFERENT bonus on each line of one document', () => {
      // §2.8 — «надбавка живе ОКРЕМО, у bonus НА РЯДКУ, а не на людині: одна
      // людина може здати два сорти з різними надбавками».
      const built = buildIntake(
        [line({ bonus: '3.00' }), line({ bonus: '-2.00' })],
        prices(),
        tare(),
      );
      expect(built.items[0].bonus).toBe('3.00');
      expect(built.items[1].bonus).toBe('-2.00');
    });

    it('throws when the grade has no price row at this point (§4.5)', () => {
      expect(() => buildIntake([line()], new Map(), tare())).toThrow(/price/i);
    });
  });

  describe('§2.9 — the clamp the prices slice built columns for', () => {
    it.each([
      ['30.00', true],
      ['30.01', false],
      ['-20.00', true],
      ['-20.01', false],
    ])('bonus %s is accepted: %s', (bonus, ok) => {
      const run = () => buildIntake([line({ bonus })], prices(), tare());
      if (ok) expect(run).not.toThrow();
      else expect(run).toThrow(/bonus/i);
    });

    /**
     * THE MESSAGE MUST CARRY THE NUMBER, and this test is the reason to keep it
     * that way. §2.10 («межа працює як обмеження, а не як підказка») reads like
     * a rule that the limit must never be shown, and an earlier draft of the
     * spec treated it as one. It is a UI/UX recommendation about the resting
     * state of the screen — the limit is not secret, the owner sees it, and it
     * is surfaced precisely when someone exceeds it (owner's clarification,
     * 2026-09-08). A 400 the operator cannot act on is the worse outcome.
     */
    it('names the permitted range in the message', () => {
      expect(() => buildIntake([line({ bonus: '35.00' })], prices(), tare())).toThrow(
        /-20\.00.*30\.00|30\.00.*-20\.00/,
      );
    });

    /**
     * The clamp alone does NOT close this. `max_discount` is an independent
     * magnitude, so a cheap grade admits a legal bonus that drives the
     * effective rate below zero — and a negative rate on a positive weight is a
     * document that TAKES money from the supplier for delivering berries.
     */
    it('refuses a legal bonus that still makes price + bonus negative', () => {
      const cheap = prices({ base_price: '10.00' });
      expect(() => buildIntake([line({ bonus: '-15.00' })], cheap, tare())).toThrow(/rate/i);
    });
  });

  describe('§2.3 — the document total', () => {
    it('is Σ of the ROUNDED line amounts, in line order', () => {
      const built = buildIntake([line(), line({ bonus: '3.00' })], prices(), tare());
      expect(built.items.map((i) => i.item_order)).toEqual([1, 2]);
      expect(built.amount).toBe('4317.30'); // 2103.30 + 2214.00
    });

    it('produces Σ round(each), not round(Σ)', () => {
      // Three lines each landing exactly on a half-kopiyka. Rounding once at
      // the end gives a different number from the one printed on the paper.
      const halves = prices({ base_price: '0.05', max_markup: '0.00', max_discount: '0.00' });
      const tiny = () =>
        line({ gross_kg: '0.10', pallet_kg: '0.00', bonus: '0.00', tare: [] });
      const built = buildIntake([tiny(), tiny(), tiny()], halves, tare());
      expect(built.items.map((i) => i.amount)).toEqual(['0.01', '0.01', '0.01']);
      expect(built.amount).toBe('0.03'); // round(0.0150) would be 0.02
    });
  });

  describe('net weight', () => {
    it('refuses a net of exactly zero', () => {
      expect(() =>
        buildIntake([line({ gross_kg: '3.60', pallet_kg: '0.00' })], prices(), tare()),
      ).toThrow(/net/i);
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm test -w backend -- intake-lines.spec
```

- [ ] **Step 3: Write the implementation**

Create `backend/src/intakes/intake-lines.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { add, gt, lt, lte, mul, sub, sum } from '../common/money';

/**
 * EVERY ARITHMETIC OPERATION IN THIS SLICE HAPPENS HERE, and nothing here
 * touches a database, a repository or a Nest context. That is deliberate: §2.4,
 * §2.8 and §2.9 are the rules most expensive to get wrong — a wrong `amount` is
 * frozen forever by §2.7 and printed on the supplier's copy — and they are
 * provable in milliseconds only if they live somewhere pure.
 *
 * The caller resolves the snapshots (current price per grade, weight per tare
 * type) and hands them in as maps. This module decides nothing about WHERE a
 * price comes from; it only refuses to proceed without one.
 */

export interface PriceSnapshot {
  base_price: string;
  max_markup: string;
  max_discount: string;
}

export interface TareSnapshot {
  id: string;
  weight_kg: string;
}

export interface IntakeLineInput {
  product_grade_id: string;
  gross_kg: string;
  pallet_kg: string;
  bonus: string;
  tare: { tare_type_id: string; units: number }[];
}

export interface BuiltLine {
  item_order: number;
  product_grade_id: string;
  gross_kg: string;
  pallet_kg: string;
  tare_weight_kg: string;
  net_kg: string;
  price: string;
  bonus: string;
  amount: string;
  tare: { tare_type_id: string; units: number }[];
}

export interface BuiltIntake {
  amount: string;
  items: BuiltLine[];
}

const bad = (message: string, code: string): never => {
  throw new BadRequestException({ message, code });
};

export function buildIntake(
  inputs: IntakeLineInput[],
  prices: Map<string, PriceSnapshot>,
  tareTypes: Map<string, TareSnapshot>,
): BuiltIntake {
  const items = inputs.map((input, index) => buildLine(input, index + 1, prices, tareTypes));
  // §2.3 — `amount` is «те саме число, що надруковане на папері», and the paper
  // shows the lines above the total. Summing the ROUNDED line amounts is what
  // makes the printed total equal the printed lines; see money.spec.ts.
  return { amount: sum(items.map((i) => i.amount)), items };
}

function buildLine(
  input: IntakeLineInput,
  item_order: number,
  prices: Map<string, PriceSnapshot>,
  tareTypes: Map<string, TareSnapshot>,
): BuiltLine {
  // §4.5 — «сорт без ціни дня на прийомці не показується взагалі». Enforced as
  // a refusal rather than left as a hope about what the client rendered.
  const price = prices.get(input.product_grade_id);
  if (!price) {
    bad(
      `No current price for grade ${input.product_grade_id} at this point`,
      'GRADE_NOT_PRICED',
    );
  }

  // §9.1 — «позиція без тари» is among the things the system «не дає провести
  // взагалі»: «Вкажіть кількість тари — без неї брутто пішло б у чисту вагу
  // цілком». §9.2 prices the omission at 20 010,00 ₴ on one 701.5 kg line, and
  // notes it is «завжди на користь здавальника» — the error only ever runs one
  // way. The DTO refuses this first; this is the guard for any non-HTTP caller.
  if (input.tare.length === 0) {
    bad('every line must record its tare — without it the gross weight becomes net', 'TARE_REQUIRED');
  }

  // §2.5 — «вага тари підставляється сама». Never typed, always derived from
  // the tare lines the same request carries.
  const tare_weight_kg = sum(
    input.tare.map((t) => {
      const type = tareTypes.get(t.tare_type_id);
      if (!type) bad(`Unknown or inactive tare type ${t.tare_type_id}`, 'TARE_TYPE_UNKNOWN');
      // `units` is an integer; money.mul parses an integer string exactly.
      return mul(type!.weight_kg, String(t.units));
    }),
  );

  // §2.9 — the clamp. The prices slice added max_markup and max_discount for
  // exactly this and recorded that «nothing in this slice reads them». This is
  // the reader. Both are POSITIVE MAGNITUDES: markup 30 means bonus <= +30,
  // discount 20 means bonus >= −20.
  const floor = sub('0', price!.max_discount);
  if (gt(input.bonus, price!.max_markup) || lt(input.bonus, floor)) {
    bad(
      `bonus must be between ${floor} and ${price!.max_markup} for this grade`,
      'BONUS_OUT_OF_RANGE',
    );
  }

  // §2.4 — PALLET FIRST, TARE SECOND. net = (gross − pallet) − tare.
  const net_kg = sub(sub(input.gross_kg, input.pallet_kg), tare_weight_kg);
  if (lte(net_kg, '0.00')) {
    bad(
      `net weight must be greater than 0 (gross ${input.gross_kg} − pallet ${input.pallet_kg} − tare ${tare_weight_kg} = ${net_kg})`,
      'NET_WEIGHT_NOT_POSITIVE',
    );
  }

  // A legal bonus can still drive the rate below zero on a cheaply priced
  // grade, because max_discount is an independent magnitude rather than a
  // fraction of the price. A negative rate on a positive weight is a document
  // that takes money FROM the supplier for delivering berries.
  const rate = add(price!.base_price, input.bonus);
  if (lt(rate, '0.00')) {
    bad(`price + bonus must not be negative (${price!.base_price} + ${input.bonus})`, 'RATE_NEGATIVE');
  }

  return {
    item_order,
    product_grade_id: input.product_grade_id,
    gross_kg: input.gross_kg,
    pallet_kg: input.pallet_kg,
    tare_weight_kg,
    net_kg,
    price: price!.base_price,
    bonus: input.bonus,
    amount: mul(net_kg, rate),
    tare: input.tare,
  };
}
```

- [ ] **Step 4: Run, lint, commit**

```bash
npm test -w backend -- intake-lines.spec && npm run lint -w backend
git add -A && git commit -m "feat(intakes): pure line computation — §2.4, §2.8, §2.9"
```

---

## Task 8: Read seams on `grade-prices` and `tare-types`

Two narrow methods on modules that already exist. No write path is added to either.

**Files:**
- Modify: `backend/src/grade-prices/grade-prices.service.ts`, `backend/src/tare-types/tare-types.service.ts`
- Test: extend both existing service specs

- [ ] **Step 1: Extend the existing specs**

`grade-prices.service.spec.ts`:

```ts
describe('currentFor', () => {
  it('returns the NEWEST row for the pair', async () => { /* … */ });
  it('returns null for a pair that has never been priced', async () => { /* … */ });
  it('ignores a price for the SAME grade at a DIFFERENT point', async () => {
    // §4.8 — the склад runs its own, higher list. Keying on the grade alone
    // would let a warehouse price leak onto a roadside intake.
  });
  it('returns null when the grade is inactive', async () => {
    // §4.5 — a retired grade is not offered at intake, and the intake path has
    // no other place to learn that.
  });
});
```

`tare-types.service.spec.ts`:

```ts
describe('findManyRaw', () => {
  it('returns only ACTIVE types', async () => { /* deactivation must stop something */ });
  it('returns fewer rows than ids asked for, silently — the caller decides', async () => {
    // buildIntake turns the gap into TARE_TYPE_UNKNOWN with the id in it; this
    // seam does not guess at an error message for a caller it cannot see.
  });
});
```

- [ ] **Step 2: Implement both**

`GradePricesService.currentFor(pointId, gradeId)` reuses the `DISTINCT ON` shape already in `current()`, narrowed to one pair and joined to `product_grades` for `is_active`. Return the entity or `null`.

`TareTypesService.findManyRaw(ids)` → `repo.find({ where: { id: In(ids), is_active: true } })`.

Both accept an optional `EntityManager` so the intake transaction reads them inside itself.

- [ ] **Step 3: Run, lint, commit**

```bash
npm test -w backend && npm run lint -w backend
git add -A && git commit -m "feat(catalog): narrow read seams for the intake path"
```

---

## Task 9: `intakes` domain — entities, DTOs, mapper, service

**Files:**
- Create: `backend/src/intakes/intake.entity.ts`, `intake-item.entity.ts`, `intake-item-tare-type.entity.ts`, `intake.mapper.ts`, `dto/create-intake.dto.ts`, `dto/void-document.dto.ts`, `dto/list-intakes.query.ts`, `intakes.service.ts`
- Test: `backend/src/intakes/intakes.service.spec.ts`

**Interfaces:**
- Consumes: `ShiftsService.findOpenAtPoint`, `SuppliersService.findOne`, `GradePricesService.currentFor`, `TareTypesService.findManyRaw`, `CollectionPointsService.findOneRaw`, `buildIntake`, `composeDocumentCode`, `AuditService`.
- Produces: `IntakesService` with `create`, `void`, `list`, `findOne`.

- [ ] **Step 1: Write the failing service spec**

The cases, each named for its rule:

```ts
describe('create', () => {
  it('resolves the point from the operator token and the shift from the point', async () => {});
  it('409s when no shift is open at that point', async () => {
    // Not «closed shift» — «no OPEN shift». The two are the same refusal and
    // one message covers both, because the remedy is identical: open one.
    await expect(service.create(operator, dto)).rejects.toMatchObject({
      response: { code: 'NO_OPEN_SHIFT' },
    });
  });
  it('404s a supplier belonging to another point', async () => {});
  it('400s an inactive supplier', async () => {});
  it('composes the code from point code, IN, the SHIFT business date, and the typed number', async () => {
    expect(saved.code).toBe('KPG-IN-20260908-04412');
  });
  it('translates a duplicate code into a 409 naming the day', async () => {
    // The ONLY collision the composed code allows is same point + same day +
    // same typed number, which is a genuine double entry. The message must say
    // so, or the operator retypes the same number.
  });
  it('writes items in order with item_order starting at 1', async () => {});
  it('writes the tare lines for each item', async () => {});
  it('stores amount as Σ of the line amounts', async () => {});
  it('rolls the WHOLE document back if any line fails', async () => {
    // One visit is ONE document (§2.3). A partially written intake is a
    // receipt that does not match the paper.
  });
  it('audits intake.created with the composed code', async () => {});
});

describe('void', () => {
  it('lets an operator void THEIR OWN intake while the shift is OPEN', async () => {});
  it('403s an operator voiding a COLLEAGUE’s intake in the same open shift', async () => {
    // §9.4 — «чужа квитанція → приймальник НІКОЛИ, навіть на своїй точці і в ту
    // саму зміну». Not hypothetical: §10.6 describes Оксана leaving her account
    // at 14:00 and Марія entering hers at 14:01, both signing receipts inside
    // ONE shift at ONE point. A point-scoped rule lets Марія void Оксана's.
    intake.received_by_user_id = OTHER_OPERATOR_ID;
    await expect(service.void(operator, INTAKE_ID, { reason: 'помилка' })).rejects.toThrow(
      ForbiddenException,
    );
  });
  it('403s an operator once the shift is closed', async () => {
    // The freeze line, and §9.4's second row: «квитанція минулого дня → тільки
    // керівник». Same line a PATCH would have used, reused for the one mutating
    // verb that survived.
  });
  it('lets the owner void a closed shift’s intake, and a colleague’s', async () => {});
  it('404s an intake at another point for an operator', async () => {});
  it('409s an already-voided intake', async () => {});
  it('requires a reason', async () => {});
  it('does NOT refuse a void that drives the supplier’s debt negative', async () => {
    // «сторно КВИТАНЦІЇ ЄДИНИЙ шлях у мінус, і воно ДОЗВОЛЕНЕ, з
    // попередженням». There is no floor check here and adding one would
    // contradict the schema outright.
  });
});

describe('list', () => {
  it('includes voided documents by default and flags them', async () => {
    // §9.3 — «лишається в журналі назавжди». The journal is the default view.
  });
  it('hides them with include_voided=false', async () => {});
  it('scopes an operator to their own point via the shift join', async () => {
    // intakes has NO collection_point_id. The scope is a JOIN, which is the
    // one thing about this table that will trip up every later query.
  });
});
```

- [ ] **Step 2: Write the entities**

Three entities. `IntakeItem.tare` and `Intake.items` are `@OneToMany` with `cascade: ['insert']` so one `save` writes the aggregate, and **`eager: false`** — an eagerly loaded relation is how a list endpoint quietly becomes N+1.

`IntakeItemTareType` uses two `@PrimaryColumn()`s for the composite key.

The `Intake` header records that the point and business date are **not** columns and must be reached through `shift_id`, with the reason (§2.3, «точка й бізнес-дата беруться зі зміни»), and that `amount` never changes after insert.

- [ ] **Step 3: Write the DTOs**

`create-intake.dto.ts`:

```ts
class CreateIntakeTareDto {
  @IsUUID() tare_type_id: string;
  @IsInt() @Min(1) units: number;
}

class CreateIntakeItemDto {
  @IsUUID() product_grade_id: string;

  @Matches(/^\d{1,8}(\.\d{1,2})?$/) @CanonicalDecimal() gross_kg: string;

  @IsOptional() @Matches(/^\d{1,8}(\.\d{1,2})?$/) @CanonicalDecimal() pallet_kg: string = '0.00';

  // THE ONLY SIGNED FIELD IN THE SLICE. §2.8 — «від'ємний bonus це м'ята чи
  // цвіла ягода». The leading `-?` is load-bearing; without it docking for
  // spoiled fruit is a 400 the operator cannot get past.
  @IsOptional() @Matches(/^-?\d{1,8}(\.\d{1,2})?$/) @CanonicalDecimal() bonus: string = '0.00';

  // §9.1 — a line with no tare is refused, not warned. NO DEFAULT: an omitted
  // `tare` must fail validation rather than quietly become an empty array, so
  // there is no `= []` here.
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CreateIntakeTareDto)
  tare: CreateIntakeTareDto[];
}

export class CreateIntakeDto {
  @IsString() code: string;                       // typed; normalized server-side
  @IsOptional() @IsUUID() collection_point_id?: string;
  @IsUUID() supplier_id: string;

  // @ArrayMinSize(1) only. NO @ArrayMaxSize — §2.3's «стеля 5» is deliberately
  // NOT enforced (spec §8.7): it reads as a property of the paper form, and a
  // form can be reprinted. A zero-line intake, by contrast, is an amount of
  // 0.00 with no meaning.
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CreateIntakeItemDto)
  items: CreateIntakeItemDto[];
}
```

**`@CanonicalDecimal()` must appear on every decimal field**, or `'1.2'` and `'1.20'` compare unequal downstream.

`void-document.dto.ts` — `{ reason: string }`, non-empty after trim. Exported from `intakes/dto` and imported by `payouts`; §9.3 governs both identically and two copies would drift.

`list-intakes.query.ts` — extends `PaginationQueryDto`: `collection_point_id?`, `shift_id?`, `supplier_id?`, `from?`, `to?`, `include_voided?` via `@BooleanQueryParam()` defaulting to **true**.

- [ ] **Step 4: Write the service**

The create path in full, because the ordering inside the transaction is the design:

```ts
async create(actor: AuthenticatedUser, dto: CreateIntakeDto): Promise<IntakeDetailResponse> {
  const pointId = resolveWritePoint(actor, dto.collection_point_id);
  const point = await this.points.findOneRaw(pointId);
  if (!point) throw new NotFoundException('Collection point not found');

  // The supplier check runs OUTSIDE the transaction: it is a read that cannot
  // race meaningfully (a supplier deactivated between here and the insert is a
  // document written a second early, not a corrupt one), and doing it first
  // means the common failure returns without ever opening a transaction.
  const supplier = await this.suppliers.findOne(actor, dto.supplier_id);
  if (supplier.collection_point_id !== pointId) throw new NotFoundException('Supplier not found');
  if (!supplier.is_active) {
    throw new BadRequestException({ message: 'Supplier is deactivated', code: 'SUPPLIER_INACTIVE' });
  }

  return this.dataSource.transaction(async (m) => {
    const shift = await this.shifts.findOpenAtPoint(pointId, m);
    if (!shift) {
      throw new ConflictException({
        message: 'No open shift at this point — open one first',
        code: 'NO_OPEN_SHIFT',
      });
    }

    // Snapshots, both read inside the transaction so the price stored is the
    // price that was current when the row was written.
    const gradeIds = [...new Set(dto.items.map((i) => i.product_grade_id))];
    const prices = new Map(
      (await Promise.all(gradeIds.map((g) => this.prices.currentFor(pointId, g, m))))
        .filter((p): p is GradePrice => p !== null)
        .map((p) => [p.product_grade_id, p]),
    );
    const tareIds = [...new Set(dto.items.flatMap((i) => i.tare.map((t) => t.tare_type_id)))];
    const tareTypes = new Map(
      (await this.tare.findManyRaw(tareIds, m)).map((t) => [t.id, t]),
    );

    // Every rule and every number, in one pure call. If this throws, the
    // transaction rolls back and no partial document exists — §2.3, one visit
    // is ONE document.
    const built = buildIntake(dto.items, prices, tareTypes);

    const code = composeDocumentCode(point.code, 'IN', shift.business_date, dto.code);

    try {
      const intake = await m.save(
        m.create(Intake, {
          code,
          shift_id: shift.id,
          supplier_id: supplier.id,
          amount: built.amount,
          received_by_user_id: actor.id,
          items: built.items.map((line) =>
            m.create(IntakeItem, {
              ...line,
              tare: line.tare.map((t) => m.create(IntakeItemTareType, t)),
            }),
          ),
        }),
      );
      await this.audit.record(
        { action: 'intake.created', actor_id: actor.id, target_type: 'intake',
          target_id: intake.id, after: { code, amount: built.amount } },
        m,
      );
      return toIntakeDetailResponse(intake, shift);
    } catch (error) {
      // The composed code collides ONLY on same point + same day + same typed
      // number, so the message must say that — a generic «duplicate» invites
      // the operator to retype the identical number.
      throw this.translateDuplicateCode(error, dto.code, shift.business_date);
    }
  });
}
```

`void` loads the intake with its shift and applies the §5 access matrix:

```ts
// §9.4's table, in the order its rows appear.
if (actor.role !== UserRole.NetworkOwner) {
  // «чужа квитанція → приймальник НІКОЛИ, навіть на своїй точці і в ту саму
  // зміну». THE AUTHOR CHECK, not a point check — §10.6's cashier swap puts two
  // operators' documents in one shift at one point as a matter of routine.
  if (intake.received_by_user_id !== actor.id) {
    throw new ForbiddenException({ message: 'You can only void your own documents', code: 'NOT_YOUR_DOCUMENT' });
  }
  // «квитанція минулого дня → тільки керівник»
  if (shift.closed_at) {
    throw new ForbiddenException({ message: 'The shift is closed — ask the owner', code: 'SHIFT_CLOSED' });
  }
}
```

then 409s if already voided (§9.3, «спроба сторнувати той самий документ удруге → кнопки просто немає»), writes the trio, and audits with the reason in `note`. The same block, verbatim, governs `PayoutsService.void` against `paid_by_user_id`.

`list` and `findOne` join `shifts` to expose `collection_point_id`/`business_date` and to scope an operator — **`intakes` has no point column**, and every later query over this table has to remember it.

- [ ] **Step 5: Run, lint, commit**

```bash
npm test -w backend -- intakes.service.spec && npm run lint -w backend
git add -A && git commit -m "feat(intakes): the first document"
```

---

## Task 10: `intakes` HTTP surface

**Files:**
- Create: `backend/src/intakes/intakes.controller.ts`, `intakes.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: extend `backend/src/testing/documents-pipeline.db-spec.ts`

- [ ] **Step 1: Extend the pipeline test**

The end-to-end walk, over real HTTP against a real database — the only place the whole chain is proven:

```ts
it('records a two-line intake and returns the computed total', async () => {
  const res = await request(app.getHttpServer())
    .post('/intakes')
    .set('Authorization', `Bearer ${operatorToken}`)
    .send({
      code: '04412',
      supplier_id: supplierId,
      items: [
        { product_grade_id: gradeId, gross_kg: '42.00', pallet_kg: '1.50',
          tare: [{ tare_type_id: crateId, units: 3 }] },
        { product_grade_id: gradeId, gross_kg: '20.00', bonus: '-2.00',
          tare: [{ tare_type_id: crateId, units: 1 }] },
      ],
    })
    .expect(201);

  expect(res.body.code).toMatch(/^[A-Z0-9]{2,8}-IN-\d{8}-04412$/);
  expect(res.body.amount).toBe('3137.30');
  expect(res.body.items).toHaveLength(2);
  // numeric is a STRING on the wire, always
  expect(typeof res.body.items[0].net_kg).toBe('string');
});

it('refuses the same typed code twice on the same day at the same point', async () => {
  await request(app.getHttpServer()).post('/intakes')
    .set('Authorization', `Bearer ${operatorToken}`)
    .send({ code: '04412', supplier_id: supplierId, items: [validItem] })
    .expect(409);
});

it('ACCEPTS the same typed code at a DIFFERENT point on the same day', async () => {
  // The whole reason the point segment is in the code. Two paper books, one
  // number, two valid receipts.
});

it('refuses an intake when no shift is open', async () => { /* 409 NO_OPEN_SHIFT */ });
it('refuses a line with no tare', async () => {
  // §9.1, and the DTO is what refuses it — proving the guard is reachable over
  // HTTP and not only from the pure module.
  await request(app.getHttpServer()).post('/intakes')
    .set('Authorization', `Bearer ${operatorToken}`)
    .send({ code: '04413', supplier_id: supplierId,
            items: [{ product_grade_id: gradeId, gross_kg: '10.00', tare: [] }] })
    .expect(400);
});
it('refuses an over-limit bonus with the maximum IN the message', async () => {
  // The assertion is on the BODY, not just the status: §2.10 is a UI/UX
  // recommendation about the resting screen, not a rule that the number is
  // secret (owner, 2026-09-08). A 400 the operator cannot act on is the failure.
  const res = await request(app.getHttpServer()).post('/intakes')
    .set('Authorization', `Bearer ${operatorToken}`)
    .send({ code: '04414', supplier_id: supplierId,
            items: [{ product_grade_id: gradeId, gross_kg: '10.00', bonus: '99.00',
                      tare: [{ tare_type_id: crateId, units: 1 }] }] })
    .expect(400);
  expect(res.body.message).toMatch(/30\.00/);
});
it('has no PATCH route', async () => {
  await request(app.getHttpServer()).patch(`/intakes/${id}`)
    .set('Authorization', `Bearer ${ownerToken}`).send({ amount: '1.00' }).expect(404);
});
it('has no DELETE route', async () => { /* 404 */ });
```

- [ ] **Step 2: Write the controller and module**

Four handlers, all thin. The doc comment records the two absences a reader will look for — no `PATCH` (§2.7, §9.3) and no `DELETE` (§5.5) — and that voiding authority is decided in the service because it depends on the shift's state, not on the request.

`intakes.module.ts` imports `TypeOrmModule.forFeature([Intake, IntakeItem, IntakeItemTareType])`, `ShiftsModule`, `SuppliersModule`, `GradePricesModule`, `TareTypesModule`, `CollectionPointsModule`, `AuditModule`.

- [ ] **Step 3: Run both suites, lint, commit**

```bash
npm test -w backend && npm run test:db -w backend && npm run lint -w backend
git add -A && git commit -m "feat(intakes): HTTP surface"
```

---

## Task 11: `supplier-balance` — one formula, one home

Built before `payouts`, because the payout ceiling depends on it.

**Files:**
- Create: `backend/src/supplier-balance/supplier-balance.service.ts`, `supplier-balance.mapper.ts`, `supplier-balance.controller.ts`, `supplier-balance.module.ts`
- Test: `backend/src/supplier-balance/supplier-balance.service.spec.ts`, plus a db-spec block

**Interfaces:**
- Consumes: the `intakes` and `payouts` tables, read-only, directly.
- Produces: `debtFor(supplierId, manager?)` → a decimal string. Consumed by `PayoutsService` and by `GET /suppliers/:id/balance`.

- [ ] **Step 1: Write the failing spec**

The four cases the `suppliers` Note demands, each proving one filter independently — «забути його на будь-якій означає або гасити борг грошима, яких не видали, або тримати борг за ягоду, якої не брали»:

```ts
it('is Σ intakes − Σ payouts', async () => { /* 500 − 120 = 380.00 */ });
it('EXCLUDES voided intakes', async () => {});
it('EXCLUDES voided payouts', async () => {});
it('returns 0.00 for a supplier with no documents at all', async () => {
  // «Перший день роботи показує всім нуль — це очікуваний стан, а не втрата
  // даних.» There is no opening-balance mechanism and there will not be one.
});
it('goes NEGATIVE when a paid-for intake is voided', async () => {
  // The one legitimate route below zero, and the schema has no `debt >= 0`
  // invariant. A test that asserted a floor here would be asserting a rule the
  // DBML explicitly refuses.
  expect(await service.debtFor(supplier)).toBe('-120.00');
});
it('does NOT filter by point', async () => {
  // §3.9 — supplier_id already means the point; the Note says filtering by
  // point as well is «не треба й не можна».
});
```

- [ ] **Step 2: Implement**

```ts
/**
 * THE ONLY `SUM` OVER EITHER DOCUMENT TABLE IN THE BACKEND.
 *
 * Copied verbatim from the `suppliers` Note in 28-db-schema.dbml, including
 * both `voided_at IS NULL` filters. The Note explains at length why this may
 * exist in exactly one place, and the two filters are why: dropping the one on
 * `intakes` holds a debt for berries never taken; dropping the one on `payouts`
 * settles a debt with money never handed over.
 *
 * NOTE THE ASYMMETRY WITH CASH, which lands with `cash_counts`: the debt
 * formula filters voided payouts OUT, the cash formula counts them IN, because
 * the money physically left the drawer and returns only via
 * `return_settled_at`. Same column, opposite readings. §9.3 — «інакше сторно
 * стає способом красти».
 *
 * NOTHING IS CACHED AND NO BALANCE IS STORED. §3.2 forbids it, and the DBML
 * supplies the field evidence: a stored balance is where the client's own
 * workbook broke — 124 разриви з 1 473.
 */
async debtFor(supplierId: string, manager?: EntityManager): Promise<string> {
  const runner = manager ?? this.dataSource.manager;
  const [row] = await runner.query(
    `SELECT (COALESCE((SELECT SUM(i.amount) FROM intakes i
                        WHERE i.supplier_id = $1 AND i.voided_at IS NULL), 0)
           - COALESCE((SELECT SUM(p.amount) FROM payouts p
                        WHERE p.supplier_id = $1 AND p.voided_at IS NULL), 0))::text AS debt`,
    [supplierId],
  );
  // `::text` on the numeric expression, so the value never passes through a
  // JS number on its way out of the driver (foundation §5.1).
  return row.debt;
}
```

- [ ] **Step 3: Controller and module**

`GET /suppliers/:id/balance`, `@Auth()`. It resolves visibility by delegating to `SuppliersService.findOne(actor, id)` first — an operator must not be able to read another point's supplier balance, and 404 rather than 403 for the same reason `SuppliersService` gives.

**Route-shadowing note for the module doc comment:** this route is registered by a different module from `SuppliersController`, and Nest's registration order across modules is not ours to control. It is safe *only* because the path has one more segment than `GET /suppliers/:id`. A later slice adding `GET /suppliers/:something` at the same depth would need to live in `SuppliersModule` instead.

- [ ] **Step 4: Run, lint, commit**

```bash
npm test -w backend && npm run lint -w backend
git add -A && git commit -m "feat(supplier-balance): Σ intakes − Σ payouts, in one place"
```

---

## Task 12: `payouts` domain — entity, DTOs, mapper, service

**Files:**
- Create: `backend/src/payouts/payout.entity.ts`, `payout.mapper.ts`, `dto/create-payout.dto.ts`, `dto/settle-return.dto.ts`, `dto/list-payouts.query.ts`, `payouts.service.ts`
- Test: `backend/src/payouts/payouts.service.spec.ts`

- [ ] **Step 1: Write the failing service spec**

```ts
describe('create', () => {
  it('allows a payout equal to the debt', async () => { /* 380.00 against 380.00 */ });
  it('refuses one kopiyka more', async () => {
    balance.debtFor.mockResolvedValue('380.00');
    await expect(service.create(operator, { amount: '380.01', /* … */ })).rejects.toMatchObject({
      response: { code: 'PAYOUT_EXCEEDS_DEBT' },
    });
  });
  it('names the current debt in the refusal', async () => {
    // The operator cannot see why 500 was refused unless the message says the
    // debt is 380. Without it they retry and are refused again.
  });
  it('allows a payout against a NEGATIVE debt only up to… nothing', async () => {
    // A negative balance means the network owes nothing; any positive payout
    // exceeds it. Recorded as a test because the comparison must be numeric,
    // not string: '-120.00' > '380.00' lexically.
  });
  it('locks the supplier row BEFORE reading the debt', async () => {
    const calls = manager.query.mock.calls.map((c) => String(c[0]));
    expect(calls[0]).toMatch(/FOR UPDATE/);
  });
  it('composes the code with PO, not IN', async () => {
    expect(saved.code).toBe('KPG-PO-20260908-00031');
  });
  it('409s when no shift is open', async () => {});
});

describe('void', () => {
  it('follows the same authority rule as intakes', async () => {});
  it('does NOT touch return_settled_at', async () => {
    // §9.3 — «каса НЕ виросла на 8 000». Voiding and the money coming back are
    // two separate events, and conflating them is the theft the rule names.
    expect(saved.return_settled_at).toBeNull();
  });
});

describe('settleReturn', () => {
  it('is refused to an operator at their own point', async () => {
    // The operator who voided the payout is the person holding the drawer.
    // Letting them also certify the refill closes §9.3's loop unobserved.
    await expect(service.settleReturn(operator, id, {})).rejects.toThrow(ForbiddenException);
  });
  it('409s a payout that is not voided', async () => {});
  it('409s a payout already settled', async () => {});
  it('stores an optional note and stamps the settler', async () => {});
  it('does NOT store the amount', async () => {
    // It always equals payouts.amount; a second copy is forbidden by the DBML
    // header and would be the number that goes stale.
  });
});
```

- [ ] **Step 2: Write the entity, DTOs and mapper**

`create-payout.dto.ts` — `code` (typed), `collection_point_id?`, `supplier_id`, `amount` with `@Matches(/^\d{1,10}(\.\d{1,2})?$/)` (**unsigned**; the `CHECK` refuses zero) and `@CanonicalDecimal()`.

`settle-return.dto.ts` — `{ note?: string }`. Optional, unlike a void reason; the entity header must say why the two trios differ.

The entity header records the §9.3 asymmetry in full: voiding removes the payout from the **debt** formula and leaves it in the **cash** formula, and only `return_settled_at` moves it back.

- [ ] **Step 3: Write the service**

```ts
async create(actor: AuthenticatedUser, dto: CreatePayoutDto): Promise<PayoutResponse> {
  const pointId = resolveWritePoint(actor, dto.collection_point_id);
  const point = await this.points.findOneRaw(pointId);
  if (!point) throw new NotFoundException('Collection point not found');
  const supplier = await this.suppliers.findOne(actor, dto.supplier_id);
  if (supplier.collection_point_id !== pointId) throw new NotFoundException('Supplier not found');

  return this.dataSource.transaction(async (m) => {
    // THE LOCK COMES FIRST, AND THE ORDER IS THE POINT. The ceiling is a
    // read-then-write over a sum across two tables, and no CHECK can express
    // it. Without this line, two payouts in flight — two operators, one
    // double-tapped submit button, or a client retry on a slow response — both
    // read a debt of 380, both pass, both commit, 760 against a 380 debt. The
    // schema has no `debt >= 0` invariant, so nothing downstream notices.
    //
    // The suppliers row is a MUTEX, not data being changed. Contention is per
    // supplier; payouts to different suppliers never block each other and
    // intakes are untouched. SERIALIZABLE was rejected: it needs a retry loop
    // for an expected 40001 and this repo has no retry infrastructure.
    await m.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [dto.supplier_id]);

    const shift = await this.shifts.findOpenAtPoint(pointId, m);
    if (!shift) throw new ConflictException({ message: 'No open shift at this point', code: 'NO_OPEN_SHIFT' });

    const debt = await this.balance.debtFor(dto.supplier_id, m);
    if (gt(dto.amount, debt)) {
      // HALF of §3.6. The full ceiling is min(Разом, каса за ягоду); the cash
      // half needs transfers + cash_counts + the crate tables, none of which
      // exist. A payout can therefore currently exceed the cash physically in
      // the drawer, and nothing here can notice — spec §9.
      throw new BadRequestException({
        message: `Payout of ${dto.amount} exceeds the supplier's balance of ${debt}`,
        code: 'PAYOUT_EXCEEDS_DEBT',
      });
    }

    const code = composeDocumentCode(point.code, 'PO', shift.business_date, dto.code);
    // … insert, audit `payout.created`, return
  });
}
```

`settleReturn` is `@Auth(UserRole.NetworkOwner)` at the controller and additionally 409s unless `voided_at` is set and `return_settled_at` is not.

- [ ] **Step 4: Run, lint, commit**

```bash
npm test -w backend -- payouts.service.spec && npm run lint -w backend
git add -A && git commit -m "feat(payouts): the debt ceiling behind a row lock"
```

---

## Task 13: `payouts` HTTP surface, and proving the lock

**Files:**
- Create: `backend/src/payouts/payouts.controller.ts`, `payouts.module.ts`, `backend/src/payouts/payout-race.db-spec.ts`
- Modify: `backend/src/app.module.ts`
- Test: extend `backend/src/testing/documents-pipeline.db-spec.ts`

- [ ] **Step 1: Write the race db-spec**

The only proof the `FOR UPDATE` is load-bearing. A unit test cannot express it, and without it the lock is a line nobody would miss if it were deleted.

```ts
/**
 * TWO CONCURRENT PAYOUTS AGAINST ONE SUPPLIER. Delete the `SELECT … FOR UPDATE`
 * from PayoutsService and this suite goes green-then-wrong: both transactions
 * read the same debt, both pass the ceiling, and the supplier ends up paid
 * twice for one delivery. The schema has no `debt >= 0` invariant to catch it.
 */
it('serializes two payouts against the same supplier', async () => {
  // debt = 380.00 from one intake
  const a = ds.createQueryRunner();
  const b = ds.createQueryRunner();
  await a.connect(); await b.connect();
  await a.startTransaction(); await b.startTransaction();

  await a.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId]);

  // B blocks on the same row. Racing it against a timer is what proves the
  // lock is held rather than merely requested.
  let bAcquired = false;
  const bWaiter = b
    .query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId])
    .then(() => { bAcquired = true; });

  await new Promise((r) => setTimeout(r, 200));
  expect(bAcquired).toBe(false);

  await a.commitTransaction();
  await bWaiter;
  expect(bAcquired).toBe(true);
  await b.rollbackTransaction();
  await a.release(); await b.release();
});

it('the second payout sees the first one’s effect on the debt', async () => {
  // Sequential proof of the same thing at the service level: pay 380 against a
  // 380 debt, then a second 380 is refused because the debt is now 0.
});
```

- [ ] **Step 2: Write the controller, module and pipeline block**

Five handlers. `settle-return` is the only `@Auth(UserRole.NetworkOwner)` one.

Pipeline additions to `documents-pipeline.db-spec.ts`, completing the walk:

```ts
it('shows the debt after the intake', async () => {
  const res = await request(app.getHttpServer())
    .get(`/suppliers/${supplierId}/balance`)
    .set('Authorization', `Bearer ${operatorToken}`).expect(200);
  expect(res.body.debt).toBe('3137.30');
});

it('refuses a payout above the debt and names it', async () => { /* 400 */ });
it('pays part of it and lowers the debt', async () => { /* 1000.00 -> 2137.30 */ });
it('voiding the intake drives the balance NEGATIVE, and is allowed', async () => {
  // «сторно КВИТАНЦІЇ ЄДИНИЙ шлях у мінус, і воно ДОЗВОЛЕНЕ, з попередженням»
  expect(res.body.debt).toBe('-1000.00');
});
it('refuses one operator the void of another operator’s intake', async () => {
  // §9.4 + §10.6. Needs a SECOND operator at the same point — mint the token
  // with the app's own JwtService, per backend/CLAUDE.md's note about the login
  // throttle being shared across the file.
  /* 403 NOT_YOUR_DOCUMENT */
});
it('refuses the operator a void once the shift is closed', async () => { /* 403 */ });
it('lets the owner void it afterwards', async () => { /* 200 */ });
it('refuses settle-return on a live payout, allows it on a voided one', async () => {});
it('refuses settle-return to the operator', async () => { /* 403 */ });
```

- [ ] **Step 3: Run everything**

```bash
npm test -w backend && npm run test:db -w backend && npm run lint -w backend && npm run build -w backend
```

- [ ] **Step 4: Verify entity metadata matches the migration**

The check the catalog and prices slices both ran, and the one that catches a column typed differently in TypeORM than in SQL:

```bash
npm run migration:generate -w backend -- src/migrations/TMP-should-be-empty
```

It must report **no changes**. If it proposes anything, the entity and the migration disagree — fix the entity, delete the generated file, and re-run. Pay particular attention to:

- `business_date` as `date`, not `timestamp`;
- the partial index, which TypeORM cannot express and must be absent from entity metadata (add it to the entity's `@Index` only if TypeORM's `where` option matches exactly, otherwise leave it out and note why);
- the composite primary key on `intake_item_tare_types`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(payouts): HTTP surface and the concurrency proof"
```

---

## Task 14: Documentation and follow-ups

- [ ] **Step 1: Update `backend/CLAUDE.md`** — the structure table gains `shifts/`, `intakes/`, `payouts/`, `supplier-balance/`; the migrations list gains `1788600000007`. Add a line pointing at `common/money.ts` as the one place arithmetic is permitted.

- [ ] **Step 2: Update the root `CLAUDE.md`** — the Domain line becomes:

> Implemented so far: `users`, `collection_points` (foundation slice), `products`, `product_grades`, `tare_types` (catalog slice), `suppliers`, `grade_prices` (prices slice), `shifts`, `intakes`, `intake_items`, `intake_item_tare_types`, `payouts` (this slice). Five tables remain, all of them cash and crates: `crate_issuances`, `crate_returns`, `crate_return_allocations`, `cash_counts`, `transfers`.

- [ ] **Step 3: Record this slice's follow-ups** in `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`:

```markdown
## New, from the intakes & payouts slice (2026-09-08)

1. **`collection-points.service.ts` — refuse deactivating a point with an open shift.**
   The existing `TODO (when shifts lands)` is now buildable. Left out of this slice
   deliberately as an adjacent fix.
2. **Warn when deactivating a supplier who carries non-zero debt.** Parked by the prices
   slice «when `intakes` and `payouts` exist». They now exist. A WARNING, never a refusal
   (правка 14, «заблокована кнопка вчить шукати обхід») — and note that "settle up first"
   is not well defined, since debt may legitimately be negative.
3. **`SuppliersService` still has a private `resolveWritePoint`.** The shared one now lives
   in `point-scope.ts`; switching suppliers over is a three-line change covered by its
   existing spec.
4. **The shift close path gets revisited with `cash_counts`** — the role split (§7.7 + правка
   2), the mandatory `explanation`, and `awaiting_explanation` becoming reachable. Known and
   priced when `shifts` was scoped (spec §2.1).
5. **The payout ceiling gets its second half** — `min(Разом, каса за ягоду)` (§3.6). The lock
   and the `supplier-balance` seam are already the right shape for it.
6. **`decimal.js` replaces the internals of `common/money.ts`** when the arithmetic stops
   being provisional. One file, by construction.
7. **Foundation spec §5.2 is stale** — it says `APP_TIMEZONE` «currently defaults to `UTC`».
   It has defaulted to `Europe/Kyiv` since before this slice. One-line correction.
8. **`collection_points.code` is required on create.** If that proves annoying in practice,
   the alternative is a sequence-backed column default — smaller diff, worse receipt.
9. **§4.5's daily price gate is not enforceable.** `grade_prices` lost `business_date` in the
   prices slice, so a price carries over and an intake on the 5th silently uses the 4th's price
   — against the client's literal reason for the rule, «щоб ніхто не порахував по вчорашній».
   Fix needs no migration: refuse a grade whose newest price row predates the shift's
   `business_date`. Deferred deliberately (owner, 2026-09-08) because the gate means a morning
   with no prices set is a morning the point cannot trade. Spec §10.3.
10. **§9.2's warning channel does not exist.** Four «дозволяємо, але вголос» checks — kg per
    crate outside 2…14, gross over 750 kg, pallet over 50 % of gross, an identical line twice
    inside 60 s — and the rule that a warning «називає число і причину». Needs an advisory field
    on a 201. §9.2 itself is unresolved on «на кому відповідальність за валідацію».
11. **§12.1's payout rounding.** Whole hryvnia, exactly 0.50 going DOWN, system-suggested. A
    DIFFERENT rounding from `money.ts`'s half-up-at-2dp, not a replacement for it. Filed at the
    source under «Три місця, де відповіді ще немає» with «→ **Правка:** точно???».
12. **Two contradictions in `26-rules-by-example.md` need the owner.** §9.4 vs §10.2 — whether an
    operator may void their own intake at all. §9.1 vs §9.2 — whether a tare-less line is refused
    or warned. This slice took §9.4 and §9.1; spec §10.2 records what changes if the other
    reading is meant.
13. **The three earlier specs state that `26-rules-by-example.md` is not in the repository.** It
    is, and this slice is the first written against it. Their reasoning rests on second-hand
    quotation and has not been re-checked; spec §10.5 is the one place already known to differ.
```

- [ ] **Step 4: Final verification**

```bash
npm test -w backend && npm run test:db -w backend && npm run lint -w backend && npm run build -w backend
docker compose up -d && docker compose logs -f backend   # migrations run on startup
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "docs: record the intakes & payouts slice"
```

---

## Notes for the executor

**The order is a dependency order, not a preference.** `money.ts` before `intake-lines.ts` before `intakes`; `shifts` before both documents; `supplier-balance` before `payouts`. Task 4's test repair must be fully green before Task 5, or later failures will look like new bugs.

**The db suite is EXPECTED to be red between Task 3 and Task 4, and only there.** Task 3's migration makes `collection_points.code` `NOT NULL`, which breaks six raw `INSERT`s in three older db-specs and nine `POST /collection-points` calls in two pipeline specs. Task 3 therefore runs only its own file (`npm run test:db -w backend -- intakes-payouts-schema`); Task 4 Step 3 repairs the rest and Step 4 is the first full-suite gate. Do not try to "fix" those failures during Task 3 — they are on the schedule.

**Three things in this slice look like omissions and are load-bearing.** Before "fixing" any of them, read the cited section:

1. `intake_items.bonus` has no non-negative `CHECK` — §2.8.
2. `shifts.explanation` and `awaiting_explanation` are unwritten — spec §2.1.
3. There is no `PATCH` on any document — §2.7, §9.3.

**Four rules in this plan REVERSE an earlier draft, after `26-rules-by-example.md` arrived in the repository.** Each has a test named for its rule, and each will look like an over-restriction to someone who has only read the DBML:

1. An operator voids only a document **they wrote** — §9.4, not "same point".
2. Opening and closing a shift is operator-only; the owner has neither verb — §10.3.
3. Every intake line carries at least one tare line — §9.1.
4. A refusal **names the number** it refused against — §2.10 is UX guidance, not secrecy.

**The primary source contradicts itself in two places, and this plan picks a side of each** (§9.4 vs §10.2, §9.1 vs §9.2). Spec §10.2 says which side and what changes if the owner meant the other. Do not silently switch sides while implementing.

**When a test fails, check which rule it names before changing the assertion.** Every test in this plan is titled after the rule it protects; a failing one is usually the implementation disagreeing with the schema, not the test being wrong.

**The one number to sanity-check by hand** if the pipeline total looks off: line one is `(42.00 − 1.50 − 3.60) × 57.00 = 2103.30`, line two is `(20.00 − 0.00 − 1.20) × 55.00 = 1034.00`, total `3137.30`.
