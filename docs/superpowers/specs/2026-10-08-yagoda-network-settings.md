# Yagoda CRM — Network Settings & the Receipt Note

**Date:** 2026-10-08
**Source:** the `/grilling` (Q1–Q10) and brainstorming sessions of 2026-10-08; the receipt
print fixes already on this branch (`fb0b619`, `9751dda`, `89042f2`) and the per-receipt note
commit `8bbd352`, whose wrapping and field this slice reuses.

**Builds on:** `fix/receipt-print-and-blank-lines` (PR #222). The slice lands in the same PR.

**Position in the schema:** one new table, `network_settings`, making twenty-four. One
migration that also inserts its only row. Two new endpoints, one new page.

---

## 1. Goal

The network owner writes one text that prints on the seven ruled lines of every receipt in
the network. The operator types nothing; the per-receipt note field from `8bbd352` goes away.

The table is named for what it is — the network's settings — not for this one text, because
more settings are expected and not yet known.

### Success

- After the owner saves a text, the next receipt printed anywhere in the network — a reprint
  of an old one included — shows it on the ruled lines.
- An empty text prints blank ruled lines.
- A text that does not fit 7 × 40 is refused by the server.
- Every save that actually changes the text leaves one audit entry.

### Out of scope

- Moving the surcharge bound or the розписка threshold into the table. They stay in code;
  the table only makes room for them.
- Per-point texts. One value for the whole network.
- Freezing the text into a receipt. A reprint shows the CURRENT text (§3.3).
- A receipt preview on the settings page.

---

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| 1 | No per-receipt note field; the lines print the network's text. | The owner sets it; an operator must not silently alter it per receipt. |
| 2 | One-row table, one typed column per setting. A new setting is a new column. | Keeps types, `NULL`/`CHECK` and the DBML as the record of what is configurable; a key–value table would move all of that into JSON. |
| 3 | `network_settings`, column `receipt_note`. | «Network» already means network-wide in the schema; «note» is what the code calls these lines. |
| 4 | Store the text already wrapped. The server checks shape only: ≤ 7 lines, each ≤ 40 characters. | The wrap algorithm lives in one place (the editor); what the owner saw is what prints. |
| 5 | A reprint prints the current text, no snapshot. | §2.7 freezes kilograms and money, not this text; a snapshot would add a column to `intakes`. |
| 6 | Audit `network-settings.updated` with `before`/`after`, only on a real change, in the write's transaction. The row keeps `updated_at` only. | Same as every other reference-data write; the audit already says who. |
| 7 | `GET /network-settings` for any signed-in user, `PATCH` owner-only. The migration creates the row. The receipt reads it by its own request. | The operator prints receipts; no 404 path; `intakes` must not depend on settings. |
| 8 | New page `/settings` «Налаштування мережі», owner-only, last in «Управління». | A neutral page for a neutral table; «Довідники» holds lists of records, not one record. |
| 9 | An explicit «Зберегти», no autosave; the editor is the existing 7 × 40 field, no preview. | Each save is an audit entry; the field already has the paper's shape. |
| 10 | If the settings request fails, the receipt warns and still prints, with blank lines. While it is in flight, printing waits. | The note is secondary; it must never block handing a supplier their receipt. |

---

## 3. Data

### 3.1 Migration `1788600000021-NetworkSettings.ts`

```sql
CREATE TABLE network_settings (
  id           boolean PRIMARY KEY DEFAULT true CHECK (id),
  receipt_note text NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO network_settings DEFAULT VALUES;
```

`down` drops the table. The boolean key with `CHECK (id)` makes a second row impossible.

### 3.2 Documents

- `28-db-schema.dbml` gains `Table network_settings` with a note on the one-row rule and on
  the wrapped storage of `receipt_note`.
- `26-rules-by-example.md:2013` currently says no network-settings record exists. It is
  rewritten: the record exists (`network_settings`), and the surcharge bound and the
  розписка threshold are still supplied by code.
- `CLAUDE.md`'s table count becomes twenty-four and names this slice.

### 3.3 Reprints

The text is not stored with an intake. Reprinting an older receipt prints whatever the
network's text is at the moment of printing. If a future text carries terms someone relies
on as an agreement, a snapshot is a separate slice, and receipts printed before it stay
unsnapshotted.

---

## 4. Backend — `backend/src/network-settings/`

One module. It has one write path, one read audience and no foreign writers, so it is not
split into domain and operations.

| File | Role |
|---|---|
| `network-settings.entity.ts` | The row. |
| `queries/get-network-settings.query.ts` | Reads the row (`id = true`). |
| `commands/update-network-settings.command.ts` | In one transaction: read the row, `diffFields`, and on a change save it and record the audit entry. A PATCH that changes nothing writes nothing and returns the current row. |
| `network-settings.mapper.ts` | `{ receipt_note, updated_at }`. |
| `network-settings.controller.ts` | `GET /network-settings` `@Auth()`; `PATCH /network-settings` `@Auth(UserRole.NetworkOwner)`. |
| `dto/update-network-settings.dto.ts` | `receipt_note?: string \| null`. |

### 4.1 Validation

- An empty or all-whitespace `receipt_note` is canonicalised to `null` before the diff.
- A non-null value must split on `\n` into at most 7 lines, each at most 40 characters, and
  contain no `\r` or `\t` (a tab prints eight columns wide and would be clipped). Otherwise
  400 with code `RECEIPT_NOTE_TOO_LONG`.
- Length is `String.length`. Cyrillic letters count one each; emoji are not supported.
- Trailing spaces on a line are kept.

### 4.2 Audit

`'network-settings.updated'` joins `AUDIT_ACTIONS`. The entry carries
`target_type: 'network_settings'`, `target_id: null` (the column is `uuid`; this row has no
uuid), and `before`/`after` of the changed field.

### 4.3 Tests

- Command spec: the audit entry on a change, nothing on a no-op, `''` → `null`.
- DTO spec at the edges: exactly 7 × 40 passes; an eighth line, a 41st character, a tab and
  `\r` fail; Cyrillic counts per letter.
- `*.db-spec.ts` against Postgres: the migration leaves exactly one row; a second insert
  fails on the key; `false` fails the check.

---

## 5. Frontend

### 5.1 `entities/network-settings/`

- `model/`: `NetworkSettings { receipt_note: string | null; updated_at: string }`, and
  `NOTE_LINES = 7`, `NOTE_LINE_CHARS = 40` (moved from `widgets/receipt/model/receiptNote.ts`).
- `api/useNetworkSettingsQuery`: `queryKeys.networkSettings`, `staleTime: STALE.reference`,
  `enabled: token !== null`.
- `index.ts` exports the type, the constants and the query.

### 5.2 `widgets/receipt/`

- `ReceiptDialog` loses the note state, the field and the reset on close. It reads
  `useNetworkSettingsQuery()`:
  - pending → «Друкувати» disabled;
  - error → banner `receipt.note.loadFailed` above the slip, printing allowed, blank lines;
  - success → the text goes to the sheet.
- `ReceiptSheet` takes `note: string | null`, splits it on `\n`, and pads to seven lines with
  `' '`, as today.
- `ReceiptNoteField.tsx` and `model/receiptNote.ts` (with its test) move out (§5.3).

### 5.3 `pages/settings/`

- `lib/fitReceiptNote.ts` + test — moved unchanged.
- `ui/ReceiptNoteField.tsx` — moved, with the caret fix; hint «Друкується на всіх
  квитанціях мережі».
- `api/useUpdateNetworkSettingsMutation` — its one consumer is this page. Seeds the cache
  with `setQueryData` from the response.
- `ui/SettingsPage.tsx` — `PageHeader`, a `SectionCard` «Квитанція» with the field and
  «Зберегти». The button is enabled only when the text differs from the saved one and no
  save is in flight. Success shows a toast; a server error shows a banner through
  `apiErrorToBanner` (new code `RECEIPT_NOTE_TOO_LONG`). An empty field is sent as `null`.

### 5.4 `app/`

- Route `/settings` under `RequireAuth` and `RequireRole role="network_owner"`.
- Nav item `nav.settings`, icon `Settings`, last in the «Управління» group.

### 5.5 i18n

Both locales: `nav.settings`, `settings.*` (title, card, hint, saved), `receipt.note.loadFailed`,
the banner copy for `RECEIPT_NOTE_TOO_LONG`. `receipt.note.label`/`hint` move to
`settings.receiptNote.*`; `receipt.note.lines` moves with the field.

### 5.6 Tests

- `SettingsPage`: shows the saved text; «Зберегти» disabled without a change; PATCH sends the
  wrapped text; empty sends `null`; a server error shows the banner; an operator is
  redirected by `RequireRole`.
- The caret test and the eighth-line test move with the field.
- `ReceiptDialog`: prints the network's text on the lines; blank lines for `null`; print
  disabled while loading; banner and print enabled on error.

---

## 6. Verification

A migration is in the change, so the gate is `npm run verify:full`, not the fast tier.
