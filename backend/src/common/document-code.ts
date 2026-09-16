import { BadRequestException } from '@nestjs/common';

/**
 * §6.2 of the spec. The operator types the number printed in the paper receipt
 * book; the server composes what is stored:
 *
 *     {POINT_CODE}-{IN|PO}-{YYYYMMDD}-{typed}      KPG-IN-20260908-04412
 *
 * THE PREFIX IS WHAT MAKES THE DBML'S GLOBAL `UNIQUE (code)` TRUE. Two points
 * buying identical receipt books both have an «04412»; without the point code
 * the second one is a 409 mid-transaction with a car waiting. Without the date,
 * a point collides with ITSELF when its book is replaced and restarts at 00001.
 *
 * The raw typed part is NOT stored separately — one column, one fact (DBML
 * header). Recovering it is string surgery on `code`, and nothing needs to.
 *
 * FOUR KINDS, AND THE LAST TWO INVERT THE SEAM. `IN` and `PO` prefix a number
 * the operator READ OFF PAPER. `CR` (розписка) and `CD` (завдаток) are
 * GENERATED here and copied BY the operator ONTO paper — see
 * `crates/crate-code.ts`. Same format, opposite direction of trust.
 *
 * `CR` and `CD` are separate kinds so their day counters are separate: the
 * paper log receives розписки only, and a shared counter would riddle it with
 * gaps that mean nothing, destroying the one control a log provides.
 */
export type DocumentKind = 'IN' | 'PO' | 'CR' | 'CD';

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
