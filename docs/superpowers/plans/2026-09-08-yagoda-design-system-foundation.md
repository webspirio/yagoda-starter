# Design-System Foundation (theme + fonts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-theme the whole frontend to the mock's visual identity (leaf-grey paper, berry accent, Onest/Unbounded/JetBrains Mono type) by swapping `index.css` tokens and wiring self-hosted fonts — so every existing and future screen inherits the mock look through the semantic tokens they already read.

**Architecture:** Both apps are Tailwind v4 + shadcn with identical semantic token names, so the re-theme is a value swap in `frontend/src/index.css` plus a font-package swap in `app/App.tsx`. No component is rewritten in this portion — components read `--background`, `--primary`, `--font-sans`, etc., and retheme automatically. Light mode is ported in full; a mock dark palette does not exist, so `.dark` keeps the starter's neutrals with the berry accent aligned, and a full mock-dark palette is deferred (see Global Constraints).

**Tech Stack:** React 19, Vite, Tailwind v4 (`@theme inline` + CSS custom properties), `@fontsource-variable/*` self-hosted fonts, vitest + `@testing-library/react` + `vitest-axe`.

**Spec:** `docs/superpowers/specs/2026-09-08-yagoda-frontend-migration.md` (§4.0, §6 — this is the first portion of the stack)

## Global Constraints

- **Seam (spec §0a):** structure/organisation follows the starter; UI/design system comes from the mock. This portion is the design-system half.
- **Fonts self-hosted** via `@fontsource-variable/*` (matching the starter's Geist wiring), NOT Google Fonts `<link>`. Variable-font CSS family names carry the ` Variable` suffix: `'Onest Variable'`, `'Unbounded Variable'`, `'JetBrains Mono Variable'`.
- **Theme-aware rules (starter house style):** every color is defined on `:root` and consumed via the `@theme inline` `--color-*` mapping; never hardcode a hex in a component.
- **Dark mode:** the mock is light-only. This portion ports light fully; `.dark` is kept functional (starter neutrals + berry accent) and a designed mock-dark palette is **out of scope**, flagged for the owner.
- **No Playwright in the starter.** Automated gates are `npm run lint`, `npm test` (vitest + axe), `npm run build`. The visual check is manual via `docker compose up`.
- **Money/strings, FSD layers, uk-default** — not touched by this portion.

---

### Task 1: Self-host the mock's typefaces

**Files:**
- Modify: `frontend/package.json` (dependencies)
- Modify: `frontend/src/app/App.tsx:1-2` (font imports)
- Lockfile: `package-lock.json` (root — npm workspace)

**Interfaces:**
- Produces: the CSS font families `'Onest Variable'`, `'Unbounded Variable'`, `'JetBrains Mono Variable'` become available globally once imported. Task 2 references them in `--font-*` tokens.

- [ ] **Step 1: Add the font packages**

Run (from repo root, so the workspace lockfile updates):
```bash
npm install --workspace=frontend \
  @fontsource-variable/onest@5.3.1 \
  @fontsource-variable/unbounded@5.3.0 \
  @fontsource-variable/jetbrains-mono@5.3.0
```

- [ ] **Step 2: Swap the font imports in App.tsx**

In `frontend/src/app/App.tsx`, replace the two Geist imports at the top:
```ts
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
```
with:
```ts
import '@fontsource-variable/onest';
import '@fontsource-variable/unbounded';
import '@fontsource-variable/jetbrains-mono';
```

- [ ] **Step 3: Remove the now-unused Geist packages**

Run (from repo root):
```bash
npm uninstall --workspace=frontend @fontsource-variable/geist @fontsource-variable/geist-mono
```
Confirm nothing else references them:
```bash
grep -rn "geist" frontend/src && echo "STILL REFERENCED — do not remove" || echo "clean"
```
Expected: `clean`.

- [ ] **Step 4: Verify the build resolves the fonts**

Run:
```bash
npm run build --workspace=frontend
```
Expected: build succeeds; no "Failed to resolve import '@fontsource-variable/…'".

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json package-lock.json frontend/src/app/App.tsx
git commit -m "feat(theme): self-host Onest/Unbounded/JetBrains Mono, drop Geist"
```

---

### Task 2: Port the mock's light theme, base layer and utilities into index.css

**Files:**
- Modify: `frontend/src/index.css` (`:root`, `@theme inline`, `@layer base`, add utilities/keyframes/print)

**Interfaces:**
- Consumes: the font families from Task 1.
- Produces: the semantic tokens (`--background`, `--primary`, `--leaf`, `--amber`, `--sky`, `--readout`, `--chart-1..5`, `--font-display`, radius scale) and the `font-display` / `eyebrow` utilities that Task 3 (dark) and every later screen/component portion rely on.

- [ ] **Step 1: Replace the `:root` light values**

In `frontend/src/index.css`, replace the body of the `:root { … }` block (lines ~9–48, the light tokens) with the mock's palette. Keep the starter-only tokens `--surface`, `--muted2`, `--line2` (no mock equivalent) mapped to sensible mock neighbours so existing components that read them keep working:
```css
:root {
  --radius: 0.5rem;

  /* paper — cool leaf grey, not cream */
  --background: #eceee8;
  --foreground: #171a15;
  --surface: #ffffff;              /* starter token: headers/sticky bars — white, as card */
  --card: #ffffff;
  --card-foreground: #171a15;
  --popover: #ffffff;
  --popover-foreground: #171a15;

  /* berry — the one loud colour */
  --primary: #c81e4e;
  --primary-foreground: #fff4f7;

  --secondary: #e1e4db;
  --secondary-foreground: #2b2f27;
  --muted: #e4e7de;
  --muted-foreground: #6c7167;
  --muted2: #6c7167;               /* starter token: tertiary text — map to muted-foreground */
  --accent: #dee2d7;
  --accent-foreground: #171a15;
  --brand: #c81e4e;                /* starter token: accent ink — map to berry */
  --brand-foreground: #fff4f7;     /* starter token: text on brand fills */
  --destructive: #c02b2b;
  --success: #2e7a3c;              /* starter token: map to mock leaf */
  --border: #d7dbd0;
  --line2: #cfd4c6;                /* starter token: stronger divider — map to mock input */
  --input: #cfd4c6;
  --ring: #c81e4e;

  /* mock instrument + domain tokens */
  --readout: #a8e86a;
  --leaf: #2e7a3c;
  --amber: #c57a00;
  --sky: #2e7bc4;

  /* validated categorical set */
  --chart-1: #c81e4e;
  --chart-2: #2e7bc4;
  --chart-3: #c57a00;
  --chart-4: #2e8b3e;
  --chart-5: #7c4dc0;

  /* dark sidebar (mock) */
  --sidebar: #14170f;
  --sidebar-foreground: #c4cbba;
  --sidebar-primary: #c81e4e;
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: #232719;
  --sidebar-accent-foreground: #f2f5ec;
  --sidebar-border: #2b3022;
  --sidebar-ring: #c81e4e;
}
```

- [ ] **Step 2: Extend `@theme inline` with the mock's font, domain-color and radius tokens**

In the existing `@theme inline { … }` block, set the font tokens and add the mock's extra color + radius mappings. Replace the two `--font-*` lines with:
```css
  --font-sans: 'Onest Variable', ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-display: 'Unbounded Variable', 'Onest Variable', ui-sans-serif, sans-serif;
  --font-heading: var(--font-display);
  --font-mono: 'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace;
```
Add, alongside the existing `--color-*` mappings:
```css
  --color-readout: var(--readout);
  --color-leaf: var(--leaf);
  --color-amber: var(--amber);
  --color-sky: var(--sky);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
```
Replace the radius scale (`--radius-sm..--radius-xl`) with the mock's multiplier scale:
```css
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
```

- [ ] **Step 3: Add the mock's base-layer number rule and utilities**

Inside the existing `@layer base { … }`, add the tabular-nums rule (money and mass are always tabular):
```css
  .tnum,
  table,
  input {
    font-variant-numeric: tabular-nums;
  }
```
After the base layer, add the two mock utilities (keep the starter's `no-scrollbar` utility):
```css
@utility font-display {
  font-family: var(--font-display);
  letter-spacing: -0.03em;
}

@utility eyebrow {
  font-size: 11px;
  line-height: 1.2;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--muted-foreground);
}
```

- [ ] **Step 4: Port the sync-sweep keyframe, reduced-motion and print styles**

Append the mock's `@keyframes sync-sweep` + `.animate-sweep`, the `@media (prefers-reduced-motion: reduce)` block, and the full print block (`.printable`, `.print-only`, `.print-hide`, `@page landscape-sheet`, the print color-adjust rules) verbatim from the mock's `src/index.css` lines 141–286. These are referenced by harvested components later (receipt/day-report printing, the sync banner).

- [ ] **Step 5: Verify lint and build**

Run:
```bash
npm run lint --workspace=frontend
npm run build --workspace=frontend
```
Expected: both pass. (CSS is not type-checked, so the gate here is that Tailwind compiles the `@theme`/`@utility`/`@layer` blocks without error.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat(theme): port the mock's light palette, type scale, utilities and print styles"
```

---

### Task 3: Align dark mode's accent, defer a full mock-dark palette

**Files:**
- Modify: `frontend/src/index.css` (`.dark` block)

**Interfaces:**
- Consumes: nothing new.
- Produces: dark mode that keeps the starter's neutral surfaces but shows the mock's berry accent, so a viewer in dark mode sees a consistent brand until a designed mock-dark palette lands.

- [ ] **Step 1: Swap the dark accent tokens to berry**

In the `.dark { … }` block, change only the accent/ring tokens so the brand colour matches light mode; leave the neutral surfaces as the starter defined them:
```css
  --primary: #c81e4e;
  --primary-foreground: #fff4f7;
  --brand: #c81e4e;
  --brand-foreground: #fff4f7;
  --ring: #c81e4e;
```
Leave `--background`, `--card`, `--muted`, `--border`, etc. as the starter's dark neutrals (a designed mock-dark palette is a separate, owner-gated task — see Global Constraints).

- [ ] **Step 2: Verify build**

Run:
```bash
npm run build --workspace=frontend
```
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat(theme): align dark-mode accent to berry; defer a designed mock-dark palette"
```

---

### Task 4: Full-app verification under the new theme

**Files:**
- Test: existing suites only (no new files) — `frontend/src/**/*.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: evidence the re-theme broke no existing screen (login, profile, dashboard) or component test.

- [ ] **Step 1: Run the full frontend test suite**

Run:
```bash
npm test --workspace=frontend
```
Expected: PASS. Component tests assert semantic classes (`bg-card`, `text-muted-foreground`) and run `vitest-axe`, so a broken token surfaces here. If a test asserted a literal Geist family name or a starter-specific hex, update that assertion to the mock token in the same commit and note it in the message.

- [ ] **Step 2: Run lint and build together**

Run:
```bash
npm run lint --workspace=frontend && npm run build --workspace=frontend
```
Expected: both PASS.

- [ ] **Step 3: Manual visual check (no Playwright in this repo)**

Run (from repo root):
```bash
docker compose up -d --build
```
Open `http://localhost:5173`, sign in `admin` / `admin`, and confirm on **login**, **dashboard** and **profile**: leaf-grey `#eceee8` page background, Onest body text, Unbounded headings, berry `#c81e4e` primary buttons, and no unreadable low-contrast text. Toggle the theme (dark) and confirm it stays legible with the berry accent.

- [ ] **Step 4: Commit any assertion fixes from Step 1**

Only if Step 1 required test edits:
```bash
git add frontend/src
git commit -m "test(theme): update assertions to the mock's tokens"
```

---

## Self-Review

**Spec coverage (spec §6):** Tokens (Task 2 Step 1–2), Type/fonts (Task 1 + Task 2 Step 2), base layer + `font-display`/`eyebrow` utilities + print (Task 2 Step 3–4), dark handling (Task 3), existing-screen migration re-check (Task 4). The **signature components** (`bits.tsx` → `shared/ui`) and **primitive supersession** from spec §5.3/§6 are intentionally the *next* portion, keeping this PR to the theme foundation — noted here and in the stack (spec §7); update the spec's §7 diagram to split "design-system port" into "theme + fonts" (this plan) and "shared/ui kit" (next).

**Placeholder scan:** none — every token value, import line and command is concrete.

**Type consistency:** no TypeScript surface changes except the font `import` side effects in Task 1; the CSS family names in Task 2 match the ` Variable` suffix the fontsource-variable packages register.

**Open item for the owner (raise at handoff):** dark mode. This portion keeps the starter's dark neutrals with a berry accent. Options for later: (a) design a mock-dark palette, (b) gate the app to light-only (the mock is light-only). Not decided here.
