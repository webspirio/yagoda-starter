# Mock Framework — Design Spec

**Date:** 2026-09-09
**Supersedes:** `mock/claude-research-1.md` (the prior brief). Every one of its seven decisions
D1–D7 was attacked and replaced; §3 below records what it got wrong and why, so none of it is
re-litigated.
**Source:** a 49-agent research fleet (13 evidence dimensions, 12 adjudicated decisions, 3
completeness critics) plus a 17-agent design panel (4 candidate architectures, 3 diverse judges
each, 1 synthesis). Claims marked *(verified)* were checked against a file on disk or
`registry.npmjs.org` on 2026-09-09.

**What this spec is not.** It is not a plan. It does not describe the NestJS product, and it does
not modify `yagoda-starter` beyond the four independent fixes in §12. The implementation plan is a
separate document produced from this one.

---

## 1. Goal

Turn "sales call → clickable CRM mock → sometimes a real NestJS product" from a thing the owner
does by hand into a repeatable standard, without paying for machinery the measured economics do
not support.

### 1.1 The five settled answers

These came from the owner on 2026-09-09 and are binding constraints, not preferences. Every
decision below is downstream of them.

| # | Question | Answer | Consequence |
|---|---|---|---|
| A1 | What happens to a mock? | **Most die, a few convert.** *(verified: of 11 public Pages repos, 7 have `created_at == pushed_at` and were never touched again; only `yagoda-crm` and `logistic` — the two converted leads — got sustained work)* | Two lanes. Lane A must be brutally cheap. Heavy machinery is Lane B only. |
| A2 | What happens to the dead ones? | **Reused as portfolio** — shown to other prospects as examples. | The catalog is sales collateral. Nothing is deleted. Synthetic data becomes a *commercial* gate, not merely a legal one. |
| A3 | What is the catalog unit? | **A codebase with `profiles[]`**, and it is repeatable. *(prior art: `logistic/src/lib/profile.ts` — `resolveProfile()`, a 14-boolean `Capabilities`, `profileHref()`, deliberately unpersisted)* | One codebase serves several prospects. Profiles are a first-class axis, not an afterthought. |
| A4 | How do portfolio pieces survive? | **Frozen artifact, never rebuilt.** | CI cost is flat as the catalog grows. A kit change can never dark an old demo. Freeze must eject the mock from every build graph. |
| A5 | Who operates it? | **Owner + Claude now, team later.** *(verified: bus factor 1 — the two other devs have never committed to a mock, a hook, or the verify harness)* | Enforcement in checks, not prose. Scaffolder is the only entry point. English docs deferred to the day-45 second-user test. |

### 1.2 The propagation doctrine

The single governing rule, and the reason most of the tempting artifacts below are deleted rather
than argued about:

> **A standard may propagate only as (a) something the deterministic scaffolder writes at t=0, or
> (b) a check that goes red. Nothing else.**

This is the only inference the evidence licenses:

- **0% inheritance.** Same author, same stack, 16 days apart: `yagoda-crm` has `scripts/verify`,
  `.claude/hooks`, a 65 KB `CLAUDE.md` and `ports.ts`; `logistic` has none of it, and grew a third
  independent money module. `lab-crm` additionally lacks the `"strict": true` that `logistic` has.
  *(verified)*
- **0% skill compliance.** `.claude/skills/nest-module-conventions/SKILL.md:110-118` mandates
  `commands/` and `queries/` directories; `find backend/src -type d \( -name commands -o -name
  queries \)` returns **0 across 23 modules**, and the skill's author wrote 68 of those commits.
  *(verified)*

Prose is not a control surface in this organisation. Design accordingly.

### 1.3 What the framework is actually paid for

An honest correction that the design panel forced, and which changes how success is measured.
`logistic`'s one-shot build is **one commit** (89 files, 44,868 insertions). The frequently-cited
~11 hours is the *second* session — 19 commits over 11h24m — and every one of those commits is
domain or correctness work: the money core, profiles, "eight arithmetic errors found by
independent audit", "seven fixes found by clicking". **Zero of the measured hours is
scaffolding.** *(verified)*

So the framework cannot justify itself on build speed. Its case is:

1. **Freeze** turns a same-day write-off into permanent sales inventory at ~10 minutes marginal
   cost, on 80% of the catalog, with CI cost flat from 11 mocks to 60.
2. **Correctness classes that tests cannot see** — the money/ordering holes, the error-code drift,
   the synthetic-data gate — become red builds.
3. **Conversion** stops being a rewrite for the ~20% that pay.

Speed is a non-goal. Not making it *slower* is the constraint.

---

## 2. Scope

**In scope:** one new private repo (`agency/`); five workspace packages; a scaffolder CLI; the
mock template; the freeze/portfolio mechanism; the check registry; the Claude plugin skills.

**Out of scope:** absorbing, forking or restructuring `yagoda-starter` (it is 5 days old and taking
212 commits — *verified*); migrating the three existing mocks (they are frozen as-is, §9.6);
building the NestJS side of any conversion; English onboarding docs, `doctor.mjs`, a
second-operator workflow (deferred per A5); i18n beyond a locale constant (§11).

---

## 3. What the prior brief got wrong

Recorded so it is not re-litigated. Each row is verified.

| Prior claim | Reality |
|---|---|
| Use `@mswjs/data` | **Deprecated — all 36 of 36 versions**, "Package no longer supported", latest 0.16.2 (2024-09-09). Successor `@msw/data` 1.1.8, same maintainer, same repo. |
| Ship MSW in the browser | 95,013 B gzip = **+45.6%** on `yagoda-crm`'s entire first paint; 51% of it is a public-suffix list for cookie domains a mock has none of. MSW's own docs gate mocking to `NODE_ENV === 'development'`. Its worker URL 404s on the live host today, and MSW *throws* rather than degrading. 0-for-6 across these repos. |
| Money as integer minor units | `backend/src/common/money.ts:9-13` records that integer kopiykas were **considered and rejected** because they contradict `numeric(12,2)` and invalidate the SQL formulas. Money is decimal **strings**. |
| Errors are `{statusCode, message, error}` | `common/filters/all-exceptions.filter.ts:12-19` — `{statusCode, error, message, reason?, path, timestamp, requestId?, ...extras}`. `error` leaks JS class names; `reason` is written by zero backend code. Branch on `code`. |
| Pagination is `{items, total}` | `common/dto/paginated.ts` — `{data, total, page, limit}`. Declared **7 times** across the repos. |
| Ports implemented over Prisma | Stack is **TypeORM 1.1.1** (latest, healthy). Prisma cannot model the 26 named CHECKs, partial unique indexes, or 103 raw `queryRunner.query` calls. |
| Scaffold Nest, emit `openapi.json` | `@nestjs/swagger` is not installed. All 17 response types are `interface`, and the plugin collapses an interface return to `Object` (`plugin-utils.js:114-120`) — every response emits `{"201":{"description":""}}`. The blog-standard `createApplicationContext` recipe **throws** at `swagger-scanner.js:25`. |
| Vite-not-Astro is the decision | Answers a question nobody asked (production is already Vite 8) while missing that **the mocks have no router at all**. |

---

## 4. Repo layout

One private repo, **pnpm 11.5.2** workspace (matching `order-pharm` and `static-website-template`;
verified installed), Node 24 via `.nvmrc` (three of four repos already pin 24), one lockfile,
**no registry, no PATs, no version bumps**.

```
agency/
├── pnpm-workspace.yaml          packages: ["packages/*", "mocks/*"]   ← portfolio/* deliberately absent
├── packages/
│   ├── kit/                     84 files lifted from yagoda-starter/frontend/src/shared/ui
│   │                            (measured 2026-09-09: 52 non-test components, 30 co-located
│   │                            tests, 3,514 non-test LOC, ZERO imports above shared/,
│   │                            13 radix-ui primitives, 3 page templates). Two research agents
│   │                            reported 79 files / 3,187 and 79 / 3,496; both are wrong — this
│   │                            row is my own count. PROVENANCE.md pins source repo+sha.
│   ├── dec/                     scale-generic decimal strings, bigint internals, half-up away from
│   │                            zero, zero deps. add/sub/mul/div/cmp/round(v,scale) +
│   │                            stampFx(amount,ccy,rate) → {amount,ccy,rate,base}. golden.json.
│   ├── mock/                    mockAdapter, Route, DomainError, envelope, Paginated<T>,
│   │                            resolveProfile/profileHref, seq() ids.
│   ├── synth/                   Latin + Cyrillic name/company/address corpora, seeded streams.
│   └── cli/                     bin `agency`: new | check | freeze | revive | thaw | catalog
├── mocks/<slug>/                in the workspace glob, tsconfig refs, oxlint include, vitest projects
├── portfolio/<slug>/            in NONE of them. dist.tar.zst + FROZEN.json + src/
├── catalog.json
└── tools/mockkit/               the Claude Code plugin (skills, hooks)
```

**Path-linked, not published.** A kit change that breaks a live mock is a compile error at your
desk in the same commit — the inverse of the measured 0%-inheritance failure. Publishing to a
private npm registry was considered and rejected: for one operator it means `.npmrc` + a PAT in
every repo and CI config, version bumps, peer ranges, and a kit fix that reaches no live mock
without hand-bumping lockfiles.

---

## 5. Lane A — the only thing that exists by default

**Budget cap: 6–9 hours, transcript in hand to frozen.** This is a ceiling that stops ceremony
accumulating, not a saving being claimed — §1.3 established that no measured build hour is
scaffolding, so the framework must not make a mock *slower*, and is not credited with making one
faster.

A Lane A mock contains exactly:

- `BRIEF.md` — ≤400 lines, the **only** spec artifact. Mandatory section: the 5–10 numbers the
  client will personally check on the call.
- `src/domain/{types,seed,calc}.ts` — the genuinely per-client part.
- `src/api/routes.ts` — one handler per screen action; each handler is the future Nest controller
  body.
- `src/pages/*` — built on the kit's three page templates.
- `src/profiles.ts` — 2–3 profiles, one `solo` "first two minutes" screen.
- `demo/numbers.md` — **generated** (§10).
- `demo/script.md`, `README.md` — hand-written; drift-checked for **links only**, never prose.
- `e2e/walkthrough.spec.ts` — Desktop Chrome + iPhone 15 WebKit.

**It does not contain:** zod · MSW · i18next · `ports.ts` · a per-mock `CLAUDE.md` · a per-mock
verify registry · stryker · knip · a manifest DSL · `spec.json` · a contracts package · a
conformance suite. Each was proposed by a candidate and rejected; §14 records why.

---

## 6. The seam

One `axios.create`, one adapter, one line of difference between mock and product.

### 6.1 The trap

**Verified in axios 1.20.0:** `lib/core/dispatchRequest.js` calls `adapter(config).then(...)` and
contains **zero** references to `settle`. `validateStatus` lives only in `lib/core/settle.js`,
which each built-in adapter (`xhr.js`, `fetch.js`, `http.js`) calls *itself*. A custom adapter
therefore owns status handling: **an adapter that resolves a 409 delivers it to TanStack Query as
a success.** It must throw `AxiosError`.

### 6.2 The shape

```ts
// packages/mock/src/adapter.ts  (~110 lines, zero deps)
export type Route = {
  method: Method; path: string; caps?: CapKey[];
  handler: (c: Ctx) => unknown;
};

export function mockAdapter(routes: Route[], caps: Set<CapKey>): AxiosAdapter {
  const table = compile(routes);
  return async (config) => {
    await sleep(LATENCY_MS);                        // default 0; dev-panel toggle
    const hit = table.match(config.method!, pathOf(config));

    // caps gate the ROUTE, not just the menu: an off-profile route 404s.
    if (!hit || (hit.caps && !hit.caps.every((c) => caps.has(c))))
      return fail(config, 404, 'NOT_FOUND');

    let out: { status: number; data: unknown };
    try { out = ok(hit, hit.handler(ctxFrom(config, hit))); }
    catch (e) { out = env(e instanceof DomainError ? e : new DomainError(500, 'INTERNAL')); }

    const res = {
      status: out.status, statusText: '', headers: {}, config,
      data: JSON.parse(JSON.stringify(out.data)),   // ← the divergence killer
    };
    if (out.status >= 400)                          // ← MUST throw; settle() never runs
      throw new AxiosError('Request failed', String(out.status), config, null, res);
    return res;
  };
}
```

```ts
// mocks/<slug>/src/api/client.ts   @scaffold-owned
export const httpClient = axios.create({
  baseURL: env.apiUrl,
  paramsSerializer: { indexes: null },   // express@5 + forbidNonWhitelisted 400s otherwise
  adapter: import.meta.env.VITE_MOCK ? mockAdapter(routes, CAPS) : undefined,
});
```

### 6.3 Why this shape

- **Above the line** — components, TanStack Query hooks, query keys, the `ApiError` interceptor —
  is byte-identical to the product. *(verified: exactly one `axios.create` at
  `frontend/src/shared/api/client.ts:103`, behind 48 call sites and 106 imports across 65 files.)*
- `JSON.parse(JSON.stringify())` **structurally** eliminates the `undefined`-vs-`null`,
  number-vs-string and Date divergence classes. An in-process port can only assert against them.
- `ctx.actor` comes from the session, never the request body — a handler cannot read an actor
  field off the wire. *(`yagoda-crm`'s `ports.ts` learned this in phase 4 and then violated it in
  `voidTransfer(id, reason, by)`.)*
- The port is **use-case shaped**, not repository shaped. A repository port is impossible here:
  supplier balances are correlated `SUM` subqueries with `::text`, grade-prices is `DISTINCT ON`
  ("has no TypeORM expression" — its own comment), payouts uses `SELECT … FOR UPDATE` as a mutex.
  Three reads sharing a signature and no implementation.

- **Latency defaults to 0**, not the 120 ms several candidates proposed for realism. The demo is a
  timed performance — `logistic`'s script budgets 23 minutes across 8 screens — and 0.7 s of dead
  air per navigation, repeatedly, degrades the thing closest to revenue. It ships as a dev-panel
  toggle for the one case where a client must see a spinner.

The mocks today have no axios, no TanStack Query and no router, so this layer is **constructed by
the scaffolder at t=0**, never retrofitted. Marginal cost per screen is loading/error states,
~10 minutes.

---

## 7. State

**Lane A persists no domain rows.**

*(verified: 1,870,843 of 1,922,518 bytes — 97.3% — of `yagoda-crm`'s persisted snapshot is
regenerable `buildSeed()` output.)*

The seed regenerates on every load; only UI state (theme, sidebar) is persisted. This deletes four
problems at once: the `migrate: () => undefined` wipe hazard, the quota ceiling, dangling
user→seed id references, and the FIFO-composition problem. "Reset demo data" becomes a reload.

**The `origin: 'seed' | 'user'` partition is rejected**, despite being the headline
size win in the research. Its stated hazard was dropped in silence: "reset demo data" is pre-call
step #1 *precisely because rehearsal rows contaminate the show*, and rehearsal rows are exactly
what origin-tagging preserves. It also converts a loud failure (store wipes, operator resets) into
a silent one, against two FIFO allocators measured diverging by 1 200,00 UAH in 493 of 1000 runs.

What is lost — surviving a mid-cycle redeploy — returns as an opt-in ~40-line **Save session**
button that serializes the mutation *log* under a named key and replays it on demand.

---

## 8. Profiles

`resolveProfile()` reads `?profile=` then `VITE_PROFILE`, **never persisted** (a stored profile
survives "reset demo data" and leaves the show in the wrong product — `logistic`'s own reasoning).

Capabilities gate the **route**, not just the menu. `logistic` gates `navFor()` but leaves the data
reachable, so a prospect who types a URL sees the other client's product. Gating the route makes
the do-not-open list a derivation (`routes.filter`) instead of a hand-maintained list, and the same
array is the Nest `@Auth` guard list at conversion.

One Worker per slug at root, profiles as query params, so `base: '/'` is unconditional.
`agency freeze --profile-lock` produces separate locked builds only when a client genuinely must
not be able to fetch the other product's screens.

---

## 9. Portfolio — `agency freeze <slug>`

1. `agency check --tier freeze` green.
2. Build.
3. `wrangler deploy` a Worker + a Cloudflare Access policy. *(verified: Access attaches to a
   Worker with no zone and no custom domain, and covers `workers.dev` plus previews.)*
4. `git mv mocks/<slug> portfolio/<slug>`; write `dist.tar.zst` (~300 KB; measured dists are
   317–419 KB gz) and `FROZEN.json` `{tag, commit, lockfileSha, distSha, workers, profiles}`.
5. **Eject from the graph.** `portfolio/*` is outside the pnpm glob *and* removed from root
   `tsconfig` references, oxlint `include` and vitest `projects`. Without this, frozen source stays
   in the typecheck graph while the freeze guard forbids editing it — a deadlock.
6. Append to `catalog.json`; regenerate `portfolio/index.html`.

`agency revive` extracts and redeploys **the same bytes** — no install, no build. `agency thaw`
requires a `THAW.md` with a ≥30-char machine-rejected reason before source becomes editable.

Frozen CI cost: **zero, forever.** Source stays on disk as the few-shot corpus for
`agency new --like <slug>`.

**9.6 — the three existing mocks.** `yagoda-crm`, `logistic` and `lab-crm` are frozen as-is on day
6. Their `dist/` is served; their source is not migrated, not retrofitted, not brought up to
standard. A4 makes this free.

**Hosting rejections.** Cloudflare Pages caps git-connected projects at **5 per repository** — one
repo with many mocks dies at mock #6. Path-routing the catalog under one Worker breaks on two
verified facts: mocks build `base: '/<slug>/'` at build time only, and
`not_found_handling: "single-page-application"` serves only the **root** `index.html`. Public
GitHub Pages is disqualified — 11 of the org's 29 repos are public with Pages on right now,
carrying client business data.

---

## 10. Enforcement — `agency check`

One versioned CLI, ~12 rows declared as data (the registry pattern from `yagoda-crm`, ~350 lines
rather than 3,939). Every row carries `proves` and `blindSpot` prose. Five statuses that never
collapse: PASSED / FAILED / SKIPPED / NOT_RUN / UNRUNNABLE.

**Freeze-tier blockers:**

| Row | Proves |
|---|---|
| `typecheck` | `tsc -b` clean. |
| `lint` | oxlint 1.77 restricted-syntax: money arithmetic, **plus the two selectors closing the measured hole** (`a.amount > b.amount` currently exits 0 while `a * b` exits 1), plus bare `.sort()` and `Math.random`. |
| `test` | vitest. |
| `codes:closed` | Bidirectional AST: every thrown literal is a union member, every member is thrown, every `code ===/startsWith/endsWith` comparison is a member. ~40 lines. **Turns the live `LOGIN_TAKEN` bug red on day one.** |
| `caps:exhaustive` | Every Route cap is a `Capabilities` key, every key is set by every profile, every key is reachable. |
| `synth:names` | Allow-list, run on **source** not dist, **Latin and Cyrillic**. Fixes `pii-boundary.mjs:34`'s blind green on "Hans Müller". |
| `scaffold:hash` | SHA over the five files that fail *silently* when an agent rewrites them: the hash router, adapter wiring, persist config, profile resolution, and the Tailwind `@source "../../../packages/kit/src/**/*.tsx"` line (measured: without it `bg-card` and `text-primary` are simply absent from dist CSS, with no error). |
| `numbers:frozen` | A vitest runs `buildSeed()` through the real calc engine and writes `demo/numbers.md`; the check diffs regenerated vs committed. |
| `links:truth` | Every `#/route` and `data-demo` id cited in `README.md` / `demo/*.md` resolves in the built app. Fixes `README.md:37,57`, which instructs a step against a control deleted two phases earlier. |
| `viewport` | Playwright: Desktop Chrome **and** iPhone 15 WebKit walkthrough. |

**Full/weekly tier:** `bundle` (dated bidirectional ratchet) · `frozen:integrity` (HEAD each live
`/_manifest.json` against `FROZEN.json`; SKIPPED, never FAILED, on an unreachable host).

**Demo-script prose is never gated.** Only the numbers are generated and diffed.

---

## 11. Conventions

Locked, each with a `verified-against:` citation. This is the settled part.

| Convention | Rule | Verified against |
|---|---|---|
| Money | Canonical decimal **strings**, scale-generic. `stampFx()` stores `{amount, ccy, rate, base}` with `base` computed once at write. | `money.ts:9-13`; `logistic/src/lib/finance/money.ts` (a per-row FX rate at scale 4 that a scale-2 validator would throw on) |
| Ordering | Explicit always. `seq()` or ULID, store-assigned. Never `Math.random()`, never implicit array order. | `calc.ts:1318-1324` — a FIFO allocator measured paying 1 200,00 UAH in 493 of 1000 runs |
| Errors | `{statusCode, error, message, path, timestamp, requestId, code?, ...ctx}`. **Branch on `code` only.** | `all-exceptions.filter.ts:12-19` |
| Pagination | `{data, total, page, limit}` | `common/dto/paginated.ts` |
| Dates | `Instant` (ISO-8601 Z) and `BusinessDate` (`YYYY-MM-DD`, server-derived, never in a request body) | `intake.mapper.ts`; `shift.entity.ts:53` |
| Wire casing | snake_case | 22 frontend model files |
| Routing | `createHashRouter` — one word from the product's `createBrowserRouter`, no `basename`, no `404.html`, no host config | `react-router` 8.3.1 (verified export); `frontend/src/app/router.tsx:172` passes no basename |
| Locale | One constant driving `Intl` + `<html lang>`, set by `--locale`. No i18next in Lane A. | §14 |
| Kit style | `new-york` — the product wins, because conversion is the expensive end and the three existing mocks are frozen, so there is nothing to migrate | A4 |

---

## 12. Independent fixes to `yagoda-starter`

These are correct regardless of this framework and should land separately.

1. `frontend/src/pages/users/lib/apiErrorToFields.ts:33` — `error.code.endsWith('_LOGIN_TAKEN')`
   is `false` for the emitted `'LOGIN_TAKEN'` (`user-admin.service.ts:331`). The test is green
   because it fabricates `'USER_LOGIN_TAKEN'`, a code no backend file emits. **Live bug.**
2. `frontend/src/shared/lib/env/index.ts:20` — `export const env = parseEnv(import.meta.env)`
   throws at import time on a missing `VITE_API_URL`, before any error boundary can mount.
3. `all-exceptions.filter.ts` — normalise `error` to the canonical HTTP phrase (it currently leaks
   `'ConflictException'`), and either delete `reason` or make it the discriminator.
4. Delete the six duplicate `Paginated<T>` declarations; re-export the one in
   `common/dto/paginated.ts`.

---

## 13. Agent pipeline

```
agency new <slug> --like <slug> --locale de     90 s, deployed, one placeholder screen
  → /mock-brief    transcript → BRIEF.md (incl. the numbers the client will check)
  → /mock-domain   types + seed + calc + routes, TDD
  → /mock-screen <name> × N   page + route + caps + handler + a walkthrough beat
  → agency check
  → agency freeze
```

**Deterministic script** (a validator can reject a wrong answer): scaffold, add-screen, router
emission, `demo/numbers.md`, freeze/revive/thaw, the check registry.
**Model judgement** (taught, not generated): transcript → BRIEF, which discovery questions to ask,
domain modelling, page composition, reading a red check.

**The honest ratio.** "One prompt + transcript" is already false twice over: `yagoda-crm` is 2,024
transcript lines → 33,528 spec lines (16.6×); `logistic` is 27,398 chars → 175,856 chars (6.4×),
including a hand-authored 393-line `BUILD-PROMPT.md` citing exact `file:line` anchors. *(verified)*
The framework structures steps 2–3; it does not delete them. Measure spec-chars / transcript-chars
on the next two mocks. If it does not fall below ~4× by mock #3, the investment is aimed at the
wrong stage.

---

## 14. Deliberately not built

| Rejected | Reason |
|---|---|
| A manifest DSL + codegen emitters | Self-reported Lane A leverage is 1.3× (~900 emitted lines from ~680 manifest lines). Spends 2–3 h of the scarcest input — expert modelling judgement — to buy ~13 minutes of agent output, on every mock, 80% of which die in a day. Its three *promotion* emitters are the good part and belong in Lane B, hand-written. |
| Published `@agency/*` npm packages | `.npmrc` + PAT in every repo and CI config, version bumps, peer ranges, and a kit fix that reaches no live mock. Path-linked workspace gives the same guarantee at zero recurring cost. |
| `origin: 'seed' \| 'user'` persistence | Preserves exactly the rehearsal rows the demo protocol deletes; converts a loud failure into a silent one. §7. |
| zod in Lane A | A mock's only boundary is a `JSON.parse(JSON.stringify())` the same repo wrote. No untrusted input. Adopting it now propagates the live root-3.25.76 / frontend-4.5.4 major split into every new lockfile. |
| i18next + cross-dictionary key parity per mock | Days of extraction per artifact shown to one prospect in one language. And it is a blind check of its own species: a single-locale demo passes parity trivially and forever. |
| A CI gate on demo-script **prose** | Puts a red check between the operator and the artifact closest to revenue at 11pm before a call, in an organisation measured at 0% skill compliance whose revealed preference was to keep that file out of git. |
| MSW in the bundle · `@mswjs/data` · PGlite in the browser | §3. MSW stays a devDependency for Playwright/Vitest; PGlite is Lane B CI only. |
| A `ports.ts`-style in-process port above the adapter | Re-admits the divergence class the JSON round-trip erases structurally. |
| Per-mock verify registries · stryker · knip · per-mock `CLAUDE.md` | `yagoda-crm`'s 3,939-line harness verifies the engineering interior exclusively (grep of `registry.mjs` for `README\|demo-script\|print\|i18n\|locale\|axe\|a11y\|mobile\|viewport` returns **0**), and the 65 KB `CLAUDE.md` did not reach `logistic` 16 days later. |
| English docs, onboarding, second-operator workflow | Deferred to the day-45 second-user test per A5. |

---

## 15. Lane B — conversion

`docs/CONVERT.md`, one page, run by hand on the ~20% that pay, plus **exactly one** mechanism:

```
pnpm --filter <slug> e2e --mode live      # the SAME walkthrough.spec.ts, VITE_MOCK=0, real API
```

The demo the client bought becomes the product's definition of done. This is the only migration
argument that survives the measured reality that **0 of 98 mock files were byte-identical to any
of 332 product files** in the one completed migration.

---

## 16. Open decisions

Genuinely open; each needs the owner.

1. **Cloudflare plan.** Paid (500 Workers) now, or Free (100) accepting a ~100-entry ceiling around
   year three? One Worker per slug with `?profile=` keeps 60 mocks inside Free; `--profile-lock`
   multiplies it. Decide before freezing entry #1 — the naming scheme is baked into `FROZEN.json`.
2. **Is `--profile-lock` ever mandatory,** or always the operator's call? A German SMB prospect who
   opens devtools is a different risk profile than the client-side caps gate `logistic` ships.
3. **Kit style** — `new-york` (my call, recorded in §11) or `radix-nova`? Reversible only before
   mock #1.
4. **German.** Ship `--locale de` as `Intl` + `<html lang>` with hand-written strings (what this
   spec does), or port `static-website-template/src/i18n/de.ts`'s compile-time parity trick (527
   lines, `de` default, deliberately not `as const` so a missing key elsewhere is a type error)?
   The latter costs a per-mock translation pass on a 6–9 hour budget, with no German speaker named.
5. **Kit drift.** `packages/kit` is a dated snapshot of a source moving at 212 commits in 5 days.
   Periodic re-lift, a one-way sync check, or deliberate divergence into the agency's own artifact?
6. **Is `demo/script.md` committed?** Both mature repos gitignore it, and `yagoda-crm`'s
   `.gitignore` says why: eight files quote 434 occurrences of real surnames. This spec commits it
   and checks only its links — which works only if the prose is written against synthetic names
   from day one. That is a discipline, not a check.

---

## 17. Kill criteria

Written before anything is built, with dates and a named fallback. Any two firing is the abandon
signal; the fallback is never nothing.

| When | Trigger | Fallback |
|---|---|---|
| **Day 4** | `agency new` + two `/mock-screen` does not produce a deployed, green, clickable two-screen mock in **under 20 minutes** with zero hand-edits. | The propagation doctrine has no delivery vehicle. Drop to a plain GitHub template repo plus `agency check` as the sole shared artifact. |
| **Day 14** | The first two real mocks average **over 12 hours** end to end. | Cut the seam first: drop `routes.ts` and the query hooks, call domain functions directly from components. Keep kit, profiles, checks, freeze. |
| **Day 14** | `routes.ts` + hooks + loading/error states exceed **4 hours on a 6-screen mock**, or a handler needs logic a Nest controller would not contain. | The adapter is not paying. Revert to direct domain calls; keep `packages/mock` only for `DomainError` and `Paginated`. |
| **Day 30** | `agency new --like <slug>` does not measurably shorten transcript→BRIEF versus a cold start. | The frozen-source-as-corpus claim is unfounded. Delete `portfolio/*/src/`, keep `dist.tar.zst` + `FROZEN.json`. |
| **First conversion** | The Nest port rewrites **more than 40%** of `src/pages/` anyway. | Byte-identical-above-the-seam preserved the wrong artifact. Keep the walkthrough spec, delete the adapter. |
| **Any time** | The operator deletes or disables an `agency check` row rather than fixing what it caught. | That is the exact pressure that took `nest-module-conventions` to 0%. Log it; **three deletions in the first ten mocks refutes the enforcement strategy**, not the individual rows. |

---

## 18. First week

| Day | Work |
|---|---|
| 0 | **Ahead of everything, no design needed.** Audit the 11 public Pages repos; flip dead leads private or delete their Pages site. `uawell-prototype` (39 MB, public) first. Land the four §12 fixes. |
| 1 | `agency/` workspace; `packages/dec` with `golden.json`; `packages/synth`. |
| 2 | `packages/kit` extraction (79 files + 5 `shared/lib` helpers, `PROVENANCE.md`). |
| 3 | `packages/mock` — the adapter, `Route`, `DomainError`, profiles, `seq()`. Prove the seam against three real routes from `yagoda-starter/frontend` with `VITE_MOCK=1`. |
| 4 | `packages/cli` — `agency new` + the template. **Kill-criterion #1 fires or passes here.** |
| 5 | `agency check` — the 10 freeze-tier rows. |
| 6 | `agency freeze`; freeze the three existing mocks as-is; `catalog.json` + `portfolio/index.html`. |
| 7 | The `tools/mockkit` skills: `/mock-brief`, `/mock-domain`, `/mock-screen`. |

Then: build mock #1 under the standard, measure every phase, and hold the day-14 criteria.
