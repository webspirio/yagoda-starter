# Query cache by allowlist — Design

**Date:** 2026-09-24
**Slice:** frontend server-state freshness (`frontend/src/shared/api`)
**Trigger:** stale-data artifacts on `/reception`

## 1. Problem

`/reception` shows data that is no longer true, and nothing on the screen says so. The
cause is the TanStack Query client, not the page, not HTTP caching, and not
memoization:

- **Ruled out.** The `localStorage` persister keeps only `me` (`isPersistableKey`). No
  React Compiler runs (no babel plugin in `vite.config.ts`; the comments that mention it
  mean the `react-hooks` lint rules). nginx caches only `/assets/`; `/api` is
  untouched. `useIntakePreview` discards superseded responses and only a settled preview
  reaches the screen.
- **The cause.** `queryClient.ts` sets `refetchOnWindowFocus: false`, no query polls, and
  `gcTime` is 24h. Every hook then picks its own freshness window: 30 of them hard-code a
  `staleTime` of 30 s, 1 min, 5 min or 30 min. The drawer (`pointCash`), the shift's
  receipts, payouts and cash counts, crate balances and the point's prices are all 5 min.
  An open tab therefore refetches only when THIS browser writes something, and navigating
  back inside the window serves the cached figure without asking the server at all.
- **What the operator sees.** A void, a transfer or a dispute resolution done by the owner
  on another device does not reach the drawer, «Прийомки за сьогодні» or «Стан точки»;
  «Видано готівкою» is capped by a drawer figure that has since moved; a grade priced
  elsewhere is missing from the picker; a supplier created elsewhere is not found.

The mechanism is the wrong way round. Freshness is decided per hook, by whoever wrote it,
and caching is the default a hook opts OUT of. For screens where money and documents move
under several people's hands, that default is wrong.

## 2. Decision

**Nothing is cached unless its query key is on one allowlist.** Freshness is a property
of the DATA (the query key), not of the route: `useIntakesQuery({ shiftId })` is one cache
entry whether `/reception`, `/day` or the dashboard reads it, so a per-route switch would
make two routes fight over one entry. The allowlist mirrors the persister's
`isPersistableKey`, a pattern this codebase already uses: default-deny, explicit
inclusion, one list.

### 2.1 The allowlist

| Key | Why it may be cached |
|---|---|
| `queryKeys.me` | the signed-in user's own profile; already persisted |
| `queryKeys.tareTypes` | tare registry — owner-edited, rarely |
| `queryKeys.products` | catalog — owner-edited, rarely |
| `queryKeys.productGrades()` (prefix, so `['product-grades', 'active']` and per-product keys too) | catalog — owner-edited, rarely |

**Deliberately NOT on it:** `collectionPoints` (the row carries `target_crates`, which
`/reception` and `/crates` show as a live figure), `users`/staff (active flag, point
assignment), and everything that is money or a document — prices, cash, shifts, intakes,
payouts, top-ups, transfers, crates, cash counts, reweighs, cost of day, day expenses,
suppliers and supplier balances.

### 2.2 What «not cached» means

Every query not on the allowlist gets:

| Option | Value | Effect |
|---|---|---|
| `staleTime` | `0` | stale the moment it lands |
| `gcTime` | `0` | dropped as soon as nothing reads it — returning to a screen shows the loading state, never a previous visit's figures |
| `refetchOnMount` | `true` | every mount asks the server |
| `refetchOnWindowFocus` | `true` | returning to the tab asks the server |
| `retry` | `1` | unchanged |

Allowlisted keys get `staleTime` 30 min and `gcTime` 24h — the latter keeps the
persister's `gcTime >= maxAge` requirement for `me`.

**Mutations get `gcTime: 0` too.** A settled mutation's `data` is held for `gcTime`
(5 min by default) once nothing observes it — and one mutation's `data` is a plaintext
password (`useRevealPasswordMutation`, `pages/users/api/users.ts`, which sets `gcTime: 0`
itself today). The lint rule of §3.4 forbids that per-hook option, so the guarantee moves
into the client default rather than being lost. Nothing in `src` reads the mutation cache
from outside the observing component (`useMutationState`, `useIsMutating`,
`getMutationCache` — zero uses), so the default changes no screen.

## 3. Components

### 3.1 `shared/api/cachePolicy.ts` (new)

- `CACHEABLE_KEYS` — the four keys of §2.1, and the only place a key becomes cacheable.
- `createQueryClient(): QueryClient` — builds a client with the §2.2 defaults, then calls
  `setQueryDefaults(key, { staleTime: 30 min, gcTime: 24h })` for each allowlisted key.
  `setQueryDefaults` matches by key prefix, which is what covers
  `['product-grades', 'active']`.

### 3.2 `shared/api/queryClient.ts`

Becomes `export const queryClient = createQueryClient()`. The `STALE` export and its
re-export from `shared/api/index.ts` are removed: no hook decides a freshness window any
more.

### 3.3 The hooks

Every `staleTime:` is deleted from the 29 non-test files that set one (list:
`grep -rlE '\bstaleTime\s*:' frontend/src | grep -v '\.test\.'`), including the explicit
`staleTime: 0` in `features/count-shift/api/crateDispatch.ts` and
`features/return-crates/api/useReturnCrates.ts` (and that file's `gcTime: 0`, plus
`useRevealPasswordMutation`'s — see §2.2); they are now the default, and the
comment in `crateDispatch.ts` about «not inheriting the client's 30-second staleTime» is
rewritten to match. Doc comments that describe a hook's freshness window are corrected in
the same pass.

### 3.4 The lint rule — the allowlist cannot be bypassed from a hook

A hook that sets `staleTime`/`gcTime`/`refetchOnMount`/`refetchOnWindowFocus` itself
would quietly re-open the per-hook model. ESLint forbids those four property names in
`frontend/src` outside `shared/api/cachePolicy.ts` and test files, with no
`eslint-disable` anywhere.

**Constraint from the existing config:** `eslint.config.mjs` already has a
`no-restricted-syntax` block for raw `<input>` on `entities|features|widgets|pages/**/*.tsx`,
and flat config makes an overlapping second block REPLACE its options rather than merge
(the note at `eslint.config.mjs:189-192`). So the freshness selectors live in one shared
constant spread into BOTH that existing block and a new block covering the paths it does
not (`src/**/*.ts`, `src/app/**/*.tsx`, `src/shared/**/*.tsx`), each block ignoring
`cachePolicy.ts` and `*.test.*`. The raw-`<input>` rule's existing test files keep their
current coverage.

## 4. Testing

`shared/api/cachePolicy.test.ts`, written first and red against the current client:

1. A key off the allowlist (`queryKeys.intakes`) refetches when re-mounted, and is gone
   from the cache once its last observer unmounts.
2. An allowlisted key (`tare-types`, and `['product-grades', 'active']` for the prefix)
   does NOT refetch when re-mounted inside its window.
3. A window-focus event refetches a key off the allowlist.
4. A settled mutation's `data` is gone from the mutation cache once unobserved.

A lint fixture proves the rule fires on `staleTime` in a `.ts` hook and in a page `.tsx`,
and that the raw-`<input>` rule still fires after the options merge.

The 44 test files that build their own `new QueryClient(...)` are untouched: they test
hook behaviour, not cache policy. Three test comments that cite `STALE.list` or a 24h
`gcTime` are corrected in wording only.

**Verification:** `npm run verify` — the change is application code only.

## 5. Out of scope

- **Polling** an always-focused tab (e.g. an operator who never leaves `/reception` while
  the owner voids from another device). Recorded as a follow-up.
- **`crateBalances` not invalidated by an intake create or void** (`/crates` «з ягодою»),
  an adjacent bug. Recorded as a follow-up. Once this slice lands, it only survives while
  `/crates` stays mounted.
- Migrating test clients to `createQueryClient()`.

## 6. Docs

`frontend/CLAUDE.md` «Server state»: replace the defaults paragraph and the `STALE`
guidance with the allowlist rule and where to add a key. Follow-ups doc gains the two
§5 entries.
