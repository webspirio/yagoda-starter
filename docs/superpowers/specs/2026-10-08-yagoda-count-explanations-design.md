# Yagoda CRM — Explanations Belong to the Count, Not the Shift

**Date:** 2026-10-08
**Source:** the review of PR #218 on the `pr-218` preview (8 Playwright scenarios) and the
brainstorming session of 2026-10-08 that validated it against the code and against the
client's screenshots in #172.
**Supersedes:** `2026-10-06-yagoda-operator-note-design.md` §2.1 (window), §2.4 (subject),
§2.5 (reopen), §3 (data), §4 (backend) and §9's first two follow-ups. That spec's frontend
shape (§6: `features/set-operator-note`, the result-screen `swap`, `ExpandableText`) stays.
Ships in PR #218, before merge, so `shifts.operator_note` never reaches `main`.

---

## 1. Why

#172 asks one thing: «кнопка пояснити працює як у приймальника, так і у керівника». The
client's own screenshot shows two rows the operator cannot explain: the 25.09 **closing**
(+78 000 ₴), already followed by the 28.09 shift, and the 28.09 **opening** (+20 914 ₴).
PR #218 as reviewed leaves both without a button:

- **S3** — the closing: the window ends when the next shift opens
  (`OPERATOR_NOTE_WINDOW_CLOSED`).
- **S4** — the opening: the operator's note covers the closing count only.
- **S6** — worse, and found on the way: `shifts.explanation` is one column per shift. An owner
  who explains the morning discrepancy turns the evening's shortfall into «explained». It
  leaves the owner's working list and the closer is refused with `OWNER_ALREADY_EXPLAINED`.
  A real shortfall becomes invisible.

All three have one cause: a discrepancy belongs to a **count** (opening or closing), while
both texts are stored on the **shift**. The window in S3 was added only to keep a shift-level
note from straying onto the wrong count.

## 2. Decisions (settled 2026-10-08)

1. **Both texts move to `cash_counts`.** `explanation` (owner) and `operator_note`
   (operator) become columns of the count they answer. `shifts` loses both.
2. **The operator who counted explains.** The note's author is the count's
   `counted_by_user_id`: the closer for a closing count, the opener for an opening count
   (decided: the opener, not yesterday's closer).
3. **No window.** The operator may write while the owner has not explained that count. The
   next shift opening no longer closes anything.
4. **Migration copies to both.** An existing `shifts.explanation` is copied onto every
   opening/closing berry count of that shift with a non-zero discrepancy, so no incident
   reopens.
5. **The opener sees the opening discrepancy.** The open result shows it and offers the note
   form, exactly as the close result does. This reverses the screen's «no discrepancy pill
   for an open» choice; the opening count has been compared with the previous close since
   09.09, so the discrepancy is real and is already an `is_open` incident.
6. **Reopen erases nothing.** The demoted closing count keeps both texts as history; the
   re-close starts clean. The 07.10 amendment (reopen clears `explanation` when the closing
   count disagreed) and its «both counts disagreed» residual retire.

## 3. Data

### 3.1 Migration `1788600000022-CashCountExplanations`

Replaces `1788600000021-ShiftOperatorNote`, which is deleted from the branch (it never
reached `main`). Numbered 022 because PR #222 also claims 021 (`NetworkSettings`). Whichever
PR merges second re-checks the number.

`up`:

```sql
ALTER TABLE "cash_counts" ADD "explanation" text;
ALTER TABLE "cash_counts" ADD "operator_note" text;
ALTER TABLE "cash_counts" ADD CONSTRAINT "CHK_cash_counts_explanation_not_blank"
  CHECK ("explanation" IS NULL OR btrim("explanation") <> '');
ALTER TABLE "cash_counts" ADD CONSTRAINT "CHK_cash_counts_operator_note_not_blank"
  CHECK ("operator_note" IS NULL OR btrim("operator_note") <> '');

-- Decision 4: onto every disagreeing standing count of the shift.
UPDATE "cash_counts" c SET "explanation" = s."explanation"
  FROM "shifts" s
 WHERE c."shift_id" = s."id" AND btrim(coalesce(s."explanation", '')) <> ''
   AND c."book" = 'berry' AND c."kind" IN ('opening', 'closing')
   AND c."counted_amount" <> c."expected_amount";

-- A text on a shift with no such count is kept, on its closing count, else its opening.
UPDATE "cash_counts" c SET "explanation" = s."explanation"
  FROM "shifts" s
 WHERE c."shift_id" = s."id" AND btrim(coalesce(s."explanation", '')) <> ''
   AND NOT EXISTS (SELECT 1 FROM "cash_counts" x
                    WHERE x."shift_id" = s."id" AND x."explanation" IS NOT NULL)
   AND c."id" = (SELECT y."id" FROM "cash_counts" y
                  WHERE y."shift_id" = s."id" AND y."book" = 'berry'
                    AND y."kind" IN ('opening', 'closing')
                  ORDER BY (y."kind" = 'closing') DESC LIMIT 1);

ALTER TABLE "shifts" DROP COLUMN "explanation";
```

`shifts.operator_note` is never created, so there is nothing to move. A `''` explanation
(today's «undecided») is not copied; the CHECK makes `NULL` the only «none».

`down` re-adds `shifts.explanation`, fills it from the closing count's explanation, else the
opening's, and drops the two columns and CHECKs. **Lossy** when the two counts carry
different texts; the migration says so in a comment.

### 3.2 No CHECK on `kind`

A demoted closing count is `midday` and must keep its texts, while a recount (also `midday`)
must never get one. The schema cannot tell them apart, so the write path enforces it (§4.1).

### 3.3 Entities and DBML

- `CashCount` gains `explanation` and `operator_note` (`string | null`) and both `@Check`s.
- `Shift` loses `explanation`. `operator_note` is never added.
- `28-db-schema.dbml`: the two columns under `cash_counts` with a Note paragraph (who writes
  each, «only `explanation` closes the incident», reopen keeps them on the demoted row); the
  `shifts` column and its 06.10 and 07.10 amendments go, replaced by one sentence pointing to
  `cash_counts`. Still twenty-three tables on this branch (PR #222 adds the 24th).

## 4. Backend

### 4.1 Writes — `PUT /cash-counts/:id/explanation` and `PUT /cash-counts/:id/operator-note`

Both live in `CashCountsService`, run in one transaction with `pessimistic_write` on the
count row, scope the count through its shift's point (another point's count is 404, as
today), and record an audit entry in the same transaction: `cash-count.explained` and
`cash-count.operator_noted`, `before`/`after` carrying the text. DTOs keep today's rules:
1–2000 characters, not blank, trimmed.

One pure function, `countNoteRefusal(actor, count, field)` in
`cash-counts/count-notes.ts`, returns the exception or `null`; the `PUT`s throw it and the
read flags are `refusal === null`. Checks in order:

| Condition | Status | `code` | Applies to |
|---|---|---|---|
| actor is not the owner | 403 | `OWNER_ONLY` | explanation |
| actor is not `counted_by_user_id` | 403 | `NOT_COUNTER` | operator note |
| `book <> 'berry'` or `kind = 'midday'` | 409 | `COUNT_NOT_EXPLAINABLE` | both |
| `counted_amount = expected_amount` | 409 | `NO_DISCREPANCY` | both |
| `explanation IS NOT NULL` | 409 | `OWNER_ALREADY_EXPLAINED` | operator note |

- The owner may explain at any time, including while the shift is open (the opening count
  exists from the open). Re-sending replaces the text, as today.
- `NOT_SHIFT_CLOSER`, `OPERATOR_NOTE_WINDOW_CLOSED` and `SHIFT_NOT_CLOSED` (on this route)
  disappear. A closing count exists only once the shift is closed, so «not closed yet» has no
  row to refuse.
- The `@Auth` role gate stays per route: owner for explanation, operator for the note.

`PUT /shifts/:id/explanation` and `PUT /shifts/:id/operator-note` are removed, along with
`SetOperatorNoteDto`, `shifts/operator-note.ts` and `OPERATOR_NOTE_FACTS_SQL`.

### 4.2 Reopen

`reopen` stops touching any text: no `operator_note`, no `explanation`, no
`has_discrepancy` read before the demotion. The demoted row keeps both texts.

### 4.3 Reads

- **`GET /cash-counts` rows**: `explanation` and `operator_note` come from the row itself, not
  the `shifts` join. They gain `explainable` (owner may write now) and
  `operator_note_editable` (this actor may write now), both from `countNoteRefusal`, with no
  extra query (every fact is on the row).
- **`is_open`** = discrepancy ≠ 0 AND `kind <> 'midday'` AND `c.explanation IS NULL`. The
  `only_discrepancies` filter (`cash-counts.service.ts`) uses the same predicate.
- **`ShiftResponse`** loses `explanation`, `operator_note` and `operator_note_editable`.
  `ShiftsService.respond` loses its facts query.
- `unexplained_difference` (`point-cash.service.ts`) is unchanged: it never read the texts.
- `POST /cash-counts` (midday recount) stops copying `shift.explanation` onto its response.

## 5. Error contract

New codes: `NOT_COUNTER`, `COUNT_NOT_EXPLAINABLE`. Removed: `NOT_SHIFT_CLOSER`,
`OPERATOR_NOTE_WINDOW_CLOSED`. `NO_DISCREPANCY` and `OWNER_ALREADY_EXPLAINED` keep their
codes. `apiErrorToBanner` and both locales follow; the `error-codes` verify row checks it.

## 6. Frontend

- **`features/set-operator-note`**: the mutation targets `PUT /cash-counts/:id/operator-note`
  and takes a count id. The form is unchanged except its title, which names the count
  («розбіжність на відкритті / закритті»).
- **`features/set-cash-explanation`**: the mutation targets `PUT /cash-counts/:id/explanation`
  and takes a count id. The dialog quotes that count's `operator_note`.
- **`CashCountHistory`**: each row renders its own `explanation` and `operator_note`, and its
  own buttons from `explainable` / `operator_note_editable`. A midday row renders texts only
  if it has them (a demoted closing). This retires the «owner's explanation renders on every
  count row» follow-up.
- **`ShiftCountPanel`**: the explanation line becomes per count (opening, closing).
- **`PointCashPage`, open result (decision 5)**: the open result shows the opening
  discrepancy like the close result does, and opens the note form once when the opening row
  is `operator_note_editable`. The `resultFor` latch already carries the mode; the note logic
  stops being close-only.
- **`OpenShiftAlert` (S2)**: closing a stale shift from the banner shows the same result and
  note form as the panel's close, instead of a toast alone. The alert gains an `onClosed(shiftId)`
  callback; `PointCashPage` feeds it into `resultFor`, which stops requiring that shift to be
  the page's date (the result reads the counts by `shiftId`, not by the date on screen).
- **Types**: `entities/cash-count` gains `explainable`; `entities/shift` loses the three
  fields.
- **Copy**: «Надіслати керівнику» → «Зберегти пояснення» (nothing is sent; the owner reads it
  in the list). «Не пояснено» without a button gains a reason line: «рахував {name}», for an operator
  who did not make that count (an explained or midday row is never «Не пояснено»).

## 7. Rules and docs

- `26-rules-by-example.md` §7.7: the 06.10 amendment is rewritten. Its attribution becomes
  «Правка (команда, 06.10.2026, за #172 — замовник просив кнопку для приймальника)», with the
  rules: per count, the counter writes, no window, only the owner's explanation closes the
  incident. The 07.10 amendment is marked retired by this one. §10.3's line follows.
- `28-db-schema.dbml`: §3.3.
- `CLAUDE.md` Architecture → Documents: the operator-note sentence moves to counts.
- `backend/CLAUDE.md`: the migration list.
- Follow-ups file: the «opening-count discrepancy invisible», «explained opening disarms the
  closing note» and «explanation renders on every row» entries are closed with a pointer here.
- The 2026-10-06 spec gets a «Superseded in part by …» line under its header.

## 8. Testing and verification

**Backend unit**: `countNoteRefusal` gives each refusal for its own condition and `null` only
when all hold, for both fields; the mapper builds `is_open`, `explainable` and
`operator_note_editable` from the row; reopen no longer writes any text.

**Backend db-spec** (real Postgres):
- migration: both CHECKs reject `'   '`; the copy puts one shift text on BOTH disagreeing
  counts, on the closing count for a shift with none disagreeing, and nowhere for `''`;
  `shifts.explanation` is gone;
- **S6**: the owner explains the opening, the close disagrees → the closing count is
  `is_open`, on `only_discrepancies`, and the closer's `PUT` succeeds;
- **S3**: close with a discrepancy, open the next shift → the closer's `PUT` still succeeds;
- **S4**: the opener's `PUT` on a disagreeing opening count succeeds; another operator's is
  403 `NOT_COUNTER`;
- reopen keeps the demoted row's texts, the re-close is a fresh `is_open` count, and a `PUT`
  on the demoted row is 409 `COUNT_NOT_EXPLAINABLE`;
- an operator note never clears `is_open`;
- `dev-seed.db-spec.ts`'s unexplained-incident query reads `c.explanation`.

**Frontend**: both mutations hit the count routes; `CashCountHistory` per-row texts and
buttons for both roles; the open result shows the discrepancy and opens the form once;
closing from `OpenShiftAlert` shows the result and the form; the new copy.

**Verification**: a migration, so `npm run verify:full`; `test:db` must actually run (local
Postgres or CI), not SKIP. Frontend `tsc -b` explicitly.

## 9. Out of scope

- `shift_status.awaiting_explanation` stays in the enum, unreachable, as decided 09.09.
- Notifications. Nothing is sent to the owner; the note is read in the list.
- The crates book. Its counts do not exist yet (§7.5 trigger).
