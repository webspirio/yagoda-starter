# Yagoda CRM — Operator's Note on a Closing Discrepancy

**Date:** 2026-10-06
**Source:** the `/grilling` + brainstorming session of 2026-10-06. The question was whether
the owner-only shortage explanation (`PUT /shifts/:id/explanation`) could simply be opened to
the operator. The answer was no: `is_open` is «a discrepancy with no explanation», so an
operator writing `explanation` would close their own incident and remove it from the owner's
working list. That contradicts the client ruling of 09.09.2026 («повідомляємо керівника про
розбіжність, щоб інцидент розслідували»). The decision was to give the operator a separate
field and leave the final decision with the owner.

**Position in the schema:** one new nullable column, `shifts.operator_note`, with one CHECK.
No new table. The schema stays at twenty-three tables.

---

## 1. Goal

When the closing count does not match, the operator who closed the shift can write down what
happened while they are still at the point. The owner reads that text next to the
discrepancy and writes the explanation that closes the incident. The operator's text informs
that decision but never makes it.

## 2. Decisions (settled in grilling)

1. **Window.** The operator writes after the close, because the count is blind
   (`CloseShiftDto`: nothing returns the expectation or the discrepancy before the close is
   written). The window lasts while the shift is closed and is still the point's newest
   shift, which means the next shift has not been opened yet.
2. **Author.** Only the operator who closed the shift (`shifts.closed_by_user_id`). Other
   operators at the point and the owner cannot write this field. §10.3: «підпис під зведеною
   касою мусить належати тому, хто цю касу тримав у руках».
3. **Editing.** The text can be replaced any number of times inside the window, but only
   while the owner's `explanation` is still empty. Once the owner has decided, the text their
   decision was based on stays fixed.
4. **Subject.** The note explains only a non-zero discrepancy on the shift's standing
   `closing` count. With no such discrepancy the write is refused (409 `NO_DISCREPANCY`). An
   opening-count discrepancy is out of scope (§9).
5. **Reopen.** `reopen` clears `operator_note`, the same way it clears `broken_crates`, and
   records the old text in the `before` of `shift.reopened`. The owner's `explanation`
   is not touched by reopen, which is current behaviour and stays unchanged.
6. **Where the owner sees it.** In the `CashCountHistory` explanation column, in
   `ExplainDiscrepancyDialog` above the owner's own field (never prefilled into it), and in
   `ShiftCountPanel`.
7. **Where the operator writes it.** From the close result screen, and from the row in
   `CashCountHistory`. The server computes `operator_note_editable` so the button and the
   `PUT` cannot disagree.
8. **Field shape.** `text NULL`. Same validation as `SetExplanationDto`: 1–2000 characters,
   not blank, trimmed. It can be replaced but never deleted; only reopen sets it back to
   NULL. Every write produces an audit entry `shift.operator_noted`. `is_open` and
   `unexplained_difference` do not change.

## 3. Data

Migration `1788600000021-ShiftOperatorNote`:

```sql
ALTER TABLE "shifts" ADD "operator_note" text;
ALTER TABLE "shifts" ADD CONSTRAINT "CHK_shifts_operator_note_not_blank"
  CHECK ("operator_note" IS NULL OR btrim("operator_note") <> '');
```

`down` drops the constraint and the column.

`Shift` entity: `operator_note: string | null`, `@Check('CHK_shifts_operator_note_not_blank', …)`
declared on the class so `migration:generate` does not propose dropping it.

`28-db-schema.dbml`: add `operator_note text` under `explanation`, and add a sentence to the
`shifts` Note stating that the operator writes the field, the owner closes the incident, and
the window rule applies.

There is no CHECK tying `operator_note` to `closed_at`. Reopen clears the note in the same
statement that clears `closed_at`, so a CHECK would add nothing the service does not already
guarantee, and the window rule cannot be expressed as a row CHECK anyway.

## 4. Backend

### 4.1 Write: `PUT /shifts/:id/operator-note`

`@Auth(UserRole.PointOperator)`, body `SetOperatorNoteDto { operator_note: string }` with
`@IsString() @Length(1, 2000) @Matches(/\S/)`, the same rules as `SetExplanationDto`.

`ShiftsService.setOperatorNote(actor, id, dto)` runs in one transaction:

1. `loadVisible(actor, id, m)`: `pessimistic_write` on the shift row. Another point's shift
   returns 404, as it does today.
2. The checks, in this order, each with a stable `code`:

| Condition | Status | `code` |
|---|---|---|
| `closed_at IS NULL` | 409 | `SHIFT_NOT_CLOSED` |
| `closed_by_user_id !== actor.sub` | 403 | `NOT_SHIFT_CLOSER` |
| a newer shift exists at the point | 409 | `OPERATOR_NOTE_WINDOW_CLOSED` |
| `explanation` is non-empty | 409 | `OWNER_ALREADY_EXPLAINED` |
| the standing `closing` count has `counted_amount = expected_amount` | 409 | `NO_DISCREPANCY` |

3. `shift.operator_note = dto.operator_note.trim()`, then save and record the audit entry
   `shift.operator_noted` with `before: { operator_note }` and `after: { operator_note }`,
   both inside the same transaction.

The window check asks the same question reopen's `SHIFT_NOT_NEWEST` asks («is there a shift
at this point with a later `business_date`?»), but as a `NOT EXISTS` column in one SQL query
that also answers «does the standing closing count disagree?». The question is exact because
`UQ_shifts_point_business_date` allows one shift per point per day. Reopen keeps its own
query unchanged.

The checks live in one pure function, `operatorNoteRefusal(actor, shift, facts)` in
`shifts/operator-note.ts`, which returns the exception to throw or `null`. The `PUT` throws
what it returns. The read flag `operator_note_editable` is `refusal === null`, so the button
and the `PUT` agree by construction rather than by two copies kept in step.

«Standing `closing` count» means the row with `kind = 'closing'` and `book = 'berry'`. A close
writes only the berry book, and a reopen demotes the previous closing count to `midday`, so at
most one such row exists.

### 4.2 The race with the owner

`setExplanation` currently writes with no lock. It moves into a transaction with
`loadVisible(actor, id, m)` (`pessimistic_write`), so an operator's write and the owner's
write on the same shift run one after the other. Without the lock, the rule «the operator
cannot write after the owner decided» can be broken by two concurrent requests. The owner's
observable behaviour does not change.

The other race, an operator writing the note while the next shift is being opened at the
same point, is accepted. Opening inserts a new row and takes no lock on the old one, so the
note can land a moment after the window closed. The text is still the closer's own testimony
about their own count, written within moments of the window. That costs nothing, and closing
the gap would need a point-level lock on `open`.

### 4.3 Reopen

`reopen` additionally sets `shift.operator_note = null`, adds `operator_note` to `before`, and
adds `operator_note: null` to `after` of `shift.reopened`.

### 4.4 Reads

`operatorNoteEditable(actor, shift, facts)` is `actor.role === PointOperator &&
operatorNoteRefusal(…) === null` (§4.1) and is the single definition of «may this actor write
the note now».

- **`ShiftResponse`** gains `operator_note: string | null` and `operator_note_editable: boolean`.
  `toShiftResponse(shift, names, editable)` takes the flag from the caller. Every caller that
  returns a shift goes through one private `ShiftsService.respond(actor, shifts, m)`, which
  loads names and facts once per call, never once per row (D-8). The facts query runs only
  for shifts that could possibly be editable (operator actor, closed, closed by them, no owner
  explanation), so an owner's read and an open shift cost no extra query.
- **`GET /cash-counts` rows** gain `operator_note` (selected through the same `shifts` join
  that already provides `explanation`) and `operator_note_editable`. The row is
  `kind = 'closing'` and carries its own discrepancy. «Newest at point» is a
  `NOT EXISTS (SELECT 1 FROM shifts n WHERE n.collection_point_id = s.collection_point_id AND n.business_date > s.business_date)`
  column in the same query.
- For the owner, `operator_note_editable` is always `false`.

`is_open`, the `only_discrepancies` filter, and `unexplained_difference` in
`point-cash.service.ts` do not change. The operator's note never closes an incident.

## 5. Error contract

The five codes in §4.1 are new. The frontend maps them through `apiErrorToBanner` with
translations in `en.json` and `uk.json`. `frontend/src/shared/lib/i18n/locales.test.ts` checks that the two files have the same keys.
The `@Auth` refusal for the owner is the existing 403 and needs no new code.

## 6. Frontend

### 6.1 New feature `features/set-operator-note/`

It follows the structure of `set-cash-explanation`:

- `api/useSetOperatorNote.ts`: `useSetOperatorNoteMutation()`, `PUT
  /shifts/:id/operator-note`, which invalidates `queryKeys.shifts` and `queryKeys.cashCounts`.
- `ui/OperatorNoteForm.tsx`: header, textarea and footer with no `Dialog` of its own, the same
  split as `CountResultBody`. The title states the discrepancy amount (as
  `ExplainDiscrepancyDialog` does). The textarea is prefilled with the current
  `operator_note` so it can be corrected. Validation is 1–2000 characters, not blank. Errors
  go to `apiErrorToBanner`, with `SHIFT_NOT_CLOSED` overridden, because its shared wording is
  about reopening.
- `ui/OperatorNoteDialog.tsx`: a thin `Dialog` wrapper around the form, used by
  `CashCountHistory`.
- `index.ts`: the public API.

### 6.2 Close result screen

`CountResultView` belongs to `features/count-shift`, and a feature may not import another
feature. It therefore gains two generic optional props:
- `action?: ReactNode`, rendered in the result body's footer before «Готово»;
- `swap?: ReactNode | null`, which, when non-null, replaces the result body inside the
  SAME `DialogContent`.

`PointCashPage` (page layer) passes «Пояснити розбіжність» as `action` when the closing
row's `operator_note_editable` is true. The click sets page state that passes
`<OperatorNoteForm>` as `swap`. Saving closes the whole dialog, and cancelling returns to the
result. Only one `Dialog` ever exists, which avoids the double-`role="dialog"` bug that
`RecountDrawerDialog`'s doc comment describes, for the same reason that component swaps its
body instead of opening a second dialog.

### 6.3 `CashCountHistory`

In the explanation column:

- the owner's `explanation`, if any, keeps its current rendering;
- `operator_note`, if any, appears under it as muted italic «Приймальник: …»;
- the operator sees «Пояснити», or «Змінити пояснення» once a note exists, when
  `operator_note_editable` is true, and otherwise the current «Відкрито» text;
- the owner still sees «Пояснити» while `is_open`. The dialog receives `operatorNote`.

### 6.4 `ExplainDiscrepancyDialog`

It takes a new prop `operatorNote: string | null`. When it is non-null, the text appears as
a quoted block above the owner's textarea. The textarea stays empty.

### 6.5 `ShiftCountPanel`

A «Приймальник: …» line appears next to the existing `pointCash.panel.explanation` line.

### 6.6 Types

`entities/shift` and `entities/cash-count` gain `operator_note: string | null` and
`operator_note_editable: boolean`.

## 7. Rules and docs

- `26-rules-by-example.md`: an amendment under §7.7 dated 06.10.2026 says the operator may
  record their own account of a closing discrepancy (window, author, editing rules), and that
  only the owner's `explanation` closes the incident. §10.3 gets a matching line.
- `28-db-schema.dbml`: see §3.
- Code comments that state «explanation → NetworkOwner ONLY» (`shifts.controller.ts`,
  `SetExplanationDto`, `shift.entity.ts`) stay true. The controller's role table gains an
  `operator-note → PointOperator ONLY (closer)` line.
- `CLAUDE.md` Architecture → Documents: one sentence on the operator's note.

## 8. Testing and verification

**Backend unit** (`shifts.service.spec.ts`, mapper specs):
- each of the five refusals, in the order of §4.1;
- a successful write trims the text and records `shift.operator_noted` with before and after;
- a replacement inside the window records the previous text in `before`;
- `reopen` clears `operator_note` and records it in `before`;
- `operatorNoteRefusal` returns each refusal for its own condition and `null` only when all hold, and `operatorNoteEditable` is false for the owner whatever the facts;
- for the owner, `operator_note_editable` is `false`.

**Backend db-spec** (real Postgres):
- the migration adds the column, the CHECK rejects `'   '`, and `down` reverses it;
- opening the next shift closes the window (409 `OPERATOR_NOTE_WINDOW_CLOSED`);
- `GET /cash-counts` returns `operator_note` and a flag that matches the `PUT`;
- an operator note leaves `is_open` true and keeps the row on the owner's `only_discrepancies` list (`unexplained_difference` reads no `shifts` text column, so it cannot move);
- the full cycle: close with a discrepancy, write a note, reopen (note cleared), close again,
  write a new note, then the owner explains, after which the operator's `PUT` returns 409
  `OWNER_ALREADY_EXPLAINED`.

**Frontend:**
- tests for the hook and `OperatorNoteDialog`;
- `PointCashPage`: the button appears only for a non-zero close discrepancy, and the click
  replaces the result view with the dialog;
- `CashCountHistory`: both roles, both texts, editable versus non-editable;
- `ExplainDiscrepancyDialog` shows the note without prefilling;
- `ShiftCountPanel` shows the line.

**Verification:** the migration makes this a `npm run verify:full` change. Frontend `tsc -b`
is run explicitly, because vitest does not typecheck.

## 9. Out of scope → follow-ups

Recorded in `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`:

- **An opening-count discrepancy is invisible to the operator.** `shifts.open` compares the
  morning count with the previous close (`expectedForOpening`), and a mismatch is an
  `is_open` incident on the new shift. `PointCashPage` deliberately shows no discrepancy pill
  for an open, so the operator cannot see it and therefore cannot explain it.
- **Dev seed.** No seeded operator note; manual testing creates one by closing with a
  mismatch.
