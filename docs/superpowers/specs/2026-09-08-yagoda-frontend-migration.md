# Yagoda Frontend Migration — Design Spec

**Date:** 2026-09-08
**Issue:** [#14](https://github.com/webspirio/yagoda-crm/issues/14) — "Мігрувати frontend в новий репозиторій"
**Source:** the mock CRM `yagoda-crm` (React 19 + Vite + Zustand, no server), a
`/grilling` + `superpowers:brainstorming` session of 2026-09-08, and the conventions
in `frontend/CLAUDE.md`.
**Branch / stack:** `feat/yagoda-frontend-migration`, cut from `main`. Delivered as
**stacked PRs**, one portion per PR — see §7.

## 0. Design pivot (read first)

The first look at the catalog-admin-ui screen (PR #23) settled the visual direction: its
style does **not** match the product. **PR #23 is closed**; the screens are rebuilt in the
**mock's visual identity**. Concretely this reverses the earlier "copy the starter's screen
template" idea — instead we **port the mock's design system** into `shared/ui` and build every
page on it (§4.0, §6). The catalog-admin-ui branch is kept as a **logic reference only**: its
API hooks and `RequireRole` are reused; its markup/style is not.

## 0a. Governing seam (the rule for every decision below)

- **Structure & how code is written → the starter.** FSD layers and slice boundaries
  (`shared < entities < features < pages < app`, ESLint-enforced), per-slice API hooks
  (TanStack Query) / types / tests, the axios `httpClient` + `ApiError`, `RequireAuth` /
  `RequireRole`, server-error-to-field mapping, `url-state`, i18n plumbing, naming and file
  layout. Where the code *lives* and *how it is organised* is always the starter's.
- **UI & design system → the mock, in full.** Not just theme tokens: the **entire visual
  layer** — every `shared/ui` primitive (button, card, dialog, table, tabs, select, …), the
  signature components (`bits.tsx`), the theme, the fonts, the layout language. The mock's UI
  kit **supersedes** the starter's visual primitives; the starter's own screens are migrated
  onto it too (§10).

The seam runs cleanly through mixed components: the login screen, for example, wears the
mock's `SignInPage` look but keeps the starter's `authApi` + `RequireAuth` logic.

---

## 1. Goal

Move the UI from the mock `yagoda-crm` into this repo — **in the mock's visual style** — wiring
the screens whose backend endpoints already exist on `main`, and bringing the remaining domain
UI over as **ready-to-assemble presentational parts** for the money slices that come later.
Do not recreate the mock's client-side engine here.

The mock stays as the reference for domain behaviour and as the home of its 585 domain unit
tests until those port alongside the money engine (§6, §8).

## 2. Why this is mostly re-homing, not rewriting

The mock was built for this: `src/lib/ports.ts` is already a backend contract
(`DomainSnapshot` / `Commands` / `Queries` / `AuthState`), command signatures were written
"ready to become `Promise`", and `ports.ts` states outright that the **server is the authority
on money** — it must recompute `net`/`amount`/`debt` and reject a mismatched body, and derive
the signer from the token, not the payload. Migration = **replace the in-memory adapter
(`store.ts`) with per-resource TanStack Query hooks against the NestJS API**, plus **port the
mock's presentational layer** (design system + components) rather than re-invent a look.

## 3. Verified current state (2026-09-08, after `git fetch`)

| Area | Backend on `main` | Frontend UI |
|---|---|---|
| Login / profile | ✓ | ✓ (starter: `features/auth`, `pages/profile`) |
| Collection points | ✓ (`/collection-points`) | ✗ none anywhere |
| Products / grades / tare types | ✓ | catalog-admin-ui branch — **PR closed, style rejected** |
| Suppliers | ✓ (`/suppliers`) | ✗ none anywhere |
| Prices (`/grade-prices`) | ✓ + `/current` picker + journal | ✗ none anywhere |
| Users admin | ✓ (`/users`, incl. `PUT :id/password`) | ✗ none anywhere |
| Intake / cash / crates / transfers / summaries | ✗ | mock pages only → **harvest** |

`grade_prices` is exactly the mock's day-price model: `(collection_point_id,
product_grade_id, numeric(10,2)×3, created_by, note, created_at)` — an **append-only journal**
with `/current` (= `priceFor`) and the full list (= `priceHistory`). So the mock's `PricesPage`
maps onto it directly.

**Money on the wire is already decided in-repo:** amounts are `numeric(10,2)` and numbers are
**carried as strings end-to-end**. New money-facing code follows the same rule; no float.

## 4. Architecture decisions (from the grilling session)

**4.0 Migrate the mock's UI kit in full (§0a).** Both apps are Tailwind v4 + shadcn with the
same CSS token names, so the port is a token/value swap plus moving the mock's components
across (§6). The starter's warm-stone / orange palette, Geist type **and its visual primitives**
are replaced by the mock's. This is the foundational portion; every page below is built on it,
and it is organised in the starter's `shared/ui` layout.

1. **Wire only what has endpoints; harvest the rest.** This wave wires the admin catalogs and
   harvests the money-domain UI as parts (§5).
2. **Harvest form = presentational, decoupled from `store.ts`.** Each domain component is lifted
   into props + callbacks (no store import) and placed in its FSD slice's `ui/` with **no `api/`
   layer yet**. Assembling a page later = add TanStack Query hooks and route it, zero UI rework.
   These components are already in the mock's style — the design-system port makes them render
   correctly with no restyle.
3. **No shared domain package.** Follow the starter's pattern: each slice hand-writes its API
   types mirroring the DTOs. `calc.ts` does **not** come to the frontend this wave. The
   `packages/domain` vs golden-tests question is revisited when the money modules are built.
4. **Routing = the starter's; shell chrome = the mock's.** Keep react-router + the `AppLayout`
   structure and per-route `RequireAuth`, but **restyle the shell chrome to the mock's look**
   using the ported tokens/components. Port the mock's role-aware navigation as **data** (a nav
   config with a `roles` field, filtered by `me.role`). The mock's store-driven routing is
   dropped; its `Shell` serves as the visual reference for the restyle.
5. **Auth = the starter's, no mock auth.** Drop the mock `SignInPage` and `auth-mock`. Roles map
   1:1: `owner → network_owner`, `operator → point_operator`. `scopeAfterSignIn` becomes "read
   `me.collection_point_id`". The mock's `auth.ts` (`roleOf` / `canActOnPoint`) is replaced by
   backend guards + reading `Me`. The login screen is restyled to the mock's identity.
6. **i18n = keys, `uk` default (§6a).** Keys, not hardcoded UA; `uk.json` supplies Ukrainian and
   is the default locale.
7. **Testing = the starter's conventions** (vitest + testing-library + vitest-axe). Full
   interaction tests for wired screens; a light render + axe smoke for harvested parts and ported
   `shared/ui` components. The mock's ratchet/mutation discipline does **not** come along.

## 5. FSD mapping

### 5.1 Wired this wave (full tests) — each its own stacked portion
Built on the ported design system, in the mock's style:
- **Catalog** (`Товари · Сорти · Тара`) → rebuilt in mock style over `/products`,
  `/product-grades`, `/tare-types`. Reuses catalog-admin-ui's API-hook logic and `RequireRole`.
- **Collection points** (`Точки`) → over `/collection-points`. Mock `PointsPage`.
- **Users** (net-new; the mock had no such screen) → over `/users` incl. password reset. Needed
  because an owner creates every operator account (no public registration; dev seed ships one
  `admin`).
- **Suppliers** (`Постачальники`) → over `/suppliers`. Mock `SuppliersPage` / `SupplierPage`.
- **Prices** (`Ціни дня`) → over `/grade-prices` (+ `/current`). Mock `PricesPage`. Richer than
  plain CRUD (per-point, per-grade, versioned), so it is the last and heaviest wired portion.

### 5.2 Harvested as parts (presentational, render+axe smoke) — separate portion(s)
Decoupled from `store.ts` into props/callbacks, placed by domain: `entities/crate/ui`,
`entities/cash/ui`, `entities/reception/ui`, `entities/transfer/ui`, `debts/SettleDialog`,
`common/Sparkline`, dashboard bits (crate dialogs, `CashLedger`, `ReceiptDialog`,
`PointStatePanel`, `SupplierPicker`, transfer history, etc.). No `api/`, no route, no store —
inventory for the money slices, which get their own brainstorming + backend later.

### 5.3 shared/ui
`shared/ui` becomes the **mock's UI kit**, wholesale — its shadcn primitives (button, card,
dialog, table, tabs, select, switch, input→text-input, sheet→drawer, popover, scroll-area,
separator, command, chart) plus its signature components (§6). The starter's visual primitives
are **superseded**, not merged with: where both define one (e.g. `StatTile`, `button`), the
mock's replaces the starter's, so there is one kit, not two.

> **Amendment (2026-09-08, colours portion):** *colours, surfaces and radii* are the mock's;
> *sizes* stay the starter's — the 46px / 16px-floor text controls (`field.tsx`, iOS no-zoom)
> and the `h-9` / 44px `cta` buttons are touch rules the mock's 32px controls would break. This
> is deliberate, not an unfinished port: do not "correct" the heights back to the mock's. The only starter pieces that stay
under `shared/` are the non-visual/structural ones — `shared/api`, `shared/lib/*` (env, i18n,
url-state, form-draft, theme, upload) — per the §0a seam. Existing starter screens are moved
onto the mock kit in the same portion (§10).

## 6. Design system + UI kit port

Both apps are Tailwind v4 (`@import "tailwindcss"`) + shadcn + CSS-variable tokens with identical
semantic names (`--background`, `--primary`, `--card`, `--border`, `--ring`, …). Porting is
therefore mechanical:

- **Primitives.** Move the mock's `components/ui/*` into the starter's `shared/ui`, superseding
  the starter's versions (§5.3). They already read the semantic tokens, so they inherit the
  theme with no edit beyond import paths.

- **Tokens.** Replace the starter's `:root` / `.dark` values in `frontend/src/index.css` with the
  mock's: paper `--background: #eceee8` (cool leaf-grey), the mock's accent/domain tokens
  (`--leaf`, `--amber`, `--sky`, `--readout`) and radius scale. Every consumer already reads the
  semantic token, so the swap re-themes the whole app.
- **Type.** Mock uses **Onest** (sans), **Unbounded** (display/heading), **JetBrains Mono**. Load
  them via `@fontsource-variable/*` (self-hosted, matching the starter's Geist setup) rather than
  the mock's Google-Fonts `<link>` — the mock's own notes flag that network cost. Drop the Geist
  fontsource deps once nothing references them (`deadcode`/knip will confirm).
- **Signature components.** Port `common/bits.tsx` into `shared/ui`: `Eyebrow`, `PageHeader`,
  `StatTile`, `ShareBar`, `EmptyState`, `Dot`, `CHART_COLORS`, and `Sparkline`. Adapt imports to
  FSD; keep them presentational.
- **Chart palette.** `CHART_COLORS = ['#c81e4e','#2e7bc4','#c57a00','#2e8b3e','#7c4dc0']` moves
  with the recharts `chart` primitive.

This is a `.tsx` + CSS + `package.json` change, so its portion runs build + smoke per
`frontend/CLAUDE.md`.

### 6a. i18n
Keys everywhere, `uk.json` as the default locale, translating auth/nav/screen keys. Because
components render through `t()`, Ukrainian arrives via `uk.json` without touching component code.
A second language is not a current goal, but keys cost little on the starter's existing i18n and
avoid a de-keying churn.

## 7. Delivery — stacked PRs, one portion each

```
main
 └─ PR  feat/yagoda-frontend-migration   (this design doc)
     └─ PR  design-system port (tokens · fonts · bits → shared/ui)
         └─ PR  uk locale + uk default
             └─ PR  catalog (rebuilt in mock style)
                 └─ PR  collection-points
                     └─ PR  users
                         └─ PR  suppliers
                             └─ PR  prices
                                 └─ PR  harvest: presentational parts
```

Each PR targets the branch below it; as each merges, the next re-targets `main`. Portions are
independently reviewable and revertable. The design-system port comes first because every page
depends on it. The harvest portion may be split per domain if it grows large.

## 8. Out of scope / deferred (recorded so it is not lost)

- **The money engine.** `calc.ts` becomes NestJS domain logic when the intake/cash/crates modules
  are built (it is TypeScript; it ports without a rewrite). The client re-adds only the live
  preview arithmetic (`weigh()` in the intake form) then, and that is when the `packages/domain`
  vs golden-tests decision is made.
- **The mock's 585 domain unit tests.** They stay in `yagoda-crm` and port to jest alongside
  `calc.ts`; not lost, not moved now.
- **`DomainSnapshot` as a single read.** Superseded by per-projection TanStack Query.
- **Intake, cash, crates, transfers, summaries, journal** as working screens — backends do not
  exist yet; only their parts are harvested.

## 9. Testing

Per `frontend/CLAUDE.md`: vitest + `@testing-library/react` + `vitest-axe`. Wired screens get
full interaction tests (create/edit dialogs, role guard, server-error-to-field mapping, the price
journal). Harvested parts and ported `shared/ui` components get a render + axe smoke each. The
design-system portion additionally needs build + smoke (theme/fonts break only in a real build).
CI (`lint`, `test`, `build`) runs per PR.

## 10. Risks & coordination

- **Fast-moving base.** `main` moved twice during design (suppliers + grade-prices landed).
  Re-verify endpoint/UI state at the start of each portion.
- **catalog-admin-ui closed.** Its branch is a logic reference, not a dependency. If the team
  later wants its wiring on `main` independently, that is a separate decision; this stack copies
  the reusable logic and owns the markup.
- **UI-kit swap is global.** Superseding the starter's visual primitives migrates every existing
  starter screen (login, profile, dashboard) onto the mock kit in the port's PR — they keep their
  starter logic and move to the mock's components/look. The main risk is a contrast regression;
  caught by the vitest-axe smoke plus a manual look.
- **i18n default flip** is isolated in its own early portion so a regression cannot hide inside a
  screen PR.
