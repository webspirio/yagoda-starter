import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

/**
 * Every document code in this system, in one shape:
 *
 *     {POINT_CODE}-{IN|PO|CR|CD}-{YYYYMMDD}-{NNN}      KPG-IN-20260908-004
 *
 * THE PREFIX IS WHAT MAKES THE DBML'S GLOBAL `UNIQUE (code)` TRUE. The
 * sequence restarts at 001 every shift, so without the point code two points
 * numbering in parallel collide on the same day, and without the date every
 * point collides with its own yesterday.
 *
 * ALL FOUR KINDS ARE GENERATED HERE, AND THE OPERATOR COPIES THE NUMBER ONTO
 * PAPER. Until 2026-09-18 that was true of `CR` and `CD` only: `IN` and `PO`
 * prefixed a number the operator READ OFF the paper receipt book, and
 * `normalizeTypedCode` guarded what they typed. The client removed that field
 * from both forms — one direction of trust now, not two.
 *
 * `normalizeTypedCode` SURVIVES THAT CHANGE because it is what keeps a code
 * inside the alphabet `collection_points.code`'s CHECK assumes: ASCII
 * upper-alphanumeric, so the composed value survives any encoding. It now
 * guards a sequence this file produced rather than a string a human typed,
 * which is why nothing calls it from outside any more.
 *
 * The sequence is NOT stored separately — one column, one fact (DBML header).
 * Recovering it is string surgery on `code`, and nothing needs to.
 */
export type DocumentKind = 'IN' | 'PO' | 'CR' | 'CD';

/** The three tables that carry a `code`. A closed union because the value is
 *  interpolated into SQL below — there is no table name here that did not come
 *  from this line. */
export type CodedTable = 'intakes' | 'payouts' | 'crate_issuances';

/** The alphabet here and the CHECK on `collection_points.code` must agree; both
 *  are ASCII upper-alphanumeric so the composed code survives any encoding. */
const TYPED = /^[A-Z0-9][A-Z0-9-]{0,15}$/;
const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeTypedCode(raw: string): string {
  const normalized = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!TYPED.test(normalized)) {
    throw new BadRequestException({
      message:
        'code must be 1–16 characters, start with a letter or digit, and contain only A–Z, 0–9 and hyphens',
      code: 'DOCUMENT_CODE_INVALID',
    });
  }
  return normalized;
}

export function composeDocumentCode(
  pointCode: string,
  kind: DocumentKind,
  businessDate: string,
  typed: string,
): string {
  if (!BUSINESS_DATE.test(businessDate)) {
    // Not a user error — a `date` column reaching here in any other shape means
    // TypeORM stopped returning `date` as 'YYYY-MM-DD', which would silently
    // change every code the system writes.
    throw new BadRequestException({
      message: `business_date must be YYYY-MM-DD, got ${businessDate}`,
      code: 'BUSINESS_DATE_MALFORMED',
    });
  }
  return `${pointCode}-${kind}-${businessDate.replace(/-/g, '')}-${normalizeTypedCode(typed)}`;
}

/**
 * Pads to three digits and NEVER TRUNCATES. `lpad('1000', 3, '0')` in Postgres
 * is `'100'`, which collides with document 100; migration …0007 shipped that
 * bug once. `padStart` grows instead.
 */
export function padSequence(n: number): string {
  return String(n).padStart(3, '0');
}

/**
 * The next code for a document of this kind, in this shift.
 *
 * THE COUNT INCLUDES VOIDED ROWS. A number is burnt permanently when its
 * document is voided — §9.3 keeps the voided document in the journal «НАЗАВЖДИ
 * з печаткою», and reissuing its number would point two documents at one line
 * of the paper log.
 *
 * THE ADVISORY LOCK, not a retry loop. Two documents of one kind in one shift
 * would otherwise both read the same count and compose the same code; the loser
 * gets a 23505 mid-transaction with a supplier waiting. §2.2 («одна людина за
 * раз») makes contention almost theoretical, which is exactly why the cheap
 * deterministic fix beats retry infrastructure this repo does not have. It is
 * an `xact` lock: it releases on commit or rollback with nothing to clean up.
 *
 * THE KEY IS (table, shift, kind), so the four books never wait on each other —
 * an intake never blocks behind a payout, and a розписка never behind a
 * завдаток. Separate keys mean separate counters, and a shared counter would
 * riddle each paper log with gaps that mean nothing, destroying the one control
 * a log provides.
 *
 * THE SHIFT IS THE COUNTER KEY because `UQ_shifts_point_business_date` makes a
 * shift exactly one (point, day). No counters table exists or is needed.
 *
 * THIS DEPENDS ON DOCUMENTS NEVER BEING HARD-DELETED. True today — there is no
 * DELETE route anywhere in this backend — and load-bearing tomorrow: a cleanup
 * script would silently restart the numbering.
 */
export async function nextDocumentCode(
  manager: EntityManager,
  params: {
    pointCode: string;
    businessDate: string;
    kind: DocumentKind;
    shiftId: string;
    table: CodedTable;
    /** An extra equality filter narrowing the counter inside the table.
     *  `crate_issuances` needs it: one table, two books (§6.4). */
    scope?: { column: 'mode'; value: string };
  },
): Promise<string> {
  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `document-code:${params.table}:${params.shiftId}:${params.kind}`,
  ]);

  const where = params.scope ? ` AND ${params.scope.column} = $2` : '';
  const args = params.scope ? [params.shiftId, params.scope.value] : [params.shiftId];
  const rows: Array<{ n: string | number }> = await manager.query(
    `SELECT count(*)::int AS n FROM ${params.table} WHERE shift_id = $1${where}`,
    args,
  );
  const used = Number(rows[0]?.n ?? 0);

  return composeDocumentCode(
    params.pointCode,
    params.kind,
    params.businessDate,
    padSequence(used + 1),
  );
}
