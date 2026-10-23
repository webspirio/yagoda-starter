# Inactive suppliers — the crates table, the return dialog, the suppliers list (#228)

**Date:** 2026-10-21
**Source:** issue #228 («Видалення постачальника не має існувати»). Every decision below was
settled with the owner in a grilling session on 2026-10-21; calls the spec author made alone
are marked **(author's call)**. §6.3 and §7 were revised the same day after a builder check
found that the backend already refuses every money write to an inactive supplier; the owner
re-decided §6.3 on that basis.

**Position in the schema:** none. Two read queries change, one gains a parameter, one read
gains a field. No table, column, index or migration changes.

---

## 1. Why

The client reads deactivation as deletion. A supplier switched off in the edit dialog
vanishes from «Постачальники» with no way to list them again, and the only place they still
show up is «Ящики» — with an «неактивна» badge, even though that person never took a crate.
The issue asks for a selector that lists inactive suppliers the way active ones are listed.

Investigating the crates table turned up three defects behind that experience:

| # | Where | What happens today |
|---|---|---|
| A | `crate-balances.service.ts`, `include_zero` | The switch reads «Показати всіх, хто брав ящики», but the query `LEFT JOIN`s from **every supplier at the point**. Anyone ever registered there — active or not, crates or not — shows up with 0. This is the screenshot in the issue. |
| B | `list-supplier-totals.query.ts:45` | Hard `WHERE s.is_active = true`; the page has no way to ask for anything else. |
| C | `ReturnCratesDialog` | Lists suppliers from `/suppliers` without `include_inactive`. An inactive supplier holding crates is in the table but cannot be picked, although the backend accepts the return (among the crate writes, `SUPPLIER_INACTIVE` guards only the issuance). Their crates are stuck. |

For reference, `SUPPLIER_INACTIVE` is what the backend answers to every NEW money or crate
document for an inactive supplier: intake pricing/create (`price-intake.query.ts:63`), payout
(`create-payout.command.ts:46`), top-up (`create-intake-top-up.command.ts:62`) and crate
issuance (`crates.service.ts:83`). Crate returns and voids are not guarded.

Checked and **not** a problem: a supplier is nailed to one point (§3.9 — `collection_point_id`
is not editable, and every crate write checks `supplier.collection_point_id === pointId`), so
crates out at one point under a supplier homed at another cannot occur.

## 2. Goals

1. «Ящики»'s switch does what it says.
2. Anyone the table lists as holding crates can be picked in «Прийняти ящики».
3. «Постачальники» can list inactive suppliers.
4. Opening an inactive supplier's card says they are inactive.

## 3. Non-goals

- **No guard on deactivation.** Deactivating someone who holds crates or owes money stays
  allowed, with no warning. After C is fixed, an inactive supplier holding crates is a fully
  supported state: listed with a badge, can return crates, cannot be issued more.
- **The issue dialog stays active-only.** The backend refuses an issuance to an inactive
  supplier; listing one would offer a guaranteed error.
- **No change to who may be paid.** An owed inactive supplier stays unpayable, as the backend
  already rules; whether that is the right policy is §7's open question.
- **`SupplierPicker` (reception) is untouched** — see §7. «Борги» gets the card's treatment
  in review: «Видати без ягоди» is disabled on an inactive row, which the backend would refuse.
- No new «Стан» column, no reactivation shortcut. Reactivating stays the existing switch in
  the edit dialog, reachable from every row of the list.

## 4. «Ящики» — `GET /crate-balances?include_zero=true`

### 4.1 New meaning

`include_zero=true` lists every supplier at the point with **at least one non-voided crate
issuance** at that point, whatever is left open. `include_zero=false` (the default) is
unchanged: only suppliers with open tranches.

| Supplier | `include_zero=false` | `include_zero=true` |
|---|---|---|
| Active, holds crates | listed | listed |
| Inactive, holds crates | listed, badge | listed, badge |
| Returned everything | — | listed, 0 |
| Inactive, returned everything | — | listed, 0, badge |
| Only voided issuances | — | — |
| Never issued a crate | — | — (**was listed**) |

The badge already exists (`InFieldTable.tsx:86`, `crates.inField.inactive`). Nothing about
it changes.

### 4.2 Shape

In SQL: with the switch on, the `LEFT JOIN rolled` is constrained to suppliers who appear in
`crate_issuances` (`voided_at IS NULL`) through a shift at the requested point. The response
shape does not change. Ordering, pagination and the `total` count follow the new row set.

The DTO doc comment on `ListCrateBalancesQueryDto.include_zero` is rewritten to the new
meaning; the switch label «Показати всіх, хто брав ящики» is now accurate and stays as is.

### 4.3 The «N ящ. · M осіб» summary **(author's call)**

The table header renders `crates.inField.summary` with `count = balances.total`. With the
switch on, that would count people holding zero. `GET /crate-standing` gains a `holders`
field — distinct suppliers with an open tranche at the point, computed from the same
`openTranchesSql` fragment as `in_field` — and the header reads it instead. The «Показано
перших N з M» truncation note keeps using `balances.total`, which is a row count.

## 5. «Прийняти ящики» — `ReturnCratesDialog`

The supplier select is fed by `useCrateBalancesQuery` (`include_zero=false`) for the dialog's
point instead of `useSuppliersQuery`. It therefore lists exactly the current holders, active
and inactive. Each option reads `<name> — <outstanding_units>` with the inactive marker
appended when `is_active` is false, e.g. «Коваль Іван — 12 · неактивна» (reusing
`crates.inField.inactive`; exact formatting is the builder's).

- **No silent truncation.** `/crate-balances` caps `limit` at 100. The dialog must list every
  holder: fetching subsequent pages until `total` is reached is the expected approach
  **(author's call)**; the builder may choose another one that meets the same bar.
- **Owner with no point** — unchanged; the dialog only renders once a point is chosen.
- **Empty state.** When nobody at the point holds crates, the select has no options; the
  dialog says so instead of offering an empty list (wording is the builder's).
- The preview (`useReturnPreviewQuery`) and the submit path are unchanged.

## 6. «Постачальники» and the card

### 6.1 `GET /supplier-totals?status=`

`ListSupplierTotalsQueryDto` gains `status: 'active' | 'inactive' | 'all'`, default
`'active'`. The hard `WHERE s.is_active = true` becomes the matching predicate (none for
`'all'`). Search, sorting (weight, amount, name — `uk-UA-x-icu` collation through
`supplier-order.ts`), the unpaged shape and operator scoping are unchanged. The response row
already carries `is_active` (`SupplierTotalsRowResponse = SupplierResponse & …`). The DTO
doc comment that says «Active suppliers only — the page has no Стан column» is rewritten.

### 6.2 The selector

A three-state selector beside the search box: **Активні** (default) / **Неактивні** /
**Усі**. It lives in the URL beside `sort` and `order` (#230's `useUrlParam` /
`useUrlPatch`), so Back from a card returns to the same view; an absent or unknown value
reads as `active`. It is available to both roles, like the page itself.

The control itself — segmented buttons or a `SelectField` — is the builder's, from the
existing `shared/ui` kit.

- An inactive row shows the existing outline `Badge` («Неактивний») next to the name, in any
  state.
- The empty state for **Неактивні** says there are no deactivated suppliers rather than
  reusing the «no suppliers yet» copy.

### 6.3 Supplier card

When `is_active` is false, `SupplierCardPage`:

- shows an outline `Badge` «Неактивний» next to the name in the `PageHeader`;
- shows a short banner under the header: «Постачальника деактивовано — прийом, виплати й
  доплати недоступні. Щоб провести гроші, спершу активуйте.» (final copy and its English
  twin are the builder's; the meaning is fixed). The rules it states are the backend's
  `SUPPLIER_INACTIVE` guards listed in §1, so it promises nothing new;
- **hides** «Виплатити N ₴» (`SupplierCardPage.tsx:226-231`) and the timeline's «Додати
  доплату» (`SupplierTimeline.tsx:288`) — both would be a guaranteed `SUPPLIER_INACTIVE`.

Everything else stays: tiles, debt, open balances, the timeline, and the void buttons (voids
are not guarded by activity). Reactivating stays the edit dialog's switch; the banner points
at it in words, not with a new button.

### 6.4 «← Постачальники» keeps the list's view **(author's call)**

The card's back link is hard-coded `to="/suppliers"` (`SupplierCardPage.tsx:207`), so it
drops `sort`, `order` and now `status`. Someone working through «Неактивні» would land on
«Активні» and watch the person they just opened vanish again — #228's complaint. The list
passes its current query string to the card when it navigates (row click and name link, e.g.
via router `state`), and the back link returns to `/suppliers` with it; a card opened any
other way (deep link, «Ящики», «Борги») falls back to plain `/suppliers`.

## 7. Follow-up (recorded, not built)

Added to `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`:

- **Can an owed inactive supplier be paid?** Today no: the backend refuses the payout
  (`SUPPLIER_INACTIVE`) and the UI copy says «спершу активуйте», so the workflow is
  activate → pay → deactivate. A question for the client, not a defect.
  If the answer becomes yes, the card's payout actions and «Борги»'s «Видати без ягоди»
  (disabled on an inactive row — built in review, no longer a follow-up) re-enable together.
- **Optional:** warn in the edit dialog when deactivating someone who still holds crates or
  is owed money.

## 8. Tests that pin it

- `crate-balances.db-spec.ts`: one supplier per §4.1 row — the «never issued» and «only
  voided» rows prove the switch no longer leaks them; an inactive holder is listed both ways.
- `crate-standing.db-spec.ts`: `holders` counts distinct suppliers with open tranches and
  agrees with `/crate-balances`' `total` at `include_zero=false`.
- `/supplier-totals`: each `status` value, and the default, against a point with one active
  and one inactive supplier; an invalid value is a 400.
- `ReturnCratesDialog.test.tsx`: an inactive holder is selectable with the marker; a supplier
  with no crates is absent; more than one page of holders is all listed.
- `SuppliersPage` and `SupplierCardPage` tests for the selector (including URL round-trip)
  and both badges; on an inactive card the banner shows and neither «Виплатити» nor «Додати
  доплату» renders, on an active card nothing changes; the back link carries the list's
  `status`/`sort`/`order` when the card was opened from the list.

Frontend tests pin English (`test-setup`); the Ukrainian strings need their own language
switch where asserted.

## 9. Left to the builder

- Exact SQL for §4.2 (`EXISTS` vs a join) and for `holders`.
- The selector control and its i18n keys; the empty-state copy for **Неактивні** and for the
  return dialog.
- How the return dialog walks pages, within §5's no-truncation bar.
- How the list hands its query string to the card (§6.4).
