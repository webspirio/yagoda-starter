# Mock-First Frontend → NestJS Migration: Architecture Brief

> **Purpose of this file.** Paste it at the start of a new session as context. It captures the
> goals, the verified facts, every decision and *why*, the tradeoffs accepted, and the open
> questions. It is a design brief, not a tutorial — code fragments are included only where the
> exact shape is load-bearing.
>
> **Status:** design agreed, not yet implemented.
> **Written:** 2026-09-09. Facts marked *(verified)* were checked against primary sources on
> that date; re-verify pricing and platform limits before relying on them.

---

## 1. Context

- Web/digital agency, team of ~4 developers, primarily German SMB clients.
- **NestJS is the standard backend framework.** Not up for debate; it is the constraint the
  frontend must be designed around.
- Recurring situation: a client needs to see and click through a working product *before*
  anyone writes backend code. The mock has to be convincing (real flows, real state,
  create/edit/delete that persists) and cheap to host.
- The mock must not become throwaway work.

## 2. Goals

| # | Goal | Success test |
|---|---|---|
| G1 | Fully interactive demo with **no backend** | Client creates an order, refreshes, it's still there |
| G2 | Migration to real NestJS is **config, not refactor** | Zero component-file diffs on migration day |
| G3 | Business logic written for the mock is **reused verbatim** in Nest | Same package imported by both, same tests pass |
| G4 | Hosting is free or near-free, **private** | Client-only access, no public repo required |
| G5 | Mock artifacts survive as **test fixtures** | Handlers reused in Vitest/Playwright after migration |

### Non-goals

- Not building a real database in the browser. No transactions, no concurrency, no locks.
- Not SEO. The demo is behind auth.
- Not offline-first or PWA. `localStorage` here is a demo store, not a sync layer.

## 3. Core principle

> **Mock the network, not the data.**

Components call `fetch('/api/orders')` from day one; a Service Worker answers. Migration is a
flag flip. Every alternative (a `DataProvider` with mock/http branches, `localStorage` reads
inside components, hardcoded fixture arrays) leaves seams that must be ripped out later — which
is exactly the work this design exists to avoid.

Corollary: **four seams, each independently swappable.**

1. **Contract** — OpenAPI/Zod, single source of truth
2. **Network** — MSW vs real HTTP
3. **Domain** — pure logic, framework-free, shared by both
4. **Storage** — `@mswjs/data` + `localStorage` vs Prisma/Postgres

---

## 4. Evidence (verified 2026-09-09)

Facts that drove decisions. Sources are primary where possible.

**MSW v2** *(mswjs.io)*
- API is `http.get/post/...`, `HttpResponse`, `setupWorker` from `msw/browser`. Anything using
  `rest.get()` / `res(ctx.json())` is v1-era and wrong.
- **Handlers execute on the main thread**, not inside the Service Worker. Therefore
  `localStorage`, `IndexedDB`, and `crypto.randomUUID()` are all usable directly inside handlers.
  This is what makes a stateful browser-side mock possible at all.

**Cloudflare Pages free plan** *(developers.cloudflare.com/pages/platform/limits, page last
updated 2026-09-05)*
- Static asset bandwidth and requests: **unmetered on every plan, including Free.**
- Builds: **500/month, 1 concurrent, 20-minute timeout.** Counted per *account*, not per project.
- 20,000 files/site; 25 MiB max per file; 100 custom domains per project; unlimited preview
  deployments; **100 projects per account** (explicitly "not routinely increased").
- Pages **Functions** bill against Workers Free: 100,000 req/day, 10 ms CPU. A purely static SPA
  never touches this.

**Cloudflare Access / Zero Trust**
- Free for up to **50 users**. A seat is consumed by an *authentication event* and held until the
  user is removed — so scope policies to named emails, not "anyone with the link."

**Workers Paid** — $5/month → 5,000 builds, 5 concurrent. Buys build quota only; nothing about a
static site gets faster.

**GitHub Pages** — no rewrite rules (SPA deep links need the `404.html` copy trick), public repo
required on the free tier.

**Astro** — official shadcn/ui support exists. Client env vars need the `PUBLIC_` prefix.
Islands do **not** share React context, so anything needing a Provider must live inside one `.tsx`
root.

**orval** — `mock: true` does generate MSW handlers from OpenAPI, but they are **stateless**: fresh
faker data per call. A demo where creating an order doesn't make it appear in the list is useless.
This was discovered mid-design and changed the plan (see D6).

---

## 5. Decisions

Each entry: what was chosen, why, what was rejected, what it costs.

### D1 — Contract-first, spec is a committed artifact

**Decision.** Write Zod schemas in `packages/contracts`. Scaffold the NestJS app *immediately*
with DTOs and controller signatures whose bodies `throw new NotImplementedException()`. Run it
once with `@nestjs/swagger` to emit `openapi.json`. Commit that file. Generate the typed client
from it.

**Why.** Solves the chicken-and-egg problem: you need an API contract before an API exists.
Controllers with empty bodies still produce a complete, valid OpenAPI document. `nestjs-zod`
(`createZodDto`) means the Nest DTOs and the frontend validation are literally the same schemas —
no duplication, no drift.

**Rejected.** Hand-writing types on the frontend and "matching them up later." That is where
every mock-to-real migration actually goes wrong.

**Cost.** You must scaffold Nest on day one even though it does nothing. ~1 hour. Worth it.

### D2 — MSW + `@mswjs/data`, persisted to `localStorage`

**Decision.** Real HTTP semantics in the browser: status codes, latency, 401s, validation errors.
Store as a JSON snapshot in `localStorage`, versioned, debounced writes.

**Why.** Loading states, error boundaries, retry logic and optimistic updates all get built
correctly the *first* time, because the mock behaves like a network.

**Rejected.** In-memory fixtures (nothing persists, demo is unconvincing); a fake `apiClient`
module (leaves a seam); json-server (a second process to run and deploy).

**Cost.** Service Worker registration is one more thing that can break. `localStorage` caps at
~5 MB. Cross-tab desync unless you listen for the `storage` event.

### D3 — Vite SPA, not Astro *(reversal)*

**Decision.** Vite + React + TanStack Router + shadcn/ui.

**Why it changed.** The design initially specified Astro. But because mock data lives in the
browser, nothing can be prerendered — the whole app ended up as one `client:only="react"` island
with client-side routing inside it. That is a SPA wearing an Astro costume, paying Astro's
complexity (`client:*` directives, hydration-mismatch bugs, `getStaticPaths` workarounds for
`/orders/:id`) for zero benefit.

**When Astro is right anyway:** marketing site + app in one deploy, MDX content collections,
a mostly-content site with a few widgets. If both are needed, use **two apps in the monorepo**
(`apps/site` Astro, `apps/web` Vite) rather than one framework doing both jobs badly.

**Deciding question:** *does any page that matters need to be crawlable and fast without JS?*
No → SPA.

### D4 — Cloudflare Pages, free tier, Access in front

**Decision.** Cloudflare Pages + `_redirects` SPA rewrite + Cloudflare Access scoped to client
emails. Stay on Free until the build counter bites.

**Why.** Per-account pricing, not per-seat — decisive at 4 developers. Unmetered bandwidth.
Password-protecting a client demo is free (Netlify charges $19/mo for the equivalent). Private
repos fine.

**Rejected.** GH Pages (public repo on free, no rewrites, no auth). Vercel/Netlify ($20/seat →
$80/mo for the team before hosting anything).

**Cost / watch items.** 500 builds/month is per *account* — ten client projects with PR previews
adds up. Mitigation: `wrangler pages deploy dist` for direct uploads (doesn't consume build
quota). 100 projects/account is a real ceiling for an agency; delete dead demos.

**Note on direction.** Cloudflare is steering new full-stack projects toward **Workers Static
Assets** rather than Pages. Pages is not deprecated and has better Git/preview ergonomics — use it
now; migration later is a `wrangler.toml` and a redeploy.

### D5 — Shared `packages/domain` with ports

**Decision.** Business logic lives in a package with **zero runtime dependencies** (only
`contracts`). No HTTP, no DB, no framework, no I/O. Persistence is reached through interfaces
(`OrderRepository`, `Clock`, `IdGen`) implemented twice: once over `@mswjs/data`, once over Prisma.

**Why.** This is the only mechanism that makes G3 true. Both the MSW handler and the Nest
controller become ~5-line translators over the same tested function.

**What to extract:** calculations (pricing, tax, discounts, proration), state machines,
invariants, derived values, authorization rules.
**What NOT to extract:** `findMany` wrappers, DTO mapping, pagination arithmetic.
**The test:** *would you write a unit test for this?* If no, leave it in the handler.

**Cost.** A package boundary and a build step. Over-extraction is a real failure mode — CRUD
passthrough in `domain` is pure overhead.

### D6 — Generate the client, hand-write the handlers

**Decision.** orval (or `@hey-api/openapi-ts`) generates the typed client and TanStack Query
hooks. MSW handlers are **written by hand** against the shared domain + store.

**Why.** Generated mocks are stateless (see Evidence). State is the entire point of the demo.

**Cost.** Handlers must be kept in sync with the spec manually. Mitigated by both sides importing
the same Zod schemas for request validation — a drift shows up as a parse error, not silent
wrongness.

### D7 — Shared error taxonomy

**Decision.** `DomainError` with a code → HTTP status map in `packages/domain`. Nest maps it via
one `@Catch(DomainError)` ExceptionFilter; MSW maps it via one `toResponse()` helper. Both emit
Nest's native envelope `{ statusCode, message, error }`.

**Why.** Frontend error handling is written once against real codes and keeps working after
migration. Without this, every error path gets rewritten.

---

## 6. Locked conventions (decide day one; changing them later is expensive)

| Convention | Rule | Why |
|---|---|---|
| **Money** | Integer minor units (cents) everywhere — Zod, store, Postgres | `19.99 * 3 = 59.97000000000001`. Floats ship rounding bugs. |
| **Dates** | ISO 8601 strings, never `Date` objects | `JSON.parse` does not revive `Date`. Matches what Nest returns anyway. |
| **Errors** | `{ statusCode, message, error }` + real HTTP status in mocks too | Nest's native shape |
| **Pagination** | `{ items, total }` (or cursor — pick one now) | Changing it touches every list |
| **Auth transport** | Bearer token *or* httpOnly cookie — pick and mock that one | Cookies can't be set cross-origin from a static host without config. Switching later rewrites the whole auth layer. |
| **Relations** | Plain FK strings, join in the handler | `@mswjs/data`'s `oneOf`/`manyOf` do not survive serialization |
| **Time** | Injected `Clock` port; never `Date.now()` inside domain | Deterministic tests |
| **Port signatures** | Always `async`, even in the mock | Sync ports break when Prisma arrives |
| **Base URL** | `VITE_API_BASE_URL` + Vite dev proxy for `/api` | Paths stay relative; CORS never enters the picture |
| **Store schema** | `VERSION` constant in the snapshot; mismatch → wipe + reseed | Otherwise a stale blob meets new handlers = undebuggable `undefined` |

---

## 7. Repo layout

```
webspirio-mock/                 # pnpm workspaces + turbo
├─ apps/
│  ├─ api/                      # NestJS — skeleton first, real later
│  └─ web/                      # Vite + React + shadcn/ui
├─ packages/
│  ├─ contracts/                # zod schemas + committed openapi.json
│  ├─ domain/                   # pure logic + ports + testing helpers (no deps)
│  ├─ api-client/               # GENERATED, gitignored
│  └─ mocks/                    # MSW handlers + @mswjs/data store + repo adapter
```

Dependency rule, enforceable in `package.json`:
`domain → contracts` only. `mocks → domain, contracts`. `api → domain, contracts`.
**Nothing depends on `mocks` except `web`.**

---

## 8. The shapes that matter

**Domain use case** — the thing that gets reused:

```ts
export async function payOrder(
  deps: { orders: OrderRepository; clock: Clock },
  orderId: string,
): Promise<Order> {
  const order = await deps.orders.findById(orderId);
  if (!order) throw new DomainError('ORDER_NOT_FOUND', `Order ${orderId} not found`);
  if (order.lines.length === 0) throw new DomainError('ORDER_EMPTY', 'Order has no lines');
  assertTransition(order.status, 'paid');
  const updated = { ...order, status: 'paid' as const, paidAt: deps.clock.now() };
  await deps.orders.save(updated);
  return updated;
}
```

**MSW handler** — translator:

```ts
http.post(`${API}/orders/:id/pay`, async ({ params }) => {
  try {
    const order = await payOrder({ orders: mswOrders, clock: realClock }, params.id as string);
    persist();
    return HttpResponse.json(order);
  } catch (e) { return toResponse(e); }
});
```

**Nest controller** — same translator:

```ts
@Post(':id/pay')
pay(@Param('id') id: string) {
  return payOrder({ orders: this.orders, clock: this.clock }, id);
}
```

**Boot order** — storage must be hydrated before the first request can fire:

```ts
async function boot() {
  if (import.meta.env.VITE_API_MOCK === 'true') {
    const { hydrate } = await import('@repo/mocks/db');
    const { worker } = await import('./mocks/browser');
    hydrate();
    await worker.start({
      serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
      onUnhandledRequest: 'bypass',
    });
  }
  createRoot(root).render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
}
```

Components only ever see generated hooks and never learn which backend answered:

```tsx
const { data, isLoading } = useListOrders({ page });
const create = useCreateOrder();
```

---

## 9. Testing strategy

Three layers, in value order:

1. **Pure domain tests** — no mocking framework, milliseconds. Property tests (fast-check) for
   money arithmetic specifically: rounding and off-by-one-cent is exactly where a reimplementation
   would silently diverge.
2. **Use-case tests** against an in-memory repository + fixed clock, both exported from
   `packages/domain/src/testing/`.
3. **Conformance tests** — the layer most people skip. Export the repository suite as a *function*
   and run it against every adapter:

```ts
testOrderRepository('mswjs/data', async () => mswOrderRepository(freshDb()));
testOrderRepository('prisma',     async () => new PrismaOrderRepository(await testDb()));
```

This catches the Prisma-returns-`Decimal`-where-the-mock-returned-`number` class of bug on the day
the adapter is written, not during the client demo.

After migration the MSW handlers stay as Vitest/Playwright fixtures — the mock work is not
throwaway.

---

## 10. Migration day

1. Fill in the Nest service methods. Spec unchanged → no regeneration needed.
2. Implement the Prisma repository; run the conformance suite against it.
3. `VITE_API_MOCK=false`, `VITE_API_BASE_URL=https://api.client.de`.
4. Redeploy.

Expected component-file diff: **zero**.

---

## 11. Known limits — where this design deliberately stops

- **No transactions in the browser.** Keep the transaction boundary *outside* the domain: Nest
  wraps a use case in `prisma.$transaction`, the mock just calls it. Do not simulate rollback in
  `localStorage` — that road ends in a bad database instead of a demo.
- **Concurrency, locks, background jobs, external API calls** live in the Nest service layer, not
  in `domain`. If a use case needs them, it is orchestration, not business logic.
- **~5 MB `localStorage` quota.** Base64 images blow through it instantly → IndexedDB
  (`idb-keyval`) or real URLs. Keep all access behind `persist()`/`hydrate()` so the swap is two
  lines.
- **Cross-tab desync** — two tabs hold the DB in memory; last write wins. Listen for the `storage`
  event and `invalidateQueries()` if multi-tab demos matter.
- **Ship a dev-only "Reset demo data" button.** Clients will wreck the seed mid-presentation.
  Seed with a fixed `faker.seed()` so every reset produces an identical demo.

---

## 12. Open questions for the next session

- [ ] Auth transport: Bearer vs httpOnly cookie — **must be decided before writing the first
      protected handler.**
- [ ] Pagination: offset (`{ items, total }`) vs cursor.
- [ ] Is a marketing site in scope? If yes → add `apps/site` (Astro) rather than bending the SPA.
- [ ] Does any client demo exceed 5 MB of mock data (file uploads, images)? If yes → IndexedDB
      from the start.
- [ ] Turborepo vs plain pnpm scripts — only worth it once `domain` has a build step in the
      critical path.
- [ ] Reusable starter template vs per-project setup. Given ~4 devs and repeat client work, a
      template repo is probably the real deliverable here; this brief is its README.

---

## 13. Corrections applied during design

Recorded so they are not re-litigated:

1. **Astro → Vite.** Astro was specified first and then withdrawn; with browser-resident mock data
   nothing prerenders, so its value proposition evaporates. (§D3)
2. **orval mocks are stateless.** Generated MSW handlers cannot back a stateful demo; generate the
   client only, hand-write handlers. (§D6)
3. **Money must be integers.** `total: Number` as a float was in the first draft of the schema. It
   is a shipping bug. (§6)