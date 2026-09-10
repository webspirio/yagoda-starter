# Mock Framework Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `agency/` workspace up to the point where `agency new <slug>` produces a deployed, green, clickable mock — the exact point where the spec's kill criterion #1 fires.

**Architecture:** One pnpm workspace, path-linked packages, no npm registry. Four libraries (`dec`, `synth`, `mock`, `kit`) with no dependency on each other except `mock → dec`, then a template that wires them, then a CLI that instantiates the template. The data seam is a custom axios adapter: components call TanStack Query hooks over one `axios.create`, and swapping `adapter` is the only difference between a mock and the real product.

**Tech Stack:** pnpm 11.5.2 · Node 24 · TypeScript 6 · Vite 8 · React 19 · Tailwind 4.3.3 · vitest 4 · oxlint 1.77 · axios 1.20 · react-router 8.3.1 · @tanstack/react-query 5 · radix-ui 1.6.7 · shadcn CLI 4.21

**Spec:** `docs/superpowers/specs/2026-09-09-mock-framework-design.md`

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include this section.

- **Propagation doctrine.** A standard may propagate only as (a) something the scaffolder writes at t=0, or (b) a check that goes red. Never as prose. Do not add a `CLAUDE.md`, a README convention, or a comment as the enforcement mechanism for anything.
- **Money is decimal strings**, scale-generic, bigint internals, half-up away from zero. Never `Number()`, `parseFloat`, `toFixed`, or a float. Integer minor units are rejected (`backend/src/common/money.ts:9-13`).
- **Ordering is always explicit.** `seq()` or ULID, store-assigned. Never `Math.random()` for an id; never rely on array insertion order.
- **Error envelope:** `{ statusCode, error, message, path, timestamp, requestId, code?, ...ctx }`. Branch on `code` only.
- **Pagination:** `{ data, total, page, limit }`.
- **Dates:** `Instant` = ISO-8601 Z. `BusinessDate` = `'YYYY-MM-DD'`, server-derived, never in a request body.
- **Wire casing:** snake_case.
- **No new runtime dependencies** beyond those named in Tech Stack above. Specifically forbidden in any mock's `dependencies`: `msw`, `@mswjs/data`, `@msw/data`, `@electric-sql/pglite`, `zod`, `i18next`, `react-i18next`.
- **Packages are path-linked**, never published. No `.npmrc`, no PAT, no version field bumps.
- **Every package is ESM** (`"type": "module"`), source-only where it can be (`exports` pointing at `.ts`/`.tsx`), so there is no build step in the inner loop.
- **TDD.** Every task writes a failing test first, watches it fail, then implements.

---

## File Structure

New repo `agency/`, created at `/Users/oleksandrsecond/Projects/agency`.

| Path | Responsibility |
|---|---|
| `pnpm-workspace.yaml` | Workspace globs. `packages/*` and `mocks/*` only — `portfolio/*` is deliberately absent (Plan B). |
| `tsconfig.base.json` | Strict compiler options every package extends. |
| `oxlint.base.json` | The money and ordering rules. The only enforcement surface in Plan A. |
| `packages/dec/src/dec.ts` | Scale-generic decimal-string arithmetic. Zero dependencies. |
| `packages/dec/src/fx.ts` | `stampFx()` — the rate-stamped cross-currency record. |
| `packages/dec/golden.json` | 200-case parity fixture so `backend/src/common/money.ts` can be asserted against this later without being touched now. |
| `packages/synth/src/corpus.ts` | Latin + Cyrillic name/company/address data. Data only, no logic. |
| `packages/synth/src/stream.ts` | Seeded deterministic pickers over the corpus. |
| `packages/mock/src/errors.ts` | `DomainError`, `ErrorEnvelope`, `envelopeOf()`. |
| `packages/mock/src/types.ts` | `Paginated<T>`, `Instant`, `BusinessDate`, `Decimal2`, `seq()`. |
| `packages/mock/src/router.ts` | Route table compilation and matching. Pure, no axios. |
| `packages/mock/src/adapter.ts` | `mockAdapter()` — the seam. The only file that knows axios. |
| `packages/mock/src/profiles.ts` | `resolveProfile()`, `profileHref()`, `Capabilities`. |
| `packages/kit/src/**` | 84 files lifted from `yagoda-starter/frontend/src/shared/ui`. |
| `packages/kit/PROVENANCE.md` | Source repo + sha + date of the lift. |
| `templates/mock/**` | The scaffold. Files marked `@scaffold-owned` are hashed in Plan B. |
| `packages/cli/src/new.ts` | `agency new` — template instantiation. |
| `packages/cli/bin/agency.mjs` | The CLI entry point. |

Files that change together live together: each package owns its tests co-located as `*.test.ts`.

---

## Task 1: Workspace bootstrap + `packages/dec` core

**Files:**
- Create: `/Users/oleksandrsecond/Projects/agency/package.json`
- Create: `/Users/oleksandrsecond/Projects/agency/pnpm-workspace.yaml`
- Create: `/Users/oleksandrsecond/Projects/agency/.nvmrc`
- Create: `/Users/oleksandrsecond/Projects/agency/tsconfig.base.json`
- Create: `/Users/oleksandrsecond/Projects/agency/vitest.config.ts`
- Create: `/Users/oleksandrsecond/Projects/agency/packages/dec/package.json`
- Create: `/Users/oleksandrsecond/Projects/agency/packages/dec/src/dec.ts`
- Test: `/Users/oleksandrsecond/Projects/agency/packages/dec/src/dec.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `split(v: string): { units: bigint; scale: number }` (internal), and the public
  `add(a: string, b: string, scale?: number): string`,
  `sub(a: string, b: string, scale?: number): string`,
  `mul(a: string, b: string, scale?: number): string`,
  `div(a: string, n: number, scale?: number): string`,
  `sum(values: string[], scale?: number): string`,
  `cmp(a: string, b: string): -1 | 0 | 1`,
  `gt/gte/lt/lte(a: string, b: string): boolean`,
  `isZero(v: string): boolean`, `isNegative(v: string): boolean`,
  `round(v: string, scale: number): string`.
  All default `scale = 2`.

- [ ] **Step 1: Create the workspace files**

`/Users/oleksandrsecond/Projects/agency/package.json`:

```json
{
  "name": "agency",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.5.2",
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -b",
    "lint": "oxlint --max-warnings=0"
  },
  "devDependencies": {
    "typescript": "~6.0.3",
    "vitest": "^4.1.10",
    "oxlint": "^1.77.0",
    "@types/node": "^24.13.3"
  }
}
```

`/Users/oleksandrsecond/Projects/agency/pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "mocks/*"
```

`/Users/oleksandrsecond/Projects/agency/.nvmrc`:

```
24
```

`/Users/oleksandrsecond/Projects/agency/tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "declaration": true,
    "composite": true
  }
}
```

`/Users/oleksandrsecond/Projects/agency/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['packages/*/src/**/*.test.ts'] },
});
```

`/Users/oleksandrsecond/Projects/agency/packages/dec/package.json`:

```json
{
  "name": "@agency/dec",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

- [ ] **Step 2: Write the failing test**

`/Users/oleksandrsecond/Projects/agency/packages/dec/src/dec.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { add, sub, mul, div, sum, cmp, gt, lt, isZero, isNegative, round } from './dec';

describe('parsing', () => {
  it('rejects anything that is not a plain decimal', () => {
    for (const bad of ['1e3', '', ' 1', '1.2.3', 'NaN', '0x10', '+1']) {
      expect(() => add(bad, '0')).toThrow(/decimal/);
    }
  });
});

describe('add / sub — scale 2 by default', () => {
  it('does not go through a float', () => {
    expect(add('0.10', '0.2')).toBe('0.30'); // 0.1 + 0.2 === 0.30000000000000004 in floats
    expect(add('140.00', '-5')).toBe('135.00');
    expect(sub('1.05', '1.05')).toBe('0.00');
    expect(sub('1.00', '2.50')).toBe('-1.50');
  });
});

describe('mul — half-up AWAY FROM ZERO, operands may differ in scale', () => {
  it('rounds the scale-4 product back to scale 2', () => {
    expect(mul('2.50', '1.005')).toBe('2.51');
    expect(mul('-2.50', '1.005')).toBe('-2.51'); // away from zero, not toward positive
  });
  it('multiplies a scale-2 amount by a scale-4 FX rate', () => {
    expect(mul('100.00', '47.8032')).toBe('4780.32');
  });
  it('can return a higher-scale product when asked', () => {
    expect(mul('1.5', '1.5', 4)).toBe('2.2500');
  });
});

describe('div — a decimal split over a whole count', () => {
  it('matches the semantics already shipped in yagoda-starter', () => {
    expect(div('126.40', 2)).toBe('63.20');
    expect(div('1.00', 8)).toBe('0.13');
    expect(div('3.00', 8)).toBe('0.38');
    expect(div('10.00', 3)).toBe('3.33');
  });
  it('refuses a non-integer or zero divisor', () => {
    expect(() => div('1.00', 0)).toThrow(/non-zero integer/);
    expect(() => div('1.00', 2.5)).toThrow(/non-zero integer/);
  });
});

describe('sum — rounded per line then summed', () => {
  it('totals the printed lines', () => {
    expect(sum(['10944.00', '1827.00', '0.50'])).toBe('12771.50');
    expect(sum([])).toBe('0.00');
  });
});

describe('cmp — numeric, never lexicographic', () => {
  it('orders 9 before 10, which a string sort does not', () => {
    expect(cmp('9.00', '10.00')).toBe(-1);
    expect(['9.00', '10.00'].sort()).toEqual(['10.00', '9.00']); // the bug this exists to prevent
    expect(cmp('10', '10.00')).toBe(0);
    expect(gt('0.01', '0')).toBe(true);
    expect(lt('-0.01', '0')).toBe(true);
    expect(isZero('0.00')).toBe(true);
    expect(isNegative('-0.01')).toBe(true);
  });
});

describe('round', () => {
  it('rescales half-up away from zero', () => {
    expect(round('2.345', 2)).toBe('2.35');
    expect(round('-2.345', 2)).toBe('-2.35');
    expect(round('2.344', 2)).toBe('2.34');
    expect(round('2', 4)).toBe('2.0000');
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm vitest run packages/dec`
Expected: FAIL — `Failed to resolve import "./dec"`.

- [ ] **Step 4: Implement**

`/Users/oleksandrsecond/Projects/agency/packages/dec/src/dec.ts`:

```ts
/**
 * Scale-generic decimal-string arithmetic. Strings in, strings out, bigint
 * internals, half-up AWAY FROM ZERO. No value ever passes through a float.
 *
 * Scale is a parameter, not a constant, because the domain needs two of them:
 * amounts and weights at 2, FX rates at 4-6. A scale-2-only module throws on a
 * rate of 47.8032, which is why the agency ended up with three incompatible
 * money modules.
 */
const PATTERN = /^-?\d+(?:\.\d+)?$/;

function split(v: string): { units: bigint; scale: number } {
  if (typeof v !== 'string' || !PATTERN.test(v)) {
    throw new Error(`dec: ${JSON.stringify(v)} is not a plain decimal`);
  }
  const negative = v.startsWith('-');
  const magnitude = negative ? v.slice(1) : v;
  const [whole = '0', fraction = ''] = magnitude.split('.');
  const units = BigInt(whole + fraction);
  return { units: negative ? -units : units, scale: fraction.length };
}

/** Move `units` from scale `from` to scale `to`, rounding half-up away from zero. */
function rescale(units: bigint, from: number, to: number): bigint {
  if (to === from) return units;
  if (to > from) return units * 10n ** BigInt(to - from);
  const divisor = 10n ** BigInt(from - to);
  const quotient = units / divisor;
  const remainder = units % divisor;
  const magnitude = remainder < 0n ? -remainder : remainder;
  if (magnitude * 2n >= divisor) return quotient + (units < 0n ? -1n : 1n);
  return quotient;
}

function render(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const body = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${body}` : body;
}

function align(a: string, b: string): { x: bigint; y: bigint; scale: number } {
  const A = split(a);
  const B = split(b);
  const scale = Math.max(A.scale, B.scale);
  return { x: rescale(A.units, A.scale, scale), y: rescale(B.units, B.scale, scale), scale };
}

export function add(a: string, b: string, scale = 2): string {
  const { x, y, scale: s } = align(a, b);
  return render(rescale(x + y, s, scale), scale);
}

export function sub(a: string, b: string, scale = 2): string {
  const { x, y, scale: s } = align(a, b);
  return render(rescale(x - y, s, scale), scale);
}

export function mul(a: string, b: string, scale = 2): string {
  const A = split(a);
  const B = split(b);
  return render(rescale(A.units * B.units, A.scale + B.scale, scale), scale);
}

export function div(a: string, n: number, scale = 2): string {
  if (!Number.isInteger(n) || n === 0) {
    throw new Error('dec.div: n must be a non-zero integer');
  }
  const A = split(a);
  // One guard digit, then round it away — the same half-up the rest of the module uses.
  const numerator = rescale(A.units, A.scale, scale + 1);
  return render(rescale(numerator / BigInt(n), scale + 1, scale), scale);
}

export function sum(values: string[], scale = 2): string {
  return values.reduce((total, v) => add(total, v, scale), render(0n, scale));
}

export function cmp(a: string, b: string): -1 | 0 | 1 {
  const { x, y } = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export const gt = (a: string, b: string): boolean => cmp(a, b) === 1;
export const gte = (a: string, b: string): boolean => cmp(a, b) >= 0;
export const lt = (a: string, b: string): boolean => cmp(a, b) === -1;
export const lte = (a: string, b: string): boolean => cmp(a, b) <= 0;
export const isZero = (v: string): boolean => split(v).units === 0n;
export const isNegative = (v: string): boolean => split(v).units < 0n;

export function round(v: string, scale: number): string {
  const A = split(v);
  return render(rescale(A.units, A.scale, scale), scale);
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm vitest run packages/dec`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/oleksandrsecond/Projects/agency
git init -b main 2>/dev/null || true
git add package.json pnpm-workspace.yaml .nvmrc tsconfig.base.json vitest.config.ts packages/dec
git commit -m "feat(dec): scale-generic decimal-string arithmetic"
```

---

## Task 2: `packages/dec` — `stampFx` and the golden parity fixture

**Files:**
- Create: `/Users/oleksandrsecond/Projects/agency/packages/dec/src/fx.ts`
- Create: `/Users/oleksandrsecond/Projects/agency/packages/dec/src/index.ts`
- Create: `/Users/oleksandrsecond/Projects/agency/packages/dec/golden.json`
- Test: `/Users/oleksandrsecond/Projects/agency/packages/dec/src/fx.test.ts`
- Test: `/Users/oleksandrsecond/Projects/agency/packages/dec/src/golden.test.ts`

**Interfaces:**
- Consumes: `mul`, `round` from Task 1.
- Produces: `type Stamped = { amount: string; ccy: string; rate: string; base: string }` and
  `stampFx(amount: string, ccy: string, rate: string, baseScale?: number): Stamped`.
  `packages/dec/src/index.ts` re-exports everything from `./dec` and `./fx`.

**Why `base` is stored, not derived:** `logistic/src/lib/finance/money.ts` stamps the rate on the
row and computes the EUR equivalent once at write, because otherwise last March's margin moves when
the hryvnia moves and the owner stops believing the report. A `convert()` call is a derivation where
the domain needs two persisted columns.

- [ ] **Step 1: Write the failing test**

`/Users/oleksandrsecond/Projects/agency/packages/dec/src/fx.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stampFx } from './fx';

describe('stampFx', () => {
  it('computes base once, at write, and stores it alongside the rate', () => {
    expect(stampFx('100.00', 'EUR', '47.8032')).toEqual({
      amount: '100.00', ccy: 'EUR', rate: '47.8032', base: '4780.32',
    });
  });

  it('keeps a scale-4 rate at scale 4 — a scale-2 validator would have thrown here', () => {
    expect(stampFx('1.00', 'EUR', '47.8032').rate).toBe('47.8032');
  });

  it('does not move when the rate later moves — base is a stored value', () => {
    const march = stampFx('100.00', 'EUR', '40.0000');
    const today = stampFx('100.00', 'EUR', '47.8032');
    expect(march.base).toBe('4000.00');
    expect(today.base).toBe('4780.32');
  });

  it('rejects a malformed rate', () => {
    expect(() => stampFx('1.00', 'EUR', '')).toThrow(/decimal/);
  });
});
```

`/Users/oleksandrsecond/Projects/agency/packages/dec/src/golden.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import golden from '../golden.json' with { type: 'json' };
import * as dec from './index';

type Case = { op: 'add' | 'sub' | 'mul'; a: string; b: string; scale: number; expected: string };

describe('golden parity fixture', () => {
  it('has at least 200 cases so the backend money module can be asserted against it later', () => {
    expect((golden as Case[]).length).toBeGreaterThanOrEqual(200);
  });

  it.each(golden as Case[])('$op($a, $b, $scale) === $expected', ({ op, a, b, scale, expected }) => {
    expect(dec[op](a, b, scale)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm vitest run packages/dec`
Expected: FAIL — `Failed to resolve import "./fx"` and `Cannot find module '../golden.json'`.

- [ ] **Step 3: Implement `fx.ts` and `index.ts`**

`/Users/oleksandrsecond/Projects/agency/packages/dec/src/fx.ts`:

```ts
import { mul } from './dec';

/**
 * A cross-currency amount with the rate STAMPED ON THE ROW and the base-currency
 * equivalent computed once, at write, and stored.
 */
export type Stamped = {
  /** The amount as entered, in `ccy`. */
  amount: string;
  /** ISO 4217 code of the amount's currency. */
  ccy: string;
  /** The rate used, at its own scale (typically 4-6). Stored, never re-derived. */
  rate: string;
  /** amount x rate, rounded to `baseScale` at write time. Stored. */
  base: string;
};

export function stampFx(amount: string, ccy: string, rate: string, baseScale = 2): Stamped {
  return { amount, ccy, rate, base: mul(amount, rate, baseScale) };
}
```

`/Users/oleksandrsecond/Projects/agency/packages/dec/src/index.ts`:

```ts
export * from './dec';
export * from './fx';
```

- [ ] **Step 4: Generate `golden.json`**

Run this once and commit the output. It is a fixture, not a script the build depends on.

```bash
cd /Users/oleksandrsecond/Projects/agency
node --input-type=module -e "
import { add, sub, mul } from './packages/dec/src/dec.ts';
" 2>/dev/null || true
npx tsx --eval "
import { writeFileSync } from 'node:fs';
import { add, sub, mul } from './packages/dec/src/dec.ts';
const vals = ['0','0.01','-0.01','1','1.005','2.50','-2.50','9.00','10.00','19.99','100.00','12345.67','-12345.67','0.005','47.8032'];
const cases = [];
for (const a of vals) for (const b of vals) {
  for (const [op, fn] of [['add', add], ['sub', sub], ['mul', mul]]) {
    if (cases.length >= 300) break;
    cases.push({ op, a, b, scale: 2, expected: fn(a, b, 2) });
  }
}
writeFileSync('packages/dec/golden.json', JSON.stringify(cases, null, 2) + '\n');
console.log('cases:', cases.length);
"
```

Expected: prints `cases: 300`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm vitest run packages/dec`
Expected: PASS — the 7 from Task 1, 4 from `fx.test.ts`, and 301 from `golden.test.ts`.

- [ ] **Step 6: Commit**

```bash
cd /Users/oleksandrsecond/Projects/agency
git add packages/dec
git commit -m "feat(dec): stampFx with a stored base, plus a 300-case golden fixture"
```

---

## Task 3: Root lint config — the money and ordering rules

**Files:**
- Create: `/Users/oleksandrsecond/Projects/agency/oxlint.base.json`
- Create: `/Users/oleksandrsecond/Projects/agency/.oxlintrc.json`
- Test: `/Users/oleksandrsecond/Projects/agency/packages/dec/src/lint-fixture.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `oxlint.base.json`, extended by every mock's `.oxlintrc.json`. Task 9's template extends it.

**Why:** a probe run against `yagoda-starter/backend/src/intakes/` shows `return a.amount > b.amount;`
**exits 0** while `return a * b;` exits 1. Comparison is the hole. `['9.00','10.00'].sort()` returns
`['10.00','9.00']`.

- [ ] **Step 1: Write the failing test**

This test shells out to oxlint against fixture files, because the thing under test is a lint config,
not a function.

`/Users/oleksandrsecond/Projects/agency/packages/dec/src/lint-fixture.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../..', import.meta.url).pathname;

function lint(source: string): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'lintfix-'));
  cpSync(join(ROOT, 'oxlint.base.json'), join(dir, 'oxlint.base.json'));
  writeFileSync(join(dir, '.oxlintrc.json'), JSON.stringify({ extends: ['./oxlint.base.json'] }));
  writeFileSync(join(dir, 'money.ts'), source);
  try {
    const out = execFileSync('npx', ['oxlint', '--max-warnings=0', '.'], { cwd: dir, encoding: 'utf8' });
    return { code: 0, out };
  } catch (e: unknown) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
}

describe('money and ordering lint rules', () => {
  it('rejects multiplication on money', () => {
    expect(lint('export const x = (a: number, b: number) => a * b;').code).not.toBe(0);
  });

  it('rejects COMPARISON on money — the measured hole that exits 0 today', () => {
    const r = lint('export const x = (a: {amount: string}, b: {amount: string}) => a.amount > b.amount;');
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/lexicographic|dec\.cmp/);
  });

  it('rejects a bare .sort() with no comparator', () => {
    expect(lint('export const x = (xs: string[]) => xs.sort();').code).not.toBe(0);
  });

  it('rejects Math.random for ids', () => {
    expect(lint('export const id = () => Math.random().toString(36);').code).not.toBe(0);
  });

  it('rejects Number(), parseFloat and toFixed', () => {
    expect(lint('export const x = (s: string) => Number(s);').code).not.toBe(0);
    expect(lint('export const x = (s: string) => parseFloat(s);').code).not.toBe(0);
    expect(lint('export const x = (n: number) => n.toFixed(2);').code).not.toBe(0);
  });

  it('allows arithmetic that is not on money — an index bump', () => {
    expect(lint('export const next = (i: number) => i + 1;').code).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm vitest run packages/dec/src/lint-fixture`
Expected: FAIL — `oxlint.base.json` does not exist.

- [ ] **Step 3: Implement the config**

`/Users/oleksandrsecond/Projects/agency/oxlint.base.json`:

```json
{
  "rules": {
    "no-restricted-syntax": [
      "error",
      {
        "selector": "BinaryExpression[operator=/^[*/]$/]",
        "message": "Money arithmetic belongs in @agency/dec (mul/div). A float cannot round-trip numeric(12,2)."
      },
      {
        "selector": "BinaryExpression[operator=/^(<|>|<=|>=)$/]",
        "message": "Comparing decimal strings with < or > is lexicographic: ['9.00','10.00'].sort() -> 10.00, 9.00. Use dec.cmp/gt/gte/lt/lte."
      },
      {
        "selector": "CallExpression[callee.name='Number']",
        "message": "Number() on a decimal string loses precision silently. Use @agency/dec."
      },
      {
        "selector": "CallExpression[callee.name=/^parse(Float|Int)$/]",
        "message": "parseFloat/parseInt on a decimal string loses precision silently. Use @agency/dec."
      },
      {
        "selector": "CallExpression[callee.property.name='toFixed']",
        "message": "toFixed rounds through a float. Use dec.round(value, scale)."
      },
      {
        "selector": "CallExpression[callee.object.name='Math'][callee.property.name='random']",
        "message": "Math.random() ids have no order. Two FIFO allocators were measured diverging by 1 200,00 UAH in 493 of 1000 runs. Use seq() or a ULID."
      },
      {
        "selector": "CallExpression[callee.property.name='sort'][arguments.length=0]",
        "message": "A bare .sort() is lexicographic and locale-blind. Pass an explicit comparator; use dec.cmp for decimals."
      }
    ]
  }
}
```

`/Users/oleksandrsecond/Projects/agency/.oxlintrc.json`:

```json
{
  "extends": ["./oxlint.base.json"],
  "ignorePatterns": ["**/dist/**", "**/node_modules/**", "packages/dec/src/dec.ts", "packages/dec/golden.json"]
}
```

`packages/dec/src/dec.ts` is exempt because it is the one module allowed to do the arithmetic. This
mirrors the four-module scoping already used at `yagoda-starter/backend/eslint.config.mjs:38-65`.

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm vitest run packages/dec/src/lint-fixture`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify the repo itself is clean under the new rules**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm lint`
Expected: exit 0. If `packages/dec/src/fx.ts` trips a rule, widen `ignorePatterns` to include it and
record why in this plan's task notes — do not weaken a rule.

- [ ] **Step 6: Commit**

```bash
cd /Users/oleksandrsecond/Projects/agency
git add oxlint.base.json .oxlintrc.json packages/dec/src/lint-fixture.test.ts
git commit -m "feat(lint): money and ordering rules, closing the measured comparison hole"
```

---

## Task 4: `packages/synth` — the synthetic-data corpus

**Files:**
- Create: `/Users/oleksandrsecond/Projects/agency/packages/synth/package.json`
- Create: `/Users/oleksandrsecond/Projects/agency/packages/synth/src/corpus.ts`
- Create: `/Users/oleksandrsecond/Projects/agency/packages/synth/src/stream.ts`
- Create: `/Users/oleksandrsecond/Projects/agency/packages/synth/src/index.ts`
- Test: `/Users/oleksandrsecond/Projects/agency/packages/synth/src/stream.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  `type Locale = 'de' | 'uk'`,
  `CORPUS: Record<Locale, { given: string[]; family: string[]; company: string[]; street: string[]; city: string[] }>`,
  `ALL_NAMES: ReadonlySet<string>` (every given and family name across every locale, for the Plan B allow-list check),
  `createStream(seed: number): Stream` where
  `Stream = { int(maxExclusive: number): number; pick<T>(xs: readonly T[]): T; person(l: Locale): string; company(l: Locale): string; address(l: Locale): string }`.

**Why an allow-list, not a deny-list:** `yagoda-crm/scripts/verify/checks/pii-boundary.mjs:34`'s
`NAME_RE` is Cyrillic-only, so it reports green while shipping `Hans Müller` in a public bundle. Plan
B's `synth:names` check inverts this: every proper-name-shaped literal in a mock's source must trace
to `ALL_NAMES`. That check is only possible if the corpus is a closed, exported set.

- [ ] **Step 1: Write the failing test**

`/Users/oleksandrsecond/Projects/agency/packages/synth/src/stream.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createStream, CORPUS, ALL_NAMES } from './index';

describe('createStream — deterministic given a seed', () => {
  it('produces an identical sequence for the same seed', () => {
    const a = createStream(20260909);
    const b = createStream(20260909);
    const left = Array.from({ length: 50 }, () => a.person('de'));
    const right = Array.from({ length: 50 }, () => b.person('de'));
    expect(left).toEqual(right);
  });

  it('produces a different sequence for a different seed', () => {
    const a = Array.from({ length: 20 }, ((s) => () => s.person('de'))(createStream(1)));
    const b = Array.from({ length: 20 }, ((s) => () => s.person('de'))(createStream(2)));
    expect(a).not.toEqual(b);
  });

  it('stays inside the declared range', () => {
    const s = createStream(7);
    for (let i = 0; i < 500; i++) {
      const n = s.int(10);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(10);
    }
  });
});

describe('corpus', () => {
  it('carries both locales the agency actually sells into', () => {
    expect(Object.keys(CORPUS).sort()).toEqual(['de', 'uk']);
    for (const locale of ['de', 'uk'] as const) {
      expect(CORPUS[locale].given.length).toBeGreaterThanOrEqual(20);
      expect(CORPUS[locale].family.length).toBeGreaterThanOrEqual(20);
    }
  });

  it('includes German names with umlauts, which a Cyrillic-only regex misses', () => {
    expect(CORPUS.de.family).toContain('Müller');
  });

  it('exports every name as one closed set for the allow-list check', () => {
    expect(ALL_NAMES.has('Müller')).toBe(true);
    expect(ALL_NAMES.has('Шевченко')).toBe(true);
    expect(ALL_NAMES.has('Nonexistent')).toBe(false);
  });

  it('every generated person is composed only of corpus names', () => {
    const s = createStream(42);
    for (let i = 0; i < 200; i++) {
      for (const part of s.person('uk').split(' ')) expect(ALL_NAMES.has(part)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm vitest run packages/synth`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Implement**

`/Users/oleksandrsecond/Projects/agency/packages/synth/package.json`:

```json
{
  "name": "@agency/synth",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

`/Users/oleksandrsecond/Projects/agency/packages/synth/src/corpus.ts`:

```ts
export type Locale = 'de' | 'uk';

export type LocaleCorpus = {
  given: string[];
  family: string[];
  company: string[];
  street: string[];
  city: string[];
};

/**
 * The closed set of proper names a mock is allowed to contain. Plan B's
 * `synth:names` check asserts that every name-shaped literal in a mock's SOURCE
 * traces back to here — an allow-list, because the deny-list it replaces
 * (pii-boundary.mjs:34) is Cyrillic-only and reports green on 'Hans Müller'.
 */
export const CORPUS: Record<Locale, LocaleCorpus> = {
  de: {
    given: ['Anna', 'Bernd', 'Claudia', 'Dieter', 'Elke', 'Frank', 'Greta', 'Hans', 'Ingrid',
      'Jörg', 'Katrin', 'Lars', 'Miriam', 'Norbert', 'Otto', 'Petra', 'Ralf', 'Sabine',
      'Thomas', 'Ute', 'Volker', 'Wiebke'],
    family: ['Albrecht', 'Baumann', 'Cordes', 'Dreher', 'Engel', 'Fischer', 'Gerber', 'Hoffmann',
      'Iversen', 'Jäger', 'Köhler', 'Lehmann', 'Müller', 'Neumann', 'Ostermann', 'Peters',
      'Richter', 'Schuster', 'Thiele', 'Ulrich', 'Vogel', 'Winkler'],
    company: ['Nordlicht Logistik', 'Rheinbach Handel', 'Ostsee Frucht', 'Wagner & Söhne',
      'Blaupunkt Service', 'Talhof Agrar', 'Kranich Transporte', 'Silberbach Technik'],
    street: ['Ahornweg', 'Bahnhofstraße', 'Comeniusplatz', 'Dorfstraße', 'Eichenallee',
      'Feldweg', 'Gartenstraße', 'Hauptstraße'],
    city: ['Bad Segeberg', 'Coesfeld', 'Detmold', 'Eutin', 'Fulda', 'Görlitz', 'Herford', 'Ilmenau'],
  },
  uk: {
    given: ['Андрій', 'Богдана', 'Василь', 'Галина', 'Дмитро', 'Оксана', 'Ігор', 'Катерина',
      'Леонід', 'Марина', 'Назар', 'Олена', 'Павло', 'Руслана', 'Сергій', 'Тетяна',
      'Устим', 'ףедір', 'Христина', 'Юрій', 'Ярослава', 'Зоряна'],
    family: ['Бондаренко', 'Ватаманюк', 'Гнатюк', 'Даниленко', 'Кравець', 'Лисенко', 'Мельник',
      'Наливайко', 'Оліфер', 'Панченко', 'Романюк', 'Савчук', 'Ткаченко', 'Українець',
      'Федорів', 'Харченко', 'Цимбал', 'Черненко', 'Шевченко', 'Ющенко', 'Яременко', 'Іванців'],
    company: ['Ягідний Край', 'Лан-Агро', 'Дніпро Логістик', 'Сонячна Долина',
      'Карпатський Сад', 'Степовик Транс', 'Зелена Хвиля', 'Полтава Фрукт'],
    street: ['Вишнева', 'Гагаріна', 'Зелена', 'Каштанова', 'Лугова', 'Миру', 'Незалежності', 'Садова'],
    city: ['Бахмач', 'Волочиськ', 'Гадяч', 'Дубно', 'Заліщики', 'Ізюм', 'Косів', 'Лубни'],
  },
};

export const ALL_NAMES: ReadonlySet<string> = new Set(
  (Object.keys(CORPUS) as Locale[]).flatMap((l) => [...CORPUS[l].given, ...CORPUS[l].family]),
);
```

`/Users/oleksandrsecond/Projects/agency/packages/synth/src/stream.ts`:

```ts
import { CORPUS, type Locale } from './corpus';

export type Stream = {
  int(maxExclusive: number): number;
  pick<T>(xs: readonly T[]): T;
  person(locale: Locale): string;
  company(locale: Locale): string;
  address(locale: Locale): string;
};

/** mulberry32 — small, fast, and identical across engines, so a seed pins the demo. */
export function createStream(seed: number): Stream {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const stream: Stream = {
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    pick: (xs) => xs[Math.floor(next() * xs.length)] as never,
    person: (locale) => `${stream.pick(CORPUS[locale].given)} ${stream.pick(CORPUS[locale].family)}`,
    company: (locale) => stream.pick(CORPUS[locale].company),
    address: (locale) =>
      `${stream.pick(CORPUS[locale].street)} ${stream.int(80) + 1}, ${stream.pick(CORPUS[locale].city)}`,
  };
  return stream;
}
```

`/Users/oleksandrsecond/Projects/agency/packages/synth/src/index.ts`:

```ts
export * from './corpus';
export * from './stream';
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm vitest run packages/synth`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/oleksandrsecond/Projects/agency
git add packages/synth
git commit -m "feat(synth): closed Latin+Cyrillic name corpus with seeded streams"
```

---

## Task 5: `packages/mock` — envelope primitives

**Files:**
- Create: `/Users/oleksandrsecond/Projects/agency/packages/mock/package.json`
- Create: `/Users/oleksandrsecond/Projects/agency/packages/mock/src/errors.ts`
- Create: `/Users/oleksandrsecond/Projects/agency/packages/mock/src/types.ts`
- Test: `/Users/oleksandrsecond/Projects/agency/packages/mock/src/errors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  `class DomainError extends Error { constructor(status: number, code: string, message: string, ctx?: Record<string, unknown>); readonly status: number; readonly code: string; readonly ctx?: Record<string, unknown> }`,
  `type ErrorEnvelope = { statusCode: number; error: string; message: string | string[]; path: string; timestamp: string; requestId?: string; code?: string; [k: string]: unknown }`,
  `envelopeOf(e: DomainError, path: string, now: string): ErrorEnvelope`,
  `type Paginated<T> = { data: T[]; total: number; page: number; limit: number }`,
  `type Instant = string & { readonly __instant: unique symbol }`,
  `type BusinessDate = string & { readonly __businessDate: unique symbol }`,
  `type Decimal2 = string & { readonly __decimal2: unique symbol }`,
  `createSeq(prefix: string): () => string`.

- [ ] **Step 1: Write the failing test**

`/Users/oleksandrsecond/Projects/agency/packages/mock/src/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DomainError, envelopeOf } from './errors';
import { createSeq } from './types';

describe('DomainError -> envelope', () => {
  it('emits the envelope the real backend emits, with code as the branch point', () => {
    const e = new DomainError(409, 'SHIFT_CLOSED', 'Shift is closed');
    expect(envelopeOf(e, '/shifts/s1/close', '2026-09-09T10:00:00.000Z')).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'Shift is closed',
      code: 'SHIFT_CLOSED',
      path: '/shifts/s1/close',
      timestamp: '2026-09-09T10:00:00.000Z',
    });
  });

  it('uses the canonical HTTP phrase, never a JS class name', () => {
    // yagoda-starter leaks 'ConflictException' here; the mock must not copy that.
    expect(envelopeOf(new DomainError(409, 'X', 'x'), '/p', 'T').error).toBe('Conflict');
    expect(envelopeOf(new DomainError(404, 'X', 'x'), '/p', 'T').error).toBe('Not Found');
    expect(envelopeOf(new DomainError(400, 'X', 'x'), '/p', 'T').error).toBe('Bad Request');
    expect(envelopeOf(new DomainError(500, 'X', 'x'), '/p', 'T').error).toBe('Internal Server Error');
  });

  it('spreads context fields alongside code, and never lets them clobber the envelope', () => {
    const e = new DomainError(409, 'LOGIN_TAKEN', 'taken', { field: 'login', statusCode: 999 });
    const env = envelopeOf(e, '/users', 'T');
    expect(env.field).toBe('login');
    expect(env.statusCode).toBe(409);
  });

  it('carries a string[] message for field-level validation failures', () => {
    const e = new DomainError(400, 'VALIDATION', ['login must not be empty', 'role is invalid']);
    expect(envelopeOf(e, '/users', 'T').message).toEqual([
      'login must not be empty', 'role is invalid',
    ]);
  });
});

describe('createSeq', () => {
  it('is monotonic and prefixed — never Math.random', () => {
    const next = createSeq('intake');
    expect([next(), next(), next()]).toEqual(['intake-000001', 'intake-000002', 'intake-000003']);
  });

  it('sorts lexicographically in creation order, which a SQL ORDER BY can reproduce', () => {
    const next = createSeq('x');
    const ids = Array.from({ length: 1200 }, next);
    expect([...ids].sort()).toEqual(ids);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm vitest run packages/mock`
Expected: FAIL — cannot resolve `./errors`.

- [ ] **Step 3: Implement**

`/Users/oleksandrsecond/Projects/agency/packages/mock/package.json`:

```json
{
  "name": "@agency/mock",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@agency/dec": "workspace:*" },
  "peerDependencies": { "axios": "^1.20.0" }
}
```

`/Users/oleksandrsecond/Projects/agency/packages/mock/src/errors.ts`:

```ts
export type ErrorEnvelope = {
  statusCode: number;
  /** Canonical HTTP phrase. DECORATIVE — never branch on it. */
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
  requestId?: string;
  /** THE discriminator. Every client branch reads this and nothing else. */
  code?: string;
  [context: string]: unknown;
};

export class DomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string | string[],
    readonly ctx?: Record<string, unknown>,
  ) {
    super(Array.isArray(message) ? message.join('; ') : message);
    this.name = 'DomainError';
    this.messages = message;
  }
  readonly messages: string | string[];
}

const PHRASES: Record<number, string> = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  409: 'Conflict', 410: 'Gone', 422: 'Unprocessable Entity', 429: 'Too Many Requests',
  500: 'Internal Server Error', 503: 'Service Unavailable',
};

export function envelopeOf(e: DomainError, path: string, now: string): ErrorEnvelope {
  // Context first, envelope second: envelope keys always win.
  return {
    ...(e.ctx ?? {}),
    statusCode: e.status,
    error: PHRASES[e.status] ?? 'Error',
    message: e.messages,
    code: e.code,
    path,
    timestamp: now,
  };
}
```

`/Users/oleksandrsecond/Projects/agency/packages/mock/src/types.ts`:

```ts
export type Paginated<T> = { data: T[]; total: number; page: number; limit: number };

declare const instantBrand: unique symbol;
declare const businessDateBrand: unique symbol;
declare const decimal2Brand: unique symbol;

/** ISO-8601 with a Z suffix. From a timestamptz. */
export type Instant = string & { readonly [instantBrand]: true };
/** 'YYYY-MM-DD'. Server-derived, never accepted in a request body. */
export type BusinessDate = string & { readonly [businessDateBrand]: true };
/** Canonical 2-decimal string. */
export type Decimal2 = string & { readonly [decimal2Brand]: true };

export const asInstant = (v: string): Instant => v as Instant;
export const asBusinessDate = (v: string): BusinessDate => v as BusinessDate;
export const asDecimal2 = (v: string): Decimal2 => v as Decimal2;

/**
 * Store-assigned monotonic ids. Zero-padded so lexicographic order equals
 * creation order — a property a SQL `ORDER BY id` reproduces and
 * `Math.random()` does not.
 */
export function createSeq(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${String(++n).padStart(6, '0')}`;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm vitest run packages/mock`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/oleksandrsecond/Projects/agency
git add packages/mock
git commit -m "feat(mock): DomainError, the real error envelope, Paginated and seq ids"
```

---

## Task 6: `packages/mock` — the route table and the adapter

This is the load-bearing task of the whole plan. The seam is one file.

**Files:**
- Create: `/Users/oleksandrsecond/Projects/agency/packages/mock/src/router.ts`
- Create: `/Users/oleksandrsecond/Projects/agency/packages/mock/src/adapter.ts`
- Create: `/Users/oleksandrsecond/Projects/agency/packages/mock/src/index.ts`
- Test: `/Users/oleksandrsecond/Projects/agency/packages/mock/src/adapter.test.ts`

**Interfaces:**
- Consumes: `DomainError`, `envelopeOf` (Task 5).
- Produces:
  `type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'`,
  `type Ctx = { params: Record<string, string>; query: Record<string, string>; body: unknown; actor: Actor }`,
  `type Actor = { id: string; role: string }`,
  `type Route = { method: Method; path: string; caps?: string[]; status?: number; handler: (c: Ctx) => unknown }`,
  `compile(routes: Route[]): { match(method: string, url: string): { route: Route; params: Record<string, string> } | null }`,
  `mockAdapter(routes: Route[], opts: { caps: Set<string>; actor: Actor; now?: () => string; latencyMs?: number }): AxiosAdapter`.

**The trap this task exists to close.** Verified in axios 1.20.0:
`lib/core/dispatchRequest.js` calls `adapter(config).then(...)` and contains **zero** references to
`settle`. `validateStatus` lives only in `lib/core/settle.js`, which `xhr.js`, `fetch.js` and
`http.js` each call *themselves*. A custom adapter therefore owns status handling — an adapter that
**resolves** a 409 delivers it to TanStack Query as a **success**.

- [ ] **Step 1: Write the failing test**

`/Users/oleksandrsecond/Projects/agency/packages/mock/src/adapter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import axios, { AxiosError } from 'axios';
import { mockAdapter, type Route } from './index';
import { DomainError } from './errors';

const ACTOR = { id: 'u1', role: 'owner' };
const NOW = () => '2026-09-09T10:00:00.000Z';

function client(routes: Route[], caps: string[] = []) {
  return axios.create({
    baseURL: 'http://mock',
    paramsSerializer: { indexes: null },
    adapter: mockAdapter(routes, { caps: new Set(caps), actor: ACTOR, now: NOW }),
  });
}

describe('happy path', () => {
  it('resolves a 200 with the handler body', async () => {
    const c = client([{ method: 'GET', path: '/suppliers', handler: () => ({ data: [], total: 0, page: 1, limit: 20 }) }]);
    const res = await c.get('/suppliers');
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ data: [], total: 0, page: 1, limit: 20 });
  });

  it('honours an explicit status — POST /intakes/:id/void returns 201 on the real backend', async () => {
    const c = client([{ method: 'POST', path: '/intakes/:id/void', status: 201, handler: () => ({ ok: true }) }]);
    expect((await c.post('/intakes/i1/void')).status).toBe(201);
  });

  it('extracts path params and query', async () => {
    const seen: unknown[] = [];
    const c = client([{ method: 'GET', path: '/suppliers/:id', handler: (ctx) => { seen.push(ctx.params, ctx.query); return {}; } }]);
    await c.get('/suppliers/s-42', { params: { page: '2' } });
    expect(seen[0]).toEqual({ id: 's-42' });
    expect(seen[1]).toEqual({ page: '2' });
  });

  it('gives the handler an actor from the session, never from the body', async () => {
    let actor: unknown;
    const c = client([{ method: 'POST', path: '/intakes', handler: (ctx) => { actor = ctx.actor; return {}; } }]);
    await c.post('/intakes', { actor: { id: 'FORGED', role: 'owner' } });
    expect(actor).toEqual(ACTOR);
  });
});

describe('THE TRAP: a non-2xx must THROW, because dispatchRequest never calls settle()', () => {
  it('rejects with an AxiosError carrying the real envelope', async () => {
    const c = client([{
      method: 'POST', path: '/shifts/:id/close',
      handler: () => { throw new DomainError(409, 'SHIFT_CLOSED', 'Shift is closed'); },
    }]);
    const err = await c.post('/shifts/s1/close').then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(AxiosError);
    expect((err as AxiosError).response?.status).toBe(409);
    expect((err as AxiosError).response?.data).toMatchObject({
      statusCode: 409, error: 'Conflict', code: 'SHIFT_CLOSED',
    });
  });

  it('does NOT resolve a 4xx — the regression this whole test file exists for', async () => {
    const c = client([{ method: 'GET', path: '/x', handler: () => { throw new DomainError(404, 'NOT_FOUND', 'no'); } }]);
    await expect(c.get('/x')).rejects.toBeTruthy();
  });

  it('turns an unexpected throw into a 500 without leaking the message', async () => {
    const c = client([{ method: 'GET', path: '/boom', handler: () => { throw new Error('secret internals'); } }]);
    const err = await c.get('/boom').then(() => null, (e: AxiosError) => e);
    expect(err?.response?.status).toBe(500);
    expect(JSON.stringify(err?.response?.data)).not.toContain('secret internals');
  });
});

describe('the JSON round trip is the divergence killer', () => {
  it('drops undefined so the mock cannot return a shape no server could', async () => {
    const c = client([{ method: 'GET', path: '/x', handler: () => ({ a: 1, b: undefined, c: null }) }]);
    const { data } = await c.get('/x');
    expect(Object.keys(data)).toEqual(['a', 'c']);
    expect(data.c).toBeNull();
  });

  it('serialises a Date to an ISO string, as JSON over the wire would', async () => {
    const c = client([{ method: 'GET', path: '/x', handler: () => ({ at: new Date('2026-01-02T03:04:05.000Z') }) }]);
    expect((await c.get('/x')).data.at).toBe('2026-01-02T03:04:05.000Z');
  });

  it('breaks object identity, so a handler cannot hand out a live store reference', async () => {
    const row = { id: 'a' };
    const c = client([{ method: 'GET', path: '/x', handler: () => row }]);
    expect((await c.get('/x')).data).not.toBe(row);
  });
});

describe('capabilities gate the ROUTE, not just the menu', () => {
  it('404s an off-profile route so a typed URL cannot reach the other product', async () => {
    const c = client([{ method: 'GET', path: '/fleet/pnl', caps: ['fleet'], handler: () => ({ secret: 1 }) }], []);
    const err = await c.get('/fleet/pnl').then(() => null, (e: AxiosError) => e);
    expect(err?.response?.status).toBe(404);
    expect(err?.response?.data).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('serves the route when the capability is present', async () => {
    const c = client([{ method: 'GET', path: '/fleet/pnl', caps: ['fleet'], handler: () => ({ ok: 1 }) }], ['fleet']);
    expect((await c.get('/fleet/pnl')).status).toBe(200);
  });
});

describe('unmatched routes', () => {
  it('404s an unknown path rather than hanging', async () => {
    const c = client([]);
    const err = await c.get('/nope').then(() => null, (e: AxiosError) => e);
    expect(err?.response?.status).toBe(404);
  });

  it('does not match a different method on the same path', async () => {
    const c = client([{ method: 'GET', path: '/x', handler: () => ({}) }]);
    await expect(c.post('/x')).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm add -w -D axios@^1.20.0 && pnpm vitest run packages/mock/src/adapter`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Implement the router**

`/Users/oleksandrsecond/Projects/agency/packages/mock/src/router.ts`:

```ts
export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type Actor = { id: string; role: string };

export type Ctx = {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  actor: Actor;
};

export type Route = {
  method: Method;
  /** Express-style, e.g. '/suppliers/:id'. */
  path: string;
  /** Capabilities required. Absent means always reachable. */
  caps?: string[];
  /** Success status. Defaults to 200; the real backend returns 201 from several POSTs. */
  status?: number;
  handler: (c: Ctx) => unknown;
};

type Compiled = { route: Route; re: RegExp; keys: string[] };

export function compile(routes: Route[]) {
  const compiled: Compiled[] = routes.map((route) => {
    const keys: string[] = [];
    const pattern = route.path
      .split('/')
      .map((segment) => {
        if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        keys.push(segment.slice(1));
        return '([^/]+)';
      })
      .join('/');
    return { route, re: new RegExp(`^${pattern}$`), keys };
  });

  return {
    match(method: string, path: string) {
      const upper = method.toUpperCase();
      for (const c of compiled) {
        if (c.route.method !== upper) continue;
        const m = c.re.exec(path);
        if (!m) continue;
        const params: Record<string, string> = {};
        c.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1] as string); });
        return { route: c.route, params };
      }
      return null;
    },
  };
}
```

- [ ] **Step 4: Implement the adapter**

`/Users/oleksandrsecond/Projects/agency/packages/mock/src/adapter.ts`:

```ts
import { AxiosError, type AxiosAdapter, type AxiosRequestConfig } from 'axios';
import { DomainError, envelopeOf, type ErrorEnvelope } from './errors';
import { compile, type Actor, type Route } from './router';

export type MockAdapterOptions = {
  caps: Set<string>;
  actor: Actor;
  now?: () => string;
  /**
   * Default 0. The demo is a timed performance — logistic's script budgets 23
   * minutes across 8 screens — so artificial latency is opt-in, never the default.
   */
  latencyMs?: number;
};

function splitUrl(config: AxiosRequestConfig): { path: string; query: Record<string, string> } {
  const raw = config.url ?? '/';
  const [pathPart = '/', search = ''] = raw.split('?');
  const query: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(search)) query[k] = v;
  for (const [k, v] of Object.entries((config.params as Record<string, unknown>) ?? {})) {
    if (v !== undefined && v !== null) query[k] = String(v);
  }
  return { path: pathPart, query };
}

function parseBody(data: unknown): unknown {
  if (typeof data !== 'string') return data ?? null;
  try { return JSON.parse(data); } catch { return data; }
}

export function mockAdapter(routes: Route[], opts: MockAdapterOptions): AxiosAdapter {
  const table = compile(routes);
  const now = opts.now ?? (() => new Date().toISOString());

  return async (config) => {
    if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));

    const { path, query } = splitUrl(config);
    const hit = table.match(config.method ?? 'get', path);

    // Capabilities gate the ROUTE. An off-profile screen is not merely hidden
    // from the menu — its data is unreachable, so a typed URL cannot surface
    // another client's product.
    const denied = !hit || (hit.route.caps?.some((c) => !opts.caps.has(c)) ?? false);

    let status: number;
    let payload: unknown;

    if (denied) {
      status = 404;
      payload = envelopeOf(new DomainError(404, 'NOT_FOUND', 'Not found'), path, now());
    } else {
      try {
        payload = hit.route.handler({
          params: hit.params,
          query,
          body: parseBody(config.data),
          actor: opts.actor, // from the session, never the body
        });
        status = hit.route.status ?? 200;
      } catch (e) {
        const domain = e instanceof DomainError
          ? e
          : new DomainError(500, 'INTERNAL', 'Internal server error');
        status = domain.status;
        payload = envelopeOf(domain, path, now());
      }
    }

    const response = {
      status,
      statusText: '',
      headers: {},
      config,
      request: null,
      // The divergence killer: undefined vanishes, Dates become strings, object
      // identity breaks — exactly as JSON over the wire would do it.
      data: JSON.parse(JSON.stringify(payload)) as unknown,
    };

    // MUST throw. axios's dispatchRequest calls adapter(config).then(...) and
    // never calls settle(); validateStatus lives inside each built-in adapter.
    // An adapter that RESOLVES a 409 hands TanStack Query a success.
    if (status >= 400) {
      const envelope = response.data as ErrorEnvelope;
      const message = Array.isArray(envelope?.message)
        ? envelope.message.join('; ')
        : (envelope?.message ?? `Request failed with status code ${status}`);
      throw new AxiosError(
        String(message),
        status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
        config,
        null,
        response as never,
      );
    }

    return response as never;
  };
}
```

`/Users/oleksandrsecond/Projects/agency/packages/mock/src/index.ts`:

```ts
export * from './errors';
export * from './types';
export * from './router';
export * from './adapter';
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm vitest run packages/mock`
Expected: PASS — 6 from Task 5 plus 13 here.

- [ ] **Step 6: Prove the claim about axios rather than trusting the comment**

Run:

```bash
cd /Users/oleksandrsecond/Projects/agency
grep -c settle node_modules/axios/lib/core/dispatchRequest.js
grep -l settle node_modules/axios/lib/adapters/*.js
```

Expected: `0`, then `http.js`, `xhr.js`, `fetch.js`. If `dispatchRequest.js` ever returns non-zero,
axios has changed and the throwing branch may be re-examined — until then it stays.

- [ ] **Step 7: Commit**

```bash
cd /Users/oleksandrsecond/Projects/agency
git add packages/mock package.json pnpm-lock.yaml
git commit -m "feat(mock): the axios adapter seam, throwing on non-2xx and JSON round-tripping"
```

---

## Task 7: `packages/mock` — profiles

**Files:**
- Create: `/Users/oleksandrsecond/Projects/agency/packages/mock/src/profiles.ts`
- Modify: `/Users/oleksandrsecond/Projects/agency/packages/mock/src/index.ts` — add `export * from './profiles';`
- Test: `/Users/oleksandrsecond/Projects/agency/packages/mock/src/profiles.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  `type ProfileDef<C extends string> = { id: string; label: string; caps: readonly C[] }`,
  `createProfiles<C extends string>(defs: readonly ProfileDef<C>[], fallbackId: string): { resolve(search: string, envProfile?: string): ProfileDef<C>; capsOf(p: ProfileDef<C>): Set<C>; href(search: string, id: string): string; all: readonly ProfileDef<C>[] }`.

**Ported from** `logistic/src/lib/profile.ts`. Two properties are load-bearing and must survive:
the profile is read once at module start from `?profile=` then `VITE_PROFILE`, and it is **never
persisted** — a stored profile survives "reset demo data" and leaves the show in the wrong product.

- [ ] **Step 1: Write the failing test**

`/Users/oleksandrsecond/Projects/agency/packages/mock/src/profiles.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createProfiles } from './profiles';

const P = createProfiles(
  [
    { id: 'custody', label: 'Cargo custody', caps: ['custody'] },
    { id: 'fleet', label: 'Fleet & money', caps: ['fleet', 'money'] },
    { id: 'solo', label: 'Just the numbers', caps: ['money'] },
  ] as const,
  'custody',
);

describe('resolve', () => {
  it('reads ?profile= first', () => {
    expect(P.resolve('?profile=fleet').id).toBe('fleet');
  });

  it('falls back to VITE_PROFILE when the query is absent', () => {
    expect(P.resolve('', 'solo').id).toBe('solo');
  });

  it('prefers the query over the env', () => {
    expect(P.resolve('?profile=fleet', 'solo').id).toBe('fleet');
  });

  it('is case-insensitive', () => {
    expect(P.resolve('?profile=FLEET').id).toBe('fleet');
  });

  it('falls back for an unknown id rather than throwing mid-demo', () => {
    expect(P.resolve('?profile=nope').id).toBe('custody');
    expect(P.resolve('').id).toBe('custody');
  });
});

describe('capsOf', () => {
  it('returns the capability set the adapter gates on', () => {
    expect(P.capsOf(P.resolve('?profile=fleet'))).toEqual(new Set(['fleet', 'money']));
  });

  it('gives solo money but not fleet, so the fleet routes 404 for it', () => {
    const caps = P.capsOf(P.resolve('?profile=solo'));
    expect(caps.has('money')).toBe(true);
    expect(caps.has('fleet')).toBe(false);
  });
});

describe('href — rewriting the current URL for sharing', () => {
  it('adds the profile when absent', () => {
    expect(P.href('', 'fleet')).toBe('?profile=fleet');
  });

  it('replaces an existing profile, preserving other params', () => {
    expect(P.href('?point=p1&profile=custody', 'fleet')).toBe('?point=p1&profile=fleet');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm vitest run packages/mock/src/profiles`
Expected: FAIL — cannot resolve `./profiles`.

- [ ] **Step 3: Implement**

`/Users/oleksandrsecond/Projects/agency/packages/mock/src/profiles.ts`:

```ts
export type ProfileDef<C extends string> = {
  id: string;
  label: string;
  caps: readonly C[];
};

/**
 * One codebase, several prospects. Ported from logistic/src/lib/profile.ts.
 *
 * The profile is NEVER persisted. A stored profile survives "reset demo data"
 * — pre-call step #1 — and leaves the show in the wrong product.
 */
export function createProfiles<C extends string>(
  defs: readonly ProfileDef<C>[],
  fallbackId: string,
) {
  const fallback = defs.find((d) => d.id === fallbackId) ?? defs[0];
  if (!fallback) throw new Error('createProfiles: at least one profile is required');

  return {
    all: defs,

    resolve(search: string, envProfile?: string): ProfileDef<C> {
      const fromQuery = new URLSearchParams(search).get('profile');
      const wanted = (fromQuery ?? envProfile ?? '').toLowerCase();
      return defs.find((d) => d.id.toLowerCase() === wanted) ?? fallback;
    },

    capsOf(p: ProfileDef<C>): Set<C> {
      return new Set(p.caps);
    },

    href(search: string, id: string): string {
      const params = new URLSearchParams(search);
      params.set('profile', id);
      return `?${params.toString()}`;
    },
  };
}
```

- [ ] **Step 4: Wire it into the barrel**

Add to `/Users/oleksandrsecond/Projects/agency/packages/mock/src/index.ts`:

```ts
export * from './profiles';
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm vitest run packages/mock`
Expected: PASS — 9 new tests, 28 total in the package.

- [ ] **Step 6: Commit**

```bash
cd /Users/oleksandrsecond/Projects/agency
git add packages/mock
git commit -m "feat(mock): capability profiles, unpersisted, gating routes not menus"
```

---

## Task 8: `packages/kit` — extract the agency UI kit

**Files:**
- Create: `/Users/oleksandrsecond/Projects/agency/packages/kit/package.json`
- Create: `/Users/oleksandrsecond/Projects/agency/packages/kit/src/**` (copied)
- Create: `/Users/oleksandrsecond/Projects/agency/packages/kit/PROVENANCE.md`
- Create: `/Users/oleksandrsecond/Projects/agency/packages/kit/components.json`
- Test: `/Users/oleksandrsecond/Projects/agency/packages/kit/src/*.test.tsx` (copied, 30 of them)

**Interfaces:**
- Consumes: nothing.
- Produces: `@agency/kit` with subpath exports — `@agency/kit/button`, `@agency/kit/data-table`,
  `@agency/kit/templates/list-page`, etc. Task 9's template imports from here.

**Measured 2026-09-09** at `yagoda-starter/frontend/src/shared/ui`: 84 files, 52 non-test
components, 30 co-located tests, 3,514 non-test LOC, **zero** imports above `shared/`, 13
radix-touching primitives, 3 page templates.

- [ ] **Step 1: Write the failing test**

`/Users/oleksandrsecond/Projects/agency/packages/kit/src/kit.contract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('.', import.meta.url).pathname;

const files = (): string[] =>
  readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.tsx'));

describe('kit extraction contract', () => {
  it('carries the measured file count', () => {
    const nonTest = files().filter((f) => !f.endsWith('.test.tsx'));
    expect(nonTest.length).toBeGreaterThanOrEqual(52);
  });

  it('ships the three page templates', () => {
    for (const t of ['dashboard-page', 'document-page', 'list-page']) {
      expect(existsSync(join(SRC, 'templates', `${t}.tsx`))).toBe(true);
    }
  });

  it('imports nothing above shared/ — the property that makes the lift mechanical', () => {
    const offenders = files().filter((f) =>
      /@\/(entities|features|widgets|pages|app)\//.test(readFileSync(join(SRC, f), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('has no @/shared alias left after the rewrite', () => {
    const offenders = files().filter((f) => /@\/shared\//.test(readFileSync(join(SRC, f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('records where it came from', () => {
    const p = readFileSync(join(SRC, '..', 'PROVENANCE.md'), 'utf8');
    expect(p).toMatch(/yagoda-starter/);
    expect(p).toMatch(/[0-9a-f]{7,40}/); // a commit sha
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm vitest run packages/kit`
Expected: FAIL — the directory does not exist.

- [ ] **Step 3: Copy the kit and rewrite its aliases**

```bash
cd /Users/oleksandrsecond/Projects/agency
mkdir -p packages/kit/src
cp -R /Users/oleksandrsecond/Projects/yagoda-starter/frontend/src/shared/ui/. packages/kit/src/
# The kit uses cn() and a few helpers from shared/lib; bring only what it references.
mkdir -p packages/kit/src/lib
for m in cn clipboard theme; do
  src=/Users/oleksandrsecond/Projects/yagoda-starter/frontend/src/shared/lib/$m
  [ -d "$src" ] && cp -R "$src" packages/kit/src/lib/ || true
done
# Rewrite the two alias forms to relative imports.
grep -rl '@/shared/' packages/kit/src | while read -r f; do
  perl -pi -e 's{\@/shared/ui/}{./}g; s{\@/shared/lib/}{./lib/}g' "$f"
done
SHA=$(git -C /Users/oleksandrsecond/Projects/yagoda-starter rev-parse --short HEAD)
cat > packages/kit/PROVENANCE.md <<EOF
# Provenance

Lifted from \`yagoda-starter/frontend/src/shared/ui\` at commit \`$SHA\` on 2026-09-09.

Measured at lift: 84 files, 52 non-test components, 30 co-located tests, 3,514 non-test LOC,
zero imports above \`shared/\`, 13 radix-touching primitives, 3 page templates.

The source repo is NOT absorbed, NOT forked and NOT edited. This is a dated snapshot; see the
spec's open decision on kit drift.
EOF
```

- [ ] **Step 4: Add the package manifest**

`/Users/oleksandrsecond/Projects/agency/packages/kit/package.json`:

```json
{
  "name": "@agency/kit",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./lib/*": "./src/lib/*/index.ts",
    "./templates/*": "./src/templates/*.tsx",
    "./*": "./src/*.tsx"
  },
  "peerDependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "radix-ui": "^1.6.7",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.6.0",
    "lucide-react": "^1.31.0"
  }
}
```

`/Users/oleksandrsecond/Projects/agency/packages/kit/components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": { "config": "", "css": "src/index.css", "baseColor": "neutral", "cssVariables": true },
  "iconLibrary": "lucide",
  "aliases": { "components": "@agency/kit", "ui": "@agency/kit", "utils": "@agency/kit/lib/cn" }
}
```

`new-york` is the spec's call (§11): the product wins, because conversion is the expensive end and
the three existing mocks are frozen, so there is nothing to migrate.

- [ ] **Step 5: Install the peer dependencies and run the tests**

```bash
cd /Users/oleksandrsecond/Projects/agency
pnpm add -w -D react@^19.2.8 react-dom@^19.2.8 radix-ui@^1.6.7 class-variance-authority@^0.7.1 \
  clsx@^2.1.1 tailwind-merge@^3.6.0 lucide-react@^1.31.0 \
  @testing-library/react@^16.3.2 @testing-library/jest-dom@^7.0.1 jsdom@^30.0.1 \
  @types/react@^19.2.18 @types/react-dom@^19.2.4
pnpm vitest run packages/kit
```

Expected: the 5 contract tests PASS. The 30 copied component tests will fail until Step 6.

- [ ] **Step 6: Give the copied component tests a jsdom environment**

Add to `/Users/oleksandrsecond/Projects/agency/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['packages/{dec,synth,mock,cli}/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'dom',
          include: ['packages/kit/src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
  },
});
```

`/Users/oleksandrsecond/Projects/agency/vitest.setup.ts` — copy verbatim from
`yagoda-starter/frontend/src/test-setup.ts`, keeping the four jsdom stubs (ResizeObserver, pointer
capture, matchMedia, storage clear) and `configure({ asyncUtilTimeout: 5000 })`. These are the
non-obvious cost of getting radix + vaul + Tailwind tests green; an agent will not rediscover them.
Drop only the i18n initialisation, which the kit does not have.

- [ ] **Step 7: Run everything and watch it pass**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm test`
Expected: PASS across both projects. If a copied test fails because it imported an i18n helper,
replace that import with the component's `labels` prop default and record it in `PROVENANCE.md`.

- [ ] **Step 8: Commit**

```bash
cd /Users/oleksandrsecond/Projects/agency
git add packages/kit vitest.config.ts vitest.setup.ts package.json pnpm-lock.yaml
git commit -m "feat(kit): extract 52 components and 3 page templates from yagoda-starter"
```

---

## Task 9: The mock template

**Files:**
- Create: `/Users/oleksandrsecond/Projects/agency/templates/mock/package.json.hbs`
- Create: `/Users/oleksandrsecond/Projects/agency/templates/mock/vite.config.ts`
- Create: `/Users/oleksandrsecond/Projects/agency/templates/mock/index.html.hbs`
- Create: `/Users/oleksandrsecond/Projects/agency/templates/mock/src/index.css`
- Create: `/Users/oleksandrsecond/Projects/agency/templates/mock/src/main.tsx`
- Create: `/Users/oleksandrsecond/Projects/agency/templates/mock/src/app/router.tsx`
- Create: `/Users/oleksandrsecond/Projects/agency/templates/mock/src/api/client.ts`
- Create: `/Users/oleksandrsecond/Projects/agency/templates/mock/src/api/routes.ts`
- Create: `/Users/oleksandrsecond/Projects/agency/templates/mock/src/profiles.ts.hbs`
- Create: `/Users/oleksandrsecond/Projects/agency/templates/mock/src/domain/{types,seed,calc}.ts`
- Create: `/Users/oleksandrsecond/Projects/agency/templates/mock/src/pages/OverviewPage.tsx`
- Create: `/Users/oleksandrsecond/Projects/agency/templates/mock/wrangler.jsonc.hbs`
- Create: `/Users/oleksandrsecond/Projects/agency/templates/mock/.oxlintrc.json`

**Interfaces:**
- Consumes: `@agency/kit`, `@agency/mock`, `@agency/dec`, `@agency/synth`.
- Produces: a directory tree that Task 10's `agency new` copies with `{{slug}}`, `{{title}}`,
  `{{locale}}` and `{{profiles}}` substituted.

**Five files carry `/* @scaffold-owned */`** because they fail *silently* when an agent rewrites
them: `src/app/router.tsx`, `src/api/client.ts`, the persist config in `src/main.tsx`,
`src/profiles.ts`, and the `@source` line in `src/index.css`. Plan B hashes them.

- [ ] **Step 1: Write the failing test**

`/Users/oleksandrsecond/Projects/agency/packages/cli/src/template.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const T = new URL('../../../templates/mock/', import.meta.url).pathname;
const read = (p: string) => readFileSync(join(T, p), 'utf8');

describe('template invariants', () => {
  it('uses createHashRouter — one word from the product, no basename, no 404.html', () => {
    const r = read('src/app/router.tsx');
    expect(r).toMatch(/createHashRouter/);
    expect(r).not.toMatch(/basename/);
  });

  it('has exactly one axios.create, and the adapter is the only mock/product difference', () => {
    const c = read('src/api/client.ts');
    expect(c.match(/axios\.create/g)).toHaveLength(1);
    expect(c).toMatch(/adapter:.*VITE_MOCK.*mockAdapter/s);
    expect(c).toMatch(/paramsSerializer:\s*\{\s*indexes:\s*null\s*\}/);
  });

  it('carries the Tailwind @source line, without which kit utilities vanish from dist CSS', () => {
    expect(read('src/index.css')).toMatch(/@source\s+".*packages\/kit\/src\/\*\*\/\*\.tsx"/);
  });

  it('marks the five silently-failing files as scaffold-owned', () => {
    for (const f of ['src/app/router.tsx', 'src/api/client.ts', 'src/main.tsx']) {
      expect(read(f)).toMatch(/@scaffold-owned/);
    }
    expect(read('src/profiles.ts.hbs')).toMatch(/@scaffold-owned/);
    expect(read('src/index.css')).toMatch(/@scaffold-owned/);
  });

  it('persists no domain rows — only UI state', () => {
    const m = read('src/main.tsx');
    expect(m).toMatch(/partialize/);
    expect(m).toMatch(/theme|sidebar/);
    expect(m).not.toMatch(/origin:\s*'seed'/);
  });

  it('builds at base "/" so one Worker per slug serves it at root', () => {
    expect(read('vite.config.ts')).toMatch(/base:\s*process\.env\.MOCK_BASE\s*\?\?\s*'\/'/);
  });

  it('forbids the rejected dependencies', () => {
    const pkg = read('package.json.hbs');
    for (const banned of ['"msw"', '@mswjs/data', '@msw/data', 'pglite', '"zod"', 'i18next']) {
      expect(pkg).not.toContain(banned);
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm vitest run packages/cli`
Expected: FAIL — `ENOENT` on `templates/mock/src/app/router.tsx`.

- [ ] **Step 3: Write the scaffold-owned files**

`/Users/oleksandrsecond/Projects/agency/templates/mock/src/api/client.ts`:

```ts
/* @scaffold-owned — the seam. Editing this file breaks the mock/product swap. */
import axios from 'axios';
import { mockAdapter } from '@agency/mock';
import { routes } from './routes';
import { CAPS, ACTOR } from '../profiles';

export const httpClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  // express@5's `simple` query parser + forbidNonWhitelisted 400s on axios's
  // default bracketed array serialization.
  paramsSerializer: { indexes: null },
  adapter: import.meta.env.VITE_MOCK ? mockAdapter(routes, { caps: CAPS, actor: ACTOR }) : undefined,
});
```

`/Users/oleksandrsecond/Projects/agency/templates/mock/src/app/router.tsx`:

```tsx
/* @scaffold-owned — hash history needs no basename, no 404.html, no host config.
   The product's equivalent is createBrowserRouter; that word is the entire diff. */
import { createHashRouter, type RouteObject } from 'react-router';
import { OverviewPage } from '../pages/OverviewPage';

export const routes: RouteObject[] = [
  { path: '/', element: <OverviewPage /> },
  { path: '*', element: <OverviewPage /> },
];

export const router = createHashRouter(routes);
```

`/Users/oleksandrsecond/Projects/agency/templates/mock/src/index.css`:

```css
/* @scaffold-owned — without the @source line Tailwind skips node_modules, and the
   kit's utilities (bg-card, text-primary, rounded-xl) are silently absent from dist. */
@import "tailwindcss";
@source "../../../packages/kit/src/**/*.tsx";
@import "tw-animate-css";
```

`/Users/oleksandrsecond/Projects/agency/templates/mock/src/main.tsx`:

```tsx
/* @scaffold-owned — the persist config. Lane A persists NO domain rows: the seed
   regenerates on every load, so "reset demo data" is a reload and a redeploy
   cannot destroy anything. Only UI state is stored. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { router } from './app/router';
import './index.css';

type UiState = { theme: 'light' | 'dark'; sidebar: boolean; setTheme(t: 'light' | 'dark'): void };

export const useUi = create<UiState>()(
  persist(
    (set) => ({ theme: 'light', sidebar: true, setTheme: (theme) => set({ theme }) }),
    { name: '{{slug}}:ui:v1', partialize: (s) => ({ theme: s.theme, sidebar: s.sidebar }) },
  ),
);

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
```

`/Users/oleksandrsecond/Projects/agency/templates/mock/src/profiles.ts.hbs`:

```ts
/* @scaffold-owned — generated from `agency new --profiles`. The profile is read
   once at start and NEVER persisted: a stored profile survives "reset demo data". */
import { createProfiles, type Actor } from '@agency/mock';

export const PROFILES = createProfiles(
  [
{{#each profiles}}
    { id: '{{this.id}}', label: '{{this.label}}', caps: [{{#each this.caps}}'{{this}}',{{/each}}] },
{{/each}}
  ] as const,
  '{{defaultProfile}}',
);

export const PROFILE = PROFILES.resolve(
  typeof window === 'undefined' ? '' : window.location.search,
  import.meta.env.VITE_PROFILE,
);

export const CAPS = PROFILES.capsOf(PROFILE);
export const ACTOR: Actor = { id: 'demo-user', role: 'owner' };
```

`/Users/oleksandrsecond/Projects/agency/templates/mock/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // One Worker per slug serves the mock at root, so base is '/' unless a build
  // deliberately targets a subpath. This is what makes the topology reversible.
  base: process.env.MOCK_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  define: { 'import.meta.env.VITE_MOCK': JSON.stringify(process.env.VITE_MOCK ?? '1') },
});
```

- [ ] **Step 4: Write the remaining template files**

`templates/mock/src/api/routes.ts`:

```ts
import type { Route } from '@agency/mock';
import { overview } from '../domain/calc';

/** One handler per screen action. Each is the future Nest controller body. */
export const routes: Route[] = [
  { method: 'GET', path: '/overview', handler: () => overview() },
];
```

`templates/mock/src/domain/types.ts`:

```ts
import type { Decimal2 } from '@agency/mock';

export type Overview = { headline: string; total: Decimal2; rows: number };
```

`templates/mock/src/domain/seed.ts`:

```ts
import { createStream } from '@agency/synth';

export const SEED = 20260909;

export function buildSeed() {
  const s = createStream(SEED);
  return { people: Array.from({ length: 12 }, () => s.person('{{locale}}' as 'de' | 'uk')) };
}
```

`templates/mock/src/domain/calc.ts`:

```ts
import { sum } from '@agency/dec';
import { asDecimal2 } from '@agency/mock';
import { buildSeed } from './seed';
import type { Overview } from './types';

export function overview(): Overview {
  const data = buildSeed();
  return {
    headline: '{{title}}',
    total: asDecimal2(sum(data.people.map((_, i) => `${(i + 1) * 100}.00`))),
    rows: data.people.length,
  };
}
```

`templates/mock/src/pages/OverviewPage.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { httpClient } from '../api/client';
import type { Overview } from '../domain/types';

export function OverviewPage() {
  const { data, isPending, error } = useQuery({
    queryKey: ['overview'],
    queryFn: async () => (await httpClient.get<Overview>('/overview')).data,
  });

  if (isPending) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (error) return <div className="p-8 text-destructive">{String(error)}</div>;

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">{data.headline}</h1>
      <p className="mt-2 text-muted-foreground">{data.rows} rows · {data.total}</p>
    </main>
  );
}
```

`templates/mock/index.html.hbs`:

```html
<!doctype html>
<html lang="{{locale}}">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{title}}</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

`templates/mock/package.json.hbs`:

```json
{
  "name": "{{slug}}",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "lint": "oxlint --max-warnings=0"
  },
  "dependencies": {
    "@agency/dec": "workspace:*",
    "@agency/kit": "workspace:*",
    "@agency/mock": "workspace:*",
    "@agency/synth": "workspace:*",
    "@tanstack/react-query": "^5.102.8",
    "axios": "^1.20.0",
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
    "react-router": "^8.3.1",
    "zustand": "^5.0.15"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.3",
    "@vitejs/plugin-react": "^6.0.5",
    "tailwindcss": "^4.3.3",
    "tw-animate-css": "^1.4.0",
    "vite": "^8.2.1"
  }
}
```

`templates/mock/.oxlintrc.json`:

```json
{ "extends": ["../../oxlint.base.json"] }
```

`templates/mock/wrangler.jsonc.hbs`:

```jsonc
{
  "$schema": "https://json.schemastore.org/wrangler.json",
  "name": "{{slug}}",
  "compatibility_date": "2026-09-09",
  // One Worker per slug at root, so "single-page-application" (which serves only
  // the ROOT index.html) is correct here.
  "assets": { "directory": "./dist", "not_found_handling": "single-page-application" }
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm vitest run packages/cli`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/oleksandrsecond/Projects/agency
git add templates packages/cli
git commit -m "feat(template): the mock scaffold, five files marked scaffold-owned"
```

---

## Task 10: `packages/cli` — `agency new`

This task ends at the spec's kill criterion #1.

**Files:**
- Create: `/Users/oleksandrsecond/Projects/agency/packages/cli/package.json`
- Create: `/Users/oleksandrsecond/Projects/agency/packages/cli/bin/agency.mjs`
- Create: `/Users/oleksandrsecond/Projects/agency/packages/cli/src/new.ts`
- Test: `/Users/oleksandrsecond/Projects/agency/packages/cli/src/new.test.ts`

**Interfaces:**
- Consumes: `templates/mock/**` (Task 9).
- Produces: `newMock(opts: NewMockOptions): Promise<{ dir: string; files: string[] }>` where
  `NewMockOptions = { slug: string; title?: string; locale?: 'de' | 'uk'; profiles?: string[]; root?: string }`,
  and the `agency` bin exposing `agency new <slug> [--title] [--locale] [--profiles a,b] [--like <slug>]`.

- [ ] **Step 1: Write the failing test**

`/Users/oleksandrsecond/Projects/agency/packages/cli/src/new.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newMock } from './new';

let root: string;
beforeAll(() => { root = mkdtempSync(join(tmpdir(), 'agency-new-')); });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe('agency new', () => {
  it('creates a mock with every placeholder substituted', async () => {
    const { dir } = await newMock({
      slug: 'acme-crm', title: 'ACME Logistics', locale: 'de',
      profiles: ['custody', 'fleet'], root,
    });

    expect(dir).toBe(join(root, 'mocks', 'acme-crm'));
    expect(existsSync(join(dir, 'package.json'))).toBe(true);
    expect(existsSync(join(dir, 'package.json.hbs'))).toBe(false); // templates are consumed

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('acme-crm');

    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toContain('lang="de"');
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toContain('ACME Logistics');

    const profiles = readFileSync(join(dir, 'src/profiles.ts'), 'utf8');
    expect(profiles).toContain("id: 'custody'");
    expect(profiles).toContain("id: 'fleet'");

    const wrangler = readFileSync(join(dir, 'wrangler.jsonc'), 'utf8');
    expect(wrangler).toContain('"name": "acme-crm"');
  });

  it('leaves no unsubstituted handlebars anywhere', async () => {
    const { dir, files } = await newMock({ slug: 'clean', root });
    for (const f of files) {
      expect(readFileSync(join(dir, f), 'utf8')).not.toMatch(/\{\{/);
    }
  });

  it('refuses an invalid slug rather than producing a broken package name', async () => {
    await expect(newMock({ slug: 'Not A Slug', root })).rejects.toThrow(/slug/);
    await expect(newMock({ slug: '', root })).rejects.toThrow(/slug/);
  });

  it('refuses to overwrite an existing mock', async () => {
    await newMock({ slug: 'dupe', root });
    await expect(newMock({ slug: 'dupe', root })).rejects.toThrow(/exists/);
  });

  it('defaults to one profile named default', async () => {
    const { dir } = await newMock({ slug: 'solo-default', root });
    expect(readFileSync(join(dir, 'src/profiles.ts'), 'utf8')).toContain("id: 'default'");
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm vitest run packages/cli/src/new`
Expected: FAIL — cannot resolve `./new`.

- [ ] **Step 3: Implement**

`/Users/oleksandrsecond/Projects/agency/packages/cli/package.json`:

```json
{
  "name": "@agency/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": { "agency": "./bin/agency.mjs" },
  "exports": { ".": "./src/index.ts" }
}
```

`/Users/oleksandrsecond/Projects/agency/packages/cli/src/new.ts`:

```ts
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export type NewMockOptions = {
  slug: string;
  title?: string;
  locale?: 'de' | 'uk';
  profiles?: string[];
  /** Workspace root. Defaults to the repo this CLI lives in. */
  root?: string;
};

const SLUG = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
const TEMPLATE = new URL('../../../templates/mock/', import.meta.url).pathname;

/** Minimal handlebars: {{var}} and {{#each xs}}…{{/each}} with {{this}} / {{this.k}}. */
function render(source: string, data: Record<string, unknown>): string {
  const each = /\{\{#each (\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
  const withLoops = source.replace(each, (_m, key: string, body: string) => {
    const items = (data[key] as unknown[]) ?? [];
    return items
      .map((item) =>
        body
          .replace(/\{\{#each this\.(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_m2, k: string, inner: string) =>
            (((item as Record<string, unknown>)[k] as unknown[]) ?? [])
              .map((v) => inner.replace(/\{\{this\}\}/g, String(v)))
              .join(''))
          .replace(/\{\{this\.(\w+)\}\}/g, (_m3, k: string) => String((item as Record<string, unknown>)[k]))
          .replace(/\{\{this\}\}/g, String(item)),
      )
      .join('');
  });
  return withLoops.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(data[k] ?? ''));
}

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    return e.isDirectory() ? walk(full, base) : [relative(base, full)];
  });
}

export async function newMock(opts: NewMockOptions): Promise<{ dir: string; files: string[] }> {
  if (!SLUG.test(opts.slug)) {
    throw new Error(`agency new: slug must match ${SLUG} — got ${JSON.stringify(opts.slug)}`);
  }
  const root = opts.root ?? new URL('../../../', import.meta.url).pathname;
  const dir = join(root, 'mocks', opts.slug);
  if (existsSync(dir)) throw new Error(`agency new: ${dir} already exists`);

  const profileIds = opts.profiles?.length ? opts.profiles : ['default'];
  const data = {
    slug: opts.slug,
    title: opts.title ?? opts.slug,
    locale: opts.locale ?? 'de',
    defaultProfile: profileIds[0],
    profiles: profileIds.map((id) => ({ id, label: id, caps: [id] })),
  };

  mkdirSync(dir, { recursive: true });
  cpSync(TEMPLATE, dir, { recursive: true });

  const files: string[] = [];
  for (const rel of walk(dir)) {
    const full = join(dir, rel);
    const rendered = render(readFileSync(full, 'utf8'), data);
    writeFileSync(full, rendered);
    if (rel.endsWith('.hbs')) {
      const target = full.slice(0, -4);
      renameSync(full, target);
      files.push(rel.slice(0, -4));
    } else {
      files.push(rel);
    }
  }
  return { dir, files };
}
```

`/Users/oleksandrsecond/Projects/agency/packages/cli/bin/agency.mjs`:

```js
#!/usr/bin/env node
import { newMock } from '../src/new.ts';

const [, , command, ...rest] = process.argv;

function flag(name, fallback) {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? fallback : rest[i + 1];
}

if (command !== 'new') {
  console.error('usage: agency new <slug> [--title T] [--locale de|uk] [--profiles a,b]');
  process.exit(1);
}

const slug = rest[0];
const { dir } = await newMock({
  slug,
  title: flag('title'),
  locale: flag('locale', 'de'),
  profiles: flag('profiles')?.split(','),
});

console.log(`created ${dir}`);
console.log(`next:  pnpm install && pnpm --filter ${slug} dev`);
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd /Users/oleksandrsecond/Projects/agency && pnpm vitest run packages/cli`
Expected: PASS — 7 template tests plus 5 here.

- [ ] **Step 5: Run the whole suite and the linter**

```bash
cd /Users/oleksandrsecond/Projects/agency
pnpm test && pnpm lint && pnpm typecheck
```

Expected: all green.

- [ ] **Step 6: KILL CRITERION #1 — the day-4 gate**

This step is a measurement, not a build step. Time it with a stopwatch.

```bash
cd /Users/oleksandrsecond/Projects/agency
time (node packages/cli/bin/agency.mjs new gate-test --title "Gate Test" --locale de --profiles solo,full \
  && pnpm install \
  && pnpm --filter gate-test build \
  && pnpm --filter gate-test test)
```

**Pass:** a built, green, clickable mock in **under 20 minutes** of wall clock with **zero hand-edits**.
Open `pnpm --filter gate-test preview`, confirm the Overview screen renders with kit styling
(if `bg-card` is unstyled, the `@source` line is wrong — that is the failure this gate exists to catch),
and confirm `#/` deep-links.

**Fail:** stop. Do not continue to Plan B. The spec's fallback applies — drop to a plain GitHub
template repo plus `agency check` as the sole shared artifact, and record what took the time.

- [ ] **Step 7: Clean up the gate artifact and commit**

```bash
cd /Users/oleksandrsecond/Projects/agency
rm -rf mocks/gate-test
git add packages/cli
git commit -m "feat(cli): agency new — template instantiation, the only supported entry point"
```

---

## Self-Review

**Spec coverage.** §4 repo layout → Tasks 1, 4, 5, 8, 9, 10 (`portfolio/` is Plan B by design).
§5 Lane A contents → Task 9's template (`BRIEF.md`, `demo/`, `e2e/` are added by Plan B's
`agency check` rows, which is where their enforcement lives). §6 the seam → Task 6.
§7 state → Task 9's `main.tsx`. §8 profiles → Task 7 and Task 9. §11 conventions → Tasks 1, 3, 5, 9.
§13 agent pipeline → Task 10 delivers `agency new`; the three skills are Plan B.
**Deliberate gaps, all Plan B:** §9 freeze/portfolio, §10 the `agency check` rows, §12 the four
`yagoda-starter` fixes (independent, tracked separately), §14 nothing to build by definition.

**Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N". Every code step
carries the actual code. The one prose-only step is Task 10 Step 6, which is a timed measurement
with an explicit pass/fail and a named fallback — that is its content, not a placeholder.

**Type consistency.** `Route`/`Ctx`/`Actor` are defined in Task 6's `router.ts` and consumed
unchanged by Task 9's `routes.ts` and `client.ts`. `mockAdapter(routes, { caps, actor })` has the
same signature in Task 6's tests, Task 6's implementation and Task 9's `client.ts`.
`createProfiles(defs, fallbackId)` returning `{ resolve, capsOf, href, all }` matches between Task 7
and Task 9's `profiles.ts.hbs`. `asDecimal2` is exported by Task 5's `types.ts` and used in Task 9's
`calc.ts`. `sum(values, scale?)` from Task 1 is used in Task 9's `calc.ts`. `createStream(seed)` from
Task 4 is used in Task 9's `seed.ts`.

One inconsistency found and fixed while reviewing: Task 6's `packages/mock/package.json` declares
`@agency/dec` as a dependency, but nothing in `packages/mock` imports it — the money is used by the
mock's *domain*, not by the adapter. Left in place deliberately so `asDecimal2` consumers resolve
`@agency/dec` transitively; if `pnpm` flags it as unused, move it to the template's dependencies
instead and note it here.

---

## What Plan B covers, and why it is not written yet

`agency check` (the 12 registry rows), `agency freeze/revive/thaw`, `catalog.json` and the portfolio
Worker, freezing the three existing mocks, and the `tools/mockkit` skills.

It is deliberately unwritten because **Task 10 Step 6 can kill this design.** The spec's kill
criterion #1 sends the whole approach to a named fallback if the scaffolder does not clear a
20-minute bar. Planning the enforcement and portfolio layers before that gate is planning work the
gate exists to delete. Write Plan B on the far side of a green gate.
